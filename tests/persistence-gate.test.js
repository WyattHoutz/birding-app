'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeJavaScript, analyzeSwift, analyzeHtml } = require('../assets/check-persistence.js');

test('persistence gate rejects direct and disguised storage writes and reads', () => {
  for (const source of [
    'localStorage.setItem("cache", JSON.stringify({rows:[]}));',
    'window["localStorage"]["setItem"]("cache", "data");',
    'const store = localStorage; store.setItem("cache", "data");',
    'const { setItem: write } = localStorage; write("cache", "data");',
    'const write = localStorage.setItem.bind(localStorage); write("cache", "data");',
    'const method = "set" + "Item"; localStorage[method]("cache", "data");',
    'let write = localStorage.setItem; write("cache", "data"); write = function(){};',
    'let write = function(){}; write = localStorage.setItem; write("cache", "data");',
    'function save(store) { store.setItem("cache", "data"); }',
    'Reflect.apply(localStorage.setItem, localStorage, ["cache", "data"]);',
    'const {setItem: write} = localStorage; Reflect.apply(write, localStorage, ["cache", "data"]);',
    'localStorage[window.method]("cache", "data");',
    'JSON.parse(localStorage.getItem("cache"));',
    'storeWithReclaim("cache", JSON.stringify({rows:[]}));'
  ]) {
    assert.ok(analyzeJavaScript(source).length > 0, source);
  }
});

test('persistence gate permits scalar settings but rejects JSON hidden under a scalar key', () => {
  assert.deepEqual(analyzeJavaScript('localStorage.setItem(THEME_KEY, "dark");'), []);
  assert.deepEqual(analyzeJavaScript('localStorage.getItem(THEME_KEY);'), []);
  assert.equal(analyzeJavaScript('localStorage.setItem(THEME_KEY, JSON.stringify({rows:[]}));').length, 1);
  assert.equal(analyzeJavaScript('const payload = JSON.stringify({rows:[]}); localStorage.setItem(THEME_KEY, payload);').length, 1);
  assert.equal(analyzeJavaScript('function zcGet() { localStorage.setItem("cache", "{}"); }').length, 1);
  assert.equal(analyzeJavaScript('localStorage.setItem(" ebird_api_key ", "secret");').length, 1);
  assert.deepEqual(analyzeJavaScript('// localStorage.setItem("cache", "{}");\nconst text = "localStorage.setItem";'), []);
});

test('persistence gate recognizes only the reviewed storage adapter boundaries', () => {
  const adapter = 'var _persistence = { text: { read: function(key) { return localStorage.getItem(key); },'
    + ' write: function(key, payload, details) { return storeWithReclaim(key, payload, details); } } };';
  assert.deepEqual(analyzeJavaScript(adapter), []);
  assert.equal(analyzeJavaScript(adapter, 'www/other.js').length, 2);
  assert.equal(analyzeJavaScript('function copy() { return storeWithReclaim("cache", "data"); }').length, 1);
  assert.equal(analyzeJavaScript('idbWriteRaw("image", {});').length, 1);
  assert.equal(analyzeJavaScript(adapter.replace('key, payload, details);',
    'key, JSON.stringify({rows:[]}), details);')).length, 1);
  assert.equal(analyzeJavaScript(
    'function storeWithReclaim(key, payload) { localStorage.setItem(key, JSON.stringify({rows:[]})); }').length, 1);
  assert.equal(analyzeJavaScript(
    'BirdPersistence.create({codec:{pack:JSON.stringify,unpack:JSON.parse},text:{}});').length, 1);
  assert.deepEqual(analyzeJavaScript(
    'BirdPersistence.create({codec:{pack:packJson,unpack:unpackJson},text:{}});'), []);
  assert.deepEqual(analyzeJavaScript('BirdPersistence.create({text:{}});', 'www/audit-log.js'), []);
  assert.deepEqual(analyzeJavaScript(
    'BirdPersistence.create({text:BirdPersistence.indexedDb({})});', 'www/audit-log.js'), []);
  for (const source of [
    'const raw = BirdPersistence.indexedDb({}); raw.write("key", "{}");',
    'const P = BirdPersistence; const raw = P.indexedDb({}); raw.write("key", "{}");',
    'const factory = BirdPersistence.indexedDb; factory({});',
    'const {indexedDb: factory} = BirdPersistence; factory({});'
  ]) assert.ok(analyzeJavaScript(source, 'www/audit-log.js').length, source);
});

test('persistence gate catches IndexedDB payloads outside the reviewed JSON and binary backends', () => {
  for (const source of [
    'db.transaction("store").objectStore("rows").put({rows:[]}, "key");',
    'const store = tx.objectStore("rows"); store.put({rows:[]}, "key");',
    'const store = tx.objectStore("rows"); store.get("key");',
    'const store = tx.objectStore("rows"); store.getAll();'
  ]) assert.equal(analyzeJavaScript(source).length, 1, source);
  assert.deepEqual(analyzeJavaScript(
    'function idbWriteRaw(key, blob) { tx.objectStore("img").put(blob, key); }'), []);
  assert.equal(analyzeJavaScript(
    'function idbWriteRaw(key, blob) { tx.objectStore("img").put(blob, key); }', 'www/other.js').length, 1);
  assert.equal(analyzeJavaScript(
    'function idbWriteRaw(key, blob) { tx.objectStore("img").put({rows:[]}, key); }').length, 1);
  assert.equal(analyzeJavaScript(
    'persistence.putBinary("cache", new Blob([JSON.stringify({rows:[]})]));').length, 1);
  assert.equal(analyzeJavaScript(
    'const encoded = new TextEncoder().encode(JSON.stringify({rows:[]})); persistence.putBinary("cache", encoded);').length, 1);
  assert.deepEqual(analyzeJavaScript(
    'persistence.putBinary("photo", new Uint8Array([1,2,3]));'), []);
  const json = 'function commit() { const store=tx.objectStore("json"); store.put(row); }';
  assert.deepEqual(analyzeJavaScript(json, 'www/persistence.js'), []);
  assert.deepEqual(analyzeJavaScript(json.replace('store.put(row)', 'store.put(row,key)'),
    'www/persistence.js'), []);
  assert.equal(analyzeJavaScript(json, 'www/other.js').length, 1);
  assert.equal(analyzeJavaScript(json.replace('store.put(row)', 'store.put({raw:[]})'),
    'www/persistence.js').length, 1);
});

test('persistence gate covers native JSON files and traces without gzip-wrapping binary exports or Keychain', () => {
  assert.equal(analyzeSwift('func write() { try JSONEncoder().encode(value).write(to: url) }',
    'native/ios/BirdGenNotifications.swift').length, 1);
  assert.equal(analyzeSwift('func record() { let data = try JSONEncoder().encode(entries); defaults.set(data, forKey: key) }',
    'native/ios/BirdGenNotifications.swift').length, 1);
  assert.equal(analyzeSwift('func read() { return try JSONDecoder().decode(T.self, from: Data(contentsOf: url)) }',
    'native/ios/BirdGenNotifications.swift').length, 1);
  assert.deepEqual(analyzeSwift('func createReportPDF() { try image.jpegData().write(to: url) }',
    'native/ios/ViewController.swift'), []);
  assert.equal(analyzeSwift('func write() { try Data(payload.utf8).write(to: url) }',
    'native/ios/BirdGenNotifications.swift').length, 1);
  assert.equal(analyzeSwift('func read() { return defaults.data(forKey: key) }',
    'native/ios/BirdGenNotifications.swift').length, 1);
  assert.equal(analyzeSwift('func write() { defaults.set(data, forKey: key) }',
    'native/ios/BirdGenNotifications.swift').length, 1);
  assert.deepEqual(analyzeSwift('func saveConfigurations() { let data = try JSONEncoder().encode(value); SecItemUpdate(query, [kSecValueData: data]) }',
    'native/ios/BirdGenNotifications.swift'), []);
  assert.equal(analyzeSwift('func saveConfigurations() { let data = try JSONEncoder().encode(value); defaults.set(data, forKey: key) }',
    'native/ios/BirdGenNotifications.swift').length, 1);
});

test('persistence gate fails closed on unsupported syntax', () => {
  assert.equal(analyzeJavaScript('localStorage.setItem(')[0].operation, 'unparsed-runtime-source');
});

test('persistence gate parses actual HTML script types rather than guessing from unrelated attributes', () => {
  const code = 'localStorage.setItem("cache", "{}");';
  assert.equal(analyzeHtml('<script data-ref="application/json">' + code + '</script>', 'www/index.html').length, 1);
  assert.deepEqual(analyzeHtml('<script type="application/json">{"rows":[]}</script>', 'www/index.html'), []);
  assert.equal(analyzeHtml('<script type="module">export const value = localStorage.getItem("cache");</script>',
    'www/index.html').length, 1);
  assert.deepEqual(analyzeHtml('<script type="module">export const value = 1;</script>', 'www/index.html'), []);
});

test('persistence gate blocks the normal test command and both IPA delivery channels', () => {
  const root = path.join(__dirname, '..');
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts.pretest, 'npm run check:persistence');
  assert.equal(scripts['check:persistence'], 'node assets/check-persistence.js');
  for (const name of ['ios-build.yml', 'testflight.yml']) {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8');
    const gate = workflow.indexOf('run: npm run check:persistence');
    assert.ok(gate > workflow.indexOf('run: npm ci'), name + ': gate must run after dependencies exist');
    const delivery = name === 'ios-build.yml' ? workflow.indexOf('run: npx cap sync ios')
      : workflow.indexOf('run: node assets/testflight.js');
    assert.ok(gate < delivery, name + ': gate must run before preparing or signing the IPA');
    if (name === 'testflight.yml') {
      const step = workflow.slice(workflow.lastIndexOf('- name:', gate), gate);
      assert.match(step, /working-directory: source/, 'signing must inspect the selected source, not delivery tooling');
    }
  }
});
