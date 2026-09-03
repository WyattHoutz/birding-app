const { test } = require('node:test');
const assert = require('node:assert');
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
    'vesspa.jpg is no longer a JPEG');
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

function pythonRound(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (Math.abs(fraction - 0.5) < Number.EPSILON * 8) {
    return lower % 2 === 0 ? lower : lower + 1;
  }
  return Math.round(value);
}

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
