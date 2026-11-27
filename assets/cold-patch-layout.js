'use strict';

module.exports = async function coldPatchLayout(scan, preparePersonalFixture, progress) {
  const A = window.__app, originalFetch = window.fetch;
  const saved = new Map(Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)]));
  const results = [];
  let release, requestStarted = false;
  const responseGate = new Promise(resolve => { release = resolve; });
  const mark = progress || function () {};
  function check(ok, message) { if (!ok) throw new Error('F1532 '+message); }
  try {
    A.cancelStalledWork(); A.setActiveReport('wa'); A.setCountyView('');
    A.applyCapturedIdentity({status:'ok',displayName:'Sample Birder',profileId:'representative-owner'});
    mark('F1532 preparing exact personal fixture');
    await preparePersonalFixture(A,window,{yearList:[]},[
      {code:'amerob',name:'American Robin'},{code:'mallar3',name:'Mallard'},
    ]);
    localStorage.setItem('ebird_custom_regions',JSON.stringify([{
      slug:'u-cold-patch-review',label:'British Columbia',lat:48.45,lng:-123.4,
      stateCode:'CA-BC',tzStdOffset:-8,tzObservesDst:true,
    }]));
    A.setActiveReport('u-cold-patch-review');
    mark('F1532 preparing provincial card');
    const owner = A.personalListOwner();
    localStorage.setItem(A.bcReal(A.personalListKey(owner)),JSON.stringify({
      owner,source:A.personalListUrl(owner),readAt:new Date().toISOString(),readDate:A.todayStr(),
      codes:[],rows:[],declaredCount:0,coverage:'empty',unresolved:0,paginated:false,
    }));
    A.getReportSeen();
    check(A.personalListEvidence().complete,'exact provincial empty membership must qualify');
    const site = {locId:'L1532PHONE',locName:'Representative provincial marsh and wildlife area',
      lat:48.45,lng:-123.4,co:'CA-BC-CP',state:'CA-BC',country:'CA',n:200};
    localStorage.setItem('ebird_hotspots_v2:CA-BC',JSON.stringify({at:Date.now(),rows:[site]}));
    window.fetch = function(request,options) {
      if (/data\/obs\/L1532PHONE\/recent/.test(String(request))) {
        requestStarted = true;
        const rows = [{speciesCode:'mallar3',comName:'Mallard',locId:site.locId,
          obsDt:A.todayStr()+' 08:00',subId:'S1532PHONE',howMany:2}];
        return responseGate.then(()=>({ok:true,status:200,json:async()=>rows,text:async()=>JSON.stringify(rows)}));
      }
      return originalFetch.call(window,request,options);
    };
    const root = document.getElementById('destResults'), scope = A.activeScope();
    A.showSection('sec-destBtn',{load:false});
    A.renderDestinations([{...site,dist:1,score:1,rare:0,species:[{
      code:'amerob',comName:'American Robin',subId:'S1532SCORED',dateStr:A.todayStr()+' 07:00',
    }]}],document.getElementById('destMap'),root,true,false,scope);
    mark('F1532 hydrating provincial card');
    const pending = A.hydrateLocSpecies(root,null,scope);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    check(root.querySelector('.patch-loading')
      && /Checking recent sightings/.test(root.querySelector('.patch-loading').textContent)
      && /American Robin/.test(root.querySelector('.hslists').textContent),
    'held card hydration must visibly stay pending without replacing useful birds: '+JSON.stringify({
      requestStarted,caption:root.querySelector('.patch-loading')?.textContent || '',
      retained:root.querySelector('.hslists')?.textContent || ''
    }));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const pendingLayout = scan('F1541 pending provincial card hydration');
    check(pendingLayout.over<=.5 && pendingLayout.docScrollW<=innerWidth+.5
      && !['items','small','clipped','midword','crushed'].some(key=>(pendingLayout[key]||[]).length),
    'actual pending card feedback must fit the phone: '+JSON.stringify(pendingLayout));
    release(); release=null;
    await pending;
    check(requestStarted,'completed hydration must use the controlled observation provider');
    check(!root.querySelector('.patch-loading'),'finished card must retire its loading caption');
    root.insertAdjacentHTML('afterbegin','<p class="hint">REPRESENTATIVE STUB DATA</p>');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    check(/American Robin/.test(root.querySelector('.hslists').textContent)
      && /Mallard/.test(root.querySelector('.hslists').textContent),
    'scored and directory-verified inline birds must both remain visible');
    check(root.querySelector('[data-unseen-n="2"]'),'visible birds and target total must agree');
    const measured = scan('F1532 provincial hotspot inline birds');
    mark('F1532 provincial geometry complete');
    check(measured.over<=.5 && measured.docScrollW<=innerWidth+.5
      && !['items','small','clipped','midword','crushed'].some(key=>(measured[key]||[]).length),
    'actual provincial card must fit the phone: '+JSON.stringify(measured));
    results.push({...measured,coldPatchGeometry:{region:scope.effectiveRegion,targets:2,pendingFeedback:true}});
  } finally {
    if (release) release();
    A.cancelStalledWork(); window.fetch=originalFetch;
    for (const key of Object.keys(localStorage)) if (!saved.has(key)) localStorage.removeItem(key);
    for (const [key,value] of saved) localStorage.setItem(key,value);
    A.setActiveReport('wa'); A.setCountyView('');
  }
  return results;
};
