'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { instrument, install } = require('../native/ios/install-hidden-window-diagnostics');

const ROOT = path.join(__dirname, '..');
const RELATIVE = path.join('node_modules', '@capgo', 'capacitor-inappbrowser',
  'ios', 'Sources', 'InAppBrowserPlugin', 'InAppBrowserPlugin.swift');
const source = fs.readFileSync(path.join(ROOT, RELATIVE), 'utf8');

test('F995 instrumentation preserves first-foreground/key-window selection and exposes only state/count metadata at rejection and success', () => {
  const patched = instrument(source);
  assert.match(patched, /let selected = foreground\.first\s+let window = selected\?\.windows\.first \{ \$0\.isKeyWindow \}/);
  assert.match(patched, /foreground = scenes\.filter \{\s+\$0\.activationState == \.foregroundActive \|\| \$0\.activationState == \.foregroundInactive/);
  const fields = /birdChaserWindowState = \[([\s\S]*?)\n        \]/.exec(patched);
  assert.ok(fields, 'the actual selection must capture its native state');
  assert.deepEqual([...fields[1].matchAll(/"([A-Za-z]+)":/g)].map(match => match[1]).sort(), [
    'applicationState', 'atMs', 'bridgeWindowAttached', 'foregroundKeySceneCount',
    'foregroundSceneCount', 'onMainThread', 'sceneCount', 'selectedKeyWindowCount',
    'selectedSceneState', 'selectedWindowCount', 'windowFound',
  ].sort(), 'no scene identifier, URL, account, title or other private field may be serialized');
  assert.match(patched,
    /if !self\.attachWebViewToWindow\(webView\) \{\s+call\.reject\("Failed to get active window for hidden webview", "BC_HIDDEN_WINDOW", nil, \["windowState": self\.birdChaserWindowState\]\)\s+return/);
  assert.match(patched,
    /if hidden \{\s+call\.resolve\(\["id": webViewId, "windowState": self\.birdChaserWindowState\]\)\s+\} else \{\s+call\.resolve\(\["id": webViewId\]\)/);
  assert.equal(instrument(patched), patched, 'repeated native setup must be idempotent');
  assert.throws(() => instrument(patched.replace('"windowFound": window != nil,', '')),
    /Incomplete.*instrumentation/, 'an incomplete prior patch must fail closed');
});

test('F995 installer patches the actual dependency and rejects upstream selection or rejection drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-window-native-'));
  try {
    const target = path.join(root, RELATIVE);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
    install(root);
    assert.equal(fs.readFileSync(target, 'utf8'), instrument(source));
    install(root);
    assert.equal(fs.readFileSync(target, 'utf8'), instrument(source));
    assert.throws(() => instrument(source.replace('private func activeWindow()', 'private func renamedWindow()')),
      /exactly one native window selection|Incomplete.*instrumentation/);
    assert.throws(() => instrument(source.replace(
      /call\.reject\("Failed to get active window for hidden webview"[^\n]*/,
      'call.reject("changed upstream rejection")')),
    /exactly one hidden-open rejection|Incomplete.*instrumentation/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F995 CI instruments the dependency after sync, before compilation, and checks the built binary', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ios-build.yml'), 'utf8');
  const setup = workflow.indexOf('node native/ios/install-hidden-window-diagnostics.js');
  assert.ok(setup > workflow.indexOf('run: npx cap sync ios'));
  assert.ok(setup < workflow.indexOf('xcodebuild'));
  assert.match(workflow, /grep -q 'BC_HIDDEN_WINDOW' build\/full-report-symbols\.txt/);
});
