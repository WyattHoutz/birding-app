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

       ( 3 )  Marina Beach Park             8.0   <- number · name · DISTANCE
              Jul 30 · 42 species            mi   <- sub-header
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

   Why distance gets a COLUMN on the medium card: it was the first item in a
   `·`-joined sub-header, which reads as one fact among four. It is not — it
   is the one fact you compare ACROSS rows while scanning, and a column makes
   those numbers line up so the list can be read down its right edge.

   PLACEHOLDERS every size accepts (all optional except name):

     {{num}}       the marker number, styled to match the map pin
     {{icon}}      an explicit icon, if a section has something better
     {{name}}      hotspot name, already linked and escaped
     {{distance}}  miles — a NUMBER. Medium renders it in its own column;
                   small and large fold it into the sub-header.
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
    '  <div class="name">{{marker}}<span class="ntext">{{name}}</span>{{dist}}</div>',
    '  <div class="meta">{{sub}}</div>',
    '  <div class="hslists">{{unseen}}{{seen}}</div>',
    '  {{below}}',
    '  {{actions}}',
    '</li>'
  ].join('\n');

  var LARGE = [
    '<li class="{{cls}}">',
    '  <div class="hscardhead">{{marker}}<span class="ntext">{{name}}</span></div>',
    '  <div class="meta">{{sub}}</div>',
    '  <div class="hslists">{{unseen}}{{seen}}</div>',
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
    /* 40, not 46: the badge spans both header rows, and a spanning grid item
       taller than the rows it spans stretches them. See the note on .ntext —
       the text block has to win that comparison or the dead space under the
       number comes straight back. */
    '.hscard-md .hsnum { width: calc(40px * var(--s)); height: calc(40px * var(--s));',
    '                    font-size: calc(17px * var(--s)); }',
    '.hscard-lg .hsnum { width: calc(56px * var(--s)); height: calc(56px * var(--s));',
    '                    font-size: calc(23px * var(--s)); }',
    /* Home keeps the green it has on the map. */
    '.hsnum.home { background: #0f7a52; }',

    /* ---- SMALL ---- */
    '.hscard-sm { padding: 12px 0; }',
    '.hscard-sm > .name { display: flex; align-items: center; gap: 10px;',
    '                     min-height: calc(34px * var(--s)); line-height: 1.25; }',

    /* ---- MEDIUM: a three-column header over a full-width sub-header ----

         col 1        col 2                         col 3
       +--------+---------------------------+-----------+
       |  (3)   | Marina Beach Park         |    8.0    |  row 1
       |        |                           |    mi     |
       +--------+---------------------------+-----------+
       | Jul 30 · 42 species · last birded 12d ago      |  row 2, spans 1/-1
       +------------------------------------------------+

       Row 1 is three real cells; row 2 is one strip across all three. The
       sub-header used to sit in column 2 only, boxed between the badge and
       the distance and given roughly 60% of the card — and it is the line
       carrying the actual facts, so it was the first thing to wrap. Nothing
       spans ROWS any more, which also removes the old coupling where the
       badge and the distance stretched row heights to fit themselves.

       Distance used to be the first item in the `·`-joined sub-header, where
       it read as one fact among four — but it is the fact that decides
       whether the rest of the card is worth reading, and it is the only one
       you compare ACROSS rows while scanning a list. Giving it its own column
       makes those numbers line up vertically so the list can be scanned down
       the right edge, and frees the sub-header to carry what the place is
       actually reporting. Callers pass `distance`; it is rendered in the
       column and is NOT repeated in the sub-header.

       The number sits in the icon slot at 40px rather than the species card's
       92px photo size. A photo needs the width to be legible; a one- or
       two-digit number does not, and the difference goes to the name, which
       is the part that wraps. */
    '.hscard-md {',
    '  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;',
    '  column-gap: 14px; row-gap: 2px; align-items: start; padding: 10px 0;',
    '  overflow: hidden; }',
    '.hscard-md > .name { display: contents; }',
    '.hscard-md > .name > .hsnum { grid-column: 1; grid-row: 1; align-self: start; }',
    '.hscard-md > .name > .ntext {',
    /* CENTRED in its row: the rank badge and the distance beside it are short
       and vertically centred, so a top-aligned name sat above both. */
    '  grid-column: 2; grid-row: 1; align-self: center; min-width: 0;',
    /* The hotspot name is the SUBJECT of a hotspot card, so it outranks its
       own sub-header — which it did NOT: the name was reaching the screen at
       13px against a 15px sub-header (see the title-link rule at the top of
       this file). The first fix after that overshot at 26px, which made a
       LIST of hotspots read as a stack of headlines. 21px keeps the ranking
       over the 16px sub-header while letting a real name like
       "Marymoor Park--Audubon BirdLoop/Interpretive-Boardwalk" wrap in two or
       three lines rather than five on a 430px phone.
       The size is also load-bearing for spacing. It used to be MORE so: the
       number and the distance both spanned rows 1-2, and a grid distributes a
       spanning item's minimum height across the rows it spans, so whenever
       name + row-gap + meta came to LESS than the badge the rows stretched to
       fill it — the reported blank line above the name and the dead space
       under the number. Nothing spans rows now (the sub-header spans COLUMNS
       instead), so that coupling is gone and the name is free to set row 1's
       height on its own.
       break-word (not `anywhere`) keeps it wrapping between words, and only
       splits a token like "Marsh--Willow" when that token alone cannot fit. */
    '  font-size: calc(21px * var(--s)); font-weight: 700; line-height: 1.15;',
    '  overflow-wrap: break-word; word-break: normal; hyphens: none; }',
    /* The sub-header spans ALL THREE columns on its own row, rather than
       sitting under the name in column 2. Row 1 is now three real cells —
       number, name, distance — and row 2 is one full-width strip, so the
       sub-header gets the whole card width instead of the ~60% left between
       the badge and the distance. That matters because it is the line that
       carries the facts (species counts, last visit, what is there now) and
       it was the first thing to wrap. */
    '.hscard-md > .meta {',
    '  grid-column: 1 / -1; grid-row: 2; align-self: start; min-width: 0;',
    '  font-size: calc(16px * var(--s)); line-height: 1.35;',
    '  font-weight: 500; color: var(--muted); }',
    /* The distance column. Big enough to scan down the edge of a list, and
       the unit is a caption on it rather than a second number — "8.0 mi" read
       at one size makes the reader parse two tokens to get one value. */
    '.hscard-md > .name > .hsdist {',
    '  grid-column: 3; grid-row: 1; align-self: start; justify-self: end;',
    '  text-align: right; white-space: nowrap;',
    '  font-size: calc(24px * var(--s)); font-weight: 800; line-height: 1.1;',
    '  color: var(--ink); font-variant-numeric: tabular-nums; }',
    /* The linked distance keeps the column's typography and takes the accent
       colour to read as tappable; `.maplink`'s 8px top margin is undone
       because it is meant for an action link on its own line. */
    '.hscard-md > .name > a.hsdist { margin-top: 0; color: var(--accent);',
    '                               text-decoration: none; }',
    '.hscard-md > .name > .hsdist small {',
    '  display: block; font-size: calc(12px * var(--s)); font-weight: 600;',
    '  color: var(--muted); letter-spacing: .02em; }',
    /* Species lists, the expander and the actions row all span every column. */
    '.hscard-md > * { grid-column: 1 / -1; }',
    /* .meta is NOT reset here — it is meant to span, and this rule would
       otherwise win on source order and collapse it back into one column. */
    '.hscard-md > .name { grid-column: auto; }',

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

    /* ---- the actions row ----
       `min-width: 0` is load-bearing where a card sits inside a flex row that
       also holds fixed controls (Favorite hotspots): without it this row's
       min-content width becomes the floor the whole card cannot shrink under,
       and the controls beside it get pushed onto their own line. */
    '.hsact { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 4px 18px;',
    '         min-width: 0; overflow-wrap: anywhere;',
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

  function subHtml(v, wrap, dropDistance) {
    var bits = [dropDistance ? '' : v.distance, v.score, v.sub].filter(function (x) {
      return x != null && x !== '' && String(x).indexOf('undefined') < 0
        && String(x).indexOf('NaN') < 0;
    });
    if (!bits.length) return '';
    var text = bits.join(' · ');
    return wrap ? '<span class="sub">' + text + '</span>' : text;
  }

  /* The medium card's third column. Accepts a number or anything a number can
     be read out of ("2.4 mi"), so a caller that already formatted a string is
     not punished for it. One decimal under ten miles and none above: the
     column exists to be compared down a list, and "23.4" against "8.0" costs
     a character of width to state a precision nobody drives by. */
  function distHtml(v) {
    if (v.distance == null || v.distance === '') return '';
    var n = (typeof v.distance === 'number') ? v.distance : parseFloat(String(v.distance));
    if (!isFinite(n)) return '';
    // The caption is a parameter because this column does NOT always measure
    // the same thing. Everywhere that ranks places it is the distance from
    // home; in the trip planner it is the LEG from the previous stop — stop 4
    // is 2 mi from stop 3 and 30 from the house, and the leg is the number
    // that decides the route. One column silently meaning two things is the
    // same class of bug as a sub-header that repeated the distance it already
    // had a column for.
    var unit = v.distanceLabel || 'mi';
    var body = (n < 10 ? n.toFixed(1) : String(Math.round(n))) + '<small>' + unit + '</small>';
    // Tappable, for the same reason as the species card: the distance is the
    // fact that answers "can I go", so it is also the thing that takes you.
    // `distQ` is a plain "lat,lng", not a URL — see cards-species.js.
    return v.distQ
      ? '<a class="hsdist maplink" data-q="' + coordQ(v.distQ)
        + '" aria-label="Open in Maps">' + body + '</a>'
      : '<span class="hsdist">' + body + '</span>';
  }

  /* A coordinate has a KNOWN SHAPE, so it is validated rather than escaped —
     these files have no escaper of their own by design. See cards-species.js. */
  function coordQ(q) {
    return String(q == null ? '' : q).replace(/[^0-9.,-]/g, '');
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
    // Only the medium card has a distance COLUMN. On small and large the
    // distance stays where it always was, in the sub-header — printing it in
    // both places on the one card that has a column is the drift this guards.
    var isMedium = (tpl === MEDIUM);
    return fill(tpl, {
      cls: [cls].concat(v.cls ? [v.cls] : []).join(' '),
      marker: markerHtml(v),
      name: v.name || '',
      sub: subHtml(v, tpl === SMALL, isMedium),
      dist: isMedium ? distHtml(v) : '',
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
    /* The unseen/seen pair WITHOUT the rest of a card, for sections whose row
       is not a hotspot but which still have to answer "what is on this list
       that I still need?" — a birdiest checklist, for one. Exported rather
       than re-implemented so the rule that unseen is open and seen is
       collapsed has exactly one definition. */
    splitLists: function (v) { return unseenHtml(v || {}) + seenHtml(v || {}); },
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
