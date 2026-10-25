const config = require('./config');
const { db, plain, getSettings, setSetting } = require('./db');
const { rateLimit, parseCookies } = require('./http');
const { hashPassword, verifyPassword } = require('./password');
const { str, fail, token, sha256, usdt, isHttpUrl } = require('./lib/util');
const addr = require('./lib/addr');
const chain = require('./lib/chain');
const binance = require('./lib/binance');
const inv = require('./lib/invoices');
const webhooks = require('./lib/webhooks');

const COOKIE = 'gsp_admin';
const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 8, message: 'Bahut zyada login try. 15 minute baad.' });
const submitLimit = rateLimit({ windowMs: 10 * 60e3, limit: 25, message: 'Bahut zyada try. 10 minute baad dobara.' });
const jsonOnly = req => { if (req.method !== 'GET' && !(req.headers['content-type'] || '').includes('application/json')) fail(415, 'Invalid request'); };
const MASK = '••••••••';

function requireAdmin({ req }) {
  jsonOnly(req);
  const t = parseCookies(req)[COOKIE];
  if (!t) fail(401, 'Login karo');
  const row = db.prepare('SELECT s.admin_id, s.expires_at, a.username FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token = ?').get(sha256(t));
  if (!row || row.expires_at < Date.now()) fail(401, 'Session khatam. Dobara login karo.');
  req.admin = { id: row.admin_id, username: row.username };
}
function requireClient({ req }) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(gsp_[a-z0-9]{40,})$/i);
  if (!m) fail(401, 'Authorization: Bearer <API key> chahiye');
  const c = plain(db.prepare('SELECT * FROM clients WHERE key_hash = ?').get(sha256(m[1])));
  if (!c || !c.active) fail(401, 'API key galat ya band hai');
  db.prepare('UPDATE clients SET last_used_at = ? WHERE id = ?').run(Date.now(), c.id);
  req.client = c;
}
const payUrl = (req, id) => `${config.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`}/i/${id}`;
const cookieFlags = () => `Path=/; HttpOnly; SameSite=Strict${config.IS_PROD ? '; Secure' : ''}`;

module.exports = api => {
  // =================== Store API (v1) ===================
  api.post('/api/v1/invoices', requireClient, ({ req, body, ctx }) => {
    jsonOnly(req);
    const i = inv.create(req.client, body);
    ctx.status = 201;
    return { ...inv.view(i), pay_url: payUrl(req, i.id) };
  });
  api.get('/api/v1/invoices/:id', requireClient, ({ req, params }) => {
    const i = inv.get(params.id);
    if (!i || i.client_id !== req.client.id) fail(404, 'Invoice nahi mila');
    return { ...inv.view(i), pay_url: payUrl(req, i.id) };
  });
  api.get('/api/v1/methods', requireClient, () => ({ methods: inv.methods().map(m => ({ key: m.key, label: m.label })) }));

  // =================== Pay page (customer) ===================
  const pub = id => { const i = inv.get(id); if (!i) fail(404, 'Ye payment link sahi nahi hai.'); return i; };
  api.get('/api/pay/:id', ({ params }) => inv.view(pub(params.id)));
  api.post('/api/pay/:id/method', submitLimit, ({ req, params, body }) => { jsonOnly(req); return inv.view(inv.choose(pub(params.id), str(body.method, 12))); });
  api.post('/api/pay/:id/submit', submitLimit, async ({ req, params, body }) => {
    jsonOnly(req);
    return inv.view(await inv.submit(pub(params.id), str(body.method, 12), str(body.ref, 100)));
  });

  // =================== Admin ===================
  api.post('/api/admin/login', loginLimit, ({ req, body, ctx }) => {
    jsonOnly(req);
    const a = plain(db.prepare('SELECT * FROM admins WHERE username = ?').get(str(body.username, 60)));
    if (!a || !verifyPassword(str(body.password, 200), a.password_hash)) fail(401, 'Username ya password galat hai.');
    const t = token();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token, admin_id, expires_at, created_at, ip) VALUES (?,?,?,?,?)').run(sha256(t), a.id, Date.now() + 7 * 86400e3, Date.now(), req.ip || '');
    ctx.cookies.push(`${COOKIE}=${t}; Max-Age=${7 * 86400}; ${cookieFlags()}`);
    return { username: a.username };
  });
  api.post('/api/admin/logout', ({ req, ctx }) => {
    const t = parseCookies(req)[COOKIE];
    if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(sha256(t));
    ctx.cookies.push(`${COOKIE}=; Max-Age=0; ${cookieFlags()}`);
    return { ok: true };
  });
  api.get('/api/admin/me', requireAdmin, ({ req }) => ({ username: req.admin.username }));
  api.post('/api/admin/password', requireAdmin, ({ req, body }) => {
    const a = plain(db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id));
    if (!verifyPassword(str(body.current, 200), a.password_hash)) fail(400, 'Purana password galat hai.');
    if (str(body.next, 200).length < 10) fail(400, 'Naya password kam se kam 10 characters.');
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(str(body.next, 200)), a.id);
    db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token != ?').run(a.id, sha256(parseCookies(req)[COOKIE]));
    return { ok: true };
  });

  api.get('/api/admin/overview', requireAdmin, () => {
    const day = Date.now() - 86400e3;
    const paid = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(paid_micro),0) v FROM invoices WHERE status='paid' AND paid_at > ?").get(day);
    const by = db.prepare("SELECT status, COUNT(*) n FROM invoices WHERE created_at > ? GROUP BY status").all(Date.now() - 7 * 86400e3);
    const s = getSettings();
    return {
      paid24: paid.n, paid24_usdt: usdt(paid.v),
      review: db.prepare("SELECT COUNT(*) n FROM invoices WHERE status='review'").get().n,
      open: db.prepare("SELECT COUNT(*) n FROM invoices WHERE status IN ('pending','confirming') AND expires_at > ?").get(Date.now()).n,
      week: Object.fromEntries(by.map(r => [r.status, r.n])),
      methods: inv.METHOD_KEYS.map(k => { const c = inv.cfgOf(k, s); return { key: k, on: !!c.on, ready: inv.methodReady(k, c) }; }),
      clients: db.prepare('SELECT COUNT(*) n FROM clients WHERE active = 1').get().n,
      webhook_failed: db.prepare("SELECT COUNT(*) n FROM webhooks WHERE status='failed'").get().n,
      public_url: !!config.PUBLIC_URL,
    };
  });

  api.get('/api/admin/invoices', requireAdmin, ({ query }) => {
    const st = str(query.get('status'), 20), q = str(query.get('q'), 80);
    const where = [], args = [];
    if (st === 'expired') { where.push("(status = 'expired' OR (status = 'pending' AND expires_at < ?))"); args.push(Date.now()); }
    else if (st === 'pending') { where.push("status = 'pending' AND expires_at >= ?"); args.push(Date.now()); }
    else if (st) { where.push('status = ?'); args.push(st); }
    if (q) { where.push('(id LIKE ? OR order_id LIKE ? OR tx LIKE ? OR customer_email LIKE ?)'); const l = `%${q}%`; args.push(l, l, l, l); }
    const rows = db.prepare(`SELECT * FROM invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`).all(...args).map(plain);
    const names = Object.fromEntries(db.prepare('SELECT id, name FROM clients').all().map(r => [r.id, r.name]));
    return rows.map(r => ({ ...inv.view(r, { admin: true }), client: names[r.client_id] || '' }));
  });
  api.get('/api/admin/invoices/:id', requireAdmin, ({ params }) => {
    const i = inv.get(params.id); if (!i) fail(404, 'Invoice nahi mila');
    return {
      ...inv.view(i, { admin: true }),
      client: plain(db.prepare('SELECT name FROM clients WHERE id = ?').get(i.client_id))?.name || '',
      events: db.prepare('SELECT * FROM events WHERE invoice_id = ? ORDER BY id DESC').all(i.id).map(plain),
      webhooks: db.prepare('SELECT id, event, status, attempts, last_code, last_error, created_at FROM webhooks WHERE invoice_id = ? ORDER BY id DESC').all(i.id).map(plain),
    };
  });
  api.post('/api/admin/invoices/:id/action', requireAdmin, ({ params, body }) => {
    const i = inv.get(params.id); if (!i) fail(404, 'Invoice nahi mila');
    return inv.view(inv.adminAction(i, str(body.action, 20), body.note), { admin: true });
  });
  api.post('/api/admin/webhooks/:id/retry', requireAdmin, async ({ params }) => { await webhooks.retry(Number(params.id)); return plain(db.prepare('SELECT id, status, attempts, last_code, last_error FROM webhooks WHERE id = ?').get(Number(params.id))); });

  // ---------- Settings / methods ----------
  const SECRET_FIELDS = ['key', 'api_key', 'api_secret'];
  const settingsView = () => {
    const s = getSettings();
    const out = { brand_name: s.brand_name, support_contact: s.support_contact, invoice_minutes: Number(s.invoice_minutes), late_hours: Number(s.late_hours), methods: {} };
    for (const k of inv.METHOD_KEYS) {
      const c = inv.cfgOf(k, s);
      for (const f of SECRET_FIELDS) if (f in c) c[f] = c[f] ? MASK : '';
      out.methods[k] = { ...c, ready: inv.methodReady(k, inv.cfgOf(k, s)) };
    }
    return out;
  };
  api.get('/api/admin/settings', requireAdmin, settingsView);
  function cleanMethod(k, input) {
    const old = inv.cfgOf(k);
    const c = { ...old };
    if (input.on !== undefined) c.on = !!input.on;
    const keep = (f, v) => (v === MASK ? old[f] : str(v, 300));
    if (k === 'binance') {
      for (const f of ['pay_id', 'name', 'url', 'api_key', 'api_secret']) if (input[f] !== undefined) c[f] = keep(f, input[f]);
      if (c.pay_id && !/^[0-9A-Za-z_-]{3,40}$/.test(c.pay_id)) fail(400, 'Binance Pay ID sirf number / letters (Binance app → Pay → Pay ID).');
      if (c.url && !isHttpUrl(c.url)) fail(400, 'Binance API URL sahi nahi hai.');
      if (c.on && !(c.pay_id && c.api_key && c.api_secret)) fail(400, 'Binance Pay ON karne ke liye Pay ID, API key aur Secret teeno chahiye.');
    } else {
      for (const f of ['address', 'url', 'header', 'key']) if (input[f] !== undefined) c[f] = keep(f, input[f]);
      if (input.confirmations !== undefined) {
        const n = Number(input.confirmations);
        if (!(n >= 1 && n <= 500)) fail(400, 'Confirmations 1 se 500 ke beech.');
        c.confirmations = Math.round(n);
      }
      if (c.address) {
        if (chain.CHAINS[k].kind === 'tron') { if (!addr.isTronAddress(c.address)) fail(400, `${chain.CHAINS[k].label}: TRON address T se shuru, 34 characters.`); }
        else { if (!addr.isEvmAddress(c.address)) fail(400, `${chain.CHAINS[k].label}: address 0x se shuru, 42 characters.`); c.address = addr.toChecksum(c.address.slice(2)); }
      }
      if (c.url && !isHttpUrl(c.url)) fail(400, `${chain.CHAINS[k].label}: provider URL http(s):// se shuru.`);
      if (c.header && !/^[A-Za-z0-9-]{1,60}$/.test(c.header)) fail(400, 'Header naam sirf letters, numbers aur - (jaise TRON-PRO-API-KEY).');
      if (c.on && !(c.address && c.url)) fail(400, `${chain.CHAINS[k].label} ON karne ke liye address aur provider URL chahiye.`);
    }
    return c;
  }
  api.put('/api/admin/settings', requireAdmin, ({ body }) => {
    const upd = {};
    if (body.brand_name !== undefined) upd.brand_name = str(body.brand_name, 60) || 'Get It Sasta Pay';
    if (body.support_contact !== undefined) upd.support_contact = str(body.support_contact, 200);
    if (body.invoice_minutes !== undefined) { const n = Number(body.invoice_minutes); if (!(n >= 10 && n <= 1440)) fail(400, 'Payment time 10 se 1440 minute.'); upd.invoice_minutes = Math.round(n); }
    if (body.late_hours !== undefined) { const n = Number(body.late_hours); if (!(n >= 0 && n <= 168)) fail(400, 'Late payment window 0 se 168 ghante.'); upd.late_hours = Math.round(n); }
    for (const [k, v] of Object.entries(body.methods || {})) if (inv.METHOD_KEYS.includes(k) && v && typeof v === 'object') upd[`net_${k}`] = JSON.stringify(cleanMethod(k, v));
    db.transaction(() => { for (const [k, v] of Object.entries(upd)) setSetting(k, v); })();
    return settingsView();
  });
  api.post('/api/admin/test/:method', requireAdmin, async ({ params, body }) => {
    const k = params.method;
    if (!inv.METHOD_KEYS.includes(k)) fail(400, 'Galat method');
    const c = { ...inv.cfgOf(k) };
    for (const [f, v] of Object.entries(body || {})) if (v !== undefined && v !== MASK && typeof v === 'string') c[f] = v.trim();
    try {
      if (k === 'binance') { const r = await binance.test(c); return { ok: true, message: `✓ Binance se juda • pichhle 7 din ke ${r.count} Pay records • ${r.ms} ms` }; }
      const r = await chain.test(k, c); return { ok: true, message: `✓ Connected • latest block ${r.block.toLocaleString('en-IN')} • ${r.ms} ms` };
    } catch (e) { fail(502, e.message); }
  });

  // ---------- Clients (stores) ----------
  const clientView = c => ({ id: c.id, name: c.name, key_prefix: c.key_prefix, webhook_url: c.webhook_url, active: !!c.active, created_at: c.created_at, last_used_at: c.last_used_at });
  const newKey = () => 'gsp_' + token(24);
  api.get('/api/admin/clients', requireAdmin, () => db.prepare('SELECT * FROM clients ORDER BY id').all().map(plain).map(clientView));
  api.post('/api/admin/clients', requireAdmin, ({ body, ctx }) => {
    const name = str(body.name, 60), url = str(body.webhook_url, 500);
    if (name.length < 2) fail(400, 'Store ka naam daalo.');
    if (url && !isHttpUrl(url)) fail(400, 'Webhook URL http(s):// se shuru.');
    const key = newKey(), secret = 'whsec_' + token(24);
    const r = db.prepare('INSERT INTO clients (name, key_prefix, key_hash, webhook_url, webhook_secret, created_at) VALUES (?,?,?,?,?,?)').run(name, key.slice(0, 12), sha256(key), url, secret, Date.now());
    ctx.status = 201;
    return { ...clientView(plain(db.prepare('SELECT * FROM clients WHERE id = ?').get(r.lastInsertRowid))), api_key: key, webhook_secret: secret };
  });
  api.put('/api/admin/clients/:id', requireAdmin, ({ params, body }) => {
    const c = plain(db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(params.id))); if (!c) fail(404, 'Store nahi mila');
    const url = body.webhook_url !== undefined ? str(body.webhook_url, 500) : c.webhook_url;
    if (url && !isHttpUrl(url)) fail(400, 'Webhook URL http(s):// se shuru.');
    db.prepare('UPDATE clients SET name = ?, webhook_url = ?, active = ? WHERE id = ?').run(str(body.name, 60) || c.name, url, body.active === undefined ? c.active : body.active ? 1 : 0, c.id);
    return clientView(plain(db.prepare('SELECT * FROM clients WHERE id = ?').get(c.id)));
  });
  api.post('/api/admin/clients/:id/rotate', requireAdmin, ({ params, body }) => {
    const c = plain(db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(params.id))); if (!c) fail(404, 'Store nahi mila');
    const out = {};
    if (body.what !== 'secret') { const key = newKey(); db.prepare('UPDATE clients SET key_prefix = ?, key_hash = ? WHERE id = ?').run(key.slice(0, 12), sha256(key), c.id); out.api_key = key; }
    if (body.what !== 'key') { const s = 'whsec_' + token(24); db.prepare('UPDATE clients SET webhook_secret = ? WHERE id = ?').run(s, c.id); out.webhook_secret = s; }
    return out;
  });
  api.post('/api/admin/clients/:id/test-webhook', requireAdmin, async ({ params }) => {
    const c = plain(db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(params.id))); if (!c) fail(404, 'Store nahi mila');
    if (!c.webhook_url) fail(400, 'Pehle webhook URL daalo.');
    const payload = JSON.stringify({ event: 'ping', created: Date.now(), data: { message: 'Get It Sasta Pay test' } });
    const ts = String(Math.floor(Date.now() / 1000));
    try {
      const res = await fetch(c.webhook_url, { method: 'POST', body: payload, signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'X-GSP-Timestamp': ts, 'X-GSP-Signature': require('./lib/util').hmac(c.webhook_secret, `${ts}.${payload}`), 'X-GSP-Event': 'ping' } });
      if (!res.ok) fail(502, `Store ne HTTP ${res.status} diya: ${(await res.text()).slice(0, 120)}`);
      return { ok: true, message: `✓ Store ne webhook le liya (HTTP ${res.status})` };
    } catch (e) { if (e.status) throw e; fail(502, 'Store tak nahi pahunche: ' + e.message); }
  });
};
