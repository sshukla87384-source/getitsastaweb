// Get It Sasta Pay — server
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node.js ${process.versions.node} purana hai. Node 22.13+ ya 24 chahiye.`);
  process.exit(1);
}
const http = require('http');
const path = require('path');
const config = require('./config');
const { db } = require('./db');
const { hashPassword } = require('./password');
const { HttpError, createRouter, readBody, send, rateLimit, serveStatic } = require('./http');

if (process.env.ADMIN_RESET_PASSWORD && process.env.ADMIN_RESET_PASSWORD.length >= 8) {
  const h = hashPassword(process.env.ADMIN_RESET_PASSWORD);
  const ex = db.prepare('SELECT id FROM admins WHERE username = ?').get(config.ADMIN_USERNAME);
  if (ex) db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(h, ex.id);
  else db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(config.ADMIN_USERNAME, h);
  db.prepare('DELETE FROM sessions').run();
  console.warn(`[admin] "${config.ADMIN_USERNAME}" ka password reset ho gaya. Ab ADMIN_RESET_PASSWORD hata do.`);
}

const api = createRouter();
require('./routes')(api);

const statics = serveStatic(path.join(config.ROOT, 'public'), { maxAge: config.IS_PROD ? 3600 : 0 });
const apiLimit = rateLimit({ windowMs: 60e3, limit: 400 });

const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  ...(config.IS_PROD ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { res.statusCode = 400; return res.end('Bad request'); }
  req.ip = (config.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket.remoteAddress;   // aakhri entry = hamare proxy ne jo dekha
  try {
    if (url.pathname.startsWith('/api/')) {
      apiLimit(req);
      const m = api.match(req.method, url.pathname);
      if (!m) throw new HttpError(404, 'Not found');
      const { json, raw } = await readBody(req, 64 * 1024);
      const ctx = { status: 200, headers: {}, cookies: [] };
      let result;
      for (const h of m.handlers) result = await h({ req, res, params: m.params, query: url.searchParams, body: json, raw, ctx });
      if (ctx.cookies.length) res.setHeader('Set-Cookie', ctx.cookies);
      return send(req, res, ctx.status, result ?? { ok: true }, ctx.headers);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (/^\/i\/inv_[a-z0-9]{16}\/?$/.test(url.pathname)) return statics(req, res, '/pay.html');
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
    if (statics(req, res, url.pathname)) return;
    res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Not found');
  } catch (e) {
    if (e instanceof HttpError) return send(req, res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error(`[error] ${req.method} ${url.pathname}`, e);
    send(req, res, 500, { error: 'Server mein dikkat aayi. Thodi der baad try karo.' });
  }
});
server.requestTimeout = 60e3; server.headersTimeout = 20e3; server.keepAliveTimeout = 65e3;
server.listen(config.PORT, config.HOST, () => {
  const inv = require('./lib/invoices');
  console.log(`Get It Sasta Pay chal raha hai → http://${config.HOST}:${config.PORT}`);
  console.log(`Data folder: ${config.DATA_DIR}${config.IS_HOSTINGER ? ' (Hostinger detected)' : ''}`);
  console.log(`Methods: ${inv.methods().map(m => m.key).join(', ') || 'koi nahi (admin → Settings)'}${config.PUBLIC_URL ? '' : ' • PUBLIC_URL set karo'}`);
});
require('./lib/invoices').start();
require('./lib/webhooks').start();

// Roz ek backup
function backup() {
  try {
    const fs = require('fs');
    const last = fs.readdirSync(config.BACKUP_DIR).filter(f => /^pay-.*\.db$/.test(f)).sort().pop();
    if (last && Date.now() - fs.statSync(path.join(config.BACKUP_DIR, last)).mtimeMs < 20 * 3600e3) return;
    const file = path.join(config.BACKUP_DIR, `pay-${new Date().toISOString().slice(0, 10)}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    for (const f of fs.readdirSync(config.BACKUP_DIR).filter(f => /^pay-.*\.db$/.test(f)).sort().slice(0, -14)) fs.unlinkSync(path.join(config.BACKUP_DIR, f));
  } catch (e) { console.error('[backup]', e.message); }
}
setTimeout(backup, 10e3).unref(); setInterval(backup, 3 * 3600e3).unref();

const shutdown = () => { server.close(() => { try { db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
