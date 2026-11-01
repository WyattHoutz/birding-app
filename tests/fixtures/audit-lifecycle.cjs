'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const children = require('node:child_process');
const profiles = new Set();
const mkdir = fs.mkdtempSync;
const remove = fs.rmSync;
fs.mkdtempSync = (...args) => {
  const profile = mkdir(...args);
  profiles.add(profile);
  return profile;
};
let faultReported = false;
fs.rmSync = (target, options) => {
  if (profiles.has(target) && process.env.AUDIT_LIFECYCLE_CLEANUP === 'fail') {
    if (!faultReported) console.log('FORCED_PROFILE_CLEANUP_FAILURE');
    faultReported = true;
    throw Object.assign(new Error('controlled profile lock'), { code: 'EBUSY' });
  }
  return remove(target, options);
};
process.on('exit', () => {
  for (const profile of profiles) remove(profile, { recursive: true, force: true });
});
let clock = Date.now();
Date.now = () => (clock += 1000);
process.kill = () => true;
children.spawn = () => {
  console.log('BROWSER_SPAWN');
  return { pid: process.pid, kill: () => true };
};
children.spawnSync = (program, args, options) => {
  console.log('HELPER_TIMEOUT=' + options.timeout);
  if (process.env.AUDIT_LIFECYCLE_HELPERS === 'fail') {
    return { status: null, error: Object.assign(new Error('controlled helper timeout'), { code: 'ETIMEDOUT' }) };
  }
  return { status: 0 };
};
http.createServer = (handler) => ({
  address: () => ({ port: 1 }),
  close() {},
  listen(port, host, ready) {
    ready();
    if (process.env.AUDIT_LIFECYCLE_REPORT !== 'none') setImmediate(() => {
      const request = new EventEmitter();
      request.method = 'POST';
      request.url = '/__audit';
      handler(request, { writeHead() {}, end() {} });
      request.emit('data', '[]');
      request.emit('end');
    });
  },
});

const mutation = process.env.AUDIT_LIFECYCLE_MUTATION;
const compile = Module.prototype._compile;
Module.prototype._compile = function(source, filename) {
  if (mutation && filename.endsWith(path.join('assets', 'audit-overflow.js'))) {
    source = source.replace(/\r/g, '');
    const choices = {
      report: ['clearTimeout(timer);\n    cleanupOrFail();', 'clearTimeout(timer);\n    teardown();'],
      retry: ['cleanupOrFail();\n    if (attempt < MAX_ATTEMPTS)', 'teardown();\n    if (attempt < MAX_ATTEMPTS)'],
      budget: [
        "  if (!Number.isSafeInteger(TIMEOUT_MS) || TIMEOUT_MS <= 0 || TIMEOUT_MS > 2147483647) {\n"
          + "    console.error('Invalid AUDIT_TIMEOUT_MS: expected positive timer-range milliseconds.');\n"
          + "    server.close();\n    process.exit(2);\n  }",
        '',
      ],
      helpers: ['return verified;\n  };\n\n  // Windows releases', 'return true;\n  };\n\n  // Windows releases'],
    };
    if (mutation === 'timeout') {
      assert.equal(source.split(', timeout: TIMEOUT_MS').length, 4);
      source = source.replaceAll(', timeout: TIMEOUT_MS', '');
    } else {
      const pair = choices[mutation];
      assert.ok(pair, 'unknown audit mutation');
      assert.equal(source.split(pair[0]).length, 2, 'audit mutation must match once');
      source = source.replace(pair[0], pair[1]);
    }
    console.log('APPLIED_AUDIT_MUTATION=' + mutation);
  }
  return compile.call(this, source, filename);
};
