'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'www');
const menu = JSON.parse(fs.readFileSync(path.join(root, 'menu.json'), 'utf8'));
const ids = new Set();
for (const item of menu) {
  for (const field of ['at', 'icon', 'title', 'subtitle', 'group']) {
    if (typeof item[field] !== 'string' || (field !== 'subtitle' && !item[field])) {
      throw new Error(`Invalid menu ${field}: ${item.at}`);
    }
  }
  if (ids.has(item.at)) throw new Error(`Duplicate menu ID: ${item.at}`);
  ids.add(item.at);
  if (item.dynamicSubtitle && !['leaderboard-scope', 'personal-list'].includes(item.dynamicSubtitle)) {
    throw new Error(`Unknown dynamic subtitle: ${item.at}`);
  }
}
const file = path.join(root, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const block = '<script type="application/json" id="menu-definition">\n'
  + JSON.stringify(menu, null, 2).replace(/</g, '\\u003c') + '\n  </script>';
const pattern = /<script type="application\/json" id="menu-definition">[\s\S]*?<\/script>/;
if (!pattern.test(html)) throw new Error('Menu JSON embedding target missing');
const result = html.replace(pattern, block);
if (process.argv.includes('--check')) {
  if (result.replace(/\r\n/g, '\n') !== html.replace(/\r\n/g, '\n')) {
    throw new Error('Run node assets\\build-menu.js to regenerate menu JSON');
  }
} else {
  fs.writeFileSync(file, result);
}
