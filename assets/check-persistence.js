'use strict';

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const crypto = require('node:crypto');

const scalarKeys = new Set([
  'PROFILE_PTR', 'PROFILE_IDENTITY_MIGRATION_KEY', 'WEB_SESSION_BLOCK_KEY',
  'DISPLAY_KEY', 'UI_SCALE_KEY', 'A11Y_KEY', 'THEME_KEY', 'MAP_PROVIDER_KEY', 'PERSONAL_PERIOD_KEY',
  'RARITY_SORT_KEY', 'RARITY_NOTES_KEY', 'TWITCH_VIEW_KEY', 'BIRDIEST_RADIUS_KEY',
  'CACHE_LOG_KEY', 'IDENTITY_REV_KEY', 'SETUP_STEP_KEY', 'SEEN_SETUP_SKIP_KEY',
  'PATCH_BOARD_KEY', 'PATCH_SORT_KEY', 'PATCH_REGION_KEY', 'ABA_SORT_KEY',
  'MEGA_VIEW_KEY', 'K.api', 'K.field', 'K.report', '"bc_profile"',
  '"ebird_api_key"', '"ebird_display_name"', '"ebird_aba_sid"',
  '"ebird_seed_dismissed"', '"ebird_home_migrated_v1"', '"bc_setup_dismissed_v1"',
  '"bc_logout_setup_account"', '"bc_name_locale"', 'CHASE_MI_KEY',
  '"bc_manual_retry_controls_v1"', '"ebird_tide_station"'
]);
const rawReaders = new Set([
  'localStorage.getItem', '_persistence.text.read', '_persistence.text.write', 'storedBytes',
  '_debugPersistence.text.read', '_debugPersistence.text.write',
  'storeWithReclaim', 'cacheDiagnostics', 'storeReport', 'storeComposition',
  'zcActivityReport'
]);
const rawWriters = new Set(['localStorage.setItem', 'storeWithReclaim', '_debugPersistence.text.write']);
const normalize = value => value.replace(/\s+/g, '').replace(/'/g, '"');

function scalarKey(value) {
  if (/^bcReal\(.+\)$/.test(value)) return scalarKey(value.slice(7, -1));
  return scalarKeys.has(value)
    || /^(?:chaseMiKey|tideKey|countyViewKey|rankScopeKey|recScopeKey)\(\)$/.test(value)
    || /^homeKey\((?:"(?:lat|lng|place)"|field)(?:,slug)?\)$/.test(value)
    || /^"ebird_home_(?:lat|lng|place)"(?:\+(?:suffix|candidate\.legacySuffix))?$/.test(value)
    || /^"bc_api_verified_v1:"\+bcProfile\(\)$/.test(value)
    || /^RANK_RETRY_NS\+owner$/.test(value);
}

function analyzeJavaScript(source, file = 'www/index.html', offset = 0, sourceType = 'script') {
  const findings = [];
  const adapterFactories = new Set();
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType, locations: true });
  } catch (error) {
    return [{ file, line: offset + (error.loc?.line || 1), owner: '<parse>',
      operation: 'unparsed-runtime-source', reason: error.message }];
  }
  const text = node => node && Number.isInteger(node.start) ? source.slice(node.start, node.end) : '';
  function keyText(node) {
    if (!node) return '';
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'Literal') return JSON.stringify(node.value);
    if (node.type === 'CallExpression') return keyText(node.callee)
      + '(' + node.arguments.map(keyText).join(',') + ')';
    if (node.type === 'BinaryExpression') return keyText(node.left) + node.operator + keyText(node.right);
    if (node.type === 'MemberExpression' && !node.computed) return keyText(node.object) + '.' + node.property.name;
    return text(node);
  }
  function bindings(body, parent) {
    const scope = new Map();
    scope.parent = parent;
    const remember = (name, value) => scope.set(name, [...(scope.get(name) || []), value]);
    function collect(node) {
      if (!node || typeof node !== 'object' || /Function/.test(node.type)) return;
      if (node.type === 'VariableDeclarator') {
        if (node.id.type === 'Identifier') remember(node.id.name, node.init);
        if (node.id.type === 'ObjectPattern') {
          for (const property of node.id.properties) {
            if (property.type === 'Property' && property.value.type === 'Identifier') {
              remember(property.value.name, { type: 'MemberExpression',
                object: node.init, property: property.key, computed: property.computed });
            }
          }
        }
      }
      if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
        remember(node.left.name, node.right);
      }
      children(node).forEach(collect);
    }
    collect(body);
    return scope;
  }
  function lookup(scope, name) {
    for (; scope; scope = scope.parent) if (scope.has(name)) return scope.get(name);
    return null;
  }
  function resolve(node, scope, seen = new Set()) {
    if (node?.type !== 'Identifier' || seen.has(node.name)) return node;
    if (/^(?:localStorage|sessionStorage|_rawLS)$/.test(node.name)) return node;
    seen.add(node.name);
    const values = lookup(scope, node.name);
    if (!values) return node;
    const candidates = values.filter(Boolean).map(value => resolve(value, scope, new Set(seen)));
    const priority = value => value.type === 'MemberExpression' ? 6
      : value.type === 'CallExpression' ? 5
      : value.type === 'Identifier' && /^(?:localStorage|sessionStorage|_rawLS)$/.test(value.name) ? 4
      : value.type === 'Literal' && value.value === 'setItem' ? 3
      : value.type === 'Literal' ? 2 : 1;
    return candidates.sort((a, b) => priority(b) - priority(a))[0] || node;
  }
  function property(node, scope) {
    if (!node.computed) return node.property.name;
    const value = resolve(node.property, scope);
    if (value?.type === 'Literal') return String(value.value);
    if (value?.type === 'BinaryExpression' && value.operator === '+') {
      const left = resolve(value.left, scope), right = resolve(value.right, scope);
      if (left?.type === 'Literal' && right?.type === 'Literal') return String(left.value) + right.value;
    }
    return null;
  }
  function storage(node, scope) {
    if (node?.type === 'Identifier' && /^(?:localStorage|sessionStorage|_rawLS)$/.test(node.name)) return true;
    node = resolve(node, scope);
    if (node?.type === 'Identifier' && /^(?:localStorage|sessionStorage|_rawLS)$/.test(node.name)) return true;
    return node?.type === 'MemberExpression'
      && /^(?:localStorage|sessionStorage)$/.test(property(node, scope))
      && /^(?:window|globalThis|self)$/.test(text(node.object));
  }
  function objectStore(node, scope) {
    node = resolve(node, scope);
    return node?.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && property(node.callee, scope) === 'objectStore';
  }
  function persistenceObject(node, scope) {
    return /BirdPersistence/.test(text(node)) || /BirdPersistence/.test(text(resolve(node, scope)));
  }
  function jsonValue(node, scope, seen = new Set()) {
    if (!node) return false;
    if (node.type === 'Identifier') {
      if (seen.has(node.name)) return false;
      seen.add(node.name);
      return (lookup(scope, node.name) || []).some(value => jsonValue(value, scope, new Set(seen)));
    }
    if (node.type === 'ObjectExpression' || node.type === 'ArrayExpression') return true;
    if (node.type === 'Literal' && typeof node.value === 'string' && /^[\[{]/.test(node.value.trim())) return true;
    if (node.type === 'MemberExpression') return false;
    if (node.type === 'CallExpression') {
      if (normalize(text(node.callee)) === 'JSON.stringify') return true;
      return node.callee.type === 'Identifier' && node.callee.name === 'String'
        && node.arguments.some(child => jsonValue(child, scope, new Set(seen)));
    }
    if (node.type === 'ConditionalExpression') {
      return jsonValue(node.consequent, scope, new Set(seen))
        || jsonValue(node.alternate, scope, new Set(seen));
    }
    return children(node).some(child => jsonValue(child, scope, new Set(seen)));
  }
  function serializedJson(node, scope, seen = new Set()) {
    if (!node) return false;
    if (node.type === 'Identifier') {
      if (seen.has(node.name)) return false;
      seen.add(node.name);
      return (lookup(scope, node.name) || []).some(value => serializedJson(value, scope, new Set(seen)));
    }
    if (node.type === 'CallExpression' && normalize(text(node.callee)) === 'JSON.stringify') return true;
    return children(node).some(child => serializedJson(child, scope, new Set(seen)));
  }
  function walk(node, owner, scope, declaration = '', parent = null) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator') declaration = text(node.id);
    if (node.type === 'Property') declaration = declaration
      ? declaration + '.' + text(node.key) : text(node.key);
    if (/Function/.test(node.type)) {
      owner = node.id?.name || declaration || owner;
      scope = bindings(node.body, scope);
      declaration = '';
    }
    if (node.type === 'MemberExpression' && storage(node.object, scope)
        && /^(?:getItem|setItem)$/.test(property(node, scope))
        && !(parent?.type === 'CallExpression' && parent.callee === node)
        && !(file === 'www/index.html' && (rawReaders.has(owner) || rawWriters.has(owner)))) {
      findings.push({ file, line: offset + node.loc.start.line, owner,
        operation: 'escaped-storage-method', reason: 'Raw storage method handles may not escape the adapter.' });
    }
    if (node.type === 'MemberExpression' && persistenceObject(node.object, scope)
        && property(node, scope) === 'indexedDb'
        && !(parent?.type === 'CallExpression' && parent.callee === node)) {
      findings.push({ file, line: offset + node.loc.start.line, owner,
        operation: 'escaped-persistence-adapter', reason: 'Raw adapter factories must remain inside the persistence interface.' });
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && storage(node.init, scope)
        && node.id.properties.some(field => /^(?:getItem|setItem)$/.test(field.key?.name || field.key?.value))) {
      findings.push({ file, line: offset + node.loc.start.line, owner,
        operation: 'escaped-storage-method', reason: 'Raw storage methods may not be destructured outside the adapter.' });
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      let target = resolve(node.callee, scope);
      if (target?.type === 'CallExpression' && target.callee.type === 'MemberExpression'
          && property(target.callee, scope) === 'bind') target = resolve(target.callee.object, scope);
      if (target?.type === 'MemberExpression' && /^(?:call|apply)$/.test(property(target, scope))) {
        target = resolve(target.object, scope);
      }
      const method = target?.type === 'MemberExpression' ? property(target, scope) : null;
      const physical = target?.type === 'MemberExpression'
        && (storage(target.object, scope) || /^(?:getItem|setItem)$/.test(method));
      const idb = target?.type === 'MemberExpression' && objectStore(target.object, scope);
      let operation = null;
      if (physical && (!method || !/^(?:getItem|setItem|removeItem|key|clear)$/.test(method))) {
        operation = 'dynamic-storage-access';
      } else if (physical && /^(?:getItem|setItem)$/.test(method)) {
        const key = keyText(node.arguments[0]);
        const scalar = scalarKey(key) && (method !== 'setItem' || !jsonValue(node.arguments[1], scope));
        const adapter = file === 'www/index.html'
          && (method === 'getItem' ? rawReaders : rawWriters).has(owner)
          && (method !== 'setItem' || !jsonValue(node.arguments[1], scope));
        if (!scalar && !adapter) operation = method === 'setItem' ? 'direct-payload-write' : 'direct-payload-read';
      } else if (idb && /^(?:get|getAll|put|add)$/.test(method)) {
        const binaryAdapter = file === 'www/index.html'
          && (method === 'get' && owner === 'idbReadRaw'
            || method === 'put' && owner === 'idbWriteRaw' && text(node.arguments[0]) === 'blob');
        const jsonAdapter = file === 'www/persistence.js'
          && (method === 'get' && (owner === 'read' || owner === 'mutate')
            || method === 'put' && owner === 'commit' && text(node.arguments[0]) === 'row');
        if (!binaryAdapter && !jsonAdapter) operation = 'raw-indexeddb-' + method;
      } else if (target?.type === 'Identifier' && target.name === 'storeWithReclaim'
          && !(file === 'www/index.html' && owner === '_persistence.text.write'
            && !jsonValue(node.arguments[1], scope))) {
        operation = 'direct-reclaim-write';
      } else if (target?.type === 'Identifier' && /^idb(?:Read|Write)Raw$/.test(target.name)) {
        operation = 'binary-adapter-bypass';
      } else if (method === 'putBinary' && serializedJson(node.arguments[1], scope)) {
        operation = 'json-disguised-as-binary';
      } else if (method === 'indexedDb' && persistenceObject(target.object, scope)
          && !adapterFactories.has(node)) {
        operation = 'persistence-adapter-bypass';
      } else if (method === 'create' && persistenceObject(target.object, scope)) {
        const options = resolve(node.arguments[0], scope);
        const fields = options?.type === 'ObjectExpression' ? options.properties : [];
        const option = name => fields.find(field => field.type === 'Property'
          && (field.key.name || field.key.value) === name)?.value;
        const codec = resolve(option('codec'), scope);
        const methods = codec?.type === 'ObjectExpression' ? codec.properties : [];
        const codecMethod = name => methods.find(field => field.type === 'Property'
          && (field.key.name || field.key.value) === name)?.value;
        if (!fields.length || option('codec')
            && !(file === 'www/index.html'
              && codecMethod('pack')?.type === 'Identifier' && codecMethod('pack').name === 'packJson'
              && codecMethod('unpack')?.type === 'Identifier' && codecMethod('unpack').name === 'unpackJson')) {
          operation = 'unreviewed-persistence-codec';
        }
        if (!operation && option('text')?.type === 'CallExpression') adapterFactories.add(option('text'));
      }
      if (operation) findings.push({ file, line: offset + node.loc.start.line, owner,
        operation, reason: normalize(text(node)).slice(0, 160) });
    }
    children(node).forEach(child => walk(child, owner, scope, declaration, node));
  }
  walk(ast, '<top-level>', bindings(ast, null));
  return findings;
}

function children(node) {
  return Object.entries(node).filter(([key]) => key !== 'loc')
    .flatMap(([, value]) => Array.isArray(value) ? value
      : value && typeof value === 'object' ? [value] : []);
}

function analyzeSwift(source, file) {
  source = source.replace(/\r\n/g, '\n');
  const findings = [];
  const functions = [];
  const adapterStart = source.indexOf('enum BirdNotificationPersistence {');
  const adapterEnd = source.indexOf('\n\nprivate let birdGenNotificationPendingOpenKey', adapterStart);
  const adapter = adapterStart >= 0 && adapterEnd > adapterStart
    ? source.slice(adapterStart, adapterEnd).replace(/\r\n/g, '\n') : '';
  const reviewedAdapter = file === 'native/ios/BirdGenNotifications.swift'
    && crypto.createHash('sha256').update(adapter).digest('hex')
      === '8a987e573d797ddfc76708db9a73e8d26cd0848be16f46d7242b856964ecaafa';
  const insideAdapter = position => reviewedAdapter && position >= adapterStart && position < adapterEnd;
  if (adapterStart >= 0 && !reviewedAdapter) {
    findings.push({ file, line: source.slice(0, adapterStart).split('\n').length,
      owner: 'BirdNotificationPersistence', operation: 'unreviewed-native-persistence-adapter',
      reason: 'Native adapter changes require renewed byte-format, backend and mutation verification.' });
  }
  const clean = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/"(?:\\.|[^"\\])*"/g, match => match.replace(/[^\n]/g, ' '));
  for (const match of clean.matchAll(/\bfunc\s+([A-Za-z_]\w*)[^{]*\{/g)) {
    const start = match.index + match[0].length;
    let end = start, depth = 1;
    while (end < clean.length && depth) {
      if (clean[end] === '{') depth++;
      if (clean[end] === '}') depth--;
      end++;
    }
    const body = clean.slice(start, end), owner = match[1];
    if (insideAdapter(match.index)) continue;
    const json = /(?:JSONEncoder\(\)\.encode|JSONSerialization\.data)/.test(body);
    const exportOnly = file === 'native/ios/ViewController.swift'
      && /^(?:createReportPDF|sharePersonalLists|shareDiagnosticPackage)$/.test(owner);
    functions.push({ start, end, owner, json });
    if (json
        && /(?:\.write\s*\(|\.set\s*\()/.test(body)) {
      findings.push({ file, line: source.slice(0, start).split('\n').length,
        owner, operation: 'raw-native-json-write', reason: 'JSONEncoder output bypasses compression.' });
    } else if (!exportOnly && /\.write\s*\(/.test(body)) {
      findings.push({ file, line: source.slice(0, start).split('\n').length,
        owner, operation: 'direct-native-file-write', reason: 'Native file writes require a reviewed persistence adapter.' });
    }
    if (/Data\s*\(contentsOf:/.test(body)) {
      findings.push({ file, line: source.slice(0, start).split('\n').length,
        owner, operation: 'direct-native-file-read', reason: 'Native file reads require a reviewed persistence adapter.' });
    }
  }
  for (const match of clean.matchAll(/\b(?:defaults|UserDefaults\.standard)\.data\s*\(/g)) {
    if (insideAdapter(match.index)) continue;
    findings.push({ file, line: source.slice(0, match.index).split('\n').length,
      owner: '<native defaults>', operation: 'direct-native-data-read',
      reason: 'Persisted Data must be read through the typed persistence interface.' });
  }
  for (const match of clean.matchAll(/\b(?:defaults|UserDefaults\.standard)\.set\s*\(/g)) {
    if (insideAdapter(match.index)) continue;
    const start = match.index + match[0].length;
    let end = start, depth = 1;
    while (end < clean.length && depth) {
      if (clean[end] === '(') depth++;
      if (clean[end] === ')') depth--;
      end++;
    }
    const owner = functions.find(fn => start >= fn.start && start < fn.end);
    if (owner?.json) continue;
    const args = clean.slice(start, end);
    const key = /forKey:\s*([\w.]+)/.exec(args)?.[1];
    if (!/^(?:(?:instance\.)?errorKey|birdGenNotificationPendingOpenKey)$/.test(key || '')) {
      findings.push({ file, line: source.slice(0, match.index).split('\n').length,
        owner: owner?.owner || '<native defaults>', operation: 'direct-native-data-write',
        reason: 'Only reviewed scalar UserDefaults keys may bypass payload compression.' });
    }
  }
  return findings;
}

function analyzeHtml(source, file, root) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(source, { includeNodeLocations: true });
  const findings = [];
  try {
    for (const script of dom.window.document.querySelectorAll('script')) {
      const type = (script.getAttribute('type') || '').trim().toLowerCase();
      if (/^application\/(?:ld\+)?json$/.test(type)) continue;
      const location = dom.nodeLocation(script);
      if (script.hasAttribute('src')) {
        if (!root) continue;
        const base = 'https://persistence.invalid';
        const url = new URL(script.getAttribute('src'), base + '/');
        const www = path.join(root, 'www');
        const target = path.join(www, decodeURIComponent(url.pathname));
        const relative = path.relative(www, target);
        if (url.origin !== base || relative.startsWith('..') || path.isAbsolute(relative)
            || !/\.(?:js|mjs|cjs)$/.test(target) || !fs.existsSync(target)) {
          findings.push({ file, line: location.startLine, owner: '<script>',
            operation: 'unreviewed-runtime-script', reason: 'Runtime script is outside the audited source inventory.' });
        }
        continue;
      }
      const offset = source.slice(0, location.startTag.endOffset).split('\n').length - 1;
      findings.push(...analyzeJavaScript(script.textContent, file, offset, type === 'module' ? 'module' : 'script'));
    }
  } finally { dom.window.close(); }
  return findings;
}

function audit(root) {
  const findings = [];
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { scan(full); continue; }
      const file = path.relative(root, full).split(path.sep).join('/');
      if (!/\.(?:js|mjs|cjs|html|swift)$/.test(file)) continue;
      const source = fs.readFileSync(full, 'utf8');
      if (file.endsWith('.swift')) findings.push(...analyzeSwift(source, file));
      else if (/\.(?:js|mjs|cjs)$/.test(file)) findings.push(...analyzeJavaScript(source, file, 0,
        file.endsWith('.mjs') ? 'module' : 'script'));
      else findings.push(...analyzeHtml(source, file, root));
    }
  }
  for (const directory of ['www', path.join('native', 'ios')]) scan(path.join(root, directory));
  return findings;
}

if (require.main === module) {
  const findings = audit(path.join(__dirname, '..'));
  if (findings.length) {
    console.error('BLOCKED: ' + findings.length + ' persistence-layer bypasses. No legacy baseline exemptions.');
    for (const row of findings) console.error(`${row.file}:${row.line} ${row.owner}: ${row.operation} - ${row.reason}`);
    process.exitCode = 1;
  } else console.log('OK: persistence compression gate passed; binary payloads use the typed binary adapter.');
}

module.exports = { analyzeJavaScript, analyzeSwift, analyzeHtml, audit };
