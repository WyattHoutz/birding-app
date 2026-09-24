const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'www', 'assets', 'birds');
const OPTIMIZER = fs.readFileSync(
  path.join(ROOT, 'assets', 'optimize-bird-icons.py'), 'utf8');
const MAX_EDGE = 240;
const MAX_BYTES = 200 * 1024;
const MAX_LIBRARY_BYTES = 130 * 1024 * 1024;

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
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
    const length = buf.readUInt16BE(p + 2);
    if (length < 2) return null;
    p += 2 + length;
  }
  return null;
}

function imageSize(buf) {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length >= 24 && buf.subarray(0, 8).equals(png)) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  return jpegSize(buf);
}

test('F513 bundles only bounded app-sized bird derivatives', () => {
  const files = fs.readdirSync(ICON_DIR)
    .filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name));
  assert.ok(files.length >= 10900, 'worldwide icon coverage disappeared');
  let total = 0;
  for (const name of files) {
    const buf = fs.readFileSync(path.join(ICON_DIR, name));
    const size = imageSize(buf);
    assert.ok(size, `${name} is not a supported decodable JPEG/PNG`);
    assert.ok(Math.max(size.w, size.h) <= MAX_EDGE,
      `${name} is ${size.w}x${size.h}; app derivatives must fit ${MAX_EDGE}px`);
    assert.ok(buf.length <= MAX_BYTES,
      `${name} is ${buf.length} bytes; app derivative limit is ${MAX_BYTES}`);
    total += buf.length;
  }
  assert.ok(total <= MAX_LIBRARY_BYTES,
    `bird derivative library is ${(total / 1048576).toFixed(2)} MiB; `
    + `limit is ${(MAX_LIBRARY_BYTES / 1048576).toFixed(0)} MiB`);
});

test('F513 optimizer preserves small reviewed crops and refuses in-place destruction', () => {
  assert.match(OPTIMIZER, /^MAX_EDGE = 240$/m);
  assert.match(OPTIMIZER, /^JPEG_QUALITY = 80$/m);
  assert.match(OPTIMIZER, /^MAX_BYTES = 200 \* 1024$/m);
  assert.match(OPTIMIZER,
    /max\(original_size\) <= MAX_EDGE and original_bytes <= MAX_BYTES:[\s\S]*shutil\.copy2/,
    'already-small reviewed crops should remain byte-for-byte unchanged');
  assert.match(OPTIMIZER, /source_dir\.resolve\(\) == output_dir\.resolve\(\)/,
    'the optimizer can destroy its own source library');
});
