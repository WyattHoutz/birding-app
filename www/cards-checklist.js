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
    '<li class="cklcard cklcard-sm">',
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
    /* ONE LINE at every normal text size, and it TRUNCATES the name rather
       than wrapping it: the lead flexes and ellipsises while the short facts
       keep their natural width, so a long hotspot name loses its tail instead
       of pushing "Aug 2 9:29a · ×1 · 4.2 mi" onto a second line.
       `flex-wrap: wrap` is the DEGRADATION, not the normal case. At the
       largest accessibility text scale (1.75×) on a 320px screen the three
       facts alone measure ~316px, so something has to give — and wrapping to
       a second line keeps every fact readable, where clipping would silently
       delete the distance. The layout sweep measures this exactly.
       Each cell still carries `white-space: nowrap`, so a date or a count can
       never split down the middle; only whole facts move.
       An earlier version put nowrap on a group that could not shrink and had
       no overflow control, and the sweep caught it 196px past a 320px screen:
       nowrap alone does not prevent overflow, it hides it off the edge. */
    '.cklcards-sm > .cklcard-sm {',
    '  display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px;',
    '  min-width: 0; overflow: hidden; white-space: nowrap;',
    '  padding: 3px 0; font-size: calc(14px * var(--s)); line-height: 1.35;',
    '  color: var(--muted); }',
    '.cklcards-sm > .cklcard-sm > .cklead {',
    '  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;',
    '  font-weight: 600; }',
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
    '.cklcard .ckmapwrap a, .cklcard .ckmap { text-decoration: none; }',
    '.cklcard .ckwho { min-width: 0; overflow: hidden; text-overflow: ellipsis; }',

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
    '  column-gap: 10px; align-items: baseline; }',
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
  function condense(name, max) {
    var s = String(name == null ? '' : name).trim();
    max = max || 34;
    var cut = s.indexOf('--');
    if (cut > 0) s = s.slice(0, cut);
    s = s.split('/')[0].trim();
    if (s.length > max) s = s.slice(0, max - 1).replace(/[\s,.;:-]+$/, '') + '\u2026';
    return s;
  }

  function build(tpl, v, isMedium) {
    v = v || {};
    var bits = [];
    if (isMedium) {
      // MEDIUM: the place is the headline and carries the link, so the facts
      // line leads with a PLAIN date. Two links to the same checklist in one
      // card is one more tap target than the row has meaning for.
      if (v.date) bits.push('<span class="ckdate">' + esc(shortWhen(v.date)) + '</span>');
    } else {
      // SMALL: the LEAD is the link. Its text is the abbreviated place when
      // there is one, and otherwise the date — so a row always has something
      // clickable without ever printing a place its heading has already given.
      var leadText = v.place ? condense(v.place, v.max) : shortWhen(v.date);
      if (leadText) {
        bits.push('<span class="cklead">' + (v.href
          ? '<a class="ckgo" target="_blank" rel="noopener" href="' + esc(v.href) + '">'
            + esc(leadText) + '</a>'
          : '<span class="ckgo">' + esc(leadText) + '</span>') + '</span>');
      }
      if (v.place && v.date) {
        bits.push('<span class="ckdate">' + esc(shortWhen(v.date)) + '</span>');
      }
    }
    if (v.count != null && v.count !== '') {
      bits.push('<span class="ckcount">' + (isMedium
        ? esc(v.count) + (String(v.count) === '1' ? ' bird' : ' birds')
        : '\u00d7' + esc(v.count)) + '</span>');
    }
    if (v.distMi != null && isFinite(v.distMi)) {
      bits.push('<span class="ckdist">' + (Number(v.distMi) < 10
        ? Number(v.distMi).toFixed(1) : String(Math.round(v.distMi))) + ' mi</span>');
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
      .replace('{{num}}', v.num != null && v.num !== ''
        ? '<span class="cknum">' + esc(v.num) + '</span>' : '')
      .replace('{{tally}}', (v.species != null && v.species !== '')
        ? '<span class="cktally">' + esc(v.species) + '<small>sp.</small></span>' : '')
      .replace('{{below}}', v.below || '')
      .replace('{{place}}', head);
  }

  /* "Aug 2 9:29 AM" is longer than a one-line row can afford next to a place
     name. "Aug 2 9:29a" says the same thing and saves three characters, which
     on a 320px screen is the difference between fitting and truncating. */
  function shortWhen(s) {
    return String(s == null ? '' : s)
      .replace(/\s*([AP])M\b/i, function (_m, ap) { return ap.toLowerCase(); })
      .replace(/:00([ap])\b/i, '$1')
      .trim();
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
