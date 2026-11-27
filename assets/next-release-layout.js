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
  await record('F1499/F1502 selected chooser and compact year-region link', async () => {
    A.setPersonalPeriod('current');
    A.setCountyView('US-WA-033');
    A.showSection('sec-spLookupBtn',{load:false});
    await paint();
    const owner=A.activeScope().cacheIdentity;
    const navbar=document.getElementById('navbar'),button=document.getElementById('navRegion');
    const tag=document.getElementById('navScopeTag');
    if(mutation==='scope-flat')tag.style.borderRadius='0';
    if(mutation==='header-font')button.style.fontSize='8px';
    if(mutation==='header-transparent')button.style.opacity='0';
    if(mutation==='scope-row') {
      navbar.style.flexWrap='wrap';
      button.parentElement.style.flexBasis='100%';
    }
    if(mutation==='scope-small') {
      Object.assign(button.style,{width:'12px',height:'12px',minWidth:'0',minHeight:'0'});
    }
    if(mutation==='scope-wrap')button.parentElement.style.flex='0 1 auto';
    const box=button.getBoundingClientRect(),back=document.getElementById('navBack').getBoundingClientRect();
    const title=document.getElementById('navTitle'),titleBox=title.getBoundingClientRect();
    const year=String(new Date().getFullYear());
    check(!document.getElementById('navPeriod')&&button.textContent===year+' US-WA-033',
      'F1502 one link must show the four-digit year and effective county code');
    check(getComputedStyle(button).opacity==='1'
      && parseFloat(getComputedStyle(button).fontSize)>=parseFloat(getComputedStyle(title).fontSize)*.7,
      'F1502 scope link must remain visible and scale with header text');
    const tagBox=tag.getBoundingClientRect(),tagStyle=getComputedStyle(tag);
    check(parseFloat(tagStyle.borderTopWidth)>=1&&parseFloat(tagStyle.borderRadius)>=tagBox.height/2,
      'F1502 scope text must retain the shared rounded outlined tag');
    check(box.width>=43.5&&box.height>=43.5&&box.left>=0&&box.right<=innerWidth+.5,
      'F1502 scope link must retain an in-viewport 44px target: '+JSON.stringify(box.toJSON()));
    const navBox=navbar.getBoundingClientRect(),style=getComputedStyle(navbar);
    const controls=[...navbar.children].map(node=>node.getBoundingClientRect()).filter(r=>r.width&&r.height);
    const tallest=Math.max(...controls.map(r=>r.height));
    check(navBox.height<=tallest+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)
      +parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth)+1
      && Math.abs(box.top+box.height/2-back.top-back.height/2)<1,
      'F1502 all navbar controls must remain in one compact row');
    check(titleBox.width>0&&titleBox.right<=box.left+.5,
      'F1502 scope link must leave independent title space');
    check(box.height<=Math.max(back.height,44)+1,
      'F1502 scope link must not make the compact navbar taller');
    function checkText() {
      const rect=button.getBoundingClientRect(),range=document.createRange();
      range.selectNodeContents(tag);
      check([...range.getClientRects()].every(r=>r.left>=rect.left-.5&&r.right<=rect.right+.5
        &&r.top>=rect.top-.5&&r.bottom<=rect.bottom+.5),
        'F1502 year and region text must remain fully visible inside the link');
      return rect.toJSON();
    }
    checkText();
    const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
    check(hit&&button.contains(hit),'F1502 scope link must remain independently hit-testable');
    A.setPersonalPeriod('all');
    await paint();
    check(button.textContent==='All US-WA-033','F1502 link must refresh when the period changes');
    const allTime=checkText();
    A.setCountyView('');
    A.showSection('sec-spLookupBtn',{load:false});
    await paint();
    check(button.textContent==='All US-WA','F1502 link must refresh to the parent region code');
    checkText();
    A.setCountyView('US-WA-033');A.setPersonalPeriod('current');
    await paint();
    const titles=[];
    if(mutation==='scope-title-wrap')title.style.whiteSpace='normal';
    for(const section of [...document.querySelectorAll('section.panel[id]')]
      .filter(node=>node.id!=='menuPanel'&&node._enabled!==false)) {
      A.showSection(section.id,{load:false});
      await paint();
      const heading=title.getBoundingClientRect(),target=button.getBoundingClientRect();
      check(getComputedStyle(title).whiteSpace==='nowrap'
        &&title.scrollHeight<=title.clientHeight+1&&heading.width>0&&heading.right<=target.left+.5
        &&navbar.getBoundingClientRect().height<=navBox.height+.5,
        'F1502 long menu titles must not wrap or grow the navbar: '+title.textContent);
      titles.push({title:title.textContent,width:heading.width,truncated:title.scrollWidth>title.clientWidth});
    }
    check(titles.length>=20,'F1502 title proof must enumerate the actual menu catalog');
    A.showSection('sec-spLookupBtn',{load:false});
    await paint();
    localStorage.setItem('bc_recent_regions_v1',JSON.stringify(['county:wa:US-WA-061','lower48','aba','wa']));
    if(mutation==='chooser-wide')document.getElementById('regionChooser').style.gridTemplateColumns='auto';
    button.focus();
    button.click();
    await paint();
    const current=document.querySelector('#regionChooserCurrent button');
    if(mutation==='selected-enabled')current.disabled=false;
    if(mutation==='selected-font')current.style.fontFamily='Arial';
    if(mutation==='selected-center')current.style.textAlign='center';
    if(mutation==='selected-color')current.style.color='#0072b2';
    if(mutation==='selected-background')current.style.backgroundColor='#fff';
    if(mutation==='selected-short') { current.style.minHeight='0';current.style.height='28px'; }
    check(current?.disabled&&current.getAttribute('aria-current')==='true'
      && /^✅ /.test(current.textContent)&&!/\bSelected\b/i.test(current.textContent),
      'F1499 selected state must use only a checkmark and remain natively disabled');
    const currentStyle=getComputedStyle(current);
    check(currentStyle.textAlign==='left'&&currentStyle.color==='rgb(0, 0, 0)'
      &&currentStyle.backgroundColor==='rgb(238, 238, 238)',
      'F1502 current region must be left-aligned with black text on light gray');
    const periodHost=document.getElementById('regionChooserPeriod');
    const location=document.getElementById('regionChooserLocation');
    const reference=document.getElementById('destBtn').closest('section').querySelector('.modeswitch');
    const modeShape=host=>[...host.querySelectorAll('.modebtn')].map(choice=>[
      choice.querySelector('.mbico').innerHTML,choice.querySelector('.mbtxt').textContent]);
    check(location.classList.contains('modeswitch')&&JSON.stringify(modeShape(location))===JSON.stringify(modeShape(reference))
      &&!location.querySelector('[data-anchor],[data-goto]'),
      'F1502 location chooser must share Today’s patches mode template without ranking or navigation actions');
    const heightControl=reference.cloneNode(true);
    heightControl.style.cssText='position:absolute;visibility:hidden;width:'+location.getBoundingClientRect().width+'px';
    heightControl.setAttribute('aria-hidden','true');
    heightControl.inert=true;
    location.parentElement.appendChild(heightControl);
    const modeHeights={chooser:location.getBoundingClientRect().height,
      reference:heightControl.getBoundingClientRect().height,
      chooserMinimum:getComputedStyle(location.querySelector('.modebtn')).minHeight,
      referenceMinimum:getComputedStyle(heightControl.querySelector('.modebtn')).minHeight};
    heightControl.remove();
    check(Math.abs(modeHeights.chooser-modeHeights.reference)<1
      &&modeHeights.chooserMinimum===modeHeights.referenceMinimum,
      'F1502 chooser mode bar must match Today’s patches height: '+JSON.stringify(modeHeights));
    const recent=document.getElementById('regionChooserRecent');
    if(mutation==='recent-wrap')recent.style.flexWrap='wrap';
    const recentCodes=[...recent.children].map(choice=>choice.textContent);
    check(!document.getElementById('regionChooserRecentSection').hidden&&recentCodes.length===4,
      'F1502 populated Recent must appear in top Quick settings');
    const recentBoxes=[...recent.children].map(choice=>choice.getBoundingClientRect());
    check(getComputedStyle(recent).flexWrap==='nowrap'
      &&['auto','scroll'].includes(getComputedStyle(recent).overflowX)
      &&recentBoxes.every(rect=>Math.abs(rect.top-recentBoxes[0].top)<1
        &&rect.width>=43.5&&rect.height>=43.5),
      'F1502 Recent codes must remain one horizontally scrollable row of touch targets');
    for(const choice of [...recent.children]) {
      recent.scrollLeft+=choice.getBoundingClientRect().left-recent.getBoundingClientRect().left-2;
      await paint();
      const rect=choice.getBoundingClientRect(),strip=recent.getBoundingClientRect();
      check(rect.left>=strip.left-.5&&rect.right<=strip.right+.5
        &&choice.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)),
        'F1502 every Recent code must be horizontally reachable without wrapping');
    }
    recent.scrollLeft=0;
    await paint();
    const recentGeometry={codes:recentCodes,width:recent.clientWidth,scrollWidth:recent.scrollWidth};
    const search=document.getElementById('regionChooserSearch').getBoundingClientRect();
    for(const option of periodHost.querySelectorAll('button')) {
      const rect=option.getBoundingClientRect();
      check(rect.width>=43.5&&rect.height>=43.5&&rect.left>=0&&rect.right<=innerWidth+.5
        &&rect.bottom<=search.top+.5&&option.contains(document.elementFromPoint(
          rect.left+rect.width/2,rect.top+rect.height/2)),
        'F1502 chooser time toggle must be reachable above region search: '+JSON.stringify({
          option:rect.toJSON(),search:search.toJSON(),hit:document.elementFromPoint(
            rect.left+rect.width/2,rect.top+rect.height/2)?.outerHTML}));
    }
    periodHost.querySelector('[data-personal-period="all"]').click();
    check(A.personalPeriod()==='all'&&!document.getElementById('regionChooser').hidden,
      'F1502 chooser life-list toggle must change the shared period without closing');
    periodHost.querySelector('[data-personal-period="current"]').click();
    const selected=current.getBoundingClientRect();
    check(selected.height>=43.5&&selected.width>=43.5
      && selected.left>=0&&selected.right<=innerWidth+.5,'F1499 current selection must remain readable: '
        +JSON.stringify(selected.toJSON()));
    const body=document.getElementById('regionChooserBody');
    check([...body.querySelectorAll(':scope > section > h3')].map(h=>h.textContent).join('|')
      ==='Current region|Major Regions|States, provinces and territories|County',
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
    const fetchBefore=window.fetch;
    let homeStack=[];
    try {
      window.fetch=function(url,options) {
        return /photon\.komoot\.io\/reverse/.test(String(url))
          ?Promise.resolve(new Response(JSON.stringify({features:[{properties:{state:'Washington',countrycode:'US'}}]}),
            {headers:{'Content-Type':'application/json'}}))
          :fetchBefore(url,options);
      };
      document.querySelector('[data-region-location="home"]').click();
      for(let attempt=0;attempt<120&&/Resolving/.test(
        document.getElementById('regionChooserLocationStatus').textContent);attempt++)await paint();
      const stack=document.getElementById('regionChooserLocationStack');
      const stackCodes=[...stack.children].map(choice=>choice.dataset.regionChoice);
      check(!stack.hidden&&stack.children.length>=3
        &&new Set(stackCodes).size===stackCodes.length
        &&!stackCodes.some(value=>/^county:[^:]+:$/.test(value))
        &&!document.getElementById('regionChooserRecentSection').hidden
        &&JSON.stringify([...recent.children].map(choice=>choice.textContent))===JSON.stringify(recentCodes)
        &&document.getElementById('regionChooserFind').hidden,
        'F1502 Home must show a unique flat verified stack with shared Recent and no Find search');
      for(const choice of stack.querySelectorAll('button')) {
        choice.scrollIntoView({block:'center'});
        await paint();
        const rect=choice.getBoundingClientRect();
        check(rect.width>=43.5&&rect.height>=43.5&&rect.left>=0&&rect.right<=innerWidth+.5
          &&choice.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)),
          'F1502 flat location region buttons must remain independently reachable');
        homeStack.push({code:choice.dataset.regionChoice,rect:rect.toJSON()});
      }
      document.querySelector('[data-region-location="all"]').click();
      check(stack.hidden&&!document.getElementById('regionChooserFind').hidden,
        'F1502 Find must restore the searchable full catalog');
    } finally {window.fetch=fetchBefore;}
    document.getElementById('regionChooserClose').click();
    check(document.activeElement===button,'F1502 chooser dismissal must restore scope-link focus');
    window.scrollTo(0,0);
    A.showMenu();
    const mainScope=document.getElementById('hdrScope'),home=document.getElementById('hdrHome');
    check(!document.getElementById('hdrPeriod')&&home.nextElementSibling===mainScope,
      'F1536 Home must precede the single main-menu year-region chooser');
    const mainHeader=[];
    for (const period of ['current','all']) {
      A.setPersonalPeriod(period);await paint();
      const expected=(period==='all'?'All':year)+' US-WA-033';
      check(mainScope.textContent===expected&&mainScope.textContent===tag.textContent,
        'F1536 main and submenu labels must share exact year and county context');
      if(mutation==='header-home-small')
        Object.assign(home.style,{minWidth:'0',minHeight:'0',width:'20px',height:'20px'});
      if(mutation==='header-scope-small')
        Object.assign(mainScope.style,{minHeight:'0',height:'20px'});
      if(mutation==='header-overlap')home.style.transform='translateX(60px)';
      const mainTag=mainScope.querySelector('.tag');
      if(mutation==='header-pill-mismatch')mainTag.style.padding='0';
      if(mutation==='header-pill-short') {
        mainTag.style.paddingTop='0';mainTag.style.paddingBottom='0';
        tag.style.paddingTop='0';tag.style.paddingBottom='0';
      }
      const hr=home.getBoundingClientRect(),sr=mainScope.getBoundingClientRect();
      check(hr.width>=43.5&&hr.height>=43.5&&sr.width>=43.5&&sr.height>=43.5,
        'F1536 Home and combined scope must retain 44px touch targets');
      check(hr.left>=0&&sr.right<=innerWidth+.5&&hr.right<=sr.left+.5
        &&Math.abs(hr.top+hr.height/2-sr.top-sr.height/2)<1,
        'F1536 Home must precede the combined scope without overlap or clipping');
      for (const target of [home,mainScope]) {
        const rect=target.getBoundingClientRect();
        check(target.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)),
          'F1536 each main header action must be independently hit-testable');
      }
      const mainStyle=getComputedStyle(mainTag),subStyle=getComputedStyle(tag);
      check(['padding','borderRadius','border','backgroundColor','fontSize','fontWeight']
        .every(property=>mainStyle[property]===subStyle[property]),
        'F1536 main and submenu pills must use the same style');
      check(parseFloat(mainStyle.paddingTop)>=parseFloat(mainStyle.paddingLeft),
        'F1536 shared scope pills must keep their taller vertical padding');
      const range=document.createRange();range.selectNodeContents(mainTag);
      check([...range.getClientRects()].every(r=>r.left>=sr.left-.5&&r.right<=sr.right+.5
        &&r.top>=sr.top-.5&&r.bottom<=sr.bottom+.5),
        'F1536 combined year-region text must remain fully visible');
      mainHeader.push({period,home:hr.toJSON(),scope:sr.toJSON(),pill:mainTag.getBoundingClientRect().toJSON()});
    }
    A.setPersonalPeriod('current');await paint();
    mainScope.focus();mainScope.click();
    await paint();
    check(!document.getElementById('regionChooser').hidden
      &&document.getElementById('regionChooserPeriod').querySelector('[aria-pressed="true"]'),
      'F1536 combined main-menu year-region button must open the chooser with period controls');
    document.getElementById('regionChooserClose').click();
    check(document.activeElement===mainScope,'F1536 chooser dismissal must restore combined-button focus');
    check(A.activeScope().cacheIdentity===owner,'F1502 opening selectors must not change the active account/scope/time');
    A.setCountyView('');A.showMenu();
    return {scopeLink:box.toJSON(),tag:tagBox.toJSON(),allTime,navbar:navBox.toJSON(),
      menuTitles:titles.length,longestTitles:titles.sort((a,b)=>b.title.length-a.title.length).slice(0,5),
      recent:recentGeometry,modeHeights,
      selected:selected.toJSON(),disclosure:disclosure.toJSON(),homeStack,mainHeader};
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
