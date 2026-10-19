'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const notifications = require('../www/birdgen-notifications.js');
const logic = require('../www/logic.js');
const { install } = require('../native/ios/install-full-report-bridge.js');

const now = new Date(2030, 5, 10, 12).getTime();
const profile = {
  home: { lat: 47.66, lng: -122.12 }, chaseMaxMi: 35,
  counties: [{ code: 'US-WA-033', label: 'King', slug: 'king' }],
  stateCode: 'US-WA', geoFeed: false
};
function stamp(at) {
  const d = new Date(at), pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function rows(code = 'chclon', name = 'Chestnut-collared Longspur', count = logic.NEED_MIN_SIGHTINGS) {
  return Array.from({ length: count }, (_, i) => ({
    speciesCode: code, comName: name, locId: 'L123', locName: 'Marymoor Park',
    lat: 47.66, lng: -122.12, locationPrivate: false,
    subId: `S${i}`, userDisplayName: `Independent ${i}`,
    obsDt: stamp(now - (i + 1) * 3600000), howMany: 1
  }));
}
function feeds(observations, notable = true) {
  const base = notifications.plan(profile, []).jobs.map((job) => ({
    file: job.file, kind: job.kind, src: job.src, at: now,
    capped: false, failed: false,
    rows: job.kind === 'notable' && !notable ? [] : observations
  }));
  return notifications.plan(profile, base).jobs.map((job) =>
    base.find((f) => f.file === job.file) || {
      file: job.file, kind: job.kind, src: job.src, at: now,
      capped: false, failed: false, rows: observations
    });
}

test('F979 native plan reuses baseline and enrichment rules without a proxy', () => {
  const base = notifications.plan(profile, []);
  assert.deepEqual(base.baseFiles, logic.planFeeds(profile, logic.SURGE.BASELINE_DAYS).map((j) => j.file));
  const enriched = notifications.plan(profile, feeds(rows()));
  assert.ok(enriched.jobs.some((j) => j.file === 'sp-chclon.json'));
  for (const job of enriched.jobs) {
    assert.match(job.path, /^data\/obs\//);
    assert.match(job.path, /back=14/);
    assert.match(job.path, /maxResults=1000/);
    assert.doesNotMatch(job.path, /github|token|https:/);
  }
  assert.throws(() => notifications.plan({ counties: [] }, []), /saved home/);
});

test('F979 Celebrity needs actual independent public evidence even under partial coverage', () => {
  const complete = feeds(rows());
  const result = notifications.evaluate(profile, complete, now);
  assert.equal(result.complete, true);
  assert.equal(result.events.length, 1);
  assert.match(result.events[0].title, /Celebrity/);
  assert.equal(notifications.evaluate(profile, feeds(rows().slice(1)), now).events.length, 0,
    'the native path relaxed the shared corroboration threshold');
  const partial = notifications.evaluate(profile, complete.filter((f) => f.kind !== 'recent'), now);
  assert.equal(partial.complete, false);
  assert.equal(partial.events.length, 1, 'positive corroboration was discarded with an unrelated source failure');
  const party = rows().map((r) => ({ ...r, subId: 'S-shared', obsDt: stamp(now - 3600000) }));
  assert.equal(notifications.evaluate(profile, feeds(party), now).events.length, 0);
  for (const privacy of [true, undefined]) {
    const privateRows = rows().map((r) => ({ ...r, locationPrivate: privacy }));
    assert.equal(notifications.evaluate(profile, feeds(privateRows), now).events.length, 0);
  }
  const excluded = { ...profile, excludeLocIds: ['L123'] };
  assert.equal(notifications.evaluate(excluded, complete, now).events.length, 0);
  const missingCoordinates = rows().map((r) => ({ ...r, lat: undefined }));
  assert.equal(notifications.evaluate(profile, feeds(missingCoordinates), now).events.length, 0);
});

test('F979 Crowd never invents an empty baseline from missing, failed, capped or stale sources', () => {
  const complete = feeds(rows('amecro', 'American Crow', 6), false);
  const result = notifications.evaluate(profile, complete, now);
  assert.equal(result.complete, true);
  assert.equal(result.events.length, 1);
  assert.match(result.events[0].title, /Crowd/);
  const variants = [
    complete.slice(1),
    complete.map((f, i) => i ? f : { ...f, capped: true }),
    complete.map((f, i) => i ? f : { ...f, failed: true }),
    complete.map((f, i) => i ? f : { ...f, at: now - 31 * 60000 })
  ];
  for (const input of variants) {
    const partial = notifications.evaluate(profile, input, now);
    assert.equal(partial.complete, false);
    assert.equal(partial.events.length, 0, 'incomplete coverage created a Crowd notification');
  }
  const manyCodes = Array.from({ length: 61 }, (_, i) => ({
    speciesCode: `bird${i}`, comName: `Bird ${i}`, obsDt: stamp(now - 3600000)
  }));
  const cappedPlan = notifications.plan(profile, [{ kind: 'recent', rows: manyCodes }]);
  assert.equal(cappedPlan.truncated, true);
  assert.equal(cappedPlan.jobs.filter((j) => j.kind === 'species').length, 60);
});

test('F1005 actual native merge and qualifier require four known reporting parties', () => {
  for (const names of [
    ['Project account', 'Project account', 'Project account', 'Project account'],
    [' One reporter ', 'one REPORTER', 'One Reporter', 'one reporter'],
    ['Project  account', 'project account', ' Project account ', 'PROJECT ACCOUNT'],
    ['', '', '', ''],
    ['Party A', 'Party B', 'Party C', ''],
  ]) {
    const acquired = rows().map((r, i) => ({ ...r, userDisplayName: names[i] }));
    const sources = feeds(acquired);
    const merged = logic.mergeSnapshot(sources);
    assert.equal(merged.length, 4, 'reject qualification, not useful observations');
    assert.equal(notifications.evaluate(profile, sources, now).events.length, 0,
      'unknown checklists and repeated account names are not four known parties');
  }
  const mixed = rows(undefined, undefined, 6).map((r, i) => ({
    ...r, userDisplayName: i < 4 ? 'Party ' + i : '',
  }));
  const event = notifications.evaluate(profile, feeds(mixed), now).events[0];
  assert.ok(event, 'unknown evidence must not exclude a genuinely supported bird');
  assert.match(event.body, /4 known reporting parties/);
  assert.doesNotMatch(event.body, /6 independent/);
  const repeated = rows(undefined, undefined, 10).map((r) => ({ ...r, userDisplayName: 'Regular account' }));
  const independent = rows().map((r, i) => ({
    ...r, locId: 'L456', locName: 'Example Public Park', lat: 47.68, subId: 'S1005' + i,
  }));
  for (const observations of [repeated.concat(independent), independent.concat(repeated)]) {
    const supported = notifications.evaluate(profile, feeds(observations), now).events;
    assert.equal(supported.length, 1, 'a busy repeated account must not mask a supported cluster');
    assert.match(supported[0].body, /Example Public Park/);
  }
  const sharedParty = rows().map((r) => ({ ...r, obsDt: stamp(now - 3600000) }));
  const unknownVisits = rows(undefined, undefined, 3).map((r, i) => ({
    ...r, subId: 'Sunknown' + i, userDisplayName: '', obsDt: stamp(now - (i + 2) * 3600000),
  }));
  assert.equal(notifications.evaluate(profile, feeds(sharedParty.concat(unknownVisits)), now).events.length, 0,
    'four named members of a shared party plus unknown visits are not four known parties');
});

test('F979 native Crowd retains distant trailing history instead of shrinking the baseline to chase radius', () => {
  const hot = rows('amecro', 'American Crow', 6);
  const cold = Array.from({ length: 60 }, (_, i) => ({
    ...hot[0], subId: `S-cold${i}`, userDisplayName: `Cold ${i}`,
    locId: 'L999', locName: 'Distant Public Park', lat: 48.7,
    obsDt: stamp(now - (3 + i % 10) * 86400000)
  }));
  const result = notifications.evaluate(profile, feeds(hot.concat(cold), false), now);
  assert.equal(result.complete, true);
  assert.equal(result.events.length, 0, 'dropping distant baseline records invented local novelty/above-normal attention');
});

test('F979 malformed native rows retain positive evidence, mark partial coverage and report bounded row details', () => {
  const source = feeds(rows());
  source[0] = { ...source[0], rows: source[0].rows.concat(Array(30).fill(null)) };
  const result = notifications.evaluate(profile, source, now);
  assert.equal(result.complete, false);
  assert.equal(result.events.length, 1);
  assert.equal(result.errors.length, 20);
  assert.equal(result.errors[0].file, source[0].file);
  assert.equal(result.errors[0].index, logic.NEED_MIN_SIGHTINGS);
  assert.match(result.errors[0].reason, /Invalid/);
  assert.doesNotMatch(JSON.stringify(result.errors), /Marymoor|Independent/);
});

test('F979 stable episode dedup is quiet initially, shared across alert kinds, bounded and expires', () => {
  const celebrity = notifications.event('need', 'chclon', 'L123', 'Celebrity', '2 sightings', now);
  const enriched = notifications.event('cascade', 'chclon', 'L123', 'Cascade', '5 people', now);
  assert.equal(celebrity.id, enriched.id, 'count/enrichment/category changes create a second episode');
  const initial = notifications.transition({}, [celebrity], now, true);
  assert.equal(initial.added.length, 0);
  assert.equal(notifications.transition(initial.ledger, [enriched], now + 1000, false).added.length, 0);
  const other = notifications.event('need', 'chclon', 'L456', 'New site', '', now);
  assert.equal(notifications.transition(initial.ledger, [other, other], now + 1000, false).added.length, 1);
  assert.equal(notifications.transition(initial.ledger, [celebrity], now + 8 * 86400000, false).added.length, 1);
  const huge = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`id${i}`, now]));
  assert.equal(Object.keys(notifications.transition(huge, [], now, false).ledger).length, 1000);
});

test('F979 expired sideload builds cannot continue native notifications', () => {
  assert.equal(notifications.validateBuild({ channel: 'production', expiresAt: null }, now), true);
  assert.equal(notifications.validateBuild({ channel: 'sideload', expiresAt: new Date(now + 1).toISOString() }, now), true);
  assert.throws(() => notifications.validateBuild({ channel: 'sideload', expiresAt: new Date(now).toISOString() }, now), /expired/);
  assert.throws(() => notifications.validateBuild({ channel: 'sideload', expiresAt: null }, now), /expired/);
  assert.throws(() => notifications.validateBuild(null, now), /identity/);
});

test('F979 installer adds the notification source to App compilation and registers its exact identifier before launch completes, idempotently', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'birdgen-native-'));
  try {
    const native = path.join(root, 'native', 'ios'), ios = path.join(root, 'ios');
    fs.mkdirSync(native, { recursive: true });
    fs.mkdirSync(ios, { recursive: true });
    for (const name of ['ViewController.swift', 'BirdGenNotifications.swift']) {
      fs.copyFileSync(path.join(__dirname, '..', 'native', 'ios', name), path.join(native, name));
    }
    childProcess.execFileSync('tar', ['-xzf',
      path.join(__dirname, '..', 'node_modules', '@capacitor', 'cli', 'assets', 'ios-spm-template.tar.gz'),
      '-C', ios]);
    install(root);
    const app = path.join(ios, 'App', 'App');
    const projectPath = path.join(ios, 'App', 'App.xcodeproj', 'project.pbxproj');
    const project = fs.readFileSync(projectPath, 'utf8');
    const delegate = fs.readFileSync(path.join(app, 'AppDelegate.swift'), 'utf8');
    const plist = fs.readFileSync(path.join(app, 'Info.plist'), 'utf8');
    const source = fs.readFileSync(path.join(native, 'BirdGenNotifications.swift'), 'utf8');
    const identifier = /static let taskIdentifier = "([^"]+)"/.exec(source)[1];
    assert.match(/Begin PBXSourcesBuildPhase section([\s\S]*?)End PBXSourcesBuildPhase section/.exec(project)[1],
      /BirdGenNotifications.swift in Sources/);
    assert.match(delegate, /didFinishLaunchingWithOptions[\s\S]*BirdGenNotificationService\.install\(\)[\s\S]*return true/);
    assert.match(plist, new RegExp(`<key>BGTaskSchedulerPermittedIdentifiers</key>\\s*<array><string>${identifier.replaceAll('.', '\\.')}</string>`));
    assert.match(plist, /<key>UIBackgroundModes<\/key>\s*<array><string>fetch<\/string>/);
    const controller = fs.readFileSync(path.join(app, 'ViewController.swift'), 'utf8');
    assert.match(controller, /registerPluginInstance\(BirdGenNotificationsPlugin\(\)\)/);
    assert.match(controller, /notificationRouter\.localNotificationHandler\s*=\s*BirdGenNotificationService\.shared/);
    assert.match(source, /class BirdGenNotificationService:[^{]+NotificationHandlerProtocol/);
    install(root);
    assert.equal(fs.readFileSync(projectPath, 'utf8'), project);
    assert.equal(fs.readFileSync(path.join(app, 'AppDelegate.swift'), 'utf8'), delegate);
    assert.equal(fs.readFileSync(path.join(app, 'Info.plist'), 'utf8'), plist);
    assert.equal(fs.readFileSync(path.join(app, 'BirdGenNotifications.swift'), 'utf8'), source);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
