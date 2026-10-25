'use strict';

module.exports = ({
  test, assert, boot, waitFor, seedSeen, FIRST_YEAR_HTML, megaAlertHtml, recentObsStamp, preparedKeyNative
}) => {
  const complete = {
    observations: 'ok', mega: 'ok', leaderboard: 'ok', hotspots: 'ok',
    birdcast: 'ok', favorites: 'ok', mass: 'ok', ppte: 'ok', foy: 'ok'
  };

  test('F1094 compact category warnings retain independent retries and explicit source outcomes', async () => {
    const app = await boot({ sample: false });
    try {
      app.window.__app.renderSurge([], [], [], [], [], {
        ...complete, mass: 'partial', mega: 'failed', pendingSources: {}
      });
      const root = app.$('surgeResults');
      for (const kind of ['mass', 'mega']) {
        const tag = root.querySelector(`[data-count-kind="${kind}"]`);
        assert.doesNotMatch(tag.textContent, /source failed|loaded with limited coverage|incomplete/i);
        assert.match(tag.textContent, /[⚠△]/);
        const retry = tag.closest('.surgecategory').querySelector('[data-source-retry]');
        assert.ok(retry && retry !== tag);
        assert.equal(retry.dataset.sourceRetry, kind);
      }
      assert.match(root.querySelector('.surgesources').textContent, /Mass flock feeds: Partially loaded/);
      assert.match(root.querySelector('.surgesources').textContent, /Mega[^:]*: Failed/i);
    } finally { app.window.close(); }
  });

  test('F1096 setup feedback describes its initiating control through native pending and error', async () => {
    const app = await boot({ sample: false, home: false, storage: { bc_setup_step_v1: 'home' } });
    let rejectPosition;
    app.window.Capacitor = { Plugins: { Geolocation: {
      requestPermissions() { return Promise.resolve({ location: 'granted' }); },
      getCurrentPosition() { return new Promise((resolve, reject) => { rejectPosition = reject; }); }
    } } };
    try {
      app.window.__app.openSetupSheet();
      const button = app.$('setupHomeHere');
      app.click(button);
      await waitFor(() => rejectPosition, 'native location acquisition started');
      const status = app.$('setupActionStatus');
      assert.equal(status.getAttribute('role'), 'status');
      assert.equal(button.nextElementSibling, status, 'live feedback must remain beside its initiating control');
      assert.ok((button.getAttribute('aria-describedby') || '').split(/\s+/).includes(status.id));
      assert.ok(status.textContent.trim());
      assert.equal(button.disabled, true);
      assert.equal(app.window.__app.getHome(), null);
      rejectPosition({ code: 1, message: 'Synthetic permission denied' });
      await waitFor(() => !button.disabled, 'native failure restores its control');
      assert.match(status.textContent, /denied|permission|location/i);
      assert.equal(app.window.__app.getHome(), null);
    } finally {
      if (rejectPosition) rejectPosition({ code: 1, message: 'Synthetic cleanup' });
      app.window.close();
    }
  });

  test('F1096 setup feedback retains successful native candidates and local approval errors without saving Home', async () => {
    const app = await boot({ sample: false, home: false,
      storage: { bc_setup_step_v1: 'home' }, fetch: () => [] });
    app.window.Capacitor = { Plugins: { Geolocation: {
      requestPermissions() { return Promise.resolve({ location: 'granted' }); },
      getCurrentPosition() {
        return Promise.resolve({ coords: { latitude: 47.6, longitude: -122.3 } });
      }
    } } };
    try {
      app.window.__app.openSetupSheet();
      app.click(app.$('setupHomeHere'));
      await waitFor(() => app.$('setupHomeApprove'), 'unapproved native candidate');
      assert.equal(app.$('setupHomeCandidate').hidden, false);
      assert.equal(app.$('setupHomeHere').nextElementSibling, app.$('setupActionStatus'));
      assert.equal(app.window.__app.getHome(), null);
      app.click(app.$('setupHomeApprove'));
      await waitFor(() => /Retry the region lookup/.test(app.$('setupActionStatus').textContent),
        'failed region lookup retains the approved draft');
      assert.equal(app.$('setupHomeApprove').nextElementSibling, app.$('setupActionStatus'));
      assert.equal(app.window.__app.getHome(), null);
    } finally { app.window.close(); }
  });

  test('F1095 rejected Mega ownership reports only bounded counts and flags while retaining its snapshot', async () => {
    const row = { code: 'litsti', name: 'Little Stint', subId: 'S1095001',
      when: recentObsStamp(), lat: 47.75, lng: -122.16, place: 'Synthetic public estuary' };
    const correct = megaAlertHtml([row]);
    let body = correct;
    const app = await boot({ sample: false, fetch: url => /alert\/summary/.test(url) ? body : [] });
    try {
      const A = app.window.__app;
      await A.loadAbaAlert();
      const snapshot = app.window.localStorage.getItem(A.MEGA_SNAP_KEY);
      assert.ok(snapshot);
      const canonical = '<link rel="canonical" href="https://ebird.org/alert/summary?sid=SN10489">';
      const cases = [
        ['missing', correct.replace(canonical, ''), 0],
        ['duplicate', correct.replace(canonical, canonical + canonical), 2],
        ['wrong-selection', correct.replace('sid=SN10489', 'sid=PRIVATE_MEGA_SELECTION_F1095'), 1],
        ['duplicate-selection', correct.replace('sid=SN10489', 'sid=SN10489&sid=PRIVATE_MEGA_SELECTION_F1095'), 1],
        ['wrong-origin', correct.replace('https://ebird.org/alert/summary', 'https://PRIVATE_ORIGIN_F1095.example/alert/summary'), 1]
      ];
      function strings(value) {
        if (typeof value === 'string') return [value];
        return value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
      }
      for (const [name, html, canonicalCount] of cases) {
        body = html;
        app.window.__dbg.buf.length = 0;
        await A.loadAbaAlert();
        assert.equal(app.window.localStorage.getItem(A.MEGA_SNAP_KEY), snapshot, name);
        assert.match(app.$('abaStatus').textContent, /failed/i, name);
        const prefix = 'Mega source selection: ';
        const diagnostics = strings(app.window.__dbg.buf).filter(text => text.startsWith(prefix));
        assert.equal(diagnostics.length, 1, name);
        const detail = JSON.parse(diagnostics[0].slice(prefix.length));
        assert.equal(detail.canonicalCount, canonicalCount, name);
        for (const field of ['originMatches', 'pathMatches', 'selectionMatches']) {
          assert.equal(typeof detail[field], 'boolean', name + ': ' + field);
        }
        assert.ok(Number.isInteger(detail.selectionParameterCount));
        assert.ok(Object.values(detail).every(value => typeof value === 'boolean'
          || Number.isInteger(value) && value >= 0 && value <= 100000));
        assert.doesNotMatch(diagnostics[0], /PRIVATE_|https?:|SN10489|Little Stint|S1095001/);
      }
    } finally { app.window.close(); }
  });

  test('F1098 direct annual rejection diagnostics classify failures without private page contents', async () => {
    const cases = [
      ['no-recognized-table', '<title>PRIVATE_TITLE_F1098</title><p>PRIVATE_PAGE_F1098</p>'],
      ['row-count-mismatch', FIRST_YEAR_HTML.replace('Native and Naturalized (4)', 'Native and Naturalized (999)')],
      ['invalid-membership', FIRST_YEAR_HTML.replace(
        '<span class="Species-common">Common Nighthawk</span>', '<span class="Species-common"></span>')]
    ];
    for (const [classification, html] of cases) {
      const app = await boot({ sample: false, fetch: url => /\/bird-list\?/.test(url) ? html : [] });
      try {
        await assert.rejects(app.window.__app.firstYearFetch('US-WA', () => true, null, false));
        const log = JSON.stringify(app.window.__dbg.buf);
        assert.ok(log.includes(classification), classification);
        assert.ok(log.includes('parsedRows'));
        assert.doesNotMatch(log, /PRIVATE_TITLE_F1098|PRIVATE_PAGE_F1098|Common Nighthawk|Terek Sandpiper/);
      } finally { app.window.close(); }
    }
  });

  test('F1099 supported region recommendation offers explicit acceptance without approving Home', async () => {
    const app = await boot({ report: null, home: false, sample: false, storage: {
      bc_profile_region_recommendation_v1: JSON.stringify({
        status: 'supported', code: 'US-WA', parentCode: 'US-WA', source: 'device-location',
        resolved: { status: 'ok', code: 'US-WA', label: 'Washington', lat: 47.6, lng: -122.3 }
      }),
      'ebird_home_lat:or': '45.5', 'ebird_home_lng:or': '-122.6'
    } });
    try {
      const A = app.window.__app;
      assert.equal(A.getReportSlug(), '');
      assert.equal(A.getHome(), null);
      const accept = [...app.document.querySelectorAll('button')]
        .find(button => /^Use Washington$/.test(button.textContent.trim()));
      assert.ok(accept);
      assert.ok(app.$('regionChooseBtn'));
      assert.ok(app.$('regionFindBtn'));
      app.click(accept);
      await waitFor(() => A.getReportSlug() === 'wa', 'explicit Washington acceptance');
      assert.equal(A.getHome(), null);
      assert.equal(app.window.localStorage.getItem('ebird_home_lat:or'), '45.5');
      assert.equal(app.window.localStorage.getItem('ebird_home_lng:or'), '-122.6');
    } finally { app.window.close(); }
  });

  test('F1095 F1098 native rejection diagnostics allow only bounded aggregate fields and deduplicate', async () => {
    for (const kind of ['aba', 'firstYear']) {
      const app = await boot({ sample: false }), W = app.window, handlers = {};
      W.Capacitor = { Plugins: { CapgoInAppBrowser: {
        addListener(name, fn) { handlers[name] = fn; return { remove() {} }; },
        openWebView() { return Promise.resolve({ id: 'diagnostic-owned' }); },
        executeScript() { return Promise.resolve(); },
        close() { return Promise.resolve(); }, hide() {}, show() {}
      } } };
      try {
        const pending = W.__app.captureEbird({
          kind, url: kind === 'aba' ? 'https://ebird.org/alert/summary?sid=SN10489'
            : 'https://ebird.org/region/US-WA/bird-list',
          buildInject: () => '', revealAfterDelay: false, timeout: 5000
        });
        await waitFor(() => W.__dbg.buf.some(row => /open result.*window id received/.test(row.msg)),
          'owned native diagnostic window');
        const detail = { __ebird: true, kind, ok: false, parseStatus: 'wrong-source',
          pageShape: {
            canonicalCount: 1, originMatches: true, pathMatches: true, selectionMatches: false,
            selectionParameterCount: 1, accepted: false, rows: 3, declared: 3,
            title: 'PRIVATE_NATIVE_TITLE', path: 'PRIVATE_NATIVE_PATH', identity: 'PRIVATE_NATIVE_ID',
            htmlChars: Infinity, birdItems: -1, arbitrary: 'PRIVATE_NATIVE_EXTRA',
            validation: { parsedRows: 3, membershipComplete: false, secret: 'PRIVATE_VALIDATION' }
          } };
        for (let sample = 0; sample < 2; sample++) {
          handlers.messageFromWebview({ id: 'diagnostic-owned', detail });
        }
        if (kind === 'aba') {
          handlers.messageFromWebview({ id: 'diagnostic-owned', detail: { ...detail, terminal: true } });
          await assert.rejects(pending, /different eBird alert selection/);
        } else {
          handlers.messageFromWebview({ id: 'diagnostic-owned',
            detail: { __ebird: true, kind, ok: true, data: [] } });
          await pending;
        }
        const diagnostics = W.__dbg.buf.map(row => row.msg)
          .filter(msg => /Mega source selection:|annual-first parser/.test(msg));
        assert.equal(diagnostics.length, 1, kind);
        const payload = JSON.parse(diagnostics[0].slice(diagnostics[0].indexOf('{')));
        assert.equal(payload.canonicalCount, 1);
        assert.equal(payload.rows, 3);
        assert.ok(Object.values(payload).every(value => typeof value === 'boolean'
          || Number.isInteger(value) && value >= 0 && value <= 100000));
        assert.doesNotMatch(JSON.stringify(W.__dbg.buf), /PRIVATE_/);
      } finally { W.close(); }
    }
  });

  test('F1099 stale region acceptance cannot select another recommendation or account', async () => {
    for (const change of ['recommendation', 'profile']) {
      const app = await boot({ report: null, home: false, sample: false, storage: {
        bc_profile_region_recommendation_v1: JSON.stringify({
          status: 'supported', code: 'US-WA', source: 'device-location',
          resolved: { status: 'ok', code: 'US-WA', label: 'Washington', lat: 47.6, lng: -122.3 }
        })
      } });
      try {
        const A = app.window.__app, button = app.$('regionAcceptBtn');
        assert.ok(button);
        if (change === 'recommendation') {
          app.window.localStorage.setItem('bc_profile_region_recommendation_v1',
            JSON.stringify({ status: 'unsupported', code: 'PRIVATE_CHANGED_REGION' }));
        } else app.window.localStorage.setItem(A.BC_PROFILE_PTR, 'Synthetic different profile');
        app.click(button);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(A.getReportSlug(), '', change);
        assert.equal(A.getHome(), null, change);
      } finally { app.window.close(); }
    }
  });

  test('F1100 first-access guidance is collapsed while native close and independent reopen remain usable', async () => {
    const markup = '<h1>Request API Access</h1><form>'
      + '<input type="checkbox" name="acceptTermsOfUse">'
      + '<textarea name="description">PRIVATE_DESCRIPTION_F1100</textarea>'
      + '<input type="submit" value="Submit Request"></form>';
    const app = await boot({ sample: false, key: null, storage: { bc_setup_step_v1: 'key' } });
    const bridge = preparedKeyNative(app, markup);
    let submissions = 0, fieldReads = 0;
    const originals = [];
    bridge.onPage = window => {
      const form = window.document.querySelector('form');
      if (!form) return;
      originals.push(form.outerHTML);
      form.submit = form.requestSubmit = () => { submissions++; };
      form.addEventListener('submit', event => { event.preventDefault(); submissions++; });
      form.querySelectorAll('input,textarea').forEach(field => {
        Object.defineProperty(field, 'value', { get() { fieldReads++; return 'PRIVATE_FIELD_F1100'; } });
      });
    };
    try {
      app.window.__app.openSetupSheet();
      for (let cycle = 0; cycle < 2; cycle++) {
        const get = app.$('setupGetKey');
        assert.equal(get.disabled, false);
        app.click(get);
        await waitFor(() => bridge.opened.length === cycle + 1
          && bridge.page(bridge.opened[cycle].id).document.querySelector('[data-birdchaser-api-help]'),
        'recognized first-access form and separate guidance');
        const id = bridge.opened[cycle].id, page = bridge.page(id);
        const help = page.document.querySelector('[data-birdchaser-api-help]');
        assert.equal(help.open, false);
        assert.equal(help.closest('form'), null);
        assert.equal(page.document.querySelector('form').outerHTML, originals[cycle]);
        assert.equal(page.document.querySelector('[name="acceptTermsOfUse"]').checked, false);
        const status = app.$('setupActionStatus');
        assert.match(status.textContent, /complete eBird.*form yourself/);
        assert.equal(get.nextElementSibling, status);
        assert.ok((get.getAttribute('aria-describedby') || '').split(/\s+/).includes(status.id));
        assert.equal(get.disabled, true);
        assert.equal(app.window.localStorage.getItem('ebird_api_key'), null);
        bridge.emit('closeEvent', { id });
        await waitFor(() => !app.$('setupGetKey').disabled, 'Get restored after native close');
      }
      assert.equal(submissions, 0);
      assert.equal(fieldReads, 0);
      assert.doesNotMatch(JSON.stringify(app.window.__dbg.buf), /PRIVATE_DESCRIPTION_F1100|PRIVATE_FIELD_F1100/);
    } finally { bridge.destroy(); app.window.close(); }
  });

  test('F1101 only genuinely pending sources retain the visual loading track', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app, root = app.$('surgeResults');
      for (const state of ['ok', 'partial', 'failed', 'stale', 'notLoaded', 'notApplicable']) {
        A.renderSurge([], [], [], [], [], { ...complete, mass: state, pendingSources: {} });
        assert.equal(root.querySelector('.surgesourcemeter .track'), null, state);
        assert.equal(root.querySelector('.surgesourcemeter [role="progressbar"]'), null);
        assert.equal(root.querySelector('.surgesourcemeter').getAttribute('role'), 'status');
        assert.match(root.querySelector('.surgesourcemeter').textContent, /finished|failed|cancelled/i);
        if (state === 'failed') assert.match(root.querySelector('.surgesources').textContent, /Failed/);
      }
      A.renderSurge([], [], [], [], [], {
        ...complete, mass: 'loading', pendingSources: { mass: true }
      });
      assert.ok(root.querySelector('.surgesourcemeter .track'));
      assert.equal(root.querySelector('.surgesourcemeter').getAttribute('role'), 'progressbar');
      assert.match(root.querySelector('[data-count-kind="mass"]').textContent, /⌛/);
    } finally { app.window.close(); }
  });

  test('F1101 cancelling a live acquisition settles its bar immediately before obsolete callbacks', async () => {
    for (const cancel of ['reader', 'navigation']) {
      const held = [];
      const app = await boot({ sample: false, fetch: () => new Promise(resolve => held.push(resolve)) });
      try {
        const A = app.window.__app;
        A.showSection('sec-surgeBtn', { load: false });
        Promise.resolve(A.loadSurge()).catch(() => {});
        const root = app.$('surgeResults');
        await waitFor(() => root.querySelector('.surgesourcemeter .track'), 'owned active Bird Gen meter');
        if (cancel === 'reader') A.cancelStalledWork();
        else A.showMenu();
        assert.equal(root.querySelector('.surgesourcemeter .track'), null, cancel);
        assert.match(root.querySelector('.surgesourcemeter').textContent, /cancelled/i);
        held.splice(0).forEach(resolve => resolve([]));
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(root.querySelector('.surgesourcemeter .track'), null, 'obsolete callback');
        A.showSection('sec-surgeBtn', { load: false });
        const retry = root.querySelector('[data-source-retry]');
        assert.ok(retry, 'cancelled source retains an explicit retry');
        app.click(retry);
        await waitFor(() => root.querySelector('.surgesourcemeter .track'), 'new owned acquisition after retry');
        A.cancelStalledWork();
        assert.equal(root.querySelector('.surgesourcemeter .track'), null);
      } finally {
        held.splice(0).forEach(resolve => resolve([]));
        app.window.close();
      }
    }
  });

  function annualBirds(date, prefix, count = 26) {
    return Array.from({ length: count }, (_, i) => ({
      code: prefix + String(i).padStart(2, '0'), name: 'Annual Bird ' + String(i).padStart(2, '0'),
      date, observedAt: date + ' 08:00', previousReadDate: date
    }));
  }

  test('F1102 all 26 same-day annual firsts survive admission and merged alert evidence', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app, firsts = annualBirds(A.todayStr(), 'annualbird');
      const rows = [{
        kind: 'mega', code: firsts[0].code, speciesKey: firsts[0].code,
        time: 1, why: 'Existing synthetic mega evidence', name: firsts[0].name
      }];
      A.appendFoySurgeReasons(rows, firsts);
      const html = rows.map((row, i) => A.surgeAlertCard(row, i)).join('');
      for (const first of firsts) assert.ok(html.includes(first.name), first.code);
      assert.equal(rows[0].reasons.filter(reason => reason.kind === 'foy').length, 1);
    } finally { app.window.close(); }
  });

  test('F1102 actual feed counts all FOY members, groups one day and filters merged reasons', async () => {
    let alertHtml;
    const app = await boot({ sample: false, fetch: url => /alert\/summary/.test(url) ? alertHtml : [] });
    try {
      const A = app.window.__app, firsts = annualBirds(A.todayStr(), 'groupbird');
      await seedSeen(app, [], null, firsts);
      alertHtml = megaAlertHtml([{
        ...firsts[0], subId: 'S1102001', when: recentObsStamp(0),
        lat: 47.75, lng: -122.16, place: 'Synthetic public estuary'
      }]);
      await A.loadAbaAlert();
      A.renderSurge([], [], [], [], [], {
        ...complete, pendingSources: {}, foyRows: firsts, deferPhotos: true, suppressNotifications: true
      });
      const root = app.$('surgeResults'), filter = root.querySelector('[data-count-kind="foy"]');
      assert.match(filter.textContent, /\b26 FOY\b/);
      const groups = [...root.querySelectorAll('#surgeFeed > [data-alert-kind="foy"]')];
      assert.equal(groups.length, 1);
      assert.equal(groups[0].querySelector('[data-birdgen-total]').dataset.birdgenTotal, '25');
      assert.match(groups[0].querySelector('.surgealerttitle').textContent, /\+23\b/);
      app.click(filter);
      const visible = [...root.querySelector('#surgeFeed').children].filter(row => !row.hidden);
      assert.equal(visible.length, 2);
      const mega = visible.find(row => row.dataset.alertKind === 'mega');
      assert.ok(mega && mega.dataset.surgeReasons.split(',').includes('foy'));
      app.click(groups[0].querySelector('[data-surge-details]'));
      for (const first of firsts.slice(1)) assert.ok(app.$('appSheet').textContent.includes(first.name), first.code);
      assert.match(app.$('appSheet').textContent, /not.*current presence|not proof of current presence/i);
    } finally { app.window.close(); }
  });

  function setToday(app, iso) {
    const NativeDate = app.window.Date, instant = NativeDate.parse(iso);
    app.window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [instant])); }
      static now() { return instant; }
    };
  }

  test('F1102 January 1 keeps every current-year member without last-year or unknown dates', async () => {
    const app = await boot({ sample: false });
    try {
      setToday(app, '2027-01-01T12:00:00Z');
      const A = app.window.__app;
      assert.equal(A.todayStr(), '2027-01-01');
      const members = annualBirds('2027-01-01', 'januarybird'), rows = [];
      A.appendFoySurgeReasons(rows, members.concat([
        { code: 'previousyear', name: 'Previous Year Excluded', date: '2026-12-31' },
        { code: 'unknowndate', name: 'Unknown Date Excluded', date: '' }
      ]));
      const html = rows.map((row, i) => A.surgeAlertCard(row, i)).join('');
      for (const member of members) assert.ok(html.includes(member.name), member.code);
      assert.doesNotMatch(html, /Previous Year Excluded|Unknown Date Excluded/);
    } finally { app.window.close(); }
  });

  test('F1102 groups by observation date and preserves distinct same-name identities', async () => {
    const app = await boot({ sample: false });
    try {
      setToday(app, '2027-01-02T12:00:00Z');
      const A = app.window.__app, today = A.todayStr(), day = '2027-01-01';
      assert.equal(today, '2027-01-02');
      const members = [
        { code: 'dategroupa', name: 'Shared Common Name', date: today },
        { code: 'dategroupb', name: 'Shared Common Name', date: today },
        { code: 'dategroupc', name: 'Other Annual Bird C', date: day },
        { code: 'dategroupd', name: 'Other Annual Bird D', date: day }
      ].map(member => ({
        ...member, observedAt: member.date + ' 08:00', previousReadDate: day,
        learnedAt: new app.window.Date().toISOString()
      }));
      A.renderSurge([], [], [], [], [], {
        ...complete, pendingSources: {}, foyRows: members.concat(members[0]),
        deferPhotos: true, suppressNotifications: true
      });
      const root = app.$('surgeResults');
      assert.match(root.querySelector('[data-count-kind="foy"]').textContent, /\b4 FOY\b/);
      const groups = [...root.querySelectorAll('#surgeFeed > [data-alert-kind="foy"]')];
      assert.deepEqual(groups.map(group => group.dataset.foyDate).sort(), [day, today].sort());
      for (const group of groups) {
        assert.equal(group.querySelector('[data-birdgen-total]').dataset.birdgenTotal, '2');
        app.click(group.querySelector('[data-surge-details]'));
        const codes = [...app.$('appSheet').querySelectorAll('.splink[data-sp]')].map(link => link.dataset.sp);
        for (const member of members.filter(member => member.date === group.dataset.foyDate)) {
          assert.ok(codes.includes(member.code), member.code);
        }
        app.click(app.$('appSheet').querySelector('.sheetclose'));
      }
    } finally { app.window.close(); }
  });
};
