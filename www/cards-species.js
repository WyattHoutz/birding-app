/* =========================================================================
   SPECIES CARD TEMPLATES  —  small · medium · large
   =========================================================================

   One of the two card families in this app. The other is cards-hotspot.js.
   Everything about how a BIRD row looks lives in this file: the markup below
   and the CSS at the bottom. Tweak either and every section that shows birds
   follows, because no section is allowed to hand-roll its own bird row.

   THE THREE SIZES, and when each is right:

     small   ONE row — small icon, name beside it, optional caption line.
             For SCANNING a long list when you already know what you want.

     medium  TWO columns — icon left spanning both rows; right column is the
             name over a sub-header. For DECIDING: "which bird is this, and
             is it worth the drive?"

     large   THREE stacked rows — full-bleed photo, then name, then the
             sub-header. For READING about ONE bird rather than scanning.

   PLACEHOLDERS every size accepts (all optional except name):

     {{icon}}      photo / icon HTML, already built by the app
     {{name}}      the species name, already linked and escaped
     {{tags}}      trailing flags: 🔍 unseen, ⭐ rarity, ⚠️ unconfirmed
     {{distance}}  "3.5 mi" — how far the nearest report is
     {{score}}     a count or rank the section wants beside the name
     {{sub}}       the sub-header / caption line
     {{below}}     anything else the row carries, full width, under the card

   These are STRING placeholders holding HTML the app has already escaped.
   This file is about LAYOUT only — it never touches eBird data and never
   escapes anything, which is why it can be a separate file with no access
   to the app's internals.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- markup */

  var SMALL = [
    '<li class="{{cls}}">',
    '  <div class="name">{{icon}}<span class="ntext">{{name}}{{tags}}{{sub}}</span>{{right}}</div>',
    '  {{below}}',
    '</li>'
  ].join('');

  var MEDIUM = [
    '<li class="{{cls}}">',
    '  <div class="name">{{icon}}<span class="ntext">{{name}}{{tags}}</span>{{dist}}</div>',
    '  <div class="meta">{{sub}}</div>',
    '  {{below}}',
    '</li>'
  ].join('');

  var LARGE = [
    '<li class="{{cls}}">',
    '  {{icon}}',
    '  <div class="bcbody">',
    '    <div class="bcname">{{name}}{{tags}}</div>',
    '    <div class="bcsub">{{sub}}</div>',
    '    {{below}}',
    '  </div>',
    '</li>'
  ].join('');

  /* ------------------------------------------------------------------- css */
  /* Co-located with the markup on purpose: a card is its markup AND its
     styling, and splitting them across two files is what let six sections
     drift into six lookalike layouts. */

  var CSS = [
    /* ---- A CARD TITLE THAT IS A LINK KEEPS THE TITLE'S TYPE ----
       Nearly every species name is rendered as an `<a class="extlink">` so it
       can open the eBird species page. index.html styles that class for what
       it was built for — an ACTION link ("Open in Maps", "eBird") — at 13px
       with an 8px top margin. That reached the TITLE text too, so a card name
       rendered at 13px no matter what size the card asked for: raising this
       family's medium name 20px -> 29px changed nothing on screen, the 8px
       margin read as a blank line above the name, and the 16px sub-header
       out-sized the name it belongs to. A link that IS the title inherits the
       title's type; only its colour stays its own. Scoped to the name slots so
       genuine action links inside a card are untouched. ---- */
    '.obs .ntext a, .cards .bcname a, .card-lg .bcname a, .obs .name > a {',
    '  display: inline; margin-top: 0;',
    '  font-size: inherit; font-weight: inherit; line-height: inherit;',
    '  letter-spacing: inherit; }',

    /* ---- BIG icon modifier: for the sections read as "which bird is this"
       rather than "how many", where the thumbnail is the fastest way to
       recognise a bird. Stacks with a size below. ---- */
    '.obs.big .name { display: flex; align-items: center; gap: 12px; font-size: calc(20px * var(--s)); font-weight: 800; line-height: 1.25; }',
    '.obs.big .thumb { float: none; flex: 0 0 auto; width: calc(64px * var(--s)); height: calc(64px * var(--s)); margin: 0; }',
    '.obs.big .meta { margin-top: 6px; }',
    '.obs.big .count { font-size: calc(13px * var(--s)); font-weight: 700; color: var(--ink); }',

    /* ---- SMALL: one row, icon and name on a single line ---- */
    /* The small card is the row shape used INSIDE other cards — a hotspot's
       unseen/seen birds, a checklist's species split — so it is almost always
       a list nested under a heading that already names the subject. At the
       base .obs 17px it competed with the card title above it and made a
       20-row species list feel like 20 headings. 15px keeps it comfortably
       ahead of its own 13px sub-line while reading as a LIST. */
    '.obs.card-sm .name { display: flex; align-items: center; gap: 10px;',
    '                     font-size: calc(15px * var(--s));',
    '                     min-height: calc(46px * var(--s)); line-height: 1.25; }',
    '.obs.card-sm .thumb { float: none; flex: 0 0 auto; margin: 0;',
    '                      width: calc(46px * var(--s)); height: calc(46px * var(--s)); }',
    '.obs.card-sm .ntext { min-width: 0; overflow-wrap: anywhere; }',
    /* The row's right-hand control. `margin-left: auto` is what pins it to the
       edge; without it a short species name leaves it floating mid-row. It is
       a real tap target rather than a decoration, so it gets a 44px box. */
    '.obs.card-sm > li > .name > .spgo {',
    '  margin-left: auto; flex: 0 0 auto; display: inline-flex;',
    '  align-items: center; justify-content: center;',
    '  min-width: calc(34px * var(--s)); min-height: calc(34px * var(--s));',
    '  font-size: calc(22px * var(--s)); line-height: 1; font-weight: 700;',
    '  color: var(--accent); text-decoration: none; }',
    /* The small card's optional SECOND line: what the row is (the name) stays
       on top, and what backs it up (count, time, checklist) drops below at
       caption weight. The icon box is 46px, which two lines of this size fit
       inside, so the template's one-row height is preserved. */
    '.obs.card-sm .ntext .sub { display: block; font-size: calc(13px * var(--s));',
    '                      font-weight: 500; color: var(--muted); margin-top: 1px; line-height: 1.3; }',

    /* ---- MEDIUM — a real two-column table, not a float ----
         col 1  the photo, spanning BOTH rows
         col 2  row 1 = the header (what bird this is)
                row 2 = the sub-header (what you need to decide)
       Everything the row carries after those two cells is ADDITIONAL
       INFORMATION and starts a new full-width row underneath.
       The float this replaces made the sub-header slide up beside the photo
       on a short name and drop below it on a long one, so no two rows in a
       list ever lined up — the "wrapping odd" that kept being reported.

       Every selector here is CHILD-scoped: a medium card can CONTAIN a small
       card list (a hotspot's unseen birds), and a descendant selector would
       hand those nested rows the outer row's grid and turn their .name into
       display:contents. */
    '.obs.xl > li, .obs.card-md > li {',
    '  display: grid;',
    /* Three columns, matching the hotspot medium card: photo · name · how far.
       The distance was previously buried mid-sentence in the sub-header
       ("66 places · nearest 4.2 mi · 67 reports"), where the one number that
       decides whether you can go read the same weight as the two that don't.
       `auto` on the third track means a card whose caller passes no distMi
       collapses it to zero width rather than reserving a gutter. */
    '  grid-template-columns: auto minmax(0, 1fr) auto;',
    '  grid-template-rows: auto auto;',
    /* Everything aligns to the TOP of its row. Centring made a card's height
       depend on which cell happened to be tallest and then floated the others
       in the leftover space, so a long species name and a short one produced
       visibly different photo and distance positions down a list. Top-aligned,
       every row starts on the same line however much any one cell wraps. */
    '  align-items: start;',
    '  overflow: hidden;',
    '}',
    /* display:contents lifts the photo and the title OUT of .name so each can
       be a cell of the row grid, while .name still supplies their typography —
       inherited properties pass through a contents box even though its own
       box is gone. */
    '.obs.xl > li > .name, .obs.card-md > li > .name { display: contents; }',
    /* The gutter is the photo's margin rather than the grid's column-gap so a
       row whose photo failed to resolve (.thumb.nopic is display:none) closes
       up completely instead of keeping an empty 14px indent. */
    '.obs.xl > li > .name > .thumb, .obs.card-md > li > .name > .thumb {',
    '  float: none; margin: 0 14px 0 0; grid-column: 1; grid-row: 1; align-self: start; }',
    '.obs.xl > li > .name > .ntext, .obs.card-md > li > .name > .ntext {',
    /* CENTRED against the photo, which shares row 1 with it. A one-line name
       pinned to the top sat high against a 70px picture and read as though it
       had come loose from it. */
    '  grid-column: 2; grid-row: 1; align-self: center; }',
    /* THE FULL WIDTH of row 2 — starting under the photo and running out
       under the distance, like the one-line checklist row does.
       It used to sit in column 2 only, boxed between the photo and the
       mileage, which left it about half the card's width: "Edmonds Public
       Fishing Pier Aug 3 10:25a Neil Pankey" wrapped to three ragged lines
       inside a gutter while the space under the photo and the number sat
       empty. This is additional information about the row, not a third
       column of it. */
    '.obs.xl > li > .meta, .obs.card-md > li > .meta {',
    '  grid-column: 1 / -1; grid-row: 2; align-self: start; margin: 4px 0 0; }',
    /* Row 1 only, now that the sub-header runs the full width beneath it —
       spanning both rows would put the number on top of that text. */
    '.obs.xl > li > .name > .spdist, .obs.card-md > li > .name > .spdist {',
    '  grid-column: 3; grid-row: 1; align-self: start; justify-self: end;',
    '  text-align: right; white-space: nowrap; padding-left: 12px;',
    '  font-size: calc(24px * var(--s)); font-weight: 800; line-height: 1.1;',
    '  color: var(--ink); font-variant-numeric: tabular-nums; }',
    /* When the distance is a MAP LINK it keeps the column's typography — the
       number is what you scan down the edge of the list, and shrinking it to
       the app's 13px link size would hide it — but takes the accent colour so
       it reads as tappable. `.maplink`'s `margin-top: 8px` is the one thing
       that must be undone: it is meant for an action link on its own line and
       would drop the number below the name it is aligned with. */
    '.obs.xl > li > .name > a.spdist, .obs.card-md > li > .name > a.spdist {',
    '  margin-top: 0; color: var(--accent); text-decoration: none; }',
    '.obs.xl > li > .name > .spdist small, .obs.card-md > li > .name > .spdist small {',
    '  display: block; font-size: calc(12px * var(--s)); font-weight: 600;',
    '  color: var(--muted); letter-spacing: .02em; }',
    '.obs.xl > li > *, .obs.card-md > li > * { grid-column: 1 / -1; min-width: 0; }',
    '.obs.xl > li > .count.big, .obs.card-md > li > .count.big { float: none; display: block;',
    '                     max-width: none; text-align: left; margin: 6px 0 0; }',
    '.obs.xl > li > .count.big small, .obs.card-md > li > .count.big small { display: inline; margin-left: 7px; }',

    /* MEDIUM typography. The name is the row's subject, so it must not be the
       thing that shrinks — but it must not swallow the card either. 29px was
       the overcorrection for the cascade bug that had been pinning every card
       title to the 13px action-link size (see the reset at the top of this
       file): once that was fixed the number written for a title nobody could
       see turned out to be far too big, and a two-word species name filled
       the row. 22px still clearly outranks the 17px evidence beneath it while
       leaving a long name on two lines instead of four.
       Then 22px was still too big on the device — reported directly — so both
       the name and the photo come down about a quarter: 17px name, 70px photo.
       They move TOGETHER on purpose. The photo is the row's height and the
       name is its width, so shrinking one alone just changes which of the two
       is the thing that looks wrong. 17px still outranks the 16px sub-header,
       which is the rank that has to survive: the bird is the subject and the
       sighting is the evidence. */
    '.obs.xl > li > .name { font-size: calc(17px * var(--s)); gap: 12px; }',
    '.obs.xl > li > .name > .thumb { width: calc(70px * var(--s)); height: calc(70px * var(--s)); border-radius: 12px; }',
    /* Smaller icon still, and it is a SHARPNESS fix as much as a layout one.
       The bundled seed is 60px wide (see heroSlot's note: "fine at 46px in a
       list and a smear across a card"), and `photoSlot` deliberately stops at
       that seed rather than paying for a network rendition. At 92px it was
       upscaled 1.5x, which is exactly the blur reported in All unseen — while
       Last 7-Days looked crisp in the same card for a reason that hides the
       bug: its birds are RARE, most have no bundled seed at all, so they miss
       tier 1 and fall through to a full-size network photo.
       46px is the size the seed was cut for, so the same picture resolves
       instead of stretching. Sections that show a network photo keep the
       larger box. */
    '.obs.xl.icon-sm > li > .name > .thumb {',
    '  width: calc(46px * var(--s)); height: calc(46px * var(--s)); border-radius: 10px;',
    '  margin-right: 12px; }',
    /* break-word, NOT anywhere: `anywhere` breaks inside a word the moment the
       line is tight, which is what split "Sandpiper" across two lines. A
       species name should wrap between its words or not at all. */
    '.obs.xl > li > .name > .ntext { min-width: 0; overflow-wrap: break-word; word-break: normal;',
    '                 hyphens: none; line-height: 1.15; }',
    /* The whole card scales together, not just the name.
       The name was reported too large at 22px, but dropping it alone to 17px
       would have put it level with the 17px checklists and only 1px above the
       16px sub-header — the rank that says "this is the bird and that is the
       evidence for it" would have inverted, which the tests catch. So the
       evidence comes down with it and the gaps stay real: 17 > 14 > 13. */
    '.obs.xl > li > .meta { font-size: calc(14px * var(--s)); }',
    '.obs.xl > li > .count { font-size: calc(21px * var(--s)); font-weight: 800; color: var(--ink); }',
    '.obs.xl > li > .cklrows { font-size: calc(14px * var(--s)); }',
    '.obs.xl > li > .cklrows .who { font-size: calc(13px * var(--s)); }',
    /* WHO added it is a roster of names — a supporting list, read at a glance
       to see how many and how recently, not row by row like the checklists it
       sits beside. At the checklist size it competed with the bird name it was
       evidence for. Sized by what the list IS, not by which section shows it. */
    '.obs.xl > li > .cklrows.whorows { font-size: calc(14px * var(--s)); }',
    '.cklrows.whorows li { padding: 1px 0; }',
    '.obs.xl > li > .name .needflag, .obs.xl > li > .name .stakeflag,',
    '.obs.xl > li > .name .seenflag { font-size: calc(15px * var(--s)); }',

    /* ---- LARGE (.cards / .card-lg) — a full-bleed photo, then the name, then
       the sub-header, then the evidence. A rarity section holds 0-3 birds and
       each is a bird you have probably never seen, so the question is "what IS
       this and how big a deal is it", not "which row do I scan next". ---- */
    '.cards, .card-lg { list-style: none; margin: 10px 0 0; padding: 0; }',
    '.cards > li, .card-lg > li { border: 1px solid var(--line); border-radius: 16px; margin: 0 0 16px;',
    '              overflow: hidden; background: var(--card); }',
    /* Resets, not decoration: .bchero reuses .thumb for the shared photo
       hydration pipeline, and .thumb's fixed 46px height CANCELS aspect-ratio
       (a box with both width and height set ignores it), which collapsed every
       card photo into a full-width 46px band with a tiny contained image. */
    '.bchero { width: 100%; height: auto; aspect-ratio: 3 / 2; float: none; margin: 0;',
    '  border-radius: 0; background: #eceff3; display: block; overflow: hidden; }',
    '.bchero .birdpic { width: 100%; height: 100%; object-fit: cover; object-position: 50% 35%; display: block; }',
    /* The photo fills the frame edge to edge and lets the card's own
       overflow:hidden clip the corners. A contained image on a grey mat reads
       as a thumbnail someone forgot to finish. The generic silhouette is the
       one exception: it is not a photo OF this bird, so cropping it to fill
       would be dishonest as well as ugly. */
    '.bchero .birdpic.isfallback { object-fit: contain; background: #eceff3; padding: 18px; box-sizing: border-box; }',
    /* The bundled seed is 60px wide — a list icon. Stretched across a full-bleed
       card that is a ~6x upscale, which looks like a bad photo rather than a
       missing one. Render it at its natural size instead: never upscaled,
       centred on the mat, honestly small. */
    '.bchero .birdpic.isseed { width: auto; height: auto; max-width: 100%; max-height: 100%;',
    '  margin: auto; object-fit: none; image-rendering: auto; }',
    '.bchero:has(.isseed) { display: flex; align-items: center; justify-content: center; }',
    '.bchero.nopic { display: none; }',
    '.bcbody { padding: 14px 16px 16px; }',
    '.bcname { font-size: calc(30px * var(--s)); font-weight: 800; line-height: 1.15; letter-spacing: -0.02em;',
    '          color: var(--accent); margin: 0; overflow-wrap: anywhere; }',
    '.bcname .needflag, .bcname .stakeflag, .bcname .seenflag { font-size: calc(13px * var(--s)); vertical-align: middle; }',
    '.bcsub { font-size: calc(14px * var(--s)); color: var(--muted); margin-top: 4px; }',
    ''
  ].join('\n');

  /* ------------------------------------------------------------------ impl */

  function fill(tpl, vars) {
    return tpl.replace(/\{\{(\w+)\}\}/g, function (_, k) {
      var v = vars[k];
      return (v == null || v === false) ? '' : String(v);
    // An unused placeholder must leave no trace: `class=""` and stray blank
    // rows are how a "harmless" empty slot becomes a visible gap.
    }).replace(/ class=""/g, '');
  }

  // A caption line is only rendered when there is something to say, so an
  // absent field leaves no empty row behind.
  function subHtml(v, wrap) {
    var bits = [v.sub, v.distance, v.score].filter(function (x) {
      return x != null && x !== '' && String(x).indexOf('undefined') < 0
        && String(x).indexOf('NaN') < 0;
    });
    if (!bits.length) return '';
    var text = bits.join(' · ');
    return wrap ? '<span class="sub">' + text + '</span>' : text;
  }

  // The distance COLUMN (medium only), matching the hotspot medium card: a
  // number you scan straight down the edge of a list, with the unit as a
  // caption rather than a second number to parse. Callers pass `distMi`; a
  // caller that still puts "nearest 4.2 mi" in `sub` gets no column, so the
  // two never render the same fact twice.
  function distHtml(v, tpl) {
    if (tpl !== MEDIUM) return '';
    var d = v.distMi;
    if (d == null || d === '' || !isFinite(Number(d))) return '';
    var body = Number(d).toFixed(1) + '<small>mi</small>';
    // THE DISTANCE OPENS MAPS. It is the one number on the card that answers
    // "can I go", so it should also be the thing that takes you.
    // `distQ` is a plain "lat,lng" string, NOT a URL: the card tags the
    // element with the class the app's delegated handler already looks for
    // and stops there, so map-provider choice and URL building stay in
    // index.html with the rest of the routing. Passing ready-made HTML
    // instead would duplicate the number formatting above, which is the one
    // thing this file exists to own.
    return v.distQ
      ? '<a class="spdist maplink" data-q="' + coordQ(v.distQ)
        + '" aria-label="Open in Maps">' + body + '</a>'
      : '<span class="spdist">' + body + '</span>';
  }

  /* A coordinate has a KNOWN SHAPE, so it is validated rather than escaped.
     These files take ready-made HTML from the caller by design and have no
     escaper of their own; stripping everything that is not a digit, dot,
     minus or comma is both simpler and stricter than escaping would be — a
     value that is not a coordinate cannot survive it at all. */
  function coordQ(q) {
    return String(q == null ? '' : q).replace(/[^0-9.,-]/g, '');
  }

  function build(tpl, v, cls) {
    v = v || {};
    return fill(tpl, {
      cls: [cls].concat(v.cls ? [v.cls] : []).join(' ').trim(),
      icon: v.icon || '',
      name: v.name || '',
      tags: v.tags || '',
      sub: subHtml(v, tpl === SMALL),
      dist: distHtml(v, tpl),
      // An optional control at the RIGHT EDGE of a small row. It has to be a
      // sibling of `.ntext` rather than inside it, because `.name` is the flex
      // row — anything nested in the text block sits after the words, not at
      // the edge. Used by the ABA list, where each row opens a sub-page.
      right: v.right || '',
      below: v.below || ''
    });
  }

  var API = {
    css: CSS,
    templates: { small: SMALL, medium: MEDIUM, large: LARGE },
    // The row classes are empty: the SIZE lives on the <ul> wrapper, so a
    // section cannot accidentally mix two sizes in one list.
    small: function (v) { return build(SMALL, v, ''); },
    medium: function (v) { return build(MEDIUM, v, ''); },
    large: function (v) { return build(LARGE, v, ''); },
    list: function (size, items, extraCls) {
      var wrap = { small: 'obs card-sm', medium: 'obs big xl', large: 'cards card-lg' }[size] || 'obs';
      return '<ul class="' + wrap + (extraCls ? ' ' + extraCls : '') + '">'
        + (items || []).join('') + '</ul>';
    }
  };

  // Inject once. Styles land in a <style data-cards="species"> so it is
  // obvious in devtools which file a rule came from.
  if (typeof document !== 'undefined' && !document.querySelector('style[data-cards="species"]')) {
    var s = document.createElement('style');
    s.setAttribute('data-cards', 'species');
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  global.SpeciesCards = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}(typeof window !== 'undefined' ? window : this));
