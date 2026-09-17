const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CROPPER = fs.readFileSync(
  path.join(ROOT, 'assets', 'square-icons.py'), 'utf8').replace(/\r/g, '');

function tableBody(name) {
  const match = CROPPER.match(
    new RegExp(`^${name} = \\{([\\s\\S]*?)^\\}`, 'm'));
  assert.ok(match, `${name} is missing from square-icons.py`);
  return match[1];
}

function jpegSize(buf) {
  assert.ok(buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8,
    'expected a JPEG image');
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) { p += 1; continue; }
    const marker = buf[p + 1];
    if (marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      p += 2;
      continue;
    }
    p += 2 + buf.readUInt16BE(p + 2);
  }
  return null;
}

function imageSize(buf) {
  if (buf.length >= 24
      && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  return jpegSize(buf);
}

function pythonRound(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (Math.abs(fraction - 0.5) < Number.EPSILON * 8) {
    return lower % 2 === 0 ? lower : lower + 1;
  }
  return Math.round(value);
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

test('F376 five reviewed bird crops stay pinned to their approved sources and squares', () => {
  const overrides = tableBody('OVERRIDES');
  const pins = tableBody('OVERRIDE_SRC_SHA');
  const credits = fs.readFileSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'CREDITS.md'), 'utf8');
  const birds = [
    {
      file: 'rinphe1.jpg',
      override: /['"]rinphe1\.jpg['"]\s*:\s*0\.34\b/,
      sourcePin: '1e69885ae2ba8ab8',
      dimensions: { w: 1018, h: 1018 },
      outputSha: 'ce8a6c3a330b3677f8ba45e899561fa2c762892a63969d2f5ab120982b06e541',
      credit: /Phasianus_colchicus_in_Tashkent_botanical_garden\.jpg/,
    },
    {
      file: 'redjun.jpg',
      override: /['"]redjun\.jpg['"]\s*:\s*0\.613\b/,
      sourcePin: 'f43d62dc0e60f719',
      dimensions: { w: 853, h: 853 },
      outputSha: 'dcb2ed489cb372d8c7cc212ed8becce7404bdb3649ba8cfcf5dadc95190e6927',
      credit: /Red_junglefowl_%28Gallus_gallus%29_Rarotonga\.jpg/,
    },
    {
      file: 'pibgre.jpg',
      override: /['"]pibgre\.jpg['"]\s*:\s*0\.80\b/,
      sourcePin: '549b13d63ff69da7',
      dimensions: { w: 768, h: 768 },
      outputSha: '97e70397eb16327812700e74d176efc72a4f56d2da30304879a1fc69d78c67ea',
      credit: /Podilymbus-podiceps-001\.jpg/,
    },
    {
      file: 'wetshe.jpg',
      override: /['"]wetshe\.jpg['"]\s*:\s*\(\s*0\.18761,\s*0\.16888,\s*0\.64779,\s*0\.83419\s*\)/,
      sourcePin: 'dc96eb8806cacdd7',
      dimensions: { w: 589, h: 589 },
      outputSha: 'a91e7b8848900227f241837dfec1a31d7a703a071d3eb422fbc24add422239d8',
      credit: /WEDGE-TAILED_SHEARWATER_%284-27-2018%29/,
    },
    {
      file: 'hawgoo.jpg',
      override: /['"]hawgoo\.jpg['"]\s*:\s*0\.10\b/,
      sourcePin: 'e51062c2dfd80911',
      dimensions: { w: 853, h: 853 },
      outputSha: '8afe6950a42db258a7f0399594a3eb6ab351de7959b56c9ee5d80e1782fc8a15',
      credit: /Animals_%2820120211-APHIS-WS-001%29\.jpg/,
    },
  ];

  for (const bird of birds) {
    assert.match(overrides, bird.override,
      `${bird.file} is not pinned to its reviewed square`);
    assert.match(pins,
      new RegExp(`['"]${bird.file.replace('.', '\\.')}['"]\\s*:\\s*['"]${bird.sourcePin}['"]`),
      `${bird.file} is not pinned to its reviewed source`);
    assert.match(credits, bird.credit,
      `${bird.file} does not credit the reviewed Wikimedia source`);

    const output = fs.readFileSync(
      path.join(ROOT, 'www', 'assets', 'birds', bird.file));
    assert.deepEqual(imageSize(output), bird.dimensions,
      `${bird.file} was not regenerated from its reviewed crop`);
    assert.equal(sha256Hex(output), bird.outputSha,
      `${bird.file} no longer matches the visually approved square`);
  }

  assert.equal(fs.existsSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'redjun.png')), false,
  'the public bundle must use the corrected Red Junglefowl JPEG');
});

test('F290 Vesper Sparrow crop keeps the whole head clear of the 56px left edge', () => {
  const override = tableBody('OVERRIDES').match(
    /['"]vesspa\.jpg['"]\s*:\s*([0-9.]+)/);
  assert.ok(override,
    'Vesper Sparrow needs an explicit numeric crop override; the automatic '
    + 'crop starts 292px in and removes its head');

  // Measured on the SHA-pinned 1070x756 Wikimedia source: the bill begins at
  // x=138, and x=800 retains the folded wing plus useful tail context.
  const sourceWidth = 1070;
  const cropSide = 756;
  const billLeft = 138;
  const bodyContextRight = 800;
  const smallCardPx = 56;
  const minHeadClearPx = 4;
  const slide = Number(override[1]);
  const cropLeft = pythonRound(slide * (sourceWidth - cropSide));
  const cropRight = cropLeft + cropSide;
  const smallCardHeadClear = (billLeft - cropLeft) * smallCardPx / cropSide;

  assert.ok(smallCardHeadClear >= minHeadClearPx,
    `Vesper bill is only ${smallCardHeadClear.toFixed(2)}px from the 56px `
    + `icon's left edge (crop starts at source x=${cropLeft}); need at least `
    + `${minHeadClearPx}px`);
  assert.ok(cropRight >= bodyContextRight,
    `Vesper crop ends at source x=${cropRight}, before the measured body `
    + `context landmark x=${bodyContextRight}`);

  const pin = tableBody('OVERRIDE_SRC_SHA').match(
    /['"]vesspa\.jpg['"]\s*:\s*['"]([0-9a-f]+)['"]/);
  assert.ok(pin, 'the Vesper crop is not pinned to its approved source image');
  assert.equal(pin[1], 'e7a65b4b836cbf65',
    'the Vesper source changed; re-measure the head boundary before carrying '
    + 'this crop override forward');

  const output = fs.readFileSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'vesspa.jpg'));
  assert.deepEqual(jpegSize(output), { w: cropSide, h: cropSide },
    'the public Vesper icon was not regenerated from the 1070x756 source');
});

test('F395 reported full-bird icons use pinned fit crops instead of clipping', () => {
  const fitted = tableBody('FIT_OVERRIDES');
  const pins = tableBody('OVERRIDE_SRC_SHA');
  const outputs = {
    'dunlin.png': ['35f0aa39c9cc715b96003f57ca6136193c515b504b6da66d4a6f00ba21efe481', 512],
    'cubthr.jpg': ['e402b8264d439ee736f5b2fb0dcfe09994286dbdf1d25fcaa3c56bb32252c050', 512],
    'norcar.jpg': ['b9938649b5712b4ec1c48d40edba0d6333b9e18bdecbf69a3ab50407f0d6392d', 512],
    'plsvir.jpg': ['a41c4badc431b1f96c3542a6e06b9f45b550ed8b64de2898a053162f57c21100', 380],
    'virwar.jpg': ['4358a27f3dd1199cce562148356dea93aecc96b080086267a4ecffe08b7e1d06', 512],
    'crithr.jpg': ['0031250d711c0a48d755a37258a9b29256774d07e2158e92a2e7948fc2e26bed', 512],
    'comblh1.jpg': ['cb2be81c6a302f0d574b0bb8647ed0360082033049c29fd95eecf88d7e604c29', 512],
    'ameavo.jpg': ['1e511db395128265cc128b0de10dfcd4fa8337c46c654a70086e038bf023dfb3', 512],
    'whfibi.jpg': ['ce27b4060c7cdf62a59a849f4fbb2710107824d4b68b760a18b8c7af9cc5853b', 512],
    'calqua.jpg': ['29f895d6e4b7c0a7e24d9695cd315b079072adea6c6faadf63c9e4919986e702', 512],
    'brnboo.jpg': ['c0aea3209aad889cf8135faf29c2f9284cb0a85b5115b81cff74b29909c48ba4', 512],
    'easpho.jpg': ['37c96732a4e503110116819e675bebb35006f34eff6b890d4c641c6e23812804', 512],
    'yetvir.jpg': ['b5666cab3def6232c82041b36e292fd4a8bb8a260300b6cc7cbc4ea4cb36bdc7', 512],
    'easmea.jpg': ['73d991b45e956667fc4c51605d6c0d97c51736d10dde8dbee45ea8b0df1c6735', 512],
    'whevir.jpg': ['59691a8b5886f4b738a044d74d6108a9ee5cf68c935aba610b31812a6f4777eb', 512],
    'woothr.jpg': ['7e3ff1c0c6e4cc001d424c15418bbb0de117f5a37db8b4727fd26f0690621f77', 512],
    'brwhaw.jpg': ['2dfcf5a4a01c73fa6a1deefb1f413fdc511b58816fe2e8b90929a8f66857aecc', 358],
    'rocpig.jpg': ['5b452338fbd38dec33adf7e3307281f0beb65e76c55986dbb68b7303b48f4290', 512],
  };

  for (const [file, [hash, side]] of Object.entries(outputs)) {
    const escaped = file.replace('.', '\\.');
    assert.match(fitted, new RegExp(`['"]${escaped}['"]`),
      `${file} can fall back to a clipping square crop`);
    assert.match(pins, new RegExp(`['"]${escaped}['"]\\s*:\\s*['"][0-9a-f]{16}['"]`),
      `${file} fit crop is not pinned to the reviewed credited source`);
    const output = fs.readFileSync(path.join(ROOT, 'www', 'assets', 'birds', file));
    const size = imageSize(output);
    assert.deepEqual(size, { w: side, h: side },
      `${file} was not regenerated at its reviewed square size`);
    assert.equal(sha256Hex(output), hash,
      `${file} no longer matches its reviewed full-bird fit`);
  }
});

test('F412 Wild Turkey and Chukar keep their reviewed complete-bird squares', () => {
  const overrides = tableBody('OVERRIDES');
  const fitted = tableBody('FIT_OVERRIDES');
  const pins = tableBody('OVERRIDE_SRC_SHA');
  const credits = fs.readFileSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'CREDITS.md'), 'utf8');
  const birds = [
    {
      file: 'wiltur.jpg',
      override: /['"]wiltur\.jpg['"]\s*:\s*0\.386\b/,
      sourcePin: 'a9d62263900aee3c',
      dimensions: { w: 640, h: 640 },
      outputSha: '43e6b6dbc5d388f68aeeb24d6df826310b5d708e280efc3d4afa083dcd692260',
      credit: /20260428_tom_wild_turkey_matthaei_botanical_gardens_PD08952/,
    },
    {
      file: 'chukar.jpg',
      override: /['"]chukar\.jpg['"]\s*:\s*0\.35\b/,
      sourcePin: 'b58e9b28ee9e7bfe',
      dimensions: { w: 638, h: 638 },
      outputSha: '36e6fd7b113bd8981b5b75f3bbde19282562019fcb0c5636cb92c377888ed0d2',
      credit: /Chukarhuhn_Weltvogelpark_Walsrode_2010/,
    },
  ];

  for (const bird of birds) {
    assert.match(overrides, bird.override,
      `${bird.file} lost its reviewed complete-bird crop position`);
    assert.doesNotMatch(fitted, new RegExp(`['"]${bird.file.replace('.', '\\.')}['"]`),
      `${bird.file} fell back to the small blurred full-frame treatment`);
    assert.match(pins,
      new RegExp(`['"]${bird.file.replace('.', '\\.')}['"]\\s*:\\s*['"]${bird.sourcePin}['"]`),
      `${bird.file} crop is not pinned to its reviewed credited source`);
    assert.match(credits, bird.credit,
      `${bird.file} lost its Wikimedia Commons source credit`);
    const output = fs.readFileSync(
      path.join(ROOT, 'www', 'assets', 'birds', bird.file));
    assert.deepEqual(jpegSize(output), bird.dimensions,
      `${bird.file} was not regenerated as its reviewed square`);
    assert.equal(sha256Hex(output), bird.outputSha,
      `${bird.file} no longer matches its reviewed complete-bird crop`);
  }
});

test('F250 Sharp-shinned Hawk trades tail for measured crown clearance', () => {
  const override = tableBody('OVERRIDES').match(
    /['"]shshaw\.jpg['"]\s*:\s*([0-9.]+)/);
  assert.ok(override,
    'Sharp-shinned Hawk needs an explicit crop: the automatic window leaves '
    + 'the crown effectively touching the top edge');

  // Measured on the source grid. The owner's drawn square was 1.107 times the
  // source width, so no fixed square can preserve both ends. Their rule
  // decides the trade: protect the head and trim tail.
  const sourceHeight = 360;
  const cropSide = 250;
  const crownTop = 36;
  const feetAndPerchBottom = 260;
  const smallCardPx = 56;
  const minHeadClearPx = 4;
  const slide = Number(override[1]);
  const cropTop = pythonRound(slide * (sourceHeight - cropSide));
  const cropBottom = cropTop + cropSide;
  const renderedHeadClear = (crownTop - cropTop) * smallCardPx / cropSide;

  assert.ok(renderedHeadClear >= minHeadClearPx,
    `Sharp-shinned Hawk crown is only ${renderedHeadClear.toFixed(2)}px from `
    + `the 56px icon's top edge (crop starts at source y=${cropTop}); need at `
    + `least ${minHeadClearPx}px`);
  assert.ok(cropBottom >= feetAndPerchBottom,
    `Sharp-shinned Hawk crop ends at source y=${cropBottom}, before the `
    + `measured feet/perch context at y=${feetAndPerchBottom}`);

  const source = fs.readFileSync(
    path.join(ROOT, 'tests', 'fixtures', 'icon-crops', 'shshaw.jpg'));
  const sourceHash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  const pin = tableBody('OVERRIDE_SRC_SHA').match(
    /['"]shshaw\.jpg['"]\s*:\s*['"]([0-9a-f]+)['"]/);
  assert.ok(pin, 'the Sharp-shinned Hawk crop is not pinned to its measured source');
  assert.equal(pin[1], sourceHash,
    'the Sharp-shinned Hawk source changed; re-measure crown and perch landmarks');
  assert.equal(sourceHash, '88d0e03cb12f2ede',
    'the public test fixture is not the source used for the measured override');

  const output = fs.readFileSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'shshaw.jpg'));
  assert.deepEqual(jpegSize(output), { w: cropSide, h: cropSide },
    'the public Sharp-shinned Hawk icon was not regenerated as a 250px square');
});
