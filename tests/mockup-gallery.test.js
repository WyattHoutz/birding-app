'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseReadme, buildGallery } = require('../assets/build-mockup-gallery.js');

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

test('mockup gallery builds a labelled side-by-side versioned Pages site', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-chaser-gallery-'));
  const input = path.join(root, 'input');
  const site = path.join(root, 'site');
  for (const width of [393, 402]) {
    const dir = path.join(input, String(width));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'),
      `# UI mockups\n\n### Twitches\n\n![Twitches](twitches-${width}px.png)\n`);
    fs.writeFileSync(path.join(dir, `twitches-${width}px.png`), `png-${width}`);
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
  assert.match(html, /<strong>393px<\/strong><span>iPhone 14\/15 Pro<\/span>/);
  assert.match(html, /<strong>402px<\/strong><span>iPhone 16 Pro<\/span>/);
  assert.match(html, /393\/twitches-393px\.png/);
  assert.match(html, /402\/twitches-402px\.png/);
  assert.match(html, /Filter screenshots/);
  assert.ok(fs.existsSync(path.join(site, '.nojekyll')));
  assert.match(fs.readFileSync(path.join(site, 'index.html'), 'utf8'),
    /mockups\/v1\.127\.0\//);
});
