'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function digestFiles(root, names) {
  return hash(JSON.stringify(names.sort().map(name => {
    const file = path.join(root, name);
    return [name.replaceAll('\\', '/'), hash(fs.readFileSync(file))];
  })));
}

function dependencies(root) {
  const names = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isSymbolicLink()) {
        const relative = path.relative(root, fs.realpathSync(file));
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error('Benchmark dependency link escapes its input tree');
        }
        names.push(path.relative(root, file));
      } else if (entry.isFile()) names.push(path.relative(root, file));
      else throw new Error('Benchmark dependency is not an ordinary file');
    }
  }
  walk(root);
  return digestFiles(root, names);
}

function snapshot(root) {
  const outputs = new Set(['benchmark-before.json', 'benchmark-after.json',
    'benchmark-catalog.log', 'benchmark-layout.log']);
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }).split('\0')
    .filter(name => name && !name.startsWith('node_modules/') && !outputs.has(name));
  const catalog = names.filter(name => /^tests\/[^/]+\.test\.js$/.test(name)).sort();
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  if (!catalog.length || !scripts.test || !scripts['test:layout']) {
    throw new Error('Benchmark requires the complete test and layout commands');
  }
  return {
    sourceFiles: digestFiles(root, names), dependencies: dependencies(path.join(root, 'node_modules')),
    catalog, commands: { catalog: scripts.test, layout: scripts['test:layout'] },
  };
}

function capture(root, phase, role) {
  if (!['before', 'after'].includes(phase) || !['serial', 'catalog', 'layout'].includes(role)) {
    throw new Error('Expected before/after and serial/catalog/layout');
  }
  if (process.platform !== 'linux' || !process.version.startsWith('v22.')) {
    throw new Error('Hosted benchmark requires Linux and the production Node 22 runtime');
  }
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (source !== process.env.GITHUB_SHA) throw new Error('Benchmark checkout differs from the event source');
  const browser = process.env.CHROME_BIN;
  if (!browser || !fs.existsSync(browser)) throw new Error('Benchmark requires explicit CHROME_BIN');
  const resolved = fs.realpathSync(browser);
  const nativeBrowser = path.join(path.dirname(resolved), 'chrome');
  if (!fs.existsSync(nativeBrowser)) throw new Error('Cannot identify the actual hosted Chrome binary');
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => /^(NODE_OPTIONS|TZ|LANG|LC_ALL|CHROME_BIN|BIRDCHASER_.+)$/.test(name)));
  const evidence = {
    schema: 1, source, phase, role, runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT, capturedAt: new Date().toISOString(),
    inputs: snapshot(root),
    runtime: {
      node: process.version, nodeSha256: hash(fs.readFileSync(process.execPath)),
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      browser: execFileSync(browser, ['--version'], { encoding: 'utf8' }).trim(),
      browserSha256: hash(fs.readFileSync(nativeBrowser)),
      image: process.env.ImageOS, imageVersion: process.env.ImageVersion,
      environment: hash(JSON.stringify(Object.entries(environment).sort())),
    },
  };
  const file = path.join(root, `benchmark-${phase}.json`);
  if (phase === 'after') {
    const before = JSON.parse(fs.readFileSync(path.join(root, 'benchmark-before.json'), 'utf8'));
    if (JSON.stringify([before.inputs, before.runtime]) !== JSON.stringify([evidence.inputs, evidence.runtime])) {
      throw new Error('Benchmark inputs changed during validation');
    }
  }
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
}

module.exports = { snapshot };
if (require.main === module) capture(path.resolve(__dirname, '..'), process.argv[2], process.argv[3]);
