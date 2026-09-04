/*
 * Generate docs/info-dialogs.html from the same sources the app renders.
 *
 * Run:
 *   node assets/generate-info-catalog.js
 *   node assets/generate-info-catalog.js --check
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const CONTRACT_PATH = path.join(ROOT, 'tests', 'fixtures', 'report-contract.json');
const SECTION_DOCS_PATH = path.join(WWW, 'section-docs.json');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'info-dialogs.html');
const INFO = require(path.join(WWW, 'info-dialogs.js'));
const BL = require(path.join(WWW, 'logic.js'));

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  })[c]);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function inventory() {
  const contract = readJson(CONTRACT_PATH);
  const sectionFile = readJson(SECTION_DOCS_PATH);
  const docs = sectionFile.docs || {};
  const sections = (contract.menu || []).map((entry) => {
    if (!docs[entry.at]) {
      throw new Error(`Enabled section ${entry.at} has no section-docs.json entry`);
    }
    return { ...entry, doc: docs[entry.at] };
  });
  const sectionIds = new Set(sections.map((entry) => entry.at));
  const inactiveDocs = Object.keys(docs).filter((at) => !sectionIds.has(at)).sort();
  const allowedInactive = [...(contract.menuOmittedAts || [])].sort();
  if (JSON.stringify(inactiveDocs) !== JSON.stringify(allowedInactive)) {
    throw new Error(
      `Non-menu section docs differ from menuOmittedAts: ${inactiveDocs.join(', ')}`);
  }

  const dialogs = Object.entries(INFO.catalog).map(([id, entry]) => {
    const rendered = INFO.renderSample(id, {
      BirdLogic: BL,
      escapeHtml,
    });
    if (!rendered.title || !rendered.subtitle || !rendered.bodyHtml) {
      throw new Error(`Informational dialog ${id} has an incomplete sample`);
    }
    return { id, ...entry, rendered };
  });
  const excluded = Object.entries(INFO.excluded).map(([id, entry]) => ({
    id, ...entry,
  }));
  return { contract, docs, sections, inactiveDocs, dialogs, excluded };
}

function sourceLine(href, label, key) {
  return '<p class="source"><strong>Prose source:</strong> '
    + '<a href="' + escapeHtml(href) + '"><code>' + escapeHtml(label) + '</code></a>'
    + (key ? ' · <code>' + escapeHtml(key) + '</code>' : '') + '</p>';
}

function sectionEntry(entry) {
  const sample = INFO.sectionSampleContext(entry.at, BL, escapeHtml);
  const context = sample
    ? '<aside class="context sample"><strong>' + escapeHtml(sample.label)
      + '</strong><p>Only the warning below is sample state; the authored '
      + 'calculation prose is unchanged.</p></aside>'
    : '<aside class="context"><strong>Context:</strong> section results and any '
      + 'live warning vary by report and fetched data. This entry shows authored '
      + 'prose only.</aside>';
  const body = INFO.renderSectionDocHtml(
    entry.doc, sample ? sample.noteHtml : '', escapeHtml);
  const scope = entry.report
    ? 'App section and archived-report section'
    : 'App-only section';
  return [
    '<details class="catalog-entry" data-catalog-id="section:' + escapeHtml(entry.at)
      + '" data-kind="section">',
    '<summary><span class="entry-type">Section calculation disclosure</span>'
      + '<span class="entry-title">' + escapeHtml(entry.label) + '</span>'
      + '<span class="entry-summary">' + escapeHtml(entry.doc.summary || '') + '</span></summary>',
    '<div class="entry-body">',
    '<p class="scope"><strong>Surface:</strong> ' + escapeHtml(scope)
      + ' · <strong>App anchor:</strong> <code>' + escapeHtml(entry.at) + '</code></p>',
    context,
    sourceLine('../www/section-docs.json', 'www/section-docs.json', 'docs.' + entry.at),
    '<div class="dialog-preview section-preview">' + body + '</div>',
    '</div></details>',
  ].join('');
}

function dialogEntry(entry) {
  return [
    '<details class="catalog-entry" data-catalog-id="dialog:' + escapeHtml(entry.id)
      + '" data-kind="dialog">',
    '<summary><span class="entry-type">' + escapeHtml(entry.group) + '</span>'
      + '<span class="entry-title">' + escapeHtml(entry.name) + '</span>'
      + '<span class="entry-summary">' + escapeHtml(entry.contextLabel) + '</span></summary>',
    '<div class="entry-body">',
    '<aside class="context sample"><strong>' + escapeHtml(entry.contextLabel)
      + '</strong><p>Values marked as sample or dynamic are supplied by the app at runtime.</p></aside>',
    sourceLine('../www/info-dialogs.js', 'www/info-dialogs.js',
      'catalog["' + entry.id + '"]'),
    '<div class="dialog-preview sheet-preview" role="group" aria-label="Rendered dialog sample">',
    '<header class="sheet-head"><div><h3>' + escapeHtml(entry.rendered.title) + '</h3>'
      + '<p>' + escapeHtml(entry.rendered.subtitle) + '</p></div>'
      + '<span class="close-sample" aria-hidden="true">Close ×</span></header>',
    '<div class="sheet-body">' + entry.rendered.bodyHtml + '</div>',
    '</div></div></details>',
  ].join('');
}

function excludedEntry(entry) {
  const surface = entry.surface === 'confirmation'
    ? 'Native confirmation'
    : 'Bottom sheet';
  return '<li class="excluded-entry" data-excluded-id="' + escapeHtml(entry.id) + '">'
    + '<strong>' + escapeHtml(entry.name) + '</strong>'
    + '<span class="excluded-type">' + escapeHtml(surface) + '</span>'
    + '<p>' + escapeHtml(entry.reason) + '</p>'
    + '<p class="source"><code>' + escapeHtml(entry.id) + '</code></p></li>';
}

function buildCatalog() {
  const data = inventory();
  const total = data.sections.length + data.dialogs.length;
  const sectionHtml = data.sections.map(sectionEntry).join('\n');
  const dialogGroups = new Map();
  data.dialogs.forEach((entry) => {
    if (!dialogGroups.has(entry.group)) dialogGroups.set(entry.group, []);
    dialogGroups.get(entry.group).push(entry);
  });
  const dialogHtml = [...dialogGroups.entries()].map(([group, entries], i) => (
    '<section class="catalog-group" aria-labelledby="dialog-group-' + i + '">'
    + '<h2 id="dialog-group-' + i + '">' + escapeHtml(group)
    + ' <span class="count">' + entries.length + '</span></h2>'
    + entries.map(dialogEntry).join('\n') + '</section>'
  )).join('\n');
  const inactive = data.inactiveDocs.map((at) => '<code>' + escapeHtml(at) + '</code>').join(', ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Information dialog catalog — Bird Chaser</title>
<style>
  :root {
    color-scheme: light dark;
    --blue: #0072B2;
    --orange: #E69F00;
    --sky: #56B4E9;
    --ink: #161616;
    --muted: #5d6268;
    --bg: #f4f6f8;
    --card: #ffffff;
    --line: #c8ced4;
    --soft-blue: #e8f4fb;
    --soft-orange: #fff3d6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  a { color: var(--blue); text-decoration-thickness: 2px; text-underline-offset: 2px; }
  a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible {
    outline: 3px solid var(--orange);
    outline-offset: 3px;
  }
  .skip {
    position: absolute; left: 8px; top: -80px; z-index: 2;
    padding: 8px 12px; background: var(--card); color: var(--ink);
  }
  .skip:focus { top: 8px; }
  header.page-head {
    border-bottom: 5px solid var(--blue);
    background: var(--card);
    padding: 28px max(20px, calc((100vw - 1050px) / 2));
  }
  h1 { margin: 0 0 8px; font-size: clamp(1.7rem, 4vw, 2.5rem); line-height: 1.15; }
  .lede { max-width: 78ch; margin: 0 0 10px; }
  .inventory {
    display: inline-block; margin: 8px 0 0; padding: 7px 10px;
    border-left: 5px solid var(--orange); background: var(--soft-orange);
    font-weight: 700;
  }
  .tools {
    position: sticky; top: 0; z-index: 1; background: var(--card);
    border-bottom: 1px solid var(--line); padding: 12px max(20px, calc((100vw - 1050px) / 2));
  }
  .tool-row { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
  .search { flex: 1 1 320px; }
  label { display: block; font-weight: 800; margin-bottom: 4px; }
  input {
    width: 100%; min-height: 44px; padding: 9px 11px; border: 2px solid var(--line);
    border-radius: 8px; background: var(--card); color: var(--ink); font: inherit;
  }
  button {
    min-height: 44px; padding: 8px 13px; border: 2px solid var(--blue);
    border-radius: 8px; background: var(--card); color: var(--blue);
    font: inherit; font-weight: 800; cursor: pointer;
  }
  #matchCount { margin: 7px 0 0; color: var(--muted); }
  main { max-width: 1050px; margin: 0 auto; padding: 22px 20px 60px; }
  .scope-note {
    padding: 13px 15px; border: 1px solid var(--line); border-left: 6px solid var(--blue);
    border-radius: 8px; background: var(--card);
  }
  .catalog-group { margin-top: 30px; }
  .catalog-group > h2 {
    display: flex; align-items: center; gap: 9px; margin-bottom: 10px;
    border-bottom: 2px solid var(--line); padding-bottom: 7px;
  }
  .count {
    display: inline-block; min-width: 2em; padding: 1px 8px; border-radius: 999px;
    background: var(--blue); color: #fff; font-size: .75em; text-align: center;
  }
  .catalog-entry {
    margin: 0 0 10px; border: 1px solid var(--line); border-radius: 10px;
    background: var(--card); overflow: clip;
  }
  .catalog-entry[hidden] { display: none; }
  summary {
    display: grid; grid-template-columns: minmax(150px, .55fr) minmax(200px, 1fr);
    gap: 2px 14px; padding: 13px 15px; cursor: pointer;
  }
  summary::marker { color: var(--blue); }
  .entry-type {
    grid-row: 1 / span 2; align-self: center; color: var(--blue);
    font-size: .8rem; font-weight: 900; letter-spacing: .025em; text-transform: uppercase;
  }
  .entry-title { font-size: 1.08rem; font-weight: 850; }
  .entry-summary { color: var(--muted); font-size: .91rem; }
  .entry-body { border-top: 1px solid var(--line); padding: 15px; }
  .scope, .source { color: var(--muted); font-size: .9rem; }
  code {
    overflow-wrap: anywhere; padding: 1px 4px; border-radius: 4px;
    background: color-mix(in srgb, var(--sky) 18%, transparent);
  }
  .context {
    margin: 10px 0; padding: 10px 12px; border-left: 5px solid var(--blue);
    background: var(--soft-blue);
  }
  .context.sample { border-left-color: var(--orange); background: var(--soft-orange); }
  .context p { margin: 4px 0 0; }
  .dialog-preview {
    max-width: 760px; margin-top: 12px; border: 2px solid var(--line);
    border-radius: 13px; background: var(--card); padding: 14px 16px;
  }
  .sheet-head {
    display: flex; justify-content: space-between; gap: 15px; align-items: start;
    border-bottom: 1px solid var(--line); padding-bottom: 9px; margin-bottom: 11px;
  }
  .sheet-head h3 { margin: 0; font-size: 1.2rem; }
  .sheet-head p { margin: 2px 0 0; color: var(--muted); }
  .close-sample { color: var(--muted); font-weight: 800; white-space: nowrap; }
  .sheet-body h3 { margin-top: 1.4em; }
  .sheet-body h4 { margin-bottom: 0; }
  .docsum { font-weight: 800; }
  .doch { margin-bottom: 4px; font-weight: 850; }
  .doclist { margin-top: 4px; }
  .doclimits { border-left: 4px solid var(--orange); padding-left: 23px; }
  .docnote {
    padding: 9px 11px; border: 2px dashed var(--orange); background: var(--soft-orange);
    font-weight: 750;
  }
  .excluded {
    margin-top: 38px; padding: 17px; border: 2px dashed var(--line);
    border-radius: 10px; background: var(--card);
  }
  .excluded-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(245px, 1fr)); gap: 10px; padding: 0; }
  .excluded-entry { list-style: none; border-left: 5px solid var(--orange); padding: 9px 12px; background: var(--soft-orange); }
  .excluded-entry p { margin: 5px 0 0; }
  .excluded-type { display: block; color: var(--muted); font-size: .83rem; font-weight: 800; text-transform: uppercase; }
  footer { margin-top: 30px; color: var(--muted); font-size: .9rem; }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #f2f2f2; --muted: #c4c8cc; --bg: #121416; --card: #1d2125;
      --line: #59616a; --soft-blue: #102b3a; --soft-orange: #392d11;
    }
    .count { color: #fff; }
  }
  @media (max-width: 620px) {
    summary { grid-template-columns: 1fr; }
    .entry-type { grid-row: auto; }
  }
  @media print {
    .tools, .skip { display: none; }
    body, .catalog-entry, .dialog-preview, .excluded { background: #fff; color: #000; }
    .catalog-entry { break-inside: avoid; }
    .catalog-entry > .entry-body { display: block; }
  }
</style>
</head>
<body>
<a class="skip" href="#catalog">Skip to catalog</a>
<header class="page-head">
  <h1>Information dialog catalog</h1>
  <p class="lede">Open this committed file directly to review every authored information,
  help, calculation and category surface in Bird Chaser. The page is generated from the
  same files and renderers the app uses; edit the source, then regenerate this page.</p>
  <p class="inventory">${total} in-scope entries: ${data.sections.length} section calculation
  disclosures + ${data.dialogs.length} informational bottom-sheet families.</p>
</header>
<div class="tools" role="search">
  <div class="tool-row">
    <div class="search">
      <label for="catalogSearch">Search popup titles and content</label>
      <input id="catalogSearch" type="search" autocomplete="off"
        placeholder="Try: cascade, private, tide, spuh…">
    </div>
    <button type="button" id="expandAll">Expand all matches</button>
    <button type="button" id="collapseAll">Collapse all</button>
  </div>
  <p id="matchCount" aria-live="polite">Showing ${total} of ${total} in-scope entries.</p>
</div>
<main id="catalog">
  <p class="scope-note"><strong>Scope:</strong> information/help, calculation and category
  disclosures a reader can open in the real app. Transactional confirmations, navigation
  inputs, transient errors and record-specific observer content are classified below but
  intentionally excluded. ${inactive
    ? `The authored section-doc entries ${inactive} have no enabled menu information control and are not catalog entries.`
    : ''}</p>
  <section class="catalog-group" aria-labelledby="section-group">
    <h2 id="section-group">Section calculation disclosures
      <span class="count">${data.sections.length}</span></h2>
${sectionHtml}
  </section>
${dialogHtml}
  <section class="excluded" aria-labelledby="excluded-heading">
    <h2 id="excluded-heading">Classified but deliberately out of scope
      <span class="count">${data.excluded.length}</span></h2>
    <p>These are real popup types, but they are actions, confirmations, errors or
    record-specific data rather than authored informational prose.</p>
    <ul class="excluded-list">
${data.excluded.map(excludedEntry).join('\n')}
    </ul>
  </section>
  <footer>
    Generated deterministically by <code>assets/generate-info-catalog.js</code>.
    Run <code>npm run info-catalog</code> after editing
    <code>www/section-docs.json</code> or <code>www/info-dialogs.js</code>.
  </footer>
</main>
<script>
  (function () {
    'use strict';
    var input = document.getElementById('catalogSearch');
    var entries = Array.prototype.slice.call(document.querySelectorAll('.catalog-entry'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('.catalog-group'));
    var count = document.getElementById('matchCount');
    function applyFilter() {
      var query = (input.value || '').trim().toLowerCase();
      var shown = 0;
      entries.forEach(function (entry) {
        var match = !query || entry.textContent.toLowerCase().indexOf(query) >= 0;
        entry.hidden = !match;
        if (match) {
          shown++;
          if (query) entry.open = true;
        }
      });
      groups.forEach(function (group) {
        group.hidden = !group.querySelector('.catalog-entry:not([hidden])');
      });
      count.textContent = 'Showing ' + shown + ' of ${total} in-scope entries'
        + (query ? ' for “' + input.value.trim() + '”.' : '.');
    }
    input.addEventListener('input', applyFilter);
    document.getElementById('expandAll').addEventListener('click', function () {
      entries.forEach(function (entry) { if (!entry.hidden) entry.open = true; });
    });
    document.getElementById('collapseAll').addEventListener('click', function () {
      entries.forEach(function (entry) { entry.open = false; });
    });
  }());
</script>
</body>
</html>
`;
}

function writeCatalog(checkOnly) {
  const next = buildCatalog();
  const current = fs.existsSync(OUTPUT_PATH)
    ? fs.readFileSync(OUTPUT_PATH, 'utf8')
    : '';
  if (checkOnly) {
    if (current !== next) {
      throw new Error(
        'docs/info-dialogs.html is stale; run npm run info-catalog and commit the result');
    }
    return { changed: false, output: OUTPUT_PATH, inventory: inventory() };
  }
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  if (current !== next) fs.writeFileSync(OUTPUT_PATH, next, 'utf8');
  return { changed: current !== next, output: OUTPUT_PATH, inventory: inventory() };
}

if (require.main === module) {
  try {
    const result = writeCatalog(process.argv.includes('--check'));
    const total = result.inventory.sections.length + result.inventory.dialogs.length;
    console.log(
      `${process.argv.includes('--check') ? 'Verified' : (result.changed ? 'Wrote' : 'Unchanged')} `
      + `${path.relative(ROOT, result.output)} — ${total} in scope, `
      + `${result.inventory.excluded.length} excluded`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  OUTPUT_PATH,
  buildCatalog,
  inventory,
  writeCatalog,
};
