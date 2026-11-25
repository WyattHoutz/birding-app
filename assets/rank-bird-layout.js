'use strict';

module.exports = async function rankBirdLayout(scan, prepare, mutation, progress) {
  var A = window.__app, out = [];
  var mark = progress || function () {};
  function require(value, message) { if (!value) throw new Error('F1528 ' + message); }
  mark('F1528 preparing captured history');
  A.cancelStalledWork(); A.setActiveReport('wa'); A.setCountyView('');
  await prepare(A, document, false);
  mark('F1528 checking captured history');
  if (mutation === 'inline') {
    var style = document.createElement('style');
    style.textContent = '.rankrow .rankbirdlist{display:flex!important;}';
    document.head.append(style);
  }
  var cards = Array.from(document.querySelectorAll('#rankResults .rankrow:not(.rankhdr)'));
  require(cards.length === 3, 'three representative birders must render');
  var movement = cards[0].querySelector('.mv'), arrow = movement.querySelector('.rankmovearrow');
  var birdName = cards[0].querySelector('.rankbirdline .name');
  var rank = cards[0].querySelector('.rankstack .hsnum');
  require(parseFloat(getComputedStyle(movement).fontSize) > parseFloat(getComputedStyle(birdName).fontSize),
    'movement number must be larger than the patch-row bird text');
  require(arrow && parseFloat(getComputedStyle(arrow).fontSize) >= parseFloat(getComputedStyle(movement).fontSize)
    && parseFloat(getComputedStyle(arrow).fontSize) < parseFloat(getComputedStyle(rank).fontSize),
    'movement arrow must stay readable but smaller than the rank number');
  var compact = document.createElement('ul');
  compact.className = 'convoysppl';
  compact.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden';
  compact.innerHTML = '<li><span class="thumb"></span></li>';
  document.body.append(compact);
  var compactPhoto = compact.querySelector('.thumb').getBoundingClientRect().width;
  var compactFont = parseFloat(getComputedStyle(compact).fontSize);
  compact.remove();
  require(Math.abs(parseFloat(getComputedStyle(birdName).fontSize) - compactFont) < .5,
    'bird names must use the existing compact list text size');
  function geometry(expected, label) {
    var lines = Array.from(cards[0].querySelectorAll('.rankbirdline'));
    require(lines.length === expected, label + ' has the wrong captured count');
    require(lines[0].parentElement.matches('.obs.card-sm.sppl'),
      'bird history uses the shared patch-style small-card list');
    lines.forEach(function (line, i) {
      var photo = line.querySelector('.rankbirdicon .thumb'), image = photo && photo.getBoundingClientRect();
      var box = line.getBoundingClientRect(), card = cards[0].getBoundingClientRect();
      require(image && compactPhoto > 0 && Math.abs(image.width - compactPhoto) < .5
        && Math.abs(image.height - compactPhoto) < .5,
      'every bird photo must match the existing compact list icon size');
      require(parseFloat(getComputedStyle(line.querySelector('.name')).minHeight) <= compactPhoto + .5,
        'compact photos must not retain oversized row height');
      var detail = line.querySelector('.rankdetail').textContent;
      require(/^\([A-Z]{4}\//.test(detail),
        'every bird keeps its official four-letter code');
      var identifiers = /^\(([A-Z]{4})\/([a-z0-9]+)\)/.exec(detail);
      require(identifiers && identifiers[2] === line.querySelector('[data-sp]').dataset.sp,
        'every bird keeps its exact eBird taxon identifier beside its four-letter code');
      require(box.left >= card.left && box.right <= card.right + .5
        && image.left >= box.left && image.right <= box.right + .5,
      'bird/photo must fit the actual card: ' + JSON.stringify({
        bird: i, line: [box.left, box.right], card: [card.left, card.right], photo: [image.left, image.right]
      }));
      if (i) {
        var gap = box.top - lines[i - 1].getBoundingClientRect().bottom;
        require(gap >= -.5 && gap <= .5,
          'bird items must stay separate without extra gaps');
      }
    });
    var result = scan(label);
    out.push(Object.assign(result, { rankBirdHistory: { birds: expected, photos: lines.length, separateLines: true } }));
  }
  mark('F1528 waiting for layout frames');
  await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  mark('F1528 measuring five captured birds');
  geometry(5, 'F1528 five inline captured birds');
  require(cards[1].querySelectorAll('.rankbirdline').length === 2, 'two birds are directly visible');
  require(cards[2].querySelectorAll('.rankbirdline').length === 1, 'a missing profile keeps only its current bird');
  require(cards[2].querySelector('.rankplainname'), 'a missing profile is not a misleading link');
  var link = cards[0].querySelector('[data-rank-birds-more]'), first = cards[0].querySelector('.rankbirdline');
  require(link.tagName === 'A' && getComputedStyle(link).borderTopStyle === 'none'
    && getComputedStyle(link).backgroundColor === 'rgba(0, 0, 0, 0)',
    'Show more must be an unboxed text link');
  var linkStyle = getComputedStyle(link), standardLinkStyle = getComputedStyle(document.getElementById('easyCommonMore'));
  require(['fontSize', 'fontWeight', 'lineHeight', 'color', 'textDecorationLine'].every(function (key) {
    return linkStyle[key] === standardLinkStyle[key];
  }), 'Show more must match the app text-link formatting');
  var target = link.getBoundingClientRect();
  require(target.width >= 44 && target.height >= 44,
    'Show more needs a touch target: ' + target.width + ' x ' + target.height);
  var scroll = window.scrollY;
  link.click();
  mark('F1528 waiting for appended layout');
  await new Promise(function (resolve) { requestAnimationFrame(resolve); });
  require(cards[0].querySelector('.rankbirdline') === first, 'Show more must preserve existing nodes');
  require(document.activeElement === cards[0].querySelectorAll('.rankbirdline')[5],
    'focus moves to the first appended bird without jumping the page');
  require(Math.abs(window.scrollY - scroll) < 1, 'Show more must preserve the viewport scroll position');
  geometry(8, 'F1528 eight captured birds after Show more');
  mark('F1528 geometry complete');
  return out;
};
