'use strict';

async function hotfixLayout(scan) {
  const A = window.__app, results = [];
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  async function record(label, run) {
    try {
      const measurements = await run();
      results.push(Object.assign(scan(label), {hotfixGeometry: measurements}));
    }
    catch (error) { results.push({label, fixtureError: error.message}); }
  }
  A.cancelStalledWork();
  A.setActiveReport('wa'); A.setCountyView('');
  await A.ensureActiveCountyCatalog();
  await record('F1545 actual cold/warm chooser workload', async () => {
    const timings = [], create = document.createElement.bind(document);
    let buttons = 0;
    document.createElement = function(tag, ...args) {
      if (tag === 'button') buttons++;
      return create(tag, ...args);
    };
    try {
      for (const state of ['cold', 'warm']) {
        const started = performance.now();
        A.openRegionChooser();
        await paint();
        const openToPaintMs = performance.now() - started;
        const search = document.getElementById('regionChooserSearch');
        for (const query of ['no-such-jurisdiction', 'British Columbia', 'US-WA-033', '']) {
          buttons = 0;
          search.value = query;
          const before = performance.now();
          search.oninput();
          const handlerMs = performance.now() - before;
          await paint();
          timings.push({state, query, buttons,
            matches:document.getElementById('regionChooserResults').children.length,
            handlerMs, inputToPaintMs:performance.now()-before, openToPaintMs});
          check(!document.getElementById('regionChooser').hidden, 'search must preserve the visible chooser');
        }
        document.getElementById('regionChooserClose').click();
      }
    } finally { document.createElement = create; }
    return {timings, nativeWhiteScreenVerified:false};
  });
  await record('F1546 F1547 shared submenu Home hit targets and return context', async () => {
    const saved = JSON.stringify([A.getHome(), A.tempHome(), A.activeScope(), A.personalPeriod()]);
    const controls = [];
    for (const section of ['sec-spLookupBtn', 'sec-rankBtn', 'sec-destBtn']) {
      A.showSection(section, {load:false});
      await paint();
      const home = document.getElementById('navHome'), region = document.getElementById('navRegion');
      check(home, 'submenu Home must exist');
      const box = home.getBoundingClientRect(), scope = region.getBoundingClientRect();
      check(box.width>=43.5 && box.height>=43.5 && box.left>=0 && box.right<=scope.left+.5,
        'submenu Home must retain a distinct 44px target before scope');
      check(home.contains(document.elementFromPoint(box.left+box.width/2, box.top+box.height/2)),
        'submenu Home must be independently hit-testable');
      home.focus(); home.click();
      await paint();
      const editor = document.getElementById(A.tempHome() ? 'settingsTempHomeEditor' : 'settingsHomeEditor');
      check(editor.open && document.activeElement===editor.querySelector('input'), 'active editor must receive focus');
      document.getElementById('navBack').click();
      await paint();
      check(!document.getElementById(section).hidden && document.activeElement===home,
        'Back must restore the submenu and Home focus');
      check(JSON.stringify([A.getHome(),A.tempHome(),A.activeScope(),A.personalPeriod()])===saved,
        'editor navigation must not change saved scope, period or Home');
      controls.push({section,home:box.toJSON(),scope:scope.toJSON()});
    }
    return {controls};
  });
  await record('F1545 actual held Stakeout entry and late-source ownership', async () => {
    const original = window.fetch;
    let settle;
    window.fetch = function(url, options) {
      if (/data\/obs\/US-WA\/recent\/coripl/.test(String(url)))
        return new Promise(resolve => { settle = () => resolve({ok:true,status:200,json:async()=>[]}); });
      return original(url, options);
    };
    try {
      A.showSection('sec-spLookupBtn', {load:false});
      const start = performance.now();
      const pending = A.lookupSpecies('coripl', 'Common Ringed Plover');
      await paint();
      const status = document.getElementById('spLookupStatus'), box = status.getBoundingClientRect();
      check(!status.hidden && box.width>0 && box.height>0 && status.textContent.trim(),
        'held sightings need a painted truthful loading surface');
      const firstPaintMs = performance.now()-start;
      for (let i=0; !settle && i<100; i++) await new Promise(resolve=>setTimeout(resolve,20));
      check(settle, 'held source must genuinely start');
      A.showSection('sec-rankBtn', {load:false});
      settle(); await pending; await paint();
      check(!document.getElementById('sec-rankBtn').hidden, 'late source must not navigate back to Stakeout');
      A.showSection('sec-spLookupBtn', {load:false});
      await paint();
      return {firstPaintMs, loading:box.toJSON(), lateSourceRejected:true, nativeWhiteScreenVerified:false};
    } finally { if (settle) settle(); window.fetch = original; A.clearSpeciesLookup(); A.showMenu(); }
  });
  return results;
}

module.exports = hotfixLayout;
