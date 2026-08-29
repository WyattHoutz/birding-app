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
     {{qr}}        optional QR action, rendered in the card's actions area

   Like the species file this is LAYOUT ONLY — it receives HTML the app has
   already escaped and never touches eBird data.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- markup */

  var SMALL = [
    '<li class="{{cls}}"{{data}}>',
    '  <div class="name">{{marker}}<span class="ntext">{{name}}{{sub}}</span></div>',
    '  {{below}}',
    '</li>'
  ].join('\n');

  var MEDIUM = [
    '<li class="{{cls}}"{{data}}>',
    '  <div class="name">{{marker}}<span class="ntext">{{name}}</span>{{dist}}</div>',
    '  <div class="meta">{{sub}}{{qr}}</div>',
    '  <div class="hslists">{{unseen}}{{seen}}</div>',
    '  {{below}}',
    '  {{actions}}',
    '</li>'
  ].join('\n');

  var LARGE = [
    '<li class="{{cls}}"{{data}}>',
    '  <div class="hscardhead">{{marker}}<span class="ntext">{{name}}</span></div>',
    '  <div class="meta">{{sub}}{{qr}}</div>',
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
    '  background: var(--pin, #e5484d); color: #fff; border: 2px solid #fff;',
    '  box-shadow: 0 1px 3px rgba(0,0,0,.4);',
    '  font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1;',
    '  width: calc(46px * var(--s)); height: calc(46px * var(--s));',
    '  font-size: calc(19px * var(--s)); }',
    '.hscard-sm .hsnum { width: calc(34px * var(--s)); height: calc(34px * var(--s));',
    '                    font-size: calc(15px * var(--s)); }',
    /* SIZED TO THE LINE IT LABELS, not to the map pin it mirrors.
       MEASURED in real Chrome on a Stakeout row: the badge was 40x40 against a
       name line 19.55px tall - 2.05x the height of the thing it numbers - and
       its font was 17px, EXACTLY the name's. A label the same size as its
       subject and twice as tall is the whole of "the hotspot number is too
       big"; with align-self: start it also hung 10px above and 10px below the
       name it belongs to.
       28px is ~1.4x the line, so it still reads as a pin rather than a bullet,
       and 14px keeps the digits clearly UNDER the name in type - a marker must
       not compete with what it marks. The old 40px floor was justified by the
       badge spanning both header rows; it does not span any more (grid-row: 1
       below), so the floor went with the span. */
    '.hscard-md .hsnum { width: calc(28px * var(--s)); height: calc(28px * var(--s));',
    '                    font-size: calc(14px * var(--s)); }',
    '.hscard-lg .hsnum { width: calc(56px * var(--s)); height: calc(56px * var(--s));',
    '                    font-size: calc(23px * var(--s)); }',
    /* Home keeps the green it has on the map. */
    '.hsnum.home { background: #0f7a52; }',

    /* ---- SMALL ---- */
    '.hscard-sm { padding: 12px 0; }',
    '.hscard-sm > .name { display: flex; align-items: center; gap: 10px;',
    '                     font-size: calc(15px * var(--s));',
    '                     min-height: calc(34px * var(--s)); line-height: 1.25; }',
    '.hscard-sm > .name > .ntext { min-width: 0; overflow-wrap: anywhere; }',
    /* The sub-line is a LINE, not a continuation of the name. Without this it
       renders inline and immediately after it, which read as
       "Saltese Wetlands3.5× the regional average" - the name and its first
       fact welded into one word. The species small card has the same rule for
       the same reason; this family simply never needed it until a section put
       a sub on a small hotspot row.
       Scoped under .hscard-sm because a small card can be nested inside a
       medium one, where .sub means something else. */
    '.hscard-sm > .name > .ntext > .sub {',
    '  display: block; font-size: calc(13px * var(--s)); font-weight: 500;',
    '  color: var(--muted); margin-top: 1px; line-height: 1.3; }',

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
       splits a token like "Marsh--Willow" when that token alone cannot fit.

       18px, down from 21. Reported twice: the first pass took it 26 -> 21 and
       the owner still read it as too big on the device. The reason it looked
       oversized is comparative — the medium SPECIES card sets its subject at
       17px, so a hotspot name shouted louder than a bird name on a card of the
       same rank, and hotspot names are the long ones ("Edmonds Public Fishing
       Pier & Olympic Beach") that wrap to two or three lines at that size. The
       sub-header steps down with it, 16 -> 15, so the name still outranks it by
       the same 1.2 ratio the species card uses; dropping the name alone would
       have left the two nearly equal and cost the card its subject.

       F183, and the THIRD report of "font is too large" (26 -> 21 -> 19 -> and
       still too big). TWO things were wrong, which is why shrinking the name
       alone kept failing. The name is now 17px — the same size the medium
       SPECIES card gives its subject, which is the only non-arbitrary target
       available and is the comparison the paragraph above had already
       identified without acting on. And the distance beside it was set at
       24px/800 against a 19px name, so the NUMBER outranked the SUBJECT: a list
       of places was being read as a list of mileages. See the distance rule
       below. */
    '  font-size: calc(17px * var(--s)); font-weight: 700; line-height: 1.15;',
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
    /* Steps down WITH the name, 15 -> 14, keeping the >= 1.15 ranking the
       guard enforces: 17/14 = 1.21. Moving the name alone took the ratio to
       1.13 and the suite caught it, which is the whole point of pinning a
       ratio rather than two sizes. */
    '  font-size: calc(14px * var(--s)); line-height: 1.35;',
    '  font-weight: 500; color: var(--muted); }',
    /* THE SUB-LINE'S LINKS ARE TAP TARGETS, and they were 17.5px tall with no
       padding at all. MEASURED in real Chrome: the checklist id finished
       5.3px above the next card's own tap area, which is the reported "hard
       to click on details like checklist id since its too close to next
       item" - two neighbouring links from two different rows competing for
       one thumb.
       Padding rather than font-size, the same way `.hsdist` and `.favbtn`
       already do it: this line is deliberately the small print, and growing
       the type to win a tap target would undo the ranking the guard above
       pins. The negative inline margin keeps the visual gap between the
       date, the count and the id unchanged while the boxes themselves grow. */
    '.hscard-md > .meta a { display: inline-block; padding: 7px 3px;',
    '                       margin: -1px -1px; }',
    /* The distance column. Big enough to scan down the edge of a list, and
       the unit is a caption on it rather than a second number — "8.0 mi" read
       at one size makes the reader parse two tokens to get one value.

       F183: 17px, down from 24. At 24px/800 beside a 19px name the distance
       was the largest thing on a hotspot card, so the number outranked the
       place it described. It stays scannable by ALIGNMENT and WEIGHT — tabular
       figures, weight 800, its own right-hand column — rather than by size,
       which is what it should have been doing all along. It must never again
       be set larger than `.ntext` above it; there is a guard. */
    '.hscard-md > .name > .hsdist {',
    '  grid-column: 3; grid-row: 1; align-self: start; justify-self: end;',
    '  text-align: right; white-space: nowrap;',
    /* A COLUMN, not just a right-aligned cell. Every card is an INDEPENDENT
       grid, so nothing made column 3 the same width from one row to the next —
       and "right-aligned inside its own card" is not "an aligned column",
       which is the only reason to give distance a column at all. Reserving a
       common minimum in `ch` (with tabular figures above, so 1ch is exactly one
       digit) makes the numbers line up down the list at every text scale.
       ⚠️ PARTIAL: this fixes cards within one list. The reported screenshot also
       shows the near row and the "43 more places" rows disagreeing, and those
       sit in DIFFERENT lists — the expander nests its own. That half is not yet
       measured, so it is not yet claimed as fixed. */
    '  min-width: 4ch;',
    '  font-size: calc(17px * var(--s)); font-weight: 800; line-height: 1.1;',
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
    /* The QR variant rides the facts line instead of claiming one. `flex` on
       the base class is what put it on its own row even as a <span>, so the
       inline form resets both the display and the top margin — changing the
       element without changing the CSS would have fixed nothing, which is the
       half the first attempt at this missed. */
    '.hsact.hsactinline { display: inline-flex; margin-top: 0; margin-left: 8px;',
    '                     vertical-align: middle; gap: 0; }',
    /* Two actions on one line must LOOK like two of the same thing. Reported
       from the device on the patch cards: "the Open in Maps link is raised up,
       with a larger font thats not the same weight" than Open in eBird.
       Neither link was styled for this row — `.hsact` sets 15px, while the
       global `.maplink, .extlink` rule sets 13px AND `margin-top: 8px`, so an
       `.extlink` inside `.hsact` came out smaller and pushed DOWN while its
       neighbour sat at the row's own size. The maps link was never raised; the
       eBird link was lowered.
       Inherit instead of restating a number, so the row's size stays the one
       fact and the two cannot drift again. Same fix `.cklrows` already needed. */
    '.hsact .maplink, .hsact .extlink, .hsact .favlink, .hsact .mylink {',
    '  margin-top: 0; font-size: inherit; font-weight: 700;',
    '  vertical-align: baseline; }',
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
    // `tone` recolours the badge to match its map pin. It is delivered as a
    // CSS variable rather than a class so the palette has ONE definition, in
    // the app, instead of a colour list here and an identical one beside
    // .pinbubble. Validated because it lands in a style attribute, and this
    // module's contract is that it never has to trust a caller's escaping.
    var tone = /^#[0-9a-fA-F]{6}$/.test(String(v.tone || '')) ? v.tone : '';
    return '<span class="hsnum' + (v.home ? ' home' : '') + '"'
      + (tone ? ' style="--pin:' + tone + '"' : '') + '>' + v.num + '</span>';
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

  /* Data hooks on the card's own <li>. The checklist card already accepts
     these; the hotspot card did not, which is why the Stakeout bird list could
     ask for evidence icons and never receive any — `hydrateChecklistEvidence`
     selects `[data-ev-sub]`, and no hotspot card could carry one.

     Keys are restricted to the shape a data attribute may legally have, and
     values are escaped, because unlike the rest of this file these DO carry
     eBird strings (a place name travels in `ev-place`). */
  function dataHtml(v) {
    var d = v.data;
    if (!d) return '';
    var out = '';
    for (var k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      if (!/^[a-z][a-z0-9-]*$/.test(k)) continue;
      var val = d[k];
      if (val == null || val === '') continue;
      out += ' data-' + k + '="' + String(val)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"';
    }
    return out;
  }

  function build(tpl, v, cls) {
    v = v || {};
    // Only the medium card has a distance COLUMN. On small and large the
    // distance stays where it always was, in the sub-header — printing it in
    // both places on the one card that has a column is the drift this guards.
    var isMedium = (tpl === MEDIUM);
    return fill(tpl, {
      cls: [cls].concat(v.cls ? [v.cls] : []).join(' '),
      data: dataHtml(v),
      marker: markerHtml(v),
      name: v.name || '',
      sub: subHtml(v, tpl === SMALL, isMedium),
      dist: isMedium ? distHtml(v) : '',
      unseen: unseenHtml(v),
      seen: seenHtml(v),
      below: v.below || '',
      // Existing callers own their map + save row and must keep it intact.
      // QR gets its own optional slot rather than being inserted into that
      // caller HTML: parsing and splicing a markup string is a fragile,
      // second action builder. The Stakeout-hotspot caller deliberately puts
      // its QR directly beside its map action; QR-only cards use this row.
      actions: v.actions == null ? '' : v.actions,
      // ⚠️ A SPAN, NOT A DIV, AND THAT IS THE WHOLE BUG. Reported twice —
      // "QR icon wrapping issue is not fixed on stakeout bird ... i already
      // repoeted this bug". The first fix moved the actions inline in
      // cards-species.js and I never checked whether the HOTSPOT card had the
      // same shape. It did: a block-level child takes a line of its own
      // whatever the CSS says, so the QR sat under every place row as a big
      // square instead of beside the facts it belongs to.
      //
      // It now rides the `.meta` line with the date, count and checklist id —
      // which is where the report asked for it: "on same line as the checklist
      // id or next to magnifying glass".
      qr: v.qr ? '<span class="hsact hsactinline">' + v.qr + '</span>' : ''
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
