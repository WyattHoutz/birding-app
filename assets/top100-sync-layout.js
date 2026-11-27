'use strict';

module.exports = async function top100SyncLayout(scan, preview) {
  var A = window.__app, out = [], calls = [], published = 2, fail = false;
  var fetch = window.fetch;
  function require(value, message) { if (!value) throw new Error('F1493 ' + message); }
  async function settled() {
    var deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (!document.getElementById('rankBtn').disabled
          && /^(Loaded|Refreshed|Checked|Species board rechecked|Could not)/.test(
            document.getElementById('rankStatus').textContent)) return;
      await new Promise(function(resolve) { setTimeout(resolve, 10); });
    }
    throw new Error('F1493 leaderboard did not settle');
  }
  function escape(value) {
    return String(value).replace(/[&<>"']/g, function(character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }
  A.cancelStalledWork(); A.setActiveReport('wa'); A.setCountyView('');
  await A.drainIdentityWrites();
  var name = A.getDisplayName();
  if (!name) { name = 'Representative birder'; localStorage.setItem('ebird_display_name',name); }
  var identity = A.getIdentityMeta();
  var profileId = identity && identity.profileId || 'representative-owner';
  localStorage.setItem(A.IDENTITY_META_KEY,JSON.stringify(
    Object.assign({},identity,{profileId:profileId,source:'ebird-bird-list'})));
  var period = A.personalBoardPeriod(), owner = A.personalListOwner();
  function personal(count) {
    var codes = ['amerob','annhum','norfli','mallar'].slice(0,count);
    localStorage.setItem(A.personalListKey(owner),JSON.stringify({
      owner:owner,coverage:'complete',declaredCount:count,unresolved:0,paginated:false,
      codes:codes,rows:codes.map(function(code) { return {code:code,name:code}; }),
      readAt:new Date().toISOString(),readDate:A.todayStr()
    }));
    var evidence = A.personalListEvidence();
    require(evidence.complete && evidence.count === count && !evidence.stale,
      'personal fixture must prove current exact ownership and count');
  }
  function rows(total) {
    var date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    return [
      {rank:1,name:'Representative leader',species:10,checklists:20,profileId:'representative-leader',
        recent:'Common Ringed Plover ('+date+')'},
      {rank:2,name:name,species:total,checklists:18,profileId:profileId,
        recent:'American Golden-Plover ('+date+')'},
      {rank:3,name:'Representative neighbor',species:1,checklists:16,profileId:'representative-neighbor'}
    ];
  }
  function board(metric, total) {
    var data = rows(total);
    return {region:'US-WA',period:period,metric:metric,profile:A.bcProfile(),
      ownerRevision:A.identityRevision(),rows:data,me:data[1],
      readAt:new Date(Date.now()-60000).toISOString(),
      url:'https://ebird.org/top100?locInfo.regionCode=US-WA&year='+period
        +'&rankedBy='+metric+'&maxResults='+(metric === 'spp' ? 5000 : 500)};
  }
  async function warm(total) {
    for (var metric of ['spp','cl']) {
      var request = {region:'US-WA',metric:metric,max:500,
        rowLimit:metric === 'spp' ? 500 : undefined};
      await A.rankCachePut(A.rankCacheOwnerKey(request,period,name),board(metric,total));
      if (metric === 'spp') {
        await A.rankCachePut(A.rankCacheOwnerKey(Object.assign({},request,{max:5000,rowLimit:5000}),
          period,name),board(metric,total));
      }
    }
  }
  function html(metric) {
    return '<link rel="canonical" href="https://ebird.org/top100?locInfo.regionCode=US-WA">'
      +'<select name="year"><option value="'+period+'" selected>'+period+'</option></select>'
      +rows(published).map(function(row) {
        return '<div id="rank-'+row.rank+'" class="ResultsStats-index">'+row.rank+'.</div>'
          +'<h5 id="'+escape(row.name)+'" class="u-margin-none">'+escape(row.name)+'</h5>'
          +'<a href="/profile/'+escape(row.profileId)+'">Profile</a>'
          +['checklist','species'].map(function(kind) {
            return '<div class="StatsIcon StatsIcon--highlight '
              +((kind === 'checklist') === (metric === 'cl') ? '' : 'StatsIcon--muted')
              +'"><svg class="Icon Icon--'+kind+'"></svg><div class="StatsIcon-stat-count">'
              +(kind === 'species' ? row.species : row.checklists)+'</div></div>';
          }).join('')+'<span class="ResultsStats-details-detail">'+escape(row.recent || '')+'</span>';
      }).join('');
  }
  function ownCount() {
    var row = document.querySelector('.ranknearby tr[aria-current]');
    return row && row.children[2].textContent;
  }
  async function snapshot(label) {
    await new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});});
    window.scrollTo(0,0);
    Array.from(document.querySelectorAll('.ranknearby th')).forEach(function(heading) {
      var range=document.createRange();range.selectNodeContents(heading);
      var lines=Array.from(range.getClientRects()).filter(function(rect){return rect.width&&rect.height;});
      require(new Set(lines.map(function(rect){return Math.round(rect.top);})).size <= 1,
        'table heading must not split: '+heading.textContent);
    });
    var warning = document.getElementById('rankCountWarning');
    if (warning) {
      require(warning.getAttribute('role') === 'status', 'warning must announce its text');
      var box = warning.getBoundingClientRect();
      require(box.width > 0 && box.left >= -.5 && box.right <= innerWidth+.5,
        'warning must fit the visible panel');
    }
    var result=scan(label);
    require(!result.releaseLayout || result.releaseLayout.latestBirdIcons !== false,
      'retain the enlarged square bird photo geometry');
    out.push(Object.assign(result, {rankCountSync:{
      arrow:true,pull:true,recheck:true,warning:!!warning,reads:calls.length
    }}));
  }
  window.fetch = function(url, options) {
    if (!/https:\/\/ebird\.org\/top100/.test(String(url))) return fetch.apply(this,arguments);
    calls.push({url:String(url),cache:options && options.cache});
    return Promise.resolve({ok:!fail,status:fail ? 400 : 200,
      text:function() { return Promise.resolve(fail ? '' : html(new URL(url).searchParams.get('rankedBy'))); }});
  };
  try {
    personal(2); await warm(2);
    A.showSection('sec-rankBtn',{load:false});
    await A.loadRankings();
    require(calls.length === 0, 'ordinary loading must reuse verified warm boards');
    var arrow = document.querySelector('#sec-rankBtn h2 .refreshbtn');
    var hit = arrow.getBoundingClientRect();
    require(hit.width >= 44 && hit.height >= 44, 'refresh must retain a 44px target: '
      +hit.width+' x '+hit.height);
    published = 3; arrow.click(); await settled();
    require(calls.length >= 3 && calls.every(function(call) { return call.cache === 'no-store'; }),
      'actual arrow must acquire fresh boards');
    require(ownCount() === '3', 'arrow must paint updated published totals');
    await snapshot('F1493 actual fresh Top 100 arrow');
    var before = calls.length;
    published = 4;
    (document.scrollingElement || document.documentElement).scrollTop = 0;
    ['touchstart','touchmove','touchend'].forEach(function(type) {
      var event = new Event(type,{bubbles:true});
      Object.defineProperty(event,'touches',{value:type === 'touchend' ? [] :
        [{clientX:100,clientY:type === 'touchstart' ? 100 : 190}]});
      document.dispatchEvent(event);
    });
    await settled();
    require(calls.length > before && ownCount() === '4', 'actual pull must acquire and paint fresh totals');
    require(calls.slice(before).every(function(call) { return call.cache === 'no-store'; }),
      'pull must bypass HTTP caches');
    await snapshot('F1493 actual fresh Top 100 pull');
    personal(3); await warm(2); published = 2; before = calls.length;
    await A.loadRankings();
    require(calls.length === before+1, 'a count mismatch must make one Species-only recheck');
    var warning = document.getElementById('rankCountWarning');
    require(warning && /shows 2 species.*has 3.*fresh check still/.test(warning.textContent),
      'delayed published total must have an honest mismatch warning');
    require(ownCount() === '2', 'the published standing must not be fabricated');
    await A.loadRankings();
    require(calls.length === before+1, 'unchanged delayed totals must not loop automatic reads');
    await snapshot('F1493 delayed source count mismatch');
    if (preview) return out;
    fail = true; arrow.click(); await settled();
    require(ownCount() === '2' && /fresh check failed/.test(
      document.getElementById('rankCountWarning').textContent),'failed refresh must retain and label prior rows');
    await snapshot('F1493 failed refresh retains published standing');
    return out;
  } finally {window.fetch = fetch;}
};
