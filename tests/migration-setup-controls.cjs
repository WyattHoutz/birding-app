'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function registerMigrationSetupControls({
  test, assert, boot, seedSeen, fixtureIsoWeek, sampleDateForWeek, foySourceFixture,
  formatObsStamp, IDBFactory, waitFor, HTML, f821Page, f821Hotspots, otherStateMegaAlertHtml
}) {
  test('F1072 prepared real-app shared thumbnails preserve the full count and adaptive photo geometry', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app;
      for (let count = 0; count <= 7; count++) {
        const species = Array.from({ length: count }, (_, index) => ({
          code: 'testbird' + index, name: 'Test bird ' + index
        }));
        const root = app.document.createElement('div');
        root.innerHTML = A.birdGenBirdThumbnail(species);
        if (!count) { assert.equal(root.innerHTML, ''); continue; }
        const tile = root.firstElementChild;
        assert.equal(Number(tile.dataset.birdgenTotal), count);
        assert.match(tile.getAttribute('aria-label'), new RegExp(count + ' species'));
        const slots = tile.matches('[data-bird]') ? [tile] : tile.querySelectorAll('.thumb[data-bird]');
        assert.equal(slots.length, count === 4 ? 4 : Math.min(count, 2));
        assert.equal(!!tile.querySelector('.surgepatchgrid'), count === 4);
        const badge = tile.querySelector('.ppte-extra-birds');
        assert.equal(badge ? badge.textContent : '', count === 3 || count > 4 ? String(count) : '');
        assert.equal(A.birdGenBirdThumbnail(species.concat(species)), root.innerHTML);
      }
    } finally { app.window.close(); }
  });

  test('F1069 F1071 prepared real-app migration groups every current bird and orders Now before nearest Upcoming', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app, now = new Date(), ctx = A.firstYearContext();
      const taxa = [
        { code: 'oldmig', name: 'Past Migrant', sci: 'Past migrans' },
        { code: 'newmig', name: 'New Migrant', sci: 'New migrans' },
        { code: 'currmig', name: 'Current Migrant', sci: 'Current migrans' },
        { code: 'overmig', name: 'Overdue Migrant', sci: 'Overdue migrans' },
        { code: 'nextmig', name: 'Next Migrant', sci: 'Next migrans' },
        { code: 'depmig', name: 'Z Departing Migrant', sci: 'Departing migrans' }
      ];
      await seedSeen(app, ['depmig'], null, taxa);
      app.window.localStorage.setItem(A.speciesCacheKey(A.getObsRegion()),
        JSON.stringify({ at: Date.now(), expected: taxa.length, rows: taxa }));
      const day = offset => {
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      };
      const page = A.parseFirstYearBirdList(foySourceFixture(1));
      page.rows = [
        { code: 'oldmig', name: 'Past Migrant', date: day(-11), observedAt: day(-11) + ' 08:00' },
        { code: 'newmig', name: 'New Migrant', date: day(0), observedAt: day(0) + ' 08:00',
          locId: 'L91001', locName: 'Public current patch', subId: 'S91001', isPrivate: false }
      ];
      A.firstYearWrite(ctx.region, ctx.year, page);
      const store = { at: Date.now(), done: {
        'Current migrans': { day: day(0).slice(5), records: 100 },
        'Overdue migrans': { day: day(-3).slice(5), records: 100 },
        'Next migrans': { day: day(5).slice(5), records: 100 }
      } };
      app.window.localStorage.setItem(A.dueBackKey('US-WA', 'Washington'), JSON.stringify(store));
      const samples = {};
      for (let ago = 0; ago <= 6; ago++) {
        const week = ((fixtureIsoWeek(now) - ago - 1 + 53) % 53) + 1;
        samples['wa|' + sampleDateForWeek(now.getFullYear() - 1, week)] = ['depmig'];
      }
      const cache = { samples, names: { depmig: 'Z Departing Migrant' }, updated: now.toISOString() };
      A.migSave(cache);
      const before = app.state.fetches.length;
      const rows = A.migrationUnifiedRows(null, now, { arrivals: true, departures: true, tonight: true });
      assert.ok(rows.some(row => row.code === 'nextmig'));
      assert.ok(rows.some(row => row.code === 'depmig'));
      assert.equal(rows.some(row => row.code === 'oldmig'), false);
      const offsets = Array.from(rows, row => Math.max(0, row.primary.days));
      assert.deepEqual(offsets, offsets.slice().sort((a, b) => a - b));
      const news = A.migrationSignificantRows(now, null);
      assert.equal(news.length, 1);
      assert.equal(news[0].data['migration-group-count'], 4);
      const thumbnail = app.document.createElement('div');
      thumbnail.innerHTML = news[0].icon;
      assert.ok(thumbnail.querySelector('[data-birdgen-total="4"]'),
        'Migration must use the shared renderer with the full qualifying membership');
      assert.equal(thumbnail.querySelectorAll('.thumb[data-bird]').length, 4);
      assert.match(news[0].name, /migrating now\./, 'departure outside the first two names must control the full-group verb');
      assert.match(news[0].name, /2 more/);
      assert.match(news[0].extra, /Public current patch/);
      assert.match(news[0].extra, /S91001/);
      assert.doesNotMatch(news[0].extra, /Past Migrant|Next Migrant/);
      assert.match(news[0].ageLabel, /Expected.*Observed/);
      const migration = app.document.createElement('div');
      migration.innerHTML = A.birdcastMigrantsHtml(null, now);
      assert.deepEqual([...migration.querySelectorAll('h4')].map(el => el.textContent), ['Now', 'Upcoming']);
      assert.equal(app.state.fetches.length, before, 'cached qualification and grouping add no requests');
      assert.equal(A.migrationSignificantRows(new Date(now.getTime() + 60000), null)[0].notificationKey,
        news[0].notificationKey, 'repainting the same group cannot re-announce it');
      A.migSave({ samples: {}, names: {}, updated: now.toISOString() });
      assert.match(A.migrationSignificantRows(now, null)[0].name, /arriving now\./);
      A.firstYearWrite(ctx.region, ctx.year, { ...page, rows: [] });
      app.window.localStorage.setItem(A.dueBackKey('US-WA', 'Washington'), JSON.stringify({ at: Date.now(), done: {} }));
      A.migSave(cache);
      const departure = A.migrationSignificantRows(now, null);
      assert.equal(departure.length, 1);
      assert.match(departure[0].name, /departing now\./);
      assert.doesNotMatch(departure[0].name, /more| and /);
    } finally { app.window.close(); }
  });

  test('F1070 prepared real-app activity keeps Low genuine, estimates dated separately and midnight stable through DST', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app, now = new Date('2026-03-08T20:00:00Z');
      const snapshot = {
        sourceScope: 'wa', fetchedAt: now.getTime(),
        forecast: { date: '2026-03-08', level: 'Low' },
        count: { birds: 109900, night: '2026-03-07', countyLabel: 'King County' }
      };
      const row = A.birdcastSurgeRows(now, snapshot)[0];
      assert.ok(row);
      assert.match(row.name, /Low migration tonight/);
      assert.match(row.name, /109,900 birds \(est\.\)/);
      assert.match(row.name, /Latest measured night 3\/7-8/);
      assert.match(row.extra, /source night 2026-03-07.*separate from the forecast/);
      assert.equal(row.when, '2026-03-08T08:00:00.000Z', 'spring midnight precedes the DST transition');
      const refreshed = A.birdcastSurgeRows(new Date('2026-03-08T21:00:00Z'), {
        ...snapshot, fetchedAt: Date.parse('2026-03-08T21:00:00Z')
      })[0];
      assert.equal(refreshed.time, row.time);
      assert.equal(refreshed.notificationKey, row.notificationKey);
      const retained = A.birdcastSurgeRows(new Date('2026-03-09T20:00:00Z'), snapshot)[0];
      assert.equal(retained.time, row.time);
      assert.match(retained.name, /Saved Low forecast/);
      assert.doesNotMatch(retained.name, /Low migration tonight/);
      for (const extra of [{ forecast: null }, { sourceScope: 'mo' }, {
        forecast: { date: '2026-03-08', level: 'Loading' }
      }]) assert.equal(A.birdcastSurgeRows(now, { ...snapshot, ...extra }).length, 0);
      const failed = A.birdcastSurgeRows(now, { ...snapshot, forecastError: 'Unavailable' })[0];
      assert.match(failed.name, /Saved Low forecast/);
      assert.doesNotMatch(failed.name, /Low migration tonight/);
      assert.match(A.birdcastSurgeRows(now, { ...snapshot, count: null })[0].name, /count unavailable/);
      assert.doesNotMatch(A.birdcastSurgeRows(now, { ...snapshot, count: null })[0].name, /0 birds/);
      const fall = new Date('2026-11-01T20:00:00Z');
      for (const level of ['Low', 'Medium', 'High']) {
        const next = A.birdcastSurgeRows(fall, { ...snapshot, count: null,
          fetchedAt: fall.getTime(), forecast: { date: '2026-11-01', level }
        })[0];
        assert.equal(next.when, '2026-11-01T07:00:00.000Z', 'fall midnight precedes the DST transition');
        assert.match(next.name, new RegExp(level + ' migration tonight'));
      }
    } finally { app.window.close(); }
  });

  test('F1074 prepared Recent checklists uses the shared three-way multipill and retains each sort action', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app;
      const rows = [
        { subId: 'S1074near', isoObsDate: '2026-09-18 08:00', numSpecies: 30,
          locId: 'L1074near', loc: { name: 'Near Park', latitude: 47.751, longitude: -122.16 } },
        { subId: 'S1074recent', isoObsDate: '2026-09-18 10:00', numSpecies: 10,
          locId: 'L1074recent', loc: { name: 'No Coordinates' } },
        { subId: 'S1074many', isoObsDate: '2026-09-18 09:00', numSpecies: 50,
          locId: 'L1074many', loc: { name: 'Far Park', latitude: 49.50, longitude: -122.30 } }
      ];
      A.renderRecentChecklistBatch(rows, 1, 1);
      const pick = app.$('recentSortPick');
      assert.ok(pick.classList.contains('multipill'), 'sort sizing diverged from established multipills');
      assert.deepEqual([...pick.querySelectorAll('button')].map(button => button.textContent.trim()),
        ['Distance', 'Recent', 'Species count']);
      for (const [sort, expected] of [
        ['distance', ['S1074near', 'S1074many', 'S1074recent']],
        ['recent', ['S1074recent', 'S1074many', 'S1074near']],
        ['species', ['S1074many', 'S1074near', 'S1074recent']]
      ]) {
        app.click(app.document.querySelector('#recentSortPick [data-sort="' + sort + '"]'));
        assert.deepEqual([...app.$('recentResults').querySelectorAll('[data-recent-sub]')]
          .map(node => node.dataset.recentSub), expected);
        assert.equal(app.document.querySelector('#recentSortPick [aria-pressed="true"]').dataset.sort, sort);
      }
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1075 prepared fresh Watch ignores bundled defaults while saved data stays profile-owned', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app, storage = app.window.localStorage;
      app.window.__SEED_BIRDLIST__.watchlist = [{ code: 'leak', name: 'Bundled personal bird' }];
      storage.removeItem(A.bcReal('ebird_watchlist_v1'));
      assert.equal(A.getWatchlist().length, 0);
      A.setWatchlist([{ code: 'amerob', name: 'American Robin' }]);
      const saved = storage.getItem(A.bcReal('ebird_watchlist_v1'));
      assert.equal(A.getWatchlist()[0].code, 'amerob');
      A.bcSetProfile('synthetic-other');
      assert.equal(A.getWatchlist().length, 0);
      A.setWatchlist([]);
      assert.equal(A.getWatchlist().length, 0);
      A.bcSetProfile('');
      assert.equal(storage.getItem(A.bcReal('ebird_watchlist_v1')), saved);
      assert.equal(A.getWatchlist()[0].code, 'amerob');
      storage.setItem(A.bcReal('ebird_watchlist_v1'), '{broken');
      assert.equal(A.getWatchlist().length, 0);
      assert.equal(storage.getItem(A.bcReal('ebird_watchlist_v1')), '{broken');
      assert.ok(app.window.__dbg.buf.some(row => /Watch list could not be read/.test(row.msg)));
    } finally { app.window.close(); }
  });

  test('F1076 F1077 prepared Settings preserve explicit alert sources without inventing account or sample evidence', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app, storage = app.window.localStorage;
      assert.equal(app.$('loadSeedBtn'), null);
      assert.equal(A.loadSeed, undefined);
      assert.doesNotMatch(HTML, /function\s+(?:applySeed|loadSeed)\s*\(/);
      storage.removeItem(A.bcReal('ebird_aba_sid'));
      app.open(/Settings/);
      assert.ok(app.$('abaSid').value, 'the public ABA feed remains available without selecting an account');
      assert.equal(A.getDisplayName(), '');
      assert.equal(A.getIdentityMeta(), null);
      A.persistSettings();
      assert.equal(storage.getItem(A.bcReal('ebird_aba_sid')), null);
      storage.setItem(A.bcReal('ebird_aba_sid'), 'SN999001');
      A.showMenu();
      app.open(/Settings/);
      A.persistSettings();
      assert.equal(storage.getItem(A.bcReal('ebird_aba_sid')), 'SN999001');
      assert.equal(A.getSeenMeta(), null);
      assert.equal(A.reportYearList().length, 0);
    } finally { app.window.close(); }
  });

  function preparedSensitivePage(now = new Date()) {
    const month = now.toLocaleDateString('en-US', {
      month: 'short', year: 'numeric', timeZone: 'America/Los_Angeles'
    });
    return '<a class="StatsIcon"><span class="StatsIcon-label">This Month</span>'
      + '<span class="StatsIcon-secondary">' + month + '</span></a>'
      + '<div class="BirdList"><section class="BirdList-list">'
      + '<h3>Native and Naturalized (1)</h3><ol>'
      + '<li class="BirdList-list-list-item countable"><div class="Obs">'
      + '<div class="Obs-species"><a href="https://ebird.org/species/grgowl/US-WA">'
      + '<span class="Species-common">Great Gray Owl</span></a></div>'
      + '<div class="Obs-count"># Count: 1</div>'
      + '<button class="Sensitive-badge">Sensitive</button>'
      + '</div></li></ol></section></div>';
  }

  test('F1073 prepared pending Mass resume rejects invalid ownership, acquisition age and source month', async t => {
    for (const [label, stamp, cases] of [
      ['same month', '2026-10-15T12:00:00-07:00', [
        ['valid', {}, false],
        ['foreign owner', { sourceOwner: 'different-owner' }, true],
        ['foreign region', { sourceRegion: 'US-OR' }, true],
        ['incomplete acquisition', { includeProvisional: false }, true],
        ['failed base', { arrivalBaseState: 'failed' }, true],
        ['missing coverage', { arrivalBaseCoverage: '' }, true],
        ['missing acquisition time', { acquiredAt: null }, true],
        ['future acquisition', { age: -1 }, true],
        ['expired acquisition', { age: 30 * 60000 }, true]
      ]],
      ['month boundary', '2026-11-01T00:01:00-07:00', [
        ['fresh current month', { age: 60000 }, false],
        ['fresh prior month', { age: 120000 }, true]
      ]]
    ]) {
      await t.test(label, async () => {
        const now = Date.parse(stamp);
        const app = await boot({ sample: false, fetch: url =>
          /bird-list\?.*rank=hc/.test(url) ? preparedSensitivePage(new Date(now)) : [] });
        try {
          const A = app.window.__app, RealDate = app.window.Date;
          app.window.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : [now])); }
            static now() { return now; }
          };
          A.fgWindowReset();
          A.fgSchedReset(now);
          const base = await A.loadMassFlockAlertSource(false, A.activeScope());
          assert.notEqual(base.state, 'failed');
          const pages = () => app.state.fetches.filter(url => /bird-list\?.*rank=hc/.test(url)).length;
          for (const [name, changes, reacquire] of cases) {
            const { age = 1000, ...extra } = changes;
            const stage = { ...base, arrivalPending: true,
              arrivalBaseState: base.state, arrivalBaseCoverage: base.coverage,
              acquiredAt: now - age, retainedAt: now, ...extra };
            await A.saveSurgeRetainedPart('mass', stage);
            A.fgSchedReset(now);
            const before = pages();
            const result = await A.loadMassFlockAlertSource(false, A.activeScope());
            assert.equal(pages() - before, Number(reacquire), label + ': ' + name);
            assert.notEqual(result.state, 'failed', name);
            assert.equal(result.arrivalPending, false, name + ' was mistaken for complete history');
            assert.equal(result.acquiredAt, reacquire ? now : stage.acquiredAt, name);
            assert.equal(result.rows.length, 0, 'Sensitive evidence cannot become a located Mass flock');
          }
          assert.deepEqual(app.state.errors, []);
        } finally { app.window.close(); }
      });
    }
  });

  test('F1082 prepared real-app acquisition separates monthly Sensitive evidence from located Mass flocks', async () => {
    const app = await boot({ sample: false, fetch: url =>
      /bird-list\?.*rank=hc/.test(url) ? preparedSensitivePage() : [] });
    try {
      const A = app.window.__app, source = await A.loadMassFlockAlertSource(false, A.activeScope());
      assert.notEqual(source.state, 'failed');
      assert.equal(source.evidenceRows.length, 0);
      assert.equal(source.rows.length, 0);
      assert.equal(source.rowCoverage.accepted, 0);
      assert.equal(source.rowCoverage.rejected, 0);
      assert.equal(source.rowCoverage.total, 1);
      assert.equal(source.sensitiveRows.length, 1);
      assert.deepEqual(Object.keys(source.sensitiveRows[0]).sort(), ['code', 'count', 'name', 'region']);
      const first = A.birdGenSensitiveRows(source, new Date());
      assert.equal(first.length, 1, 'monthly information must appear on first success');
      assert.match(first[0].name, /reported in your region this month\./);
      assert.match(first[0].name, /https:\/\/ebird.org\/species\/grgowl\/US-WA/);
      assert.doesNotMatch(first[0].name, /splink|data-sp|stakeout|checklist/i);
      assert.equal(first[0].time, 0, 'source membership is not an observation timestamp');
      await A.saveSurgeRetainedPart('mass', source);
      const warm = await A.loadMassFlockAlertSource(false, A.activeScope());
      assert.equal(app.state.fetches.filter(url => /bird-list\?.*rank=hc/.test(url)).length, 1);
      const replay = A.birdGenSensitiveRows(warm, new Date())[0];
      assert.equal(replay.notificationKey, first[0].notificationKey);
      assert.equal(replay.data['source-acquired-at'], first[0].data['source-acquired-at']);
      A.renderSurge([], [], [], [], [], { massSource: warm });
      const card = app.document.querySelector('#surgeFeed [data-alert-kind="sensitive"]');
      assert.ok(card, 'actual feed must render the new category, not only a helper result');
      assert.match(card.textContent, /SENSITIVE/);
      assert.match(card.textContent, /reported in your region this month/);
      assert.equal(card.getAttribute('data-surge-latest'), '0');
      assert.equal(A.birdGenSensitiveRows({ ...source, sourceOwner: 'wrong-owner' }, new Date()).length, 0);
      assert.equal(A.birdGenSensitiveRows({ ...source, sourceRegion: 'US-OR' }, new Date()).length, 0);
      const nextMonth = new Date();
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 15);
      assert.equal(A.birdGenSensitiveRows(source, nextMonth).length, 0);
      const newMonth = nextMonth.getUTCFullYear() + '-' + String(nextMonth.getUTCMonth() + 1).padStart(2, '0');
      assert.equal(A.birdGenSensitiveRows({ ...source, sourceMonth: newMonth }, nextMonth).length, 0);
      assert.equal(A.birdGenSensitiveRows({
        ...source, sourceMonth: newMonth, acquiredAt: nextMonth.getTime()
      }, nextMonth).length, 1);
      const unknown = preparedSensitivePage().replace('<button class="Sensitive-badge">Sensitive</button>', '');
      assert.throws(() => A.parseMassHighCountPage(unknown, 'US-WA', true), /no usable observations/);
      assert.throws(() => A.parseMassHighCountPage(preparedSensitivePage(), 'US-OR', true), /Malformed/);
    } finally { app.window.close(); }
  });

  test('F1082 Sensitive species links retain the acquired county instead of the parent region', async () => {
    const app = await boot({ sample: false, fetch: url => /bird-list\?.*rank=hc/.test(url)
      ? preparedSensitivePage().replaceAll('US-WA', 'US-WA-033') : [] });
    try {
      const A = app.window.__app;
      A.setCountyView('US-WA-033');
      assert.equal(A.activeScope().effectiveRegion, 'US-WA-033');
      const source = await A.loadMassFlockAlertSource(false, A.activeScope());
      const cards = A.birdGenSensitiveRows(source, new Date());
      assert.equal(cards.length, 1);
      assert.match(cards[0].name, /https:\/\/ebird.org\/species\/grgowl\/US-WA-033/);
      assert.doesNotMatch(cards[0].name, /splink|data-sp|stakeout|checklist/i);
      assert.equal(source.evidenceRows.length, 0);
      assert.equal(app.state.fetches.filter(url => /bird-list\?.*rank=hc/.test(url)).length, 1);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1081 prepared ready seen evidence retires main onboarding without hiding later failures', async () => {
    for (const codes of [[], ['stable']]) {
      const app = await boot({ sample: false, indexedDB: new IDBFactory(), storage: {
        ebird_display_name: 'Sample Observer',
        ebird_seen_meta: JSON.stringify({ source: 'csv', count: 0, year: new Date().getFullYear() })
      } });
      try {
        const A = app.window.__app;
        A.applyCapturedIdentity({ status: 'ok', displayName: 'Sample Observer' });
        await seedSeen(app, codes, null, [{ code: 'stable', name: 'Stable bird' }]);
        A.renderKeyBanner();
        assert.equal(A.personalListEvidence().complete, true, 'exact fixture must be ready');
        assert.equal(app.$('keyBanner').hidden, true, 'healthy exact evidence retires main onboarding');
        const key = A.bcReal(A.personalListKey(A.personalListOwner()));
        const saved = app.window.localStorage.getItem(key);
        assert.ok(A.getHome(), 'seen dismissal requires an already configured Home');
        app.window.localStorage.setItem('bc_setup_step_v1', 'seen');
        A.openSetupSheet();
        assert.equal(app.$('setupSheetBody').dataset.setupStep, 'seen');
        assert.ok(app.$('setupSeenDismiss'));
        app.click(app.$('setupSeenDismiss'));
        assert.equal(app.$('setupSheet').hidden, true);
        assert.equal(app.window.localStorage.getItem(key), saved);
        assert.equal(A.personalListEvidence().complete, true);
        const original = app.window.fetch;
        app.window.fetch = (url, options) => /\/lifelist\//.test(url)
          ? Promise.resolve({ ok: false, status: 503 }) : original(url, options);
        await assert.rejects(A.ensurePersonalList(A.activeScope(), true), /503/);
        assert.equal(app.$('keyBanner').hidden, false);
        assert.match(app.$('keyBanner').textContent, /Using your saved seen list/);
        assert.equal(app.window.localStorage.getItem(key), saved);
      } finally { app.window.close(); }
    }
  });

  test('F1073 prepared actual Menu-to-Bird-Gen handoff resumes acquired evidence without repeating its page', async t => {
    let full = false, holdHistory = false;
    const held = [];
    const bird = { speciesCode: 'verfly', comName: 'Vermilion Flycatcher',
      obsDt: formatObsStamp(new Date(Date.now() - 600000)), locId: 'LF1073NEW',
      locName: 'Example public patch', lat: 47.75, lng: -122.16, subId: 'SF1073NEW',
      howMany: 1, obsReviewed: false, obsValid: true };
    const app = await boot({ sample: false, storage: { ebird_aba_sid: 'SN999001' }, fetch(url) {
      if (/bird-list/.test(url)) return f821Page([{ count: 4000 }]);
      if (/ref\/hotspot\//.test(url)) return f821Hotspots().map(row =>
        ({ ...row, lat: 46.7064, lng: -123.972 }));
      const history = /\/historic\/(\d+)\/(\d+)\/(\d+)/.exec(url);
      if (history) {
        const day = `${history[1]}-${history[2].padStart(2, '0')}-${history[3].padStart(2, '0')}`;
        const result = [{ locId: 'L821', speciesCode: 'snogoo', obsDt: day + ' 08:00', howMany: 1 }];
        if (holdHistory) return new Promise(resolve => { held.push(() => resolve(result)); });
        return result;
      }
      if (/data\/obs\//.test(url)) return full ? [bird] : [];
      if (/top100/.test(url)) return fs.readFileSync(path.join(__dirname, 'fixtures', 'top100-wa.html'), 'utf8');
      if (/alert\/summary/.test(url)) return otherStateMegaAlertHtml();
      if (/alert\/rba\//.test(url)) return '<div class="Observation"></div>';
      return [];
    } });
    const jobs = [];
    try {
      const A = app.window.__app;
      let clock = Date.now();
      app.window.Date.now = () => (clock += 3000);
      const timer = app.window.setTimeout.bind(app.window);
      app.window.setTimeout = (fn, ms, ...args) =>
        timer(fn, ms >= 20000 ? ms : Math.min(ms || 0, 1), ...args);
      A.fgWindowReset();
      A.fgSchedReset(clock);
      await A.refreshRecentBirdGen(false);
      await seedSeen(app, [], null, [{ code: 'verfly', name: bird.comName }]);
      await A.refreshRecentBirdGen(true);
      full = true;
      const pageCount = () => app.state.fetches.filter(url => /bird-list\?.*rank=hc/.test(url)).length;
      const historyCount = () => app.state.fetches.filter(url => /\/historic\//.test(url)).length;
      const metrics = { clock: 'virtual scheduler time; real wall-duration milestones' };
      let start = performance.now();
      const cold = A.refreshFullBirdGen();
      jobs.push(cold);
      await waitFor(() => /Vermilion Flycatcher/.test(app.$('recentBirdGenRows').textContent),
        'progressive cold first result');
      metrics.coldFirstResultMs = Math.round(performance.now() - start);
      await cold;
      metrics.coldSettleMs = Math.round(performance.now() - start);
      metrics.coldPageRequests = pageCount();
      const original = A.loadSurgeRetained().mass;
      assert.ok(original && !original.arrivalPending);
      assert.equal(A.massNews(original.rows[0]).length, 0, 'prior presence must remain non-news');
      start = performance.now();
      const warm = await A.loadMassFlockAlertSource(false, A.activeScope());
      metrics.warmSettleMs = Math.round(performance.now() - start);
      metrics.warmAdditionalPageRequests = pageCount() - metrics.coldPageRequests;
      assert.equal(warm.acquiredAt, original.acquiredAt);
      assert.equal(metrics.warmAdditionalPageRequests, 0);
      holdHistory = true;
      start = performance.now();
      const refreshing = A.refreshFullBirdGen();
      jobs.push(refreshing);
      await waitFor(() => held.length > 0 && A.loadSurgeRetained()?.mass?.arrivalPending,
        'forced Menu refresh has acquired and persisted its page while history remains pending')
        .catch(error => {
          t.diagnostic(JSON.stringify({ held: held.length, pages: pageCount(), histories: historyCount(),
            mass: A.loadSurgeRetained()?.mass, status: app.$('recentBirdGenStatus').textContent,
            tail: app.window.__dbg.buf.slice(-15).map(row => row.msg) }));
          throw error;
        });

      metrics.menuAcquiredStageMs = Math.round(performance.now() - start);
      const pagesBefore = pageCount(), historiesBefore = historyCount();
      const acquired = A.loadSurgeRetained().mass.acquiredAt;
      assert.equal(pagesBefore, metrics.coldPageRequests + 1, 'explicit refresh must reacquire exactly once');
      app.click(app.$('recentBirdGenOpen'));
      holdHistory = false;
      held.splice(0).forEach(release => release());
      await waitFor(() => app.$('surgeResults').dataset.sourceMass === 'ok'
        && A.loadSurgeRetained()?.mass?.arrivalPending === false,
      'new Bird Gen owner settles arrival checks');
      metrics.handoffSettleMs = Math.round(performance.now() - start);
      metrics.handoffAdditionalPageRequests = pageCount() - pagesBefore;
      metrics.handoffAdditionalHistoryRequests = historyCount() - historiesBefore;
      t.diagnostic(JSON.stringify(metrics));
      assert.equal(pageCount(), pagesBefore, 'navigation repeated an already acquired high-count page');
      const completed = A.loadSurgeRetained().mass;
      assert.equal(completed.acquiredAt, acquired, 'history completion cannot redate the page acquisition');
      assert.equal(A.massNews(completed.rows[0]).length, 0, 'handoff bypassed prior-presence arrival checks');
    } finally {
      held.splice(0).forEach(release => release());
      await Promise.allSettled(jobs);
      app.window.close();
    }
  });

  test('F1073 prepared real-app source status distinguishes loading, limited results and failure', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app;
      A.renderSurge([], [], [], [], [], {
        mass: 'partial', ppte: 'loading', hotspots: 'failed', observations: 'ok',
        pendingSources: { mass: false, ppte: true, hotspots: false, observations: false }
      });
      const status = app.$('surgeResults').querySelector('.surgesources');
      assert.match(status.textContent, /Mass flock feeds: Loaded with limited coverage/);
      assert.match(status.textContent, /Patagonia[^:]*: Loading/);
      assert.match(status.textContent, /Hotspot activity feeds: Failed/);
      const limited = app.$('surgeResults').querySelector('[data-count-kind="mass"]');
      assert.match(limited.textContent, /loaded with limited coverage/);
      assert.equal(limited.closest('.surgecategory').dataset.categoryState, 'limited');
      assert.ok(app.$('surgeResults').querySelector('[data-source-retry="mass"]'));
      assert.equal(A.surgeSourceSummary({ mass: 'partial' }, { mass: true }).pending[0], 'mass');
    } finally { app.window.close(); }
  });

  function preparedHomeRegion(code = 'US-WA') {
    return { features: [{ properties: {
      state: code === 'US-OR' ? 'Oregon' : 'Washington', countrycode: 'US'
    }, geometry: { type: 'Point', coordinates: [-122.3, 47.6] } }] };
  }

  test('F1079 F1084 actual setup derives its first matching pair without selecting or saving before confirmation', async () => {
    const app = await boot({ report: null, home: false, sample: false, key: null,
      location: { lat: 47.6, lng: -122.3 },
      storage: { bc_setup_step_v1: 'region', 'ebird_home_lat:or': '45.5',
        'ebird_home_lng:or': '-122.6', 'ebird_home_place:or': 'Saved Oregon Home' },
      fetch: url => /photon\.komoot\.io\/reverse/.test(url) ? preparedHomeRegion() : null });
    try {
      const A = app.window.__app;
      A.openSetupSheet();
      assert.equal(app.state.locations.length, 0, 'setup requested location before a tap');
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
      assert.match(app.$('setupSheetBody').textContent, /city center.*no exact address/);
      assert.match(app.$('setupSheetBody').textContent, /more Home\/region pairs later/);
      assert.equal(app.$('setupSkip'), null);
      assert.equal(app.$('setupChooseRegion'), null);
      assert.equal(A.getReportSlug(), '');
      app.click(app.$('setupHomeHere'));
      await waitFor(() => app.$('setupHomeApprove'), 'unaccepted device candidate');
      assert.equal(app.state.locations.length, 1);
      assert.equal(A.getReportSlug(), '');
      assert.equal(A.getHome(), null);
      assert.equal(app.state.fetches.filter(url => /photon.*reverse/.test(url)).length, 0,
        'region was inferred before Home approval');
      app.click(app.$('setupHomeApprove'));
      await waitFor(() => app.$('setupNext'), 'Home-derived pair confirmation');
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'region');
      assert.equal(A.getReportSlug(), '', 'suggestion accepted itself');
      assert.equal(A.getHome(), null);
      assert.match(app.$('setupHomeSuggested').textContent, /Seattle|Current location/);
      assert.match(app.$('setupHomeSuggested').textContent, /Washington/);
      assert.equal(app.$('setupAcceptHomeRegion'), null);
      assert.equal(app.$('setupHomeOutside'), null);
      assert.ok(app.window.localStorage.getItem('bc_setup_home_draft_v1'));
      app.click(app.$('setupNext'));
      await waitFor(() => app.$('setupSheetBody').dataset.setupStep === 'seen', 'confirmed pair');
      assert.equal(A.getReportSlug(), 'wa');
      assert.deepEqual(JSON.parse(JSON.stringify(A.getHome())), { lat: 47.6, lng: -122.3 });
      assert.equal(app.window.localStorage.getItem('ebird_home_lat:or'), '45.5');
      assert.equal(app.window.localStorage.getItem('ebird_home_place:or'), 'Saved Oregon Home');
      assert.equal(app.window.localStorage.getItem('bc_setup_home_draft_v1'), null);
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'seen');
      assert.equal(app.state.fetches.filter(url => /photon.*reverse/.test(url)).length, 1);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1079 F1084 manual Home disambiguation confirms only its containing region and protects each saved Home', async () => {
    const app = await boot({ report: 'wa', home: false, sample: false,
      storage: { bc_setup_step_v1: 'region', 'ebird_home_lat:wa': '47.7',
        'ebird_home_lng:wa': '-122.2', 'ebird_home_place:wa': 'Existing Home',
        'ebird_home_lat:u-or': '45.5', 'ebird_home_lng:u-or': '-122.6',
        'ebird_home_place:u-or': 'Existing Oregon Home',
        ebird_custom_regions: JSON.stringify([{ slug: 'u-or', label: 'Oregon',
          stateCode: 'US-OR', lat: 45.5, lng: -122.6 }]) },
      fetch(url) {
        if (/photon\.komoot\.io\/api/.test(url)) return { features: [
          { properties: { name: 'Springfield', state: 'Washington', country: 'United States' },
            geometry: { type: 'Point', coordinates: [-122.3, 47.6] } },
          { properties: { name: 'Springfield', state: 'Oregon', country: 'United States' },
            geometry: { type: 'Point', coordinates: [-123.0, 44.0] } }
        ] };
        if (/photon\.komoot\.io\/reverse/.test(url)) return preparedHomeRegion('US-OR');
        return null;
      } });
    try {
      const A = app.window.__app;
      A.openSetupSheet();
      app.$('setupHomePlace').value = 'Springfield';
      app.$('setupHomePlace').dispatchEvent(new app.window.Event('input', { bubbles: true }));
      app.click(app.$('setupHomeFind'));
      await waitFor(() => app.$('setupHomeOptions').children.length === 2, 'ambiguous Home choices');
      assert.equal(app.$('setupHomeApprove'), null, 'first ambiguous result was chosen automatically');
      const search = app.state.fetches.find(url => /photon.*api/.test(url));
      assert.equal(new URL(search).searchParams.get('q'), 'Springfield');
      assert.equal(new URL(search).searchParams.has('lat'), false, 'old Home biased setup');
      app.click(app.$('setupHomeOptions').children[1]);
      app.click(app.$('setupHomeApprove'));
      await waitFor(() => app.$('setupNext'), 'Oregon pair confirmation');
      assert.equal(A.getReportSlug(), 'wa', 'derived region switched before confirmation');
      assert.match(app.$('setupHomeReplace').parentElement.textContent, /Oregon/);
      assert.equal(app.$('setupHomeOutside'), null, 'outside-region consent must not bypass pair matching');
      app.click(app.$('setupNext'));
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(A.getHome().lat, 47.7, 'unaccepted replacement overwrote saved Home');
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'region');
      app.$('setupHomeReplace').checked = true;
      app.click(app.$('setupNext'));
      await waitFor(() => app.$('setupSheetBody').dataset.setupStep === 'seen', 'confirmed Oregon pair');
      assert.equal(A.getHome().lat, 44);
      assert.equal(A.getReportSlug(), 'u-or');
      assert.equal(A.getHome('wa').lat, 47.7, 'Oregon Home replaced Washington Home');
      A.setActiveReport('wa');
      assert.equal(A.getHome().lat, 47.7, 'switching regions carried Oregon Home across');
      assert.equal(app.state.locations.length, 0, 'manual entry requested device permission');
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1084 missing or mismatched Home cannot complete setup and closing retains a resumable draft', async () => {
    const app = await boot({ report: null, home: false, sample: false,
      storage: { bc_setup_step_v1: 'summary' } });
    try {
      const A = app.window.__app, storage = app.window.localStorage;
      A.openSetupSheet();
      app.click(app.$('setupContinue'));
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
      assert.equal(storage.getItem('bc_setup_dismissed_v1'), null);
      storage.setItem('bc_setup_home_draft_v1', JSON.stringify({ profile: A.bcProfile(),
        point: { lat: 47.6, lng: -122.3, label: 'Example Home' }, approved: true,
        region: { status: 'ok', code: 'US-OR', label: 'Oregon', lat: 44, lng: -123 } }));
      storage.setItem('bc_setup_step_v1', 'region');
      A.openSetupSheet();
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
      assert.equal(app.$('setupNext'), null);
      assert.match(app.$('setupSheetBody').textContent, /draft could not be read/);
      const draft = storage.getItem('bc_setup_home_draft_v1');
      app.click(app.$('setupSheetClose'));
      assert.equal(app.$('setupSheet').hidden, true);
      assert.equal(storage.getItem('bc_setup_dismissed_v1'), null);
      assert.equal(storage.getItem('bc_setup_home_draft_v1'), draft);
      A.openSetupSheet();
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
      assert.equal(A.getHome(), null);
      assert.equal(A.getReportSlug(), '');
      assert.equal(app.state.locations.length, 0);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1084 failed Home region lookup stays actionable without a guessed region or GPS request', async () => {
    let failed = true;
    const app = await boot({ report: null, home: false, sample: false,
      storage: { bc_setup_step_v1: 'home' },
      fetch: url => /photon\.komoot\.io\/reverse/.test(url)
        ? failed ? { features: [] } : preparedHomeRegion() : null });
    try {
      const A = app.window.__app;
      A.openSetupSheet();
      app.$('setupHomePlace').value = '47.6, -122.3';
      app.click(app.$('setupHomeFind'));
      await waitFor(() => app.$('setupHomeApprove'), 'manual coordinate candidate');
      app.click(app.$('setupHomeApprove'));
      await waitFor(() => /Retry the region lookup/.test(app.$('setupActionStatus').textContent), 'lookup failure');
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
      assert.equal(app.$('setupNext'), null);
      assert.equal(A.getReportSlug(), '');
      assert.equal(A.getHome(), null);
      failed = false;
      app.click(app.$('setupHomeApprove'));
      await waitFor(() => app.$('setupNext'), 'retried matching region');
      assert.equal(A.getReportSlug(), '', 'retry selected a region before confirmation');
      app.click(app.$('setupChangeHome'));
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
      app.$('setupHomePlace').value = 'another city';
      app.$('setupHomePlace').dispatchEvent(new app.window.Event('input', { bubbles: true }));
      assert.equal(app.$('setupHomeCandidate').hidden, true);
      assert.equal(app.$('setupNext'), null);
      assert.equal(A.getReportSlug(), '');
      assert.equal(A.getHome(), null);
      assert.equal(app.state.locations.length, 0);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1084 a destination change during pair confirmation cannot save Home in the wrong region', async () => {
    const app = await boot({ report: null, home: false, sample: false,
      storage: { bc_setup_step_v1: 'region', bc_setup_home_draft_v1: JSON.stringify({
        profile: '', point: { lat: 47.6, lng: -122.3, label: 'Example Home' },
        approved: true, region: { status: 'ok', code: 'US-WA', label: 'Washington',
          lat: 47.6, lng: -122.3 }
      }) } });
    try {
      const A = app.window.__app, draft = app.window.localStorage.getItem('bc_setup_home_draft_v1');
      A.openSetupSheet();
      app.click(app.$('setupNext'));
      A.setActiveReport('mo');
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(A.getHome('wa'), null);
      assert.equal(A.getHome('mo'), null, 'Washington Home was saved under Missouri');
      assert.equal(app.window.localStorage.getItem('bc_setup_home_draft_v1'), draft);
      assert.match(app.$('setupActionStatus').textContent, /Home and region do not match/);
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'region');
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1084 each actual setup step has brief relevant privacy guidance', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app;
      for (const [step, copy] of [
        ['account', /Sign in directly.*does not need your password/],
        ['key', /Key verification is sent directly to eBird/],
        ['home', /city center is fine; no exact address is needed/],
        ['seen', /reads your eBird list for the selected region/]
      ]) {
        app.window.localStorage.setItem('bc_setup_step_v1', step);
        A.openSetupSheet();
        assert.match(app.$('setupSheetBody').textContent, copy);
      }
      app.window.localStorage.setItem('bc_setup_home_draft_v1', JSON.stringify({
        profile: A.bcProfile(), point: { lat: 47.6, lng: -122.3, label: 'Example Home' },
        approved: true, region: { status: 'ok', code: 'US-WA', label: 'Washington',
          lat: 47.6, lng: -122.3 }
      }));
      app.window.localStorage.setItem('bc_setup_step_v1', 'region');
      A.openSetupSheet();
      assert.match(app.$('setupSheetBody').textContent, /No additional device-location request is needed/);
      assert.equal(app.state.locations.length, 0);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1080 prepared actual Settings location requires approval and preserves manual correction and cancellation', async () => {
    const app = await boot({ sample: false, location: { lat: 47.6, lng: -122.3 },
      fetch: url => /photon\.komoot\.io\/reverse/.test(url) ? preparedHomeRegion() : null });
    try {
      const A = app.window.__app;
      app.open(/Settings/);
      assert.match(app.$('homeCurrentLocation').textContent, /Use my current location/);
      assert.equal(app.state.locations.length, 0);
      const initial = JSON.stringify(A.getHome());
      app.click(app.$('homeCurrentLocation'));
      await waitFor(() => !app.$('homeDeviceSave').hidden, 'device Home approval');
      assert.equal(JSON.stringify(A.getHome()), initial);
      app.click(app.$('homeFindCancel'));
      assert.equal(app.$('homeDeviceSave').hidden, true);
      assert.equal(JSON.stringify(A.getHome()), initial);
      app.click(app.$('homeCurrentLocation'));
      await waitFor(() => !app.$('homeDeviceSave').hidden, 'second candidate');
      app.$('homePlace').value = '47.65, -122.35';
      app.$('homePlace').dispatchEvent(new app.window.Event('input', { bubbles: true }));
      assert.equal(app.$('homeDeviceSave').hidden, true, 'edited device candidate remained acceptable');
      app.click(app.$('geocodeBtn'));
      await waitFor(() => A.getHome().lat === 47.65, 'corrected manual Home');
      app.click(app.$('homeCurrentLocation'));
      await waitFor(() => !app.$('homeDeviceSave').hidden, 'approved candidate');
      app.click(app.$('homeDeviceSave'));
      assert.deepEqual(JSON.parse(JSON.stringify(A.getHome())), { lat: 47.6, lng: -122.3 });
      assert.equal(app.state.locations.length, 3);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1079 F1080 prepared denied, timed-out, cancelled and superseded location requests never change Home', async () => {
    for (const surface of ['setup', 'settings']) {
      for (const outcome of ['denied', 'timeout', 'cancel', 'close', 'region', 'profile']) {
        const app = await boot({ sample: false, home: false,
          storage: { bc_setup_step_v1: 'region' },
          fetch: url => /photon\.komoot\.io\/reverse/.test(url) ? preparedHomeRegion() : null });
        try {
          const A = app.window.__app;
          let deliver, fail, requests = 0;
          Object.defineProperty(app.window.navigator, 'geolocation', { configurable: true,
            value: { getCurrentPosition(ok, bad) { requests++; deliver = ok; fail = bad; } } });
          if (surface === 'setup') A.openSetupSheet(); else app.open(/Settings/);
          assert.equal(requests, 0);
          const nativeTimer = app.window.setTimeout.bind(app.window);
          let timeout;
          app.window.setTimeout = (fn, delay, ...args) => {
            if (delay === 12000) timeout = fn;
            return nativeTimer(fn, delay, ...args);
          };
          app.click(app.$(surface === 'setup' ? 'setupHomeHere' : 'homeCurrentLocation'));
          assert.equal(requests, 1);
          if (outcome === 'denied') fail({ code: 1, message: 'Permission denied' });
          if (outcome === 'timeout') { assert.equal(typeof timeout, 'function'); timeout(); }
          if (outcome === 'cancel') app.click(app.$(surface === 'setup' ? 'setupHomeCancel' : 'homeFindCancel'));
          if (outcome === 'close') {
            if (surface === 'setup') app.click(app.$('setupSheetClose')); else A.showMenu();
          }
          if (outcome === 'region') A.setActiveReport('or');
          if (outcome === 'profile') app.window.localStorage.setItem(A.BC_PROFILE_PTR, 'Other synthetic profile');
          deliver({ coords: { latitude: 47.6, longitude: -122.3 } });
          await new Promise(resolve => setTimeout(resolve, 30));
          assert.equal(app.window.localStorage.getItem('ebird_home_lat:wa'), null, surface + '/' + outcome);
          assert.equal(app.window.localStorage.getItem('ebird_home_lat:or'), null, surface + '/' + outcome);
          if (outcome === 'denied' || outcome === 'timeout') {
            const message = app.$(surface === 'setup' ? 'setupActionStatus' : 'geocodeStatus').textContent;
            assert.match(message, outcome === 'denied' ? /Location is off for Bird Chaser/ : /timed out/i);
          }
          assert.equal(app.$('homeDeviceSave').hidden, true);
          if (surface === 'setup') assert.equal(app.$('setupHomeApprove'), null);
          if (surface === 'setup' && outcome === 'profile') {
            assert.equal(app.window.localStorage.getItem(A.bcReal('bc_setup_home_draft_v1')), null,
              'late location wrote a draft into the new profile');
            const originalDraft = JSON.parse(app.window.localStorage.getItem('bc_setup_home_draft_v1'));
            assert.equal(originalDraft.point, undefined, 'obsolete location entered the original draft');
          }
          assert.deepEqual(app.state.errors, []);
        } finally { app.window.close(); }
      }
    }
  });
};
