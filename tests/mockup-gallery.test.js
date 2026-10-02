'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  VARIANTS, parseReadme, buildGallery,
} = require('../assets/build-mockup-gallery.js');

test('mockup gallery parser keeps authored titles and image order', () => {
  assert.deepEqual(parseReadme([
    '# UI mockups',
    '### Twitches — Group off',
    '![Twitches list](section-refreshBtn-393px.png)',
    '### Nemesis — Group on',
    '![Nemesis grouped](section-todayBtn-393px.png)',
  ].join('\n')), [
    { title: 'Twitches — Group off', alt: 'Twitches list',
      file: 'section-refreshBtn-393px.png' },
    { title: 'Nemesis — Group on', alt: 'Nemesis grouped',
      file: 'section-todayBtn-393px.png' },
  ]);
});

test('F630 mockup gallery builds every Display profile for every report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-chaser-gallery-'));
  const input = path.join(root, 'input');
  const site = path.join(root, 'site');
  for (const variant of VARIANTS) {
    const dir = path.join(input, variant.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'),
      `# UI mockups\n\n### Twitches\n\n![Twitches](twitches-${variant.width}px.png)\n`);
    fs.writeFileSync(path.join(dir, `twitches-${variant.width}px.png`),
      `png-${variant.id}`);
  }

  const result = buildGallery({
    inputRoot: input,
    siteRoot: site,
    version: '1.127.0',
    releaseUrl: 'https://github.com/WyattHoutz/birding-app/releases/tag/v1.127.0',
  });
  assert.equal(result.count, 1);
  const html = fs.readFileSync(path.join(site, 'mockups', 'v1.127.0', 'index.html'), 'utf8');
  assert.match(html, /Bird Chaser v1\.127\.0 mockups/);
  assert.match(html, /<strong>iPhone 11<\/strong><span>414px · Standard \(1\.0x\)<\/span>/);
  assert.match(html, /<strong>iPhone 17 Pro<\/strong><span>402px · Standard \(1\.0x\)<\/span>/);
  assert.match(html, /<strong>iPhone 17 Pro<\/strong><span>402px · Large \(1\.2x\)<\/span>/);
  assert.match(html,
    /<strong>iPhone 17 Pro<\/strong><span>402px · High visibility \(1\.75x\)<\/span>/);
  assert.match(html, /iphone-11\/twitches-414px\.png/);
  assert.match(html, /iphone-17-pro\/twitches-402px\.png/);
  assert.match(html, /iphone-17-pro-large\/twitches-402px\.png/);
  assert.match(html,
    /iphone-17-pro-max-magnification\/twitches-402px\.png/);
  assert.match(html, /4 variants each/);
  assert.deepEqual([...new Set(VARIANTS.map((variant) => variant.profile))].sort(),
    ['high-visibility', 'large', 'standard'],
    'the gallery omits one of the three Display profiles');
  assert.match(html, /Filter screenshots/);
  assert.ok(fs.existsSync(path.join(site, '.nojekyll')));
  assert.match(fs.readFileSync(path.join(site, 'index.html'), 'utf8'),
    /mockups\/v1\.127\.0\//);
});
