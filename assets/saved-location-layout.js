'use strict';

async function savedLocationLayout(scan, mutation) {
  const A = window.__app, out = [];
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const $ = id => document.getElementById(id);
  const originalTemp = localStorage.getItem('ebird_temp_home_v1');
  const originalCounty = A.getCountyView();
  const homeKeys = ['lat','lng','place'].map(field => A.homeKey(field))
    .concat('ebird_home_migrated_v1');
  const originalHome = homeKeys.map(key => localStorage.getItem(key));
  async function record(label, run) {
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
        $(prefix + 'Place').value = '47.61, -122.33';
        $(kind === 'temp' ? 'tempGeocodeBtn' : 'geocodeBtn').click();
        await paint();
        const review = $(prefix + 'CandidateReview'), candidate = $(prefix + 'CandidateMap');
        const deadline = Date.now() + 5000;
        while (review.hidden && Date.now() < deadline) await paint();
        check(!review.hidden && candidate.childElementCount > 0, 'Candidate needs a labelled map or offline fallback');
        check(review.textContent.includes('Cancel') && /Save/.test(review.textContent),
          'Candidate must offer explicit Save and Cancel');
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
          await paint();
          check(/Temp Home \(Active\)/.test($('homeSettingsTitle').textContent),
            'Saved Temp must be visibly distinguished from its unsaved candidate');
          check($('tempHomeSavedMap').childElementCount > 0, 'Saved Temp needs its own map/fallback');
        } else {
          $('homeCandidateCancel').click();
          await paint();
          check($('homeSavedMap').childElementCount > 0, 'Saved Home needs its own map/fallback');
        }
        return {kind, candidate:summary, width:rect.width,inputWidth:input.width};
      });
    }
    await record('F1518 saved Home retires the obsolete region warning', async () => {
      $('tempHomeRestore').click();
      for (const field of ['lat','lng','place']) localStorage.removeItem(A.homeKey(field));
      A.openSavedLocationEditor('home');
      await A.reconcileSavedBase(false);
      const notice = $('savedBaseRegionNotice'), review = notice.querySelector('button');
      check(!notice.hidden && /Home is not set/.test(notice.textContent),
        'Missing Home must not be described as geographically unreachable');
      const rect = notice.getBoundingClientRect();
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
  } finally {
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
