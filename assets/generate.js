/*
 * Dependency-free generator for the app icon + splash source images.
 *
 * Draws a birding emblem (binoculars) on a green gradient and writes three
 * PNGs that @capacitor/assets fans out into the iOS project during CI:
 *   assets/icon.png        1024x1024  app icon source
 *   assets/splash.png      2732x2732  light launch image
 *   assets/splash-dark.png 2732x2732  dark launch image
 *
 * No external packages: PNG is hand-encoded with Node's built-in zlib.
 * Run:  node assets/generate.js
 */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- PNG encoding (8-bit RGB, no alpha) ----
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
Canvas.prototype.roundRect = function (x0, y0, x1, y1, r, color) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const bx0 = Math.max(0, Math.floor(x0 - 1)), bx1 = Math.min(this.w - 1, Math.ceil(x1 + 1));
  const by0 = Math.max(0, Math.floor(y0 - 1)), by1 = Math.min(this.h - 1, Math.ceil(y1 + 1));
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const qx = Math.abs(x + 0.5 - cx) - hx, qy = Math.abs(y + 0.5 - cy) - hy;
      const dOut = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const dIn = Math.min(Math.max(qx, qy), 0);
      const sd = dOut + dIn - r;
      this.set(x, y, color, Math.max(0, Math.min(1, 0.5 - sd)));
    }
};

const LIGHT = [238, 243, 239];
const MINT = [55, 211, 145];
const DARK = [8, 44, 30];

// Binoculars emblem centered at (cx,cy); u = size unit.
function binoculars(cv, cx, cy, u) {
  const bhw = 0.46 * u;               // barrel half width
  const top = cy - 0.66 * u, bot = cy + 0.58 * u;
  const lx = cx - 0.55 * u, rx = cx + 0.55 * u;
  // connecting bridge (draw first so barrels sit on top)
  cv.roundRect(lx, cy - 0.40 * u, rx, cy - 0.10 * u, 0.10 * u, LIGHT);
  // barrels
  cv.roundRect(lx - bhw, top, lx + bhw, bot, 0.40 * u, LIGHT);
  cv.roundRect(rx - bhw, top, rx + bhw, bot, 0.40 * u, LIGHT);
  // focus wheel on the bridge
  cv.roundRect(cx - 0.11 * u, cy - 0.44 * u, cx + 0.11 * u, cy - 0.06 * u, 0.06 * u, DARK);
  // objective lenses (front glass) at the bottom of each barrel
  cv.circle(lx, cy + 0.30 * u, 0.34 * u, DARK);
  cv.circle(rx, cy + 0.30 * u, 0.34 * u, DARK);
  cv.circle(lx, cy + 0.30 * u, 0.24 * u, MINT);
  cv.circle(rx, cy + 0.30 * u, 0.24 * u, MINT);
  // eyecups at the top
  cv.circle(lx, top + 0.02 * u, 0.30 * u, DARK);
  cv.circle(rx, top + 0.02 * u, 0.30 * u, DARK);
}

function render(size, u, top, bot) {
  const cv = new Canvas(size, size);
  cv.gradient(top, bot);
  binoculars(cv, size / 2, size * 0.52, u);
  return encodePNG(size, size, cv.d);
}

const GREEN_TOP = [18, 150, 100], GREEN_BOT = [8, 70, 48];
const DARK_TOP = [10, 32, 24], DARK_BOT = [4, 16, 12];

const out = __dirname;
fs.writeFileSync(path.join(out, 'icon.png'), render(1024, 300, GREEN_TOP, GREEN_BOT));
fs.writeFileSync(path.join(out, 'splash.png'), render(2732, 460, GREEN_TOP, GREEN_BOT));
fs.writeFileSync(path.join(out, 'splash-dark.png'), render(2732, 460, DARK_TOP, DARK_BOT));
console.log('wrote icon.png, splash.png, splash-dark.png');
