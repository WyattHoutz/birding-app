(function (global) {
  'use strict';

  var table = null;
  function crc32(bytes) {
    if (!table) {
      table = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(value));
    return Uint8Array.from(Buffer.from(String(value), 'utf8'));
  }

  function base64Bytes(value) {
    if (!value) return new Uint8Array(0);
    if (typeof atob === 'function') {
      var raw = atob(value), out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    }
    return Uint8Array.from(Buffer.from(value, 'base64'));
  }

  function concat(parts) {
    var size = parts.reduce(function (sum, part) { return sum + part.length; }, 0);
    var out = new Uint8Array(size), offset = 0;
    parts.forEach(function (part) { out.set(part, offset); offset += part.length; });
    return out;
  }

  function header(size) {
    return { bytes: new Uint8Array(size), view: null };
  }

  function view(block) {
    return block.view || (block.view = new DataView(block.bytes.buffer));
  }

  function write16(block, offset, value) { view(block).setUint16(offset, value, true); }
  function write32(block, offset, value) { view(block).setUint32(offset, value >>> 0, true); }

  function zip(files) {
    var local = [], central = [], offset = 0;
    Object.keys(files).sort().forEach(function (name) {
      var nameBytes = utf8(name);
      var data = typeof files[name] === 'string' ? utf8(files[name]) : files[name];
      data = data instanceof Uint8Array ? data : new Uint8Array(data || []);
      var crc = crc32(data);
      var lh = header(30);
      write32(lh, 0, 0x04034B50); write16(lh, 4, 20);
      write16(lh, 6, 0); write16(lh, 8, 0);
      write16(lh, 10, 0); write16(lh, 12, 0);
      write32(lh, 14, crc); write32(lh, 18, data.length); write32(lh, 22, data.length);
      write16(lh, 26, nameBytes.length); write16(lh, 28, 0);
      local.push(lh.bytes, nameBytes, data);

      var ch = header(46);
      write32(ch, 0, 0x02014B50); write16(ch, 4, 20); write16(ch, 6, 20);
      write16(ch, 8, 0); write16(ch, 10, 0);
      write16(ch, 12, 0); write16(ch, 14, 0);
      write32(ch, 16, crc); write32(ch, 20, data.length); write32(ch, 24, data.length);
      write16(ch, 28, nameBytes.length); write16(ch, 30, 0); write16(ch, 32, 0);
      write16(ch, 34, 0); write16(ch, 36, 0); write32(ch, 38, 0);
      write32(ch, 42, offset);
      central.push(ch.bytes, nameBytes);
      offset += lh.bytes.length + nameBytes.length + data.length;
    });
    var centralBytes = concat(central);
    var end = header(22);
    var count = Object.keys(files).length;
    write32(end, 0, 0x06054B50);
    write16(end, 8, count); write16(end, 10, count);
    write32(end, 12, centralBytes.length); write32(end, 16, offset);
    write16(end, 20, 0);
    return concat(local.concat([centralBytes, end.bytes]));
  }

  function toBase64(bytes) {
    if (typeof btoa === 'function') {
      var raw = '', step = 0x8000;
      for (var i = 0; i < bytes.length; i += step) {
        raw += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
      }
      return btoa(raw);
    }
    return Buffer.from(bytes).toString('base64');
  }

  function normalizeBuildInfo(value) {
    value = value || {};
    var channel = String(value.channel || 'production').toLowerCase();
    return {
      channel: channel,
      buildId: value.buildId == null ? null : String(value.buildId),
      builtAt: value.builtAt || null,
      expiresAt: value.expiresAt || null,
      beta: channel !== 'production'
    };
  }

  function expiryState(value, now) {
    var info = normalizeBuildInfo(value);
    if (!info.beta || !info.expiresAt) {
      return { beta: info.beta, expired: false, expiresAt: null, daysRemaining: null };
    }
    var expiry = Date.parse(info.expiresAt);
    var at = now == null ? Date.now() : Number(now);
    if (!isFinite(expiry)) {
      return { beta: true, expired: true, expiresAt: info.expiresAt, daysRemaining: 0 };
    }
    return {
      beta: true,
      expired: at >= expiry,
      expiresAt: new Date(expiry).toISOString(),
      daysRemaining: Math.max(0, Math.ceil((expiry - at) / 86400000))
    };
  }

  function packageFiles(auditBundle, options) {
    options = options || {};
    var info = normalizeBuildInfo(options.buildInfo);
    var files = {};
    Object.keys((auditBundle && auditBundle.files) || {}).forEach(function (name) {
      files[name] = auditBundle.files[name];
    });
    var packageId = 'd_' + Date.now().toString(36) + '_'
      + Math.floor((options.random || Math.random)() * 0xFFFFFF).toString(36);
    var manifest = Object.assign({}, (auditBundle && auditBundle.manifest) || {}, {
      package_id: packageId,
      build: info,
      environment: options.environment || {},
      storage_inventory: options.storageInventory || {},
      tester_note_included: !!String(options.note || '').trim(),
      screenshot_included: !!options.screenshotBase64
    });
    files['README.txt'] = [
      'Bird Chaser beta diagnostic package',
      '',
      'Created only after the tester opened the preview and chose Share.',
      'No file was uploaded automatically.',
      '',
      'Included: structured events, safe Settings revisions, build/device class,',
      'and aggregate cache/storage inventory. A screenshot is included only when',
      'the tester selected that option.',
      '',
      'Excluded before persistence: credentials, cookies, account identity, exact',
      'coordinates and addresses, personal lists, raw request/response bodies,',
      'third-party HTML, photo caches, and advertising identifiers.'
    ].join('\n') + '\n';
    if (String(options.note || '').trim()) {
      files['tester-note.txt'] = String(options.note).trim().slice(0, 4000) + '\n';
    }
    if (options.screenshotBase64) {
      files['screenshot.jpg'] = base64Bytes(options.screenshotBase64);
    }
    manifest.files = Object.keys(files).concat(['manifest.json']).sort();
    files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
    return { id: packageId, manifest: manifest, files: files };
  }

  var API = {
    normalizeBuildInfo: normalizeBuildInfo,
    expiryState: expiryState,
    packageFiles: packageFiles,
    zip: zip,
    toBase64: toBase64
  };
  global.BirdDiagnostics = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}(typeof window !== 'undefined' ? window : globalThis));
