/*
 * Dependency-free generator for the app icon, launch images and in-app mark.
 *
 * The brand is a photograph -- a belted kingfisher shot by the app's author --
 * so the icon you tap, the splash you wait on and the mark in the header are
 * all literally the same picture. Everything is derived from ONE master here,
 * so they cannot drift apart the way a hand-drawn logo and a separate icon do.
 *
 * Input:
 *   assets/brand/kingfisher.png  1024x1024 lossless master (archival source)
 *
 * Output:
 *   assets/icon.png            1024x1024  app icon source  (capacitor-assets)
 *   assets/splash.png          2732x2732  light launch image
 *   assets/splash-dark.png     2732x2732  dark launch image
 *   www/assets/brand/mark.png  176x176    in-app header + navbar mark
 *
 * The master is PNG rather than the original JPEG for one reason: Node decodes
 * PNG with built-in zlib and cannot decode JPEG without a package. Keeping the
 * pipeline dependency-free is why it runs anywhere with nothing installed.
 *
 * Run:  node assets/generate.js
 */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- PNG encoding (8-bit RGB, no alpha) ----
// iOS rejects an app icon that has an alpha channel, so RGB here is not just a
// size saving -- an RGBA icon fails validation outright.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor RGB
  // raw scanlines, each prefixed with a 0 filter byte
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- PNG decoding (8-bit RGB/RGBA, all five filter types) ----
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6)) {
    throw new Error(`need an 8-bit RGB/RGBA master, got depth ${depth} color ${color}`);
  }
  const ch = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 3);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    raw.copy(line, 0, rp, rp + stride);
    rp += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 3] = line[x * ch];
      out[(y * w + x) * 3 + 1] = line[x * ch + 1];
      out[(y * w + x) * 3 + 2] = line[x * ch + 2];
    }
    line.copy(prev);
  }
  return { w, h, d: out };
}

// ---- tiny AA raster canvas ----
function Canvas(w, h) { this.w = w; this.h = h; this.d = Buffer.alloc(w * h * 3); }
Canvas.prototype.set = function (x, y, c, cov) {
  if (cov <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
  if (cov > 1) cov = 1;
  const i = (y * this.w + x) * 3;
  this.d[i] = this.d[i] * (1 - cov) + c[0] * cov;
  this.d[i + 1] = this.d[i + 1] * (1 - cov) + c[1] * cov;
  this.d[i + 2] = this.d[i + 2] * (1 - cov) + c[2] * cov;
};
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
Canvas.prototype.gradient = function (top, bot) {
  for (let y = 0; y < this.h; y++) {
    const c = mix(top, bot, y / (this.h - 1));
    for (let x = 0; x < this.w; x++) this.set(x, y, c, 1);
  }
};
Canvas.prototype.circle = function (cx, cy, r, color) {
  const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      this.set(x, y, color, Math.max(0, Math.min(1, r + 0.5 - d)));
    }
};

// ---- photo sampling ----
function sample(img, u, v) {
  const fx = Math.min(img.w - 1, Math.max(0, u * (img.w - 1)));
  const fy = Math.min(img.h - 1, Math.max(0, v * (img.h - 1)));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const p00 = img.d[(y0 * img.w + x0) * 3 + k], p10 = img.d[(y0 * img.w + x1) * 3 + k];
    const p01 = img.d[(y1 * img.w + x0) * 3 + k], p11 = img.d[(y1 * img.w + x1) * 3 + k];
    out[k] = (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
  }
  return out;
}

/* Draw the crop box of `img` into a square of `size`, optionally circle-masked.
 *
 * Crops are given in NORMALISED master coordinates so the framing survives any
 * future change of master resolution.
 *
 * Downscaling a 1024px photo to 176px with one bilinear tap per output pixel
 * aliases badly on feather detail, so each output pixel averages an ss x ss
 * grid -- a box filter over the source footprint it actually covers. */
function drawPhoto(cv, img, crop, size, ox, oy, circle) {
  const ss = Math.max(1, Math.min(4, Math.round((img.w * crop.s) / size)));
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 1;
      if (circle) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
        cov = Math.max(0, Math.min(1, r - d + 0.5));
        if (cov <= 0) continue;
      }
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = crop.x + ((x + (sx + 0.5) / ss) / size) * crop.s;
          const v = crop.y + ((y + (sy + 0.5) / ss) / size) * crop.s;
          const p = sample(img, u, v);
          acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2];
        }
      }
      const n = ss * ss;
      cv.set(ox + x, oy + y, [acc[0] / n, acc[1] / n, acc[2] / n], cov);
    }
  }
}

// Crops are solved against the mask each output actually gets, not eyeballed.
// ICON sits under the iOS squircle, which only bites the corners, so it can
// hold the whole profile plus the dark body that gives the mark weight.
const CROP_ICON = { x: 0.090, y: 0.110, s: 0.800 };
// MARK is masked by CSS to a circle INSCRIBED in the square, so the usable area
// is 79% of the crop and the corners are gone. It was solved for FACE alone,
// which put the nape at 0.550 from centre against a 0.5 radius — outside the
// arc. That is not a stylish tight crop, it is the reported "cropped mid neck":
// the head reads as severed because the circle cuts the bird where its neck
// meets its body instead of past it. Now solved for the whole PROFILE: the
// minimum circle enclosing all four landmarks is centred (0.301, 0.295) with
// radius 0.186, so s must be at least 0.372; 0.440 adds the margin that keeps
// the bird off the arc rather than tangent to it.
const CROP_MARK = { x: 0.081, y: 0.075, s: 0.440 };

// Where the bird is in the master, in the master's own normalised coordinates.
// MEASURED, not guessed — these come from a silhouette scan of the master
// (leftmost / topmost / rearmost non-sky pixel, and the white loral patch found
// as the one light blob inside the dark crown), because the previous master was
// eyeballed and lost the beak the moment CSS made the mark round. That failure
// is invisible in a square preview, which is why the numbers have to be solved.
const LANDMARKS = {
  'bill tip': [0.115, 0.298],
  'eye patch': [0.305, 0.265],
  'crown': [0.395, 0.159],
  'nape': [0.487, 0.292],
};
// What each output OWES, which is not the same as what is in the photo. The
// crown is the top of the shaggy crest and is non-negotiable everywhere — a
// belted kingfisher without its crest silhouette is just a blue bird. The nape
// used to be optional for the MARK on the theory that a tight face crop may
// lose the trailing crest spikes; on device that read as a severed head, so
// the mark now owes the whole profile too and FACE is kept only as the
// irreducible core the crop is measured against.
const FACE = ['bill tip', 'eye patch', 'crown'];
const PROFILE = [...FACE, 'nape'];

// A landmark must survive the mask its output actually gets. The circle is
// inscribed, so it discards the corners; the iOS squircle only bites them.
function assertFramed(crop, label, mask, required) {
  for (const name of required) {
    const [mx, my] = LANDMARKS[name];
    const u = (mx - crop.x) / crop.s - 0.5;
    const v = (my - crop.y) / crop.s - 0.5;
    const inside = mask === 'circle'
      ? Math.hypot(u, v) <= 0.5
      : Math.abs(u * 2) ** 5 + Math.abs(v * 2) ** 5 <= 1;
    if (!inside) {
      throw new Error(
        `${label}: "${name}" falls outside the ${mask} mask `
        + `(${u.toFixed(3)}, ${v.toFixed(3)}). Widen or recentre the crop, or `
        + `update LANDMARKS if the master photo changed.`);
    }
  }
}

const GREEN_TOP = [18, 150, 100], GREEN_BOT = [8, 70, 48];
const DARK_TOP = [10, 32, 24], DARK_BOT = [4, 16, 12];
const RING = [238, 243, 239];

function renderSplash(img, size, top, bot) {
  const cv = new Canvas(size, size);
  cv.gradient(top, bot);
  const d = Math.round(size * 0.42);
  const o = Math.round((size - d) / 2);
  cv.circle(size / 2, size / 2, d / 2 + size * 0.012, RING);
  drawPhoto(cv, img, CROP_MARK, d, o, o, true);
  return encodePNG(size, size, cv.d);
}

const out = __dirname;
const master = decodePNG(fs.readFileSync(path.join(out, 'brand', 'kingfisher.png')));

assertFramed(CROP_ICON, 'CROP_ICON', 'squircle', PROFILE);
assertFramed(CROP_MARK, 'CROP_MARK', 'circle', PROFILE);

const icon = new Canvas(1024, 1024);
drawPhoto(icon, master, CROP_ICON, 1024, 0, 0, false);
fs.writeFileSync(path.join(out, 'icon.png'), encodePNG(1024, 1024, icon.d));

fs.writeFileSync(path.join(out, 'splash.png'), renderSplash(master, 2732, GREEN_TOP, GREEN_BOT));
fs.writeFileSync(path.join(out, 'splash-dark.png'), renderSplash(master, 2732, DARK_TOP, DARK_BOT));

// The in-app mark. 176px covers the 58px header logo at 3x and the navbar's
// 26px many times over. It is masked to a circle by CSS rather than baked in,
// so the file stays alpha-free and one asset serves both sites.
const markDir = path.join(out, '..', 'www', 'assets', 'brand');
fs.mkdirSync(markDir, { recursive: true });
const mark = new Canvas(176, 176);
drawPhoto(mark, master, CROP_MARK, 176, 0, 0, false);
fs.writeFileSync(path.join(markDir, 'mark.png'), encodePNG(176, 176, mark.d));

console.log('wrote icon.png, splash.png, splash-dark.png, www/assets/brand/mark.png');
