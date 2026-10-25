// Get It Sasta — server entry
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node.js ${process.versions.node} purana hai. Node 22.13+ ya 24 chahiye (hPanel → Build settings → Node version).`);
  process.exit(1);
}

const http = require('http');
const path = require('path');
const config = require('./config');
const { db } = require('./db');
const { hashPassword } = require('./password');
const { HttpError, createRouter, readBody, send, rateLimit, serveStatic } = require('./http');

// Password bhool gaye aur SSH nahi hai (Hostinger)? ADMIN_RESET_PASSWORD env daalo, restart karo, phir hata do.
if (process.env.ADMIN_RESET_PASSWORD && process.env.ADMIN_RESET_PASSWORD.length >= 8) {
  const h = hashPassword(process.env.ADMIN_RESET_PASSWORD);
  const ex = db.prepare('SELECT id FROM admins WHERE username = ?').get(config.ADMIN_USERNAME);
  if (ex) db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(h, ex.id);
  else db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(config.ADMIN_USERNAME, h);
  db.prepare('DELETE FROM sessions').run();
  console.warn(`[admin] "${config.ADMIN_USERNAME}" ka password reset ho gaya. Ab ADMIN_RESET_PASSWORD hata do.`);
}

const api = createRouter();
require('./routes/public')(api);
require('./routes/customer')(api);
require('./routes/admin')(api);
require('./routes/v1')(api);

const PUBLIC = path.join(config.ROOT, 'public');
const statics = serveStatic(PUBLIC, { maxAge: config.IS_PROD ? 3600 : 0 });
const uploads = serveStatic(config.UPLOAD_DIR, { memCache: false, immutable: true });
const apiLimit = rateLimit({ windowMs: 60e3, limit: 300 });

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  ...(config.IS_PROD ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

// Clean URLs → HTML pages
const PAGES = [
  [/^\/order\/[A-Za-z0-9-]+\/?$/, '/order.html'],
  [/^\/p\/\d+(-[\w-]*)?\/?$/, '/product.html'],
  [/^\/account\/?$/, '/account.html'],
  [/^\/account\/reset\/?$/, '/reset.html'],
  [/^\/unsubscribe\/?$/, '/unsubscribe.html'],
  [/^\/checkout\/?$/, '/checkout.html'],
];

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { res.statusCode = 400; return res.end('Bad request'); }
  req.ip = (config.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket.remoteAddress;

  try {
    if (url.pathname.startsWith('/api/v1') && req.method === 'OPTIONS') { res.writeHead(204, require('./routes/v1').CORS); return res.end(); }
    if (url.pathname.startsWith('/api/')) {
      apiLimit(req);
      const m = api.match(req.method, url.pathname);
      if (!m) throw new HttpError(404, 'Not found');
      const limit = /^\/api\/admin\/(products|settings|integrations)/.test(url.pathname) ? 6 * 1024 * 1024 : /^\/api\/admin\/plans\/\d+\/stock$/.test(url.pathname) ? 2 * 1024 * 1024 : 64 * 1024;
      // Email app ka one-click unsubscribe form body bhejta hai — use padhne ki zarurat nahi
      const { json, raw } = url.pathname === '/api/newsletter/unsubscribe' ? { json: {}, raw: Buffer.alloc(0) } : await readBody(req, limit);
      const ctx = { status: 200, headers: {}, cookies: [], raw: null };
      const arg = { req, res, params: m.params, query: url.searchParams, body: json, raw, ctx };
      let result;
      for (const h of m.handlers) result = await h(arg);
      if (ctx.cookies.length) res.setHeader('Set-Cookie', ctx.cookies);
      if (ctx.raw) {
        res.writeHead(200, { 'Content-Type': ctx.raw.type, 'Content-Disposition': `attachment; filename="${ctx.raw.name}"`, 'Cache-Control': 'no-store' });
        return res.end(ctx.raw.data);
      }
      return send(req, res, ctx.status, result ?? { ok: true }, ctx.headers);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (url.pathname.startsWith('/fonts/') && require('./lib/fonts').serve(req, res, url.pathname)) return;
    if (url.pathname.startsWith('/uploads/')) {
      const name = url.pathname.slice('/uploads/'.length);
      if (/^[\w.-]+\.(png|jpg|webp|gif)$/.test(name) && uploads(req, res, '/' + name)) return;
      res.statusCode = 404; return res.end('Not found');
    }
    for (const [re, page] of PAGES) if (re.test(url.pathname)) return statics(req, res, page);
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (statics(req, res, url.pathname)) return;
    res.statusCode = 404;
    statics(req, res, '/404.html') || res.end('Not found');
  } catch (e) {
    if (e instanceof HttpError) return send(req, res, e.status, { error: require('./lib/errtext').forReq(req, e.message) }, url.pathname.startsWith('/api/v1') ? require('./routes/v1').CORS : {});
    console.error(`[error] ${req.method} ${url.pathname}`, e);
    send(req, res, 500, { error: require('./lib/errtext').forReq(req, 'Server mein dikkat aayi. Thodi der baad try karo.') });
  }
});

server.requestTimeout = 60e3;
server.headersTimeout = 20e3;
server.keepAliveTimeout = 65e3;
server.listen(config.PORT, config.HOST, () => {
  console.log(`Get It Sasta chal raha hai → http://${config.HOST}:${config.PORT}`);
  console.log(`Data folder: ${config.DATA_DIR}${config.IS_HOSTINGER ? ' (Hostinger detected)' : ''}`);
  console.log(`Crypto (Get It Sasta Pay): ${require('./lib/paygate').configured() ? config.PAY_URL : 'off'} • Email: ${config.resendReady() ? 'Resend' : config.smtpReady() ? 'SMTP' : 'off'} • Admin 2-step: ${config.ADMIN_EMAIL && config.mailReady() ? 'ON' : 'off'}`);
});


require('./lib/upiverify').start();
require('./lib/fx').start();
require('./lib/support').start();
require('./lib/bots').start();
require('./lib/outhooks').start();
require('./lib/fulfil').start();
require('./lib/importer').start();
require('./lib/fonts').start();

// Roz ek backup apne aap. Hostinger idle app ko band kar deta hai, isliye start par bhi check.
function dailyBackup() {
  try {
    const fs = require('fs');
    const last = fs.readdirSync(config.BACKUP_DIR).filter(f => /^store-.*\.db$/.test(f)).sort().pop();
    const age = last ? Date.now() - fs.statSync(path.join(config.BACKUP_DIR, last)).mtimeMs : Infinity;
    if (age > 20 * 3600e3) require('./backup').makeBackup(db);
  } catch (e) { console.error('[backup]', e.message); }
}
setTimeout(dailyBackup, 10e3).unref();
setInterval(dailyBackup, 3 * 3600e3).unref();

const shutdown = () => { server.close(() => { try { db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
