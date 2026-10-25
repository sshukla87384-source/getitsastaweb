// Fonts apne server se: pehli start par Google Fonts se ek baar download (sirf latin + devanagari), phir hamesha local.
// Fayda: har page par Google ka extra connection nahi → tez load, privacy. Download na ho sake to Google wala link chalta rehta hai.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const CSS_URL = process.env.FONTS_CSS_URL || 'https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800&family=Hind:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap';
const DIR = path.join(config.DATA_DIR, 'fonts');
const CSS_FILE = path.join(DIR, 'fonts.css');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const KEEP = /\/\*\s*(latin|latin-ext|devanagari)\s*\*\//;

let version = '';
function readVersion() {
  try { version = crypto.createHash('md5').update(fs.readFileSync(CSS_FILE)).digest('hex').slice(0, 10); } catch { version = ''; }
  return version;
}
const ready = () => !!version;

async function download() {
  if (process.env.FONTS_LOCAL === '0') return false;
  const r = await fetch(CSS_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`fonts css HTTP ${r.status}`);
  const css = await r.text();
  // har @font-face block apne subset comment ke saath
  const blocks = css.split(/(?=\/\*\s*[\w-]+\s*\*\/)/).filter(b => KEEP.test(b) && /@font-face/.test(b));
  if (!blocks.length) throw new Error('fonts css khaali');
  fs.mkdirSync(DIR, { recursive: true });
  let out = '';
  for (const b of blocks) {
    const m = b.match(/url\((https?:\/\/[^)]+\.woff2)\)/);
    if (!m) continue;
    const name = crypto.createHash('sha1').update(m[1]).digest('hex').slice(0, 16) + '.woff2';
    const file = path.join(DIR, name);
    if (!fs.existsSync(file)) {
      const f = await fetch(m[1], { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!f.ok) throw new Error(`font HTTP ${f.status}`);
      const buf = Buffer.from(await f.arrayBuffer());
      if (buf.length < 1000 || buf.toString('ascii', 0, 4) !== 'wOF2') throw new Error('font file sahi nahi');
      fs.writeFileSync(file, buf);
    }
    out += b.replace(m[1], `/fonts/${name}`);
  }
  if (!out) throw new Error('koi font nahi mila');
  fs.writeFileSync(CSS_FILE + '.tmp', out); fs.renameSync(CSS_FILE + '.tmp', CSS_FILE);
  readVersion();
  console.log(`[fonts] ${blocks.length} font files local ho gayi — ab Google Fonts ki zarurat nahi`);
  return true;
}

function start() {
  if (readVersion()) return;
  const tryIt = (n = 0) => download().catch(e => { console.error('[fonts]', e.message); if (n < 3) setTimeout(() => tryIt(n + 1), 60e3 * (n + 1)).unref(); });
  setTimeout(tryIt, 2000).unref();
}

// HTML mein Google Fonts ke links → local (jab ready ho)
function rewrite(html) {
  if (!version) return html;
  return html
    .replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\s*/g, '')
    .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2[^"]*">/g, `<link rel="stylesheet" href="/fonts/fonts.css?v=${version}">`);
}

// /fonts/* serve (immutable)
function serve(req, res, pathname) {
  const name = pathname.slice('/fonts/'.length);
  if (!/^[a-f0-9]{16}\.woff2$|^fonts\.css$/.test(name)) return false;
  const file = path.join(DIR, name);
  let buf; try { buf = fs.readFileSync(file); } catch { return false; }
  res.writeHead(200, { 'Content-Type': name.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' });
  res.end(req.method === 'HEAD' ? undefined : buf);
  return true;
}

module.exports = { start, rewrite, serve, ready, version: () => version, download };
