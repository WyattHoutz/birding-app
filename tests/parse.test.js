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
