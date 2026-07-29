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
test('no top-level function name is declared twice in index.html', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const seen = new Map();
  const dupes = [];
  blocks.forEach((code) => {
    const decls = [...code.matchAll(/^([ \t]*)function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
      .map((m) => ({ indent: m[1].length, name: m[2] }));
    if (!decls.length) return;
    // Only the outermost level shares one scope; a helper nested inside another
    // function is free to reuse a name.
    const top = Math.min(...decls.map((d) => d.indent));
    decls.filter((d) => d.indent === top).forEach((d) => {
      if (seen.has(d.name)) dupes.push(d.name);
      else seen.set(d.name, true);
    });
  });
  assert.deepEqual(dupes, [],
    'these function names are declared more than once: ' + dupes.join(', '));
});
