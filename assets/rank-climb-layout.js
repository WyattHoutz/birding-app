'use strict';

async function rankClimbLayout(scan, mutation) {
  const A = window.__app, results = [];
  const identity = localStorage.getItem(A.IDENTITY_META_KEY);
  const armSamples = new Map();
  const check = (ok, message, value) => {
    if (!ok) throw new Error('F1398 '+message+': '+JSON.stringify(value));
  };
  const period = String(new Date().getFullYear());
  const rows = Array.from({length:5001}, (_,i) => {
    const rank = i>=1974 && i<2000 ? 1975 : i>=2964 && i<3000 ? 2965 : i+1;
    return {rank,species:6002-rank,
      profileId:i===5000?'synthetic-owner':'synthetic-'+i,name:'Synthetic birder'};
  });
  const board = {region:'US-WA',period,metric:'spp',rows,me:rows[5000]};
  const recent = ['Common Ringed Plover','American Golden-Plover'].map(name=>
    name+' ('+new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+')');
  const paint = async () => {
    if (typeof auditStage==='function') auditStage('F1398 paint cancel '+board.rows.length+' '+Math.round(performance.now()));
    A.cancelStalledWork();
    if (typeof auditStage==='function') auditStage('F1398 paint show '+Math.round(performance.now()));
    A.showSection('sec-rankBtn',{load:false});
    if (typeof auditStage==='function') auditStage('F1398 paint render '+Math.round(performance.now()));
    board.rows.slice(0,2).forEach((row,index)=>{row.recent=recent[index];});
    A.renderRankPair({boards:{spp:board},failures:{},stale:{}},'US-WA',period,'Synthetic birder');
    if (typeof auditStage==='function') auditStage('F1398 paint clear '+Math.round(performance.now()));
    const species = document.querySelector('[data-rank-metric="spp"]');
    if (species && species.getAttribute('aria-pressed')!=='true') species.click();
    // Keep complete goal evidence and the two real rows required by the shared icon audit.
    Array.from(document.querySelectorAll('#rankResults .rankrow')).slice(2).forEach(row=>row.remove());
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  };
  async function measure(label) {
    const stage = name => {
      if (typeof auditStage==='function') auditStage(label+' '+name+' '+Math.round(performance.now()));
    };
    stage('start');
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s'));
    const root = document.querySelector('.rankclimb');
    const icons = Array.from(root.querySelectorAll('.rankclimb-rank > svg'));
    const laurels = icons.filter(svg=>svg.classList.contains('rankclimb-laurel'));
    if (mutation==='crowding') {
      icons.forEach(svg=>{
        svg.parentElement.style.columnGap='0px';
        if (svg.classList.contains('rankclimb-laurel')) svg.style.width='calc(66px * var(--s))';
      });
    }
    if (mutation==='rank-size') root.querySelectorAll('.three-digit .rankclimb-rank')
      .forEach(badge=>{badge.style.fontSize='calc(25px * var(--s))';});
    if (mutation==='right-inset') root.querySelectorAll('.rankclimb-rank')
      .forEach(badge=>{badge.style.flexBasis='calc(132px * var(--s))';});
    if (mutation==='color') laurels.forEach(svg=>{svg.parentElement.style.background='#E69F00';});
    if (mutation==='arrows') root.querySelectorAll('.rankclimb-arrow svg')
      .forEach(svg=>{svg.style.width='13px';svg.style.height='7px';});
    if (['numeral-low','numeral-crowding','numeral-small'].includes(mutation)) laurels.forEach(svg=>{
      const number = svg.querySelectorAll('text')[1];
      if (mutation==='numeral-small' && number.hasAttribute('textLength')) return;
      if (mutation==='numeral-low') number.setAttribute('y','44');
      else number.style.fontSize=mutation==='numeral-small'?'12px':'26px';
    });
    if (mutation) await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    stage('spacing');
    const spacing = icons.map(svg=>{
      const box = svg.getBoundingClientRect(), badge = svg.parentElement.getBoundingClientRect();
      const number = svg.parentElement.querySelector('.rankclimb-number').getBoundingClientRect();
      return {center:box.left+box.width/2,rankLeft:number.left,gap:number.left-box.right,
        left:box.left-badge.left,top:box.top-badge.top,bottom:badge.bottom-box.bottom};
    });
    check(spacing.every(item=>item.gap>=14*scale && item.left>=10*scale
      && item.top>=3.9*scale && item.bottom>=3.9*scale),'icon padding',spacing);
    check(!spacing.length || Math.max(...spacing.map(item=>item.center))
      -Math.min(...spacing.map(item=>item.center))<=.5,'aligned icon centers',spacing);
    check(!spacing.length || Math.max(...spacing.map(item=>item.rankLeft))
      -Math.min(...spacing.map(item=>item.rankLeft))<=.5,'aligned actual ranks',spacing);
    stage('text');
    const text = Array.from(root.querySelectorAll('.rankclimb-number,.rankclimb-cost')).map(node=>{
      const box = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect();
      const range = document.createRange();range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());
      const rank = node.classList.contains('rankclimb-number');
      return {text:node.textContent,scroll:node.scrollWidth,client:node.clientWidth,rank,
        rightInset:parent.right-Math.max(...rects.map(rect=>rect.right)),
        paddingRight:parseFloat(getComputedStyle(node.parentElement).paddingRight),
        contained:rects.every(rect=>rect.left>=parent.left-.5 && rect.right<=parent.right+.5
          && rect.left>=-.5 && rect.right<=innerWidth+.5),
        oneLine:box.height<=parseFloat(getComputedStyle(node).lineHeight)+1};
    });
    check(text.every(item=>item.contained && item.scroll<=item.client+1),'whole rank/count text',text);
    check(text.filter(item=>item.rank).every(item=>Number.isFinite(item.rightInset)
      && item.rightInset>=2*item.paddingRight-.5),
      'F1406 visible rank right inset',text.filter(item=>item.rank));
    const colors = laurels.map(svg=>({background:getComputedStyle(svg.parentElement).backgroundColor,
      color:getComputedStyle(svg).color}));
    check(colors.every(item=>item.background==='rgb(0, 114, 178)' && item.color==='rgb(255, 255, 255)'),
      'uniform numbered milestone colors',colors);
    const palette = [], html = document.documentElement, theme = html.getAttribute('data-theme');
    const luminance = color => {
      const rgb = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
      check(!!rgb,'opaque milestone colors',color);
      const values = rgb.slice(1).map(value=>{
        const channel = Number(value)/255;
        return channel<=.04045?channel/12.92:Math.pow((channel+.055)/1.055,2.4);
      });
      return values[0]*.2126+values[1]*.7152+values[2]*.0722;
    };
    const contrast = (foreground,background) => {
      const a = luminance(foreground), b = luminance(background);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    };
    try {
      for (const mode of ['light','dark']) {
        html.setAttribute('data-theme',mode);
        const heads = Array.from(root.querySelectorAll('.rankclimb-stop.milestone .rankclimb-head'));
        if (mode==='dark' && mutation==='theme-text') heads.forEach(head=>{head.style.color='var(--ink)';});
        if (mode==='dark' && mutation==='theme-badge') heads.forEach(head=>{
          head.style.setProperty('--safe-blue','var(--dark-safe-blue)');
        });
        const milestones = heads.map(head=>{
          const badge = head.querySelector('.rankclimb-rank'), cost = head.querySelector('.rankclimb-cost');
          const fill = getComputedStyle(badge).backgroundColor, ink = getComputedStyle(badge).color;
          return {fill,ink,badgeContrast:contrast(ink,fill),
            costContrast:contrast(getComputedStyle(cost).color,getComputedStyle(head).backgroundColor)};
        });
        palette.push({mode,milestones});
        check(milestones.every(item=>item.fill==='rgb(0, 114, 178)' && item.ink==='rgb(255, 255, 255)'
          && item.badgeContrast>=4.5 && item.costContrast>=4.5),'readable milestone theme colors',palette);
        if (mode==='dark' && mutation==='rank-theme') root
          .querySelectorAll('.rankclimb-stop:not(.milestone):not(.current) .rankclimb-rank').forEach(badge=>{
            if (getComputedStyle(badge).color==='rgb(255, 255, 255)')
              badge.style.background='var(--dark-safe-blue)';
          });
        const badges = Array.from(root.querySelectorAll('.rankclimb-rank'))
          .filter(badge=>!badge.closest('.rankclimb-unavailable')).map(badge=>({
            rank:badge.textContent.trim(),
            contrast:contrast(getComputedStyle(badge).color,getComputedStyle(badge).backgroundColor)}));
        check(badges.every(badge=>badge.contrast>=4.5),'readable rank badge theme contrast',{mode,badges});
        palette.at(-1).badges = badges;
      }
    } finally {
      if (theme===null) html.removeAttribute('data-theme');
      else html.setAttribute('data-theme',theme);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }
    stage('decoration');
    const decoration = laurels.map(svg=>{
      const [top,number] = svg.querySelectorAll('text');
      const rect = number.getBoundingClientRect(), box = svg.getBoundingClientRect();
      const gaps = [];
      function gap(x,y) {
        return Math.hypot(Math.max(rect.left-x,0,x-rect.right),Math.max(rect.top-y,0,y-rect.bottom));
      }
      svg.querySelectorAll('ellipse').forEach(leaf=>{
        const bounds = leaf.getBoundingClientRect();
        const stroke = parseFloat(getComputedStyle(leaf).strokeWidth)*leaf.getScreenCTM().a/2;
        gaps.push(Math.hypot(Math.max(rect.left-bounds.right,0,bounds.left-rect.right),
          Math.max(rect.top-bounds.bottom,0,bounds.top-rect.bottom))-stroke);
      });
      svg.querySelectorAll('[data-laurel-arm]').forEach(arm=>{
        const matrix = arm.getScreenCTM(), stroke = parseFloat(getComputedStyle(arm).strokeWidth)*matrix.a/2;
        check([matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f].every(Number.isFinite),
          'finite laurel transform',{});
        const key = arm.getAttribute('d');
        let samples = armSamples.get(key);
        if (!samples) {
          const length = arm.getTotalLength();
          check(Number.isFinite(length) && length>0 && length<1000,'finite laurel arm',length);
          samples = [];
          for (let distance=0;distance<=length;distance+=.25) samples.push(arm.getPointAtLength(distance));
          armSamples.set(key,samples);
        }
        samples.forEach(point=>gaps.push(gap(point.x*matrix.a+point.y*matrix.c+matrix.e,
          point.x*matrix.b+point.y*matrix.d+matrix.f)-stroke));
      });
      const center = new DOMPoint(38,28).matrixTransform(svg.getScreenCTM());
      const numberScale = Math.hypot(number.getScreenCTM().c,number.getScreenCTM().d);
      const topScale = Math.hypot(top.getScreenCTM().c,top.getScreenCTM().d);
      return {label:svg.getAttribute('aria-label'),gapAt66:Math.min(...gaps)*66/box.width,
        centerAt66:((rect.top+rect.bottom)/2-center.y)*66/box.width,
        numberHeight:rect.height,topHeight:top.getBoundingClientRect().height,
        numberFont:parseFloat(getComputedStyle(number).fontSize),
        topFont:parseFloat(getComputedStyle(top).fontSize),
        numberScale,topScale};
    });
    check(decoration.every(item=>item.gapAt66>=3 && Math.abs(item.centerAt66)<=1.5
      && item.numberFont*item.numberScale>=item.topFont*item.topScale*2.2
      && item.numberHeight>item.topHeight),
      'large centered numerals clear actual artwork',decoration);
    stage('arrows');
    const arrows = Array.from(root.querySelectorAll('.rankclimb-arrow svg')).map(svg=>{
      const box = svg.getBoundingClientRect();
      return {width:box.width,height:box.height,aspect:svg.getAttribute('preserveAspectRatio')};
    });
    check(arrows.every(item=>Math.abs(item.width-28*scale)<.1
      && Math.abs(item.height-18*scale)<.1 && item.aspect==='none'),'original ladder arrows',arrows);
    check(root.scrollWidth<=root.clientWidth+1,'contained ladder',{scroll:root.scrollWidth,client:root.clientWidth});
    if (A.getDisplayProfile()==='standard') check(text.every(item=>item.oneLine),'compact standard text',text);
    stage('scan');
    const result = scan(label);
    check(result.releaseLayout.latestBirdIcons===true && result.releaseLayout.rankColumns.length===2,
      'shared Top 100 icon fixture',result.releaseLayout);
    results.push(Object.assign(result,{rankClimbGeometry:{scale,spacing,text,colors,palette,decoration,arrows}}));
    stage('done');
  }
  try {
    localStorage.setItem(A.IDENTITY_META_KEY,JSON.stringify({profileId:'synthetic-owner'}));
    await paint();
    check(document.querySelectorAll('.rankclimb-rank .rankclimb-laurel').length===7,
      'all seven actual milestones',{});
    await measure('F1398 complete four-digit ladder');
    board.rows = [{rank:8,species:300,name:'Known target',profileId:'target'},
      {rank:20,species:200,name:'Synthetic birder',profileId:'synthetic-owner'}];
    board.me = board.rows[1];await paint();
    check(document.querySelectorAll('.rankclimb-unavailable[class*="podium-"]').length===3,'unknown podium scores',{});
    await measure('F1398 unknown-score ladder');
    const tiedScores = [248,248,243,240,235,230,225,220,218,213,210,207,204,201,197,194,190,180,179];
    board.rows = tiedScores.map((species,i)=>({rank:tiedScores.indexOf(species)+1,species,
      profileId:i===17?'synthetic-owner':'synthetic-'+i,name:'Synthetic birder'}));
    board.me = board.rows[17];await paint();
    const tiedPodium = document.querySelector('[data-rank-milestone="2"]');
    check(tiedPodium && tiedPodium.querySelector('.rankclimb-number').textContent==='#1'
      && tiedPodium.querySelector('.rankclimb-cost').textContent==='+68 species'
      && !tiedPodium.classList.contains('rankclimb-unavailable'),
      'F1446 verified first-place tie supplies the second podium milestone',{});
    await measure('F1446 verified first-place tie ladder');
    board.rows = Array.from({length:5001},(_,i)=>({rank:i<483?i+1:i<5000?484:5001,
      species:i<483?6001-i:i<5000?1000:999,
      profileId:i===5000?'synthetic-owner':'tied-'+i,name:'Synthetic birder'}));
    board.me = board.rows[5000];await paint();
    const shared = Array.from(document.querySelectorAll('[data-rank-milestone]'))
      .filter(stop=>Number(stop.dataset.rankMilestone)>=500);
    check(shared.length===5 && shared.every(stop=>
      stop.querySelector('.rankclimb-number').textContent==='#484'
      && stop.querySelector('.rankclimb-cost').textContent==='+1 species'
      && stop.querySelectorAll('.rankclimb-laurel').length===1),
      'F1399 separate complete shared-tie milestones',{});
    await measure('F1399 separate complete shared-tie ladder');
    board.rows = board.rows.slice(0,500);await paint();
    check(document.querySelector('.rankclimb').textContent.includes('Some top-board milestones are unavailable'),
      'truncated shared targets remain coverage-limited',{});
    check([1000,2000,3000,5000].every(cutoff=>{
      const stop=document.querySelector('[data-rank-milestone="'+cutoff+'"]');
      return stop && stop.querySelector('.rankclimb-number').textContent==='—'
        && stop.querySelector('.rankclimb-cost').textContent==='Score not loaded';
    }),'F1399 uncovered thresholds never invent minimums',{});
    await measure('F1399 separate truncated shared-target ladder');
  } finally {
    if (typeof auditStage==='function') auditStage('F1398 restore');
    if (identity===null) localStorage.removeItem(A.IDENTITY_META_KEY);
    else localStorage.setItem(A.IDENTITY_META_KEY,identity);
    A.showMenu();
    if (typeof auditStage==='function') auditStage('F1398 restored');
  }
  return results;
}

module.exports = rankClimbLayout;
