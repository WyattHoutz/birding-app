/*
 * cards-checklist.js — one shared way to render A LIST OF CHECKLISTS.
 *
 * Four sections were each hand-rolling their own checklist row: Today's
 * rarities, Last 7-Days' expander, Latest ticks, and All unseen. They printed
 * overlapping-but-different subsets of the same five facts, in different
 * orders, at different sizes — which is the drift the species and hotspot card
 * modules were created to stop. This is the third of those modules and it
 * exists for the same reason.
 *
 * THE FIVE FACTS a checklist row has to carry, and why each earns its place:
 *
 *   place   WHERE it was — the thing you actually drive to. Condensed,
 *           because eBird names run to
 *           "Marymoor Park--Audubon BirdLoop/Interpretive-Boardwalk" and the
 *           tail is almost never what distinguishes it from its neighbours.
 *   date    WHEN — decides whether the bird is still there.
 *   count   HOW MANY birds. One is a glimpse; forty is a flock you can find.
 *   map     the pin, so you can leave for it without another tap.
 *   id      the checklist itself, because every claim here should be
 *           checkable at its source.
 *
 * Presentation only, exactly like cards-species.js and cards-hotspot.js: the
 * caller passes ready-made HTML for anything that needs a link, because the
 * link builders (locLink / checklistLink / mapLink) live with the app's
 * routing and must not be duplicated here.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChecklistCards = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- markup */

  /* SMALL — ONE LINE that never wraps.
     The line is: place (abbreviated, and it IS the link to the checklist) ·
     short date/time · count · distance. Making the NAME the checklist link is
     what buys the width back: an eBird submission id like "S379329490" is
     eleven characters of pure noise, and the row already needed a link.
     Every field is optional, because the caller's context decides what is
     redundant. When a row stands on its own - as it does in All unseen, where
     the checklist IS the row - it carries all four facts: name, date, count,
     distance. A caller that already prints a place heading above the list
     leaves the name out, and the row leads with the date instead.

     THE OBSERVER IS NOT ON THIS ROW, and that is a measured decision rather
     than an oversight. The layout sweep at 320px / 1.75× text scale caught the
     observer name hanging 247px past the row: it is the one field of
     unbounded width, and a clipped name is worse than an absent one. It is
     also the least decision-relevant thing here — you drive to a place at a
     time, not to a person. The medium card, which has a whole line, keeps it.
     The count is kept but written "×42", not "42 birds": same fact, a quarter
     of the width. */
  var SMALL = [
    '<li class="cklcard cklcard-sm"{{rowlink}}>',
    '{{row}}',
    '</li>'
  ].join('');

  /* MEDIUM — the PLACE is the headline and it IS the link to the checklist.
     Laid out exactly like the medium hotspot card, because it answers the same
     shape of question: rank | what it is | the one number that ranks it, over
     a full-width facts line, over whatever the section wants to hang beneath.
     "View checklist ↗" used to be a fourth line on every row; making the
     headline the link deletes that line without losing the destination. */
  var MEDIUM = [
    '<li class="cklcard cklcard-md">',
    '<div class="ckhead">{{num}}<span class="ckplace">{{place}}</span>{{tally}}</div>',
    '<div class="ckfacts">{{row}}</div>',
    '{{below}}',
    '</li>'
  ].join('');

  /* ------------------------------------------------------------------- css */

  var CSS = [
    '.cklcards { list-style: none; margin: 6px 0 4px; padding: 0; }',
    /* Sits against the place name it qualifies, and never wraps away from
       it onto a line of its own. */
    '.cklcard-sm .ckevid { margin-left: 4px; white-space: nowrap; }',
    /* ONE LINE, and the HOTSPOT NAME is what truncates to keep it there.
       `flex-basis: 0` on the lead is the whole fix, and it is one word. With
       `auto` the lead claimed its content width first and only then shrank in
       proportion to it, so a long name kept a slice of the row it should have
       surrendered and shoved the facts onto a second line — which is exactly
       what was reported. With `0` the lead asks for nothing, takes only what
       is left after the short facts, and ellipsises.
       `flex-wrap: wrap` remains as the LAST RESORT, and only bites at the
       largest accessibility text scale on the narrowest phone: at 1.75× on a
       320px screen the facts ALONE measure wider than the screen, so there is
       no one-line answer left — and wrapping keeps every fact readable where
       clipping would silently delete the distance. The layout sweep measures
       exactly that case. At every normal size the row is one line.
       Each cell keeps `white-space: nowrap`, so a date or a count never
       splits down the middle; only whole facts can move. */
    '.cklcards-sm > .cklcard-sm {',
    '  display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px;',
    '  min-width: 0; overflow: hidden; white-space: nowrap;',
    '  padding: 3px 0; font-size: calc(14px * var(--s)); line-height: 1.35;',
    '  color: var(--muted); }',
    '.cklcards-sm > .cklcard-sm[data-href] { cursor: pointer; }',
    '.cklcards-sm > .cklcard-sm[data-href]:active { background: color-mix(in srgb, var(--accent) 10%, transparent); }',
    '.cklcards-sm > .cklcard-sm > .cklead {',
    '  flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis;',
    '  font-weight: 600; }',
    /* `flex-basis: 0` on the lead, NOT `auto`, and that one word is the whole
       fix. With `auto` the lead claims its content width first and only then
       shrinks in proportion to it, so a long hotspot name kept ~47px of the
       row it should have surrendered and pushed the distance 30px off a 320px
       screen — measured by the layout sweep, exactly there.
       With `0` the lead asks for nothing and takes only what is left after the
       short facts, so the NAME is always what gives way. The facts stay
       shrinkable as a second line of defence. */
    '.cklcards-sm > .cklcard-sm > span:not(.cklead) {',
    '  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }',
    /* The ellipsis has to be applied to the LINK, not only to its wrapper.
       `text-overflow` acts on the box that overflows, and an inline <a> inside
       a clipping span is simply painted-then-clipped: it still measures its
       full width, so the layout sweep saw a.ckgo 162px past a 320px screen
       even though the span looked right on screen. As a block with
       max-width:100% inside a min-width:0 flex item, the anchor is bounded by
       the row and truncates itself. */
    '.cklcards-sm > .cklcard-sm > .cklead > .ckgo {',
    '  display: block; max-width: 100%; min-width: 0; overflow: hidden;',
    '  text-overflow: ellipsis; white-space: nowrap; }',
    '.cklcards-sm > .cklcard-sm > span:not(.cklead) { flex: 0 0 auto; }',
    /* Separators are DRAWN, not typed, so a field the caller left out cannot
       strand a "·" behind it. */
    '.cklcards-sm > .cklcard-sm > span + span::before {',
    '  content: "\\00b7"; margin-right: 8px; color: var(--line); }',
    /* Tabular figures so dates, counts and distances line up down the list. */
    '.cklcard .ckdate { font-variant-numeric: tabular-nums; }',
    '.cklcard .ckcount { font-variant-numeric: tabular-nums; font-weight: 700;',
    '                    color: var(--ink); }',
    '.cklcard .ckdist { font-variant-numeric: tabular-nums; }',
    /* A linked distance stays the size of the row it sits in — `.maplink` is
       13px/700/accent with an 8px top margin, all of which would make one
       fact on the line taller and lower than the rest. Only the colour is
       kept, as the signal that it is tappable. */
    '.cklcard a.ckdist { margin-top: 0; font-size: inherit; font-weight: inherit;',
    '                    color: var(--accent); text-decoration: none; }',
    '.cklcard .ckmapwrap a, .cklcard .ckmap { text-decoration: none; }',
    /* THE LINK IS NOT A DEFAULT LINK. `.ckgo` carried no colour or decoration
       of its own, so fifteen rows of a rarity's checklists rendered as fifteen
       underlined browser-blue links — "i dont the format of the checklist
       rows: remove the line". The underline IS the line. Everything else the
       app links is accent-green and undecorated; the row is already tappable
       edge to edge, so the name does not need to advertise it twice. */
    '.cklcards-sm > .cklcard-sm > .cklead > .ckgo,',
    '.cklcards-sm > .cklcard-sm > .cklead > .ckgo:visited {',
    '  color: var(--accent); text-decoration: none; }',
    /* ...and a bullet in place of the rule, so a row still reads as one item
       in a list without a horizontal line per row. It is a marker, not a
       fact: it never shrinks, never wraps, and is not part of the flex
       content. */
    '.cklcards-sm > .cklcard-sm::before {',
    '  content: "\\2022"; flex: 0 0 auto; color: var(--line);',
    '  font-size: calc(11px * var(--s)); line-height: 1; }',
    '.cklcard .ckwho { min-width: 0; overflow: hidden; text-overflow: ellipsis; }',
    '.cklcard .cksp { font-variant-numeric: tabular-nums; white-space: nowrap; }',

    /* MEDIUM: laid out exactly like the medium hotspot card — rank | headline |
       the one number that ranks it, over a full-width facts line. Same shape,
       because it answers the same shape of question, and a reader who has
       learned one list has learned all of them.
       `overflow-wrap: anywhere` on the headline is load-bearing: eBird
       personal locations are raw addresses ("1730 North 122nd Street, Seattle,
       Washington, US (47.718, -122.335)") with no break opportunity a normal
       wrap would take, and a device log measured the document 33px wider than
       the screen because of exactly that. */
    '.cklcards-md > .cklcard-md { padding: 8px 0; }',
    '.cklcards-md > .cklcard-md > .ckhead {',
    '  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;',
    /* `center`, not `baseline`: the tally beside the name is 24px against the
       name's 17px, and baseline-aligning them made the name sit low. */
    '  column-gap: 10px; align-items: center; }',
    '.cklcard-md > .ckhead > .ckplace {',
    '  min-width: 0; font-size: calc(17px * var(--s)); font-weight: 700;',
    '  line-height: 1.25; overflow-wrap: anywhere; }',
    '.cklcard-md > .ckhead > .cknum {',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  width: calc(24px * var(--s)); height: calc(24px * var(--s));',
    '  border-radius: 50%; background: #d64545; color: #fff;',
    '  font-size: calc(13px * var(--s)); font-weight: 800; }',
    /* The tally is the ranking number, so it reads like one — same treatment
       as distance on the hotspot card. */
    '.cklcard-md > .ckhead > .cktally {',
    '  text-align: right; white-space: nowrap; font-size: calc(24px * var(--s));',
    '  font-weight: 800; line-height: 1.1; color: var(--ink);',
    '  font-variant-numeric: tabular-nums; }',
    '.cklcard-md > .ckhead > .cktally small {',
    '  font-size: calc(12px * var(--s)); font-weight: 600; color: var(--muted);',
    '  margin-left: 3px; }',
    '.cklcards-md > .cklcard-md > .ckfacts {',
    '  display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px;',
    '  min-width: 0; margin-top: 3px; font-size: calc(14px * var(--s));',
    '  color: var(--muted); overflow-wrap: anywhere; }',
    '.cklcards-md > .cklcard-md > .ckfacts > span + span::before {',
    '  content: "\\00b7"; margin-right: 8px; color: var(--line); }'
  ].join('\n');

  /* ------------------------------------------------------------- rendering */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* eBird location names carry a lot of tail that does not distinguish one
     row from its neighbours. `--` separates a site from its sub-area, and the
     sub-area is what goes first; a `/` alternative name goes with it. What is
     left is capped, because a name long enough to fill the row defeats the
     one-line layout however it was built. */
  /* Longer than the old 34: dropping the bird count and shortening the date
     freed the width, and "see if the name can be longer" is what that width
     was freed FOR. */
  var SMALL_NAME_MAX = 44;

  function condense(name, max) {
    var s = String(name == null ? '' : name).trim();
    max = max || 34;
    var cut = s.indexOf('--');
    if (cut > 0) s = s.slice(0, cut);
    s = s.split('/')[0].trim();
    if (s.length > max) s = s.slice(0, max - 1).replace(/[\s,.;:-]+$/, '') + '\u2026';
    return s;
  }

  /* A coordinate has a KNOWN SHAPE, so it is validated rather than escaped.
     See cards-species.js for why these files have no escaper of their own. */
  function coordQ(q) {
    return String(q == null ? '' : q).replace(/[^0-9.,-]/g, '');
  }

  /* `data` lets a SECTION hang its own hooks on the row without this file
     learning what they mean. The evidence hydration needs to know which
     checklist, which bird, and where the bird was — three facts the caller has
     and the template must never interpret. Keys are restricted to data-* names
     and values are escaped, so a section cannot inject an attribute here. */
  function attrsHtml(v) {
    var d = v && v.data;
    if (!d) return '';
    var out = '';
    Object.keys(d).forEach(function (k) {
      if (!/^[a-z][a-z0-9-]*$/.test(k)) return;
      var val = d[k];
      if (val == null || val === '') return;
      out += ' data-' + k + '="' + esc(String(val)) + '"';
    });
    return out;
  }

  function build(tpl, v, isMedium) {
    v = v || {};    var bits = [];
    if (isMedium) {
      // MEDIUM: the place is the headline and carries the link, so the facts
      // line leads with a PLAIN date. Two links to the same checklist in one
      // card is one more tap target than the row has meaning for.
      if (v.date) bits.push('<span class="ckdate">' + esc(shortWhen(v.date)) + '</span>');
    } else {
      // SMALL: the LEAD is the link. Its text is the abbreviated place when
      // there is one, and otherwise the date — so a row always has something
      // clickable without ever printing a place its heading has already given.
      //
      // "theres no need to repeat the hotspot name on the chrcklists under a
      // hotspot, instead it should say the date time, submitters name, count,
      // and show media icons." So a caller that has already named the place
      // omits `place`, and the DATE becomes the link. Fifteen rows repeating
      // the heading above them is fifteen rows of no information, and it was
      // eating the width the useful facts needed.
      var leadText = v.place ? condense(v.place, v.max || SMALL_NAME_MAX)
                             : shortWhen(v.date, true);
      if (leadText) {
        bits.push('<span class="cklead">' + (v.href
          ? '<a class="ckgo" target="_blank" rel="noopener" href="' + esc(v.href) + '">'
            + esc(leadText) + '</a>'
          : '<span class="ckgo">' + esc(leadText) + '</span>') + '</span>');
      }
      // Evidence marks sit RIGHT AFTER the place, not at the end of the row.
      // They qualify the sighting you just read the location of - "there is a
      // photo of this, at this place" - and a mark parked after the distance
      // reads as though it belongs to the mileage. Pre-escaped by the caller:
      // this is a fixed set of marks the app builds, not user text.
      if (v.icons) {
        bits.push('<span class="ckevid">' + v.icons + '</span>');
      }
      if (v.place && v.date) {
        bits.push('<span class="ckdate">' + esc(shortWhen(v.date, true)) + '</span>');
      }
      // WHO, on a small row, but only when the place is not being printed.
      // Small rows used to drop the observer unconditionally; under a hotspot
      // heading the name is one of the few facts that distinguishes one row
      // from the next.
      if (v.who && !v.place) bits.push('<span class="ckwho">' + v.who + '</span>');
      // How many SPECIES the checklist held. Not the same fact as `count`,
      // which is how many of ONE bird — keeping them separate is what lets a
      // rarity row drop "×1" while a hotspot row keeps "19 sp".
      if (v.sp != null && v.sp !== '') {
        bits.push('<span class="cksp">' + esc(v.sp) + ' sp</span>');
      }
    }
    // COUNT ON A SMALL ROW. Three requests that look opposed and are not:
    //
    //   "remove the bird count."               - it was "×1" fifteen times over
    //                                            on a rarity list, spending the
    //                                            width the PLACE NAME needed
    //   "It's missing the bird count in each item."
    //   "the checklists are missing the bird count"
    //
    // The first fix showed the count only when it was greater than one. That
    // read as MISSING, and rightly, because a blank row had come to mean two
    // different things: the observer counted one bird, or the observer wrote
    // "X" - present, not counted - which is eBird's own notation and arrives
    // here as a null. One of those is a fact about the bird and the other is a
    // fact about the checklist, and a reader could not tell them apart.
    //
    // So the blank is retired. A number is printed whenever eBird gave one,
    // including ×1, and an explicit ×X when eBird was told the bird was there
    // but not how many. Two characters is a cheap price for a row that no
    // longer has three possible meanings, and it is the same rule the rest of
    // the app follows: every number says what it counts, and nothing on screen
    // means more than one thing.
    //
    // A caller that passes no count at all (undefined) still prints nothing —
    // that is absence of data, not a measurement, and inventing "×X" for it
    // would be the same conflation in the other direction.
    var _has = Object.prototype.hasOwnProperty.call(v, 'count') && v.count !== '' && v.count !== undefined;
    var _n = (v.count == null || v.count === '') ? null
           : parseInt(String(v.count).replace(/[^0-9]/g, ''), 10);
    var _showCount = isMedium ? (v.count != null && v.count !== '') : _has;
    if (_showCount) {
      // `isFinite(null)` is TRUE in JavaScript, because Number(null) is 0 - so
      // a null count sailed through the numeric branch and printed "×null".
      // The type has to be checked, not just the finiteness.
      var _num = (typeof _n === 'number' && isFinite(_n));
      bits.push('<span class="ckcount">' + (isMedium
        ? esc(v.count) + (String(v.count) === '1' ? ' bird' : ' birds')
        : '\u00d7' + (_num ? _n : 'X')) + '</span>');
    }
    if (v.distMi != null && isFinite(v.distMi)) {
      // ONE DECIMAL, always. It used to round anything over 10 mi, so the
      // requested row "…Aug 3 5:14AM ×3 12.4mi" printed "12 mi" — and on a
      // list you scan to pick a drive, the tenth is the part that separates
      // two hotspots ten minutes apart.
      // Tappable when the caller knows where the place is: `distQ` is a plain
      // "lat,lng" and the app's delegated `.maplink` handler owns the URL.
      var dtxt = Number(v.distMi).toFixed(1) + ' mi';
      bits.push(v.distQ
        ? '<a class="ckdist maplink" data-q="' + coordQ(v.distQ)
          + '" aria-label="Open in Maps">' + dtxt + '</a>'
        : '<span class="ckdist">' + dtxt + '</span>');
    }
    /* A one-glyph warning (an unreviewed report). It rides the row rather than
       a line of its own because it qualifies the whole claim, and it is last
       so it cannot push the name or the date around. Raw HTML, like `map` and
       `who`: the caller owns the glyph and any title on it. */
    if (v.flag) bits.push('<span class="ckflag">' + v.flag + '</span>');
    if (v.map) bits.push('<span class="ckmapwrap">' + v.map + '</span>');
    // Small rows drop the observer entirely — see the note on SMALL.
    if (v.who && isMedium) bits.push('<span class="ckwho">' + v.who + '</span>');

    // The headline IS the link to the checklist. `placeHtml` lets a caller
    // pass ready-made HTML (a hotspot link plus its 🗺) instead of plain text.
    var head = v.placeHtml || esc(condense(v.place || '', v.max || 60));
    if (v.href && !v.placeHtml) {
      head = '<a class="ckgo" target="_blank" rel="noopener" href="'
        + esc(v.href) + '">' + head + '</a>';
    }
    return tpl
      .replace('{{row}}', bits.join(''))
      // THE WHOLE ROW IS THE LINK. On a phone the name is a ~10px-tall target
      // in a 30px-tall row, and the rest of the row was dead space that looked
      // tappable. `data-href` rather than wrapping the row in an <a>, because
      // the row also contains a map pin, and an <a> inside an <a> is invalid
      // HTML that browsers silently un-nest — which would break the pin. The
      // name stays a REAL link, so keyboard and screen-reader users still get
      // one; the row click is an enhancement over it, not a replacement.
      .replace('{{rowlink}}', ((v.href && !isMedium)
        ? ' data-href="' + esc(v.href) + '"' : '') + attrsHtml(v))
      .replace('{{num}}', v.num != null && v.num !== ''
        ? '<span class="cknum">' + esc(v.num) + '</span>' : '')
      .replace('{{tally}}', (v.species != null && v.species !== '')
        ? '<span class="cktally">' + esc(v.species) + '<small>sp.</small></span>' : '')
      .replace('{{below}}', v.below || '')
      .replace('{{place}}', head);
  }

  /* "Aug 2 9:29 AM" is longer than a one-line row can afford next to a place
     name. "Aug 2 9:29a" says the same thing and saves three characters, which
     on a 320px screen is the difference between fitting and truncating.

     SMALL rows go further — "abbreviate the date time more" — to a numeric
     "8/2 9:29a". Another three characters, and on a rarity with fifteen
     checklists filed the same afternoon the month name was fifteen repetitions
     of a word nobody was reading. The month is KEPT rather than dropped
     entirely, because these lists routinely span days and a bare time would
     make yesterday look like this morning. */
  function shortWhen(s, numericMonth) {
    var out = String(s == null ? '' : s)
      .replace(/\s*([AP])M\b/i, function (_m, ap) { return ap.toLowerCase(); })
      .replace(/:00([ap])\b/i, '$1')
      .trim();
    if (!numericMonth) return out;
    var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7,
                aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    return out.replace(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2})\b/, function (m, mon, day) {
      var n = MON[mon.toLowerCase()];
      return n ? n + '/' + day : m;
    });
  }

  var API = {
    css: CSS,
    templates: { small: SMALL, medium: MEDIUM },
    condense: condense,
    small: function (v) { return build(SMALL, v, false); },
    medium: function (v) { return build(MEDIUM, v, true); },
    list: function (size, items, extraCls) {
      var s = size === 'medium' ? 'md' : 'sm';
      return '<ul class="cklcards cklcards-' + s
        + (extraCls ? ' ' + extraCls : '') + '">'
        + (items || []).join('') + '</ul>';
    }
  };

  // Inject once. Styles land in a <style data-cards="checklist"> so it is
  // obvious in devtools which file a rule came from.
  if (typeof document !== 'undefined' && !document.querySelector('style[data-cards="checklist"]')) {
    var st = document.createElement('style');
    st.setAttribute('data-cards', 'checklist');
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  return API;
}));
