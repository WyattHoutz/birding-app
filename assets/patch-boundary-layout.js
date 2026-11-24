'use strict';

async function patchBoundaryLayout(scan, mutation) {
  const A = window.__app, results = [], originalFetch = window.fetch;
  const savedFavorites = A.getFavs();
  const originalNow = Date.now, pad = n=>String(n).padStart(2,'0');
  const paint = ()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const check = (ok,message)=>{if (!ok) throw new Error(message);};
  function stamp(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const now = Date.now(), site = {locId:'L1460LAYOUT',locName:'Boundary Marsh and Wildlife Area',
    lat:47.76,lng:-122.16,subnational2Code:'US-WA-061',subnational1Code:'US-WA',countryCode:'US'};
  const outside = {...site,lat:45.5,lng:-122.7,subnational2Code:'US-OR-005',subnational1Code:'US-OR'};
  const obs = ['warvir','comter','solsan','shtsan','verfly'].map((code,i)=>({...site,
    speciesCode:code,comName:['Warbling Vireo','Common Tern','Solitary Sandpiper',
      'Sharp-tailed Sandpiper','Vermilion Flycatcher'][i],
    subId:'S1460LAYOUT'+i,obsDt:stamp(now-3600000),howMany:i+1,locationPrivate:false,obsValid:true}));
  obs.push({...outside,speciesCode:'outsidegeometry',comName:'Outside Geometry Leak',
    subId:'S1460LAYOUTOUT',obsDt:stamp(now-3600000)});
  const history = [0,7,14,21,28,35].flatMap(days=>Array.from({length:days?1:6},(_,i)=>({
    subId:days?'S1460LAYOUTHISTORY'+days:'S1460LAYOUT'+i,loc:{...site},
    isoObsDate:stamp(now-days*86400000-3600000-i*60000),
    numSpecies:20,durationHrs:1,userDisplayName:'Sample observer '+i,
  })));
  const current = history.filter(row=>!row.subId.includes('HISTORY')).concat({
    subId:'S1460LAYOUTOUT',loc:{...outside},isoObsDate:stamp(now-3600000),
    numSpecies:999,durationHrs:1,userDisplayName:'Outside Geometry Observer',
  });
  let clock = now;
  async function record(label, section, root, prepare) {
    try {
      A.showSection(section,{load:false});
      await prepare();
      await paint();
      const el = document.getElementById(root);
      check(el && el.querySelector('.hscard-md, .hscard-lg, .icspot, .obs > li, .card-sm'),
        label+' must render actual production cards');
      check(!/Outside Geometry Leak|Outside Geometry Observer/.test(el.textContent),
        label+' must retain bounded evidence');
      if (mutation==='notice-overflow' && label==='F1460 Stakeout patches') {
        const notice = el.querySelector('.patchEvidenceWithheld');
        check(notice,'the negative control needs the real withheld notice');
        notice.style.whiteSpace='nowrap';
        notice.style.minWidth='900px';
      }
      const measured = scan(label);
      check(measured.over<=.5 && measured.docScrollW<=innerWidth+.5
        && !['items','small','clipped','midword','crushed'].some(key=>(measured[key]||[]).length)
        && !(measured.hotspotReadability||[]).some(card=>card.wordBroken||card.titleClipped),
      label+' production geometry must remain readable: '+JSON.stringify(measured));
      results.push({...measured,patchBoundaryGeometry:{section,
        cards:el.querySelectorAll('.hscard-md, .hscard-lg, .icspot').length}});
    } catch (error) {results.push({label,fixtureError:error.message});}
  }
  try {
    A.cancelStalledWork(); A.setActiveReport('wa'); A.setCountyView('');
    await A.ensurePatchScope(A.activeScope());
    window.fetch = function(request,options) {
      const url = String(request);
      if (/api\.ebird\.org/.test(url)) {
        let rows = [];
        if (/ref\/hotspot\//.test(url)) rows = [{...site,numSpeciesAllTime:200,latestObsDt:stamp(now-3600000)}];
        else if (/product\/lists\/L1460LAYOUT/.test(url)) rows = history;
        else if (/product\/lists\//.test(url)) rows = current;
        else if (/product\/checklist\/view\//.test(url)) {
          const subId = url.split('/').pop().split('?')[0];
          rows = {...site,subId,obsDt:stamp(now-3600000),durationHrs:1,numSpecies:20,obs:[]};
        } else if (/data\/obs\//.test(url)) rows = obs;
        return Promise.resolve({ok:true,status:200,json:async()=>rows,text:async()=>JSON.stringify(rows)});
      }
      return originalFetch(request,options);
    };
    Date.now = ()=>(clock+=3000);
    A.fgWindowReset(); A.fgSchedReset(clock);
    for (const row of current.concat(history)) A.seedChecklistView(row.subId,{
      ...site,subId:row.subId,obsDt:row.isoObsDate,durationHrs:1,numSpecies:20,obs:[],
    });
    const scope = A.activeScope();
    const destination = {...site,dist:1.2,score:10,rare:1,travelHours:.3,travelNote:'Local drive',
      species:obs.slice(0,5).map(row=>({code:row.speciesCode,comName:row.comName,
        dateStr:row.obsDt,subId:row.subId,count:row.howMany,rare:1}))};
    for (const [label,section,root,map] of [
      ['Today','sec-destBtn','destResults','destMap'],['Day-trip','sec-excBtn','excResults','excMap'],
    ]) await record('F1460 '+label,section,root,async()=>{
      A.renderDestinations([destination],document.getElementById(map),document.getElementById(root),
        true,false,scope);
      await A.hydrateLocSpecies(document.getElementById(root),null,scope);
      await A.hydrateHotspotChecklists(document.getElementById(root),scope);
    });
    await record('F1460 Nearby','sec-quickBtn','quickResults',()=>A.loadQuickOuting('home'));
    await record('F1460 Favorite patches','sec-favResults','favResults',async()=>{
      A.setFavs([{...site,id:site.locId,region:'US-WA'}]);
      await A.loadFavs();
    });
    let patches;
    await record('F1460 Cold patches','sec-coldBtn','coldResults',async()=>{
      patches = await A.runHotspotScan({});
      check(patches && patches.cold.length,'actual bounded Cold scan must produce an eligible patch');
    });
    await record('F1460 Busy patches','sec-hotBtn','hotResults',async()=>{
      check(patches && patches.busy.length,'actual bounded Busy scan must produce an eligible patch');
      A.renderHot(patches);
    });
    await record('F1460 Iconic patches','sec-iconicBtn','iconicResults',async()=>{
      A.setIconicRows([{...site,place:site.locName,code:'warvir',name:'Warbling Vireo',
        mult:20,n:100,effort:500,distMi:1.2,mi:1.2,county:'Snohomish'}]);
      document.getElementById('iconicByPlace').click();
    });
    await record('F1460 Stakeout patches','sec-stakeHsBtn','stakeHsResults',async()=>{
      A.renderStakeHs(site.locId,site.locName,current,obs,site,false,'loaded',null,
        {rba:[],twitches:[],rbaStatus:'loaded',twitchesStatus:'loaded'},scope);
      check(document.querySelector('#stakeHsResults .patchEvidenceWithheld'),
        'actual Stakeout must show its mixed-evidence disclosure');
    });
  } finally {
    A.cancelStalledWork(); window.fetch=originalFetch; Date.now=originalNow;
    A.fgWindowReset(); A.fgSchedReset(Date.now());
    A.setFavs(savedFavorites);
    A.setCountyView('');
  }
  return results;
}

module.exports = patchBoundaryLayout;
