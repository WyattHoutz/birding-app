#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const TRAILER = /^(?:Co-authored-by|Copilot-Session|Signed-off-by|Reviewed-by|Tested-by|Acked-by|Reported-by|Helped-by|Fixes|Closes|Refs):\s+\S/i;

function humanReleaseNotes(commitBody) {
  const lines = String(commitBody || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1];
    if (!line.trim() || TRAILER.test(line.trim())) {
      end--;
      continue;
    }
    break;
  }

  const human = lines.slice(0, end).join('\n').trim();
  if (!human) {
    throw new Error(
      'Release notes contain only commit trailers. Add a human-readable '
      + 'commit body before Co-authored-by/Copilot-Session trailers.');
  }
  return human;
}

function main(argv) {
  const input = argv[2];
  const output = argv[3];
  if (!input || !output) {
    console.error('usage: node assets/release-notes.js <commit-body> <notes-output>');
    return 2;
  }
  try {
    const notes = humanReleaseNotes(fs.readFileSync(input, 'utf8'));
    fs.writeFileSync(output, notes + '\n', 'utf8');
    console.log('release notes: ' + notes.split('\n').filter(Boolean).length
      + ' human-readable line(s)');
    return 0;
  } catch (e) {
    console.error('release notes: ' + (e && e.message || e));
    return 1;
  }
}

module.exports = { TRAILER, humanReleaseNotes, main };

if (require.main === module) process.exitCode = main(process.argv);
