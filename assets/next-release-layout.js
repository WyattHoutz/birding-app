'use strict';

async function nextReleaseLayout(scan, mutation) {
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
