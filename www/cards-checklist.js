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

  /* SMALL — deliberately ONE LINE.
     A checklist list is scanned, not read: you are looking down it for a date
     that is recent enough or a count that is big enough. Anything that wraps
     to a second line halves how many rows fit on a phone screen, so the row
     is a flex line that lets the PLACE take the slack and truncate, while the
     four short facts keep their natural width. */
  var SMALL = [
    '<li class="cklcard cklcard-sm">',
    '<span class="ckplace">{{place}}</span>',
    '<span class="ckfacts">',
    '<span class="ckdate">{{date}}</span>',
    '{{count}}{{map}}{{id}}',
    '</span>',
    '</li>'
  ].join('');

  /* MEDIUM — the same five facts, but the place gets its own line.
     For lists where the place name IS the answer (a chase board) rather than
     one column among five. */
  var MEDIUM = [
    '<li class="cklcard cklcard-md">',
    '<div class="ckplace">{{place}}{{map}}</div>',
    '<div class="ckfacts">',
    '<span class="ckdate">{{date}}</span>{{count}}{{id}}{{who}}',
    '</div>',
    '</li>'
  ].join('');

  /* ------------------------------------------------------------------- css */

  var CSS = [
    '.cklcards { list-style: none; margin: 6px 0 4px; padding: 0; }',
    /* One line per checklist. min-width:0 on the place is what actually lets
       the ellipsis happen — without it a flex item refuses to shrink below its
       content and pushes the facts off the edge instead of truncating. */
    '.cklcards-sm > .cklcard-sm {',
    '  display: flex; align-items: baseline; gap: 8px;',
    '  padding: 3px 0; font-size: calc(14px * var(--s)); line-height: 1.35; }',
    '.cklcards-sm > .cklcard-sm > .ckplace {',
    '  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;',
    '  white-space: nowrap; font-weight: 600; color: var(--ink); }',
    '.cklcards-sm > .cklcard-sm > .ckfacts {',
    '  flex: 0 0 auto; display: flex; align-items: baseline; gap: 8px;',
    '  white-space: nowrap; color: var(--muted); }',
    /* Tabular figures so dates and counts line up down the list. */
    '.cklcard .ckdate { font-variant-numeric: tabular-nums; }',
    '.cklcard .ckcount { font-variant-numeric: tabular-nums; font-weight: 700;',
    '                    color: var(--ink); }',
    '.cklcard .ckid { font-size: calc(12px * var(--s)); }',
    '.cklcard .ckid a { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }',
    '.cklcard .ckmapwrap a, .cklcard .ckmap { text-decoration: none; }',
    '.cklcard .ckwho { color: var(--muted); }',

    /* MEDIUM: the place is the headline, the facts are the caption. */
    '.cklcards-md > .cklcard-md { padding: 6px 0; }',
    '.cklcards-md > .cklcard-md > .ckplace {',
    '  font-size: calc(15px * var(--s)); font-weight: 700; line-height: 1.3;',
    '  overflow-wrap: break-word; }',
    '.cklcards-md > .cklcard-md > .ckfacts {',
    '  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px;',
    '  margin-top: 2px; font-size: calc(13px * var(--s)); color: var(--muted); }'
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

  function build(tpl, v) {
    v = v || {};
    var count = (v.count == null || v.count === '') ? ''
      : '<span class="ckcount">' + esc(v.count)
        + (String(v.count) === '1' ? ' bird' : ' birds') + '</span>';
    // The id arrives as a ready-made link (checklistLink / extA), which carries
    // the app's own link class. Wrap it so the card can still style the slot —
    // otherwise the monospace treatment silently never applies.
    var id = v.id ? '<span class="ckid">' + v.id + '</span>' : '';
    var map = v.map ? '<span class="ckmapwrap">' + v.map + '</span>' : '';
    return tpl
      .replace('{{place}}', v.place || '')
      .replace('{{date}}', esc(v.date || ''))
      .replace('{{count}}', count)
      .replace('{{map}}', map)
      .replace('{{id}}', id)
      .replace('{{who}}', v.who ? '<span class="ckwho">' + v.who + '</span>' : '');
  }

  var API = {
    css: CSS,
    templates: { small: SMALL, medium: MEDIUM },
    condense: condense,
    small: function (v) { return build(SMALL, v); },
    medium: function (v) { return build(MEDIUM, v); },
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
