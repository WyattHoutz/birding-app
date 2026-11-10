'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { VARIANTS } = require('./build-mockup-gallery.js');

const REPOSITORY = 'WyattHoutz/birding-app';
const RELEASES = `https://github.com/${REPOSITORY}/releases`;
const SITE_BUDGET = 750000000;
const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PROFILE_IDS = VARIANTS.map(variant => variant.id).concat(['393', '402']);

function filesUnder(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (directory === root && entry.name === '.git') continue;
      const file = path.join(directory, entry.name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`site contains a symlink: ${file}`);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) files.push({ file, size: stat.size });
      else throw new Error(`site contains a nonordinary file: ${file}`);
    }
  }
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('site must be an ordinary directory');
  }
  visit(root);
  return files;
}

function newestFirst(left, right) {
  const a = VERSION.exec(left).slice(1).map(BigInt);
  const b = VERSION.exec(right).slice(1).map(BigInt);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? -1 : 1;
  }
  return 0;
}

function archiveFor(version, releases) {
  const matches = releases.filter((release) => release.tag_name === version);
  if (matches.length !== 1) throw new Error(`missing or ambiguous Release for ${version}`);
  const release = matches[0];
  if (!Number.isSafeInteger(release.id) || release.id <= 0 ||
      release.draft !== false || release.html_url !== `${RELEASES}/tag/${version}`) {
    throw new Error(`untrusted Release for ${version}`);
  }
  const assets = (release.assets || []).filter((asset) =>
    asset.name === 'BirdChaser-mockups.zip');
  if (assets.length !== 1) throw new Error(`missing or ambiguous archive for ${version}`);
  const asset = assets[0];
  if (!Number.isSafeInteger(asset.id) || asset.id <= 0 ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
      asset.state !== 'uploaded' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') ||
      asset.url !== `https://api.github.com/repos/${REPOSITORY}/releases/assets/${asset.id}` ||
      asset.browser_download_url !== `${RELEASES}/download/${version}/BirdChaser-mockups.zip`) {
    throw new Error(`unverified archive identity for ${version}`);
  }
  return { version, releaseId: release.id, assetId: asset.id, size: asset.size,
    digest: asset.digest, releaseUrl: release.html_url, url: asset.browser_download_url };
}

function archivePage(archive) {
  return '<!doctype html><html lang="en"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>Bird Chaser ${archive.version} gallery archive</title>`
    + `<h1>Bird Chaser ${archive.version} gallery archive</h1>`
    + '<p>Only the two newest galleries are browsable here. Older direct image URLs '
    + 'are no longer available; screenshots remain in the original Release ZIP.</p>'
    + `<p><a href="${archive.url}">Download ${archive.version} gallery ZIP</a></p>`
    + `<p><a href="${archive.releaseUrl}">Original ${archive.version} Release</a>`
    + ' | <a href="../">All galleries and archives</a></p>'
    + `<p>Archive asset ${archive.assetId}; ${archive.digest}</p></html>\n`;
}

function requireBudget(size, budget) {
  if (size > budget) throw new Error(`Pages site exceeds budget: ${size} > ${budget} bytes`);
}

function assertBudget(siteRoot, budget = SITE_BUDGET) {
  const size = filesUnder(siteRoot).reduce((total, item) => total + item.size, 0);
  requireBudget(size, budget);
  return size;
}

function planRetention(siteRoot, releases, budget = SITE_BUDGET) {
  siteRoot = path.resolve(siteRoot);
  const files = filesUnder(siteRoot);
  const mockupsRoot = path.join(siteRoot, 'mockups');
  const versions = fs.readdirSync(mockupsRoot).filter((name) => {
    const directory = path.join(mockupsRoot, name);
    if (!VERSION.test(name)) {
      if (fs.lstatSync(directory).isDirectory()) {
        throw new Error(`unrecognized gallery directory: ${name}`);
      }
      return false;
    }
    if (!fs.lstatSync(directory).isDirectory()) {
      throw new Error(`gallery is not a directory: ${name}`);
    }
    return true;
  }).sort(newestFirst);
  const browsable = versions.filter((version) => files.some((item) =>
    path.relative(path.join(mockupsRoot, version), item.file).split(path.sep).length === 2 &&
    path.extname(item.file) === '.png' &&
    PROFILE_IDS.some((id) => item.file.startsWith(
      path.join(mockupsRoot, version, id) + path.sep))));
  if (!browsable.length) throw new Error('no browsable gallery exists');
  const retained = browsable.slice(0, 2);
  for (const version of retained) {
    if (!fs.existsSync(path.join(mockupsRoot, version, 'index.html'))) {
      throw new Error(`retained gallery has no landing page: ${version}`);
    }
  }
  const archived = versions.filter((version) => !retained.includes(version));
  // Validate every archive before planning any removal.
  const archives = archived.map((version) => archiveFor(version, releases));
  const removals = [];
  const writes = [];
  for (const archive of archives) {
    const directory = path.join(mockupsRoot, archive.version);
    for (const item of files) {
      const relative = path.relative(directory, item.file);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
        continue;
      }
      if (relative === 'index.html') continue;
      const parts = relative.split(path.sep);
      if (parts.length !== 2 || !PROFILE_IDS.includes(parts[0]) ||
          path.extname(parts[1]) !== '.png') {
        throw new Error(`unexpected archived gallery content: ${item.file}`);
      }
      removals.push(item);
    }
    writes.push({ file: path.join(directory, 'index.html'), text: archivePage(archive) });
  }
  const links = versions.map((version) =>
    `<li><a href="${version}/">${version}: ${
      retained.includes(version) ? 'Browse screenshots' : 'Archive ZIP'
    }</a></li>`).join('\n');
  writes.push({ file: path.join(mockupsRoot, 'index.html'),
    text: '<!doctype html><html lang="en"><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Bird Chaser galleries and archives</title>'
      + `<h1>Galleries and archives</h1><ul>${links}</ul></html>\n` });
  writes.push({ file: path.join(siteRoot, 'index.html'),
    text: '<!doctype html><meta charset="utf-8"><title>Bird Chaser mockups</title>'
      + `<meta http-equiv="refresh" content="0;url=mockups/${retained[0]}/">`
      + `<p><a href="mockups/${retained[0]}/">Latest gallery: ${retained[0]}</a></p>`
      + '<p><a href="mockups/">All galleries and archives</a></p>\n' });
  const existing = new Map(files.map((item) => [item.file, item.size]));
  const before = files.reduce((total, item) => total + item.size, 0);
  const projected = before - removals.reduce((total, item) => total + item.size, 0)
    + writes.reduce((total, item) =>
      total + Buffer.byteLength(item.text) - (existing.get(item.file) || 0), 0);
  requireBudget(projected, budget);
  return { siteRoot, retained, archives, removals, writes, before, projected, budget };
}

function applyRetention(plan) {
  // Recheck the file inventory and budget before removing any image.
  const current = filesUnder(plan.siteRoot);
  const fresh = planRetention(plan.siteRoot, plan.archives.map((archive) => ({
    id: archive.releaseId, tag_name: archive.version, draft: false,
    html_url: archive.releaseUrl, assets: [{
      id: archive.assetId, name: 'BirdChaser-mockups.zip', state: 'uploaded',
      size: archive.size, digest: archive.digest, browser_download_url: archive.url,
      url: `https://api.github.com/repos/${REPOSITORY}/releases/assets/${archive.assetId}`,
    }],
  })), plan.budget);
  if (JSON.stringify(fresh) !== JSON.stringify(plan)) {
    throw new Error('gallery retention plan changed before application');
  }
  for (const item of plan.removals) fs.unlinkSync(item.file);
  for (const item of plan.writes) fs.writeFileSync(item.file, item.text);
  const actual = assertBudget(plan.siteRoot, plan.budget);
  if (actual !== plan.projected) throw new Error('site size changed during retention');
  return { retained: plan.retained, archives: plan.archives, before: plan.before,
    after: actual, budget: plan.budget, removedImages: plan.removals.length,
    scannedFiles: current.length };
}

function verifyArchives(archives, releases) {
  for (const archive of archives) {
    if (JSON.stringify(archiveFor(archive.version, releases)) !== JSON.stringify(archive)) {
      throw new Error(`archive changed during retention: ${archive.version}`);
    }
  }
}

function releaseInventory(execute = execFileSync) {
  const pages = JSON.parse(execute('gh', [
    'api', '--paginate', '--slurp', `repos/${REPOSITORY}/releases?per_page=100`,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error('incomplete paginated Release inventory');
  }
  return pages.flat();
}

module.exports = {
  SITE_BUDGET, planRetention, applyRetention, assertBudget, verifyArchives, releaseInventory,
};

if (require.main === module) {
  try {
    const [siteRoot, evidence] = process.argv.slice(2);
    if (!siteRoot || !evidence || process.argv.length !== 4) {
      throw new Error('usage: node assets/gallery-retention.js <site> <evidence.json>');
    }
    const result = applyRetention(planRetention(siteRoot, releaseInventory()));
    verifyArchives(result.archives, releaseInventory());
    fs.writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n');
    console.log(`Pages site: ${result.before} -> ${result.after} bytes; `
      + `browsable ${result.retained.join(', ')}; ${result.archives.length} archive links`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
