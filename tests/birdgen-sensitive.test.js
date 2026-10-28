'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Sensitive = require(path.join(process.env.BIRDCHASER_WWW
  || path.join(__dirname,'..','www'),'birdgen-sensitive.js'));
const clock = new Intl.DateTimeFormat('en-US', {
  timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit'
});
const first = Date.parse('2026-10-28T17:00:00Z');
const names = {grgowl:'Great Gray Owl',loeowl:'Long-eared Owl'};
function monthAt(time) {
  const parts = clock.formatToParts(new Date(time));
  return parts.find(part => part.type === 'year').value + '-'
    + parts.find(part => part.type === 'month').value;
}
function options(now = first, extra = {}) {
  return {now,monthAt,region:'US-WA',owner:'fixture-owner',...extra};
}
function source(at, codes = [], extra = {}) {
  return {source:'highCountPage',sourceOwner:'fixture-owner',sourceRegion:'US-WA',
    state:'ok',acquired:true,inventoryComplete:true,acquiredAt:at,sourceMonth:monthAt(at),
    sensitiveRows:codes.map(code => ({code,name:names[code] || code,region:'US-WA'})),...extra};
}
function established() {
  return Sensitive.evaluate(null,source(first,['grgowl']),options()).journal;
}
function detection() {
  return Sensitive.evaluate(established(),source(first + 1000,['grgowl','loeowl']),
    options(first + 1000));
}

test('F1142 initial monthly presence is an honest baseline; the next new bird starts its own clock', () => {
  const initial = Sensitive.evaluate(null,source(first,['grgowl']),options());
  assert.deepEqual(initial.alerts,[]);
  assert.equal(initial.journal.entries[0].firstDetectedAt,null);
  const next = detection();
  assert.deepEqual(next.alerts.map(row => row.code),['loeowl']);
  assert.equal(next.alerts[0].firstDetectedAt,first + 1000);
  assert.equal(next.alerts[0].expiresAt,first + 1000 + 86400000);
  assert.equal(next.alerts[0].notificationKey,'sensitive:US-WA:2026-10:loeowl');
});

test('F1142 refresh, restart and removal/reappearance retain the whole first alert without extending expiry', () => {
  let result = detection();
  const saved = structuredClone(result.alerts[0]);
  for (const [offset,codes] of [[3600000,[]],[7200000,['loeowl']],[86401000,['loeowl']]]) {
    const restored = JSON.parse(JSON.stringify(result.journal));
    result = Sensitive.evaluate(restored,source(first + offset,codes,{
      sensitiveRows:codes.map(code => ({code,name:'Later source spelling',region:'US-WA'}))
    }),options(first + offset));
    const entry = result.journal.entries.find(row => row.code === 'loeowl');
    assert.equal(entry.name,saved.name);
    assert.equal(entry.firstDetectedAt,saved.firstDetectedAt);
    assert.equal(entry.expiresAt,saved.expiresAt);
    assert.equal(entry.acquiredAt,saved.acquiredAt);
    assert.equal(result.journal.entries.length,2,
      'refresh must retain one record per monthly identity, including expired alerts');
  }
  assert.deepEqual(result.alerts,[],'the next day must not restart the same monthly alert');
  assert.ok(result.journal.entries.some(row => row.code === 'loeowl'),
    'expiry hides the alert without deleting the monthly record');
});

test('F1142 visibility expires exactly at 24 elapsed hours, including the DST fall-back day', () => {
  const baselineAt = Date.parse('2026-11-01T07:01:00Z');
  const detectedAt = Date.parse('2026-11-01T08:30:00Z');
  const baseline = Sensitive.evaluate(null,source(baselineAt),options(baselineAt)).journal;
  const journal = Sensitive.evaluate(baseline,source(detectedAt,['loeowl']),
    options(detectedAt)).journal;
  assert.equal(Sensitive.visible(journal,options(detectedAt + 86399999)).length,1);
  assert.equal(Sensitive.visible(journal,options(detectedAt + 86400000)).length,0);
  assert.equal(Sensitive.visible(journal,options(detectedAt - 1)).length,0);
});

test('F1142 local month rollover removes old events but needs a positive new-month acquisition to alert', () => {
  const october = detection().journal;
  const stillOctober = Date.parse('2026-11-01T06:59:59Z');
  const november = Date.parse('2026-11-01T07:00:00Z');
  assert.equal(Sensitive.evaluate(october,null,options(stillOctober)).journal.month,'2026-10');
  const rolled = Sensitive.evaluate(october,null,options(november));
  assert.equal(rolled.journal.month,'2026-11');
  assert.deepEqual(rolled.journal.entries,[]);
  assert.deepEqual(rolled.alerts,[]);
  const cached = Sensitive.evaluate(rolled.journal,source(first,['loeowl']),options(november));
  assert.deepEqual(cached.journal,rolled.journal,
    'October cached presence must not poison the new month with an expired event');
  assert.deepEqual(cached.alerts,[]);
  const appeared = november + 4 * 86400000;
  const next = Sensitive.evaluate(cached.journal,source(appeared,['loeowl']),options(appeared));
  assert.equal(next.alerts[0].firstDetectedAt,appeared);
  assert.equal(next.alerts[0].notificationKey,'sensitive:US-WA:2026-11:loeowl');
});

test('F1142 incomplete, failed, cached, future and wrongly owned sources cannot initialize or change history', () => {
  const before = established();
  const at = first + 1000;
  const invalid = [
    {state:'partial'},{state:'failed'},{state:'stale'},{acquired:false},
    {inventoryComplete:false},{source:'other'},{sourceOwner:'other-owner'},
    {sourceRegion:'US-OR'},{sourceMonth:'2026-09'},{acquiredAt:at + 1},
    {acquiredAt:Date.parse('2026-09-30T12:00:00Z')},{sensitiveRows:null},
    {sensitiveRows:[{code:'loeowl',name:'Long-eared Owl',region:'US-OR'}]},
    {sensitiveRows:[{code:'loeowl',name:'',region:'US-WA'}]}
  ];
  for (const change of invalid) {
    const bad = source(at,['loeowl'],change);
    assert.equal(Sensitive.evaluate(null,bad,options(at)).journal,null,JSON.stringify(change));
    const retained = Sensitive.evaluate(before,bad,options(at));
    assert.deepEqual(retained.journal,before,JSON.stringify(change));
    assert.deepEqual(retained.alerts,[]);
  }
});

test('F1142 a repeated or older acquisition cannot add birds or reset an existing first timestamp', () => {
  const current = detection();
  for (const at of [first,first + 1000]) {
    const repeated = Sensitive.evaluate(current.journal,source(at,['loeowl','newcode']),
      options(first + 2000));
    assert.deepEqual(repeated.journal,current.journal);
    assert.equal(repeated.changed,false);
  }
  const backwards = Sensitive.evaluate(current.journal,null,
    options(Date.parse('2026-09-30T12:00:00Z')));
  assert.deepEqual(backwards.journal,current.journal);
  assert.deepEqual(backwards.alerts,[]);
});

test('F1142 region ownership is separate while changing the personal-list owner does not restart public detections', () => {
  const current = detection();
  assert.deepEqual(Sensitive.visible(current.journal,options(first + 2000,{region:'US-OR'})),[]);
  const changedOwner = Sensitive.evaluate(current.journal,
    source(first + 3000,['loeowl'],{sourceOwner:'new-owner'}),
    options(first + 3000,{owner:'new-owner'}));
  assert.equal(changedOwner.alerts[0].firstDetectedAt,first + 1000);
  const otherRegion = options(first + 1000,{region:'US-OR'});
  const baseline = Sensitive.evaluate(null,source(first,[],{sourceRegion:'US-OR'}),otherRegion);
  const independent = Sensitive.evaluate(baseline.journal,source(first + 1000,[],{
    sourceRegion:'US-OR',sensitiveRows:[{code:'loeowl',name:'Long-eared Owl',region:'US-OR'}]
  }),otherRegion);
  assert.equal(independent.alerts[0].notificationKey,'sensitive:US-OR:2026-10:loeowl');
});

test('F1142 damaged history fails closed for this month and recovers at the next positive monthly acquisition', () => {
  let result = Sensitive.evaluate({version:1,entries:'damaged'},
    source(first,['loeowl']),options());
  assert.equal(result.journal.blocked,true);
  result = Sensitive.evaluate(result.journal,source(first + 1000,['grgowl']),options(first + 1000));
  assert.deepEqual(result.alerts,[]);
  const nextMonth = Date.parse('2026-11-05T17:00:00Z');
  result = Sensitive.evaluate(result.journal,source(nextMonth,['loeowl']),options(nextMonth));
  assert.equal(result.alerts[0].firstDetectedAt,nextMonth);
});

test('F1142 first detection uses exact codes and never stores supplied observation dates or locations', () => {
  const next = Sensitive.evaluate(established(),source(first + 1000,[],{
    sensitiveRows:[{code:'grgowl1',name:'Different exact identity',region:'US-WA',
      obsDt:'2026-10-01',lat:12.345,locName:'WITHHELD-FIXTURE'}]
  }),options(first + 1000));
  assert.equal(next.alerts[0].code,'grgowl1');
  assert.equal(next.alerts[0].firstDetectedAt,first + 1000);
  assert.doesNotMatch(JSON.stringify(next.journal),/obsDt|lat|locName|WITHHELD-FIXTURE|2026-10-01/);
});
