#!/usr/bin/env node
/**
 * Render CURRENT vs PROPOSED "bird gen" at the real device viewport.
 *
 * Owner's standing preference: show a mockup at 402px before implementing.
 *
 * ⚠️ `chrome --headless --window-size=402,...` DOES NOT set the viewport on
 * this machine — it lays out at 500px and merely crops the PNG (measured
 * 2026-08-29, birding/docs/BACKLOG.md F232). So the page is rendered inside an
 * IFRAME OF AN EXACT CSS WIDTH and captured over CDP, the same technique
 * assets/mockups.js and assets/audit-overflow.js use.
 *
 * Uses the app's REAL stylesheet and the REAL SpeciesCards.medium template, so
 * a difference in the picture is a difference in the design rather than in my
 * reproduction of it.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const APP = path.join(__dirname, '..');
const WWW = path.join(APP, 'www');
// ⚠️ OUTPUT GOES TO /mockups/, WHICH IS GITIGNORED, and that is measured
// rather than fussy — see .gitignore: one run is ~0.8 MB and git keeps every
// version forever. Writing beside this script left 19 untracked PNGs in
// assets/ on the first run.
const HERE = path.join(APP, 'mockups');
fs.mkdirSync(HERE, { recursive: true });
const WIDTH = Number(process.argv[2] || 402);

// ⚠️ THE STYLESHEET IS EXTRACTED FROM index.html AT RUN TIME, never kept as a
// copy beside this file. A checked-in app.css would be a second copy of the
// styling that drifts the moment anyone edits the real one — the same failure
// F165 documents for statuses. Read it from the source of truth every run.
const CSS = (function () {
  const src = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  if (!out.length) throw new Error('no <style> blocks found in www/index.html');
  return out.join('\n');
}());

// The bird tile.
//
// ⚠️ IT MUST BE `<span class="thumb">`, which is exactly what photoSlot()
// emits (www/index.html:11064). My first version used `<img class="tn">` —
// a class no card rule matches — so the tile rendered at its intrinsic 96px
// instead of the size the card CSS assigns. That UNDERSTATED the medium card
// in every earlier shot, which is the whole reason the mockup is built from
// the app's own stylesheet rather than my own.
//
// STUB DATA IS THE APP'S OWN BUNDLED ART. www/assets/birds/<code>.jpg holds
// 1282 real photos, so the mockup shows what the device shows instead of a
// coloured square whose apparent size is my invention. Inlined as a data URI
// so the standalone HTML works from any folder, not only off the local server.
function photo(code) {
  const f = path.join(WWW, 'assets', 'birds', code + '.jpg');
  const b64 = fs.readFileSync(f).toString('base64');
  return '<span class="thumb" style="background-image:url(&quot;data:image/jpeg;base64,'
    + b64 + '&quot;);background-size:cover;background-position:center"></span>';
}

function drawnTile(hex, glyph) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">'
    + '<rect width="200" height="200" fill="' + hex + '"/>'
    + '<text x="100" y="132" font-size="96" text-anchor="middle">' + glyph + '</text></svg>';
  return '<span class="thumb" style="background-image:url(&quot;data:image/svg+xml;base64,'
    + Buffer.from(svg).toString('base64')
    + '&quot;);background-size:cover;background-position:center"></span>';
}

// ⚠️ `nazboo` DOES NOT EXIST — Nazca Booby is `nazboo1`. Guessed wrong first
// and the file was simply missing, which is the same lesson F219 records: an
// eBird code is resolved against the taxonomy, never inferred from the name.
//
// ⚠️ STUB DATA MUST OBEY THE SHIPPED RULES. Owner: *"so the white wagtail
// wouldnt be in the feed because it is not new and is not in chaseable area"*,
// then *"only new abas or abas in chase area that are unseen, to be specific"*.
//
// He is right and my first cut was INVALID: it showed White Wagtail at 98.2 mi
// and a day old, labelled *"outside your chase radius"* — which is precisely
// the row **F271 shipped a fix to REMOVE** in v1.64.0. I had carried forward an
// older code comment, *"distance ORDERS this lane and never gates it"*, without
// noticing F271 superseded it. **A mockup that contradicts shipped behaviour is
// worse than none: it argues for re-introducing a bug that was already fixed.**
//
// The rule, from megaNews() at www/index.html:6627, MEGA_DAYTRIP_MI = 55:
//   near   = mi == null || mi <= 55
//   'new'  qualifies ON ITS OWN          <- a first record is news anywhere
//   'near' / 'multi' / 'spot' need near   <- and, per the owner, unseen too
//
// So the two megas below show the two legal paths, and White Wagtail moves to
// the held-back count where it belongs.
const BIRDS = {
  nazca:  { name: 'Nazca Booby',          sci: 'Sula granti',             code: 'nazboo1', alpha: 'NAZB', ic: photo('nazboo1') },
  shtsan: { name: 'Sharp-tailed Sandpiper', sci: 'Calidris acuminata',    code: 'shtsan',  alpha: 'SPTS', ic: photo('shtsan') },
  wagtail:{ name: 'White Wagtail',        sci: 'Motacilla alba',          code: 'whiwag',  alpha: 'WAWA', ic: photo('whiwag') },
  ruff:   { name: 'Ruff',                 sci: 'Calidris pugnax',         code: 'ruff',    alpha: 'RUFF', ic: photo('ruff') },
  sposan: { name: 'Spotted Sandpiper',    sci: 'Actitis macularius',      code: 'sposan',  alpha: 'SPSA', ic: photo('sposan') },
  baisan: { name: "Baird's Sandpiper",    sci: 'Calidris bairdii',        code: 'baisan',  alpha: 'BASA', ic: photo('baisan') },
  norwat: { name: 'Northern Waterthrush', sci: 'Parkesia noveboracensis', code: 'norwat',  alpha: 'NOWA', ic: photo('norwat') },
};

// Okabe-Ito. The owner has red-green colour blindness, so these are the
// reliable ones and NOTHING here depends on telling them apart.
const BLUE = '#0072B2', ORANGE = '#E69F00';

// ─────────────────────────────────────────────────────────── CURRENT
// Five lanes, five headings, THREE different row formats: megas and
// celebrities use SpeciesCards.medium, crowd/cascade/convergence are
// hand-built <li>. Reproduced from www/index.html:21767-22110.
function currentHtml() {
  const megaBelow = (news, where, found, latest, dist) => '<ul class="cklrows">'
    + '<li class="lblrow"><span class="lbl">Why it is news</span><span class="where">' + news + '</span></li>'
    + '<li class="lblrow"><span class="lbl">Where</span><span class="where">' + where + '</span></li>'
    + (found ? '<li class="lblrow"><span class="lbl">First found</span><span class="where">' + found + '</span></li>' : '')
    + '<li class="lblrow"><span class="lbl">Latest</span><span class="when">' + latest + '</span></li>'
    + '<li class="lblrow"><span class="lbl">' + dist.lbl + '</span><span class="where">' + dist.v + '</span></li>'
    + '</ul>';

  let h = '';
  h += '<h3 class="lanehead">\uD83E\uDD85 2 ABA Code 3+ megas in Washington <button class="lanehelp" type="button">\u24D8</button></h3>';
  h += '<div class="lanesub">as of 14 minutes ago \u00b7 one line each \u2014 open <b>Rare birds</b> for photos, '
    + 'state history and evidence \u00b7 3 more megas are not news today (too far, already seen, one report) '
    + '\u2014 all of them are in <b>Mega rarities</b></div>';
  h += '<ul class="obs big xl lanes">'
    + SC.medium({ sci: BIRDS.nazca.sci, icon: BIRDS.nazca.ic, name: BIRDS.nazca.name,
        code: BIRDS.nazca.code, alpha: BIRDS.nazca.alpha,
        tags: '<span class="megafresh">\uD83C\uDD95 found today</span>',
        sub: 'ABA Code 3+ \u00b7 11 reports', distMi: 50.1,
        below: megaBelow('First state record \u00b7 found today',
          '<a href="#">Ocean Shores Jetty</a>',
          'Sep 1 \u2014 nothing reported here since we began watching on Aug 3',
          'Sep 1, 2:14 PM', { lbl: 'Distance', v: '50 mi from home' }) })
    + SC.medium({ sci: BIRDS.wagtail.sci, icon: BIRDS.wagtail.ic, name: BIRDS.wagtail.name,
        code: BIRDS.wagtail.code, alpha: BIRDS.wagtail.alpha, tags: '',
        sub: 'ABA Code 3+ \u00b7 11 reports', distMi: 98.2,
        below: megaBelow('ABA Code 3+', '<a href="#">Wallula Junction</a>', '',
          'Aug 31, 9:40 AM',
          { lbl: 'Distance \u00b7 outside your chase radius', v: '98 mi from home' }) })
    + '</ul>';

  h += '<h3 class="lanehead">\uD83C\uDFAF Celebrity Birds <button class="lanehelp" type="button">\u24D8</button></h3>';
  h += '<ul class="obs big xl lanes">'
    + SC.medium({ sci: BIRDS.sposan.sci, icon: BIRDS.sposan.ic, name: BIRDS.sposan.name,
        code: BIRDS.sposan.code, alpha: BIRDS.sposan.alpha, tags: '',
        sub: '4 sightings \u00b7 needed', distMi: 6.2,
        below: '<ul class="cklrows">'
          + '<li class="lblrow"><span class="lbl">Where</span><span class="where"><a href="#">Marymoor Park</a></span></li>'
          + '<li class="lblrow"><span class="lbl">Latest</span><span class="when">Sep 1, 11:05 AM</span></li></ul>' })
    + '</ul>';

  h += '<h3 class="lanehead">\uD83D\uDC26 2 species drawing a crowd <button class="lanehelp" type="button">\u24D8</button></h3>';
  h += '<div class="status">Distinct observers at one spot in the last 6 hours, against what that '
    + 'species normally draws there. \uD83C\uDD95 = nothing reported in the trailing two weeks.</div>';
  h += '<ul class="obs big xl lanes">'
    + crowdLi(BIRDS.baisan, '7 birders \u00b7 9 lists \u00b7 5\u00d7 normal \u00b7 12.4 mi',
        'Cedar River Mouth', 'Sep 1, 1:32 PM \u00b7 S387245442', true)
    + crowdLi(BIRDS.ruff, '5 birders \u00b7 new here \u00b7 31.0 mi',
        'Nisqually NWR', 'Sep 1, 12:10 PM \u00b7 S387240118', false)
    + '</ul>';

  h += '<h3 class="lanehead">\uD83C\uDFC6 1 species cascading through the leaderboard <button class="lanehelp" type="button">\u24D8</button></h3>';
  h += '<ul class="obs big xl lanes">'
    + '<li><div class="name">' + BIRDS.norwat.ic + '<span class="ntext"><a href="#">Northern Waterthrush</a> \uD83D\uDD0D</span></div>'
    + '<div class="meta">4 of the top 100 added it in the last 3 days \u00b7 18.9 mi</div>'
    + '<ul class="cklrows"><li><span class="when">Where</span><span class="howmany"></span>'
    + '<span class="where"><a href="#">Union Bay Natural Area</a></span></li>'
    + '<li><span class="when">Latest</span><span class="howmany"></span>'
    + '<span class="where">Aug 31, 7:20 AM \u00b7 <a href="#">S387188201</a></span></li></ul></li>'
    + '</ul>';

  h += '<h3 class="lanehead">\uD83D\uDCCD 1 hotspot far outdrawing its norm <button class="lanehelp" type="button">\u24D8</button></h3>';
  h += '<ul class="obs big xl lanes">'
    + '<li><div class="name"><span class="ntext"><a href="#">Montlake Fill</a></span></div>'
    + '<div class="meta">11 birders today \u00b7 3.1\u00d7 its own norm \u00b7 9.7 mi</div>'
    + '<ul class="cklrows"><li><span class="when">Latest</span><span class="howmany"></span>'
    + '<span class="where">Sep 1, 1:58 PM</span></li></ul></li>'
    + '</ul>';
  return h;
}

function crowdLi(b, meta, where, latest, novel) {
  return '<li><div class="name">' + b.ic + '<span class="ntext"><a href="#">' + b.name + '</a>'
    + ' \uD83D\uDD0D' + (novel ? ' \uD83C\uDD95' : '') + '</span></div>'
    + '<div class="meta">' + meta + '</div>'
    + '<ul class="cklrows"><li><span class="when">Where</span><span class="howmany"></span>'
    + '<span class="where"><a href="#">' + where + '</a></span></li>'
    + '<li><span class="when">Latest</span><span class="howmany"></span>'
    + '<span class="where">' + latest + '</span></li></ul></li>';
}

// ─────────────────────────────────────────────────────────── PROPOSED
// ONE ranked list, ONE row format. Lane identity survives as a WORD on the
// row, never as a colour or a position, so nothing is lost by merging.
const PROPOSED_CSS = `
  .feedhead { margin: 6px 0 2px; font-size: 20px; font-weight: 800; letter-spacing: -.2px; }
  .feedsub  { margin: 0 0 14px; font-size: 13px; color: var(--dim, #667); line-height: 1.45; }
  .kinds    { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 16px; }
  .kindchip { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
              border: 2px solid currentColor; white-space: nowrap; }
  /* ⚠️ Every badge is GLYPH + WORD + BORDER STYLE. The tint is the third
     channel, never the first, and the palette is Okabe-Ito: no red/green
     pair anywhere, because the owner cannot separate them. */
  .abadge   { display: inline-flex; align-items: center; gap: 5px; font-size: 12px;
              font-weight: 800; letter-spacing: .04em; padding: 3px 9px 3px 7px;
              border-radius: 6px; margin: 0 0 6px; }
  /* ⚠️ DARKER THAN OKABE-ITO VERMILLION ON PURPOSE. White text on #D55E00
     measures 3.87:1, which fails WCAG AA (4.5:1) for text this small, and
     falls to 3.23:1 under simulated deuteranopia. Darkening the fill keeps the
     hue family and buys the contrast; the WORD is doing the work anyway. */
  .ab-mega     { background: #9E4400; color: #fff;     border: 2px solid  #9E4400; }
  .ab-need     { background: #fff;    color: #005B8F;  border: 2px double #005B8F; }
  .ab-crowd    { background: #fff;    color: #111111;  border: 2px dashed #111111; }
  .ab-cascade  { background: #fff;    color: #6B4400;  border: 2px dotted #B37400; }
  .ab-hotspot  { background: #f1f1f4; color: #333333;  border: 2px ridge  #6E6E78; }
  .arow     { position: relative; }
  .awhy     { font-size: 13.5px; line-height: 1.45; margin: 2px 0 0; }
  .awhy b   { font-weight: 700; }
  .aage     { font-size: 12px; font-weight: 700; color: #444; }
  .afoot    { margin: 14px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--dim, #667);
              border-top: 2px solid #ddd; padding-top: 10px; }
`;

function badge(kind) {
  const B = {
    mega:    ['\u26D4', 'MEGA'],
    need:    ['\uD83C\uDFAF', 'YOU NEED IT'],
    crowd:   ['\uD83D\uDC65', 'CROWD'],
    cascade: ['\uD83C\uDFC6', 'CASCADE'],
    hotspot: ['\uD83D\uDCCD', 'HOTSPOT'],
  }[kind];
  return '<span class="abadge ab-' + kind + '">' + B[0] + ' ' + B[1] + '</span>';
}

function alertRow(o) {
  const below = '<div class="arow">' + badge(o.kind)
    + '<div class="awhy"><b>Why it is news</b> \u2014 ' + o.why + '</div>'
    + '<ul class="cklrows">'
    + '<li class="lblrow"><span class="lbl">Where</span><span class="where">'
    + '<a href="#">' + o.where + '</a></span></li>'
    + (o.found ? '<li class="lblrow"><span class="lbl">First found</span><span class="where">'
        + o.found + '</span></li>' : '')
    + '<li class="lblrow"><span class="lbl">Latest</span><span class="when">' + o.latest + '</span></li>'
    + '</ul></div>';
  return SC.medium({
    sci: o.b.sci, icon: o.b.ic, name: o.b.name, code: o.b.code, alpha: o.b.alpha,
    tags: o.tag || '', sub: o.sub, distMi: o.mi, below: below,
  });
}

function proposedHtml() {
  let h = '';
  h += '<div class="feedhead">\uD83D\uDD14 7 alerts <button class="lanehelp" type="button">\u24D8</button></div>';
  h += '<div class="feedsub">Newest 14 minutes ago. Ranked by how much it matters, '
    + 'then by how fresh it is \u2014 every row says which kind it is and why it is here.</div>';
  h += '<div class="kinds">'
    + '<span class="kindchip" style="color:#D55E00">\u26D4 2 mega</span>'
    + '<span class="kindchip" style="color:#0072B2">\uD83C\uDFAF 1 you need</span>'
    + '<span class="kindchip" style="color:#111">\uD83D\uDC65 2 crowd</span>'
    + '<span class="kindchip" style="color:#7A4E00">\uD83C\uDFC6 1 cascade</span>'
    + '<span class="kindchip" style="color:#555">\uD83D\uDCCD 1 hotspot</span>'
    + '</div>';

  h += '<ul class="obs big xl lanes">'
    + alertRow({ kind: 'mega', b: BIRDS.nazca, sub: 'ABA Code 3+ \u00b7 11 reports', mi: 50.1,
        tag: '<span class="megafresh">\uD83C\uDD95 found today</span>',
        why: 'ABA Code 3+ \u00b7 <b>first state record</b> \u00b7 found today',
        where: 'Ocean Shores Jetty',
        found: 'Sep 1 \u2014 nothing reported here since we began watching on Aug 3',
        latest: 'Sep 1, 2:14 PM \u00b7 14 min ago' })
    + alertRow({ kind: 'mega', b: BIRDS.wagtail, sub: 'ABA Code 3+ \u00b7 11 reports', mi: 98.2,
        why: 'ABA Code 3+ \u00b7 <b>98 mi \u2014 outside your chase radius</b>, shown because a '
           + 'continent-level rarity is worth a drive',
        where: 'Wallula Junction', latest: 'Aug 31, 9:40 AM \u00b7 1 day ago' })
    + alertRow({ kind: 'need', b: BIRDS.sposan, sub: '4 sightings \u00b7 needed', mi: 6.2,
        why: '<b>You have not seen it this year</b> and it is 6 mi away \u2014 4 sightings at one spot',
        where: 'Marymoor Park', latest: 'Sep 1, 11:05 AM \u00b7 3 h ago' })
    + alertRow({ kind: 'crowd', b: BIRDS.baisan, sub: '7 birders \u00b7 9 lists', mi: 12.4,
        tag: '<span class="megafresh">\uD83C\uDD95 new here</span>',
        why: '7 birders converged \u2014 <b>5\u00d7 what this species normally draws here</b>',
        where: 'Cedar River Mouth', latest: 'Sep 1, 1:32 PM \u00b7 56 min ago' })
    + alertRow({ kind: 'crowd', b: BIRDS.ruff, sub: '5 birders', mi: 31.0,
        why: '5 independent observers on a bird with <b>no reports here in two weeks</b>',
        where: 'Nisqually NWR', latest: 'Sep 1, 12:10 PM \u00b7 2 h ago' })
    + alertRow({ kind: 'cascade', b: BIRDS.norwat, sub: '4 of the top 100', mi: 18.9,
        why: '<b>4 of the top 100 added it in 3 days</b> \u2014 nearest report you can drive to',
        where: 'Union Bay Natural Area', latest: 'Aug 31, 7:20 AM \u00b7 1 day ago' })
    + '</ul>';

  // The hotspot lane is a PLACE, not a species -- but it can still use the
  // one card, with a map tile where the bird photo goes. My first attempt
  // hand-built this row and the render caught it: the distance came out
  // BEFORE the name and unstyled, because `.dist` is positioned by the card's
  // own structure. That is the argument for one row format, made by accident.
  h += '<ul class="obs big xl lanes">'
    + SC.medium({ icon: drawnTile('#555', '\uD83D\uDCCD'), name: 'Montlake Fill',
        sub: '11 birders today', distMi: 9.7,
        below: '<div class="arow">' + badge('hotspot')
          + '<div class="awhy"><b>Why it is news</b> \u2014 11 birders today, '
          + '<b>3.1\u00d7 this hotspot\u2019s own norm</b></div>'
          + '<ul class="cklrows">'
          + '<li class="lblrow"><span class="lbl">Latest</span>'
          + '<span class="when">Sep 1, 1:58 PM \u00b7 30 min ago</span></li>'
          + '</ul></div>' })
    + '</ul>';

  h += '<div class="afoot">\u26A0\uFE0F <b>3 more megas are not news today</b> '
    + '(too far, already seen, one report) \u2014 all of them are in <b>Mega rarities</b>.<br>'
    + 'Nothing here is older than 24 hours. An alert with nothing to say says nothing.</div>';
  return h;
}

// ─────────────────────────────────────────────────────── PROPOSED (COMPACT)
// Same ranking and the same badges, but the labelled Where/First found/Latest
// rows collapse into ONE line, and the evidence moves behind a tap.
//
// ⚠️ Built after the first render DISPROVED my own claim: the roomy feed came
// out 2382px against today's 2376px, so "an alert feed is shorter" was an
// assertion, not a measurement. If condensing is the goal, this is the option
// that actually does it.
const COMPACT_CSS = `
  .cfeed .arow { margin-top: 5px; }
  .cfeed .awhy { font-size: 13px; line-height: 1.4; margin: 0; }
  .cfeed .aline { font-size: 12.5px; line-height: 1.45; margin: 3px 0 0; color: #333; }
  .cfeed .abadge { margin: 0 6px 0 0; padding: 2px 7px 2px 6px; font-size: 11px; vertical-align: 2px; }
  .cfeed .amore { font-size: 12px; font-weight: 700; color: #0072B2; text-decoration: underline;
                  display: inline-block; margin-top: 4px; }
`;

function compactRow(o) {
  const below = '<div class="arow">'
    + '<div class="awhy">' + badge(o.kind) + o.why + '</div>'
    + '<div class="aline"><a href="#">' + o.where + '</a> \u00b7 ' + o.age
    + (o.extra ? ' \u00b7 ' + o.extra : '') + '</div>'
    + (o.more ? '<span class="amore">' + o.more + '</span>' : '')
    + '</div>';
  return SC.medium({
    sci: o.b.sci, icon: o.b.ic, name: o.b.name, code: o.b.code, alpha: o.b.alpha,
    tags: o.tag || '', sub: o.sub, distMi: o.mi, below: below,
  });
}

function compactHtml() {
  let h = '';
  h += '<div class="feedhead">\uD83D\uDD14 7 alerts <button class="lanehelp" type="button">\u24D8</button></div>';
  h += '<div class="feedsub">Newest 14 minutes ago \u00b7 ranked by what matters most, '
    + 'then by what is freshest.</div>';
  h += '<div class="kinds">'
    + '<span class="kindchip" style="color:#D55E00">\u26D4 2 mega</span>'
    + '<span class="kindchip" style="color:#0072B2">\uD83C\uDFAF 1 you need</span>'
    + '<span class="kindchip" style="color:#111">\uD83D\uDC65 2 crowd</span>'
    + '<span class="kindchip" style="color:#7A4E00">\uD83C\uDFC6 1 cascade</span>'
    + '<span class="kindchip" style="color:#555">\uD83D\uDCCD 1 hotspot</span>'
    + '</div>';
  h += '<ul class="obs big xl lanes cfeed">'
    + compactRow({ kind: 'mega', b: BIRDS.nazca, sub: '11 reports', mi: 50.1,
        tag: '<span class="megafresh">\uD83C\uDD95 found today</span>',
        why: '<b>First state record</b> \u00b7 found today',
        where: 'Ocean Shores Jetty', age: '14 min ago',
        more: 'Nothing reported here since Aug 3 \u2014 show evidence' })
    + compactRow({ kind: 'mega', b: BIRDS.wagtail, sub: '11 reports', mi: 98.2,
        why: 'ABA Code 3+ \u00b7 <b>outside your chase radius</b>',
        where: 'Wallula Junction', age: 'Aug 31, 7:20 AM \u00b7 1 day ago' })
    + compactRow({ kind: 'need', b: BIRDS.sposan, sub: '4 sightings', mi: 6.2,
        why: '<b>You still need it</b> \u00b7 4 sightings at one spot',
        where: 'Marymoor Park', age: 'Sep 1, 11:05 AM \u00b7 3 h ago' })
    + compactRow({ kind: 'crowd', b: BIRDS.baisan, sub: '7 birders \u00b7 9 lists', mi: 12.4,
        tag: '<span class="megafresh">\uD83C\uDD95 new here</span>',
        why: '7 birders \u00b7 <b>5\u00d7 normal here</b>',
        where: 'Cedar River Mouth', age: 'Sep 1, 1:32 PM \u00b7 56 min ago', extra: '<a href="#">S387245442</a>' })
    + compactRow({ kind: 'crowd', b: BIRDS.ruff, sub: '5 birders', mi: 31.0,
        why: '5 observers \u00b7 <b>no reports here in two weeks</b>',
        where: 'Nisqually NWR', age: 'Sep 1, 12:10 PM \u00b7 2 h ago', extra: '<a href="#">S387240118</a>' })
    + compactRow({ kind: 'cascade', b: BIRDS.norwat, sub: '4 of the top 100', mi: 18.9,
        why: '<b>4 of the top 100 added it in 3 days</b>',
        where: 'Union Bay Natural Area', age: 'Aug 31, 7:20 AM \u00b7 1 day ago' })
    + SC.medium({ icon: drawnTile('#555', '\uD83D\uDCCD'), name: 'Montlake Fill',
        sub: '11 birders today', distMi: 9.7,
        below: '<div class="arow"><div class="awhy">' + badge('hotspot')
          + '<b>3.1\u00d7 this hotspot\u2019s own norm</b></div>'
          + '<div class="aline">Sep 1, 1:58 PM \u00b7 30 min ago</div></div>' })
    + '</ul>';
  h += '<div class="afoot">\u26A0\uFE0F <b>3 more megas are not news today</b> '
    + '(too far, already seen, one report) \u2014 all of them are in <b>Mega rarities</b>.</div>';
  return h;
}

// ────────────────────────────────────────────── OPTION C — SMALL cards
// Owner: *"okay switch to small card templates"*.
//
// ⚠️ SMALL DECLARES DIFFERENT SLOTS, and getting this wrong fails SILENTLY —
// the exact trap index.html already warns about ("passing one renders nothing
// and says so nowhere"). Measured in cards-species.js:
//
//   distHtml()  returns '' unless MEDIUM or LARGE  -> `distMi` IS DROPPED.
//               The supported route on small is `distance`, which subHtml()
//               folds into the one sub-line.
//   SMALL       has no {{dist}}, {{sci}}, {{meta}} or {{conf}} slot at all.
//   .thumb      is 56px here against min(128px, 28vw) on .obs.xl — which is
//               where nearly all of the height saving comes from.
const SMALL_CSS = `
  .sfeed .arow { margin-top: 4px; }
  .sfeed .awhy { font-size: 12.5px; line-height: 1.4; margin: 0; }
  .sfeed .aline { font-size: 12px; line-height: 1.4; margin: 2px 0 0; color: #333; }
  .sfeed .abadge { margin: 0 5px 0 0; padding: 1px 6px 1px 5px; font-size: 10.5px;
                   letter-spacing: .03em; vertical-align: 1px; }
  .sfeed > li { padding-bottom: 10px; }

  /* ── THE CATEGORY ICON AT THE RIGHT EDGE ──────────────────────────────
     Owner: *"I like the different icons for each alert. Can we add this
     category icon on the right side of each item."*

     It rides the SMALL template's {{right}} slot, which exists for precisely
     this and is documented as having to be a sibling of .ntext rather than
     inside it — anything nested in the text block sits after the words rather
     than at the edge. The .spgo class is what carries margin-left: auto, so
     it is kept and .akind only adds the skin.

     ⚠️ The BORDER STYLE differs per kind (solid / double / dashed / dotted /
     plain) and is doing real work, not decoration. An icon column that is
     told apart only by hue is the failure mode this project bans outright,
     and emoji glyphs are small: at 20px a pin and a trophy are two dark
     blobs. Shape survives that, and so does the word on the badge. */
  /* SIZED TO MATCH THE BIRD PHOTO. Owner: *"make the icons on right larger to
     match image size"*. The .obs.card-sm .thumb is 56px (measured), so the
     category tile is 56px too and the row reads as two equal bookends with the
     text between them, rather than a photo and an afterthought.
     ⚠️ 56px on BOTH edges leaves 393 - 56 - 56 - gaps for the name, so the
     layout probe has to confirm nothing clips — it is checked every render. */
  /* THE RIGHT COLUMN IS A STACK: category glyph, then HOW LONG AGO.
     Owner: *"the update time needs to be more prominent. Let's add it under
     the alert icon in the right column... larger bolder font."*
     The age leaves the text line entirely when it moves here — printing it in
     both places would be the same duplication the badge glyph was. */
  .sfeed .akwrap { margin-left: auto; flex: 0 0 auto; display: inline-flex;
                   flex-direction: column; align-items: center; gap: 4px;
                   width: 62px; }
  .sfeed .akage  { font-size: 14px; font-weight: 800; line-height: 1.15;
                   color: #111; text-align: center; white-space: nowrap;
                   font-variant-numeric: tabular-nums; }
  .sfeed .akind { flex: 0 0 auto; display: inline-flex;
                  align-items: center; justify-content: center;
                  width: 56px; height: 56px; border-radius: 10px;
                  font-size: 28px; line-height: 1; }
  /* ⚠️ NO SOLID FILL BEHIND A GLYPH. The mega tile was #D55E00 with the red ⛔
     on top of it, and the owner could not see it: *"is it the same color? Im
     color blind"*. MEASURED on the rendered pixels — chip #d55e00 against the
     glyph's white bar is 3.87:1 normally and 3.23:1 under simulated
     deuteranopia, and the red ring of the glyph is worse still because red on
     vermillion is the exact pairing he cannot separate.

     So the colour moved OUT of the fill and into the BORDER, and every glyph
     now sits on near-white. Emphasis is carried by border weight and style —
     3px solid for the loudest, then double / dashed / dotted / thin — which
     survives both colour blindness and a greyscale print. */
  .sfeed .ak-mega    { background: #FFF3EA; border: 3px solid  #9E4400; }
  .sfeed .ak-need    { background: #EFF7FC; border: 3px double #005B8F; }
  .sfeed .ak-crowd   { background: #ffffff; border: 2px dashed #111111; }
  .sfeed .ak-cascade { background: #ffffff; border: 2px dotted #6B4400; }
  .sfeed .ak-hotspot { background: #f4f4f6; border: 3px ridge  #6E6E78; }
`;

// ⚠️ THE APP'S OWN LANE GLYPHS, not ones I invented.
//
// I had used ⛔ for mega, and MEASURED it as a mistake: the red ring of ⛔
// against the vermillion chip is **1.00 contrast under simulated
// deuteranopia** — the same colour, exactly as the owner reported. Moving it
// to a light tile only swapped which half disappeared (the white bar drops to
// 1.08), because ⛔ is a TWO-TONE red/white glyph and no single background can
// serve both halves.
//
// So the glyph goes back to what the lanes already use — 🦅 🎯 🐦 🏆 📍
// (www/index.html:21767, 21872, 21930, 21993, 22057). They are mid-tone and
// multi-hued rather than red-on-red, they read on a light tile, and they carry
// continuity from the section this replaces. The lesson is the general one:
// **do not invent a signal when the codebase already has one.**
const KIND_GLYPH = {
  mega: '\uD83E\uDD85', need: '\uD83C\uDFAF', crowd: '\uD83D\uDC26',
  cascade: '\uD83C\uDFC6', hotspot: '\uD83D\uDCCD',
};
const KIND_WORD = {
  mega: 'MEGA', need: 'YOU NEED IT', crowd: 'CROWD',
  cascade: 'CASCADE', hotspot: 'HOTSPOT',
};

function kindIcon(kind) {
  // A real label, not a tooltip only: the glyph is never the sole carrier.
  return '<span class="spgo akind ak-' + kind + '" role="img" aria-label="'
    + KIND_WORD[kind] + '" title="' + KIND_WORD[kind] + '">'
    + KIND_GLYPH[kind] + '</span>';
}

// wordOnly: the badge below keeps the WORD and drops the glyph, because the
// glyph has moved to the right edge and printing it twice on one row is noise.
function badgeSmall(kind, wordOnly) {
  return '<span class="abadge ab-' + kind + '">'
    + (wordOnly ? '' : KIND_GLYPH[kind] + ' ') + KIND_WORD[kind] + '</span>';
}

function smallRow(o, opts) {
  opts = opts || {};
  return SC.small({
    icon: o.b ? o.b.ic : o.ic,
    name: o.b ? o.b.name : o.name,
    tags: o.tag || '',
    // ⚠️ `distance`, NOT `distMi`. distMi renders nothing on a small card.
    distance: o.mi + ' mi',
    sub: o.sub,
    right: opts.rightIcon ? kindIcon(o.kind) : '',
    below: '<div class="arow">'
      + '<div class="awhy">'
      + (opts.badge === false ? '' : badgeSmall(o.kind, opts.wordOnly)) + o.why + '</div>'
      + '<div class="aline">' + (o.where ? '<a href="#">' + o.where + '</a> \u00b7 ' : '')
      + o.age + (o.extra ? ' \u00b7 ' + o.extra : '') + '</div></div>',
  });
}

const ALERTS = [
  { kind: 'mega', b: BIRDS.nazca, sub: '11 reports', mi: 50.1,
    tag: '<span class="megafresh">\uD83C\uDD95 found today</span>',
    why: '<b>found today</b> \u00b7 within a day trip \u00b7 11 reports today',
    where: 'Ocean Shores Jetty', age: 'Sep 1, 2:14 PM \u00b7 14 min ago' },
  { kind: 'mega', b: BIRDS.shtsan, sub: '4 reports', mi: 98.2,
    tag: '<span class="megafresh">\uD83C\uDD95 found today</span>',
    why: '<b>found today</b> \u2014 98 mi, shown <b>because it is new</b>',
    where: 'Wallula Junction', age: 'Sep 1, 12:10 PM \u00b7 2 h ago' },
  { kind: 'need', b: BIRDS.sposan, sub: '4 sightings', mi: 6.2,
    why: '<b>You still need it</b> \u00b7 4 sightings at one spot',
    where: 'Marymoor Park', age: 'Sep 1, 11:05 AM \u00b7 3 h ago' },
  { kind: 'crowd', b: BIRDS.baisan, sub: '7 birders \u00b7 9 lists', mi: 12.4,
    tag: '<span class="megafresh">\uD83C\uDD95 new here</span>',
    why: '7 birders \u00b7 <b>5\u00d7 normal here</b>',
    where: 'Cedar River Mouth', age: 'Sep 1, 1:32 PM \u00b7 56 min ago', extra: '<a href="#">S387245442</a>' },
  { kind: 'crowd', b: BIRDS.ruff, sub: '5 birders', mi: 31.0,
    why: '5 observers \u00b7 <b>no reports here in two weeks</b>',
    where: 'Nisqually NWR', age: 'Sep 1, 12:10 PM \u00b7 2 h ago', extra: '<a href="#">S387240118</a>' },
  { kind: 'cascade', b: BIRDS.norwat, sub: '4 of the top 100', mi: 18.9,
    why: '<b>4 of the top 100 added it in 3 days</b>',
    where: 'Union Bay Natural Area', age: 'Aug 31, 7:20 AM \u00b7 1 day ago' },
  { kind: 'hotspot', ic: drawnTile('#555', '\uD83D\uDCCD'), name: 'Montlake Fill',
    sub: '11 birders today', mi: 9.7,
    why: '<b>3.1\u00d7 this hotspot\u2019s own norm</b>',
    where: '', age: 'Sep 1, 1:58 PM \u00b7 30 min ago' },
];

function feedChrome() {
  return '<div class="feedhead">\uD83D\uDD14 7 alerts '
    + '<button class="lanehelp" type="button">\u24D8</button></div>'
    + '<div class="feedsub">Newest 14 minutes ago \u00b7 ranked by what matters most, '
    + 'then by what is freshest.</div>'
    + '<div class="kinds">'
    + '<span class="kindchip" style="color:#9E4400">\uD83E\uDD85 2 mega</span>'
    + '<span class="kindchip" style="color:#005B8F">\uD83C\uDFAF 1 you need</span>'
    + '<span class="kindchip" style="color:#111">\uD83D\uDC26 2 crowd</span>'
    + '<span class="kindchip" style="color:#6B4400">\uD83C\uDFC6 1 cascade</span>'
    + '<span class="kindchip" style="color:#555">\uD83D\uDCCD 1 hotspot</span>'
    + '</div>';
}

function feedFoot() {
  return '<div class="afoot">\u26A0\uFE0F <b>4 more megas are not news today</b> '
    + '\u2014 White Wagtail and 3 others are <b>too far and not new</b>, already '
    + 'seen, or a single report. All of them are in <b>Mega rarities</b>.</div>';
}

function smallHtml(opts) {
  return feedChrome()
    + '<ul class="obs card-sm sfeed">'
    + ALERTS.map(function (a) { return smallRow(a, opts); }).join('')
    + '</ul>' + feedFoot();
}

// ────────────────────────────────────────────────────────────── plumbing
let SC = null;
function loadCards() {
  // The file ends with `module.exports = API`, so require() is the supported
  // seam. My first attempt evaluated it with a fake `global` and got nothing,
  // because the wrapper resolves to `this` (= module.exports) under CommonJS.
  SC = require(path.join(WWW, 'cards-species.js'));
  if (!SC || !SC.medium) throw new Error('SpeciesCards did not load');
}

function page(title, body) {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>' + CSS + '</style><style>' + SC.css + '</style>'
    + '<style>' + PROPOSED_CSS + COMPACT_CSS + SMALL_CSS + '</style>'
    + '<style>body{margin:0;padding:12px 14px 28px;background:#fff}'
    + '.mockbanner{font:800 13px/1.3 system-ui;letter-spacing:.06em;padding:8px 10px;'
    + 'margin:-12px -14px 14px;background:#111;color:#fff}</style>'
    + '</head><body><div class="mockbanner">' + title + '</div>'
    + '<div id="results">' + body + '</div></body></html>';
}

const PAGES = {};
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (PAGES[u]) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGES[u]);
  }
  const f = path.join(WWW, u.replace(/^\//, ''));
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200);
    res.end(buf);
  });
});

const CHROME = [process.env.CHROME_BIN,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

function cdp(url) {
  const WebSocket = require(path.join(APP, 'node_modules', 'ws'));
  const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  let n = 0; const waiting = new Map();
  const ready = new Promise((r) => ws.on('open', r));
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  });
  return {
    ready,
    send: (method, params, sessionId) => new Promise((res, rej) => {
      n += 1;
      waiting.set(n, (msg) => (msg.error ? rej(new Error(method + ': ' + msg.error.message)) : res(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    }),
  };
}

async function main() {
  loadCards();
  PAGES['/current'] = page('CURRENT \u2014 bird gen today, 5 lanes, 3 row formats', currentHtml());
  PAGES['/proposed'] = page('OPTION A \u2014 one ranked feed, full evidence on every row', proposedHtml());
  PAGES['/compact'] = page('OPTION B \u2014 medium cards, condensed, evidence on tap', compactHtml());
  PAGES['/small'] = page('OPTION C \u2014 small cards, 56px tile', smallHtml({}));
  PAGES['/smallr'] = page('OPTION C1 \u2014 small cards + category icon at the RIGHT edge, badge keeps the WORD',
    smallHtml({ rightIcon: true, wordOnly: true }));
  PAGES['/smallr2'] = page('OPTION C2 \u2014 small cards + right icon, badge keeps glyph AND word',
    smallHtml({ rightIcon: true }));

  // Standalone copies so the mockup can be opened WITHOUT this script running.
  // Everything is inlined -- the CSS, and the bird tiles as data-URI SVG -- so
  // a file:// open is the same picture as the capture.
  for (const [route, file] of [['/current', 'current'], ['/proposed', 'optionA'],
                               ['/compact', 'optionB'], ['/small', 'optionC'],
                               ['/smallr', 'optionC1'], ['/smallr2', 'optionC2']]) {
    fs.writeFileSync(path.join(HERE, 'alertfeed-' + file + '.html'), PAGES[route]);
  }
  // ⚠️ ONLY C1 vs C2. Owner: *"Do not show B or C or original"* — a comparison
  // that shows five things the reader has already rejected makes the two live
  // options harder to tell apart, not easier.
  //
  // The detail strip exists because the honest answer to *"what's the
  // difference"* is ONE GLYPH PER BADGE, and at 393px that is nearly invisible
  // — which is itself the argument for C1.
  const demoRow = (label, badgeHtml) =>
    '<div class="demo"><div class="dl">' + label + '</div>'
    + '<div class="dbox"><span class="abadge ab-mega">' + badgeHtml + '</span>'
    + '<b>First state record</b> \u00b7 found today</div></div>';
  fs.writeFileSync(path.join(HERE, 'alertfeed-compare.html'),
    '<!doctype html><meta charset="utf-8"><title>Alert feed \u2014 C1 vs C2</title>'
    + '<style>' + PROPOSED_CSS + SMALL_CSS + '</style>'
    + '<style>body{margin:0;background:#20232a;color:#fff;font:14px/1.4 system-ui}'
    + 'h1{font-size:17px;margin:0;padding:14px 18px;background:#111}'
    + 'h1 small{font-weight:400;color:#b9bec9;display:block;margin-top:5px;font-size:13px}'
    + '.strip{padding:16px 18px;background:#2b2f38}'
    + '.demo{margin-bottom:12px}'
    + '.dl{font-size:12px;font-weight:800;letter-spacing:.06em;color:#b9bec9;margin-bottom:5px}'
    + '.dbox{background:#fff;color:#111;border-radius:8px;padding:12px 14px;'
    + 'font-size:20px;line-height:1.5}'
    + '.dbox .abadge{font-size:16px;padding:3px 10px 3px 8px}'
    + '.row{display:flex;gap:22px;padding:18px;align-items:flex-start;overflow-x:auto}'
    + '.pane{flex:0 0 auto}'
    + '.cap{font-weight:700;padding:0 0 8px;font-size:13.5px}'
    + '.cap i{display:block;font-style:normal;font-weight:400;color:#b9bec9}'
    + 'iframe{border:0;width:' + WIDTH + 'px;height:1250px;background:#fff;border-radius:10px}'
    + '</style>'
    + '<h1>Alert feed \u2014 C1 vs C2, at ' + WIDTH + 'px'
    + '<small>The ONLY difference is the badge on each row: C1 prints the word, '
    + 'C2 repeats the glyph that is already at the right edge. '
    + 'Both are 1174px tall. Enlarged below so it is actually visible.</small></h1>'
    + '<div class="strip">'
    + demoRow('C1 \u2014 badge is the WORD (glyph lives only at the right edge)', 'MEGA')
    + demoRow('C2 \u2014 badge REPEATS the glyph', '\u26D4 MEGA')
    + '</div>'
    + '<div class="row">'
    + '<div class="pane"><div class="cap">OPTION C1 \u2014 recommended<i>no duplicated glyph</i></div>'
    + '<iframe src="alertfeed-optionC1.html"></iframe></div>'
    + '<div class="pane"><div class="cap">OPTION C2<i>glyph on the row and at the edge</i></div>'
    + '<iframe src="alertfeed-optionC2.html"></iframe></div>'
    + '</div>');

  if (process.argv.includes('--html-only')) { console.log('  wrote HTML only'); process.exit(0); }
  if (!CHROME) { console.error('no Chrome'); process.exit(2); }

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'afmock-'));
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--window-size=' + (WIDTH + 500) + ',1200', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  const kill = () => { try { spawnSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {} };

  const portFile = path.join(profile, 'DevToolsActivePort');
  let wsUrl = null;
  for (let i = 0; i < 120 && !wsUrl; i++) {
    try {
      const t = fs.readFileSync(portFile, 'utf8').split('\n');
      if (t.length >= 2 && t[0].trim()) wsUrl = 'ws://127.0.0.1:' + t[0].trim() + t[1].trim();
    } catch (e) { /* not up yet */ }
    if (!wsUrl) await new Promise((r) => setTimeout(r, 250));
  }
  if (!wsUrl) { kill(); throw new Error('Chrome never wrote DevToolsActivePort'); }

  const c = cdp(wsUrl);
  await c.ready;
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  await c.send('Page.enable', {}, sessionId);
  await c.send('Runtime.enable', {}, sessionId);

  for (const which of ['current', 'proposed', 'compact', 'small', 'smallr', 'smallr2']) {
    // ⚠️ THE HARNESS MUST BE SAME-ORIGIN. A `data:` URL is an opaque origin,
    // so `frame.contentDocument` reads as null and every measurement silently
    // returns undefined — which is how both shots first came out at the same
    // fallback height with an empty overflow report. A check that cannot see
    // its subject reports success by never looking.
    PAGES['/__harness-' + which] = '<body style="margin:0;background:#fff">'
      + '<iframe id="f" style="border:0;width:' + WIDTH + 'px;height:3000px" src="/'
      + which + '"></iframe></body>';
    await c.send('Page.navigate',
      { url: 'http://127.0.0.1:' + port + '/__harness-' + which }, sessionId);
    await new Promise((r) => setTimeout(r, 1800));
    const hr = await c.send('Runtime.evaluate', {
      expression: `(function(){var f=document.getElementById('f');
        if(!f||!f.contentDocument) return 'CROSS-ORIGIN';
        f.style.height='0px';
        var h=Math.max(600, f.contentDocument.documentElement.scrollHeight);
        f.style.height=h+'px'; return h;})()`,
      returnByValue: true }, sessionId);
    if (hr.result.value === 'CROSS-ORIGIN') throw new Error('harness is cross-origin');
    const h = Number(hr.result.value);
    if (!h) throw new Error('could not measure ' + which + ': ' + hr.result.value);
    await new Promise((r) => setTimeout(r, 400));
    const png = await c.send('Page.captureScreenshot', {
      format: 'png', clip: { x: 0, y: 0, width: WIDTH, height: h, scale: 2 },
      captureBeyondViewport: true }, sessionId);
    const out = path.join(HERE, 'alertfeed-' + which + '-' + WIDTH + 'px.png');
    fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
    console.log('  wrote ' + path.basename(out) + '  (' + WIDTH + ' x ' + h + ' css px)');

    // ⚠️ Prove the layout width, because the whole reason this file exists is
    // that --window-size lies about it (F232). Also report the MEASURED tile
    // size: "the image seems large for a small card" is a question with a
    // number behind it, and eyeballing a 2x PNG is how you get it wrong.
    const chk = await c.send('Runtime.evaluate', {
      expression: `(function(){var d=document.getElementById('f').contentDocument;
        var over=[];
        Array.prototype.forEach.call(d.querySelectorAll('*'), function(el){
          var r=el.getBoundingClientRect();
          if (r.width && (r.left < -0.5 || r.right > ${WIDTH} + 0.5)) over.push(
            (typeof el.className==='string'&&el.className||el.tagName)
            +' '+Math.round(r.left)+'..'+Math.round(r.right));
        });
        var t=d.querySelector('.thumb'), ts='';
        if (t) { var tr=t.getBoundingClientRect();
          ts=' · tile '+Math.round(tr.width)+'x'+Math.round(tr.height)+'px'
             +' ('+(100*tr.width/${WIDTH}).toFixed(0)+'% of width)'; }
        var li=d.querySelector('.obs > li'), ls='';
        if (li) ls=' · row '+Math.round(li.getBoundingClientRect().height)+'px';
        return 'laid out at ' + d.documentElement.clientWidth + 'px' + ts + ls + ' · '
          + (over.length ? over.length + ' OVERFLOW: ' + over.slice(0,6).join(' | ')
                         : 'nothing overflows');})()`,
      returnByValue: true }, sessionId);
    console.log('    ' + chk.result.value);
  }

  kill();
  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

