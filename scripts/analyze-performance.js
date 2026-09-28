'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Performance = require('../www/performance-report.js');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/analyze-performance.js <events.jsonl> [...] --out <directory>');
  process.exit(2);
}
const outAt = args.indexOf('--out');
const outDir = path.resolve(outAt >= 0 ? args[outAt + 1] : 'performance-report');
const inputs = (outAt >= 0 ? args.slice(0, outAt) : args).map((file) => path.resolve(file));
const events = [];
for (const file of inputs) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) events.push(JSON.parse(line));
}
const files = Performance.files(events);
fs.mkdirSync(outDir, { recursive: true });
for (const [name, contents] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), contents);
}
console.log(`performance report: ${Performance.analyze(events).samples.length} loads -> ${outDir}`);
