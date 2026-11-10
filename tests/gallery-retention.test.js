'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { VARIANTS } = require('../assets/build-mockup-gallery.js');
const { planRetention, applyRetention, assertBudget, verifyArchives, releaseInventory } =
  require('../assets/gallery-retention.js');

function fixture(t) {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-gallery-retention-'));
  t.after(() => fs.rmSync(site, { recursive: true, force: true }));
  const versions = ['v1.9.0', 'v1.10.0', 'v1.11.0'];
  const releases = versions.map((version, index) => {
    const root = path.join(site, 'mockups', version);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), `Browse ${version}`);
    for (const variant of VARIANTS) {
      const directory = path.join(root, variant.id);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'shot.png'), `original ${version} ${variant.id}`);
    }
    return {
      id: index + 10, tag_name: version, draft: false,
      html_url: `https://github.com/WyattHoutz/birding-app/releases/tag/${version}`,
      assets: [{
        id: index + 1, name: 'BirdChaser-mockups.zip', state: 'uploaded', size: 123,
        digest: 'sha256:' + crypto.createHash('sha256').update(version).digest('hex'),
        browser_download_url: 'https://github.com/WyattHoutz/birding-app/releases/'
          + `download/${version}/BirdChaser-mockups.zip`,
        url: `https://api.github.com/repos/WyattHoutz/birding-app/releases/assets/${index + 1}`,
      }],
    };
  });
  fs.mkdirSync(path.join(site, '.git'));
  fs.writeFileSync(path.join(site, '.git', 'not-published'), 'preserve Git metadata');
  fs.writeFileSync(path.join(site, 'unrelated.txt'), 'preserve unrelated site content');
  return { site, releases };
}

test('F1302 retains the two numerically newest galleries and preserves discoverable archives', (t) => {
  const { site, releases } = fixture(t);
  const before = structuredClone(releases);
  const plan = planRetention(site, releases);
  const result = applyRetention(plan);
  assert.deepEqual(result.retained, ['v1.11.0', 'v1.10.0']);
  assert.equal(result.removedImages, VARIANTS.length);
  for (const version of result.retained) {
    for (const variant of VARIANTS) {
      assert.equal(fs.readFileSync(
        path.join(site, 'mockups', version, variant.id, 'shot.png'), 'utf8'),
      `original ${version} ${variant.id}`);
    }
  }
  for (const variant of VARIANTS) {
    assert.equal(fs.existsSync(path.join(site, 'mockups', 'v1.9.0', variant.id, 'shot.png')), false);
  }
  const archive = fs.readFileSync(path.join(site, 'mockups', 'v1.9.0', 'index.html'), 'utf8');
  assert.ok(archive.includes(releases[0].assets[0].browser_download_url));
  assert.ok(archive.includes(releases[0].assets[0].digest));
  assert.match(archive, /Older direct image URLs are no longer available/);
  assert.doesNotMatch(archive, /<img/);
  assert.match(fs.readFileSync(path.join(site, 'mockups', 'index.html'), 'utf8'),
    /v1\.9\.0: Archive ZIP/);
  assert.match(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), /mockups\/v1\.11\.0\//);
  assert.equal(fs.readFileSync(path.join(site, 'unrelated.txt'), 'utf8'),
    'preserve unrelated site content');
  assert.deepEqual(releases, before, 'archive metadata must remain unchanged');
  assert.equal(result.after, assertBudget(site));
  const resumed = applyRetention(planRetention(site, releases));
  assert.equal(resumed.removedImages, 0);
  assert.equal(resumed.after, result.after);
});

test('F1302 missing or untrusted archive evidence prevents all removal', (t) => {
  const { site, releases } = fixture(t);
  const invalid = [
    (rows) => rows.shift(),
    (rows) => rows.push(structuredClone(rows[0])),
    (rows) => { rows[0].draft = true; },
    (rows) => { rows[0].id = 0; },
    (rows) => { rows[0].html_url = 'https://example.test/release'; },
    (rows) => { rows[0].assets = []; },
    (rows) => { rows[0].assets.push(structuredClone(rows[0].assets[0])); },
    (rows) => { rows[0].assets[0].digest = null; },
    (rows) => { rows[0].assets[0].state = 'new'; },
    (rows) => { rows[0].assets[0].size = 0; },
    (rows) => { rows[0].assets[0].id = -1; },
    (rows) => { rows[0].assets[0].url += '/other'; },
    (rows) => { rows[0].assets[0].browser_download_url = 'https://example.test/archive.zip'; },
  ];
  for (const change of invalid) {
    const rows = structuredClone(releases);
    change(rows);
    assert.throws(() => planRetention(site, rows), /Release|archive/);
  }
  for (const variant of VARIANTS) {
    assert.ok(fs.existsSync(path.join(site, 'mockups', 'v1.9.0', variant.id, 'shot.png')));
  }
});

test('F1302 historical numeric-width galleries are archived without bypassing identity checks', (t) => {
  const { site, releases } = fixture(t);
  for (const width of ['393', '402']) {
    const directory = path.join(site, 'mockups', 'v1.9.0', width);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, `menu-${width}px.png`), 'historical gallery image');
  }
  const result = applyRetention(planRetention(site, releases));
  assert.equal(result.removedImages, VARIANTS.length + 2);
  for (const width of ['393', '402']) {
    assert.equal(fs.existsSync(path.join(site, 'mockups', 'v1.9.0', width, `menu-${width}px.png`)), false);
  }
  assert.ok(fs.readFileSync(path.join(site, 'mockups', 'v1.9.0', 'index.html'), 'utf8')
    .includes(releases[0].assets[0].digest));
});

test('F1302 a replaced archive cannot retain stale asset evidence at publication', (t) => {
  const { site, releases } = fixture(t);
  const { archives } = applyRetention(planRetention(site, releases));
  assert.doesNotThrow(() => verifyArchives(archives, releases));
  const replaced = structuredClone(releases);
  replaced[0].assets[0].digest = 'sha256:' + 'f'.repeat(64);
  assert.throws(() => verifyArchives(archives, replaced), /archive changed during retention/);
});

test('F1302 archive inventory consumes every API page with supported gh arguments', () => {
  const rows = releaseInventory((command, args, options) => {
    assert.equal(command, 'gh');
    assert.ok(args.includes('--paginate'));
    assert.ok(args.includes('--slurp'));
    assert.ok(!args.includes('--jq'), 'gh cannot combine --slurp with --jq');
    assert.equal(options.encoding, 'utf8');
    return JSON.stringify([[{ tag_name: 'v1.11.0' }], [{ tag_name: 'v1.9.0' }]]);
  });
  assert.deepEqual(rows.map((row) => row.tag_name), ['v1.11.0', 'v1.9.0']);
  assert.throws(() => releaseInventory(() => '{"message":"API error"}'), /incomplete paginated/);
});

test('F1302 oversized produced site fails before removal, including unrelated content', (t) => {
  const { site, releases } = fixture(t);
  const projected = planRetention(site, releases).projected;
  assert.throws(() => planRetention(site, releases, projected - 1), /exceeds budget/);
  assert.ok(fs.existsSync(path.join(site, 'mockups', 'v1.9.0', VARIANTS[0].id, 'shot.png')));
  applyRetention(planRetention(site, releases));
  const accepted = assertBudget(site);
  fs.writeFileSync(path.join(site, 'oversize.bin'), Buffer.alloc(100));
  assert.throws(() => assertBudget(site, accepted), /exceeds budget/);
});

test('F1302 a changed site plan or unexpected archived content cannot be pruned', (t) => {
  const { site, releases } = fixture(t);
  const plan = planRetention(site, releases);
  fs.writeFileSync(path.join(site, 'new-unrelated.txt'), 'new site input');
  assert.throws(() => applyRetention(plan), /plan changed/);
  const unexpected = path.join(site, 'mockups', 'v1.9.0', 'do-not-delete.txt');
  fs.writeFileSync(unexpected, 'preserve');
  assert.throws(() => planRetention(site, releases), /unexpected archived gallery content/);
  assert.equal(fs.readFileSync(unexpected, 'utf8'), 'preserve');
});

test('F1302 symlinked site content fails closed without following or deleting it', (t) => {
  const { site, releases } = fixture(t);
  const file = path.join(site, 'mockups', 'v1.9.0', VARIANTS[0].id, 'shot.png');
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (target, ...args) {
    const result = lstat.call(fs, target, ...args);
    if (target === file) result.isSymbolicLink = () => true;
    return result;
  });
  assert.throws(() => planRetention(site, releases), /symlink/);
  assert.ok(fs.existsSync(file));
});

test('F1302 the actual publication workflow enforces retention before pushing the site', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'post-release.yml'), 'utf8');
  const guard = workflow.indexOf('node assets/gallery-retention.js pages-site gallery-retention.json');
  const publish = workflow.indexOf('git push origin HEAD:gh-pages');
  assert.ok(guard >= 0 && publish > guard,
    'published Pages content must pass retention and byte-budget checks first');
  assert.match(workflow.slice(0, guard), /GH_TOKEN: \$\{\{ github\.token \}\}/);
});
