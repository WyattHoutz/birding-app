'use strict';

async function savedLocationLayout(scan, mutation) {
  const A = window.__app, out = [];
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const $ = id => document.getElementById(id);
  const originalTemp = localStorage.getItem('ebird_temp_home_v1');
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
        check(!review.hidden && candidate.childElementCount > 0, 'Candidate needs a labelled map or offline fallback');
        check(review.textContent.includes('Cancel') && /Save/.test(review.textContent),
          'Candidate must offer explicit Save and Cancel');
        const rect = review.getBoundingClientRect();
        check(rect.width > 0 && rect.left >= -.5 && rect.right <= innerWidth+.5,
          'Saved-location candidate must fit the viewport');
        const summary = $(prefix + 'CandidateSummary').textContent;
        if (kind === 'temp') {
          $('tempHomeDeviceSave').click();
          await paint();
          check(/Active saved base/.test($('tempHomeSavedSummary').textContent),
            'Saved Temp must be visibly distinguished from its unsaved candidate');
          check($('tempHomeSavedMap').childElementCount > 0, 'Saved Temp needs its own map/fallback');
        } else {
          $('homeCandidateCancel').click();
          await paint();
          check($('homeSavedMap').childElementCount > 0, 'Saved Home needs its own map/fallback');
        }
        return {kind, candidate:summary, width:rect.width};
      });
    }
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
      const top = document.querySelector('.regionchooser-search').getBoundingClientRect().top;
      chooser.scrollTop = 150;
      await paint();
      check(chooser.scrollTop > 0
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
    if (originalTemp == null) localStorage.removeItem('ebird_temp_home_v1');
    else localStorage.setItem('ebird_temp_home_v1',originalTemp);
    A.resetTransientAnchor();
    A.showMenu();
  }
  return out;
}

module.exports = savedLocationLayout;
