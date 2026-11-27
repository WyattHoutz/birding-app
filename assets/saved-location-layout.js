'use strict';

async function savedLocationLayout(scan, mutation, boundaryProbe, progress) {
  const A = window.__app, out = [];
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const $ = id => document.getElementById(id);
  const originalTemp = localStorage.getItem('ebird_temp_home_v1');
  const originalCounty = A.getCountyView();
  const originalReport = A.activeScope().parentSlug;
  const originalCustom = localStorage.getItem('ebird_custom_regions');
  let actionNoticeHeight = 0;
  const homeKeys = ['lat','lng','place'].map(field => A.homeKey(field))
    .concat('ebird_home_migrated_v1');
  const originalHome = homeKeys.map(key => localStorage.getItem(key));
  const originalFetch = window.fetch;
  window.fetch = function (url) {
    if (/photon.*api/.test(String(url))) return Promise.resolve(new Response(JSON.stringify({
      features: [48.4284,48.435].map(lat => ({
        properties: {name:'Victoria',state:'British Columbia',country:'Canada',osm_value:'city'},
        geometry: {coordinates:[-123.3656,lat]}
      }))
    }), {headers:{'Content-Type':'application/json'}}));
    return originalFetch.apply(this, arguments);
  };
  async function record(label, run) {
    if (progress) progress(label);
    try {
      const measurements = await run();
      out.push(Object.assign(scan(label), {savedLocationGeometry: measurements}));
    }
    catch (error) { out.push({label, fixtureError:error.message}); }
  }
  A.cancelStalledWork();
  try {
    for (const kind of ['home','temp']) {
      await record('F1515 ' + kind + ' saved/candidate editor', async () => {
        A.openSavedLocationEditor(kind);
        const prefix = kind === 'temp' ? 'tempHome' : 'home';
        $(prefix + 'Place').value = 'Victoria';
        $(kind === 'temp' ? 'tempGeocodeBtn' : 'geocodeBtn').click();
        const choiceDeadline = Date.now() + 5000;
        const choices = $(prefix + 'Choices');
        while (choices.querySelectorAll('button').length !== 2 && Date.now() < choiceDeadline) await paint();
        const buttons = [...choices.querySelectorAll('button')];
        check(buttons.length === 2 && new Set(buttons.map(button => button.textContent)).size === 2,
          'Namesake lookup choices must retain distinct, identifiable points');
        if (mutation === 'lookup-label-overflow') buttons[0].style.whiteSpace = 'nowrap';
        for (const button of buttons) {
          const box = button.getBoundingClientRect(), range = document.createRange();
          range.selectNodeContents(button);
          check(box.width >= 44 && box.height >= 44 && box.left >= -.5 && box.right <= innerWidth+.5
            && [...range.getClientRects()].every(text => text.left >= box.left-.5 && text.right <= box.right+.5),
          'Disambiguated lookup labels must wrap inside touch-sized choices without clipping');
        }
        $(prefix + 'Place').dispatchEvent(new Event('input'));
        $(prefix + 'Place').value = '47.61, -122.33';
        $(kind === 'temp' ? 'tempGeocodeBtn' : 'geocodeBtn').click();
        await paint();
        const review = $(prefix + 'CandidateReview'), candidate = $(prefix + 'CandidateMap');
        const deadline = Date.now() + 5000;
        while (review.hidden && Date.now() < deadline) await paint();
        check(!review.hidden && candidate.childElementCount > 0, 'Candidate needs a labelled map or offline fallback');
        check(/Save/.test(review.textContent)
          && ![...$(kind === 'temp' ? 'settingsTempHomeEditor' : 'settingsHomeEditor').querySelectorAll('button')]
            .some(button => button.textContent.trim() === 'Cancel')
          && $(kind === 'temp' ? 'tempClearHomeBtn' : 'clearHomeBtn'),
          'Candidate must offer explicit Save and use Clear to cancel without a separate Cancel button');
        const rect = review.getBoundingClientRect();
        const input = $(prefix + 'Place').getBoundingClientRect();
        const search = $(prefix + 'Place').closest('.saved-location-search').getBoundingClientRect();
        const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
        check(input.width >= Math.min(search.width, 120 * scale) - 1,
          'Scaled text must not squeeze the address input behind Go/Here/Clear');
        check(rect.width > 0 && rect.left >= -.5 && rect.right <= innerWidth+.5,
          'Saved-location candidate must fit the viewport');
        const summary = $(prefix + 'CandidateSummary').textContent;
        if (kind === 'temp') {
          $('tempHomeDeviceSave').click();
          await $('tempHomeDeviceSave')._tempHomeSave;
          await paint();
          check(/Temp Home \(Active\)/.test($('homeSettingsTitle').textContent),
            'Saved Temp must be visibly distinguished from its unsaved candidate');
          check($('tempHomeSavedMap').childElementCount > 0, 'Saved Temp needs its own map/fallback');
        } else {
          $('clearHomeBtn').click();
          await paint();
          check($('homeSavedMap').childElementCount > 0, 'Saved Home needs its own map/fallback');
        }
        return {kind, candidate:summary, width:rect.width,inputWidth:input.width};
      });
    }
    await record('F1518 saved Home retires the obsolete region warning', async () => {
      $('tempHomeRestore').click();
      await $('tempHomeRestore')._tempHomeSave;
      for (const field of ['lat','lng','place']) localStorage.removeItem(A.homeKey(field));
      A.openSavedLocationEditor('home');
      await A.reconcileSavedBase(false);
      const notice = $('savedBaseRegionNotice'), review = notice.querySelector('button');
      check(!notice.hidden && /Home is not set/.test(notice.textContent),
        'Missing Home must not be described as geographically unreachable');
      const rect = notice.getBoundingClientRect();
      actionNoticeHeight = rect.height;
      check(rect.width > 0 && rect.left >= -.5 && rect.right <= innerWidth+.5,
        'Missing-Home notice must fit the viewport');
      check(review.dataset.savedBaseEditor === 'home', 'Missing Home must link to the Home editor');
      review.click();
      $('homePlace').value = '47.75, -122.16';
      $('geocodeBtn').click();
      await paint();
      check(!$('homeCandidateReview').hidden, 'Home requires explicit candidate approval');
      $('homeDeviceSave').click();
      await paint();
      check(notice.hidden, 'Approved reachable Home must retire the stale warning without a region switch');
      check(/Home \(Active\)/.test($('homeSettingsTitle').textContent),
        'Saved Home remains the active base');
      return {missingNoticeWidth:rect.width, warningRetired:true};
    });
    await record('F1533 one Home card leads Settings with a linked current value', async () => {
      A.openSavedLocationEditor('home');
      $('settingsHomeEditor').open = false;
      $('settingsTempHomeEditor').open = false;
      window.scrollTo(0,0);
      await paint();
      const positions = [];
      for (const prefix of ['home']) {
        const bubble = $(prefix+'SettingsBubble'), summary = $(prefix+'SavedSummary');
        check(bubble && !bubble.closest('[hidden]') && !summary.closest('details'),
          'Current saved values must remain visible outside the closed editor');
        const rect = bubble.getBoundingClientRect(), text = summary.getBoundingClientRect();
        const style = getComputedStyle(bubble);
        check(parseFloat(style.borderTopWidth)>0 && parseFloat(style.borderRadius)>0,
          'Each saved location needs a visible rounded outline, not color alone');
        check(rect.width>0 && rect.left>=-.5 && rect.right<=innerWidth+.5
          && text.height>0 && text.left>=rect.left && text.right<=rect.right,
        'Each saved-location bubble and current value must fit the page width');
        positions.push({top:rect.top,bottom:rect.bottom,width:rect.width});
      }
      check(!$('tempHomeSettingsBubble')
        && positions[0].bottom<=$('settingsCategories').getBoundingClientRect().top+.5,
      'One Home card must lead Settings before every other category');
      check($('homeSavedSummary').querySelector('a[href]'), 'Saved address needs its Maps handoff');
      return {positions,closedEditorValuesVisible:true};
    });
    await record('F1519 review links visibly reach the requested saved editor', async () => {
      const positions = [];
      for (const kind of ['temp','home']) {
        localStorage.removeItem('ebird_temp_home_v1');
        if (kind === 'temp') {
          localStorage.setItem(A.homeKey('lat'),'19.7');
          localStorage.setItem(A.homeKey('lng'),'-155.1');
        } else {
          localStorage.removeItem(A.homeKey('lat'));
          localStorage.removeItem(A.homeKey('lng'));
        }
        for (const from of ['settings','feed']) {
          if (from === 'settings') A.openSavedLocationEditor('home');
          else A.showSection('sec-surgeBtn',{load:false});
          $('settingsHomeEditor').open = true;
          $('settingsTempHomeEditor').open = false;
          await A.reconcileSavedBase(false);
          window.scrollTo(0,0);
          const button = $('savedBaseRegionNotice').querySelector('button');
          check(!$('savedBaseRegionNotice').hidden && button.dataset.savedBaseEditor === kind,
            'The real warning must supply the requested saved-editor action');
          button.click();
          await paint();
          const editor = $(kind === 'temp' ? 'settingsTempHomeEditor' : 'settingsHomeEditor');
          const title = $(kind === 'temp' ? 'tempHomePlace' : 'homePlace').getBoundingClientRect();
          const header = $('navbar').getBoundingClientRect();
          check(editor.open && !$('settingsPanel').hidden
            && title.top >= header.bottom-.5 && title.bottom <= innerHeight+.5,
          'Review '+kind+' from '+from+' must bring its input below the sticky header and into view');
          positions.push({kind,from,top:title.top,bottom:title.bottom,headerBottom:header.bottom});
        }
      }
      return {positions};
    });
    await record('F1522 county report omits the redundant scope warning', async () => {
      A.setCountyView('US-WA-033');
      A.showSection('sec-surgeBtn',{load:false});
      await paint();
      check(!$('sec-surgeBtn').querySelector('.secscope:not(.secprofile)'),
        'County report must not add the redundant county-only warning');
      check($('navRegion').textContent.includes('US-WA-033')
        && A.activeScope().effectiveRegion === 'US-WA-033',
      'Removing the warning must retain exact county identity and acquisition scope');
      return {countyIdentityRetained:true,countyWarning:false};
    });
    await record('F1542 unknown boundary uses a compact passive named Temp caption', async () => {
      const customs = JSON.parse(originalCustom || '[]');
      customs.push({slug:'u-passive-boundary-review',label:'British Columbia',
        stateCode:'CA-BC',lat:48.45,lng:-123.4});
      localStorage.setItem('ebird_custom_regions',JSON.stringify(customs));
      localStorage.setItem('ebird_temp_home_v1',JSON.stringify({
        lat:48.45,lng:-123.4,label:'Victoria trip base'
      }));
      try {
        A.setActiveReport('u-passive-boundary-review');
        A.showSection('sec-surgeBtn',{load:false});
        await A.reconcileSavedBase();
        await paint();
        const notice = $('savedBaseRegionNotice'), review = notice.querySelector('button');
        if (mutation === 'passive-frame') notice.dataset.noticeKind = 'action';
        if (mutation === 'passive-action') review.hidden = false;
        const rect = notice.getBoundingClientRect(), style = getComputedStyle(notice);
        check(!notice.hidden && /Temp Home \(Active\): Victoria trip base/.test(notice.textContent)
          && /unknown.*unchanged/.test(notice.textContent),
        'Unknown boundaries must identify the active Temp and preserve uncertainty');
        check(review.hidden && parseFloat(style.borderTopWidth) === 0,
          'Unknown geometry is passive status, not a framed repair action');
        check(rect.width > 0 && rect.left >= -.5 && rect.right <= innerWidth+.5
          && rect.height < actionNoticeHeight,
        'The passive caption must fit the phone and be shorter than the actionable warning');
        return {height:rect.height,actionHeight:actionNoticeHeight,passive:true,namedTemp:true};
      } finally {
        if (originalCustom == null) localStorage.removeItem('ebird_custom_regions');
        else localStorage.setItem('ebird_custom_regions',originalCustom);
        A.setActiveReport(originalReport);
        A.setCountyView('');
      }
    });
    await record('F1517 single-page region chooser', async () => {
      A.openRegionChooser();
      $('regionChooserLocation').querySelector('[data-region-location="all"]').click();
      $('regionChooserStateList').open = true;
      $('regionChooserCountyList').open = true;
      await paint();
      const chooser = $('regionChooser'), body = $('regionChooserBody');
      if (mutation === 'nested-scroll') {
        chooser.style.display = 'grid';
        chooser.style.gridTemplateRows = 'auto auto minmax(0,1fr)';
        chooser.style.overflow = 'hidden';
        body.style.overflowY = 'auto'; body.style.minHeight = '0';
      }
      const vertical = element => /auto|scroll/.test(getComputedStyle(element).overflowY)
        && element.scrollHeight > element.clientHeight + 1;
      check(vertical(chooser), 'Choose region must own the one vertical scroll surface');
      check(!vertical(body), 'Lower region choices must not scroll independently');
      check(![...body.querySelectorAll('*')].some(vertical), 'No nested vertical scroller in region choices');
      chooser.scrollTop = 0;
      await paint();
      const start = chooser.scrollTop;
      const top = document.querySelector('.regionchooser-search').getBoundingClientRect().top;
      chooser.scrollTop = start + 150;
      await paint();
      check(chooser.scrollTop > start + 50
        && document.querySelector('.regionchooser-search').getBoundingClientRect().top < top - 50,
      'Scrolling the choices must move upper page content too');
      body.scrollTop = 75;
      check(body.scrollTop === 0, 'Lower panel cannot retain a second scroll offset');
      chooser.scrollTop = chooser.scrollHeight;
      await paint();
      const close = $('regionChooserClose').getBoundingClientRect();
      check(close.top >= -.5 && close.bottom <= innerHeight+.5, 'Close remains reachable while page scrolls');
      chooser.scrollTop = 0;
      await paint();
      return {scrollHeight:chooser.scrollHeight, height:chooser.clientHeight, nestedScrollers:0};
    });
    await record('F1534 direct region search and right-hand Go', async () => {
      A.openRegionChooser();
      const chooser = $('regionChooser'), search = $('regionChooserSearch');
      const initial = A.activeScope().effectiveRegion;
      search.value = 'Kansas';
      search.dispatchEvent(new Event('input', {bubbles:true}));
      await paint();
      const results = $('regionChooserResults'), first = results.firstElementChild;
      check(!$('regionChooserSearchResults').hidden && !$('regionChooserBody').hidden,
        'Search must show direct results with the filtered catalog still available below');
      check(first && first.dataset.regionChoice === 'ks',
        'Exact Kansas must precede partial Arkansas and county matches');
      if (mutation === 'buried-region-results') results.style.marginTop = '1000px';
      const input = search.getBoundingClientRect(), go = $('regionChooserGo').getBoundingClientRect();
      const clear = $('regionChooserClear').getBoundingClientRect();
      const header = chooser.querySelector('.sheethead').getBoundingClientRect();
      const result = first.getBoundingClientRect(), sheet = chooser.getBoundingClientRect();
      check(input.width >= 80 && go.width >= 44 && go.height >= 44
        && go.left >= input.right + 3 && Math.abs(go.top-input.top) < 1
        && clear.width >= 44 && clear.height >= 44 && clear.left >= go.right + 3
        && Math.abs(clear.top-input.top) < 1 && clear.right <= sheet.right + .5,
      'Search and touch-sized right-hand Go/Clear must fit on one line');
      check(input.top >= header.bottom - .5 && result.top >= input.bottom
        && result.bottom <= sheet.bottom + .5,
      'Search and the first direct result must be visible below the header without hunting or scrolling');
      $('regionChooserGo').click();
      await paint();
      check(A.activeScope().effectiveRegion === initial && !chooser.hidden
        && results.firstElementChild.dataset.regionChoice === 'ks',
      'Go must show matches without selecting a region');
      $('regionChooserClear').click();
      await paint();
      check(!search.value && $('regionChooserSearchResults').hidden && !$('regionChooserBody').hidden
        && document.activeElement === search,
      'Clear must restore catalog browsing and return focus to search');
      return {inputWidth:input.width,goWidth:go.width,clearWidth:clear.width,
        resultBottom:result.bottom,viewportHeight:sheet.height};
    });
    await record('F1544 one lazy boundary serves Temp review, membership and setup outline', async () => {
      $('regionChooserClose').click();
      let radiusKey, oldRadius;
      const setupKeys = ['bc_setup_step_v1','bc_setup_home_draft_v1'];
      const setupValues = setupKeys.map(key => localStorage.getItem(key));
      const previousFetch = window.fetch;
      let requests = 0;
      const boundary = boundaryProbe || {type:'FeatureCollection',features:[{type:'Feature',
        properties:{PRUID:'59',PRENAME:'British Columbia'},geometry:{type:'Polygon',
          coordinates:[[[-139,48],[-114,48],[-114,61],[-139,61],[-139,48]]]}}]};
      window.fetch = function (url) {
        if (/geo\.statcan\.gc\.ca/.test(String(url))) {
          requests++;
          return Promise.resolve(new Response(JSON.stringify(boundary),
            {headers:{'Content-Type':'application/geo+json'}}));
        }
        return previousFetch.apply(this, arguments);
      };
      try {
        localStorage.setItem('ebird_custom_regions',JSON.stringify([
          ...JSON.parse(originalCustom || '[]'),{slug:'u-lazy-boundary-review',
            label:'British Columbia',stateCode:'CA-BC',lat:48.45,lng:-123.4}
        ]));
        localStorage.setItem('ebird_temp_home_v1',JSON.stringify({
          lat:48.45,lng:-123.4,label:'Victoria trip base'
        }));
        A.setActiveReport('u-lazy-boundary-review');
        radiusKey = A.chaseMiKey(); oldRadius = localStorage.getItem(radiusKey);
        localStorage.setItem(radiusKey,'5');
        const home = JSON.stringify(A.getHome());
        const decision = await A.reconcileSavedBase();
        check(decision && decision.choice === 'temp' && $('savedBaseRegionNotice').hidden,
          'The identified BC boundary must keep usable Temp and retire unknown-distance status');
        check(A.patchEvidenceRows([{lat:48.45,lng:-123.4,subnational1Code:'CA-BC'},
          {lat:47.6,lng:-122.3,subnational1Code:'CA-BC'}]).length === 1,
        'The same geometry must reject a contradictory outside coordinate');
        A.openSavedLocationEditor('temp');
        await paint();
        $('tempHomePlace').value = '49.2827, -123.1207';
        $('tempGeocodeBtn').click();
        const deadline = Date.now() + 5000;
        while ($('tempHomeCandidateReview').hidden && Date.now() < deadline) await paint();
        check(!$('tempHomeCandidateReview').hidden
          && !/could not be verified|Warning:/.test($('tempHomeCandidateConsent').textContent),
        'Candidate assessment must reuse known geometry without an unknown-distance warning: '
          + $('tempGeocodeStatus').textContent + ' / ' + $('tempHomeCandidateConsent').textContent);
        const candidate = $('tempHomeCandidateReview').getBoundingClientRect();
        check(candidate.width > 0 && candidate.left >= -.5 && candidate.right <= innerWidth+.5,
          'The known-boundary candidate must fit the phone');
        $('tempClearHomeBtn').click();
        const point = {lat:49.2827,lng:-123.1207,label:'Vancouver candidate'};
        localStorage.setItem('bc_setup_home_draft_v1',JSON.stringify({profile:'',approved:true,point,
          region:{status:'ok',code:'CA-BC',label:'British Columbia',lat:point.lat,lng:point.lng}}));
        localStorage.setItem('bc_setup_step_v1','region');
        A.openSetupSheet();
        const outlineDeadline = Date.now() + 5000;
        while ((!$('setupRegionOutline') || $('setupRegionOutline').hidden)
            && Date.now() < outlineDeadline) await paint();
        const svg = $('setupRegionOutline').querySelector('svg');
        check(svg && /British Columbia.*CA-BC/.test(svg.getAttribute('aria-label'))
          && svg.querySelector('path').getAttribute('fill-rule') === 'evenodd',
        'Setup must reuse the identified outline and retain hole semantics and an accessible label');
        if (mutation === 'boundary-outline-overflow') svg.style.width = '1000px';
        const box = svg.getBoundingClientRect();
        check(box.width > 0 && box.left >= -.5 && box.right <= innerWidth+.5,
          'The on-demand setup outline must fit the phone');
        check(requests === 1 && JSON.stringify(A.getHome()) === home
          && A.tempHome().label === 'Victoria trip base',
        'All consumers must share one request without saving either unsaved candidate');
        return {requests,candidateWidth:candidate.width,outlineWidth:box.width,source:boundary.features[0].properties.PRUID};
      } finally {
        window.fetch = previousFetch;
        $('setupSheetClose').click();
        setupKeys.forEach((key,i) => {
          if (setupValues[i] == null) localStorage.removeItem(key); else localStorage.setItem(key,setupValues[i]);
        });
        if (radiusKey) {
          if (oldRadius == null) localStorage.removeItem(radiusKey); else localStorage.setItem(radiusKey,oldRadius);
        }
        if (originalCustom == null) localStorage.removeItem('ebird_custom_regions');
        else localStorage.setItem('ebird_custom_regions',originalCustom);
        A.setActiveReport(originalReport);
      }
    });
  } finally {
    window.fetch = originalFetch;
    $('regionChooserClose').click();
    homeKeys.forEach((key,index) => {
      if (originalHome[index] == null) localStorage.removeItem(key);
      else localStorage.setItem(key,originalHome[index]);
    });
    if (originalTemp == null) localStorage.removeItem('ebird_temp_home_v1');
    else localStorage.setItem('ebird_temp_home_v1',originalTemp);
    A.setCountyView(originalCounty);
    A.resetTransientAnchor();
    A.showMenu();
  }
  return out;
}

module.exports = savedLocationLayout;
