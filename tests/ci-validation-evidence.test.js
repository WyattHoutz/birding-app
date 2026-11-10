'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { snapshot } = require('../assets/ci-validation-evidence');

test('benchmark inputs detect actual source, catalog and installed dependency changes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-inputs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  const write = (name, value) => fs.writeFileSync(path.join(root, name), value);
  write('package.json', JSON.stringify({ scripts: {
    test: 'node --test tests/*.test.js', 'test:layout': 'node layout.js',
  } }));
  write(path.join('tests', 'first.test.js'), 'test fixture');
  write(path.join('node_modules', 'dependency.js'), 'installed dependency');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '--', 'package.json', 'tests'], { cwd: root });
  const before = snapshot(root);
  assert.deepEqual(snapshot(root), before);
  write('benchmark-before.json', '{"evidence":true}');
  assert.deepEqual(snapshot(root), before, 'evidence output cannot become a test input');
  write('benchmark-live.js', 'untracked source');
  assert.notEqual(snapshot(root).sourceFiles, before.sourceFiles,
    'the evidence exclusion cannot hide arbitrary benchmark-prefixed source');
  fs.rmSync(path.join(root, 'benchmark-live.js'));
  write(path.join('tests', 'first.test.js'), 'changed source');
  assert.notEqual(snapshot(root).sourceFiles, before.sourceFiles);
  write(path.join('tests', 'first.test.js'), 'test fixture');
  write(path.join('node_modules', 'dependency.js'), 'different installed dependency');
  assert.notEqual(snapshot(root).dependencies, before.dependencies);
  write(path.join('tests', 'second.test.js'), 'new test');
  assert.deepEqual(snapshot(root).catalog, ['tests/first.test.js', 'tests/second.test.js']);
});
