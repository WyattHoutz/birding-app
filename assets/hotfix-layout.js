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
  await record('F1545 cold startup before app initialization', async () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox','allow-same-origin');
    frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:10000;background:white';
    try {
      const loaded = new Promise(resolve=>{ frame.onload=resolve; });
      frame.src='/index.html'; document.body.appendChild(frame);
      await loaded; await paint();
      const W=frame.contentWindow, doc=W.document;
      check(!W.__app, 'startup control must hold app-script execution');
      check([...doc.querySelectorAll('main > section.panel')].every(panel =>
        W.getComputedStyle(panel).display==='none'), 'uninitialized report panels must not paint');
      const status=doc.getElementById('startupStatus'), rect=status && status.getBoundingClientRect();
      check(status && !status.hidden && rect.width>0 && rect.height>0,
        'startup must expose visible truthful feedback');
      check(document.getElementById('startupStatus').hidden
        && document.querySelector('main').getAttribute('aria-busy')!=='true',
        'the actual initialized app must release startup protection');
      return {feedback:rect.toJSON(),rawPanelsHidden:true,nativeStartupDelayVerified:false};
    } finally { frame.remove(); }
  });
  await record('F1545 retained-scale provincial geography workload', async () => {
    const fetch=window.fetch, membership=window.BirdLogic.administrativeMembership;
    try {
      const ring=Array.from({length:6000},(_,i)=>{
        const angle=i*Math.PI*2/6000;
        return [-123.4+Math.cos(angle),48.45+Math.sin(angle)];
      });
      ring.push(ring[0]);
      window.fetch=(url,options)=>/geo\.statcan\.gc\.ca/.test(String(url))
        ? Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({
          type:'FeatureCollection',features:[{type:'Feature',properties:{PRUID:'59',
            PRENAME:'Synthetic provincial control'},geometry:{type:'Polygon',coordinates:[ring]}}]
        })}) : fetch(url,options);
      await A.loadRegionBoundary('CA-BC','CA-BC');
      await A.ensurePatchScope({effectiveRegion:'CA-BC'});
      let calls=0;
      window.BirdLogic.administrativeMembership=(...args)=>{ calls++; return membership(...args); };
      const rows=Array.from({length:3000},(_,i)=>({speciesCode:'control'+i,
        lat:48.45+(i%16)*0.001,lng:-123.4,subnational1Code:'CA-BC'}));
      const started=performance.now();
      const accepted=A.patchEvidenceRows(rows,{effectiveRegion:'CA-BC',publicEvidence:true});
      const elapsedMs=performance.now()-started;
      check(accepted.length===rows.length,'geographic reuse must preserve all qualified rows');
      check(calls===new Set(rows.map(row=>row.lat+','+row.lng)).size,
        'repeated species at the same geography must not repeat polygon traversal');
      return {rows:rows.length,vertices:ring.length,membershipCalls:calls,elapsedMs,
        nativeFreezeCauseVerified:false};
    } finally { window.fetch=fetch; window.BirdLogic.administrativeMembership=membership; }
  });
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
  await record('F1545 actual Full feed and refresh feedback paint', async () => {
    const timings = [], fetch = window.fetch;
    const reachability = A.LOADERS.surgeBtn.reachability;
    A.LOADERS.surgeBtn.reachability = false;
    window.fetch = () => new Promise(() => {});
    try {
      const now = Date.now();
      const inheritedFavoriteMembership = A.isSpeciesSeen('coripl', 'Common Ringed Plover');
      A.renderSurge([], [], [{locId:'LF1545PAINT',loc:'Public marsh',
        observers:10,baseline:2,ratio:5,latest:new Date(now-60000).toISOString(),
        lat:47.75,lng:-122.16}], [], [], {observations:'ok',suppressNotifications:true});
      for (const action of ['open','refresh']) {
        A.cancelStalledWork();
        if (action === 'open') A.showMenu();
        else A.showSection('sec-surgeBtn', {load:false});
        const feed = document.getElementById('surgeFeed');
        check(feed && feed.querySelector('[data-alert-kind="hotspot"][data-hsloc="LF1545PAINT"]'),
          'feedback control requires a genuinely qualified retained hotspot alert');
        const started = performance.now();
        document.getElementById(action === 'open' ? 'recentBirdGenOpen' : 'surgeBtn').click();
        const handlerMs = performance.now()-started;
        check(document.getElementById('surgeFeed')===feed, 'input handler must retain the painted feed');
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const status = document.getElementById('surgeStatus'), rect = status.getBoundingClientRect();
        check(!document.getElementById('sec-surgeBtn').hidden && !status.hidden
          && rect.width>0 && rect.height>0, 'the owned shell must expose visible feedback');
        check(document.getElementById('surgeFeed')===feed, 'first feedback frame must retain cards');
        timings.push({action,handlerMs,feedbackFrameMs:performance.now()-started});
        A.showSection('sec-rankBtn', {load:false});
        await paint();
        check(!document.getElementById('sec-rankBtn').hidden, 'retired feedback cannot navigate back');
      }
      return {timings,retainedCards:true,inheritedFavoriteMembership,nativeWhiteScreenVerified:false};
    } finally {
      A.cancelStalledWork(); window.fetch=fetch;
      A.LOADERS.surgeBtn.reachability=reachability;
    }
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
  await record('F1548 opt-in timing capture and Debug copy geometry', async () => {
    const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
    const toggle=document.getElementById('dbgTimingsToggle');
    let copied='';
    try {
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
        writeText:text=>{ copied=text; return Promise.resolve(); }
      }});
      document.getElementById('openDebugBtn').click();
      if(document.getElementById('dbgTools').hidden) document.getElementById('dbgMore').click();
      check(toggle && toggle.getAttribute('aria-pressed')==='false','timing capture must default off');
      toggle.click();
      A.loadSurgeRetained();
      document.getElementById('dbgCopy').click();
      await paint();
      check(copied.includes('PHASE TIMINGS JSON\n'),'Copy all must include opt-in phase evidence');
      const evidence=JSON.parse(copied.split('PHASE TIMINGS JSON\n')[1]);
      check(evidence.samples.length>0 && evidence.samples.length<=64,'timing evidence must be bounded');
      check(document.getElementById('dbgTimingStatus').textContent.includes('debug.copy.clipboard'),
        'clipboard completion must expose its separate elapsed measurement');
      const rect=toggle.getBoundingClientRect();
      check(rect.width>=44 && rect.height>=44 && rect.left>=0 && rect.right<=innerWidth,
        'timing capture must have a bounded accessible phone hit target');
      return {toggle:rect.toJSON(),samples:evidence.samples.length,
        optIn:true,nativeCpuProfileVerified:false};
    } finally {
      if(toggle && toggle.getAttribute('aria-pressed')==='true') toggle.click();
      document.getElementById('dbgClose').click();
      if(descriptor) Object.defineProperty(navigator,'clipboard',descriptor);
      else delete navigator.clipboard;
    }
  });
  return results;
}

module.exports = hotfixLayout;
