// Draws the Chapter 3 figures from figures.mjs into images/*.svg and images/*.png,
// and rebuilds diagrams.html (a page that shows them all with download links).
// Run from anywhere:  node docs/diagrams/build.mjs            (or: node docs/diagrams/build.mjs 3-12  for one figure)
// One-time setup:     npm i --no-save --prefix docs/diagrams puppeteer-core
// Uses Microsoft Edge (or Chrome) and loads the Inter and Poppins fonts from Google Fonts, so it needs internet.
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { figures } from './figures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'images');
mkdirSync(out, { recursive: true });

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=block">';
const only = process.argv.slice(2);

const require = createRequire(resolve(here, 'package.json'));
const puppeteer = require('puppeteer-core');
const browserPath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!browserPath) throw new Error('Edge or Chrome not found');

const profile = mkdtempSync(resolve(tmpdir(), 'diagrams-browser-'));
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, userDataDir: profile, args: ['--no-first-run', '--no-default-browser-check'] });
try {
  const page = await browser.newPage();
  for (const fig of figures) {
    if (only.length && !only.some((o) => fig.file.includes(o))) continue;
    const svg = fig.draw();
    writeFileSync(resolve(out, fig.file + '.svg'), svg);
    const w = Number(svg.match(/width="(\d+)"/)[1]), h = Number(svg.match(/height="(\d+)"/)[1]);
    const scale = Math.min(3, Math.max(2, Math.round(4000 / w))); // whole-number scale, about 4000 px wide
    await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
    await page.setContent(`<!doctype html><html><head>${FONTS}<style>body{margin:0}svg{display:block}</style></head><body>${svg}</body></html>`, { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(async () => {
      await Promise.all(['Inter', 'Poppins'].flatMap((f) => [400, 600, 700].map((w) => document.fonts.load(`${w} 16px ${f}`))));
      await document.fonts.ready;
    });
    const el = await page.$('svg');
    await el.screenshot({ path: resolve(out, fig.file + '.png') });
    console.log(`${fig.file}  ${Math.round(w * scale)}x${Math.round(h * scale)}`);
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

// Gallery page
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sections = figures.map((f) => `<section class="fig">
  <div class="head"><h2>${esc(f.title)}</h2>
    <div class="actions"><a href="images/${f.file}.png" download>Download PNG</a><a href="images/${f.file}.svg" download>Download SVG</a></div></div>
  <div class="canvas"><img src="images/${f.file}.png" alt="${esc(f.title)}" loading="lazy"></div>
</section>`).join('\n');
writeFileSync(resolve(here, 'diagrams.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chapter 3 Diagrams</title>
<style>
:root { --bg:#f6f7f9; --card:#ffffff; --text:#1c2430; --muted:#5b6575; --border:#dde2e8; --accent:#1f5fbf; }
@media (prefers-color-scheme: dark) { :root { --bg:#14181f; --card:#1d232c; --text:#e7ebf0; --muted:#9aa5b4; --border:#2c3440; --accent:#6ea3ff; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding:24px 16px 8px; max-width:1100px; margin:0 auto; }
h1 { margin:0 0 4px; font-size:22px; }
header p { margin:0; color:var(--muted); }
main { max-width:1100px; margin:0 auto; padding:8px 16px 48px; display:grid; gap:20px; }
.fig { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px; }
.head { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
h2 { margin:0; font-size:16px; }
.actions { display:flex; gap:8px; }
.actions a { font-size:13px; padding:6px 10px; border-radius:6px; border:1px solid var(--accent); color:var(--accent); text-decoration:none; }
.actions a:hover { background:var(--accent); color:#fff; }
.canvas { margin-top:12px; background:#ffffff; border-radius:6px; padding:12px; }
.canvas img { display:block; max-width:100%; height:auto; margin:0 auto; }
</style></head>
<body>
<header><h1>Chapter 3 Diagrams</h1>
<p>Updated figures in the style of the original thesis figures. Use the PNG in Word (Insert → Pictures). The SVG needs the Inter and Poppins fonts installed to look the same.</p></header>
<main>
${sections}
</main>
</body></html>
`);
console.log('diagrams.html rebuilt');
