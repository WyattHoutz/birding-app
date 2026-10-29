'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function registerMigrationSetupControls({
  test, assert, boot, seedSeen, seedRarityChase, fixtureIsoWeek, sampleDateForWeek, foySourceFixture,
  formatObsStamp, IDBFactory, waitFor, HTML, f821Page, f821Hotspots, otherStateMegaAlertHtml
}) {
  function baselineSensitive(app) {
    const A = app.window.__app, now = new app.window.Date();
    const parts = A.birdcastLocalParts(now, A.getReport());
    A.birdGenSensitiveJournal({
      source: 'highCountPage', sourceOwner: A.surgeRetainedContext(),
      sourceRegion: A.activeScope().effectiveRegion,
      sourceMonth: parts.year + '-' + String(parts.month).padStart(2, '0'),
      acquiredAt: now.getTime() - 1, state: 'ok', acquired: true,
      inventoryComplete: true, sensitiveRows: []
    }, now);
  }

  test('F1085 both real Twitch renderers show the same two- and six-hour source ages', async () => {
    const app = await boot();
    try {
      const A = app.window.__app;
      await seedSeen(app, []);
      const now = Date.now() + 60000;
      A.setRaritySort('date');
      const reports = [
        { code: 'ancmur', name: 'Ancient Murrelet', hours: 2 },
        { code: 'lcspet', name: "Leach's Storm-Petrel", hours: 6 }
      ].map(bird => ({ ...bird, kind: 'Rarity',
        dateStr: formatObsStamp(new Date(now - bird.hours * 3600000)),
        loc: 'Synthetic public patch', locId: 'LSOURCE', subId: 'SSOURCE' + bird.hours,
        observer: 'Synthetic observer', distMi: 2 }));
      await seedRarityChase(app, reports, now);
      app.window.Date.now = () => now;
      for (let paint = 0; paint < 2; paint++) {
        A.refresh();
        await waitFor(() => app.$('results').querySelector('[data-ev-sub="SSOURCE6"]'),
          'same-source Twitches repaint');
        A.renderSurge([], [], [], [], [], { observations: 'ok',
          twitchRows: reports.map(bird => ({ code: bird.code, name: bird.name,
            firstAt: now, reports: 1, lowerBound: true, recovered: paint === 1,
            latest: { ...bird, lat: 47.75, lon: -122.16, count: 1 } })) });
        for (const bird of reports) {
          assert.equal(app.$('results').querySelector('[data-ev-sub="' + bird.subId + '"] .spmetric-age strong')
            .textContent, bird.hours + 'h');
          const card = app.$('surgeFeed').querySelector('[data-species-code="' + bird.code + '"]');
          assert.equal(card.querySelector('.surgeage').textContent, bird.hours + 'hr ago');
          assert.equal(Number(card.dataset.twitchFirstAt), now);
        }
      }
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1085 source ages survive detection, merging, recovery and preview without inventing precision', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app;
      await seedSeen(app, []);
      const now = Date.now();
      app.window.Date.now = () => now;
      const stamp = hours => formatObsStamp(new Date(now - hours * 3600000));
      for (const recovered of [false, true]) {
        for (const hours of [2, 6]) {
          const event = { code: 'verfly', name: 'Vermilion Flycatcher', firstAt: now,
            reports: 1, lowerBound: true, unreviewed: true, recovered,
            latest: { dateStr: stamp(hours), locId: 'LSOURCE', loc: 'Public patch',
              lat: 47.75, lon: -122.16, subId: 'SSOURCE', count: 1 } };
          for (let paint = 0; paint < 2; paint++) {
            A.renderSurge([], [], [], [{
              code: 'verfly', name: 'Vermilion Flycatcher', reports: 3,
              whenStr: stamp(hours), locName: 'Public patch', locId: 'LSOURCE', distMi: 1
            }], [], { observations: 'ok', twitchRows: [event] });
            const card = app.$('surgeFeed').querySelector('[data-alert-kind="twitch"]');
            assert.ok(card.dataset.surgeReasons.includes('need'), 'exercise merged Celebrity evidence');
            assert.equal(card.querySelector('.surgeage').textContent, hours + 'hr ago');
            assert.equal(Number(card.dataset.twitchFirstAt), now, 'source age must not change detection identity');
            assert.equal(app.$('recentBirdGenRows').querySelector('.recent-birdgen-time').textContent,
              hours + 'hr ago');
            assert.equal(card.querySelector('.surge-twitch-reports'), null);
            assert.match(card.querySelector('template').content.textContent, /1 independent report in 24h/);
            assert.match(card.querySelector('.surge-essential').textContent, /Unreviewed/);
            assert.equal(app.$('recentBirdGenRows').querySelector('.sub,.surge-essential'), null);
          }
        }
      }
      const host = app.document.createElement('div');
      for (const kind of Object.keys(app.window.BirdInfoDialogs.alertKinds)) {
        for (const hours of [2, 6]) {
          const when = stamp(hours);
          host.innerHTML = A.surgeAlertCard({ kind, name: 'Source control', when,
            time: new app.window.Date(when.replace(' ', 'T')).getTime() }, 0);
          assert.equal(host.querySelector('.surgeage').textContent, hours + 'hr ago', kind);
        }
        host.innerHTML = A.surgeAlertCard({ kind, name: 'Date control', when: stamp(2).slice(0, 10),
          time: new app.window.Date(stamp(2).slice(0, 10)).getTime() }, 0);
        assert.equal(host.querySelector('.surgeage').textContent, 'Date only', kind);
        host.innerHTML = A.surgeAlertCard({ kind, name: 'Missing control', when: '', time: 0 }, 0);
        assert.match(host.querySelector('.surgeage').textContent, /Time\s+unknown/, kind);
        const when = stamp(-1);
        host.innerHTML = A.surgeAlertCard({ kind, name: 'Future control', when,
          time: new app.window.Date(when.replace(' ', 'T')).getTime() }, 0);
        assert.match(host.querySelector('.surgeage').textContent, /Future.*source time/, kind);
      }
      const feed = app.$('surgeFeed');
      for (const label of ['Tonight', 'Saved forecast', 'October 2026', 'Date only']) {
        feed.innerHTML = A.surgeAlertCard({ kind: 'migration', name: 'Source period',
          when: stamp(1), time: now - 3600000, ageLabel: label }, 0);
        A.updateRecentBirdGen();
        assert.equal(app.$('recentBirdGenRows').querySelector('.recent-birdgen-time').textContent, label);
      }
      feed.innerHTML = A.surgeAlertCard({ kind: 'mega', name: 'Outside control',
        when: stamp(1), time: now - 3600000, extra: 'Outside your chase area' }, 0);
      A.updateRecentBirdGen();
      assert.match(feed.querySelector('.surge-essential').textContent, /Outside chase area/);
      assert.equal(app.$('recentBirdGenRows').querySelector('.sub'), null);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1087 padding-only header retains its structure, typography, safe area and controls', async () => {
    const app = await boot();
    try {
      const rules = [...app.document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
      assert.match(HTML, /padding:\s*calc\(env\(safe-area-inset-top\) \+ 2px\) 12px 0;/,
        'jsdom drops env() declarations; the Chrome guard verifies computed padding');
      const identity = rules.find(rule => rule.selectorText?.includes('header > .hdrid,')
        && rule.style?.getPropertyValue('flex-wrap') === 'wrap');
      assert.equal(identity.style.gap, '2px 8px');
      assert.equal(rules.find(rule => rule.selectorText === '.hdrid .hdrrank, .hdrid .hdrcount')
        .style.getPropertyValue('min-height'), '44px');
      assert.equal(app.window.getComputedStyle(app.document.querySelector('header .brandmark')).width, '44px');
      assert.equal(app.document.querySelector('header > .brand').nextElementSibling.id, 'hdrPeriod');
      assert.match(HTML, /header \.brandtext h1 \{ font-size: calc\(24px/);
    } finally { app.window.close(); }
  });

  test('F1088 actual waxwing hierarchy preserves distinct overlapping published slash sets', async () => {
    const app = await boot({ sample: false,
      fetch: url => /data\/obs\//.test(url) ? [] : null,
      storage: { 'ebird_species_v2:US-WA': JSON.stringify({ at: Date.now(), rows: [
        { code: 'bohwax', name: 'Bohemian Waxwing', sci: 'Bombycilla garrulus' },
        { code: 'cedwax', name: 'Cedar Waxwing', sci: 'Bombycilla cedrorum' },
        { code: 'japwax1', name: 'Japanese Waxwing', sci: 'Bombycilla japonica' }
      ] }) } });
    try {
      const A = app.window.__app;
      const species = [
        ['bohwax', 'Bohemian Waxwing', 'Bombycilla garrulus'],
        ['cedwax', 'Cedar Waxwing', 'Bombycilla cedrorum'],
        ['japwax1', 'Japanese Waxwing', 'Bombycilla japonica']
      ].map(([speciesCode, comName, sciName], i) => ({ speciesCode, comName, sciName,
        category: 'species', order: 'Passeriformes', familySciName: 'Bombycillidae',
        familyComName: 'Waxwings', taxonOrder: i + 1 }));
      const slashes = [
        ['waxwin', 'Bohemian/Cedar Waxwing', 'Bombycilla garrulus/cedrorum'],
        ['y00428', 'Bohemian/Japanese Waxwing', 'Bombycilla garrulus/japonica']
      ].map(([speciesCode, comName, sciName], i) => ({ ...species[0], speciesCode, comName,
        sciName, category: 'slash', taxonOrder: i + 10 }));
      const model = app.window.Spuh.createFromTaxonomy([...species, ...slashes]);
      A.setSpuhModel(model);
      for (const [code, expected] of [
        ['bohwax', ['waxwin', 'y00428']], ['cedwax', ['waxwin']], ['japwax1', ['y00428']]
      ]) {
        await A.renderSpuhStakeoutNav(code, model.speciesRow(code).name);
        const nav = app.$('spLookupIdHelp');
        assert.deepEqual([...nav.querySelectorAll('.spuhpathsentence [data-spuh]')]
          .map(node => node.dataset.spuh), expected);
        assert.deepEqual([...nav.querySelectorAll('.spuhtaxchoices [data-spuh]')]
          .map(node => node.dataset.spuh), expected);
        assert.equal(nav.querySelector('.spuhtaxequiv'), null, 'overlap is not equivalence');
        assert.equal(nav.querySelectorAll('.spuhpathsentence [data-rank="group"]').length, expected.length);
      }
      for (const [code, members] of [['waxwin', ['bohwax', 'cedwax']], ['y00428', ['bohwax', 'japwax1']]]) {
        assert.deepEqual(Array.from(model.candidates(code), row => row.code), members);
        app.$('spLookup').value = model.node(code).name;
        await A.runSpuhSearch();
        assert.match(app.$('spLookupQueryHelp').textContent, /2 birds in its published set/);
        assert.ok(app.$('spLookupQueryHelp').querySelector('[data-spuh="' + code + '"]'));
      }
      assert.equal(model.searchSpuh('waxwing', 10).length, 2);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1089 F1091 source recovery preserves real coverage limits and pills expose accessible loading only', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app;
      const states = { mega: 'ok', observations: 'ok', birdcast: 'notApplicable',
        leaderboard: 'ok', hotspots: 'failed', favorites: 'ok', mass: 'partial',
        ppte: 'partial', foy: 'ok' };
      A.renderSurge([], [], [], [], [], states);
      assert.match(app.$('surgeResults').querySelector('.surgesourcemeter').textContent, /1 failed/);
      assert.equal(app.$('surgeResults').querySelector('[data-count-kind="sensitive"]')
        .closest('.surgecategory').dataset.categoryState, 'limited');
      A.renderSurge([], [], [], [], [], { ...states, hotspots: 'ok' });
      const box = app.$('surgeResults');
      assert.match(box.querySelector('.surgesourcemeter').textContent, /8 of 8 loaded.*2 with limited coverage/);
      assert.doesNotMatch(box.querySelector('.surgesourcemeter').textContent, /failed/);
      assert.equal(box.dataset.sourcePpte, 'partial', 'retained union does not uncap RBA coverage');
      assert.equal(box.dataset.sourcesComplete, 'false');
      assert.equal(box.querySelector('[data-source-retry="hotspots"]'), null);
      for (const mass of ['ok', 'loading', 'failed']) {
        A.renderSurge([], [], [], [], [], { ...states, hotspots: 'ok', mass });
        const sensitive = app.$('surgeResults').querySelector('[data-count-kind="sensitive"]');
        if (mass === 'ok') assert.equal(sensitive, null);
        else assert.equal(sensitive.closest('.surgecategory').dataset.categoryState, mass);
      }
      for (const counted of [false, true]) {
        const root = app.document.createElement('div');
        root.innerHTML = A.surgeCountHtml(counted ? [{ kind: 'mass' }] : [],
          { mass: 'loading', hotspots: 'loading' }, { mass: true, hotspots: true });
        for (const kind of ['mass', 'sensitive', 'hotspot']) {
          const pill = root.querySelector('[data-count-kind="' + kind + '"]');
          assert.doesNotMatch(pill.textContent, /loading/i);
          assert.equal((pill.textContent.match(/⌛/g) || []).length, 1);
          assert.match(pill.getAttribute('aria-label'), /loading, results not complete/);
        }
        assert.equal(/1 MASS FLOCK/.test(root.textContent), counted);
      }
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1092 F1093 Sensitive uses acquired coarse area and a real private-safe evidence action', async () => {
    for (const county of [false, true]) {
      const app = await boot({ sample: false, fetch: url => /bird-list\?.*rank=hc/.test(url)
        ? preparedSensitivePage().replaceAll('US-WA', county ? 'US-WA-033' : 'US-WA') : [] });
      try {
        const A = app.window.__app;
        if (county) A.setCountyView('US-WA-033');
        baselineSensitive(app);
        const source = await A.loadMassFlockAlertSource(false, A.activeScope());
        const requests = app.state.fetches.length;
        const area = county ? 'King County' : 'Washington';
        const rows = A.birdGenSensitiveRows(new app.window.Date());
        const headline = app.document.createElement('span');
        headline.innerHTML = rows[0].name;
        assert.match(headline.textContent, new RegExp('reported in ' + area + (county ? '' : ' region') + ' in '));
        if (!county) assert.doesNotMatch(rows[0].name, /King|Snohomish|Home/);
        A.renderSurge([], [], [], [], [], { massSource: source, mass: source.state });
        const card = app.$('surgeFeed').querySelector('[data-alert-kind="sensitive"]');
        const tag = card.querySelector('.surge-leading-tag');
        assert.equal(tag.tagName, 'BUTTON');
        assert.match(tag.getAttribute('aria-label'), /SENSITIVE.*evidence/);
        assert.equal(app.window.getComputedStyle(tag).minHeight, '44px');
        const painted = tag.querySelector('.surgebadge-sensitive');
        assert.ok(painted, 'compact painted chip is independent of its 44px target');
        assert.equal(app.window.getComputedStyle(painted).borderTopWidth, '2px');
        assert.equal(app.window.getComputedStyle(painted).borderTopStyle, 'solid');
        assert.equal(app.window.getComputedStyle(painted).color, 'rgb(0, 91, 143)');
        assert.equal(app.window.getComputedStyle(card.querySelector('.surgeage')).whiteSpace, 'normal');
        app.click(tag);
        assert.equal(app.$('appSheet').hidden, false);
        assert.match(app.$('appSheet').textContent, /SENSITIVE alert details/);
        assert.match(app.$('appSheet').textContent, new RegExp(area));
        assert.match(app.$('appSheet').textContent, /exact observation date and location withheld/);
        assert.equal(app.$('appSheet').querySelector('[data-loc],[data-subid],[data-q]'), null);
        assert.equal(app.state.fetches.length, requests, 'coarse display/action makes no new source request');
        const history = app.window.localStorage.getItem(A.sensitiveJournalKey());
        A.birdGenSensitiveJournal({ ...source, sourceRegion: 'US-OR',
          acquired: true, inventoryComplete: true, state: 'ok' }, new app.window.Date());
        assert.equal(app.window.localStorage.getItem(A.sensitiveJournalKey()), history,
          'foreign-region evidence cannot alter the acquired-area journal');
        assert.deepEqual(app.state.errors, []);
      } finally { app.window.close(); }
    }
  });

  test('F1110 Sensitive headline links its bird and source area in one sentence', async () => {
    const now = Date.parse('2026-10-15T12:00:00-07:00');
    for (const region of ['US-WA', 'US-WA-061']) {
      const external = [];
      const app = await boot({ sample: false, fetch: url => /bird-list\?.*rank=hc/.test(url)
        ? preparedSensitivePage(new Date(now)).replaceAll('US-WA', region) : [] });
      try {
        const A = app.window.__app, RealDate = app.window.Date;
        assert.equal(A.speciesUrl('grgowl', null), 'https://ebird.org/species/grgowl',
          'an explicitly unknown source region never falls back to Home');
        app.window.Date = class extends RealDate {
          constructor(...args) { super(...(args.length ? args : [now])); }
          static now() { return now; }
        };
        A.fgWindowReset();
        A.fgSchedReset(now);
        if (region !== 'US-WA') A.setCountyView(region);
        baselineSensitive(app);
        const source = await A.loadMassFlockAlertSource(false, A.activeScope());
        assert.notEqual(source.state, 'failed');
        A.renderSurge([], [], [], [], [], { massSource: source, mass: source.state });
        A.showSection('sec-surgeBtn', { load: false });
        const card = app.$('surgeFeed').querySelector('[data-alert-kind="sensitive"]');
        const title = card.querySelector('.surgealerttitle');
        const area = region === 'US-WA' ? 'Washington region' : 'Snohomish County';
        assert.equal(title.textContent, 'Great Gray Owl reported in ' + area + ' in October 2026');
        const links = title.querySelectorAll('a');
        assert.equal(links.length, 2);
        assert.equal(links[0].textContent, 'Great Gray Owl');
        assert.equal(title.querySelector('.surgebirdname').textContent, 'Great Gray Owl');
        const url = 'https://ebird.org/species/grgowl/' + region;
        assert.equal(links[0].getAttribute('href'), url);
        assert.equal(links[0].tabIndex, 0, 'real bird link remains keyboard reachable');
        const areaUrl = 'https://ebird.org/region/' + region
          + '/bird-list?yr=curM&rank=hc&hs_sortBy=count&locale=en';
        assert.equal(links[1].textContent, area);
        assert.equal(links[1].getAttribute('href'), areaUrl);
        assert.equal(links[1].tabIndex, 0);
        const areaStyle = app.window.getComputedStyle(links[1]);
        assert.equal(areaStyle.fontWeight, '700');
        assert.equal(areaStyle.textDecoration, 'none');
        assert.equal(app.window.getComputedStyle(links[0]).display, 'inline');
        assert.equal(app.window.getComputedStyle(links[0]).marginTop, '0px');
        assert.equal(title.querySelector('br,a a'), null);
        app.window.open = url => { external.push(url); return null; };
        app.click(links[0]);
        assert.deepEqual(external, [url], 'actual alert tap uses the external page, not Stakeout');
        app.click(links[1]);
        assert.deepEqual(external, [url, areaUrl], 'area opens the acquired current-month species list');
        assert.match(card.querySelector('template').content.textContent, /exact observation date and location withheld/);
        assert.ok(app.$('recentBirdGenRows').querySelector('[data-recent-kind="sensitive"]'),
          'a new app detection appears in Recent without claiming an observation timestamp');
        assert.equal(Number(card.dataset.firstDetectedAt), now);
        assert.deepEqual(app.state.errors, []);
      } finally { app.window.close(); }
    }
  });

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
      assert.match(row.name, /Low migration forecast for King County/);
      assert.match(row.name, /109,900 birds last night/);
      assert.match(row.extra, /source night 2026-03-07.*separate from the forecast/);
      assert.equal(row.when, '2026-03-08T08:00:00.000Z', 'spring midnight precedes the DST transition');
      const refreshed = A.birdcastSurgeRows(new Date('2026-03-08T21:00:00Z'), {
        ...snapshot, fetchedAt: Date.parse('2026-03-08T21:00:00Z')
      })[0];
      assert.equal(refreshed.time, row.time);
      assert.equal(refreshed.notificationKey, row.notificationKey);
      const retained = A.birdcastSurgeRows(new Date('2026-03-09T20:00:00Z'), snapshot)[0];
      assert.equal(retained.time, row.time);
      assert.match(retained.name, /Low migration forecast for King County/);
      assert.equal(retained.ageLabel, 'Saved');
      assert.doesNotMatch(retained.name, /Low migration tonight/);
      for (const extra of [{ forecast: null }, { sourceScope: 'mo' }, {
        forecast: { date: '2026-03-08', level: 'Loading' }
      }]) assert.equal(A.birdcastSurgeRows(now, { ...snapshot, ...extra }).length, 0);
      const failed = A.birdcastSurgeRows(now, { ...snapshot, forecastError: 'Unavailable' })[0];
      assert.match(failed.name, /Low migration forecast for King County/);
      assert.equal(failed.ageLabel, 'Saved');
      assert.doesNotMatch(failed.name, /Low migration tonight/);
      assert.match(A.birdcastSurgeRows(now, { ...snapshot, count: null })[0].name, /count unavailable/);
      assert.doesNotMatch(A.birdcastSurgeRows(now, { ...snapshot, count: null })[0].name, /0 birds/);
      const fall = new Date('2026-11-01T20:00:00Z');
      for (const level of ['Low', 'Medium', 'High']) {
        const next = A.birdcastSurgeRows(fall, { ...snapshot, count: null,
          fetchedAt: fall.getTime(), forecast: { date: '2026-11-01', level }
        })[0];
        assert.equal(next.when, '2026-11-01T07:00:00.000Z', 'fall midnight precedes the DST transition');
        assert.match(next.name, new RegExp(level + ' migration forecast for '));
        assert.equal(next.ageLabel, 'Current');
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
      const A = app.window.__app;
      baselineSensitive(app);
      const source = await A.loadMassFlockAlertSource(false, A.activeScope());
      assert.notEqual(source.state, 'failed');
      assert.equal(source.evidenceRows.length, 0);
      assert.equal(source.rows.length, 0);
      assert.equal(source.rowCoverage.accepted, 0);
      assert.equal(source.rowCoverage.rejected, 0);
      assert.equal(source.rowCoverage.total, 1);
      assert.equal(source.sensitiveRows.length, 1);
      assert.deepEqual(Object.keys(source.sensitiveRows[0]).sort(), ['code', 'count', 'name', 'region']);
      const first = A.birdGenSensitiveRows(new app.window.Date());
      assert.equal(first.length, 1, 'new monthly presence after a known baseline creates an alert');
      assert.match(first[0].name, /https:\/\/ebird.org\/species\/grgowl\/US-WA/);
      assert.doesNotMatch(first[0].name, /splink|data-sp|stakeout|checklist/i);
      assert.equal(first[0].time, source.acquiredAt, 'age is cached app detection, not a withheld observation timestamp');
      await A.saveSurgeRetainedPart('mass', source);
      const warm = await A.loadMassFlockAlertSource(false, A.activeScope());
      assert.equal(app.state.fetches.filter(url => /bird-list\?.*rank=hc/.test(url)).length, 1);
      const replay = A.birdGenSensitiveRows(new app.window.Date())[0];
      assert.equal(replay.notificationKey, first[0].notificationKey);
      assert.equal(replay.data['source-acquired-at'], first[0].data['source-acquired-at']);
      A.renderSurge([], [], [], [], [], { massSource: warm });
      const card = app.document.querySelector('#surgeFeed [data-alert-kind="sensitive"]');
      assert.ok(card, 'actual feed must render the new category, not only a helper result');
      assert.match(card.textContent, /SENSITIVE/);
      assert.match(card.textContent, /reported in Washington region in /);
      assert.equal(card.getAttribute('data-surge-latest'), String(first[0].time));
      const history = app.window.localStorage.getItem(A.sensitiveJournalKey());
      for (const change of [{ sourceOwner: 'wrong-owner' }, { sourceRegion: 'US-OR' }]) {
        A.birdGenSensitiveJournal({ ...source, acquired: true, inventoryComplete: true,
          state: 'ok', ...change }, new app.window.Date());
        assert.equal(app.window.localStorage.getItem(A.sensitiveJournalKey()), history);
      }
      const nextMonth = new Date();
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 15);
      A.birdGenSensitiveJournal(source, nextMonth);
      assert.equal(A.birdGenSensitiveRows(nextMonth).length, 0);
      const newMonth = nextMonth.getUTCFullYear() + '-' + String(nextMonth.getUTCMonth() + 1).padStart(2, '0');
      A.birdGenSensitiveJournal({ ...source, sourceMonth: newMonth }, nextMonth);
      assert.equal(A.birdGenSensitiveRows(nextMonth).length, 0);
      A.birdGenSensitiveJournal({
        ...source, sourceMonth: newMonth, acquiredAt: nextMonth.getTime(),
        acquired: true, inventoryComplete: true, state: 'ok'
      }, nextMonth);
      assert.equal(A.birdGenSensitiveRows(nextMonth).length, 1);
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
      baselineSensitive(app);
      const source = await A.loadMassFlockAlertSource(false, A.activeScope());
      const cards = A.birdGenSensitiveRows(new app.window.Date());
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
      assert.match(status.textContent, /Mass flock feeds: Partially loaded/);
      assert.match(status.textContent, /Patagonia[^:]*: Loading/);
      assert.match(status.textContent, /Hotspot activity feeds: Failed/);
      const limited = app.$('surgeResults').querySelector('[data-count-kind="mass"]');
      assert.match(limited.textContent, /⚠/);
      assert.match(limited.getAttribute('aria-label'), /Partially loaded/);
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
      assert.doesNotMatch(app.$('setupSheetBody').textContent, /city center.*no exact address/);
      app.click(app.$('setupHelp'));
      assert.match(app.$('appSheet').textContent, /city center.*no exact address/);
      assert.match(app.$('appSheet').textContent, /more Home\/region pairs later/);
      app.click(app.$('appSheet').querySelector('.sheetclose'));
      assert.equal(app.$('setupSkip'), null);
      assert.equal(app.$('setupChooseRegion'), null);
      assert.equal(app.$('setupSheetBody').querySelector('.setupprimary').id, 'setupHomeHere',
        'F1172 automatic location is offered first, without requesting permission on open');
      assert.equal(app.$('setupHomePlace').closest('details'), null, 'Home entry must not be hidden');
      assert.equal(app.$('setupHomeDiscard'), null, 'editing the field replaces a competing change button');
      assert.equal(A.getReportSlug(), '');
      app.$('setupHomePlace').value = 'Previously entered city';
      app.$('setupHomePlace').dispatchEvent(new app.window.Event('input'));
      app.click(app.$('setupHomeHere'));
      await waitFor(() => app.$('setupHomeApprove'), 'unaccepted device candidate');
      assert.equal(app.$('appSheet').dataset.infoId, 'setup-home-confirmed');
      assert.match(app.$('appSheet').textContent, /47\.60000, -122\.30000/);
      const confirmationMap = app.$('setupConfirmationMap');
      assert.equal(confirmationMap.closest('details'), null, 'F1173 map is not behind another click');
      assert.ok(confirmationMap.querySelector('svg'), 'F1173 selected-point map renders immediately');
      const previews = [];
      app.window.open = url => { previews.push(url); };
      const mapLink = app.$('appSheet').querySelector('[data-setup-confirm-map]');
      assert.equal(mapLink.tagName, 'A');
      assert.match(mapLink.href, /47\.6/);
      assert.equal(previews.length, 0, 'external Maps must not open automatically');
      app.click(mapLink);
      assert.equal(previews.length, 1, 'F1173 Open Maps uses the existing external launcher');
      assert.match(previews[0], /47\.6/);
      assert.equal(app.$('appSheet').hidden, false, 'opening Maps does not approve the candidate');
      assert.equal(A.getHome(), null);
      app.click(app.$('appSheet').querySelector('[data-setup-confirm-back]'));
      assert.equal(confirmationMap.childNodes.length, 0, 'detached confirmation map is cleaned up');
      assert.equal(app.$('setupHomeCandidate').getAttribute('role'), 'region', 'F1152 separate review card');
      assert.equal(app.$('setupHomeCandidateTitle').textContent, 'Home candidate');
      assert.match(app.$('setupHomeCandidate').textContent, /Current location \(GPS\)/);
      assert.match(app.$('setupActionStatus').textContent, /Current location found.*Nothing has been saved/);
      assert.equal(app.$('setupActionStatus').getAttribute('role'), 'status');
      assert.equal(app.$('setupHomeFind').hidden, true, 'only one validation action is visible');
      assert.equal(app.$('setupHomeApprove').textContent, 'Validate Home');
      assert.equal(app.$('setupHomePlace').value, '47.60000, -122.30000', 'GPS fills the same Home field');
      assert.equal(app.$('setupHomeMap').childNodes.length, 0, 'map must not load automatically');
      app.$('setupHomeMapPreview').open = true;
      await waitFor(() => app.$('setupHomeMap').childNodes.length, 'opt-in candidate map');
      assert.equal(app.$('setupHomeMap').getAttribute('aria-label'), 'Home candidate map');
      assert.equal(app.$('setupHomeMap').querySelector('svg') !== null, true,
        'the existing renderer provides its offline fallback when Leaflet is unavailable');
      assert.equal(app.$('setupHomePreview').tagName, 'BUTTON');
      assert.equal(app.$('setupSheetBody').querySelector('.setupprimary').id, 'setupHomeApprove',
        'F1158 reviewing the acquired candidate replaces the location action');
      assert.equal(previews.length, 1, 'F1152 returning to the field does not launch external Maps');
      app.click(app.$('setupHomePreview'));
      assert.equal(previews.length, 2, 'F1152 map preview remains a working explicit action');
      assert.match(previews[1], /47\.6/);
      assert.equal(app.state.locations.length, 1);
      assert.equal(A.getReportSlug(), '');
      assert.equal(A.getHome(), null);
      for (const index of [2, 3]) assert.equal(app.$('setupSheetBody')
        .querySelector('.setupprogress').children[index].querySelector('.setupdone'), null,
        'a GPS candidate must not complete Home or region');
      assert.equal(app.state.fetches.filter(url => /photon.*reverse/.test(url)).length, 0,
        'region was inferred before Home approval');
      app.click(app.$('setupHomeApprove'));
      app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
      await waitFor(() => app.$('setupNext'), 'Home-derived pair confirmation');
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'region');
      assert.equal(app.$('setupSheetBody').querySelector('.setupprimary').id, 'setupNext');
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
      for (const index of [2, 3]) {
        const check = app.$('setupSheetBody').querySelector('.setupprogress').children[index].querySelector('.setupdone');
        assert.equal(check.textContent, '✓', 'the saved matching pair completes Home and region');
        assert.equal(check.getAttribute('aria-label'), 'Completed');
      }
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
      const option = app.$('setupHomeOptions').querySelectorAll('[data-setup-home-option]')[1];
      option.checked = true;
      option.dispatchEvent(new app.window.Event('change', { bubbles: true }));
      assert.ok(app.$('appSheet') && !app.$('appSheet').hidden,
        'radio selection must open its result review');
      assert.match(app.$('setupHomeCandidate').textContent, /Springfield/);
      assert.equal(app.$('setupHomePlace').value, 'Springfield', 'F1152 search is retained for correction');
      app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
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
      app.$('setupHomePlace').dispatchEvent(new app.window.Event('input'));
      app.click(app.$('setupHomeFind'));
      await waitFor(() => app.$('appSheet')?.dataset.infoId === 'setup-home-confirmed'
        && !app.$('appSheet').hidden, 'coordinate review');
      app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
      await waitFor(() => /Retry the region lookup/.test(app.$('setupActionStatus').textContent), 'lookup failure');
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
      assert.equal(app.$('setupNext'), null);
      assert.equal(A.getReportSlug(), '');
      assert.equal(A.getHome(), null);
      failed = false;
      app.click(app.$('setupHomeApprove'));
      app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
      await waitFor(() => app.$('setupNext'), 'retried matching region');
      assert.equal(A.getReportSlug(), '', 'retry selected a region before confirmation');
      app.click(app.$('setupBack'));
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

  test('F1166 F1167 region confirmation shows its bundled outline and one path back to Home', async () => {
    const boundary = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'www', 'region-boundaries-wa.json'), 'utf8'));
    const app = await boot({ report: null, home: false, sample: false,
      storage: { bc_setup_step_v1: 'region', bc_setup_home_draft_v1: JSON.stringify({
        profile: '', approved: true, point: { lat: 47.6, lng: -122.3, label: 'Selected Home' },
        region: { code: 'US-WA', label: 'Washington', status: 'ok', lat: 47.6, lng: -122.3 }
      }) },
      fetch: url => url === 'region-boundaries-wa.json' ? boundary : null });
    try {
      const A = app.window.__app;
      A.openSetupSheet();
      await waitFor(() => app.$('setupRegionOutline').querySelector('svg'), 'bundled region outline');
      assert.equal(app.$('setupStepTitle').textContent, 'Confirm region');
      assert.equal(app.$('setupNext').textContent, 'Confirm region');
      assert.equal(app.$('setupChangeHome'), null, 'Back is the single correction path');
      const outline = app.$('setupRegionOutline');
      assert.equal(outline.hidden, false);
      assert.equal(outline.querySelector('svg').namespaceURI, 'http://www.w3.org/2000/svg',
        'SVG nodes must paint as graphics, not leak only plain text');
      assert.equal(outline.querySelector('path').namespaceURI, 'http://www.w3.org/2000/svg');
      assert.match(outline.querySelector('svg').getAttribute('aria-label'), /Washington.*US-WA.*Home marked/);
      assert.match(outline.querySelector('path').getAttribute('d'), /^M.*L.*Z$/);
      assert.equal(outline.querySelector('text').textContent, 'Home');
      assert.match(app.$('setupSheetBody').textContent, /To pick a different region, go back and select a different Home/);
      assert.match(app.$('setupSheetBody').textContent, /More regions are available after setup/);
      assert.equal(app.$('setupChooseRegion'), null);
      assert.equal(A.getHome(), null);
      assert.equal(A.getReportSlug(), '');
      assert.equal(app.state.locations.length, 0);
      app.click(app.$('setupBack'));
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
      assert.equal(app.$('setupHomePlace').value, '47.60000, -122.30000');
      assert.equal(A.getHome(), null, 'going back must not save the pair');
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1165 one Home field validates a waypoint, address or city and continues without saving', async () => {
    for (const value of ['47.6, -122.3', '123 Example Street, Seattle', 'Seattle']) {
      const app = await boot({ report: null, home: false, sample: false,
        storage: { bc_setup_step_v1: 'home' },
        fetch: url => /photon\.komoot\.io\/(api|reverse)/.test(url) ? preparedHomeRegion() : null });
      try {
        const A = app.window.__app;
        A.openSetupSheet();
        app.$('setupHomePlace').value = value;
        app.$('setupHomePlace').dispatchEvent(new app.window.Event('input'));
        app.click(app.$('setupHomeFind'));
        await waitFor(() => app.$('appSheet')?.dataset.infoId === 'setup-home-confirmed'
          && !app.$('appSheet').hidden, value + ' review');
        assert.equal(A.getHome(), null, 'reviewing the automatic result cannot save Home');
        app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
        await waitFor(() => app.$('setupNext'), value + ' continues to pair confirmation');
        assert.equal(app.$('setupSheetBody').dataset.setupStep, 'region');
        assert.match(app.$('setupHomeSuggested').textContent, /Washington/);
        assert.equal(A.getHome(), null, 'validation must not save Home');
        assert.equal(A.getReportSlug(), '', 'validation must not switch region');
        assert.equal(app.state.locations.length, 0, 'manual entry must not request device location');
        const search = app.state.fetches.filter(url => /photon.*\/api\//.test(url));
        if (value.includes('Example') || value === 'Seattle') {
          assert.equal(search.length, 1);
          assert.equal(new URL(search[0]).searchParams.get('q'), value);
        } else assert.equal(search.length, 0, 'coordinate waypoints need no forward geocoder');
        assert.deepEqual(app.state.errors, []);
      } finally { app.window.close(); }
    }
  });

  test('F1165 editing a reviewed Home removes stale approval actions and clears its old field map', async () => {
    for (const approved of [false, true]) {
      const app = await boot({ report: null, home: false, sample: false,
        storage: { bc_setup_step_v1: 'home', bc_setup_home_draft_v1: JSON.stringify({
          profile: '', point: { lat: 47.6, lng: -122.3, label: 'Synthetic Home' },
          approved, region: approved ? { status: 'ok', code: 'US-WA', label: 'Washington',
            lat: 47.6, lng: -122.3 } : null
        }) } });
      try {
        const A = app.window.__app;
        A.openSetupSheet();
        const oldAction = app.$(approved ? 'setupHomeReview' : 'setupHomeApprove');
        assert.equal(oldAction.hidden, false);
        app.$('setupHomeMapPreview').open = true;
        await waitFor(() => app.$('setupHomeMap').childNodes.length, 'field map preview');
        app.$('setupHomePlace').value = 'New synthetic city';
        app.$('setupHomePlace').dispatchEvent(new app.window.Event('input'));
        assert.equal(oldAction.hidden, true, 'old candidate actions must not compete with field validation');
        assert.equal(app.$('setupHomeCandidate').hidden, true);
        assert.equal(app.$('setupHomeMap').childNodes.length, 0);
        assert.equal(app.$('setupHomePreview').hidden, true);
        assert.equal(app.$('setupHomePreview').closest('details').hidden, true);
        assert.equal(app.$('setupHomeFind').hidden, false);
        assert.equal(app.$('setupSheetBody').querySelectorAll('.setupprimary').length, 1);
        assert.equal(app.$('setupSheetBody').querySelector('.setupprimary').id, 'setupHomeFind');
        assert.equal(A.getHome(), null);
        assert.deepEqual(app.state.errors, []);
      } finally { app.window.close(); }
    }
  });

  test('F1172 reusing saved Home reviews its map before deriving the matching region', async () => {
    const app = await boot({ report: 'wa', home: false, sample: false,
      storage: { bc_setup_step_v1: 'home', 'ebird_home_lat:wa': '47.6',
        'ebird_home_lng:wa': '-122.3', 'ebird_home_place:wa': 'Saved synthetic Home' },
      fetch: url => /photon.*reverse/.test(url) ? preparedHomeRegion('US-WA') : null });
    try {
      const A = app.window.__app, before = JSON.stringify(A.getHome());
      A.openSetupSheet();
      app.$('setupUseSavedHome').closest('details').open = true;
      app.click(app.$('setupUseSavedHome'));
      assert.ok(app.$('appSheet') && !app.$('appSheet').hidden, 'saved Home needs the same result review');
      assert.equal(app.$('appSheet').dataset.infoId, 'setup-home-confirmed');
      assert.match(app.$('appSheet').textContent, /Saved synthetic Home/);
      assert.ok(app.$('setupConfirmationMap').querySelector('svg'));
      assert.equal(app.state.fetches.filter(url => /photon.*reverse/.test(url)).length, 0);
      assert.equal(JSON.stringify(A.getHome()), before);
      app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
      await waitFor(() => app.$('setupNext'), 'saved Home region review');
      assert.equal(app.$('setupSheetBody').dataset.setupStep, 'region');
      assert.equal(JSON.stringify(A.getHome()), before);
      assert.equal(app.state.locations.length, 0);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1173 a changed Home draft or identity cannot open stale Maps or approve the old result', async () => {
    for (const change of ['draft', 'identity']) {
      const app = await boot({ report: null, home: false, sample: false,
        storage: { bc_setup_step_v1: 'home' } });
      try {
        const A = app.window.__app, opened = [];
        app.window.open = url => { opened.push(url); };
        A.openSetupSheet();
        app.$('setupHomePlace').value = '47.6, -122.3';
        app.$('setupHomePlace').dispatchEvent(new app.window.Event('input'));
        app.click(app.$('setupHomeFind'));
        await waitFor(() => app.$('appSheet')?.dataset.infoId === 'setup-home-confirmed'
          && !app.$('appSheet').hidden, 'selected Home confirmation');
        if (change === 'identity')
          A.applyCapturedIdentity({ status: 'ok', displayName: 'Different Synthetic Owner' });
        else {
          const draft = JSON.parse(app.window.localStorage.getItem('bc_setup_home_draft_v1'));
          draft.point = { lat: 48, lng: -123, label: 'Changed synthetic Home' };
          app.window.localStorage.setItem('bc_setup_home_draft_v1', JSON.stringify(draft));
        }
        app.click(app.$('appSheet').querySelector('[data-setup-confirm-map]'));
        assert.deepEqual(opened, [], change + ' must invalidate the old external-map action');
        app.click(app.$('appSheet').querySelector('[data-setup-confirm-continue]'));
        assert.equal(app.$('setupSheetBody').dataset.setupStep, 'home');
        assert.equal(app.$('setupSheet').inert, false);
        assert.equal(A.getHome(), null);
        assert.equal(A.getReportSlug(), '');
        assert.equal(app.state.fetches.filter(url => /photon.*reverse/.test(url)).length, 0);
        assert.deepEqual(app.state.errors, []);
      } finally { app.window.close(); }
    }
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

  test('F1084 F1155 F1156 setup actions share styling and open step-specific help without losing state', async () => {
    const app = await boot({ sample: false });
    try {
      const A = app.window.__app;
      for (const [step, copy] of [
        ['account', /Sign in directly.*does not need your password/],
        ['key', /Key verification is sent directly to eBird/],
        ['home', /city center is fine; no exact address is needed/],
        ['seen', /reads your eBird list for the selected region/],
        ['summary', /Reopen setup in Settings/]
      ]) {
        app.window.localStorage.setItem('bc_setup_step_v1', step);
        A.openSetupSheet();
        assert.doesNotMatch(app.$('setupSheetBody').textContent, copy,
          step + ' explanations belong in Help, not the action screen');
        const controls = [...app.$('setupSheetBody').querySelectorAll('button')];
        const primary = controls.filter(control => control.classList.contains('setupprimary')
          && !control.closest('[hidden]'));
        assert.equal(primary.length, 1, step + ' must guide the user with one recommended action');
        const reference = app.window.getComputedStyle(primary[0]);
        for (const control of controls) {
          const style = app.window.getComputedStyle(control);
          if (control !== primary[0] && control.id !== 'setupHelp') {
            assert.notEqual(style.fontSize, reference.fontSize, step + ': ' + control.id + ' must be quieter');
            assert.notEqual(style.fontWeight, reference.fontWeight, step + ': ' + control.id + ' must not compete');
          }
          assert.equal(style.textDecoration, 'none', step + ': ' + control.id);
        }
        assert.notEqual(app.window.getComputedStyle(app.$('setupSheetClose')).fontSize, reference.fontSize,
          'F1157 header Close must not inherit the large body-action treatment');
        assert.equal(app.$('setupHelp').textContent, '?', 'F1160 compact question-mark help, not a competing action');
        assert.equal(app.$('setupHelp').parentElement, app.$('setupStepTitle').parentElement,
          'F1168 contextual Help belongs beside the step heading');
        assert.notEqual(app.$('setupHelp').parentElement, primary[0].parentElement);
        assert.equal(app.window.getComputedStyle(app.$('setupHelp').firstElementChild).width, '28px',
          'the visible circle is smaller than its interactive target');
        for (const control of controls) assert.equal(app.window.getComputedStyle(control).whiteSpace, 'nowrap');
        assert.equal(app.$('setupHelp').getAttribute('aria-label'), 'Help: ' + primary[0].textContent.trim());
        if (step === 'account') {
          assert.match(app.$('setupSheetBody').textContent, /read-only access to your seen-bird list/);
          assert.match(app.$('setupSheetBody').textContent, /does not change your eBird records/);
        }
        if (step === 'account' || step === 'key') {
          const introduction = app.$('setupSheetBody').querySelector('.setupintro');
          assert.ok(introduction, 'F1169 short explanation belongs in the white card');
          assert.equal(app.$('setupStepTitle').parentElement.nextElementSibling, introduction,
            'the heading and smaller Help precede the explanation card');
          assert.equal(introduction.contains(app.$('setupHelp')), false);
          assert.equal(introduction.contains(primary[0]), false, 'the main button follows, outside the card');
          assert.match(introduction.textContent, step === 'account'
            ? /read-only access to your seen-bird list/ : /API key enables live sightings/);
          if (step === 'account') assert.equal(app.$('setupStepTitle').textContent, 'Connect your eBird Account');
        }
        const field = app.$(step === 'key' ? 'setupApiKey' : 'setupHomePlace');
        if (field) {
          field.value = step === 'key' ? 'SYNTHETIC_HELP_INPUT' : 'Example place';
          field.dispatchEvent(new app.window.Event('input'));
          assert.equal(app.$('setupSheetBody').querySelector('.setupprimary').id,
            step === 'key' ? 'setupVerifyKey' : 'setupHomeFind', 'F1158 entered input becomes the next action');
          if (step === 'key') {
            assert.equal(app.$('setupKeyAlternatives').open, true);
            assert.match(app.$('setupKeyExternal').textContent, /Copy.*browser/);
            assert.equal(app.$('setupKeyAlternatives').querySelector('summary').textContent, 'Other options');
          } else assert.equal(field.closest('details'), null);
        }
        const state = app.window.localStorage.getItem('bc_setup_home_draft_v1');
        app.$('setupHelp').focus();
        app.click(app.$('setupHelp'));
        const sheet = app.$('appSheet');
        assert.ok(sheet, step + ' Help action must open its information sheet');
        const close = sheet.querySelector('.sheetclose');
        assert.equal(sheet.hidden, false);
        assert.match(sheet.textContent, copy);
        assert.equal(sheet.querySelector('.sheettitle').textContent,
          app.$('setupHelp').getAttribute('aria-label'), 'F1160 Help names the actual current action');
        if (step === 'key') {
          assert.match(sheet.querySelector('.docintro').textContent, /Checks the key you entered directly with eBird/);
        } else if (step === 'home') {
          assert.match(sheet.querySelector('.docintro').textContent, /waypoint coordinates, address or city.*without requesting GPS/);
        }
        assert.equal(app.$('setupSheet').inert, true);
        assert.equal(app.$('setupSheet').getAttribute('aria-hidden'), 'true');
        assert.equal(app.window.document.activeElement, close);
        close.dispatchEvent(new app.window.KeyboardEvent('keydown',
          { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        const last = step === 'key' ? sheet.querySelector('summary') : close;
        assert.equal(app.window.document.activeElement, last, 'closed details cannot trap focus in hidden links');
        last.dispatchEvent(new app.window.KeyboardEvent('keydown',
          { key: 'Tab', bubbles: true, cancelable: true }));
        assert.equal(app.window.document.activeElement, close);
        close.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(sheet.hidden, true);
        assert.equal(app.$('setupSheet').hidden, false);
        assert.equal(app.$('setupSheet').inert, false);
        assert.equal(app.window.document.activeElement, app.$('setupHelp'));
        assert.equal(app.window.localStorage.getItem('bc_setup_home_draft_v1'), state);
        if (field) assert.equal(field.value, step === 'key' ? 'SYNTHETIC_HELP_INPUT' : 'Example place');
      }
      app.window.localStorage.setItem('bc_setup_home_draft_v1', JSON.stringify({
        profile: A.bcProfile(), point: { lat: 47.6, lng: -122.3, label: 'Example Home' },
        approved: true, region: { status: 'ok', code: 'US-WA', label: 'Washington',
          lat: 47.6, lng: -122.3 }
      }));
      app.window.localStorage.setItem('bc_setup_step_v1', 'region');
      A.openSetupSheet();
      app.click(app.$('setupHelp'));
      assert.match(app.$('appSheet').textContent, /No additional device-location request is needed/);
      app.click(app.$('appSheet').querySelector('.sheetclose'));
      assert.equal(app.$('appSheet').hidden, true);
      assert.equal(app.state.locations.length, 0);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
  });

  test('F1159 setup dismissal asks before discarding input, preserves Home drafts and does not interrupt completion', async () => {
    const app = await boot({ report: null, home: false, key: null, sample: false,
      storage: { bc_setup_step_v1: 'key' } });
    try {
      const A = app.window.__app, prompts = [];
      A.openSetupSheet();
      app.$('setupApiKey').value = 'SYNTHETIC_UNVERIFIED_DISMISS';
      app.$('setupApiKey').dispatchEvent(new app.window.Event('input'));
      app.window.confirm = message => { prompts.push(message); return false; };
      app.click(app.$('setupSheetClose'));
      assert.equal(app.$('setupSheet').hidden, false);
      assert.equal(app.$('setupApiKey').value, 'SYNTHETIC_UNVERIFIED_DISMISS');
      assert.match(prompts[0], /Are you sure.*Unverified key input will be discarded/);
      app.$('setupSheetClose').dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(prompts.length, 2);
      assert.equal(app.$('setupSheet').hidden, false);
      app.window.confirm = () => true;
      app.click(app.$('setupSheetClose'));
      assert.equal(app.$('setupSheet').hidden, true);
      assert.equal(app.$('setupApiKey').value, '');
      assert.equal(app.window.localStorage.getItem('ebird_api_key'), null);
      const draft = JSON.stringify({ profile: A.bcProfile(), query: 'Example city', approved: false });
      app.window.localStorage.setItem('bc_setup_home_draft_v1', draft);
      app.window.localStorage.setItem('bc_setup_step_v1', 'home');
      A.openSetupSheet();
      app.click(app.$('setupSheetClose'));
      assert.equal(app.$('setupSheet').hidden, true);
      assert.equal(app.window.localStorage.getItem('bc_setup_home_draft_v1'), draft);
      assert.deepEqual(app.state.errors, []);
    } finally { app.window.close(); }
    const ready = await boot({ sample: false, storage: { bc_setup_step_v1: 'summary' } });
    try {
      ready.window.__app.openSetupSheet();
      ready.window.confirm = () => { assert.fail('completion must not ask to abandon setup'); };
      ready.click(ready.$('setupContinue'));
      assert.equal(ready.$('setupSheet').hidden, true);
    } finally { ready.window.close(); }
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
