'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Performance = require('../www/performance-report.js');

function eventSink(rows) {
  return (name, values) => {
    const row = {
      event: name,
      operation_id: values.operationId,
      category: values.category,
      outcome: values.outcome,
      attrs: values.attrs,
    };
    rows.push(row);
    return row;
  };
}

test('F623 staged report loads preserve exact milestone ordering and elapsed time', () => {
  let now = 1000;
  const rows = [];
  const tracker = Performance.create({
    appVersion: '1.131.1',
    clock: () => now,
    random: () => 0.25,
    emit: eventSink(rows),
  });
  const id = tracker.start({
    sectionId: 'sec-destBtn',
    sectionLabel: 'Today’s patches',
    report: 'wa',
    reason: 'open',
    cacheMode: 'cold',
  });
  now += 120;
  tracker.mark(id, 'report_first_content', { row_count: 1 });
  now += 380;
  tracker.mark(id, 'report_primary_ready', { row_count: 4 });
  now += 700;
  tracker.finish(id, { row_count: 4, completeness: 'results' });

  assert.deepEqual(rows.map((row) => row.event), [
    'report_load_start',
    'report_first_content',
    'report_primary_ready',
    'report_enrichment_complete',
    'report_load_complete',
  ]);
  assert.deepEqual(rows.map((row) => row.attrs.elapsed_ms),
    [0, 120, 500, 1200, 1200]);
  assert.ok(rows.every((row) => row.operation_id === id));
});

test('F623 concurrent sections attribute request costs by loadId, not visible order', () => {
  let now = 0;
  const rows = [];
  const tracker = Performance.create({
    appVersion: '1.131.1',
    clock: () => now,
    random: (() => {
      const values = [0.1, 0.9];
      return () => values.shift();
    })(),
    emit: eventSink(rows),
  });
  const patches = tracker.start({
    sectionId: 'sec-destBtn', sectionLabel: 'Today’s patches',
    report: 'wa', reason: 'open', cacheMode: 'cold',
  });
  const birdGen = tracker.start({
    sectionId: 'sec-surgeBtn', sectionLabel: 'Bird Gen',
    report: 'wa', reason: 'autoload', cacheMode: 'warm',
  });
  now = 250;
  tracker.network(birdGen, { queued_ms: 180, network_ms: 70, cached: false });
  now = 400;
  tracker.network(patches, { queued_ms: 20, network_ms: 130, cached: false });
  tracker.finish(patches);
  tracker.finish(birdGen);

  const report = Performance.analyze(rows);
  const patchSample = report.samples.find((row) => row.load_id === patches);
  const birdGenSample = report.samples.find((row) => row.load_id === birdGen);
  assert.equal(patchSample.queued_ms, 20);
  assert.equal(patchSample.network_ms, 130);
  assert.equal(birdGenSample.queued_ms, 180);
  assert.equal(birdGenSample.network_ms, 70);
});

test('F801 source settlement remains attributable without prematurely completing a load', () => {
  let now = 0;
  const rows = [];
  const tracker = Performance.create({ clock: () => now, emit: eventSink(rows) });
  const id = tracker.start({ sectionId: 'sec-surgeBtn', reason: 'refresh' });
  now = 1800;
  tracker.source(id, { source: 'mass', state: 'partial' });
  assert.equal(tracker.active(id), true);
  assert.equal(rows[1].attrs.elapsed_ms, 1800);
  assert.equal(rows[1].attrs.load_id, id);
  assert.equal(rows[1].attrs.source, 'mass');
  tracker.finish(id, { completion_scope: 'source_data; viewport-lazy photos excluded' });
  assert.equal(tracker.source(id, { source: 'late' }), null);
});

test('F623 analyzer separates cache modes and labels a measured regression', () => {
  const rows = [];
  function sample(version, id, primary, cacheMode, outcome = 'ok') {
    const attrs = {
      load_id: id, app_version: version,
      section_id: 'sec-destBtn', section_label: 'Today’s patches',
      report: 'wa', load_reason: 'open', cache_mode: cacheMode,
    };
    rows.push({ event: 'report_load_start', operation_id: id,
      attrs: { ...attrs, elapsed_ms: 0 } });
    rows.push({ event: 'report_primary_ready', operation_id: id,
      attrs: { ...attrs, elapsed_ms: primary } });
    rows.push({ event: 'report_enrichment_complete', operation_id: id,
      attrs: { ...attrs, elapsed_ms: primary + 500 } });
    rows.push({ event: outcome === 'ok' ? 'report_load_complete'
      : outcome === 'cancelled' ? 'report_load_cancelled' : 'report_load_failed',
    operation_id: id, attrs: { ...attrs, elapsed_ms: primary + 500 } });
  }
  for (let i = 0; i < 5; i++) sample('1.130.9', `old-${i}`, 1000 + i * 10, 'cold');
  for (let i = 0; i < 5; i++) sample('1.131.1', `new-${i}`, 1600 + i * 10, 'cold');
  sample('1.131.1', 'warm-1', 300, 'warm', 'cancelled');

  const report = Performance.analyze(rows);
  const current = report.rows.find((row) =>
    row.app_version === '1.131.1' && row.cache_mode === 'cold');
  const warm = report.rows.find((row) =>
    row.app_version === '1.131.1' && row.cache_mode === 'warm');
  assert.equal(current.verdict, 'Slower');
  assert.ok(current.delta_ms >= 500);
  assert.ok(current.delta_percent >= 20);
  assert.equal(warm.cancellation_percent, 100);
  assert.match(Performance.csv(report), /Today’s patches/);
  assert.match(Performance.html(report), />Slower</);
  const files = Performance.files(rows);
  assert.deepEqual(Object.keys(files).sort(), [
    'performance-loads.jsonl',
    'performance-report.csv',
    'performance-report.html',
  ]);
});
