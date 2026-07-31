/* =========================================================================
   HOTSPOT CARD TEMPLATES  —  small · medium · large
   =========================================================================

   The other card family; birds live in cards-species.js. Every section that
   answers "which PLACE should I drive to, and what is there?" renders through
   this file: Top destinations, Closest spots with unseen birds, Quick outing,
   Top excursions, Trip planner, Hot & Cold hotspots and Favorite hotspots.
   They were seven lookalike layouts written seven times; now they differ only
   in what they put in the icon and the sub-header.

   THE MEDIUM CARD IS THE ONE THAT MATTERS, and it owns a fixed shape:

       ( 3 )  Marina Beach Park              <- number + name
              2.4 mi · score 41 · 3 targets  <- sub-header
       ------------------------------------
       🔍 UNSEEN, ALWAYS EXPANDED           <- the reason to drive there
          [small species card]
          [small species card]
       > 34 more species already seen        <- COLLAPSED, it is context
       ------------------------------------
       🗺 Open in Maps      ★ Save           <- what you do next

   Why unseen is expanded and seen is collapsed: a hotspot card exists to
   answer "is this worth the drive?", and only the unseen list answers it.
   Hot hotspots collapsed BOTH behind one expander, so the deciding fact was
   one tap away on every row while a species count you cannot act on was
   printed in full. Seen birds still earn a place — they tell you the spot is
   alive rather than empty — but they are context, so they collapse.

   PLACEHOLDERS every size accepts (all optional except name):

     {{num}}       the marker number, styled to match the map pin
     {{icon}}      an explicit icon, if a section has something better
     {{name}}      hotspot name, already linked and escaped
     {{distance}}  "2.4 mi"
     {{score}}     "score 41"
     {{sub}}       any further sub-header facts
     {{unseen}}    HTML list of unseen birds  (rendered EXPANDED)
     {{seen}}      HTML list of seen birds    (rendered COLLAPSED)
     {{below}}     anything else, full width
     {{actions}}   overrides the default Open in Maps / Save row

   Like the species file this is LAYOUT ONLY — it receives HTML the app has
   already escaped and never touches eBird data.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- markup */

  var SMALL = [
    '<li class="{{cls}}">',
    '  <div class="name">{{marker}}<span class="ntext">{{name}}{{sub}}</span></div>',
    '  {{below}}',
    '</li>'
  ].join('\n');

  var MEDIUM = [
    '<li class="{{cls}}">',
    '  <div class="name">{{marker}}<span class="ntext">{{name}}</span></div>',
    '  <div class="meta">{{sub}}</div>',
    '  {{unseen}}',
    '  {{seen}}',
    '  {{below}}',
    '  {{actions}}',
    '</li>'
  ].join('\n');

  var LARGE = [
    '<li class="{{cls}}">',
    '  <div class="hscardhead">{{marker}}<span class="ntext">{{name}}</span></div>',
    '  <div class="meta">{{sub}}</div>',
    '  {{unseen}}',
    '  {{seen}}',
    '  {{below}}',
    '  {{actions}}',
    '</li>'
  ].join('\n');

  /* The number is a copy of the Leaflet map pin (.pinbubble) on purpose: the
     pin labelled 3 on the map and the row labelled 3 in the list are the same
     place, and making them look like the same object is the whole point. */
  var MARKER = '<span class="hsnum">{{num}}</span>';

  /* ------------------------------------------------------------------- css */

  var CSS = [
    /* ---- A CARD TITLE THAT IS A LINK KEEPS THE TITLE'S TYPE ----
       A hotspot name is rendered as an `<a class="extlink">` so it can open
       the eBird hotspot page. index.html styles that class for what it was
       built for — an ACTION link ("Open in Maps") — at 13px with an 8px top
       margin, and that reached the TITLE text. So the hotspot name rendered
       at 13px however large this file said it was (raising it 23px -> 46px in
       v1.0.32 changed nothing visible), the 8px margin read as a blank line
       above the name, and the 15px sub-header was BIGGER than the name it
       belongs to. Same root cause in cards-species.js. Only the colour of a
       title link stays its own. ---- */
    '.hscard .ntext a, .hscard .ntext .extlink {',
    '  display: inline; margin-top: 0;',
    '  font-size: inherit; font-weight: inherit; line-height: inherit;',
    '  letter-spacing: inherit; }',

    /* ---- the map-pin number ---- */
    '.hsnum {',
    '  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;',
    '  box-sizing: border-box; border-radius: 50%;',
    '  background: #e5484d; color: #fff; border: 2px solid #fff;',
    '  box-shadow: 0 1px 3px rgba(0,0,0,.4);',
    '  font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1;',
    '  width: calc(46px * var(--s)); height: calc(46px * var(--s));',
    '  font-size: calc(19px * var(--s)); }',
    '.hscard-sm .hsnum { width: calc(34px * var(--s)); height: calc(34px * var(--s));',
    '                    font-size: calc(15px * var(--s)); }',
    '.hscard-lg .hsnum { width: calc(56px * var(--s)); height: calc(56px * var(--s));',
    '                    font-size: calc(23px * var(--s)); }',
    /* Home keeps the green it has on the map. */
    '.hsnum.home { background: #0f7a52; }',

    /* ---- SMALL ---- */
    '.hscard-sm { padding: 12px 0; }',
    '.hscard-sm > .name { display: flex; align-items: center; gap: 10px;',
    '                     min-height: calc(34px * var(--s)); line-height: 1.25; }',

    /* ---- MEDIUM: the same 2x2 grid the species card uses ----
       The number sits in the icon slot at the SMALL card's 46px rather than
       the species card's 92px photo size. A photo needs the width to be
       legible; a one- or two-digit number does not, and the 46px box hands
       the difference back to the name, which is the part that wraps. */
    '.hscard-md {',
    '  display: grid; grid-template-columns: auto minmax(0, 1fr);',
    '  column-gap: 14px; row-gap: 2px; align-items: start; padding: 10px 0;',
    '  overflow: hidden; }',
    '.hscard-md > .name { display: contents; }',
    '.hscard-md > .name > .hsnum { grid-column: 1; grid-row: 1 / span 2; }',
    '.hscard-md > .name > .ntext {',
    '  grid-column: 2; grid-row: 1; align-self: end; min-width: 0;',
    /* The hotspot name is the SUBJECT of a hotspot card, so it outranks its
       own sub-header — which it did NOT: the name was reaching the screen at
       13px against a 15px sub-header (see the title-link rule at the top of
       this file). 26px restores the ranking without the 46px the file used to
       ask for, which wrapped a real name like
       "Marymoor Park--Audubon BirdLoop/Interpretive-Boardwalk" over five
       lines on a 430px phone and made a LIST of hotspots unscannable.
       The size is also load-bearing for spacing: .hsnum spans both rows at
       46px, and a grid distributes a spanning item's minimum height across
       the rows it spans, so whenever name + row-gap + meta came to LESS than
       46px the rows stretched to fill the badge — which is exactly the
       reported blank line above the name and the dead space under the number.
       26*1.15 + 2 + 17*1.35 = 54.9 > 46, so the text block now sets the
       height and the badge no longer stretches anything. All three terms
       scale with --s, so the relationship holds at every text size.
       break-word (not `anywhere`) keeps it wrapping between words, and only
       splits a token like "Marsh--Willow" when that token alone cannot fit. */
    '  font-size: calc(26px * var(--s)); font-weight: 700; line-height: 1.15;',
    '  overflow-wrap: break-word; word-break: normal; hyphens: none; }',
    '.hscard-md > .meta {',
    '  grid-column: 2; grid-row: 2; align-self: start; min-width: 0;',
    '  font-size: calc(17px * var(--s)); font-weight: 500; color: var(--muted); }',
    /* Species lists, the expander and the actions row all span both columns. */
    '.hscard-md > * { grid-column: 1 / -1; }',
    '.hscard-md > .name, .hscard-md > .meta { grid-column: auto; }',

    /* ---- LARGE ---- */
    '.hscard-lg { border: 1px solid var(--line); border-radius: 16px;',
    '             margin: 0 0 16px; padding: 14px; background: var(--card); }',
    '.hscard-lg > .hscardhead { display: flex; align-items: center; gap: 12px;',
    '                           font-size: calc(26px * var(--s)); font-weight: 800; }',
    '.hscard-lg > .meta { font-size: calc(16px * var(--s)); color: var(--muted);',
    '                     margin-top: 4px; }',

    /* ---- the two species lists ---- */
    '.hsunseen { margin-top: 8px; }',
    '.hsunseen > .hslabel { font-size: calc(14px * var(--s)); font-weight: 700;',
    '                       color: var(--accent); }',
    '.hsseen { margin-top: 6px; }',
    '.hsseen > summary { cursor: pointer; font-size: calc(14px * var(--s));',
    '                    color: var(--muted); }',

    /* ---- the actions row ---- */
    '.hsact { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 4px 18px;',
    '         font-size: calc(15px * var(--s)); }',
    ''
  ].join('\n');

  /* ------------------------------------------------------------------ impl */

  function fill(tpl, vars) {
    return tpl.replace(/\{\{(\w+)\}\}/g, function (_, k) {
      var v = vars[k];
      return (v == null || v === false) ? '' : String(v);
    }).replace(/ class=""/g, '');
  }

  function subHtml(v, wrap) {
    var bits = [v.distance, v.score, v.sub].filter(function (x) {
      return x != null && x !== '' && String(x).indexOf('undefined') < 0
        && String(x).indexOf('NaN') < 0;
    });
    if (!bits.length) return '';
    var text = bits.join(' · ');
    return wrap ? '<span class="sub">' + text + '</span>' : text;
  }

  function markerHtml(v) {
    if (v.icon) return v.icon;
    if (v.num == null || v.num === '') return '';
    return '<span class="hsnum' + (v.home ? ' home' : '') + '">' + v.num + '</span>';
  }

  // Unseen is a plain list because it is the answer; seen is a <details>
  // because it is the context. A section may not swap which is which.
  function unseenHtml(v) {
    if (!v.unseen) return '';
    var label = v.unseenLabel == null
      ? (v.unseenN ? v.unseenN + ' unseen 🔍' : 'Unseen 🔍')
      : v.unseenLabel;
    return '<div class="hsunseen">'
      + (label ? '<div class="hslabel">' + label + '</div>' : '')
      + v.unseen + '</div>';
  }

  function seenHtml(v) {
    if (!v.seen) return '';
    var label = v.seenLabel == null
      ? (v.seenN ? v.seenN + ' more species already seen' : 'Already seen')
      : v.seenLabel;
    return '<details class="hsseen"><summary>' + label + '</summary>'
      + v.seen + '</details>';
  }

  function build(tpl, v, cls) {
    v = v || {};
    return fill(tpl, {
      cls: [cls].concat(v.cls ? [v.cls] : []).join(' '),
      marker: markerHtml(v),
      name: v.name || '',
      sub: subHtml(v, tpl === SMALL),
      unseen: unseenHtml(v),
      seen: seenHtml(v),
      below: v.below || '',
      actions: v.actions == null ? '' : v.actions
    });
  }

  var API = {
    css: CSS,
    templates: { small: SMALL, medium: MEDIUM, large: LARGE, marker: MARKER },
    small: function (v) { return build(SMALL, v, 'hscard hscard-sm'); },
    medium: function (v) { return build(MEDIUM, v, 'hscard hscard-md'); },
    large: function (v) { return build(LARGE, v, 'hscard hscard-lg'); },
    marker: function (num, home) { return markerHtml({ num: num, home: home }); },
    list: function (size, items, extraCls) {
      return '<ul class="obs hscards hscards-' + size + (extraCls ? ' ' + extraCls : '') + '">'
        + (items || []).join('') + '</ul>';
    }
  };

  if (typeof document !== 'undefined' && !document.querySelector('style[data-cards="hotspot"]')) {
    var s = document.createElement('style');
    s.setAttribute('data-cards', 'hotspot');
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  global.HotspotCards = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}(typeof window !== 'undefined' ? window : this));
