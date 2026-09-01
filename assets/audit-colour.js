#!/usr/bin/env node
/**
 * Colour-vision audit for the alert-feed palette.
 *
 * WHY THIS IS A GUARD AND NOT A ONE-OFF CHECK
 * -------------------------------------------
 * A palette drifts. Someone tweaks a hex to "make mega pop" and the fact that
 * it was once measured is worth nothing — this repo has paid for that pattern
 * repeatedly (F165, F197, F245, F259: a guard broken by a change nowhere near
 * it). So the rule is asserted, and the run fails when it stops holding.
 *
 * WHAT IT ASSERTS
 * ---------------
 *   1. Every text/background pair clears WCAG AA 4.5:1 for small text, under
 *      NORMAL vision and under simulated protanopia, deuteranopia AND
 *      tritanopia.
 *   2. Every border/background pair clears 3:1 (WCAG non-text contrast), same
 *      three simulations.
 *   3. The five categories are separable WITHOUT colour at all: distinct
 *      border STYLE and distinct WORD.
 *
 * ⚠️ SEVERITY. The owner reports MODERATE deuteranomaly, not dichromacy. This
 * simulates full dichromacy anyway, deliberately: dichromacy is the limiting
 * case of anomalous trichromacy, so a pair that survives it survives every
 * milder severity. Testing the stated severity instead would need
 * severity-scaled Machado coefficients, and inventing numbers I cannot verify
 * to describe someone's vision is worse than testing a bound I can defend.
 *
 * ⚠️ THE EMOJI GLYPHS ARE NOT TESTABLE HERE and that is the point of rule 3.
 * Their colours come from the system font, not from our stylesheet — measured
 * on the render, the red ring of ⛔ against #D55E00 was 1.00 under simulated
 * deuteranopia, i.e. the same colour. We cannot control those pixels, so no
 * meaning may rest on them: the word and the border style carry it, and the
 * tile background is held near-white so a glyph has the best chance available.
 *
 *   node alertfeed-a11y.js
 */
'use strict';

// ---------------------------------------------------------------- colour
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function unlin(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
function lum(p) { return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]); }
function ratio(a, b) {
  let l1 = lum(a), l2 = lum(b);
  if (l1 < l2) { const t = l1; l1 = l2; l2 = t; }
  return (l1 + 0.05) / (l2 + 0.05);
}
function hx(s) {
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

// Brettel/Vienot-style dichromacy matrices, applied in linear RGB.
const M = {
  protan: [0.170556992, 0.829443014, 0, 0.170556991, 0.829443008, 0, -0.004517144, 0.004517144, 1],
  deutan: [0.33066007, 0.66933993, 0, 0.33066007, 0.66933993, 0, -0.02785538, 0.02785538, 1],
  tritan: [1, 0.1273989, -0.1273989, 0, 0.8739093, 0.1260907, 0, 0.8739093, 0.1260907],
};
function sim(p, kind) {
  if (kind === 'normal') return p;
  const m = M[kind], r = lin(p[0]), g = lin(p[1]), b = lin(p[2]);
  return [clamp(unlin(m[0] * r + m[1] * g + m[2] * b) * 255),
          clamp(unlin(m[3] * r + m[4] * g + m[5] * b) * 255),
          clamp(unlin(m[6] * r + m[7] * g + m[8] * b) * 255)];
}
const VIEWS = ['normal', 'protan', 'deutan', 'tritan'];

// ---------------------------------------------------------------- palette
// Kept in ONE place and read by both the mockup and this audit, so a colour
// cannot be changed in the design without the audit seeing it.
const PAGE_BG = '#ffffff';
const KINDS = {
  mega:    { word: 'MEGA',        border: 'solid',  ink: '#ffffff', fill: '#9E4400',
             badgeBorder: '#9E4400', tileBg: '#FFF3EA', tileBorder: '#9E4400' },
  need:    { word: 'YOU NEED IT', border: 'double', ink: '#005B8F', fill: '#ffffff',
             badgeBorder: '#005B8F', tileBg: '#EFF7FC', tileBorder: '#005B8F' },
  crowd:   { word: 'CROWD',       border: 'dashed', ink: '#111111', fill: '#ffffff',
             badgeBorder: '#111111', tileBg: '#ffffff', tileBorder: '#111111' },
  cascade: { word: 'CASCADE',     border: 'dotted', ink: '#6B4400', fill: '#ffffff',
             badgeBorder: '#B37400', tileBg: '#ffffff', tileBorder: '#6B4400' },
  hotspot: { word: 'HOTSPOT',     border: 'ridge',  ink: '#333333', fill: '#f1f1f4',
             badgeBorder: '#6E6E78', tileBg: '#f4f4f6', tileBorder: '#6E6E78' },
};

const TEXT_MIN = 4.5;   // WCAG AA, small text
const OBJ_MIN = 3.0;    // WCAG non-text contrast

const problems = [];
const rows = [];

function check(label, fg, bg, min) {
  const r = {};
  let worst = Infinity, worstView = '';
  for (const v of VIEWS) {
    const val = ratio(sim(hx(fg), v), sim(hx(bg), v));
    r[v] = val;
    if (val < worst) { worst = val; worstView = v; }
  }
  rows.push({ label, fg, bg, min, r, worst, worstView });
  if (worst < min) {
    problems.push(label + ': ' + worst.toFixed(2) + ':1 under ' + worstView
      + ' (needs ' + min + ':1) — ' + fg + ' on ' + bg);
  }
}

for (const [k, c] of Object.entries(KINDS)) {
  check('badge text  ' + k, c.ink, c.fill, TEXT_MIN);
  // ⚠️ The badge's visible EDGE is its border, not its fill. Checking the fill
  // reported hotspot at 1.13:1 and called it a failure while the real 2px
  // border was clearing 3:1 comfortably — an instrument measuring the wrong
  // property, which is the same class of error as the <img class="tn"> tile.
  check('badge edge  ' + k, c.badgeBorder, PAGE_BG, OBJ_MIN);
  check('tile border ' + k, c.tileBorder, c.tileBg, OBJ_MIN);
  check('tile edge   ' + k, c.tileBorder, PAGE_BG, OBJ_MIN);
}

// ---- rule 3: separable with NO colour at all -----------------------------
const styles = Object.values(KINDS).map((c) => c.border);
const words = Object.values(KINDS).map((c) => c.word);
if (new Set(styles).size !== styles.length) {
  problems.push('border styles are not unique (' + styles.join(', ')
    + ') — shape is the channel that survives any colour vision');
}
if (new Set(words).size !== words.length) {
  problems.push('category words are not unique (' + words.join(', ') + ')');
}
// A tile background must stay near-white, because the emoji inside it is
// system-coloured and we cannot measure or control it.
for (const [k, c] of Object.entries(KINDS)) {
  if (lum(hx(c.tileBg)) < 0.75) {
    problems.push('tile background for ' + k + ' is ' + c.tileBg
      + ', too dark to host a system-coloured emoji safely');
  }
}

// ---------------------------------------------------------------- report
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('pair', 20) + pad('normal', 9) + pad('protan', 9)
  + pad('deutan', 9) + pad('tritan', 9) + 'min');
console.log('-'.repeat(64));
for (const r of rows) {
  const mark = r.worst < r.min ? ' FAIL' : '';
  console.log(pad(r.label, 20)
    + VIEWS.map((v) => pad(r.r[v].toFixed(2), 9)).join('')
    + r.min + mark);
}
console.log('');
console.log('border styles : ' + styles.join(' / '));
console.log('words         : ' + words.join(' / '));
console.log('');
if (problems.length) {
  console.log('FAILED — ' + problems.length + ' problem(s):');
  problems.forEach((p) => console.log('  ' + p));
  process.exit(1);
}
console.log('ok   every pair clears its threshold under normal, protan, deutan and tritan,');
console.log('     and the five categories are separable with no colour at all');
