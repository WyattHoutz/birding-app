'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

test('F1366 real Chrome Logout automatically reloads into clean Account setup', {timeout:90000}, () => {
  const result=spawnSync(process.execPath,[path.join(__dirname,'..','assets','audit-overflow.js'),'402','1'],{
    env:{...process.env,AUDIT_FOCUS:'logout'},encoding:'utf8',timeout:80000,windowsHide:true
  });
  assert.equal(result.status,0,result.error?.message || result.stdout + result.stderr);
  assert.match(result.stdout,/"logoutReload":true/,'the actual navigation checkpoint must run');
});
