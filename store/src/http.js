// Chhota sa router + helpers (Express ki jagah, bina kisi package ke)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createRouter() {
  const routes = [];
  const add = method => (pattern, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handlers });
  };
  const router = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
  router.match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.re);
      if (m) return { handlers: r.handlers, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  };
  return router;
}

// Body padho: JSON parse + raw buffer (webhook signature ke liye)
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return resolve({ json: {}, raw: Buffer.alloc(0) });
    const type = req.headers['content-type'] || '';
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request bahut badi hai.')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length) return resolve({ json: {}, raw });
      if (!type.includes('application/json')) return reject(new HttpError(415, 'JSON bhejo.'));
      try { const v = JSON.parse(raw.toString('utf8')); resolve({ json: v && typeof v === 'object' && !Array.isArray(v) ? v : {}, raw }); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(req, res, status, body, headers = {}) {
  let data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers };
  if (data.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    data = zlib.gzipSync(data); h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding';
  }
  res.writeHead(status, h);
  res.end(data);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// In-memory rate limiter (ek VPS process ke liye kaafi)
function rateLimit({ windowMs, limit, message }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return arg => {
    const key = (arg.req || arg).ip; const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e); }
    if (++e.count > limit) throw new HttpError(429, message || 'Bahut zyada requests. Thodi der baad try karo.');
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function serveStatic(root, { maxAge = 0, memCache = true, immutable = false } = {}) {
  const cache = new Map(), vers = new Map();
  // Har deploy par CSS/JS ka naya URL (?v=hash) → browser / Hostinger CDN purani file nahi dikha sakte
  const ver = rel => {
    const f = path.join(root, rel); let st; try { st = fs.statSync(f); } catch { return ''; }
    const k = f + st.mtimeMs + ':' + st.size; let v = vers.get(k);
    if (!v) { v = require('crypto').createHash('md5').update(fs.readFileSync(f)).digest('hex').slice(0, 10); vers.set(k, v); }
    return v;
  };
  const stamp = buf => Buffer.from(buf.toString('utf8').replace(/((?:href|src)=")(\/assets\/[^"?#]+\.(?:css|js))(")/g, (m, a, p, b) => { const v = ver(p); return v ? `${a}${p}?v=${v}${b}` : m; }));
  return (req, res, pathname) => {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) return false;
    if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
    let stat; try { stat = fs.statSync(file); } catch { return false; }
    if (!stat.isFile()) return false;
    const ext = path.extname(file);
    // Brotli (sabse chhota) > gzip; ek baar compress karke memory mein
    const ae = req.headers['accept-encoding'] || '', compressible = /\.(html|css|js|svg|json|txt)$/.test(ext);
    const enc = compressible && /\bbr\b/.test(ae) ? 'br' : compressible && /\bgzip\b/.test(ae) ? 'gzip' : '';
    const fv = ext === '.html' ? require('./lib/fonts').version() : '';
    const key = `${file}:${enc}:${fv}`;
    let entry = cache.get(key);
    if (!entry || entry.mtime !== stat.mtimeMs) {
      let raw = fs.readFileSync(file);
      if (ext === '.html') raw = Buffer.from(require('./lib/fonts').rewrite(stamp(raw).toString('utf8')));
      const data = enc === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : enc === 'gzip' ? zlib.gzipSync(raw, { level: 9 }) : raw;
      entry = { mtime: stat.mtimeMs, data, etag: `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}${fv ? '-' + fv : ''}${enc ? '-' + enc : ''}"` };
      if (memCache) cache.set(key, entry);
    }
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : immutable || /[?&]v=[a-f0-9]{10}\b/.test(req.url || '') ? 'public, max-age=31536000, immutable' : `public, max-age=${maxAge}`,
      ETag: entry.etag, Vary: 'Accept-Encoding',
    };
    if (enc) headers['Content-Encoding'] = enc;
    if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return true; }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : entry.data);
    return true;
  };
}

module.exports = { HttpError, createRouter, readBody, send, parseCookies, rateLimit, serveStatic };
