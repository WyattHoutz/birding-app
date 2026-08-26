/* qr.js — a QR encoder that runs on the device and asks nothing of the network.
 *
 * WHY THIS IS CODE RATHER THAN A URL. Every "just use an API" QR route —
 * api.qrserver.com, chart.googleapis.com — sends the thing being encoded to a
 * third party and needs a connection. This app's architecture is that it has no
 * runtime dependency on anything but eBird, and a QR you cannot draw in a car
 * park with no signal fails exactly when it is wanted: standing next to another
 * birder (F143).
 *
 * SCOPE, chosen deliberately: byte mode, error-correction level M, versions
 * 1-10. That is up to 216 data bytes; the longest thing here is an eBird
 * checklist URL at ~45 characters, so this is roughly four times the headroom
 * needed and the tables stay small.
 *
 * VERIFIED, not assumed: tests/qr.test.js compares EVERY MODULE against the
 * reference `qrcode` Python package over real eBird URLs. A QR encoder that is
 * subtly wrong still looks like a QR code, which is exactly the class of bug
 * that ships.
 */
(function (root) {
  'use strict';

  // ---- GF(256), the field QR's Reed-Solomon works in -----------------------
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;          // the primitive polynomial QR uses
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  }());
  function mul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function genPoly(n) {
    var p = [1];
    for (var i = 0; i < n; i++) {
      var q = p.slice();
      q.push(0);
      for (var j = 0; j < p.length; j++) q[j + 1] ^= mul(p[j], EXP[i]);
      p = q;
    }
    return p;
  }

  function ecBytes(data, n) {
    var g = genPoly(n), res = new Array(data.length + n).fill(0), i, j;
    for (i = 0; i < data.length; i++) res[i] = data[i];
    for (i = 0; i < data.length; i++) {
      var f = res[i];
      if (!f) continue;
      for (j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], f);
    }
    return res.slice(data.length);
  }

  // ---- Version tables, level M ---------------------------------------------
  // [ec codewords per block, group1 blocks, group1 data, group2 blocks, group2 data]
  var M = {
    1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0],
    4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0],
    7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44]
  };
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };
  function dataCapacity(v) { var t = M[v]; return t[1] * t[2] + t[3] * t[4]; }

  function Bits() { this.b = []; }
  Bits.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.b.push((val >>> i) & 1);
  };

  function encodeData(text, version) {
    var bytes = [], i, c;
    // UTF-8, because a place name can carry an accent and a mis-encoded byte is
    // a QR that scans to the WRONG string rather than to nothing.
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    var bits = new Bits();
    bits.put(4, 4);                                   // byte mode
    bits.put(bytes.length, version < 10 ? 8 : 16);
    for (i = 0; i < bytes.length; i++) bits.put(bytes[i], 8);

    var cap = dataCapacity(version) * 8;
    if (bits.b.length > cap) return null;
    for (i = 0; i < 4 && bits.b.length < cap; i++) bits.b.push(0);
    while (bits.b.length % 8) bits.b.push(0);
    var pads = [0xec, 0x11], p = 0;
    while (bits.b.length < cap) { bits.put(pads[p], 8); p ^= 1; }

    var codewords = [];
    for (i = 0; i < bits.b.length; i += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits.b[i + k];
      codewords.push(v);
    }
    return codewords;
  }

  // Split into blocks, compute ECC, then INTERLEAVE. The interleave is the step
  // that is easy to get subtly wrong while still producing a plausible image.
  function finalCodewords(data, version) {
    var t = M[version], ecLen = t[0];
    var blocks = [], at = 0, i, j;
    for (i = 0; i < t[1]; i++) { blocks.push(data.slice(at, at + t[2])); at += t[2]; }
    for (i = 0; i < t[3]; i++) { blocks.push(data.slice(at, at + t[4])); at += t[4]; }
    var eccs = blocks.map(function (b) { return ecBytes(b, ecLen); });
    var out = [], maxLen = 0;
    blocks.forEach(function (b) { if (b.length > maxLen) maxLen = b.length; });
    for (i = 0; i < maxLen; i++) {
      for (j = 0; j < blocks.length; j++) if (i < blocks[j].length) out.push(blocks[j][i]);
    }
    for (i = 0; i < ecLen; i++) {
      for (j = 0; j < eccs.length; j++) out.push(eccs[j][i]);
    }
    return out;
  }

  function newMatrix(size) {
    var m = [], r;
    for (r = 0; r < size; r++) m.push(new Array(size).fill(null));
    return m;
  }
  function placeFinder(m, r, c) {
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var on = (i >= 0 && i <= 6 && (j === 0 || j === 6))
              || (j >= 0 && j <= 6 && (i === 0 || i === 6))
              || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        m[rr][cc] = on ? 1 : 0;
      }
    }
  }
  function placeAlignment(m, version) {
    var cs = ALIGN[version], size = m.length;
    for (var a = 0; a < cs.length; a++) {
      for (var b = 0; b < cs.length; b++) {
        var r = cs[a], c = cs[b];
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (var i = -2; i <= 2; i++) {
          for (var j = -2; j <= 2; j++) {
            m[r + i][c + j] = (Math.max(Math.abs(i), Math.abs(j)) !== 1) ? 1 : 0;
          }
        }
      }
    }
  }
  function markFunction(m, version) {
    var size = m.length, i;
    for (i = 0; i < 9; i++) {
      if (m[8][i] === null) m[8][i] = 0;
      if (m[i][8] === null) m[i][8] = 0;
    }
    for (i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0;
    }
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function formatBits(maskIdx) {
    // Level M is 0b00. BCH(15,5), then XOR with the fixed 0x5412.
    var data = (0 << 3) | maskIdx, d = data << 10;
    for (var i = 4; i >= 0; i--) if (d & (1 << (i + 10))) d ^= 0x537 << i;
    return ((data << 10) | d) ^ 0x5412;
  }
  function versionBits(v) {
    var d = v << 12;
    for (var i = 5; i >= 0; i--) if (d & (1 << (i + 12))) d ^= 0x1f25 << i;
    return (v << 12) | d;
  }

  function penalty(m) {
    var size = m.length, score = 0, r, c, i, k, run, last;
    for (r = 0; r < size; r++) {
      run = 1; last = m[r][0];
      for (c = 1; c < size; c++) {
        if (m[r][c] === last) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; last = m[r][c]; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (c = 0; c < size; c++) {
      run = 1; last = m[0][c];
      for (r = 1; r < size; r++) {
        if (m[r][c] === last) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; last = m[r][c]; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    var pats = [[1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]];
    for (r = 0; r < size; r++) {
      for (c = 0; c <= size - 11; c++) {
        for (i = 0; i < 2; i++) {
          var ok = true;
          for (k = 0; k < 11; k++) if (m[r][c + k] !== pats[i][k]) { ok = false; break; }
          if (ok) score += 40;
        }
      }
    }
    for (c = 0; c < size; c++) {
      for (r = 0; r <= size - 11; r++) {
        for (i = 0; i < 2; i++) {
          var ok2 = true;
          for (k = 0; k < 11; k++) if (m[r + k][c] !== pats[i][k]) { ok2 = false; break; }
          if (ok2) score += 40;
        }
      }
    }
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    score += Math.floor(Math.abs((dark * 100 / (size * size)) - 50) / 5) * 10;
    return score;
  }

  function build(text, version) {
    var data = encodeData(text, version);
    if (!data) return null;
    var all = finalCodewords(data, version);
    var size = version * 4 + 17;
    var m = newMatrix(size), i, r, c;

    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    placeAlignment(m, version);
    for (i = 8; i < size - 8; i++) {
      if (m[6][i] === null) m[6][i] = (i % 2 === 0) ? 1 : 0;
      if (m[i][6] === null) m[i][6] = (i % 2 === 0) ? 1 : 0;
    }
    m[size - 8][8] = 1;                                 // always-dark module
    if (version >= 7) {
      var vb = versionBits(version);
      for (i = 0; i < 18; i++) {
        var bit = (vb >> i) & 1;
        m[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
        m[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
      }
    }
    markFunction(m);

    // `fixed` is captured BEFORE the data goes in, because masking a function
    // module corrupts the code in a way that still scans as *something*.
    var fixed = [];
    for (r = 0; r < size; r++) {
      fixed.push([]);
      for (c = 0; c < size; c++) fixed[r].push(m[r][c] !== null);
    }

    var bitIdx = 0, up = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (var n = 0; n < size; n++) {
        r = up ? (size - 1 - n) : n;
        for (var s = 0; s < 2; s++) {
          c = col - s;
          if (m[r][c] !== null) continue;
          var byteI = bitIdx >> 3;
          m[r][c] = byteI < all.length ? ((all[byteI] >> (7 - (bitIdx & 7))) & 1) : 0;
          bitIdx++;
        }
      }
      up = !up;
    }

    var best = null, bestScore = Infinity;
    for (var mi = 0; mi < 8; mi++) {
      var cand = m.map(function (row) { return row.slice(); });
      for (r = 0; r < size; r++) {
        for (c = 0; c < size; c++) {
          if (!fixed[r][c] && MASKS[mi](r, c)) cand[r][c] ^= 1;
        }
      }
      var fb = formatBits(mi);
      for (i = 0; i < 15; i++) {
        var b = (fb >> i) & 1;
        if (i < 6) cand[8][i] = b;
        else if (i === 6) cand[8][7] = b;
        else if (i === 7) cand[8][8] = b;
        else if (i === 8) cand[7][8] = b;
        else cand[14 - i][8] = b;
        if (i < 8) cand[size - 1 - i][8] = b;
        else cand[8][size - 15 + i] = b;
      }
      var sc = penalty(cand);
      if (sc < bestScore) { bestScore = sc; best = cand; }
    }
    return best;
  }

  function matrix(text) {
    var t = String(text == null ? '' : text);
    for (var v = 1; v <= 10; v++) {
      var m = build(t, v);
      if (m) return m;
    }
    return null;
  }

  // SVG, not canvas: it is a string so it drops straight into innerHTML, it
  // scales to any size without resampling, and it survives the text-scale
  // setting without a second render.
  function svg(text, px) {
    var m = matrix(text);
    if (!m) return '';
    var size = m.length, quiet = 4, total = size + quiet * 2, d = [];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (m[r][c]) d.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '"'
      + ' width="' + (px || 220) + '" height="' + (px || 220) + '" role="img">'
      + '<rect width="' + total + '" height="' + total + '" fill="#fff"/>'
      + '<path d="' + d.join('') + '" fill="#000"/></svg>';
  }

  root.BirdQR = { matrix: matrix, svg: svg };
}(typeof module !== 'undefined' && module.exports ? module.exports : window));
