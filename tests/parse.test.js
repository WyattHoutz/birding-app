'use strict';
/*
 * parse.test.js — syntax regression guard for the single-file app.
 *
 * index.html is hand-edited and ~2300 lines with two large inline <script>
 * blocks; a stray brace there ships a blank white screen with no build error
 * (Capacitor just copies www/ verbatim). These tests parse every shipped JS
 * surface with `node --check` so a syntax slip fails CI before the .ipa builds.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WWW = path.join(__dirname, '..', 'www');

function checkSyntax(code, label) {
  const tmp = path.join(os.tmpdir(), 'bc-parse-' + process.pid + '-' +
    label.replace(/[^a-z0-9]/gi, '_') + '.js');
  fs.writeFileSync(tmp, code);
  try {
    // Parse-only; undefined DOM globals (document/window/localStorage) are fine.
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } finally {
    fs.unlinkSync(tmp);
  }
}

test('www/logic.js parses', () => {
  checkSyntax(fs.readFileSync(path.join(WWW, 'logic.js'), 'utf8'), 'logic');
});

test('www/seed-birdlist.js parses', () => {
  checkSyntax(fs.readFileSync(path.join(WWW, 'seed-birdlist.js'), 'utf8'), 'seed');
});

test('index.html inline <script> blocks parse', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  // Only bare <script> ... </script> — external <script src="..."></script>
  // tags have an attribute so they never match the attribute-less opener.
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 2, 'found the app\'s inline script blocks (got ' + blocks.length + ')');
  blocks.forEach((code, i) => checkSyntax(code, 'inline' + i));
});

// The whole app is ONE hoisted function scope, so a second `function foo()`
// silently REPLACES the first and the loser fails only at runtime, in whichever
// section happened to call it. That is exactly what a new hotspot-index loader
// did to the Hot hotspots section's loadHotspots(): both parsed, both linted,
// and the section simply stopped working on device.
// A DUPLICATE IS TWO DECLARATIONS IN THE SAME SCOPE — not two at the same
// indentation, and not two at some fixed depth.
//
// This guard used to take the MINIMUM indent in each block as "top level".
// Measured on the app's main script: 708 function declarations, minimum indent
// 2 with **7** functions there, and the real level at indent 6 with **647**. So
// it was checking 1% of the scope it exists to protect, and had been vacuous
// since whoever added the first 2-space helper.
//
// It let a duplicate straight through: an edit anchored mid-function left the
// old head of `spLookupRowsHtml` in place, so the file had two of them. This
// test passed. The file did not even parse.
//
// Depth alone is no better — the app's functions are not all at depth 1, and
// hard-coding whichever depth they happen to sit at today is the same mistake
// with a different constant. So this keeps a STACK of scopes: every `{` pushes
// one, every `}` pops, and a declaration collides only with another in the same
// frame. Nested helpers reusing a name (p2, section, add) sit in different
// frames and are correctly ignored.
//
// Strings, template literals and comments are skipped, because a naive brace
// count is confused by every apostrophe in the file.
function duplicateFunctionNames(code) {
  const dupes = [];
  const stack = [new Set()];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (code.startsWith('function', i)
        && !/[\w$]/.test(code[i - 1] || '')
        && !/[\w$]/.test(code[i + 8] || '')) {
      const m = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(code.slice(i, i + 120));
      if (m) {
        const frame = stack[stack.length - 1];
        if (frame.has(m[1])) dupes.push(m[1]);
        else frame.add(m[1]);
      }
      i += 8; continue;
    }
    if (c === '{') { stack.push(new Set()); i++; continue; }
    if (c === '}') { if (stack.length > 1) stack.pop(); i++; continue; }
    i++;
  }
  return dupes;
}

test('no function name is declared twice in the same scope in index.html', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const dupes = [];
  blocks.forEach((code) => { dupes.push(...duplicateFunctionNames(code)); });
  assert.deepEqual(dupes, [],
    'these function names are declared more than once in one scope: ' + dupes.join(', '));
});

test('the duplicate-function guard can actually see a duplicate', () => {
  // The version this replaced could not, and nothing said so. Mutation built
  // in rather than performed by hand once: a real collision and a legitimate
  // pair of nested helpers, in one fixture.
  const src = 'var x = (function () {\n'
    + '  function a() { function inner() {} return inner; }\n'
    + '  function b() { function inner() {} return inner; }\n'
    + '  var o = { k: 1 };\n'
    + '  function a() {}\n'
    + '}());';
  assert.deepEqual(duplicateFunctionNames(src), ['a'],
    'a real collision is missed, or the nested `inner` helpers are wrongly flagged');

  // An apostrophe inside a string must not throw the brace stack out — that is
  // what defeated the first attempt at counting braces here.
  const quoted = 'var y = (function () {\n'
    + "  function f() { return 'it\\'s { not } a brace'; }\n"
    + '  function f() {}\n'
    + '}());';
  assert.deepEqual(duplicateFunctionNames(quoted), ['f'],
    'a brace inside a string is being counted as scope');
});
