'use strict';

module.exports = async function birdReportLayout(scan, preview, stage, preparePersonalFixture) {
  var A = window.__app, out = [], measurements = [];
  stage=stage||function(){};
  stage('bird-report common fixture starting');
  function require(value, message) { if (!value) throw new Error(message); }
  async function until(predicate, label) {
    var deadline = Date.now() + 10000;
    while (!predicate() && Date.now() < deadline) {
      await new Promise(function (resolve) { setTimeout(resolve, 10); });
    }
    require(predicate(), label);
  }
  function target(node, label) {
    var rect = node.getBoundingClientRect();
    require(rect.width >= 44 && rect.height >= 44, label + ' has an undersized target: '
      + JSON.stringify({width:rect.width,height:rect.height,hidden:node.hidden}));
    require(node.scrollWidth <= node.clientWidth + 1, label + ' clips its label');
  }
  function intactWords(node) {
    var walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),text;
    while((text=walker.nextNode())){
      var words=/[A-Za-z]+/g,word;
      while((word=words.exec(text.nodeValue))){
        var range=document.createRange();
        range.setStart(text,word.index);range.setEnd(text,word.index+word[0].length);
        var tops=Array.from(range.getClientRects()).filter(function(rect){return rect.width&&rect.height;})
          .map(function(rect){return Math.round(rect.top);});
        require(new Set(tops).size<=1,'F1492 splits "'+word[0]+'" across lines; available='
          +node.getBoundingClientRect().width+'; word='+Array.from(range.getClientRects())
            .reduce(function(sum,rect){return sum+rect.width;},0)
          +'; font='+getComputedStyle(node).font);
      }
    }
  }
  function compactTable(host) {
    var reference=document.createElement('div');
    reference.innerHTML='<ul class="obs"><li><span class="name">Reference bird</span></li></ul>';
    reference.style.cssText='position:absolute;left:-10000px;visibility:hidden';
    document.body.appendChild(reference);
    var font=getComputedStyle(reference.querySelector('.name')).fontSize;
    reference.remove();
    var rows=Array.from(host.querySelectorAll('[data-common-code]')).map(function(row){
      var link=row.querySelector('a.splink'),rect=row.getBoundingClientRect();
      var linkRect=link.getBoundingClientRect();
      require(getComputedStyle(link).fontSize===font,
        'F1494 paragraph shrank the shared species text');
      return {bird:link.textContent,rowHeight:rect.height,linkHeight:linkRect.height};
    });
    var height=host.querySelector('.commonBirdNames').getBoundingClientRect().height;
    if(parseFloat(font)<20)require(height<rows.reduce(function(sum,row){return sum+row.linkHeight;},0),
      'F1494 paragraph is no shorter than stacked links');
    return {font:font,paragraphHeight:height,rows:rows};
  }
  A.applyCapturedIdentity({status:'ok',displayName:'Sample Birder'});
  A.setActiveReport('wa'); A.setCountyView('');
  A.useFoundAnchor({lat:47.75,lng:-122.16}, 'Representative sample area');
  var names = [
    ['amerob','American Robin'],['amecro','American Crow'],
    ['bkcchi','Black-capped Chickadee'],['chbchi','Chestnut-backed Chickadee'],
    ['sonspa','Song Sparrow'],['daejun','Dark-eyed Junco'],['houspa','House Sparrow'],
    ['houfin','House Finch'],['amegfi','American Goldfinch'],['eursta','European Starling'],
    ['norfli','Northern Flicker'],['annhum',"Anna's Hummingbird"],['bewwre',"Bewick's Wren"],
    ['rubkin','Ruby-crowned Kinglet']
  ];
  require(typeof preparePersonalFixture==='function','Exact personal fixture helper is missing');
  var taxa=names.map(function(bird){return {code:bird[0],name:bird[1]};});
  await preparePersonalFixture(A,window,{yearList:taxa.slice(0,2)},taxa);
  A.setWatchlist([{code:'amerob',name:'American Robin'}]);
  var stamp = A.todayStr() + ' 08:00', park = {
    locId:'L1492LAYOUT',locName:'Representative public sample park',
    lat:47.76,lng:-122.16,subnational1Code:'US-WA'
  };
  var rows = names.map(function (bird, i) {
    return {speciesCode:bird[0],comName:bird[1],locId:park.locId,locName:park.locName,
      obsDt:stamp,subId:'S1492LAYOUT'+i};
  });
  var earlier = new Date(A.todayStr() + 'T12:00:00'); earlier.setDate(earlier.getDate() - 1);
  rows.push(Object.assign({},rows[0],{obsDt:earlier.toISOString().slice(0,10) + ' 08:00'}));
  A.showSection('sec-easyBtn',{load:false});
  await new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});});
  var plan=A.easyDiscoveryPlan(A.anchorPoint(),A.chaseMaxMi());
  await A.zcPut(A.easyOpportunityKey(),{v:1,at:Date.now()-1000,rows:rows,hotspots:[park],
    checked:{},geoDone:plan.centers.length,failures:0,discoveryFinished:true});
  stage('bird-report common cache stored');
  require(await A.loadEasyMisses(), 'F1492 owned common sample did not load');
  stage('bird-report common sample loaded');
  var host = document.getElementById('easyCommonResults');
  require(host.querySelectorAll('[data-common-code]').length === 10, 'F1492 initial ten missing');
  require(host.querySelector('[data-common-code]').dataset.commonCode === 'amerob',
    'F1492 highest-ranked WATCH bird missing');
  require(!host.querySelector('[data-common-code="amecro"]'),
    'F1492 seen, unwatched bird leaked into the common table');
  require(document.querySelector('#easyResults [data-sp="amerob"]'),
    'F1492 WATCH bird missing from existing needed targets');
  var more = document.getElementById('easyCommonMore');
  target(more,'F1492 Show more');
  var placeMore=document.getElementById('easyPlaces');
  require(placeMore && !placeMore.disabled,'F1498 retained Find more places must be actionable');
  target(placeMore,'F1498 Find more places');
  Array.from(host.querySelectorAll('a.splink')).forEach(function (link) {
    target(link,'F1492 Stakeout ' + link.textContent);
    require(link.getAttribute('href') === '#spLookupBtn', 'F1492 wrong Stakeout destination');
    intactWords(link);
  });
  var footprints=[];
  Array.from(host.querySelectorAll('a.splink')).forEach(function(link){
    Array.from(link.getClientRects()).forEach(function(rect){
      require(rect.height>=44,'F1494 inline link fragment has an undersized target');
      footprints.forEach(function(other){
        if(other.code===link.dataset.sp)return;
        require(Math.min(rect.right,other.rect.right)-Math.max(rect.left,other.rect.left)<=1
          || Math.min(rect.bottom,other.rect.bottom)-Math.max(rect.top,other.rect.top)<=1,
          'F1494 neighboring species link targets overlap: '+link.dataset.sp+' / '+other.code
            +'; heights='+rect.height+'/'+other.rect.height
            +'; line='+getComputedStyle(host.querySelector('.commonBirdNames')).lineHeight);
      });
      footprints.push({rect:rect,code:link.dataset.sp});
    });
  });
  Array.from(host.querySelectorAll('th')).forEach(intactWords);
  var commonResult=scan('F1492 populated common table: first ten');
  commonResult.commonTableGeometry=compactTable(host);
  out.push(commonResult);
  stage('bird-report common glyph geometry measured');
  var calls = window.__auditExternalCalls || 0;
  more.click();
  stage('bird-report common expansion clicked');
  require(host.querySelectorAll('[data-common-code]').length === 13 && more.hidden,
    'F1492 expansion did not exhaust the acquired thirteen');
  require((window.__auditExternalCalls || 0) === calls, 'F1492 expansion acquired more data');
  commonResult=scan('F1492 populated common table: expanded');
  stage('bird-report common expansion scanned');
  commonResult.commonTableGeometry=compactTable(host);
  out.push(commonResult);
  if (preview === 'common') {
    await A.loadEasyMisses();
    window.scrollTo(0,0);
    return out;
  }

  A.showSection('sec-spLookupBtn',{load:false});
  A.setSpeciesLookupWithinChase(false);
  var bird = {code:'amerob',name:'American Robin'};
  var historyStamp = earlier.toISOString().slice(0,10) + ' 08:00';
  var matches = [1,8,16,21,26], summaries = Array.from({length:36}, function (_,i) {
    return {subId:'S1491LAYOUT'+i,locId:'L1491LAYOUT',
      obsDt:historyStamp + ':' + String(i).padStart(2,'0')};
  });
  function detail(i) {
    return Object.assign({},summaries[i],{numSpecies:23,durationHrs:1,
      obs:matches.indexOf(i) >= 0 ? [{speciesCode:bird.code,howMany:1}] : []});
  }
  summaries.forEach(function (row,i) { A.seedChecklistView(row.subId,detail(i)); });
  A.seedEbirdCache('product/lists/L1491LAYOUT?maxResults=12',summaries.slice(0,12));
  A.seedEbirdCache('product/lists/L1491LAYOUT?maxResults=200',summaries);
  var root = document.getElementById('spLookupRecent');
  root.innerHTML = A.spLookupPlacesHtml([{
    loc:'Representative busy public park',locId:'L1491LAYOUT',
    lat:47.76,lon:-122.16,distMi:1,dateStr:summaries[1].obsDt,
    checklists:[{subId:summaries[1].subId,dateStr:summaries[1].obsDt,count:1,numSpecies:23}]
  }],bird);
  A.mountProgressiveLists(root);
  var slot = root.querySelector('.stakeoutPlaceHistory');
  require(slot,'F1501 public history slot missing');
  function readableHistory() {
    var status=slot.querySelector('.stakeoutHistoryStatus'),reference=document.createElement('span');
    reference.className='hint';
    document.body.appendChild(reference);
    var font=getComputedStyle(reference).fontSize;
    reference.remove();
    require(parseFloat(getComputedStyle(status).fontSize)>=parseFloat(font),
      'F1501 history status shrank below shared hint text');
    intactWords(status);
  }
  var list = root.querySelector('.stakeoutPlaceChecklists');
  var release, reject, finish;
  A.seedChecklistView(summaries[8].subId,new Promise(function(resolve){release=resolve;}));
  A.seedChecklistView(summaries[18].subId,new Promise(function(_,fail){reject=fail;}));
  A.seedChecklistView(summaries[31].subId,new Promise(function(resolve){finish=resolve;}));
  await A.loadStakeoutPlaceHistory(slot,bird);
  stage('bird-report initial history complete');
  require(list.children.length === 1 && /checked 6 recent checklists/.test(slot.textContent),
    'F1501 initial paint exceeded its six-candidate budget');
  more = slot.querySelector('.stakeoutLoadMoreHistory');
  target(more,'F1501 continuation fallback');
  readableHistory();
  more.focus({preventScroll:true});
  stage('bird-report continuation focus set');
  var originalPadding = document.body.style.paddingBottom;
  var originalAnchoring = document.documentElement.style.overflowAnchor;
  document.documentElement.style.overflowAnchor = 'none';
  document.body.style.paddingBottom = '2000px';
  var evidence = list.querySelector('[data-ev-sub="S1491LAYOUT1"]');
  await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  stage('bird-report reading layout ready');
  window.scrollTo(0,window.scrollY + evidence.getBoundingClientRect().top - 160);
  await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  var before = evidence.getBoundingClientRect().top;
  stage('bird-report reading scroll ready');
  require(Math.abs(before-160)<=2,'F1501 fixture did not enter the checklist reading position: '
    + before + '; scroll=' + window.scrollY + '; height=' + document.documentElement.scrollHeight);
  function reading(label) {
    var after = evidence.getBoundingClientRect().top;
    require(Math.abs(after - before) <= 2, label + ' moved existing checklist reading: '
      + before + ' -> ' + after + '; scroll=' + window.scrollY);
    measurements.push({event:label,before:before,after:after});
  }
  await until(function () { return slot.hasAttribute('data-loading'); },'F1501 automatic continuation did not start');
  reading('F1501 automatic loading status');
  release(detail(8));
  await until(function () { return list.children.length === 3; },
    'F1501 first automatic batch did not add two matches');
  reading('F1501 prepended matching reports');
  require(document.activeElement === slot.querySelector('.stakeoutLoadMoreHistory')
    || slot.hasAttribute('data-restore-focus'),'F1501 continuation lost keyboard focus ownership');
  out.push(scan('F1501 progressive history: populated'));
  await until(function () { return slot.hasAttribute('data-loading'); },'F1501 second automatic batch did not start');
  reject(new Error('Controlled history read failure'));
  await until(function () { return list.children.length === 5; },'F1501 partial success was discarded');
  reading('F1501 partial success retained');
  await until(function () { return slot.hasAttribute('data-loading'); },'F1501 final automatic batch did not start');
  var lookup=document.getElementById('spLookup');
  lookup.focus({preventScroll:true});
  finish(detail(31));
  await until(function () { return !slot.hasAttribute('data-loading')
    && /1 candidate\/source reads unavailable/.test(slot.textContent); },'F1501 partial failure was not disclosed');
  require(document.activeElement===lookup,'F1501 automatic completion stole intentionally moved focus');
  reading('F1501 failed candidate disclosed');
  var retry=slot.querySelector('.stakeoutLoadMoreHistory');
  require(retry && /Retry unavailable/.test(retry.textContent),'F1501 unavailable report lacks an explicit retry');
  target(retry,'F1501 Retry unavailable reports');
  readableHistory();
  out.push(scan('F1501 accessible evidence retained: retry available'));
  A.seedChecklistView(summaries[18].subId,detail(18));
  retry.focus({preventScroll:true}); retry.click();
  await until(function () { return /checked 36 recent checklists/.test(slot.textContent); },
    'F1501 explicit retry did not revisit its failed candidate');
  require(list.children.length===5 && !slot.querySelector('.stakeoutLoadMoreHistory'),
    'F1501 exhausted returned summaries did not retain the five matches');
  require(document.activeElement===slot.querySelector('.stakeoutHistoryStatus'),
    'F1501 retry completion lost keyboard focus');
  reading('F1501 exhausted continuation');
  var result=scan('F1501 successful retry: five matching checklists');
  result.birdReportReading=measurements;
  out.push(result);
  A.seedEbirdCache(A.speciesLookupPath('US-WA',bird.code,30),[Object.assign({},summaries[1],{
    speciesCode:bird.code,comName:bird.name,locName:'Representative busy public park',
    lat:47.76,lng:-122.16,obsValid:true
  })]);
  await A.lookupSpecies(bird.code,bird.name);
  await until(function(){return root.querySelector('.stakeoutPlaceHistory[data-done]');},
    'F1497 retained map fixture did not restore its verified history');
  var map=document.getElementById('spLookupMap');
  require(map && !map.hidden && map.getBoundingClientRect().height>0,'F1497 grouped map is not visible');
  A.setSpeciesLookupGrouped(false);
  require(map.hidden && map.getBoundingClientRect().height===0,'F1497 ungrouped map must take no layout space');
  require(root.querySelectorAll('.stakeoutFlatChecklists [data-ev-sub]').length===5,
    'F1497 hidden map cannot remove recovered flat evidence');
  A.renderSpeciesLookup();
  require(map.hidden,'F1497 retained redraw restored an ungrouped map');
  A.setSpeciesLookupGrouped(true);
  require(!map.hidden && map.getBoundingClientRect().height>0,'F1497 regrouping must restore the retained map');
  result.stakeoutMapVisibility={grouped:true,flatHidden:true,recoveredFlatRows:5};
  document.body.style.paddingBottom=originalPadding;
  document.documentElement.style.overflowAnchor=originalAnchoring;
  window.scrollTo(0,0);
  return out;
};
