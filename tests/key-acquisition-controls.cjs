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
      const setup = app.$('setupSheetBody').querySelector('[data-birdchaser-api-help]');
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
            data: { status: 'ok', displayName: 'Synthetic Connected Birder',
              evidence: 'account-menu-aria-label' }
          } });
        } else if (!state.hold) pages.get(options.id).window.eval(options.code);
        return Promise.resolve();
      },
      clearAllBrowsingData() { state.clears++; state.signedIn = false; return Promise.resolve(); },
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
      await waitFor(() => app.$('setupSheetBody').dataset.setupStep === 'key'
        && A.getDisplayName() === 'Synthetic Connected Birder', 'account connection finishes');
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(bridge.opened.map(open => open.url),
        ['https://ebird.org/profile', 'https://ebird.org/api/keygen'],
        'one Connect action must start the key capture without a second click');
      await waitFor(() => release, 'one account action automatically captures and validates the key');
      assert.equal(bridge.signedIn, true);
      assert.equal(validations, 1);
      assert.equal(bridge.clears, clears, 'key acquisition signed out the preceding website login');
      assert.deepEqual(bridge.opened.map(open => open.url),
        ['https://ebird.org/profile', 'https://ebird.org/api/keygen']);
      assert.ok(bridge.opened.every(open => open.persistWebViewData === true));
      assert.equal(app.window.localStorage.getItem('ebird_api_key'), null, 'candidate saved before verification');
      assert.equal(A.getDisplayName(), 'Synthetic Connected Birder');
      release({ code: 'US-WA' });
      await waitFor(() => app.$('setupSheetBody').dataset.setupStep === 'home', 'verified capture advances to required Home');
      assert.equal(app.window.localStorage.getItem('ebird_api_key'), key);
      assert.equal(app.window.localStorage.getItem(A.bcReal('bc_api_verified_v1:')), key);
      assert.equal(bridge.closed.length, 2);
      assert.ok(!JSON.stringify(app.window.__dbg.buf).includes(key), 'a captured key reached diagnostics');
      assert.deepEqual(app.state.errors, []);
    } finally { if (release) release({ code: 'US-WA' }); bridge.destroy(); app.window.close(); }
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
        assert.equal(help.open, true, 'first-time applicants must see the guidance in the owned eBird window');
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
};
