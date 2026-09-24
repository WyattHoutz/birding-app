'use strict';

const fs = require('node:fs');
const path = require('node:path');

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function parseReadme(text) {
  const entries = [];
  const lines = String(text).split(/\r?\n/);
  let title = '';
  for (const line of lines) {
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      title = heading[1].trim();
      continue;
    }
    const image = /^!\[(.*)\]\(([^)]+\.png)\)$/.exec(line);
    if (image) {
      entries.push({
        title: title || image[1].trim(),
        alt: image[1].trim(),
        file: image[2].trim(),
      });
    }
  }
  return entries;
}

function readWidth(inputRoot, width) {
  const dir = path.join(inputRoot, String(width));
  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) throw new Error(`${width}px gallery has no README.md`);
  const entries = parseReadme(fs.readFileSync(readme, 'utf8'));
  if (!entries.length) throw new Error(`${width}px gallery has no images`);
  for (const entry of entries) {
    const source = path.join(dir, entry.file);
    if (!fs.existsSync(source)) throw new Error(`missing gallery image ${source}`);
  }
  return { dir, entries };
}

function renderGallery(version, releaseUrl, widths) {
  const left = widths[393].entries;
  const right = widths[402].entries;
  if (left.length !== right.length) {
    throw new Error(`gallery counts differ: 393=${left.length}, 402=${right.length}`);
  }
  const rows = left.map((entry, index) => {
    const other = right[index];
    if (entry.title !== other.title) {
      throw new Error(`gallery order differs at ${index + 1}: ${entry.title} / ${other.title}`);
    }
    const search = `${entry.title} ${entry.alt} ${other.alt}`.toLowerCase();
    return `<article class="shot" data-search="${esc(search)}">
  <h2>${esc(entry.title)}</h2>
  <div class="pair">
    <figure>
      <figcaption><strong>393px</strong><span>iPhone 14/15 Pro</span></figcaption>
      <a href="393/${esc(entry.file)}"><img loading="lazy" src="393/${esc(entry.file)}" alt="${esc(entry.alt)} at 393 pixels wide"></a>
    </figure>
    <figure>
      <figcaption><strong>402px</strong><span>iPhone 16 Pro</span></figcaption>
      <a href="402/${esc(other.file)}"><img loading="lazy" src="402/${esc(other.file)}" alt="${esc(other.alt)} at 402 pixels wide"></a>
    </figure>
  </div>
</article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bird Chaser ${esc(version)} mockups</title>
<style>
:root{color-scheme:light dark;--blue:#0072B2;--orange:#E69F00;--bg:#f4f6f8;--card:#fff;--ink:#171717;--muted:#555;--line:#c7cdd2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{border-bottom:5px solid var(--blue);background:var(--card);padding:24px max(16px,calc((100vw - 1100px)/2))}
h1{margin:0 0 6px}.lede{margin:0;max-width:72ch}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px}
a{color:var(--blue);text-underline-offset:3px}.release{font-weight:800}
.tools{position:sticky;top:0;z-index:2;background:var(--card);border-bottom:1px solid var(--line);padding:12px max(16px,calc((100vw - 1100px)/2))}
label{display:block;font-weight:800;margin-bottom:4px}input{width:min(100%,560px);min-height:44px;border:2px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit;padding:8px 11px}
main{max-width:1100px;margin:auto;padding:20px 16px 60px}.shot{margin:0 0 28px;scroll-margin-top:90px}.shot[hidden]{display:none}
.shot h2{font-size:1.15rem;margin:0 0 8px;border-left:6px solid var(--orange);padding-left:10px}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
figcaption{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line)}figcaption span{color:var(--muted)}
img{display:block;width:100%;height:auto;background:#fff}a:focus-visible,input:focus-visible{outline:3px solid var(--orange);outline-offset:3px}
#count{margin:6px 0 0;color:var(--muted)}
@media(max-width:760px){.pair{grid-template-columns:1fr}figcaption{position:sticky;top:76px}}
@media(prefers-color-scheme:dark){:root{--bg:#111416;--card:#1d2226;--ink:#f4f4f4;--muted:#c4c8cc;--line:#59616a}}
</style>
</head>
<body>
<header>
  <h1>Bird Chaser ${esc(version)} mockups</h1>
  <p class="lede">Every production release screenshot, shown at the binding 393px width and the owner-device 402px width. Select an image to open it at full size.</p>
  <div class="actions"><a class="release" href="${esc(releaseUrl)}">Open GitHub Release ${esc(version)}</a><a href="../../">Latest gallery</a></div>
</header>
<div class="tools">
  <label for="filter">Filter screenshots</label>
  <input id="filter" type="search" placeholder="Try: Twitches, Nemesis, Stakeout…">
  <p id="count">${left.length} screenshot pairs</p>
</div>
<main>${rows}</main>
<script>
const input=document.getElementById('filter');
const shots=[...document.querySelectorAll('.shot')];
const count=document.getElementById('count');
input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();let shown=0;for(const shot of shots){shot.hidden=q&&!shot.dataset.search.includes(q);if(!shot.hidden)shown++}count.textContent=shown+' of '+shots.length+' screenshot pairs'});
</script>
</body>
</html>`;
}

function buildGallery({ inputRoot, siteRoot, version, releaseUrl }) {
  if (!version) throw new Error('version is required');
  const widths = {
    393: readWidth(inputRoot, 393),
    402: readWidth(inputRoot, 402),
  };
  const versionDir = path.join(siteRoot, 'mockups', `v${version}`);
  fs.rmSync(versionDir, { recursive: true, force: true });
  fs.mkdirSync(versionDir, { recursive: true });
  for (const width of [393, 402]) {
    const destination = path.join(versionDir, String(width));
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of widths[width].entries) {
      fs.copyFileSync(path.join(widths[width].dir, entry.file),
        path.join(destination, entry.file));
    }
  }
  fs.writeFileSync(path.join(versionDir, 'index.html'),
    renderGallery(`v${version}`, releaseUrl, widths));
  fs.writeFileSync(path.join(siteRoot, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Bird Chaser mockups</title><meta http-equiv="refresh" content="0;url=mockups/v${esc(version)}/"><p><a href="mockups/v${esc(version)}/">Open Bird Chaser v${esc(version)} mockups</a></p>`);
  fs.writeFileSync(path.join(siteRoot, '.nojekyll'), '');
  return { count: widths[393].entries.length, versionDir };
}

function cliArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) values[argv[i]] = argv[i + 1];
  return {
    inputRoot: values['--input'],
    siteRoot: values['--site'],
    version: values['--version'],
    releaseUrl: values['--release-url'],
  };
}

module.exports = { parseReadme, renderGallery, buildGallery };

if (require.main === module) {
  const result = buildGallery(cliArgs(process.argv.slice(2)));
  console.log(`Built ${result.count} screenshot pairs in ${result.versionDir}`);
}
