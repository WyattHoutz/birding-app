/* Bird Chaser — a small QR encoder, byte mode, error-correction level M.
 *
 * F143. "id like a QR code ... that when tapped shows a QR to the respective
 * item". A QR in the field must work with no network, so this is local code
 * rather than an image service — the whole app's rule.
 *
 * ⚠️ THE PREVIOUS VERSION OF THIS FILE PRODUCED UNREADABLE CODES. It got the
 * SIZE right for every input, which is exactly what makes a broken QR
 * dangerous: it renders as convincing noise and fails in the field, where the
 * person holding the phone cannot tell a bad encoder from bad light. It was
 * committed before it was verified and rode inside two .ipa files — harmlessly,
 * because nothing referenced it, but a file known to be wrong was shipping.
 *
 * ⚠️ AND THE FIRST TEST OF IT WAS ALSO WRONG. Comparing modules against
 * python-qrcode reported "268 of 841 differ" and proved nothing: a QR carries
 * its MASK in its format bits, so two encoders that choose different masks
 * produce different-looking and equally valid codes. The property is that a
 * DECODER reads the string back. See assets/verify-qr.py, which also runs a
 * control proving the harness itself works before blaming this file.
 *
 * Versions 1–10 only, which covers every URL this app builds (213 bytes at
 * version 10, level M) and keeps the tables small enough to check by eye.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BirdQR = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- tables, level M only ----------------------------------------------
  // [ec codewords per block, group1 blocks, group1 data cw, group2 blocks,
  //  group2 data cw]. Index is version - 1.
  var EC_M = [
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44]
  ];
  // Alignment-pattern centre coordinates, index is version - 1.
  var ALIGN = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  function dataCodewords(v) {
    var t = EC_M[v - 1];
    return t[1] * t[2] + t[3] * t[4];
  }

  // ---- GF(256) for Reed–Solomon ------------------------------------------
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1, i;
    for (i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;           // the QR primitive polynomial
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  }());

  function gmul(a, b) {
    if (!a || !b) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(n) {
    var poly = [1], i, j;
    for (i = 0; i < n; i++) {
      var next = new Array(poly.length + 1);
      for (j = 0; j < next.length; j++) next[j] = 0;
      for (j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], EXP[i]);
        next[j + 1] ^= poly[j];
      }
      poly = next;
    }
  // ⚠️ ORDER MATTERS AND THIS IS WHERE IT WAS WRONG. The polynomial is built
  // in ASCENDING degree — poly[0] is the constant term — because that is what
  // the multiply loop above produces naturally. But `rsEncode` divides using
  // `gen[j + 1]`, which wants the LEADING coefficient first. Feeding it the
  // ascending array made the last EC codeword multiply by 1 instead of by the
  // constant term, so for `ec=2` it used [3, 1] where the divisor is [3, 2].
  //
  // MEASURED: with this reversed, the 44 DATA codewords already matched the
  // reference exactly and only the 26 EC codewords differed — which is what
  // localised the bug to this line rather than to the data path or the matrix.
    return poly.reverse();
  }
  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen), res = new Array(ecLen), i, j;
    for (i = 0; i < ecLen; i++) res[i] = 0;
    for (i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
    }
    return res;
  }

  // ---- bit stream ---------------------------------------------------------
  function Bits() { this.bits = []; }
  Bits.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };

  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function pickVersion(nBytes) {
    for (var v = 1; v <= 10; v++) {
      var lenBits = v < 10 ? 8 : 16;
      // 4 mode bits + length + payload, in BITS, against the data capacity.
      if (4 + lenBits + nBytes * 8 <= dataCodewords(v) * 8) return v;
    }
    return 0;
  }

  function buildCodewords(bytes, v) {
    var bs = new Bits(), i, j;
    bs.put(4, 4);                                   // byte mode
    bs.put(bytes.length, v < 10 ? 8 : 16);
    for (i = 0; i < bytes.length; i++) bs.put(bytes[i], 8);
    var cap = dataCodewords(v) * 8;
    // Terminator: up to four zero bits, but never past the capacity.
    var term = Math.min(4, cap - bs.bits.length);
    for (i = 0; i < term; i++) bs.bits.push(0);
    while (bs.bits.length % 8) bs.bits.push(0);
    var cw = [];
    for (i = 0; i < bs.bits.length; i += 8) {
      var b = 0;
      for (j = 0; j < 8; j++) b = (b << 1) | bs.bits[i + j];
      cw.push(b);
    }
    // Pad alternately with 236 / 17 until the data capacity is full.
    var pads = [0xec, 0x11], p = 0;
    while (cw.length < dataCodewords(v)) cw.push(pads[p++ % 2]);
    return cw;
  }

  // Split into blocks, error-correct each, then INTERLEAVE — the step that
  // makes a QR survive a smudge, and an easy one to get quietly wrong.
  function interleave(cw, v) {
    var t = EC_M[v - 1], ecLen = t[0];
    var blocks = [], ecs = [], at = 0, i, j;
    for (i = 0; i < t[1]; i++) { blocks.push(cw.slice(at, at + t[2])); at += t[2]; }
    for (i = 0; i < t[3]; i++) { blocks.push(cw.slice(at, at + t[4])); at += t[4]; }
    for (i = 0; i < blocks.length; i++) ecs.push(rsEncode(blocks[i], ecLen));
    var out = [], maxData = t[3] ? Math.max(t[2], t[4]) : t[2];
    for (j = 0; j < maxData; j++) {
      for (i = 0; i < blocks.length; i++) {
        if (j < blocks[i].length) out.push(blocks[i][j]);
      }
    }
    for (j = 0; j < ecLen; j++) {
      for (i = 0; i < ecs.length; i++) out.push(ecs[i][j]);
    }
    return out;
  }

  // ---- matrix -------------------------------------------------------------
  function blank(n) {
    var m = new Array(n), i, j;
    for (i = 0; i < n; i++) {
      m[i] = new Array(n);
      for (j = 0; j < n; j++) m[i][j] = null;      // null = free for data
    }
    return m;
  }

  function placeFinder(m, r, c) {
    for (var y = -1; y <= 7; y++) {
      for (var x = -1; x <= 7; x++) {
        var ry = r + y, cx = c + x;
        if (ry < 0 || cx < 0 || ry >= m.length || cx >= m.length) continue;
        var on = (y >= 0 && y <= 6 && (x === 0 || x === 6))
              || (x >= 0 && x <= 6 && (y === 0 || y === 6))
              || (x >= 2 && x <= 4 && y >= 2 && y <= 4);
        m[ry][cx] = on ? 1 : 0;
      }
    }
  }

  function placeAlignment(m, v) {
    var pos = ALIGN[v - 1], n = m.length, a, b, x, y;
    for (a = 0; a < pos.length; a++) {
      for (b = 0; b < pos.length; b++) {
        var r = pos[a], c = pos[b];
        // Skip the three corners already occupied by finder patterns.
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9)
            || (r >= n - 9 && c <= 8)) continue;
        for (y = -2; y <= 2; y++) {
          for (x = -2; x <= 2; x++) {
            m[r + y][c + x] =
              (Math.max(Math.abs(x), Math.abs(y)) !== 1) ? 1 : 0;
          }
        }
      }
    }
  }

  function placeFunction(m, v) {
    var n = m.length, i, j;
    placeFinder(m, 0, 0);
    placeFinder(m, 0, n - 7);
    placeFinder(m, n - 7, 0);
    placeAlignment(m, v);
    for (i = 8; i < n - 8; i++) {                  // timing patterns
      var on = (i % 2 === 0) ? 1 : 0;
      m[6][i] = on;
      m[i][6] = on;
    }
    // Reserve the format areas so data placement skips them.
    for (i = 0; i <= 8; i++) {
      if (m[8][i] === null) m[8][i] = 0;
      if (m[i][8] === null) m[i][8] = 0;
    }
    for (i = 0; i < 8; i++) {
      if (m[8][n - 1 - i] === null) m[8][n - 1 - i] = 0;
      if (m[n - 1 - i][8] === null) m[n - 1 - i][8] = 0;
    }
    m[n - 8][8] = 1;                               // the always-dark module
    if (v >= 7) {                                  // reserve version info
      for (i = 0; i < 6; i++) {
        for (j = 0; j < 3; j++) {
          m[i][n - 11 + j] = 0;
          m[n - 11 + j][i] = 0;
        }
      }
    }
  }

  function placeData(m, cw) {
    var n = m.length, dir = -1, row = n - 1, bit = 0, total = cw.length * 8;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;                        // the vertical timing column
      for (;;) {
        for (var k = 0; k < 2; k++) {
          var c = col - k;
          if (m[row][c] === null) {
            var val = 0;
            if (bit < total) val = (cw[bit >> 3] >> (7 - (bit & 7))) & 1;
            m[row][c] = val;
            bit++;
          }
        }
        row += dir;
        if (row < 0 || row >= n) { row -= dir; dir = -dir; break; }
      }
    }
  }

  function maskFn(k) {
    switch (k) {
      case 0: return function (y, x) { return (y + x) % 2 === 0; };
      case 1: return function (y) { return y % 2 === 0; };
      case 2: return function (y, x) { return x % 3 === 0; };
      case 3: return function (y, x) { return (y + x) % 3 === 0; };
      case 4: return function (y, x) {
        return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; };
      case 5: return function (y, x) {
        return ((y * x) % 2) + ((y * x) % 3) === 0; };
      case 6: return function (y, x) {
        return ((((y * x) % 2) + ((y * x) % 3)) % 2) === 0; };
      default: return function (y, x) {
        return ((((y + x) % 2) + ((y * x) % 3)) % 2) === 0; };
    }
  }

  // 15-bit BCH format info. EC level M is 0b00.
  function formatBits(mask) {
    var data = (0 << 3) | mask, rem = data, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
    return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
  }

  // 18-bit BCH version info, versions 7 and up.
  function versionBits(v) {
    var rem = v, i;
    for (i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >> 11) & 1) * 0x1f25);
    return (v << 12) | (rem & 0xfff);
  }

  function applyFormat(m, mask) {
    var n = m.length, bits = formatBits(mask), i, b;
    for (i = 0; i < 15; i++) {
      b = (bits >> i) & 1;
      // Copy 1, around the top-left finder.
      if (i < 6) m[i][8] = b;
      else if (i === 6) m[7][8] = b;
      else if (i === 7) m[8][8] = b;
      else if (i === 8) m[8][7] = b;
      else m[8][14 - i] = b;
      // Copy 2, split between the other two finders.
      if (i < 8) m[8][n - 1 - i] = b;
      else m[n - 15 + i][8] = b;
    }
    m[n - 8][8] = 1;                               // dark module, always
  }

  function applyVersion(m, v) {
    if (v < 7) return;
    var n = m.length, bits = versionBits(v), i;
    for (i = 0; i < 18; i++) {
      var b = (bits >> i) & 1;
      var a = Math.floor(i / 3), c = i % 3;
      m[a][n - 11 + c] = b;
      m[n - 11 + c][a] = b;
    }
  }

  // Penalty score, so the mask chosen is the one the format bits claim.
  function penalty(m) {
    var n = m.length, score = 0, i, j, run, dark = 0;
    for (i = 0; i < n; i++) {
      run = 1;
      for (j = 1; j < n; j++) {
        if (m[i][j] === m[i][j - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
      for (j = 1; j < n; j++) {
        if (m[j][i] === m[j - 1][i]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (i = 0; i < n - 1; i++) {
      for (j = 0; j < n - 1; j++) {
        var a = m[i][j];
        if (a === m[i][j + 1] && a === m[i + 1][j] && a === m[i + 1][j + 1]) {
          score += 3;
        }
      }
    }
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function look(get) {
      var y, x, k;
      for (y = 0; y < n; y++) {
        for (x = 0; x + 11 <= n; x++) {
          var m1 = true, m2 = true;
          for (k = 0; k < 11; k++) {
            var val = get(y, x + k);
            if (val !== pat1[k]) m1 = false;
            if (val !== pat2[k]) m2 = false;
          }
          if (m1) score += 40;
          if (m2) score += 40;
        }
      }
    }
    look(function (y, x) { return m[y][x]; });
    look(function (y, x) { return m[x][y]; });
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (m[i][j]) dark++;
    score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return score;
  }

  function matrix(text) { return build(text, -1); }

  // Test seam: force a specific mask so this encoder can be diffed against a
  // reference at the SAME mask. Without it every comparison is apples to
  // oranges, because the two pick masks independently.
  function _debugMask(text, k) { return build(text, k); }

  function build(text, forceMask) {
    var bytes = utf8Bytes(String(text == null ? '' : text));
    var v = pickVersion(bytes.length);
    if (!v) throw new Error('too long for a version-10 QR at level M');
    var cw = interleave(buildCodewords(bytes, v), v);
    var n = v * 4 + 17, x, y, k;

    // Which modules are FUNCTION modules is computed once. Masking must touch
    // data modules only — masking a timing pattern is a subtle way to produce
    // a code that looks right and reads as nothing.
    var fixed = blank(n);
    placeFunction(fixed, v);
    var isFixed = [];
    for (y = 0; y < n; y++) {
      isFixed.push([]);
      for (x = 0; x < n; x++) isFixed[y].push(fixed[y][x] !== null);
    }

    var best = null, bestScore = Infinity;
    for (k = 0; k < 8; k++) {
      if (forceMask >= 0 && k !== forceMask) continue;
      var m = blank(n);
      placeFunction(m, v);
      placeData(m, cw);
      var fn = maskFn(k);
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++) {
          if (!isFixed[y][x] && fn(y, x)) m[y][x] ^= 1;
        }
      }
      applyVersion(m, v);
      applyFormat(m, k);
      var s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  function svg(text, opts) {
    opts = opts || {};
    var m = matrix(text), n = m.length, x, y;
    // A quiet zone is not decoration: a decoder needs it to find the code at
    // all. Four modules is the spec's minimum.
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var size = n + quiet * 2;
    var d = [];
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        if (m[y][x]) d.push('M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' '
      + size + '" shape-rendering="crispEdges" role="img" aria-hidden="true">'
      + '<rect width="' + size + '" height="' + size + '" fill="#fff"/>'
      + '<path d="' + d.join('') + '" fill="#000"/></svg>';
  }

  // ---- field control + accessibility ------------------------------------
  //
  // F143 is deliberately a QR for an EXISTING eBird page, never an encoded
  // coordinate or a home-derived URL. The same destination is already offered
  // as a regular link; this adds an offline, phone-to-phone way to pass it on
  // without widening what a card exposes. `kind` + `id`, not a URL, keeps the
  // card modules presentation-only and prevents arbitrary strings from
  // reaching a rendered QR.
  var QR_KINDS = {
    species: /^[a-z0-9]+$/,
    hotspot: /^L[0-9]+$/,
    checklist: /^S[0-9]+$/
  };
  var QR_LABELS = {
    species: 'Show QR code for eBird species page',
    hotspot: 'Show QR code for eBird hotspot page',
    checklist: 'Show QR code for eBird checklist page'
  };
  var QR_ICON =
    '<svg class="qricon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M3 3h7v7H3zM5 5v3h3V5zm9-2h7v7h-7zm2 2v3h3V5zM3 14h7v7H3zm2 2v3h3v-3zm8-2h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5 0h3v3h-3z"'
    + ' fill="currentColor"/></svg>';

  function control(kind, id) {
    kind = String(kind || '');
    id = String(id || '');
    if (!QR_KINDS[kind] || !QR_KINDS[kind].test(id)) return '';
    return '<button type="button" class="qrbtn qrbtn-' + kind
      + '" data-qr-kind="' + kind + '" data-qr-id="' + id
      + '" aria-label="' + QR_LABELS[kind] + '" title="' + QR_LABELS[kind]
      + '">' + QR_ICON + '</button>';
  }

  // One style for every QR control, injected by the QR feature rather than
  // copied into three card modules. The glyph is never the only cue: its
  // accessible name states the destination and the sheet also provides an
  // ordinary text link to it.
  var CONTROL_CSS = [
    '.qrbtn { box-sizing: border-box; display: inline-flex; align-items: center;',
    '  justify-content: center; width: calc(44px * var(--s, 1));',
    '  height: calc(44px * var(--s, 1)); padding: 0; border: 1px solid var(--line);',
    '  border-radius: 8px; background: var(--card, #fff); color: var(--accent);',
    '  cursor: pointer; vertical-align: middle; }',
    '.qrbtn:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }',
    // IN A NAME ROW THE BUTTON IS A BADGE, NOT A BUTTON. Reported 2026-08-27:
    // "similar size to magnifying glass and next to the species name ... i
    // think all the icons should be next to each other". A 44px box beside a
    // pill-sized tag reads as a separate control, which is what put it on its
    // own line even before the block-level wrapper was fixed.
    //
    // The 44px tap target is NOT given up - it is preserved as an invisible
    // ::after that overflows the smaller visible box, which is the standard
    // way to keep a small glyph tappable. Shrinking the hit area instead would
    // have traded an accessibility floor for a layout preference, and this
    // project already has a CSS-wide guard against fixed boxes with scaling
    // text for exactly that reason.
    '.spact { display: inline-flex; align-items: center; vertical-align: middle;',
    '  margin-left: 6px; }',
    '.spact .qrbtn { position: relative; width: calc(30px * var(--s, 1));',
    '  height: calc(30px * var(--s, 1)); border-radius: 999px; }',
    '.spact .qrbtn::after { content: ""; position: absolute;',
    '  left: 50%; top: 50%; transform: translate(-50%, -50%);',
    '  width: calc(44px * var(--s, 1)); height: calc(44px * var(--s, 1)); }',
    '.spact .qricon { width: calc(17px * var(--s, 1));',
    '  height: calc(17px * var(--s, 1)); }',
    '.qricon { display: block; width: calc(22px * var(--s, 1));',
    '  height: calc(22px * var(--s, 1)); }',
    '.qrshare { display: grid; justify-items: center; gap: 12px; text-align: center; }',
    '.qrshare .qrcode { width: min(72vw, 300px); padding: 12px; box-sizing: border-box;',
    '  background: #fff; border: 1px solid var(--line); border-radius: 10px; }',
    '.qrshare .qrcode svg { display: block; width: 100%; height: auto; }',
    '.qrshare p { margin: 0; line-height: 1.4; }'
  ].join('\n');

  if (typeof document !== 'undefined'
      && !document.querySelector('style[data-bird-qr]')) {
    var style = document.createElement('style');
    style.setAttribute('data-bird-qr', '1');
    style.textContent = CONTROL_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  return { matrix: matrix, svg: svg, control: control, _debugMask: _debugMask,
           // Test seam: the interleaved codeword stream, so it can be compared
           // against a reference byte for byte. The data path and the matrix
           // path fail in the same way from outside — an unreadable code — and
           // this is what tells them apart.
           _debugCodewords: function (text) {
             var bytes = utf8Bytes(String(text == null ? '' : text));
             var v = pickVersion(bytes.length);
             return interleave(buildCodewords(bytes, v), v);
           } };
}));
