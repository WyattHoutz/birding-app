'use strict';

async function mapLayout(scan, mutation) {
  const A=window.__app, out=[];
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const check=(ok,message,data)=>{if(!ok)throw new Error(message+': '+JSON.stringify(data));};
  const box=node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height,top:r.top,bottom:r.bottom};};
  const savedFetch=window.fetch, slug=A.getReportSlug(), county=A.getCountyView();
  let homeKeys=[];
  try {
    A.cancelStalledWork();A.setActiveReport('wa');A.setCountyView('');
    homeKeys=['lat','lng'].map(part=>[A.homeKey(part),localStorage.getItem(A.homeKey(part))]);
    A.resetTransientAnchor();
    localStorage.setItem(A.homeKey('lat'),'46.4');localStorage.setItem(A.homeKey('lng'),'-120.4');
    const recentRow={subId:'S1395AUDIT',isoObsDate:A.todayStr()+' 09:00',numSpecies:12,
      loc:{locId:'L1395AUDIT',name:'Representative public patch',isHotspot:true,latitude:46.5,longitude:-120.5}};
    window.fetch=(url,init)=>/api\.ebird\.org/.test(String(url))?Promise.resolve({ok:true,status:200,
      headers:{get:()=>null},json:()=>Promise.resolve(/product\/lists\//.test(String(url))?[recentRow]:[])}):savedFetch(url,init);
    A.showSection('sec-destBtn',{load:false});
    const target=document.getElementById('destMap');
    const destinations=[{locId:'L1393AUDIT',locName:'Representative map patch',lat:46.5,lng:-120.5,
      score:1,dist:10,species:[{code:'verfly',name:'Vermilion Flycatcher'}]}];
    const create=window.L.map;
    let replacedMap;
    try {
      window.L.map=function(...args){
        if(mutation==='zoom-lifecycle')args[1]=Object.assign({},args[1],{zoomAnimation:true});
        replacedMap=create.apply(this,args);return replacedMap;
      };
      A.renderDestinations(destinations,target,document.getElementById('destResults'),true);
    }finally{window.L.map=create;}
    await paint();
    const zoom=replacedMap.getZoom();
    const zoomState={animated:replacedMap._zoomAnimated};
    if(zoomState.animated){
      await new Promise(resolve=>{
        replacedMap.once('zoomanim',()=>setTimeout(()=>{
          zoomState.activeAtRemoval=replacedMap._animatingZoom;
          A.renderDestinations(destinations,target,document.getElementById('destResults'),true);
          resolve();
        },0));
        replacedMap.zoomIn(1,{animate:true});
      });
    }else{
      replacedMap.zoomIn(1,{animate:true});
      A.renderDestinations(destinations,target,document.getElementById('destResults'),true);
    }
    check(replacedMap.getZoom()===zoom+1,'F1393 interactive zoom stopped working',{});
    await new Promise(resolve=>setTimeout(resolve,300));
    await paint();
    const canvas=target.querySelector('.mapcanvas');
    check(canvas&&canvas.querySelector('.leaflet-marker-icon'),'F1393 actual Leaflet map required',{});
    canvas.querySelector('.leaflet-marker-icon[title^="1:"]').click();
    await paint();
    check(canvas.querySelector('.leaflet-popup'),'F1393 actual map popup required',{});
    if(mutation==='containment')target.style.isolation='auto';
    document.getElementById('navRegion').focus();document.getElementById('navRegion').click();
    await paint();
    const bounds=canvas.getBoundingClientRect();
    let sampled=0,escaped=0,choices=0;
    for(let y=Math.max(0,bounds.top)+3;y<Math.min(innerHeight,bounds.bottom);y+=9)
      for(let x=Math.max(0,bounds.left)+3;x<Math.min(innerWidth,bounds.right);x+=9){
        const layers=document.elementsFromPoint(x,y), first=layers[0];sampled++;
        if(first&&first.closest('.regionchoice'))choices++;
        if(first&&target.contains(first))escaped++;
      }
    check(sampled>0&&choices>0&&escaped===0,'F1393 map escaped chooser hit-testing',{sampled,choices,escaped});
    const search=document.getElementById('regionChooserSearch');search.value='US-WA';search.dispatchEvent(new Event('input'));
    const filters=[...document.querySelectorAll('[data-region-location]')].map(button=>({label:button.textContent,...box(button)}));
    check(filters.length===3&&filters.every(r=>r.height>=43.5&&r.width>43.5),'F1392 filter targets must remain reachable',filters);
    document.getElementById('regionChooserClose').click();
    check(document.activeElement.id==='navRegion','F1393 chooser focus not restored',{});
    check(canvas.querySelector('.leaflet-marker-icon')&&canvas.querySelector('.leaflet-popup'),
      'F1393 underlying marker or popup state lost',{});
    const credits=target.querySelector('.mapcredits'), attribution=credits&&credits.querySelector('a[href="https://www.openstreetmap.org/copyright"]');
    if(mutation==='credits')credits.style.display='none';
    if(mutation==='credit-size')credits.style.fontSize='8px';
    const creditBox=credits&&box(credits), mapBox=box(canvas);
    const scale=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s'));
    check(attribution&&creditBox.height>0&&creditBox.top>=mapBox.bottom-.5
      && parseFloat(getComputedStyle(credits).fontSize)>=14*scale-.1,
      'F1394 readable required credit must be outside useful map', {creditBox,mapBox,scale});
    check(document.querySelector('footer a[href="https://leafletjs.com"]'),'F1394 Leaflet footer credit missing',{});
    check(!/Leaflet/.test(credits.textContent),'F1394 optional Leaflet credit belongs only in the footer',{});
    const maps=[];
    for(const id of ['destMap','excMap','hotMap','coldMap','cklMap','quickMap','favMap','spLookupMap']) {
      const host=document.getElementById(id);if(!host)throw new Error('Missing map '+id);
      const section=host.closest('section');A.showSection(section.id,{load:false});
      A.renderDestinations([],host,section.querySelector('ul')||document.getElementById('destResults'),true);
      await paint();
      const viewport=host.querySelector('.mapcanvas'), r=box(viewport), ratio=id==='spLookupMap'?8/7:8/5;
      check(r.width>0&&Math.abs(r.width/r.height-ratio)<.025,'F1395 shared viewport ratio mismatch',{id,...r});
      maps.push({id,...r});
    }
    A.showSection(document.getElementById('recentMap').closest('section').id,{load:false});
    A.clearChaseCache();
    window.BirdLogic.planConvoyFeeds(A.getReport()).forEach(feed=>{
      A.seedEbirdCache(window.BirdLogic.requestUrl(feed),[recentRow]);
    });
    await A.recentChecklistFilter('all','all');
    A.loadRecentChecklists();
    const ownRow=()=>document.querySelector('#recentResults [data-recent-sub="S1395AUDIT"]');
    for(let i=0;i<200&&!ownRow();i++)await new Promise(r=>setTimeout(r,25));
    const recent=document.querySelector('#recentMap .mapcanvas');
    check(recent&&ownRow(),'F1395 populated Recent loader did not render',{
      status:document.getElementById('recentStatus').textContent,
      result:document.getElementById('recentResults').textContent.slice(0,250),
      profile:A.bcProfile(),area:A.getReportSlug(),county:A.getCountyView(),
      sourceRows:document.querySelectorAll('#recentResults [data-recent-sub]').length});
    if(mutation==='sizing')recent.style.aspectRatio='auto';
    const recentBox=box(recent);
    check(recentBox.width>0&&Math.abs(recentBox.width/recentBox.height-8/5)<.025,
      'F1395 populated Recent map collapsed or changed ratio',recentBox);
    const savedL=window.L;
    try {window.L=undefined;A.renderRecentChecklistBatch([{subId:'S1395SVG',isoObsDate:A.todayStr()+' 09:00',
      loc:{locId:'L1395SVG',name:'Representative fallback patch',isHotspot:true,latitude:46.5,longitude:-120.5}}],1,1);}
    finally{window.L=savedL;}
    const fallback=document.querySelector('#recentMap .mapcanvas svg'), fallbackBox=fallback&&box(fallback);
    check(fallbackBox&&fallbackBox.height>0,'F1395 SVG fallback collapsed',fallbackBox);
    out.push(Object.assign(scan('F1392-F1395 actual maps and chooser'),{mapGeometry:{zoomState,sampled,choices,escaped,filters,mapBox,creditBox,maps,recentBox,fallbackBox}}));
  }catch(error){out.push({label:'F1392-F1395 map geometry',fixtureError:error.message});}
  finally{
    window.fetch=savedFetch;
    homeKeys.forEach(([key,value])=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value));
    A.setActiveReport(slug);A.setCountyView(county);A.showMenu();
  }
  return out;
}
module.exports=mapLayout;
