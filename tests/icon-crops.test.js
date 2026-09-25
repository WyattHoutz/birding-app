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

test('F486 Black Scoter uses the reviewed single-bird photograph', () => {
  const pins = tableBody('OVERRIDE_SRC_SHA');
  const credits = fs.readFileSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'CREDITS.md'), 'utf8');

  assert.match(pins,
    /['"]blksco2\.jpg['"]\s*:\s*['"]732dcd24e999606c['"]/,
    'Black Scoter is not pinned to the reviewed single-bird source');
  assert.match(credits,
    /\| `blksco2` \| Black Scoter, Barnegat Inlet N\.J\. \| Peter Massas \| CC BY-SA 2\.0 \|/,
    'Black Scoter lost the reviewed photographer or licence');
  assert.match(credits, /Melanitta_americana_Barnegat_NJ\.jpg/,
    'Black Scoter lost the reviewed Wikimedia source');
  assert.doesNotMatch(credits,
    /Black_Scoter_From_The_Crossley_ID_Guide_Eastern_Birds/,
    'the rejected multi-bird Crossley composite returned');

  const output = fs.readFileSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'blksco2.jpg'));
  assert.deepEqual(jpegSize(output), { w: 240, h: 240 },
    'Black Scoter app derivative was not generated from the reviewed square');
  assert.equal(sha256Hex(output),
    '8c28aeb56f5f65ddf051289deec0f3ad54b662ba7ad8726920869a96a3f6d5d5',
    'Black Scoter no longer matches the optimized reviewed square');
});

test('F480 and F481 replace ABA distribution maps with reviewed bird images', () => {
  const pins = tableBody('OVERRIDE_SRC_SHA');
  const fits = CROPPER.match(/^FIT_OVERRIDES = \{([\s\S]*?)^\}/m)[1];
  const credits = fs.readFileSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'CREDITS.md'), 'utf8');
  const cases = [
    {
      code: 'eskcur',
      pin: '2c5423fe92bb7751',
      output: 'f499d57512046897756a7cd4c0741ac4b0272b785c84e98aec2ae7db52eeddb1',
      credit: /\| `eskcur` \| Eskimo Curlew \| Archibald Thorburn \| Public domain \|/,
      source: /File:Numenius_borealis\.jpg/,
    },
    {
      code: 'leastp2',
      pin: 'e2709ff6931a7491',
      output: 'd45dc46f5ccc1c607507b9cdf42b7ee34b031322ddb23cd8986fd79f2b4b3172',
      credit: /\| `leastp2` \| Ainley's Storm-Petrel specimen \| Katie Sayers \| CC0 \|/,
      source: /occurrence\/1319132502/,
    },
  ];
  for (const item of cases) {
    assert.match(pins,
      new RegExp(`['"]${item.code}\\.jpg['"]\\s*:\\s*['"]${item.pin}['"]`),
      `${item.code} is not pinned to its reviewed bird source`);
    assert.match(fits, new RegExp(`['"]${item.code}\\.jpg['"]`),
      `${item.code} can return to a subject-cutting ordinary square crop`);
    assert.match(credits, item.credit,
      `${item.code} lost its reviewed creator or licence`);
    assert.match(credits, item.source,
      `${item.code} lost its reviewed source`);
    const output = fs.readFileSync(
      path.join(ROOT, 'www', 'assets', 'birds', `${item.code}.jpg`));
    const size = imageSize(output);
    assert.equal(size.w, size.h, `${item.code} is not square`);
    assert.equal(sha256Hex(output), item.output,
      `${item.code} no longer matches its reviewed bird square`);
    assert.equal(fs.existsSync(
      path.join(ROOT, 'www', 'assets', 'birds', `${item.code}.png`)), false,
    `${item.code} retained the rejected map alias`);
  }
  assert.doesNotMatch(credits, /Oceanodroma_cheimomnestes_dist\.png/,
    "Ainley's distribution map returned to the credits");
});

test('F479 all owner-drawn ABA crops stay pinned to reviewed outputs', () => {
  const review = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'assets', 'f479-crops.json'), 'utf8'));
  const cases = Object.entries(review.cases);
  assert.equal(cases.length, 213,
    'F479 must retain every owner-drawn crop except separately replaced blksco2');
  assert.equal(Object.hasOwn(review.cases, 'blksco2'), false,
    'Black Scoter is a source replacement guarded by F486, not a crop override');

  for (const [code, item] of cases) {
    assert.match(item.file, /\.(?:jpe?g|png)$/i,
      `${code} has no pinned source filename`);
    assert.match(item.source_sha, /^[0-9a-f]{16}$/,
      `${code} has no pinned source SHA`);
    assert.match(item.output_sha, /^[0-9a-f]{64}$/,
      `${code} has no pinned output SHA`);
    assert.equal(item.output_size.length, 2,
      `${code} has no measured output size`);
    assert.equal(item.output_size[0], item.output_size[1],
      `${code} output is not square`);

    const output = fs.readFileSync(
      path.join(ROOT, 'www', 'assets', 'birds', item.output_file));
    assert.deepEqual(imageSize(output),
      { w: item.output_size[0], h: item.output_size[1] },
      `${code} no longer has its reviewed square dimensions`);
    assert.equal(sha256Hex(output), item.output_sha,
      `${code} no longer matches the owner's reviewed square`);
  }
});

test('F376 reviewed bird crops not superseded by F479 stay pinned', () => {
  const overrides = tableBody('OVERRIDES');
  const pins = tableBody('OVERRIDE_SRC_SHA');
  const credits = fs.readFileSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'CREDITS.md'), 'utf8');
  const birds = [
    {
      file: 'rinphe1.jpg',
      override: /['"]rinphe1\.jpg['"]\s*:\s*0\.34\b/,
      sourcePin: '1e69885ae2ba8ab8',
      dimensions: { w: 240, h: 240 },
      outputSha: 'cb6fd7bccb00105277d3731286f30693775ea9ce8d9c05f7d04a7234df319740',
      credit: /Phasianus_colchicus_in_Tashkent_botanical_garden\.jpg/,
    },
    {
      file: 'redjun.jpg',
      override: /['"]redjun\.jpg['"]\s*:\s*0\.613\b/,
      sourcePin: 'f43d62dc0e60f719',
      dimensions: { w: 240, h: 240 },
      outputSha: '2c5d0fc156e2634ed58d5fd0c94bdcb0959e85d38bcc4bc6537440ddc5bbafdb',
      credit: /Red_junglefowl_%28Gallus_gallus%29_Rarotonga\.jpg/,
    },
    {
      file: 'wetshe.jpg',
      override: /['"]wetshe\.jpg['"]\s*:\s*\(\s*0\.18761,\s*0\.16888,\s*0\.64779,\s*0\.83419\s*\)/,
      sourcePin: 'dc96eb8806cacdd7',
      dimensions: { w: 240, h: 240 },
      outputSha: 'f08642af9297d034be7a5d63bab5215f1d3f9088c4cf5410fc0ad009a4189a1c',
      credit: /WEDGE-TAILED_SHEARWATER_%284-27-2018%29/,
    },
    {
      file: 'hawgoo.jpg',
      override: /['"]hawgoo\.jpg['"]\s*:\s*0\.10\b/,
      sourcePin: 'e51062c2dfd80911',
      dimensions: { w: 240, h: 240 },
      outputSha: 'a7e956093dfd62566face441277d549d5eb9cb6af2c3311e91b0fc5b5b996e78',
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
  assert.deepEqual(jpegSize(output), { w: 240, h: 240 },
    'the public Vesper derivative was not optimized from the reviewed crop');
});

test('F395 reported full-bird icons use pinned fit crops instead of clipping', () => {
  const fitted = tableBody('FIT_OVERRIDES');
  const pins = tableBody('OVERRIDE_SRC_SHA');
  const outputs = {
    'dunlin.png': ['cb8c3116337d517f3553a526949b367cb517e5492ddf339c1377c6932d25cc87', 240],
    'cubthr.jpg': ['97582dc48c764d3da20383cd62cb598784b829a79c304192d39d8f33128d132d', 240],
    'norcar.jpg': ['5f8bb7968ee0fd491587634b8c54a6147ed5fee58258d6aaa1a98e80df254e60', 240],
    'plsvir.jpg': ['5a22346046336ed890d7e9b05b0cf0f5928d5c1bb6ec7d1f4c5464eb58109625', 240],
    'virwar.jpg': ['39cabcdda55092903a842d82bc755530786ddb45da850558f8aec24d4907b117', 240],
    'crithr.jpg': ['fc7bc6c6f890ca5666a09c78eabea134c140bdd211f954368406d424ae370aef', 240],
    'comblh1.jpg': ['da5c011fa091911939fe9e5520f1bb73c9736d7711d0713d3ea492080b6c09c2', 240],
    'ameavo.jpg': ['b78435a77d7c34c710115e36462ac58b1d1a3c8f49b49622cf7d33942b7b6022', 240],
    'whfibi.jpg': ['63d7fe5ecb4a160db3ba7512c19024eab90dcb55b91f8023f7da8c2414dbdfa5', 240],
    'calqua.jpg': ['f06d2c78699e81569c651ffbc4c87f10320d6b6b956e8774e6ca08bec51bcaf6', 240],
    'brnboo.jpg': ['d53d9a0416a10d41f534b7c78f935a8c147fab6506d1984c568515d559530448', 240],
    'easpho.jpg': ['a76021c6e7b12cf764c42b937b7fb63eb1650c007bb3dc3df1b698eee91c8163', 240],
    'yetvir.jpg': ['92d9cc89fea07f9cc49b03ee249eb9ad7c18b482004e63bc2dfca093b0431d47', 240],
    'easmea.jpg': ['a0dae5876670acad6ef5cadb218a98265499224a526a7f990d23820a6471ef87', 240],
    'whevir.jpg': ['726053899158c89b9492efa0037d81bb1dd3e449137f7e3b6064ff2ad3b886fe', 240],
    'woothr.jpg': ['9d7c3d78b10be1efbabc1e05f7673f1a04a23351ef7f4f4ad15a310d9ba11c89', 240],
    'brwhaw.jpg': ['7acad07d808f1ee09eeae7b257bb4cc16c1532728d53803a76558d448b1823f4', 240],
    'rocpig.jpg': ['6d8ee27565813b273d00b51a2e57e2ec6f50ded9033f3d6c3a56f800882d01d5', 240],
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
      dimensions: { w: 240, h: 240 },
      outputSha: 'ad6dcd87da11de77fac97e944ee0c65a0c7f13b48ef6fe54bece56e206677fbd',
      credit: /20260428_tom_wild_turkey_matthaei_botanical_gardens_PD08952/,
    },
    {
      file: 'chukar.jpg',
      override: /['"]chukar\.jpg['"]\s*:\s*0\.35\b/,
      sourcePin: 'b58e9b28ee9e7bfe',
      dimensions: { w: 240, h: 240 },
      outputSha: '99901ba7702acf75577493dce3dcf2cc5a933e39a342e170e68184e72a400ad7',
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
  assert.deepEqual(jpegSize(output), { w: 240, h: 240 },
    'the public Sharp-shinned Hawk derivative was not optimized from its reviewed crop');
});

test('F529 Red-shouldered Hawk preserves the full portrait with deterministic headroom', () => {
  const fitted = tableBody('FIT_OVERRIDES');
  const pins = tableBody('OVERRIDE_SRC_SHA');
  assert.match(fitted, /['"]reshaw\.jpg['"]/,
    'Red-shouldered Hawk can fall back to the crown-clipping square crop');
  assert.match(pins,
    /['"]reshaw\.jpg['"]\s*:\s*['"]0c528c1c259026f4['"]/,
    'the measured portrait source is not pinned');

  const output = fs.readFileSync(
    path.join(ROOT, 'www', 'assets', 'birds', 'reshaw.jpg'));
  assert.deepEqual(jpegSize(output), { w: 240, h: 240 });
  assert.equal(output.length, 9156,
    'the generated derivative changed size; re-check the full-frame inset and headroom');
  assert.equal(sha256Hex(output),
    'c786673b5249334fa31e5493397749ffc26a66b439b02aa16c0e298fc116922e',
    'the deterministic Red-shouldered Hawk derivative changed');
});
