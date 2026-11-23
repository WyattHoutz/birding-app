'use strict';

module.exports = async function birdReportLayout(scan, preview, stage) {
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
    require(rect.width >= 44 && rect.height >= 44, label + ' has an undersized target');
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
    var reference=host.querySelector('.obs').cloneNode(true);
    reference.style.cssText='position:absolute;left:-10000px;visibility:hidden';
    document.body.appendChild(reference);
    var font=getComputedStyle(reference.querySelector('.name')).fontSize;
    reference.remove();
    var previous,rows=Array.from(host.querySelectorAll('tbody > tr')).map(function(row){
      var link=row.querySelector('a.splink'),rect=row.getBoundingClientRect();
      var linkRect=link.getBoundingClientRect();
      require(rect.height<=linkRect.height+1,'F1492 excess row height: '
        +rect.height+' versus link '+linkRect.height);
      if(previous)require(rect.top-previous.bottom<=1,'F1492 excess inter-row gap: '
        +(rect.top-previous.bottom));
      require(getComputedStyle(row.querySelector('.name')).fontSize===font,
        'F1492 compact table shrank the shared species text');
      previous=rect;
      return {bird:link.textContent,rowHeight:rect.height,linkHeight:linkRect.height};
    });
    return {font:font,rows:rows};
  }
  A.setActiveReport('wa'); A.setCountyView('');
  A.useFoundAnchor({lat:47.75,lng:-122.16}, 'Representative sample area');
  var owner = A.personalListOwner();
  localStorage.setItem(A.personalListKey(owner), JSON.stringify({
    owner:owner,coverage:'complete',declaredCount:1,unresolved:0,paginated:false,
    codes:['amerob'],rows:[{code:'amerob',name:'American Robin',observedAt:''}],
    readAt:new Date().toISOString(),readDate:A.todayStr()
  }));
  var names = [
    ['amerob','American Robin'],['amecro','American Crow'],
    ['bkcchi','Black-capped Chickadee'],['chbchi','Chestnut-backed Chickadee'],
    ['sonspa','Song Sparrow'],['daejun','Dark-eyed Junco'],['houspa','House Sparrow'],
    ['houfin','House Finch'],['amegfi','American Goldfinch'],['eursta','European Starling'],
    ['norfli','Northern Flicker'],['annhum',"Anna's Hummingbird"],['bewwre',"Bewick's Wren"]
  ];
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
  require(host.querySelectorAll('tbody > tr').length === 10, 'F1492 initial ten missing');
  require(host.querySelector('tbody > tr').dataset.commonCode === 'amerob',
    'F1492 highest-ranked seen bird missing');
  require(!document.querySelector('#easyResults [data-sp="amerob"]'),
    'F1492 seen bird leaked into needed targets');
  var more = document.getElementById('easyCommonMore');
  target(more,'F1492 Show more');
  Array.from(host.querySelectorAll('a.splink')).forEach(function (link) {
    target(link,'F1492 Stakeout ' + link.textContent);
    require(link.getAttribute('href') === '#spLookupBtn', 'F1492 wrong Stakeout destination');
    intactWords(link);
  });
  Array.from(host.querySelectorAll('th')).forEach(intactWords);
  var commonResult=scan('F1492 populated common table: first ten');
  commonResult.commonTableGeometry=compactTable(host);
  out.push(commonResult);
  stage('bird-report common glyph geometry measured');
  var calls = window.__auditExternalCalls || 0;
  more.click();
  require(host.querySelectorAll('tbody > tr').length === 13 && more.hidden,
    'F1492 expansion did not exhaust the acquired thirteen');
  require((window.__auditExternalCalls || 0) === calls, 'F1492 expansion acquired more data');
  commonResult=scan('F1492 populated common table: expanded');
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
  var matches = [1,8,16,21,26], summaries = Array.from({length:36}, function (_,i) {
    return {subId:'S1491LAYOUT'+i,locId:'L1491LAYOUT',
      obsDt:stamp + ':' + String(i).padStart(2,'0')};
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
  require(slot,'F1491 public history slot missing');
  await A.loadStakeoutPlaceHistory(slot,bird);
  stage('bird-report initial history complete');
  var list = root.querySelector('.stakeoutPlaceChecklists');
  require(list.children.length === 1 && /checked 6 recent checklists/.test(slot.textContent),
    'F1491 automatic scan widened');
  var originalPadding = document.body.style.paddingBottom;
  var originalAnchoring = document.documentElement.style.overflowAnchor;
  document.documentElement.style.overflowAnchor = 'none';
  document.body.style.paddingBottom = '2000px';
  var evidence = list.querySelector('[data-ev-sub="S1491LAYOUT1"]');
  await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  window.scrollTo(0,window.scrollY + evidence.getBoundingClientRect().top - 160);
  await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  var before = evidence.getBoundingClientRect().top;
  require(Math.abs(before-160)<=2,'F1491 fixture did not enter the checklist reading position: '
    + before + '; scroll=' + window.scrollY + '; height=' + document.documentElement.scrollHeight);
  function reading(label) {
    var after = evidence.getBoundingClientRect().top;
    require(Math.abs(after - before) <= 2, label + ' moved existing checklist reading: '
      + before + ' -> ' + after + '; scroll=' + window.scrollY);
    measurements.push({event:label,before:before,after:after});
  }
  var release;
  A.seedChecklistView(summaries[8].subId,new Promise(function (resolve) { release=resolve; }));
  more = slot.querySelector('.stakeoutLoadMoreHistory');
  target(more,'F1491 Find more reports');
  more.focus({preventScroll:true}); more.click();
  await until(function () { return slot.hasAttribute('data-loading'); },'F1491 more did not start');
  reading('F1491 loading status');
  release(detail(8));
  await until(function () { return /checked 18 recent checklists/.test(slot.textContent); },
    'F1491 first explicit batch did not finish');
  require(list.children.length === 3,'F1491 first continuation did not add two matches');
  reading('F1491 prepended matching reports');
  require(document.activeElement === slot.querySelector('.stakeoutLoadMoreHistory'),
    'F1491 continuation lost keyboard focus');
  out.push(scan('F1491 bounded Find more reports: populated'));

  var reject;
  A.seedChecklistView(summaries[18].subId,new Promise(function (_, fail) { reject=fail; }));
  more=slot.querySelector('.stakeoutLoadMoreHistory');
  more.focus({preventScroll:true}); more.click();
  await until(function () { return slot.hasAttribute('data-loading'); },'F1491 retry control did not start');
  reject(new Error('Controlled history read failure'));
  await until(function () { return slot.querySelector('.stakeoutLoadHistory'); },'F1491 Retry missing');
  reading('F1491 failed status');
  require(list.children.length === 3,'F1491 failed batch changed accepted evidence');
  var retry=slot.querySelector('.stakeoutLoadHistory');
  require(document.activeElement === retry,'F1491 failed batch lost Retry focus');
  target(retry,'F1491 Retry');
  A.seedChecklistView(summaries[18].subId,detail(18));
  retry.click();
  await until(function () { return /checked 30 recent checklists/.test(slot.textContent); },
    'F1491 retry did not complete');
  reading('F1491 retry appends');
  require(list.children.length === 5,'F1491 five-report control did not recover all five');
  var result=scan('F1491 successful retry: five matching checklists');
  result.birdReportReading=measurements;
  out.push(result);
  A.seedChecklistView(summaries[31].subId,new Promise(function (resolve) { release=resolve; }));
  more=slot.querySelector('.stakeoutLoadMoreHistory');
  more.focus({preventScroll:true}); more.click();
  await until(function () { return slot.hasAttribute('data-loading'); },'F1491 final batch did not start');
  var lookup=document.getElementById('spLookup');
  lookup.focus({preventScroll:true});
  release(detail(31));
  await until(function () { return /checked 36 recent checklists/.test(slot.textContent); },
    'F1491 final batch did not finish');
  require(document.activeElement===lookup,'F1491 completion stole intentionally moved focus');
  require(list.children.length===5 && !slot.querySelector('.stakeoutLoadMoreHistory'),
    'F1491 exhausted summaries did not retain the five matches');
  reading('F1491 exhausted continuation');
  out.push(scan('F1491 exhausted continuation: intentional focus retained'));
  document.body.style.paddingBottom=originalPadding;
  document.documentElement.style.overflowAnchor=originalAnchoring;
  window.scrollTo(0,0);
  return out;
};
