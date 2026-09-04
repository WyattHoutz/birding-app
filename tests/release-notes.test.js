'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const notes = require('../assets/release-notes.js');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'ios-build.yml'), 'utf8');

test('F307 release notes keep human prose and remove the trailer block', () => {
  const body = [
    'Stakeout bird now searches parent regions.',
    '',
    'Nemesis birds retries a failed first open.',
    '',
    'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
    '',
    'Copilot-Session: f96533f1-c2a7-43fd-a9bf-6b4bd8d32fd3',
    '',
  ].join('\n');
  assert.equal(notes.humanReleaseNotes(body),
    'Stakeout bird now searches parent regions.\n\n'
    + 'Nemesis birds retries a failed first open.');
});

test('F307 a trailer-only commit body cannot create a public Release', () => {
  const trailerOnly = [
    'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
    '',
    'Copilot-Session: f96533f1-c2a7-43fd-a9bf-6b4bd8d32fd3',
  ].join('\n');
  assert.throws(() => notes.humanReleaseNotes(trailerOnly),
    /only commit trailers.*human-readable commit body/i);
  assert.throws(() => notes.humanReleaseNotes(' \n\n'), /only commit trailers/i,
    'a blank body is the same public failure and must fail closed');
  assert.equal(notes.humanReleaseNotes('Why: this is explanatory prose.'),
    'Why: this is explanatory prose.',
  'ordinary colon-bearing prose is not mistaken for a trailer');
});

test('F307 the workflow validates notes before appending the artifact footer', () => {
  const stepStart = WORKFLOW.indexOf('- name: Write the release notes from the commit');
  const createStart = WORKFLOW.indexOf('- name: Create the Release', stepStart);
  assert.ok(stepStart >= 0 && createStart > stepStart, 'release-note steps are present');
  const step = WORKFLOW.slice(stepStart, createStart);

  assert.match(step, /git log -1 --pretty=%b > \.release-body/,
    'the exact commit body is still the input');
  assert.match(step,
    /node assets\/release-notes\.js \.release-body \.release-notes/,
    'CI does not run the trailer-only validator');
  assert.doesNotMatch(step, /git log -1 --pretty=%b > \.release-notes/,
    'the unvalidated commit body still goes directly to the public Release');

  const validatorAt = step.indexOf('node assets/release-notes.js');
  const footerAt = step.indexOf('The \\`.ipa\\` below is UNSIGNED');
  assert.ok(validatorAt >= 0 && footerAt > validatorAt,
    'the artifact footer must be appended after validated human notes');
  assert.match(step, /the commit this Release points at\. Sideload with AltStore\./,
    'the existing artifact identity/install footer was lost');

  const create = WORKFLOW.slice(createStart);
  assert.match(create, /--notes-file \.release-notes/,
    'gh release create does not publish the validated notes file');
});
