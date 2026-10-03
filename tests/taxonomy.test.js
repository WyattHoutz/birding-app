'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Tax = require(path.join(process.env.BIRDCHASER_WWW || path.join(__dirname, '..', 'www'), 'taxonomy.js'));
const row = (code, name, extra = {}) => ({
  speciesCode: code, comName: name, sciName: 'Synthetic ' + code, category: 'species', ...extra,
});
test('F735 chooses the official latest flag, never the clock or largest guessed edition', () => {
  assert.equal(Tax.latestEdition([{ authorityVer: 2024, latest: false },
    { authorityVer: 2025, latest: true }, { authorityVer: 2026, latest: false }]), '2025.0');
  assert.throws(() => Tax.latestEdition([{ authorityVer: 2026 }]), /unambiguous/);
  assert.throws(() => Tax.latestEdition([{ authorityVer: 2024, latest: true },
    { authorityVer: 2025, latest: true }]), /unambiguous/);
  assert.throws(() => Tax.editionKey('tomorrow'), /Unreadable/);
});
test('F735 stable codes and rename-only changes are safe; parent/split/lump/unknown identities remain unresolved', () => {
  const previous = Tax.create([row('stable', 'Stable'), row('rename', 'Old name'),
    row('form', 'Form', { category: 'issf', reportAs: 'stable' }),
    row('splitold', 'Old broad species'), row('lumpold', 'Old separate species')], '2024.0');
  const next = Tax.create([row('stable', 'Stable'), row('rename', 'New name'),
    row('newparent', 'New parent'), row('form', 'Form', { category: 'issf', reportAs: 'newparent' }),
    row('splitnewa', 'New species A'), row('splitnewb', 'New species B')], '2025.0');
  assert.deepEqual(Tax.impact(previous, next,
    ['stable', 'stable', 'rename', 'form', 'splitold', 'lumpold', 'unknown']), {
    stable: ['stable'], renamed: ['rename'], unresolved: ['form', 'lumpold', 'splitold', 'unknown'],
  });
  assert.equal(next.parents.form, 'newparent');
  assert.throws(() => Tax.create([row('form', 'Form', { reportAs: 'missing' })], '2025.0'), /parent chain/);
  assert.throws(() => Tax.create([row('a', 'A', { reportAs: 'b' }),
    row('b', 'B', { reportAs: 'a' })], '2025.0'), /parent chain/);
  for (const field of ['speciesCode', 'sciName', 'category', 'reportAs']) {
    assert.throws(() => Tax.create([row('123', 'Synthetic valid parent'),
      row('bad', 'Malformed row', { [field]: field === 'speciesCode' ? 456 : 123 })],
      '2025.0'), /taxonomy/i, field + ' must not coerce a malformed upstream value');
  }
});
test('F736 localized presentation retains canonical identity and permits explicit missing-name fallback', () => {
  const model = Tax.create([row('stable', 'English name'), row('form', 'English form',
    { category: 'issf', reportAs: 'stable' })], '2025.0');
  const snapshot = JSON.stringify(model);
  const names = Tax.names([row('stable', 'Nom français')], model);
  assert.equal(names.stable, 'Nom français');
  assert.equal(names.form, undefined);
  assert.equal(JSON.stringify(model), snapshot);
  assert.throws(() => Tax.names([row('different', 'Wrong edition')], model), /canonical edition/);
  assert.throws(() => Tax.names([row('stable', ''), row('stable', 'Nom')], model), /canonical edition/);
  assert.deepEqual(Tax.locales([{ code: 'en', name: 'English', lastUpdate: 'dated' },
    { code: 'fr', name: 'French' }, { code: 'en_AU', name: 'English (Australia)' }])
    .map((locale) => locale.code), ['en', 'fr', 'en_AU']);
});
test('F735 cached canonical models validate identity, edition and parent indexes', () => {
  const model = Tax.create([row('stable', 'Stable'), row('other', 'Other valid parent'),
    row('form', 'Form', { reportAs: 'stable' })], '2025.0');
  assert.equal(Tax.validate(model, '2025.0'), model);
  assert.throws(() => Tax.validate(model, '2024.0'), /canonical taxonomy/);
  const corrupt = JSON.parse(JSON.stringify(model));
  corrupt.parents.form = 'other';
  assert.throws(() => Tax.validate(corrupt, '2025.0'), /taxonomy/);
  const cycle = JSON.parse(JSON.stringify(model));
  cycle.byCode.stable.parent = 'form';
  cycle.parents.stable = 'form';
  assert.throws(() => Tax.validate(cycle, '2025.0'), /parent chain/);
});
