'use strict';
module.exports = function registerKeyAcquisitionControls({ test, assert, boot, waitFor, JSDOM }) {
  function assertApplicationGuidance(help) {
    assert.ok(help, 'first-time application guidance must be available');
    assert.deepEqual([...help.querySelectorAll('dd')].map(node => node.textContent),
      ['None', 'Personal use', 'General', 'Personal use', 'Personal, non-commercial use of eBird data.']);
    assert.match(help.textContent, /Examples only if accurate.*personal, non-commercial/);
    assert.match(help.textContent, /submit.*yourself/);
    assert.match(help.textContent, /does not fill fields, accept terms or submit/);
    assert.equal(help.querySelector('input, textarea, select, form, button'), null,
      'guidance is read-only, not a second application form');
  }

  test('F1083 setup and Settings share minimal generic guidance without changing user state or clipboard', async () => {
    const app = await boot({ sample: false, key: null, storage: { bc_setup_step_v1: 'key' } });
    try {
      let clipboard = 0;
      Object.defineProperty(app.window.navigator, 'clipboard', { configurable: true, value: {
        readText() { clipboard++; return Promise.resolve('PRIVATE_CLIPBOARD'); },
        writeText() { clipboard++; return Promise.resolve(); }
      } });
      const storage = app.window.localStorage;
      const before = JSON.stringify(Object.keys(storage).sort().map(key => [key, storage.getItem(key)]));
      app.open(/Settings/);
      const settings = app.$('keyApplicationHelp').querySelector('[data-birdchaser-api-help]');
      assertApplicationGuidance(settings);
      settings.open = true;
      assert.equal(JSON.stringify(Object.keys(storage).sort().map(key => [key, storage.getItem(key)])), before);
      app.window.__app.openSetupSheet();
      assert.equal(app.$('setupSheetBody').querySelector('[data-birdchaser-api-help]'), null,
        'F1156 explanations are optional rather than cluttering the action screen');
      app.click(app.$('setupHelp'));
      const setup = app.$('appSheet').querySelector('[data-birdchaser-api-help]');
      assertApplicationGuidance(setup);
      assert.equal(setup.textContent, settings.textContent);
      assert.equal(clipboard, 0);
      assert.equal(storage.getItem('ebird_api_key'), null);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  function preparedKeyNative(app, markup, signedIn = true) {
    const listeners = new Map(), pages = new Map();
    const state = { opened: [], closed: [], scripts: [], external: [], clears: 0, signedIn, hold: false };
    state.emit = (name, event) => [...(listeners.get(name) || [])].forEach(fn => fn(event));
    const timer = app.window.setTimeout.bind(app.window);
    app.window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 500 ? 0 : ms, ...args);
    const plugin = {
      open({ url }) { state.external.push(url); return Promise.resolve(); },
      addListener(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
        return Promise.resolve({ remove() { listeners.get(name).delete(fn); } });
      },
      openWebView(options) {
        const id = 'owned-key-' + (state.opened.length + 1);
        state.opened.push({ ...options, id });
        const page = new JSDOM(options.url.endsWith('/profile') ? '<h1>Profile</h1>' : markup,
          { url: options.url, runScripts: 'outside-only' });
        if (state.onPage) state.onPage(page.window);
        page.window.mobileApp = { postMessage(message) {
          state.emit('messageFromWebview', { id, detail: message.detail });
        } };
        pages.set(id, page);
        setTimeout(() => state.emit('browserPageLoaded', { id }), 0);
        return Promise.resolve({ id });
      },
      executeScript(options) {
        state.scripts.push(options);
        if (pages.get(options.id).window.location.pathname === '/profile') {
          state.signedIn = true;
          state.emit('messageFromWebview', { id: options.id, detail: {
            __ebird: true, kind: 'identity', ok: true,
            data: { status: 'ok', displayName: state.displayName || 'Synthetic Connected Birder',
              evidence: 'account-menu-aria-label' }
          } });
        } else if (!state.hold) pages.get(options.id).window.eval(options.code);
        return Promise.resolve();
      },
      clearAllBrowsingData() {
        state.clears++;
        if (state.failClear) return Promise.reject(new Error('Synthetic clear failure'));
        state.signedIn = false;
        return Promise.resolve();
      },
      close({ id }) { state.closed.push(id); return Promise.resolve(); },
      hide() {}, show() {}
    };
    app.window.Capacitor = { Plugins: { CapgoInAppBrowser: plugin } };
    state.inject = () => {
      const latest = state.scripts.at(-1);
      pages.get(latest.id).window.eval(latest.code);
    };
    state.relocate = (id, url) => pages.get(id).reconfigure({ url });
    state.page = id => pages.get(id).window;
    state.destroy = () => pages.forEach(page => page.window.close());
    return state;
  }

  test('F1078 prepared one Connect action reuses login and verifies captured key before saving', async () => {
    const key = 'SYNTHETIC_KEY_F1078_CONNECTED';
    let release, validations = 0;
    const app = await boot({ report: null, home: false, sample: false, key: null,
      fetch(url, options) {
        if (/ref\/region\/info\/US-WA/.test(url)) {
          validations++;
          assert.equal(options.headers['X-eBirdApiToken'], key);
          return new Promise(resolve => { release = resolve; });
        }
        return null;
      } });
    const bridge = preparedKeyNative(app, '<h1>API Key Request</h1><p>Your API key is: <strong>' + key + '</strong></p>', false);
    try {
      const A = app.window.__app;
      A.openSetupSheet();
      const clears = bridge.clears;
      app.click(app.$('setupConnectEbird'));
      await waitFor(() => !app.$('appSheet')?.hidden
        && app.$('appSheet')?.dataset.infoId === 'setup-account-connected', 'account confirmation');
      assert.equal(app.$('appSheet').querySelector('.sheettitle').textContent, '✅ Connected as Synthetic Connected Birder!');
      assert.doesNotMatch(app.$('appSheet').textContent, /Wrong account/);
      assert.equal(app.$('setupSheet').inert, true);
      assert.deepEqual(bridge.opened.map(open => open.url), ['https://ebird.org/profile'],
        'F1170 do not start key capture before the user confirms the account');
      app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
      await waitFor(() => app.$('setupSheetBody').dataset.setupStep === 'key'
        && A.getDisplayName() === 'Synthetic Connected Birder', 'account connection finishes');
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(bridge.opened.map(open => open.url),
        ['https://ebird.org/profile', 'https://ebird.org/api/keygen'],
        'confirming the connected account starts key capture without another Fetch click');
      await waitFor(() => release, 'one account action automatically captures and validates the key');
      assert.equal(bridge.signedIn, true);
      assert.equal(validations, 1);
      assert.equal(bridge.clears, clears, 'key acquisition signed out the preceding website login');
      assert.deepEqual(bridge.opened.map(open => open.url),
        ['https://ebird.org/profile', 'https://ebird.org/api/keygen']);
      assert.ok(bridge.opened.every(open => open.persistWebViewData === true));
      assert.equal(app.window.localStorage.getItem('ebird_api_key'), null, 'candidate saved before verification');
      assert.equal(A.getDisplayName(), 'Synthetic Connected Birder');
      assert.equal(app.$('setupSheetBody').querySelector('.setupprogress').children[0]
        .querySelector('.setupdone').getAttribute('aria-label'), 'Completed');
      assert.equal(app.$('setupSheetBody').querySelector('.setupprogress').children[1]
        .querySelector('.setupdone'), null, 'a captured but unverified key is not complete');
      assert.equal(app.$('setupStepTitle').textContent, 'Fetch your eBird API key');
      assert.equal(app.$('setupGetKey').textContent.trim(), 'Fetch API key');
      assert.equal(app.$('setupGetKey').tagName, 'BUTTON');
      release({ code: 'US-WA' });
      await waitFor(() => !app.$('appSheet').hidden
        && app.$('appSheet').dataset.infoId === 'setup-key-verified', 'verified-key confirmation');
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'key', 'verification waits for confirmation before Home');
      assert.ok(!app.$('appSheet').textContent.includes(key), 'confirmation must not disclose the credential');
      app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
      await waitFor(() => app.$('setupSheetBody').dataset.setupStep === 'home', 'verified capture advances to required Home');
      assert.equal(app.window.localStorage.getItem('ebird_api_key'), key);
      assert.equal(app.window.localStorage.getItem(A.bcReal('bc_api_verified_v1:')), key);
      assert.equal(app.$('setupSheetBody').querySelector('.setupprogress').children[1]
        .querySelector('.setupdone').textContent, '✓', 'verified capture completes Step 2 and skips to Home');
      assert.equal(bridge.closed.length, 2);
      assert.ok(!JSON.stringify(app.window.__dbg.buf).includes(key), 'a captured key reached diagnostics');
      assert.deepEqual(app.state.errors, []);
    } finally { if (release) release({ code: 'US-WA' }); bridge.destroy(); app.window.close(); }
  });

  test('F1170 Back exposes a real account switch and a failed session clear never reuses the wrong login', async () => {
    for (const failClear of [false, true]) {
      const app = await boot({ report: null, home: false, sample: false, key: null });
      const bridge = preparedKeyNative(app, '', false);
      try {
        app.window.__app.openSetupSheet();
        app.click(app.$('setupConnectEbird'));
        await waitFor(() => app.$('appSheet')?.dataset.infoId === 'setup-account-connected'
          && !app.$('appSheet').hidden, 'connected account review');
        app.click(app.$('appSheet').querySelector('[data-setup-confirm-back]'));
        assert.equal(app.$('setupSheetBody').dataset.setupStep, 'account');
        assert.equal(app.$('setupReconnectEbird').textContent, 'Switch account');
        assert.equal(app.$('setupReconnectEbird').closest('details'), null);
        assert.equal(bridge.opened.length, 1, 'Back cannot start key acquisition');
        app.click(app.$('setupHelp'));
        assert.match(app.$('appSheet').querySelector('.docintro').textContent,
          /Reviews the connected eBird account before automatic key capture/);
        app.click(app.$('appSheet').querySelector('.sheetclose'));
        bridge.displayName = '<img src=x> Another Synthetic Birder';
        bridge.failClear = failClear;
        app.click(app.$('setupReconnectEbird'));
        if (failClear) {
          await waitFor(() => /could not be cleared/.test(app.$('setupActionStatus').textContent), 'clear failure');
          assert.equal(bridge.opened.length, 1, 'failed clearing must not recapture the old browser account');
          assert.equal(app.window.__app.getDisplayName(), 'Synthetic Connected Birder');
        } else {
          await waitFor(() => app.$('appSheet').dataset.infoId === 'setup-account-connected'
            && !app.$('appSheet').hidden, 'different account review');
          assert.equal(app.$('appSheet').querySelector('.sheettitle').textContent,
            '✅ Connected as <img src=x> Another Synthetic Birder!');
          assert.equal(app.$('appSheet').querySelector('img'), null, 'display names are text, not markup');
          assert.deepEqual(bridge.opened.map(open => open.url),
            ['https://ebird.org/profile', 'https://ebird.org/profile']);
        }
        assert.equal(bridge.clears, 1);
        assert.equal(app.window.localStorage.getItem('ebird_api_key'), null);
        assert.deepEqual(app.state.errors, []);
      } finally { bridge.destroy(); app.window.close(); }
    }
  });

  test('F1171 verified-key Back and close expose manual entry or fetch again without losing the saved key', async () => {
    for (const close of ['back', 'close', 'escape']) {
      const key = 'SYNTHETIC_VERIFIED_REVIEW';
      const app = await boot({ report: null, home: false, sample: false, key: null,
        storage: { bc_setup_step_v1: 'key' },
        fetch: url => /ref\/region\/info\/US-WA/.test(url) ? { code: 'US-WA' } : null });
      try {
        const A = app.window.__app;
        A.openSetupSheet();
        app.$('setupApiKey').value = key;
        app.$('setupApiKey').dispatchEvent(new app.window.Event('input'));
        app.click(app.$('setupVerifyKey'));
        await waitFor(() => app.$('appSheet')?.dataset.infoId === 'setup-key-verified'
          && !app.$('appSheet').hidden, 'manual key success review');
        assert.equal(app.$('appSheet').querySelector('.sheettitle').textContent, '✅ API key validated!');
        assert.ok(!app.$('appSheet').textContent.includes(key));
        assert.equal(app.$('setupSheet').inert, true);
        const back = app.$('appSheet').querySelector('[data-setup-confirm-back]');
        back.focus();
        const tab = new app.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        back.dispatchEvent(tab);
        assert.equal(tab.defaultPrevented, true);
        assert.equal(app.window.document.activeElement, app.$('appSheet').querySelector('.sheetclose'));
        if (close === 'escape')
          app.window.document.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else app.click(close === 'close' ? app.$('appSheet').querySelector('.sheetclose') : back);
        assert.equal(app.$('setupSheetBody').dataset.setupStep, 'key');
        assert.equal(app.$('setupSheet').inert, false);
        assert.equal(app.$('setupGetKey').textContent, 'Fetch again');
        assert.equal(app.$('setupGetKey').hidden, false);
        assert.equal(app.$('setupApiKey').closest('details'), null);
        assert.equal(app.$('setupApiKey').type, 'password');
        assert.equal(app.$('setupApiKey').value, key);
        assert.equal(app.window.localStorage.getItem('ebird_api_key'), key,
          'going back must not delete an already verified working key');
        app.$('setupApiKey').value = key;
        app.$('setupApiKey').dispatchEvent(new app.window.Event('input'));
        if (close === 'back') {
          app.click(app.$('setupHelp'));
          assert.match(app.$('appSheet').querySelector('.docintro').textContent,
            /already verified key.*confirmation/);
          app.click(app.$('appSheet').querySelector('.sheetclose'));
        }
        app.click(app.$('setupVerifyKey'));
        A.applyCapturedIdentity({ status: 'ok', displayName: 'Different Synthetic Owner' });
        app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
        assert.equal(app.$('setupSheetBody').dataset.setupStep, 'key',
          'a stale identity cannot approve the previous confirmation');
        assert.deepEqual(app.state.errors, []);
      } finally { app.window.close(); }
    }
  });

  test('F1175 automatic key success uses matching captured account evidence, never an inferred owner', async () => {
    for (const kind of ['matching', 'unknown', 'different', 'hostile']) {
      const key = 'SYNTHETIC_F1175_NEW_KEY', previous = 'SYNTHETIC_F1175_WORKING_KEY';
      const name = kind === 'hostile' ? '<img src=x onerror=alert(1)> Sample Birder' : 'Synthetic Connected Birder';
      let validations = 0;
      const app = await boot({ sample: false, key: previous,
        storage: { bc_setup_step_v1: 'key', ebird_seen_setup_skipped: '1' },
        fetch: url => {
          if (/ref\/region\/info\/US-WA/.test(url)) { validations++; return { code: 'US-WA' }; }
          return null;
        } });
      const account = app.document.createElement('button');
      account.setAttribute('aria-label', 'Birder ' + (kind === 'different' ? 'Other Synthetic Birder' : name) + ' (synthetic_username)');
      const bridge = preparedKeyNative(app, (kind === 'unknown' ? '' : '<header>' + account.outerHTML + '</header>')
        + '<p>Your API key is: <strong>' + key + '</strong></p>');
      try {
        const A = app.window.__app;
        A.applyCapturedIdentity({ status: 'ok', displayName: name });
        A.openSetupSheet();
        app.click(app.$('setupGetKey'));
        if (kind === 'different') {
          await waitFor(() => /account changed/.test(app.$('setupActionStatus').textContent)
            || app.$('appSheet')?.dataset.infoId === 'setup-key-verified'
              && !app.$('appSheet').hidden, 'key-page account outcome');
          assert.match(app.$('setupActionStatus').textContent, /account changed/);
          assert.equal(validations, 0);
          assert.equal(app.window.localStorage.getItem('ebird_api_key'), previous);
          assert.equal(app.$('appSheet')?.dataset.infoId === 'setup-key-verified' && !app.$('appSheet').hidden, false);
        } else {
          await waitFor(() => app.$('appSheet')?.dataset.infoId === 'setup-key-verified'
            && !app.$('appSheet').hidden, kind + ' automatic success');
          assert.equal(app.$('appSheet').querySelector('.sheettitle').textContent,
            '✅ Successfully fetched API key' + (kind === 'unknown' ? '' : ' for ' + name) + '!');
          assert.equal(app.$('appSheet').querySelector('img, script'), null);
          assert.ok(!app.$('appSheet').textContent.includes(key));
          assert.equal(validations, 1);
        }
        assert.ok(!JSON.stringify(app.window.__dbg.buf).includes(key));
        const stored = JSON.stringify(Object.keys(app.window.localStorage)
          .map(k => [k, app.window.localStorage.getItem(k)]));
        assert.ok(!stored.includes('synthetic_username'), 'account-menu username must not be persisted');
        assert.deepEqual(app.state.errors, []);
      } finally { bridge.destroy(); app.window.close(); }
    }
  });

  test('F1182 saved keys stay visibly editable and masked; exact drafts require validation without losing working keys', async () => {
    const previous = 'SYNTHETIC_F1182_WORKING', replacement = 'SYNTHETIC_F1182_REPLACEMENT';
    const app = await boot({ sample: false, key: previous,
      storage: { bc_setup_step_v1: 'key', 'bc_api_verified_v1:': previous } });
    try {
      const A = app.window.__app, originalFetch = app.window.fetch;
      let response = 403, release, checks = 0;
      app.window.fetch = (url, options) => {
        if (!/ref\/region\/info\/US-WA/.test(url)) return originalFetch(url, options);
        checks++;
        if (response === 'hold') return new Promise(resolve => { release = resolve; });
        return Promise.resolve({ ok: response === 200, status: response });
      };
      A.openSetupSheet();
      const enter = value => {
        app.$('setupApiKey').value = value;
        app.$('setupApiKey').dispatchEvent(new app.window.Event('input'));
      };
      assert.equal(app.$('setupApiKey').closest('details'), null);
      assert.equal(app.$('setupApiKey').value, previous);
      assert.equal(app.$('setupApiKey').type, 'password');
      assert.equal(app.$('setupKeyHelp').textContent, '✓ Validated');
      app.click(app.$('setupShowKey'));
      assert.equal(app.$('setupApiKey').type, 'text');
      assert.equal(app.$('setupShowKey').getAttribute('aria-pressed'), 'true');
      assert.equal(app.$('setupApiKey').value, previous);
      app.click(app.$('setupShowKey'));
      assert.equal(app.$('setupApiKey').type, 'password');
      enter(previous + ' ');
      assert.equal(app.$('setupKeyHelp').textContent, '! Not validated', 'validation belongs to the exact field');
      assert.equal(app.$('setupVerifyKey').textContent, 'Verify API key');
      enter(replacement);
      app.click(app.$('setupVerifyKey'));
      await waitFor(() => /rejected/.test(app.$('setupActionStatus').textContent), 'rejected draft');
      assert.equal(app.window.localStorage.getItem('ebird_api_key'), previous);
      assert.equal(app.$('setupApiKey').value, replacement);
      assert.equal(app.$('setupKeyHelp').textContent, '! Not validated');
      response = 'hold';
      app.click(app.$('setupVerifyKey'));
      await waitFor(() => release, 'held exact draft validation');
      enter('DIFFERENT_SYNTHETIC_DRAFT');
      release({ ok: true, status: 200 });
      await waitFor(() => !app.$('setupApiKey').disabled, 'obsolete validation finishes');
      assert.equal(app.window.localStorage.getItem('ebird_api_key'), previous);
      response = 200;
      enter(replacement);
      app.click(app.$('setupVerifyKey'));
      await waitFor(() => app.$('appSheet')?.dataset.infoId === 'setup-key-verified'
        && !app.$('appSheet').hidden, 'valid replacement');
      assert.equal(app.$('appSheet').querySelector('.sheettitle').textContent, '✅ API key validated!');
      app.click(app.$('appSheet').querySelector('[data-setup-confirm-back]'));
      assert.equal(app.$('setupApiKey').value, replacement);
      assert.equal(app.$('setupApiKey').type, 'password');
      assert.equal(app.$('setupKeyHelp').textContent, '✓ Validated');
      app.click(app.$('setupShowKey'));
      app.click(app.$('setupSheetClose'));
      A.openSetupSheet();
      assert.equal(app.$('setupApiKey').type, 'password');
      assert.equal(app.$('setupApiKey').value, replacement);
      app.window.localStorage.setItem(A.BC_PROFILE_PTR, 'synthetic-f1182-other');
      app.window.localStorage.setItem(A.bcReal('ebird_api_key'), 'SYNTHETIC_OTHER_PROFILE_KEY');
      app.window.localStorage.setItem(A.bcReal('bc_setup_step_v1'), 'key');
      A.renderSetupSheet();
      assert.equal(app.$('setupApiKey').value, 'SYNTHETIC_OTHER_PROFILE_KEY');
      assert.equal(app.$('setupApiKey').type, 'password');
      assert.equal(app.$('setupShowKey').getAttribute('aria-pressed'), 'false');
      assert.equal(checks, 3);
      assert.ok(!JSON.stringify(app.window.__dbg.buf).includes(replacement));
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1078 prepared owned injection reads labelled values without a vendor-specific selector', async () => {
    const key = 'SYNTHETIC_KEY_F1078_LABEL';
    const cases = [
      `<label for="result">API key</label><input id="result" value="${key}">`,
      `<dl><dt>eBird API key</dt><dd><code>${key}</code></dd></dl>`,
      `<p>Your API key is: ${key}</p>`,
      `<div><span>API key:</span><code>${key}</code><button>Copy</button></div>`,
      `<div><label>API key</label><output>${key}</output></div>`,
      `<section><span>API key:</span><div>${key}</div></section>`
    ];
    for (const markup of cases) {
      const app = await boot({ sample: false, key: null,
        storage: { bc_setup_step_v1: 'key' },
        fetch: url => /ref\/region\/info\/US-WA/.test(url) ? { code: 'US-WA' } : null });
      const bridge = preparedKeyNative(app, markup);
      try {
        app.window.__app.openSetupSheet();
        app.click(app.$('setupGetKey'));
        await waitFor(() => app.window.localStorage.getItem('ebird_api_key') === key, 'labelled result is verified');
        assert.equal(app.state.fetches.filter(url => /ref\/region\/info\/US-WA/.test(url)).length, 1);
        assert.ok(!JSON.stringify(app.window.__dbg.buf).includes(key));
        assert.deepEqual(app.state.errors, []);
      } finally { bridge.destroy(); app.window.close(); }
    }
  });

  test('F1078 prepared ownership rejects other windows, missing ids, stale requests and wrong origins', async () => {
    const key = 'SYNTHETIC_KEY_F1078_OWNER';
    const app = await boot({ sample: false, key: null, storage: { bc_setup_step_v1: 'key' },
      fetch: url => /ref\/region\/info\/US-WA/.test(url) ? { code: 'US-WA' } : null });
    const bridge = preparedKeyNative(app, `<p>API key: ${key}</p>`);
    bridge.hold = true;
    try {
      const A = app.window.__app;
      A.openSetupSheet();
      app.click(app.$('setupGetKey'));
      await waitFor(() => bridge.scripts.length, 'owned capture waiting');
      const id = bridge.opened[0].id;
      const detail = { __ebird: true, kind: 'apiKey', requestId: '1', ok: true,
        data: { key, sourceUrl: 'https://ebird.org/api/keygen' } };
      bridge.emit('messageFromWebview', { id: 'foreign-window', detail });
      bridge.emit('messageFromWebview', { detail });
      bridge.emit('messageFromWebview', { id, detail: { ...detail, requestId: 'stale' } });
      bridge.emit('messageFromWebview', { id, detail: { ...detail,
        data: { key, sourceUrl: 'https://untrusted.example/api/keygen' } } });
      bridge.emit('urlChangeEvent', { id, url: 'https://untrusted.example/' });
      bridge.emit('messageFromWebview', { id, detail });
      bridge.emit('closeEvent', { id: 'foreign-window' });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(app.window.localStorage.getItem('ebird_api_key'), null);
      assert.equal(app.state.fetches.filter(url => /ref\/region\/info\/US-WA/.test(url)).length, 0);
      assert.equal(bridge.closed.length, 0);
      bridge.emit('urlChangeEvent', { id, url: 'https://ebird.org/api/keygen' });
      for (const wrong of ['http://ebird.org/api/keygen', 'https://ebird.org/profile',
        'https://untrusted.example/api/keygen']) {
        bridge.relocate(id, wrong);
        bridge.inject();
        assert.equal(app.state.fetches.filter(url => /ref\/region\/info\/US-WA/.test(url)).length, 0);
      }
      bridge.relocate(id, 'https://ebird.org/api/keygen');
      bridge.inject();
      await waitFor(() => app.window.localStorage.getItem('ebird_api_key') === key, 'owned positive control');
      assert.equal(app.state.fetches.filter(url => /ref\/region\/info\/US-WA/.test(url)).length, 1);
      assert.deepEqual(app.state.errors, []);
    } finally { bridge.destroy(); app.window.close(); }
  });

  test('F1078 prepared missing/ambiguous/login results retain manual fallback and never verify login values', async () => {
    for (const markup of [
      '<p>Get an API key</p><code>UNLABELLED_SYNTHETIC_VALUE</code>',
      '<p>API key: SYNTHETIC_ONE</p><p>API key: SYNTHETIC_TWO</p>',
      '<label for="login">Username</label><input id="login" value="SYNTHETIC_LOGIN"><input type="password" value="SYNTHETIC_PASSWORD">'
    ]) {
      const app = await boot({ sample: false, key: null, storage: { bc_setup_step_v1: 'key' } });
      const bridge = preparedKeyNative(app, markup);
      let loginReads = 0;
      bridge.onPage = window => window.document.querySelectorAll('input').forEach(input => {
        Object.defineProperty(input, 'value', { get() { loginReads++; return 'SYNTHETIC_LOGIN_FIELD'; } });
      });
      try {
        app.window.__app.openSetupSheet();
        app.click(app.$('setupGetKey'));
        await waitFor(() => bridge.scripts.length >= 20 || /single labelled/.test(app.$('setupActionStatus').textContent),
          'bounded parser samples');
        if (!/single labelled/.test(app.$('setupActionStatus').textContent)) {
          bridge.emit('closeEvent', { id: bridge.opened[0].id });
        }
        await waitFor(() => /manual paste|paste manually/.test(app.$('setupActionStatus').textContent), 'manual fallback');
        assert.equal(app.window.localStorage.getItem('ebird_api_key'), null);
        assert.equal(app.state.fetches.filter(url => /ref\/region\/info\/US-WA/.test(url)).length, 0);
        assert.equal(loginReads, 0, 'capture read a login field');
        assert.ok(app.$('setupApiKey'));
        assert.ok(app.$('setupKeyExternal'));
        assert.ok(!JSON.stringify(app.window.__dbg.buf).match(/SYNTHETIC_(?:LOGIN|PASSWORD|ONE|TWO)|UNLABELLED_SYNTHETIC_VALUE/));
      } finally { bridge.destroy(); app.window.close(); }
    }
  });

  test('F1078 prepared failed verification and obsolete callbacks never replace saved credentials', async () => {
    for (const outcome of ['reject', 'profile', 'manual', 'back', 'session']) {
      const key = 'SYNTHETIC_KEY_F1078_LATE';
      let release;
      const app = await boot({ sample: false, key: null, storage: { bc_setup_step_v1: 'key' },
        fetch: url => /ref\/region\/info\/US-WA/.test(url)
          ? new Promise(resolve => { release = resolve; }) : null });
      const bridge = preparedKeyNative(app, `<p>API key: ${key}</p>`);
      try {
        const A = app.window.__app;
        A.openSetupSheet();
        app.click(app.$('setupGetKey'));
        await waitFor(() => release, 'held validation');
        if (outcome === 'profile') app.window.localStorage.setItem(A.BC_PROFILE_PTR, 'Other synthetic profile');
        if (outcome === 'manual') app.window.localStorage.setItem('ebird_api_key', 'NEW_SYNTHETIC_MANUAL');
        if (outcome === 'back') app.click(app.$('setupBack'));
        if (outcome === 'session') app.click(app.$('ebirdSignOut'));
        release(outcome === 'reject' ? { __status: 403 } : { code: 'US-WA' });
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(app.window.localStorage.getItem('ebird_api_key'),
          outcome === 'manual' ? 'NEW_SYNTHETIC_MANUAL' : null, outcome);
        if (outcome === 'reject') assert.match(app.$('setupActionStatus').textContent, /rejected|403/);
        assert.ok(!JSON.stringify(app.window.__dbg.buf).includes(key));
      } finally { if (release) release({ code: 'US-WA' }); bridge.destroy(); app.window.close(); }
    }
  });

  test('F1078 prepared Settings supports automatic capture and explicit external/manual fallback', async () => {
    for (const mode of ['automatic', 'external', 'browser']) {
      const key = 'SYNTHETIC_KEY_F1078_SETTINGS';
      const external = [];
      const app = await boot({ sample: false, key: null,
        fetch: url => /ref\/region\/info\/US-WA/.test(url) ? { code: 'US-WA' } : null });
      const bridge = mode === 'browser' ? null : preparedKeyNative(app, `<p>API key: ${key}</p>`);
      if (bridge && mode === 'external') bridge.hold = true;
      app.window.open = url => { external.push(url); return null; };
      try {
        app.open(/Settings/);
        app.click(app.$('keyGetBtn'));
        if (mode === 'automatic') {
          await waitFor(() => app.window.localStorage.getItem('ebird_api_key') === key, 'Settings capture');
          assert.equal(app.$('apiKey').value, key);
          assert.match(app.$('keyStatus').textContent, /works and is saved/);
        } else {
          if (bridge) {
            await waitFor(() => bridge.scripts.length, 'pending automatic Settings capture');
            app.click(app.$('keyExternalBtn'));
            assert.deepEqual(bridge.external, ['https://ebird.org/api/keygen']);
            bridge.inject();
          } else assert.deepEqual(external, ['https://ebird.org/api/keygen']);
          assert.equal(app.$('keyGetBtn').disabled, false, 'external fallback left automatic retry disabled');
          assert.equal(app.window.localStorage.getItem('ebird_api_key'), null);
          assert.equal(app.state.fetches.filter(url => /ref\/region\/info\/US-WA/.test(url)).length, 0);
          app.$('apiKey').value = key;
          app.click(app.$('keyTestBtn'));
          await waitFor(() => app.window.localStorage.getItem('ebird_api_key') === key, 'manual fallback verification');
        }
        assert.ok(!JSON.stringify(app.window.__dbg.buf).includes(key));
        assert.deepEqual(app.state.errors, []);
      } finally { if (bridge) bridge.destroy(); app.window.close(); }
    }
  });

  test('F1078 prepared first-time API access waits for user completion without reading or submitting the form', async () => {
    const key = 'SYNTHETIC_KEY_F1078_FIRST_ACCESS';
    const markup = '<h1>Request API Access</h1><form id="keyRequestForm">'
      + '<label for="organization-field">Organization</label>'
      + '<input id="organization-field" name="company" value="Synthetic private organization">'
      + '<input id="terms-of-use-field" type="checkbox" name="acceptTermsOfUse">'
      + '<label for="project-title-field">Project Title</label>'
      + '<input id="project-title-field" name="title" value="Synthetic private project">'
      + '<label for="abstract-field">Description of Use</label>'
      + '<textarea id="abstract-field" name="description">Synthetic private description</textarea>'
      + '<input type="hidden" name="_csrf" value="SYNTHETIC_CSRF">'
      + '<input type="submit" value="Submit Request"></form>';
    for (const outcome of ['complete', 'cancel', 'timeout', 'profile']) {
      const app = await boot({ sample: false, key: null, storage: { bc_setup_step_v1: 'key' },
        fetch: url => /ref\/region\/info\/US-WA/.test(url) ? { code: 'US-WA' } : null });
      const bridge = preparedKeyNative(app, markup);
      let fieldReads = 0, submissions = 0, clipboard = 0, deadline, originalForm;
      bridge.onPage = window => {
        originalForm = window.document.querySelector('form').outerHTML;
        Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: {
          readText() { clipboard++; return Promise.resolve('PRIVATE_CLIPBOARD'); },
          writeText() { clipboard++; return Promise.resolve(); }
        } });
        window.document.querySelectorAll('input, textarea').forEach(field => {
          Object.defineProperty(field, 'value', { get() { fieldReads++; return 'PRIVATE_FORM_VALUE'; } });
        });
        const form = window.document.querySelector('form');
        form.submit = form.requestSubmit = () => { submissions++; };
        form.addEventListener('submit', event => { event.preventDefault(); submissions++; });
      };
      const timer = app.window.setTimeout.bind(app.window);
      app.window.setTimeout = (fn, ms, ...args) => {
        if (ms === 120000) deadline = fn;
        return timer(fn, ms, ...args);
      };
      try {
        const A = app.window.__app;
        A.openSetupSheet();
        app.click(app.$('setupGetKey'));
        await waitFor(() => bridge.scripts.length >= 20, 'first-time form survives the last ordinary parser sample');
        const id = bridge.opened[0].id, page = bridge.page(id);
        const help = page.document.querySelector('[data-birdchaser-api-help]');
        assertApplicationGuidance(help);
        assert.equal(help.open, false, 'first-time guidance must not obscure the vendor form');
        assert.equal(page.document.querySelectorAll('[data-birdchaser-api-help]').length, 1);
        assert.equal(help.closest('form'), null, 'guidance must remain separate from the vendor form');
        assert.equal(page.document.querySelector('form').outerHTML, originalForm);
        assert.match(app.$('setupActionStatus').textContent, /First-time API access.*complete eBird.*form yourself/);
        assert.equal(app.$('setupGetKey').disabled, true, 'request form was mistaken for terminal unreadable output');
        assert.equal(page.document.querySelector('[name="acceptTermsOfUse"]').checked, false);
        assert.equal(fieldReads, 0);
        assert.equal(submissions, 0);
        assert.equal(clipboard, 0);
        assert.equal(bridge.closed.length, 0);
        assert.equal(app.state.fetches.filter(url => /ref\/region\/info\/US-WA/.test(url)).length, 0);
        assert.equal(app.window.localStorage.getItem('ebird_api_key'), null);
        if (outcome === 'cancel') bridge.emit('closeEvent', { id });
        if (outcome === 'timeout') { assert.equal(typeof deadline, 'function'); deadline(); }
        if (outcome === 'profile') app.window.localStorage.setItem(A.BC_PROFILE_PTR, 'Synthetic other account');
        page.document.body.innerHTML = `<p>Your API key is: <strong>${key}</strong></p>`;
        bridge.emit('browserPageLoaded', { id });
        if (outcome === 'complete') {
          await waitFor(() => app.window.localStorage.getItem('ebird_api_key') === key,
            'user-completed first-time access continues automatic verified capture');
          assert.equal(bridge.opened.length, 1, 'completion unnecessarily opened a second key window');
          assert.equal(app.state.fetches.filter(url => /ref\/region\/info\/US-WA/.test(url)).length, 1);
          assert.equal(app.$('setupSheetBody').dataset.setupStep, 'key');
          assert.equal(app.$('appSheet').dataset.infoId, 'setup-key-verified');
          app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
          assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
        } else {
          bridge.inject();
          await waitFor(() => app.$('setupGetKey').disabled === false || outcome === 'profile',
            'cancelled or timed-out form retains manual retry');
          assert.equal(app.window.localStorage.getItem('ebird_api_key'), null);
          assert.equal(app.state.fetches.filter(url => /ref\/region\/info\/US-WA/.test(url)).length, 0);
          if (outcome === 'timeout') {
            assert.match(app.$('setupActionStatus').textContent, /Timed out.*manual paste, or retry/);
            assert.equal(bridge.closed.length, 0, 'timeout destroyed the user-completed form');
          }
        }
        const diagnostic = JSON.stringify(app.window.__dbg.buf);
        assert.doesNotMatch(diagnostic, /PRIVATE_FORM_VALUE|SYNTHETIC_CSRF|Synthetic private/);
        assert.ok(!diagnostic.includes(key));
        assert.deepEqual(app.state.errors, []);
      } finally { bridge.destroy(); app.window.close(); }
    }
  });
  return { preparedKeyNative };
};
