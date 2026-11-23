'use strict';

async function nextReleaseLayout(scan, mutation, focus) {
  const A = window.__app, results = [];
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  async function record(label, fixture) {
    try {
      const measurements=await fixture();
      results.push(Object.assign(scan(label), {nextReleaseGeometry:measurements}));
    }
    catch (error) { results.push({label,fixtureError:error.message}); }
  }
  A.cancelStalledWork();
  A.setActiveReport('wa'); A.setCountyView('');
  await record('F1499/F1502 selected chooser and compact navbar globe', async () => {
    A.setCountyView('US-WA-033');
    A.showSection('sec-spLookupBtn',{load:false});
    await paint();
    const owner=A.activeScope().cacheIdentity;
    const navbar=document.getElementById('navbar'),button=document.getElementById('navRegion');
    const icon=button.querySelector('.navregionicon');
    if(mutation==='header-font')icon.style.fontSize='8px';
    if(mutation==='header-transparent')button.style.opacity='0';
    if(mutation==='globe-row') {
      navbar.style.flexWrap='wrap';
      button.parentElement.style.flexBasis='100%';
    }
    if(mutation==='globe-small') {
      Object.assign(button.style,{width:'12px',height:'12px',minWidth:'0',minHeight:'0'});
    }
    const box=button.getBoundingClientRect(),back=document.getElementById('navBack').getBoundingClientRect();
    const title=document.getElementById('navTitle'),titleBox=title.getBoundingClientRect();
    check(!document.getElementById('navPeriod')&&button.textContent.trim()==='\u{1F30E}',
      'F1502 section navbar must contain only the compact globe, not a year/region pair');
    check(getComputedStyle(button).opacity==='1'
      && parseFloat(getComputedStyle(icon).fontSize)>=parseFloat(getComputedStyle(title).fontSize),
      'F1502 globe must remain visible and scale with nearby header text');
    check(box.width>=43.5&&box.height>=43.5&&box.left>=0&&box.right<=innerWidth+.5,
      'F1502 globe must retain an in-viewport 44px target: '+JSON.stringify(box.toJSON()));
    const navBox=navbar.getBoundingClientRect(),style=getComputedStyle(navbar);
    const controls=[...navbar.children].map(node=>node.getBoundingClientRect()).filter(r=>r.width&&r.height);
    const tallest=Math.max(...controls.map(r=>r.height));
    check(navBox.height<=tallest+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)
      +parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth)+1
      && Math.abs(box.top+box.height/2-back.top-back.height/2)<1,
      'F1502 all navbar controls must remain in one compact row');
    check(box.width<=Math.max(back.width,44)+.5&&titleBox.width>0&&titleBox.right<=box.left+.5,
      'F1502 globe must stay compact and leave independent title space');
    const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
    check(hit&&button.contains(hit),'F1502 globe must remain independently hit-testable');
    button.focus();
    button.click();
    await paint();
    const current=document.querySelector('#regionChooserCurrent button');
    if(mutation==='selected-enabled')current.disabled=false;
    if(mutation==='selected-font')current.style.fontFamily='Arial';
    if(mutation==='selected-short') { current.style.minHeight='0';current.style.height='28px'; }
    check(current?.disabled&&current.getAttribute('aria-current')==='true'
      && /✅ Selected:/.test(current.textContent),'F1499 selected state must be explicit and natively disabled');
    const selected=current.getBoundingClientRect();
    check(selected.height>=43.5&&selected.width>=43.5
      && selected.left>=0&&selected.right<=innerWidth+.5,'F1499 current selection must remain readable: '
        +JSON.stringify(selected.toJSON()));
    const body=document.getElementById('regionChooserBody');
    check([...body.querySelectorAll(':scope > section > h3')].map(h=>h.textContent).join('|')
      ==='Current region|Recent regions|Major Regions|States, provinces and territories|County',
      'F1499 chooser groups must retain the requested order');
    const counties=document.getElementById('regionChooserCountyList');
    check(!counties.open,'F1499 county list must start collapsed');
    const summary=counties.querySelector('summary');
    summary.scrollIntoView({block:'center'});
    await paint();
    const disclosure=summary.getBoundingClientRect();
    check(disclosure.height>=43.5&&disclosure.left>=0&&disclosure.right<=innerWidth+.5,
      'F1499 independent county disclosure must remain reachable');
    summary.click();
    check(counties.open,'F1499 disabled selected region cannot disable county disclosure');
    document.getElementById('regionChooserClose').click();
    check(document.activeElement===button,'F1502 chooser dismissal must restore globe focus');
    window.scrollTo(0,0);
    A.showMenu();
    document.getElementById('hdrPeriod').click();
    await paint();
    check(!document.getElementById('menuPanel').hidden
      && document.activeElement.closest('.periodpick'),'F1502 main-menu year must retain the existing period picker');
    check(A.activeScope().cacheIdentity===owner,'F1502 opening selectors must not change the active account/scope/time');
    A.setCountyView('');A.showMenu();
    return {globe:box.toJSON(),navbar:navBox.toJSON(),selected:selected.toJSON(),disclosure:disclosure.toJSON()};
  });
  if(focus==='scope-headers')return results;
  await record('F1410 grouped FOY and Home', async () => {
    A.showSection('sec-surgeBtn',{load:false});
    const date=A.todayStr();
    const birds=[['comgra','Common Grackle'],['saggro','Greater Sage-Grouse'],
      ['amepip','American Pipit'],['norwat','Northern Waterthrush'],['solsan','Solitary Sandpiper']]
      .map(([code,name])=>({code,name,date}));
    A.renderSurge([],[],[],[],[],{foy:'ok',foyRows:birds,suppressNotifications:true});
    await paint();
    const card=document.querySelector('[data-alert-kind="foy"]');
    if (mutation==='foy-count') card.querySelector('.ppte-extra-birds').remove();
    check(card && !card.querySelector('details'),'FOY must be a card, not an inline drawer');
    check(card.querySelector('.ppte-extra-birds')?.textContent==='+3','FOY must show additional-bird count');
    check(card.querySelector('.surgekindtile').textContent==='🐣','FOY must use its menu icon');
    const title=card.querySelector('.surgealerttitle');
    const right=card.querySelector('.surgekindwrap').getBoundingClientRect();
    const range=document.createRange(); range.selectNodeContents(title);
    check([...range.getClientRects()].filter(r=>r.width).every(r=>r.right<=right.left+1
      || r.bottom<=right.top+1 || r.top>=right.bottom-1),
      'FOY title must not overlap its icon/time column');
    const recent=document.querySelector('[data-recent-kind="foy"]');
    check(recent && /and 3 more/.test(recent.querySelector('.surgealerttitle').textContent),
      'Home must retain the complete grouped headline');
    check(!recent.querySelector('.surgekindtile'),'Home must omit the large right icon');
    return {members:5,additional:3,home:true};
  });
  await record('F1418/F1419 compact FOY and full-view fallback', async () => {
    A.renderSurge([],[],[],[],[],{foy:'ok',foyRows:[{
      code:'amepip',name:'American Pipit',date:A.todayStr(),
      locId:'LFOYVIEW',locName:'Example Public Park'
    }],suppressNotifications:true});
    const source=document.querySelector('#surgeFeed [data-alert-kind="foy"]');
    const headline=source.querySelector('.surgealerttitle').innerHTML;
    A.showMenu();
    await paint();
    const recent=document.querySelector('#recentBirdGenRows [data-recent-kind="foy"]');
    check(recent.querySelector('.surgealerttitle').textContent==='First of the year American Pipit.',
      'compact FOY must omit its location without changing the bird headline');
    check(!recent.querySelector('.hslink,template,.surgekindwrap'),'compact FOY must remain abbreviated');
    check(source.querySelector('.surgealerttitle .hslink').dataset.loc==='LFOYVIEW',
      'full FOY must keep its independent public hotspot link');
    const definition=A.recentBirdGenViews.foy;
    try {
      delete A.recentBirdGenViews.foy;
      A.updateRecentBirdGen();
      await paint();
      const fallback=document.querySelector('#recentBirdGenRows [data-recent-view="full"]');
      const card=fallback && fallback.querySelector('.surgefeed > [data-alert-kind="foy"]');
      if (mutation==='fallback-compact') card.parentElement.classList.remove('surgefeed');
      check(card && card.querySelector('.surgealerttitle').innerHTML===headline,
        'missing Recent definition must render the full FOY headline');
      check(card.querySelector('template[data-surge-evidence]') && card.querySelector('.surgekindwrap'),
        'full fallback must retain evidence and its full icon/age');
      const high=document.documentElement.dataset.display==='high-visibility';
      const photo=card.querySelector(':scope > .name > .thumb').getBoundingClientRect();
      const width=card.clientWidth;
      check(high ? Math.abs(photo.width-width)<2 : photo.width>42,
        'full fallback must use full-card photo sizing, not compact styles: '
          +JSON.stringify({high,photo:photo.toJSON(),width,
            display:getComputedStyle(card.querySelector(':scope > .name')).display,
            className:document.documentElement.className,
            mode:document.documentElement.dataset.display}));
      const action=card.querySelector('.surgekindtile');
      action.scrollIntoView({block:'center'});
      await paint();
      const rect=action.getBoundingClientRect();
      const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
      check(hit && action.contains(hit),'full fallback action must be visible and hit-testable');
      action.click();
      check(!document.getElementById('sec-foyBtn').hidden,'full fallback must open the annual FOY list');
      return {compactLocationOmitted:true,fullFallback:true,fullPhotoWidth:photo.width};
    } finally {
      A.recentBirdGenViews.foy=definition;
      A.updateRecentBirdGen();
      A.showSection('sec-surgeBtn',{load:false});
      window.scrollTo(0,0);
    }
  });
  await record('F1413 Busy Patch menu glyph', async () => {
    const holder=document.createElement('ul'); holder.className='obs card-sm surgefeed';
    holder.innerHTML=A.surgeAlertCard({kind:'hotspot',name:'Example Public Park',
      when:A.todayStr(),time:Date.now(),why:'Synthetic Busy Patch evidence'},0);
    document.getElementById('surgeResults').append(holder);
    await paint();
    const tile=holder.querySelector('.surgekindtile');
    if (mutation==='busy-icon') tile.innerHTML='📍';
    check(tile.querySelectorAll('.busyPatchLogo .surgehotspotpeople > span').length===9,
      'Busy Patch alert must reuse the nine-party menu glyph');
    const logo=tile.querySelector('.busyPatchLogo');
    if (mutation==='busy-overflow') logo.querySelector('.surgehotspotthumb').style.width='200%';
    const box=tile.getBoundingClientRect(), glyph=logo.getBoundingClientRect();
    check(glyph.width>0 && glyph.left>=box.left-.5 && glyph.right<=box.right+.5,
      'Busy Patch glyph must fit its existing tile');
    for (const part of logo.querySelectorAll('*')) {
      const rect=part.getBoundingClientRect();
      check(rect.left>=glyph.left-.5 && rect.right<=glyph.right+.5
        && rect.top>=glyph.top-.5 && rect.bottom<=glyph.bottom+.5,
        'Busy Patch glyph descendants must fit the logo: '+part.className
          +' '+JSON.stringify({logo:glyph.toJSON(),part:rect.toJSON(),font:getComputedStyle(part).fontSize}));
    }
    holder.remove();
    return {groups:9};
  });
  await record('F1422 Stakeout search row and heading refresh', async () => {
    A.showSection('sec-spLookupBtn',{load:false});
    const input=document.getElementById('spLookup'), row=input.parentElement;
    const controls=[input,document.getElementById('spLookupBtn'),
      document.getElementById('spCodesBtn'),document.getElementById('spLookupClear')];
    const refresh=document.getElementById('spLookupRefresh');
    if(mutation==='stakeout-wrap') {
      row.style.flexWrap='wrap'; input.style.minWidth='100%';
    }
    if(mutation==='stakeout-refresh') row.appendChild(refresh);
    row.scrollIntoView({block:'center'});
    await paint();
    const rects=controls.map(control=>control.getBoundingClientRect());
    check(controls.every(control=>control.parentElement===row)
      && row.children.length===4,'Stakeout lookup must contain only Search, Go, Codes and Clear');
    check(rects.every(rect=>Math.abs(rect.top-rects[0].top)<1
      && rect.width>=43.9 && rect.height>=43.9
      && rect.left>=0 && rect.right<=window.innerWidth),
      'Stakeout controls must fit one row with 44px targets: '+JSON.stringify(rects.map(rect=>rect.toJSON())));
    controls.forEach((control,index)=>{
      const rect=rects[index], hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
      check(hit && control.contains(hit),'Stakeout search controls must be hit-testable');
    });
    check(refresh.matches('#sec-spLookupBtn > h2 > .refreshbtn')
      && refresh.previousElementSibling.matches('.docbtn'),
      'Stakeout Refresh must sit immediately after Info, not below the search');
    window.scrollTo(0,0);
    return {singleRow:true,controls:4,inputWidth:rects[0].width,headingRefresh:true};
  });
  await record('F1414 visible usable first board before pending sources', async () => {
    const fetch=window.fetch, cache=localStorage.getItem(A.RANK_CACHE_KEY);
    const held=[]; let load, expansionFailed=false;
    const failure=()=>({ok:false,status:503,text:async()=>''});
    function page(metric) {
      return '<link rel="canonical" href="https://ebird.org/top100?locInfo.regionCode=US-WA">'
        +'<select name="year"><option value="'+A.personalBoardPeriod()+'" selected="selected">Year</option></select>'
        +Array.from({length:500},(_,i)=>'<div id="rank-'+(i+1)+'" class="ResultsStats-index">'+(i+1)+'.</div>'
          +'<h5 id="Geometry Birder '+i+'" class="u-margin-none">Geometry Birder '+i+'</h5>'
          +['checklist','species'].map(kind=>'<div class="StatsIcon StatsIcon--highlight '
            +((kind==='checklist')===(metric==='cl')?'':'StatsIcon--muted')+'">'
            +'<svg class="Icon Icon--'+kind+'"></svg><div class="StatsIcon-stat-count">'+(6000-i)+'</div></div>').join('')
          +(i<2 ? '<span class="ResultsStats-details-detail">Ruff ('
          +new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+')</span>' : '')).join('');
    }
    function response(metric) {return {ok:true,status:200,text:async()=>page(metric)};}
    async function until(predicate,label) {
      const start=performance.now();
      while (!predicate()) {
        if (performance.now()-start>5000) throw new Error(label+' did not become ready');
        await new Promise(resolve=>setTimeout(resolve,20));
      }
    }
    function usable() {
      const row=document.querySelector('#rankResults .rankrow');
      check(row && /Geometry Birder/.test(row.textContent),'the first source must render actual rows');
      if (mutation==='rank-blocked') document.getElementById('rankBtn').disabled=true;
      check(!document.getElementById('rankBtn').disabled,'first board must enable refresh before remaining work settles');
      check(document.getElementById('rankStatus').getAttribute('aria-busy')!=='true',
        'first board must clear its scope-loading state');
      row.scrollIntoView({block:'center'});
      const rect=row.getBoundingClientRect();
      const hit=document.elementFromPoint(rect.left+rect.width/2,Math.max(1,rect.top+rect.height/2));
      check(rect.height>0 && hit && row.contains(hit),'first board must be visible and hit-testable');
      const checklist=document.querySelector('[data-rank-metric="cl"]');
      checklist.click();
      check(document.querySelector('[data-rank-metric="cl"]').getAttribute('aria-pressed')==='true',
        'first board metric control must accept input');
      document.querySelector('[data-rank-metric="spp"]').click();
      check(document.querySelector('#rankResults .rankrow'),'Species rows must remain usable after metric switching');
    }
    try {
      localStorage.removeItem(A.RANK_CACHE_KEY);
      window.fetch=function(url,options) {
        if (!/top100/.test(String(url))) return fetch.call(this,url,options);
        const query=new URL(url).searchParams, metric=query.get('rankedBy');
        if (metric==='spp' && query.get('maxResults')==='500') return Promise.resolve(response(metric));
        if (expansionFailed && query.get('maxResults')==='5000') return Promise.resolve(failure());
        return new Promise(resolve=>held.push({metric,max:query.get('maxResults'),resolve}));
      };
      A.showSection('sec-rankBtn',{load:false});
      const speciesMetric=document.querySelector('[data-rank-metric="spp"]');
      if (speciesMetric && speciesMetric.getAttribute('aria-pressed')!=='true') speciesMetric.click();
      load=A.loadRankings(true);
      await until(()=>held.some(r=>r.metric==='cl'),'pending Checklists source');
      await paint(); usable();
      held.find(r=>r.metric==='cl').resolve(response('cl'));
      await until(()=>held.some(r=>r.max==='5000'),'pending expansion source');
      await paint(); usable();
      expansionFailed=true;
      held.find(r=>r.max==='5000').resolve(failure());
      await load; load=null;
      check(/expansion failed; kept 500 rows/.test(document.getElementById('rankStatus').textContent),
        'failed expansion must preserve the initial board and name its coverage');
      return {firstRows:500,pendingChecklistsUsable:true,pendingExpansionUsable:true,retainedAfterFailure:true};
    } finally {
      A.cancelStalledWork();
      held.forEach(row=>row.resolve({ok:false,status:503,text:async()=>''}));
      if (load) await load;
      window.fetch=fetch;
      if (cache===null) localStorage.removeItem(A.RANK_CACHE_KEY); else localStorage.setItem(A.RANK_CACHE_KEY,cache);
      window.scrollTo(0,0);
    }
  });
  return results;
}

module.exports = nextReleaseLayout;
