'use strict';

const fs = require('node:fs');

const [, , output, channel = 'production', buildId = '', daysText = '0'] = process.argv;
if (!output) throw new Error('Usage: node assets/stamp-build-info.js <output> <channel> <build-id> <days>');
const days = Number(daysText);
const built = new Date();
const beta = channel !== 'production';
if (beta && !(days > 0)) throw new Error('A beta build needs a positive expiry in days');
const info = {
  channel,
  buildId: buildId || null,
  builtAt: built.toISOString(),
  expiresAt: beta ? new Date(built.getTime() + days * 86400000).toISOString() : null,
};
fs.writeFileSync(output, `window.__BUILD_INFO__ = ${JSON.stringify(info, null, 2)};\n`);
console.log(`${channel} build ${buildId || '(local)'} expires ${info.expiresAt || 'never'}`);
