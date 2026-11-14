'use strict';

async function forwardLayout(scan, notableFixture, mutation) {
  const A = window.__app, results = [];
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = (ok, message, measurements) => {
    if (!ok) throw new Error(message + ': ' + JSON.stringify(measurements));
  };
  async function record(label, fixture) {
    try {
      const measurements = await fixture();
      results.push(Object.assign(scan(label), {forwardGeometry: measurements}));
    } catch (error) {
      results.push({label, fixtureError: error.message});
    }
  }
  const now = new Date(Date.now() - 3600000);
  const stamp = now.toISOString().slice(0, 19);
  A.setActiveReport('wa');
  A.setCountyView('');

  await record('F1371 taller populated Stakeout map', async () => {
    A.clearSpeciesLookup();
    A.showSection('sec-spLookupBtn', {load: false});
    A.seedEbirdCache(A.speciesLookupPath('US-WA', 'verfly', A.SP_LOOKUP_BACK), [{
      speciesCode: 'verfly', comName: 'Vermilion Flycatcher', obsDt: stamp,
      subId: 'S1371AUDIT', locId: 'L1371AUDIT', locName: 'Synthetic public marsh',
      lat: 47.8, lng: -122.16, howMany: 1, obsValid: true, locationPrivate: false
    }]);
    await A.lookupSpecies('verfly', 'Vermilion Flycatcher');
    await paint();
    const map = document.getElementById('spLookupMap');
    if (mutation === 'map') map.style.aspectRatio = '16 / 7';
    const actual = map.getBoundingClientRect();
    const previous = map.style.aspectRatio;
    map.style.aspectRatio = '16 / 7';
    const control = map.getBoundingClientRect();
    map.style.aspectRatio = previous;
    const measurements = {width: actual.width, height: actual.height,
      controlWidth: control.width, controlHeight: control.height,
      pins: map.querySelectorAll('[data-pin-place], .pinbubble, .leaflet-marker-icon').length};
    check(measurements.pins > 0, 'F1371 actual populated map missing', measurements);
    check(actual.width > 0 && Math.abs(actual.width - control.width) <= 1
      && actual.height / control.height >= 1.95 && actual.height / control.height <= 2.05,
    'F1371 map must double height without widening', measurements);
    return measurements;
  });

  await record('F1374 Busy card presentation', async () => {
    A.showSection('hotPanel', {load: false});
    A.renderHot({hot: [], cold: [], busy: [{
      locId: 'L1374AUDIT', name: 'Edmonds Waterfront', observers: 13, baseline: 2.25,
      ratio: 13 / 2.25, dist: 12, lat: 47.8, lng: -122.16, latest: stamp,
      currentWeekChecklists: 15, previousWeekChecklists: 3, referenceCounts: [2, 3]
    }], busyState: {at: Date.now(), pending: false}, rarityRows: [{
      locId: 'L1374AUDIT', code: 'chispa', name: 'Clay-colored Sparrow',
      kind: 'Rarity', dateStr: stamp, valid: true
    }]});
    await paint();
    const card = document.querySelector('#hotResults .busypatch');
    check(card && card.getBoundingClientRect().height > 0,
      'F1374 actual Busy card must be visible', {});
    const metrics = Array.from(card.querySelectorAll('.busypatchmetric'));
    const bird = card.querySelector('.busypatchrarities .splink');
    const badge = card.querySelector('.hsnum');
    const distance = card.querySelector('.hsdist');
    const unit = distance.querySelector('small');
    const title = card.querySelector('.ntext > .hslink');
    if (mutation === 'highlight') metrics[0].style.background = '#edf4fa';
    if (mutation === 'species') bird.style.fontSize = 'calc(17px * var(--s))';
    if (mutation === 'distance') {
      distance.style.fontSize = 'calc(17px * var(--s))';
      unit.style.fontSize = 'calc(12px * var(--s))';
    }
    if (mutation === 'gap') badge.style.marginRight = '0';
    const size = node => parseFloat(getComputedStyle(node).fontSize);
    const backgrounds = metrics.map(node => getComputedStyle(node).backgroundColor);
    const measurements = {backgrounds, bird: size(bird), reason: size(bird.parentElement),
      distance: size(distance), units: size(unit), title: size(title),
      gap: parseFloat(getComputedStyle(badge).marginRight)};
    check(metrics.length >= 3 && backgrounds.every(value => value === 'rgba(0, 0, 0, 0)'),
      'F1374 statistics must not be highlighted', measurements);
    check(Math.abs(measurements.bird - measurements.reason) <= .1,
      'F1374 bird text must match Rare reports text', measurements);
    check(Math.abs(measurements.distance - measurements.title) <= .1
      && measurements.units >= measurements.reason,
    'F1374 distance and units must remain readable', measurements);
    const range = document.createRange();
    range.selectNodeContents(title);
    const text = Array.from(range.getClientRects()).find(rect => rect.width && rect.height);
    const badgeBox = badge.getBoundingClientRect();
    measurements.visibleGap = text.left - badgeBox.right;
    check(measurements.gap >= size(badge) * .2
      && (text.top >= badgeBox.bottom - 1 || measurements.visibleGap >= size(badge) * .2),
    'F1374 numbered badge must be separated from hotspot name', measurements);
    check(card.scrollWidth <= card.clientWidth + 1, 'F1374 card must fit', measurements);
    return measurements;
  });

  await record('F1375 atomic NEW badge', async () => {
    A.setRarityFilter('year', 'all');
    A.setRarityFilter('distance', 'near');
    A.setRaritySort('date');
    A.setTwitchView('list');
    const profile = A.chaseProfile();
    const raw = [{speciesCode: 'bkhhum', comName: 'Black-chinned Hummingbird',
      obsDt: stamp, subId: 'S1375AUDIT', locId: 'L1375AUDIT',
      locName: 'Synthetic public park', lat: 47.8, lng: -122.16,
      howMany: 1, obsValid: false, locationPrivate: false}];
    const files = {'king-notable.json': raw};
    A.setRarityInflight(null);
    A.seedChase(profile.slug, notableFixture(profile, {t: Date.now(), rarity: false,
      fetchBaseKey: A.chaseFetchBaseKey(profile),
      geoNotableKm: window.BirdLogic.geoNotableDistKm(profile),
      speciesCodes: ['bkhhum'], rows: files,
      cv: A.computeChaseRows(profile, 'wa', files, ['bkhhum'])}));
    A.showSection('sec-refreshBtn', {load: false});
    A.refresh();
    for (let i = 0; i < 100 && !document.querySelector('#results .newflag'); i++)
      await new Promise(resolve => setTimeout(resolve, 30));
    await paint();
    const badge = document.querySelector('#results .newflag');
    check(badge && badge.textContent === 'NEW', 'F1375 actual Twitches badge missing', {});
    function letterTops(node) {
      return Array.from({length: 3}, (_, i) => {
        const range = document.createRange();
        range.setStart(node.firstChild, i);
        range.setEnd(node.firstChild, i + 1);
        return range.getBoundingClientRect().top;
      });
    }
    const actualTops = letterTops(badge);
    check(Math.max(...actualTops) - Math.min(...actualTops) <= .5,
      'F1375 actual Twitches NEW badge must not split', {actualTops});
    const probe = document.createElement('div');
    const clone = badge.cloneNode(true);
    const style = getComputedStyle(badge);
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = style.font;
    const width = canvas.measureText('NEW').width + 3 * parseFloat(style.letterSpacing)
      + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
    probe.style.cssText = 'grid-column:1/-1;overflow-wrap:anywhere;width:' + Math.ceil(width * 3) + 'px';
    const prefix = document.createTextNode('');
    probe.append(prefix, clone);
    badge.closest('li').appendChild(probe);
    if (mutation === 'badge') {
      clone.style.display = 'inline';
      clone.style.whiteSpace = 'normal';
    }
    let measurements;
    for (let length = 1; length <= 24; length++) {
      prefix.textContent = 'H'.repeat(length);
      const tops = letterTops(clone);
      const box = clone.getBoundingClientRect(), container = probe.getBoundingClientRect();
      measurements = {actualTops, prefixLength: length, letterTops: tops, width: box.width,
        available: container.width, display: getComputedStyle(clone).display,
        whiteSpace: getComputedStyle(clone).whiteSpace};
      check(Math.max(...tops) - Math.min(...tops) <= .5
        && box.left >= container.left - 1 && box.right <= container.right + 1,
      'F1375 NEW must stay whole and fit when wrapping', measurements);
    }
    probe.remove();
    return measurements;
  });
  return results;
}

module.exports = forwardLayout;
