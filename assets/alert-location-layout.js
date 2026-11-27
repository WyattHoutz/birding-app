'use strict';

async function alertLocationLayout(scan, mutation, view) {
  const A = window.__app, results = [];
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  function categoryFits(card) {
    const tag = card.querySelector('.surgebadge'), range = document.createRange();
    range.selectNodeContents(tag);
    const box = tag.getBoundingClientRect(), text = range.getBoundingClientRect();
    check(text.left >= box.left-.5 && text.right <= box.right+.5,
      'Alert category text must fit its labelled badge');
  }
  function wordsFit(card, label) {
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      for (const word of node.textContent.matchAll(/[A-Za-z]{5,}/g)) {
        const range = document.createRange();
        range.setStart(node,word.index); range.setEnd(node,word.index+word[0].length);
        const lines = [...range.getClientRects()].filter(rect=>rect.width && rect.height);
        check(lines.length <= 1, label+' text must not split words: '+word[0]);
      }
    }
  }
  async function record(label, fixture) {
    try {
      const measurements = await fixture();
      results.push(Object.assign(scan(label), { alertLocationGeometry: measurements }));
    }
    catch (error) { results.push({ label, fixtureError: error.message }); }
  }
  function stamp(time) {
    const d = new Date(time), pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  A.cancelStalledWork();
  A.setActiveReport('wa'); A.setCountyView('');
  A.showSection('sec-surgeBtn', { load: false });
  const states = { mega:'notApplicable',observations:'retained',leaderboard:'retained',
    hotspots:'notApplicable',suppressNotifications:true };
  const radiusKey = A.chaseMiKey(), originalRadius = localStorage.getItem(radiusKey);
  localStorage.setItem(radiusKey,'80');
  try {
  await record('F1513 separate Celebrity reporting sites', async () => {
    const now = Date.now();
    const merged = [
      {locId:'LWEST1513',loc:'West Seattle shore',lat:47.57,lon:-122.40,distMi:15},
      {locId:'LSTAN1513',loc:'Stanwood marsh',lat:48.24,lon:-122.37,distMi:30},
    ].flatMap((site,index) => Array.from({length:4},(_,i) => ({
      ...site,code:'trokin',name:'Tropical Kingbird',kind:'Rarity',valid:true,
      dateStr:stamp(now-(120-i*15)*60000),location_private:false,
      observer:'Independent '+index+'-'+i,subId:'S1513'+index+i,count:i+1,
    })));
    merged.push({...merged[0],locId:'LCUSTOM1513',loc:'Adjacent custom pin',
      location_private:true,dateStr:stamp(now-10*60000),observer:'Later observer',
      subId:'SPRIVATE1513',count:99});
    const needs = A.surgeObservedResult({cv:{merged},partial:false},now).needs;
    if (mutation === 'celebrity-collapsed') needs.splice(1);
    A.renderSurge([],[],[],needs,merged,states);
    await paint();
    const cards = [...document.querySelectorAll('#surgeFeed [data-alert-kind="need"]')];
    check(cards.length === 2, 'F1513 separate qualified sites must retain two Celebrity cards');
    const locations = cards.map(card => card.querySelector('.surgealerttitle .hslink').dataset.loc).sort();
    check(JSON.stringify(locations) === JSON.stringify(['LSTAN1513','LWEST1513']),
      'F1513 each card must link to its own public reporting hotspot');
    for (const card of cards) {
      categoryFits(card);
      wordsFit(card,'F1513 actual Celebrity');
      const box = card.getBoundingClientRect();
      check(box.width > 0 && box.left >= -.5 && box.right <= innerWidth+.5,
        'F1513 both actual Celebrity cards must fit the viewport');
      check(!/SPRIVATE1513/.test(card.dataset.surgeChecklist),
        'F1513 private evidence must not become the destination report');
    }
    return { locations, cards:cards.length };
  });
  if (view === 'celebrity') return results;
  await record('F1514 F1526 outlined Cascade count and checkmark on the image', async () => {
    const measurements = [], definition = A.recentBirdGenViews.cascade;
    function measure(card, count, view) {
      if (mutation === 'cascade-recent-crushed' && view === 'recent') {
        const heading = card.querySelector('.name');
        heading.style.gridTemplateColumns = 'calc(42px * var(--s)) minmax(0, 1fr) max-content';
        heading.style.gridTemplateRows = 'auto';
        for (const child of heading.querySelectorAll(':scope > .ntext, :scope > .recent-birdgen-time')) {
          child.style.gridColumn = 'auto'; child.style.gridRow = 'auto';
        }
      }
      categoryFits(card);
      wordsFit(card,'F1514 actual '+view);
      const thumb = card.querySelector('.surgetickthumb');
      const badge = thumb && thumb.querySelector('.surgetickcount');
      check(badge && badge.textContent === String(count)+'\u2714',
        'F1526 unchanged count must precede its checkmark on the image');
      if (mutation === 'cascade-box') Object.assign(badge.style,{
        background:'#003B5C',border:'1px solid white',borderRadius:'99px'
      });
      if (mutation === 'cascade-outline') Object.assign(badge.style,{
        webkitTextStrokeWidth:'0px',textShadow:'none'
      });
      const shape = badge.querySelector('.surgetickcheck path');
      check(shape,'F1539 checkmark must use an explicit shape, not platform emoji');
      if (mutation === 'cascade-checkmark') shape.style.fill = '#000';
      if (mutation === 'cascade-check-outline') shape.style.strokeWidth = '.1px';
      const shapeStyle = getComputedStyle(shape);
      check(shapeStyle.fill === 'rgb(255, 255, 255)' && shapeStyle.stroke === 'rgb(0, 0, 0)'
        && parseFloat(shapeStyle.strokeWidth) >= 4,
      'F1539 checkmark must be explicitly white with a thick black outline');
      const style = getComputedStyle(badge);
      check(style.backgroundColor === 'rgba(0, 0, 0, 0)'
        && parseFloat(style.borderTopWidth) === 0 && parseFloat(style.borderRadius) === 0
        && style.boxShadow === 'none', 'F1526 count glyphs must have no bubble, fill, border or box');
      check(style.color === 'rgb(255, 255, 255)'
        && parseFloat(style.webkitTextStrokeWidth) >= 1.5*parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s') || 1)
        && style.webkitTextStrokeColor === 'rgb(0, 0, 0)' && style.textShadow !== 'none',
      'F1526 white count and checkmark need black glyph outlines, not a container');
      if (mutation === 'cascade-strip') {
        Object.assign(badge.style, {left:'0',right:'0',bottom:'0',borderRadius:'0'});
      }
      const frame = thumb.getBoundingClientRect(), box = badge.getBoundingClientRect();
      check(box.width > 0 && box.height > 0 && box.width < frame.width*.85,
        'F1514 count must remain compact, not a full-width strip: '
          + JSON.stringify({count,view,frame:frame.toJSON(),badge:box.toJSON()}));
      check(box.left >= frame.left-.5 && box.right <= frame.right+.5
        && box.top >= frame.top-.5 && box.bottom <= frame.bottom+.5,
        'F1514 badge must stay inside its bird image');
      check(badge.scrollWidth <= badge.clientWidth+1 && badge.scrollHeight <= badge.clientHeight+1,
        'F1514 one-, two- and three-digit counts must remain fully readable');
      const range = document.createRange();
      range.selectNodeContents(badge.firstChild);
      check([...range.getClientRects()].length === 1,
        'F1514 a badge count must not wrap');
      const number = range.getBoundingClientRect();
      const mark = badge.querySelector('.surgetickcheck').getBoundingClientRect();
      check(mark.left >= number.right-.5 && mark.right <= box.right+.5
        && mark.top >= box.top-.5 && mark.bottom <= box.bottom+.5
        && Math.abs((mark.top+mark.bottom-number.top-number.bottom)/2) <= box.height*.35,
      'F1539 checkmark must stay beside the count on one unclipped line');
      check(badge.getAttribute('aria-label') === count+' leaderboard tick'+(count===1?'':'s'),
        'F1514 accessible count meaning must remain intact');
      const photo = thumb.querySelector('.thumb[data-bird]').getBoundingClientRect();
      check(Math.abs(photo.width-frame.width)<1 && Math.abs(photo.height-frame.height)<1,
        'F1514 the compact badge must not shrink the bird photo');
      const layout = scan('F1514 '+count+' '+view);
      check(layout.over <= .5 && layout.docScrollW <= innerWidth+.5
        && !['items','small','clipped','midword','crushed'].some(key=>(layout[key]||[]).length),
      'F1514 actual '+view+' layout must stay readable: '+JSON.stringify(layout));
      measurements.push({count,view,frame:frame.width,badge:box.width,height:box.height});
    }
    try {
      for (const count of [1,16,125]) {
        A.showSection('sec-surgeBtn',{load:false});
        A.renderSurge([],[{code:'amepip',species:'American Pipit',
          latest:stamp(Date.now()-3600000),earliest:stamp(Date.now()-3600000),
          birders:Array.from({length:count},(_,i)=>({name:'Sample birder '+i,rank:101+i})),
          recent:[{locId:'L1514',locName:'Example Public Park',lat:47.76,lng:-122.16,
            obsDt:stamp(Date.now()-3600000),howMany:37,subId:'S1514'}],
        }],[],[],[],states);
        await paint();
        measure(document.querySelector('#surgeFeed [data-alert-kind="cascade"]'),count,'full');
        A.showMenu(); A.cancelStalledWork(); A.updateRecentBirdGen();
        await paint();
        measure(document.querySelector('#recentBirdGenRows [data-recent-kind="cascade"]'),count,'recent');
        delete A.recentBirdGenViews.cascade;
        A.updateRecentBirdGen();
        await paint();
        measure(document.querySelector('#recentBirdGenRows [data-recent-view="full"]'),count,'fallback');
        A.recentBirdGenViews.cascade = definition;
      }
    } finally {
      A.recentBirdGenViews.cascade = definition;
      A.showSection('sec-surgeBtn',{load:false});
    }
    return {measurements};
  });
  return results;
  } finally {
    if (originalRadius == null) localStorage.removeItem(radiusKey);
    else localStorage.setItem(radiusKey,originalRadius);
  }
}

module.exports = alertLocationLayout;
