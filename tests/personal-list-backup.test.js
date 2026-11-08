'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../www/personal-list-backup.js');

const watch = [{ code: 'amerob', name: 'American Robin' }];
const favorite = { id: '47.5,-122.2', locId: '', locName: 'Synthetic waypoint',
  lat: '47.5', lng: '-122.2', region: 'US-WA' };

test('F1266 selected JSON round-trips exact identities and coordinate-only metadata', () => {
  const text = backup.encode({ watch, favorites: [favorite] }, { watch: true, favorites: true });
  const parsed = backup.parse(text);
  assert.deepEqual(backup.normalize('favorites', parsed.favorites), [favorite]);
  assert.deepEqual(parsed.watch, watch);
  const subset = backup.parse(backup.encode({ watch }, { watch: true }));
  assert.equal(Object.hasOwn(subset, 'favorites'), false);
  assert.throws(() => backup.parse('{"format":"birdchaser-personal-lists","version":2,"watch":[]}'));
  assert.throws(() => backup.parse('{"format":"birdchaser-personal-lists","version":1,"watch":[],"apiKey":"synthetic"}'));
});

test('F1266 merge preserves existing order and metadata while explicit replacement handles duplicates and empty lists', () => {
  const incoming = { watch: [{ code: 'AMEROB', name: 'Changed' },
    { code: 'chispa', name: 'Chipping Sparrow' }, { code: 'CHISPA', name: 'Duplicate' }] };
  const merge = backup.plan({ watch }, incoming, { watch: true }, 'merge');
  assert.deepEqual(merge.next.watch, watch.concat({ code: 'chispa', name: 'Chipping Sparrow' }));
  assert.equal(merge.stats.watch.duplicates, 1);
  assert.equal(merge.stats.watch.conflicts, 1);
  const replace = backup.plan({ watch }, { watch: [] }, { watch: true }, 'replace');
  assert.deepEqual(replace.next.watch, []);
  assert.equal(replace.stats.watch.removed, 1);
  assert.throws(() => backup.plan({ watch }, { favorites: [] }, { watch: true }, 'merge'));
  assert.throws(() => backup.plan({ watch }, incoming, { watch: true }, 'merge',
    () => { throw new Error('Unknown checked identity'); }), /Unknown checked identity/);
});

test('F1266 malformed identity, coordinates and extra fields cannot enter a restore plan', () => {
  for (const row of [{ ...favorite, lat: 91 }, { ...favorite, lat: '0x1' },
    { ...favorite, id: '1,2' }, { ...favorite, locId: 'L999' },
    { ...favorite, cookie: 'synthetic' }, { ...favorite, lat: false }]) {
    assert.throws(() => backup.normalize('favorites', [row]));
  }
  assert.throws(() => backup.normalize('watch', [{ code: '', name: '' }]));
  assert.throws(() => backup.normalize('watch', [{ code: 'amerob', name: 'Robin', history: [] }]));
  assert.deepEqual(backup.normalize('favorites', [{ ...favorite, id: 'l123', locId: 'l123' }]),
    [{ ...favorite, id: 'L123', locId: 'L123' }]);
});
