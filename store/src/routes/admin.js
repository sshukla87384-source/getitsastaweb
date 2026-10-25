const fs = require('fs');
const config = require('../config');
const { db, plain, getSettings, listProducts } = require('../db');
const { rateLimit } = require('../http');
const { hashPassword, verifyPassword } = require('../password');
const { str, int, fail, isEmail } = require('../lib/util');
const { startAdminSession, endAdminSession, requireAdmin, jsonOnly } = require('../lib/auth');
const { saveImage, deleteImage } = require('../lib/images');
const { sendMail, layout } = require('../lib/mailer');
const otp = require('../lib/otp');
const { makeBackup } = require('../backup');
const orders = require('../lib/orders');
const pay = require('../lib/paygate');

const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 8, message: 'Bahut zyada login try. 15 minute baad try karo.' });
const IST = "'+330 minutes'";

module.exports = api => {
  // ---------- Auth ----------
  // 2-step: ADMIN_EMAIL set ho (aur email chal raha ho) to password ke baad OTP
  const twoStep = () => !!config.ADMIN_EMAIL && config.mailReady() && getSettings().mail_admin_otp === '1';
  const mask = e => e.replace(/^(.{2}).*(@.*)$/, '$1•••$2');
  api.post('/api/admin/login', loginLimit, async ({ req, body, ctx }) => {
    jsonOnly(req);
    const a = plain(db.prepare('SELECT * FROM admins WHERE username = ?').get(str(body.username, 60)));
    if (!a || !verifyPassword(str(body.password, 200), a.password_hash)) fail(401, 'Username ya password galat hai.');
    if (twoStep()) {
      const code = otp.issue(config.ADMIN_EMAIL, `admin:${a.id}`);
      const s = getSettings();
      const { html, text } = layout({ storeName: s.store_name, title: `Admin login OTP: ${code}`, intro: 'Admin panel login ke liye ye code daalo. 10 minute tak chalega. Agar ye aap nahi the, to turant admin password badlo.' });
      try { if (!(await sendMail({ to: config.ADMIN_EMAIL, subject: `${code} — admin login`, html, text, storeName: s.store_name, kind: 'admin_otp' }))) throw new Error('mail blocked'); }
      catch (e) { console.error('[admin otp]', e.message); db.prepare('DELETE FROM otps WHERE email = ?').run(config.ADMIN_EMAIL); fail(502, 'OTP email nahi gaya. Email settings check karo.'); }
      return { otp_required: true, sent_to: mask(config.ADMIN_EMAIL) };
    }
    startAdminSession(ctx, a.id);
    return { username: a.username };
  });
  api.post('/api/admin/login/otp', loginLimit, ({ req, body, ctx }) => {
    jsonOnly(req);
    if (!twoStep()) fail(400, 'OTP login on nahi hai.');
    const a = plain(db.prepare('SELECT * FROM admins WHERE username = ?').get(str(body.username, 60)));
    if (!a) fail(401, 'Dobara login karo.');
    otp.verify(config.ADMIN_EMAIL, `admin:${a.id}`, body.code);
    startAdminSession(ctx, a.id);
    return { username: a.username };
  });
  api.post('/api/admin/logout-all', requireAdmin, ({ req }) => { db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token != ?').run(req.admin.id, req.admin.token); return { ok: true }; });
  api.post('/api/admin/logout', requireAdmin, ({ req, ctx }) => { endAdminSession(ctx, req.admin.token); return { ok: true }; });
  api.get('/api/admin/me', requireAdmin, ({ req }) => ({ username: req.admin.username }));
  api.post('/api/admin/password', requireAdmin, ({ req, body }) => {
    const a = plain(db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id));
    if (!verifyPassword(str(body.current, 200), a.password_hash)) fail(400, 'Purana password galat hai.');
    const next = str(body.next, 200);
    if (next.length < 8) fail(400, 'Naya password kam se kam 8 characters ka ho.');
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(next), a.id);
    db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token != ?').run(a.id, req.admin.token);
    return { ok: true };
  });

  // ---------- Dashboard ----------
  api.get('/api/admin/stats', requireAdmin, () => {
    const one = sql => db.prepare(sql).get().v;
    const days = db.prepare(`SELECT date(paid_at, ${IST}) d, COALESCE(SUM(total),0) v, COUNT(*) n FROM orders
      WHERE status IN ('paid','delivered') AND paid_at >= datetime('now','-15 days') GROUP BY d`).all();
    const map = Object.fromEntries(days.map(r => [r.d, r]));
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() + 330 * 60e3 - i * 86400e3).toISOString().slice(0, 10);
      series.push({ d, v: map[d]?.v || 0, n: map[d]?.n || 0 });
    }
    const lowStock = db.prepare(`SELECT p.name, pl.label, (SELECT COUNT(*) FROM stock s WHERE s.plan_id = pl.id AND s.order_item_id IS NULL) n
      FROM plans pl JOIN products p ON p.id = pl.product_id WHERE pl.delivery = 'auto' AND p.active = 1 AND n < 5 ORDER BY n`).all().map(plain);
    return {
      today_revenue: one(`SELECT COALESCE(SUM(total),0) v FROM orders WHERE status IN ('paid','delivered') AND date(paid_at,${IST}) = date('now',${IST})`),
      month_revenue: one(`SELECT COALESCE(SUM(total),0) v FROM orders WHERE status IN ('paid','delivered') AND strftime('%Y-%m',paid_at,${IST}) = strftime('%Y-%m','now',${IST})`),
      to_verify: one("SELECT COUNT(*) v FROM orders WHERE status = 'verifying'"),
      to_deliver: one("SELECT COUNT(*) v FROM orders WHERE status = 'paid'"),
      awaiting: one("SELECT COUNT(*) v FROM orders WHERE status = 'awaiting_payment'"),
      delivered_total: one("SELECT COUNT(*) v FROM orders WHERE status = 'delivered'"),
      customers: one('SELECT COUNT(*) v FROM customers'),
      series, low_stock: lowStock,
      top: db.prepare(`SELECT product_name, SUM(qty) n, SUM(price*qty) v FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status IN ('paid','delivered') GROUP BY product_name ORDER BY v DESC LIMIT 5`).all().map(plain),
      integrations: { crypto: pay.ready(), crypto_configured: pay.configured(), crypto_networks: pay.cachedMethods().map(m => m.label), email: config.mailReady(), email_via: config.resendReady() ? 'Resend' : config.smtpReady() ? 'SMTP' : '', admin_2fa: twoStep(), telegram: require('../lib/bots').byRole('alerts').length > 0, public_url: !!config.PUBLIC_URL },
    };
  });

  // ---------- Orders ----------
  function orderQuery(query, limit = 300) {
    const status = orders.STATUSES.includes(query.get('status')) ? query.get('status') : null;
    const q = str(query.get('q') || '', 60);
    const where = [], args = [];
    if (status) { where.push('status = ?'); args.push(status); }
    if (q) { where.push('(code LIKE ? OR email LIKE ? OR phone LIKE ? OR name LIKE ? OR utr LIKE ? OR gw_ref LIKE ?)'); args.push(...Array(6).fill(`%${q}%`)); }
    return db.prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit}`).all(...args).map(plain);
  }
  api.get('/api/admin/orders', requireAdmin, ({ query }) => orderQuery(query).map(o => orders.orderView(o, { admin: true })));
  api.patch('/api/admin/orders/:id', requireAdmin, ({ params, body }) => orders.orderView(orders.adminUpdate(int(params.id), body), { admin: true }));

  api.get('/api/admin/orders.csv', requireAdmin, ({ query, ctx }) => {
    const rows = orderQuery(query, 100000);
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Order', 'Date (UTC)', 'Name', 'Email', 'Phone', 'Items', 'Subtotal', 'Discount', 'Coupon', 'Total', 'Status', 'Method', 'UTR', 'Crypto ref'];
    const lines = rows.map(o => [o.code, o.created_at, o.name, o.email, o.phone,
      orders.getItems(o.id).map(i => `${i.product_name} (${i.plan_label}) x${i.qty}`).join('; '),
      o.subtotal || o.total, o.discount, o.coupon_code, o.total, o.status, o.pay_method, o.utr, o.gw_ref].map(cell).join(','));
    ctx.raw = { type: 'text/csv; charset=utf-8', name: `orders-${new Date().toISOString().slice(0, 10)}.csv`, data: '﻿' + [head.map(cell).join(','), ...lines].join('\r\n') };
  });

  // ---------- Products ----------
  api.get('/api/admin/products', requireAdmin, () => listProducts({ includeInactive: true }).map(p => ({ ...p, image_url: p.image ? `/uploads/${p.image}` : '' })));

  function saveProduct(body, id) {
    const p = {
      name: str(body.name, 80), category: str(body.category, 40), description: str(body.description, 300), details: str(body.details, 4000),
      color: /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#5A2DF4', tag: str(body.tag, 20),
      active: body.active === false ? 0 : 1, sort: int(body.sort) || 0,
    };
    if (!p.name || !p.category) fail(400, 'Naam aur category zaroori hai.');
    const plans = (Array.isArray(body.plans) ? body.plans : []).slice(0, 12).map((pl, i) => ({
      id: int(pl.id) || null, label: str(pl.label, 40), price: int(pl.price), mrp: int(pl.mrp) || int(pl.price),
      days: Math.max(0, int(pl.days) || 0), delivery: ['auto', 'api'].includes(pl.delivery) ? pl.delivery : 'manual', sort: i,
      api_action_id: pl.delivery === 'api' ? (int(pl.api_action_id) || null) : null, api_ref: str(pl.api_ref, 120),
      price_usdt: pl.price_usdt === '' || pl.price_usdt === undefined || pl.price_usdt === null ? 0 : Math.round(Number(pl.price_usdt) * 100) / 100,
    })).filter(pl => pl.label);
    if (!plans.length) fail(400, 'Kam se kam ek plan daalo (naam + price).');
    for (const pl of plans) if (pl.delivery === 'api' && !(pl.api_action_id && db.prepare("SELECT 1 FROM api_actions WHERE id = ? AND purpose = 'fulfil'").get(pl.api_action_id))) fail(400, `Plan "${pl.label}": API delivery ke liye supplier action chuno (Integrations → API action, purpose "Order delivery").`);
    if (plans.some(pl => !(pl.price > 0 && pl.price <= 1e6) || pl.mrp < pl.price)) fail(400, 'Price 0 se zyada ho, aur MRP price se kam na ho.');
    if (plans.some(pl => !(pl.price_usdt === 0 || (pl.price_usdt >= 0.1 && pl.price_usdt <= 100000)))) fail(400, 'USDT price 0.1 se 100000 ke beech, ya khaali chhodo.');

    let newImage = null;
    if (body.image_data) newImage = saveImage(body.image_data);
    const old = id ? plain(db.prepare('SELECT * FROM products WHERE id = ?').get(id)) : null;
    if (id && !old) fail(404, 'Product nahi mila.');
    const image = newImage || (body.remove_image ? '' : old?.image || '');

    const savedId = db.transaction(() => {
      let pid = id;
      if (pid) {
        db.prepare('UPDATE products SET name=?, category=?, description=?, details=?, image=?, color=?, tag=?, active=?, sort=? WHERE id=?')
          .run(p.name, p.category, p.description, p.details, image, p.color, p.tag, p.active, p.sort, pid);
      } else {
        pid = Number(db.prepare('INSERT INTO products (name, category, description, details, image, color, tag, active, sort) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(p.name, p.category, p.description, p.details, image, p.color, p.tag, p.active, p.sort).lastInsertRowid);
      }
      // Plans: purane update (stock bacha rahe), naye insert, hataye gaye delete
      const existing = db.prepare('SELECT id FROM plans WHERE product_id = ?').all(pid).map(r => r.id);
      const keep = new Set();
      for (const pl of plans) {
        if (pl.id && existing.includes(pl.id)) {
          db.prepare('UPDATE plans SET label=?, price=?, mrp=?, days=?, delivery=?, sort=?, price_usdt=?, api_action_id=?, api_ref=? WHERE id=?').run(pl.label, pl.price, pl.mrp, pl.days, pl.delivery, pl.sort, pl.price_usdt, pl.api_action_id, pl.api_ref, pl.id);
          keep.add(pl.id);
        } else {
          db.prepare('INSERT INTO plans (product_id, label, price, mrp, days, delivery, sort, price_usdt, api_action_id, api_ref) VALUES (?,?,?,?,?,?,?,?,?,?)').run(pid, pl.label, pl.price, pl.mrp, pl.days, pl.delivery, pl.sort, pl.price_usdt, pl.api_action_id, pl.api_ref);
        }
      }
      for (const eid of existing) if (!keep.has(eid)) db.prepare('DELETE FROM plans WHERE id = ?').run(eid);
      return pid;
    })();
    if (old && old.image && old.image !== image) deleteImage(old.image);
    return savedId;
  }
  // Sab plans: price = MRP − X%, aakhri digit 9
  api.post('/api/admin/products/bulk-price', requireAdmin, ({ body }) => {
    const pct = Number(body.percent);
    if (!(pct >= 1 && pct <= 90)) fail(400, 'Discount 1% se 90% ke beech daalo.');
    const r = db.prepare(`UPDATE plans SET price = MAX(9, CAST(mrp * (100 - ?) / 1000 AS INTEGER) * 10 + 9) WHERE mrp > 0`).run(pct);
    db.prepare('UPDATE plans SET price = mrp WHERE price > mrp').run();
    return { updated: Number(r.changes) };
  });
  api.post('/api/admin/products', requireAdmin, ({ body, ctx }) => { ctx.status = 201; return { id: saveProduct(body) }; });
  api.put('/api/admin/products/:id', requireAdmin, ({ params, body }) => ({ id: saveProduct(body, int(params.id)) }));
  api.delete('/api/admin/products/:id', requireAdmin, ({ params }) => {
    const p = plain(db.prepare('SELECT image FROM products WHERE id = ?').get(int(params.id)));
    db.prepare('DELETE FROM products WHERE id = ?').run(int(params.id));
    if (p?.image) deleteImage(p.image);
    return { ok: true };
  });

  // ---------- Stock (auto-delivery ke keys / links / codes) ----------
  api.get('/api/admin/plans/:id/stock', requireAdmin, ({ params }) => {
    const rows = db.prepare(`SELECT s.id, s.content, s.created_at, s.used_at, o.code AS order_code FROM stock s
      LEFT JOIN order_items oi ON oi.id = s.order_item_id LEFT JOIN orders o ON o.id = oi.order_id
      WHERE s.plan_id = ? ORDER BY (s.order_item_id IS NOT NULL), s.id DESC LIMIT 500`).all(int(params.id)).map(plain);
    return { free: rows.filter(r => !r.order_code), used: rows.filter(r => r.order_code) };
  });
  api.post('/api/admin/plans/:id/stock', requireAdmin, ({ params, body }) => {
    const planId = int(params.id);
    if (!db.prepare('SELECT id FROM plans WHERE id = ?').get(planId)) fail(404, 'Plan nahi mila. Pehle product save karo.');
    const sep = body.separator === 'blank' ? /\n\s*\n/ : /\r?\n/;
    let items = String(body.text || '').split(sep).map(s => s.trim()).filter(Boolean).slice(0, 2000);
    // "email | password" (ya tab / comma) → do labelled lines, customer ko alag copy buttons milte hain
    if (body.separator === 'pair') {
      items = items.map(line => {
        const m = line.match(/^(\S+?)\s*(?:\||\t|,|:)\s*(.+?)(?:\s*(?:\||\t)\s*(.+))?$/);
        if (!m) fail(400, `Is line mein email aur password nahi mile: "${line.slice(0, 40)}". Format: email | password`);
        return `Email: ${m[1]}\nPassword: ${m[2]}${m[3] ? `\nNote: ${m[3]}` : ''}`;
      });
    }
    if (!items.length) fail(400, 'Kuch keys / links paste karo — har line ek item.');
    const ins = db.prepare('INSERT INTO stock (plan_id, content) VALUES (?, ?)');
    db.transaction(() => { for (const c of items) ins.run(planId, c.slice(0, 2000)); })();
    return { added: items.length };
  });
  api.delete('/api/admin/stock/:id', requireAdmin, ({ params }) => {
    const r = db.prepare('DELETE FROM stock WHERE id = ? AND order_item_id IS NULL').run(int(params.id));
    if (!r.changes) fail(400, 'Ye item kisi order mein use ho chuka hai, delete nahi ho sakta.');
    return { ok: true };
  });

  // ---------- Customers ----------
  api.get('/api/admin/customers', requireAdmin, ({ query }) => {
    const q = str(query.get('q') || '', 60);
    return db.prepare(`SELECT c.id, c.name, c.email, c.phone, c.created_at, c.last_login,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders,
      (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.customer_id = c.id AND o.status IN ('paid','delivered')) AS spent
      FROM customers c ${q ? 'WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?' : ''} ORDER BY c.id DESC LIMIT 500`)
      .all(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [])).map(plain);
  });

  // ---------- Coupons ----------
  api.get('/api/admin/coupons', requireAdmin, () => db.prepare('SELECT * FROM coupons ORDER BY id DESC').all().map(r => ({ ...r, active: !!r.active })));
  function saveCoupon(body, id) {
    const c = {
      code: str(body.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, ''), kind: body.kind === 'flat' ? 'flat' : 'percent',
      value: int(body.value), min_total: Math.max(0, int(body.min_total) || 0), max_discount: Math.max(0, int(body.max_discount) || 0),
      max_uses: Math.max(0, int(body.max_uses) || 0), active: body.active === false ? 0 : 1,
      expires_at: /^\d{4}-\d{2}-\d{2}$/.test(str(body.expires_at)) ? `${body.expires_at} 18:29:59` : null,   // IST raat 11:59
    };
    if (c.code.length < 3) fail(400, 'Coupon code kam se kam 3 letters ka ho (A-Z, 0-9).');
    if (!(c.value > 0) || (c.kind === 'percent' && c.value > 90)) fail(400, c.kind === 'percent' ? 'Discount 1% se 90% ke beech rakho.' : 'Discount amount 0 se zyada ho.');
    try {
      if (id) db.prepare('UPDATE coupons SET code=?, kind=?, value=?, min_total=?, max_discount=?, max_uses=?, active=?, expires_at=? WHERE id=?').run(c.code, c.kind, c.value, c.min_total, c.max_discount, c.max_uses, c.active, c.expires_at, id);
      else id = Number(db.prepare('INSERT INTO coupons (code, kind, value, min_total, max_discount, max_uses, active, expires_at) VALUES (?,?,?,?,?,?,?,?)').run(c.code, c.kind, c.value, c.min_total, c.max_discount, c.max_uses, c.active, c.expires_at).lastInsertRowid);
    } catch (e) { if (String(e.message).includes('UNIQUE')) fail(409, 'Ye coupon code pehle se hai.'); throw e; }
    return { id };
  }
  api.post('/api/admin/coupons', requireAdmin, ({ body, ctx }) => { ctx.status = 201; return saveCoupon(body); });
  api.put('/api/admin/coupons/:id', requireAdmin, ({ params, body }) => saveCoupon(body, int(params.id)));
  api.delete('/api/admin/coupons/:id', requireAdmin, ({ params }) => { db.prepare('DELETE FROM coupons WHERE id = ?').run(int(params.id)); return { ok: true }; });

  // ---------- Settings ----------
  const KEYS = ['store_name', 'tagline', 'announcement', 'upi_id', 'upi_name', 'upi_label', 'whatsapp', 'support_email', 'upi_qr', 'pay_upi', 'pay_crypto', 'otp_login', 'usdt_inr_rate', 'bharatpe_auto', 'currencies_on', 'default_lang',
    'newsletter_on', 'newsletter_pct', 'newsletter_max_off', 'newsletter_delay', 'newsletter_days', 'mail_year_cap', 'mail_reserve',
    'mail_otp', 'mail_admin_otp', 'mail_order_placed', 'mail_order_paid', 'mail_order_delivered', 'mail_welcome', 'mail_campaign', 'mail_referral',
    'ref_on', 'ref_friend_pct', 'ref_reward_pct', 'ref_reward_max', 'ref_days'];
  const BOOL = new Set(['pay_upi', 'pay_crypto', 'otp_login', 'bharatpe_auto', 'newsletter_on', 'mail_otp', 'mail_admin_otp', 'mail_order_placed', 'mail_order_paid', 'mail_order_delivered', 'mail_welcome', 'mail_campaign', 'mail_referral', 'ref_on']);
  const NUMS = { newsletter_pct: [1, 90], newsletter_max_off: [0, 100000], newsletter_delay: [3, 600], newsletter_days: [1, 365], mail_year_cap: [100, 10000000], mail_reserve: [0, 1000000], ref_friend_pct: [1, 90], ref_reward_pct: [1, 90], ref_reward_max: [0, 100000], ref_days: [1, 365] };
  const view = () => ({ ...getSettings(), bharatpe_session: undefined, crypto_ready: pay.ready(), crypto_configured: pay.configured(), pay_url: config.PAY_URL, pay_webhook: !!config.PAY_WEBHOOK_SECRET, mail_ready: config.mailReady(), data_dir: config.DATA_DIR });
  api.get('/api/admin/settings', requireAdmin, view);
  api.put('/api/admin/settings', requireAdmin, ({ body }) => {
    if (body.upi_id !== undefined && body.upi_id !== '' && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(str(body.upi_id))) fail(400, 'UPI ID sahi format mein nahi hai (jaise name@okaxis).');
    if (body.whatsapp !== undefined && !/^\d{10,13}$/.test(str(body.whatsapp))) fail(400, 'WhatsApp number country code ke saath sirf digits mein likho (jaise 919876543210).');
    if (body.support_email !== undefined && body.support_email !== '' && !isEmail(str(body.support_email))) fail(400, 'Support email sahi nahi hai.');
    if (body.upi_qr !== undefined && body.upi_qr !== '' && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.upi_qr)) fail(400, 'QR image PNG, JPG ya WEBP honi chahiye.');
    for (const [k, [lo, hi]] of Object.entries(NUMS)) if (body[k] !== undefined && !(Number(body[k]) >= lo && Number(body[k]) <= hi)) fail(400, `${k} ${lo} se ${hi} ke beech hona chahiye.`);
    if (body.currencies_on !== undefined) body.currencies_on = String(body.currencies_on).split(',').map(x => x.trim().toUpperCase()).filter(c => require('../lib/fx').CURRENCIES[c]).join(',');
    if (body.default_lang !== undefined && !['en', 'hi', 'hinglish'].includes(body.default_lang)) fail(400, 'Language en, hi ya hinglish.');
    if (body.usdt_inr_rate !== undefined && !(Number(body.usdt_inr_rate) >= 10 && Number(body.usdt_inr_rate) <= 1000)) fail(400, 'USDT rate ₹10 se ₹1000 ke beech daalo (jaise 90).');
    const next = { ...getSettings() };
    for (const k of KEYS) if (body[k] !== undefined) next[k] = k === 'upi_qr' ? String(body[k]).slice(0, 900000) : BOOL.has(k) ? (body[k] === true || body[k] === '1' ? '1' : '0') : str(body[k], 300);
    if (next.pay_upi !== '1' && !(next.pay_crypto === '1' && pay.configured())) fail(400, 'Kam se kam ek payment method chalu rakho.');
    const upd = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    db.transaction(() => { for (const k of KEYS) if (body[k] !== undefined) upd.run(k, next[k]); })();
    return view();
  });

  // ---------- Currency ----------
  api.get('/api/admin/fx', requireAdmin, () => ({ ...require('../lib/fx').publicInfo(), all: Object.keys(require('../lib/fx').CURRENCIES) }));
  api.post('/api/admin/fx/refresh', requireAdmin, async () => { const r = await require('../lib/fx').refresh(); if (!r) fail(502, 'Rates abhi update nahi hue (internet / API). Purane rates chal rahe hain.'); return require('../lib/fx').publicInfo(); });

  // ---------- Emails (budget + ON/OFF) ----------
  api.get('/api/admin/mail', requireAdmin, () => {
    const m = require('../lib/mailer'), s = getSettings();
    return { usage: m.usage(), kinds: Object.entries(m.KINDS).filter(([k]) => k !== 'test').map(([k, v]) => ({ kind: k, key: v.key, label: v.label, group: v.group, on: s[v.key] === '1', sent: m.usage().byKind[k] || 0 })), ready: config.mailReady(), via: config.resendReady() ? 'Resend' : config.smtpReady() ? 'SMTP' : '' };
  });

  // ---------- Newsletter ----------
  // ================= Integrations (APIs, webhooks, bots, store API) =================
  const connector = require('../lib/connector'), importer = require('../lib/importer'), outhooks = require('../lib/outhooks'), bots = require('../lib/bots'), apikeys = require('../lib/apikeys');
  api.get('/api/admin/integrations', requireAdmin, () => ({
    connections: db.prepare('SELECT * FROM integrations ORDER BY id').all().map(plain).map(connector.integrationView),
    actions: db.prepare('SELECT a.*, i.name AS integration_name FROM api_actions a JOIN integrations i ON i.id = a.integration_id ORDER BY a.id').all().map(plain).map(connector.actionView),
    webhooks: outhooks.list(), events: outhooks.EVENTS.filter(e => e !== 'test'),
    bots: bots.list(), roles: bots.ROLES,
    keys: apikeys.list(), scopes: apikeys.SCOPES, base_url: require('../lib/orders').baseUrl(),
    import_defaults: importer.DEFAULTS,
  }));
  // Connections
  api.post('/api/admin/integrations/connections', requireAdmin, ({ body, ctx }) => { ctx.status = 201; return connector.saveIntegration(body); });
  api.put('/api/admin/integrations/connections/:id', requireAdmin, ({ params, body }) => connector.saveIntegration(body, int(params.id)));
  api.delete('/api/admin/integrations/connections/:id', requireAdmin, ({ params }) => {
    const id = int(params.id);
    if (db.prepare('SELECT 1 FROM plans WHERE api_action_id IN (SELECT id FROM api_actions WHERE integration_id = ?)').get(id)) fail(400, 'Is connection ke action kuch plans mein lage hain. Pehle un plans ki delivery badlo.');
    db.prepare('DELETE FROM integrations WHERE id = ?').run(id); return { ok: true };
  });
  api.post('/api/admin/integrations/connections/:id/test', requireAdmin, async ({ params, body }) => {
    const r = await connector.request(connector.getIntegration(int(params.id)), { method: str(body.method, 10) || 'GET', path: str(body.path, 500), ctx: connector.sampleCtx(), kind: 'test' });
    return { ok: r.ok, status: r.status, ms: r.ms, url: r.url, error: r.error, body: (r.text || '').slice(0, 6000) };
  });
  // Actions
  api.post('/api/admin/integrations/actions', requireAdmin, ({ body, ctx }) => { ctx.status = 201; return connector.saveAction(body); });
  api.put('/api/admin/integrations/actions/:id', requireAdmin, ({ params, body }) => connector.saveAction(body, int(params.id)));
  api.delete('/api/admin/integrations/actions/:id', requireAdmin, ({ params }) => {
    const id = int(params.id);
    const used = db.prepare("SELECT COUNT(*) n FROM plans WHERE api_action_id = ? AND delivery = 'api'").get(id).n;
    if (used) fail(400, `Ye action ${used} plan(s) ki delivery mein laga hai. Pehle unki delivery badlo.`);
    db.prepare('DELETE FROM api_actions WHERE id = ?').run(id); return { ok: true };
  });
  // Test: fulfil/custom = sample order se call (asli call jaati hai!), import = preview
  api.post('/api/admin/integrations/actions/:id/test', requireAdmin, async ({ params, body }) => {
    const a = connector.getAction(int(params.id)); if (!a) fail(404, 'Action nahi mila.');
    if (a.purpose === 'import') return { import: await importer.run(a.id, { preview: true }) };
    const ctx = connector.sampleCtx({ item: { ...connector.sampleCtx().item, api_ref: str(body.api_ref, 120) || 'SKU-TEST', qty: int(body.qty) || 1 } });
    const r = await connector.runAction(a, ctx, { kind: 'test', ref: 'TEST' });
    return { ok: r.ok, status: r.status, ms: r.ms, url: r.url, error: r.error, result: r.result, ref: r.ref, body: (r.text || '').slice(0, 6000) };
  });
  api.post('/api/admin/integrations/actions/:id/import', requireAdmin, async ({ params, body }) => importer.run(int(params.id), { preview: !!body.preview }));
  api.get('/api/admin/integrations/logs', requireAdmin, ({ query }) => {
    const where = [], args = [];
    if (query.get('integration_id')) { where.push('integration_id = ?'); args.push(int(query.get('integration_id'))); }
    if (query.get('failed') === '1') where.push('ok = 0');
    return db.prepare(`SELECT * FROM api_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 100`).all(...args).map(plain);
  });
  // Webhooks
  api.post('/api/admin/integrations/webhooks', requireAdmin, ({ body, ctx }) => { ctx.status = 201; return outhooks.save(body); });
  api.put('/api/admin/integrations/webhooks/:id', requireAdmin, ({ params, body }) => outhooks.save(body, int(params.id)));
  api.delete('/api/admin/integrations/webhooks/:id', requireAdmin, ({ params }) => { db.prepare('DELETE FROM webhooks WHERE id = ?').run(int(params.id)); return { ok: true }; });
  api.post('/api/admin/integrations/webhooks/:id/test', requireAdmin, async ({ params }) => outhooks.test(int(params.id)));
  api.get('/api/admin/integrations/webhooks/:id/deliveries', requireAdmin, ({ params }) => outhooks.deliveries(int(params.id)));
  api.post('/api/admin/integrations/deliveries/:id/retry', requireAdmin, ({ params }) => { outhooks.retry(int(params.id)); return { ok: true }; });
  // Telegram bots
  api.post('/api/admin/integrations/bots', requireAdmin, ({ body, ctx }) => { ctx.status = 201; return bots.save(body); });
  api.put('/api/admin/integrations/bots/:id', requireAdmin, ({ params, body }) => bots.save(body, int(params.id)));
  api.delete('/api/admin/integrations/bots/:id', requireAdmin, ({ params }) => { bots.remove(int(params.id)); return { ok: true }; });
  api.post('/api/admin/integrations/bots/:id/test', requireAdmin, async ({ params }) => bots.test(/^env-/.test(params.id) ? params.id : int(params.id)));
  // Store API keys
  api.post('/api/admin/integrations/keys', requireAdmin, ({ body, ctx }) => { ctx.status = 201; return apikeys.create(body); });
  api.delete('/api/admin/integrations/keys/:id', requireAdmin, ({ params }) => { apikeys.revoke(int(params.id)); return { ok: true }; });

  // ================= Products: CSV + duplicate =================
  const csvio = require('../lib/csvio');
  api.get('/api/admin/products/csv', requireAdmin, ({ ctx, query }) => {
    const tpl = query.get('template') === '1';
    ctx.raw = { type: 'text/csv; charset=utf-8', name: tpl ? 'products-template.csv' : `products-${new Date().toISOString().slice(0, 10)}.csv`, data: Buffer.from(tpl ? csvio.template() : csvio.exportCsv(require('../lib/orders').baseUrl())) };
  });
  api.post('/api/admin/products/csv', requireAdmin, async ({ body }) => {
    const text = String(body.csv || '');
    if (!text.trim()) fail(400, 'CSV file khaali hai.');
    if (body.preview) { const a = csvio.analyse(text); return { summary: a.summary, errors: a.errors.slice(0, 50), lines: a.lines.slice(0, 200) }; }
    return csvio.apply(text);
  });
  api.post('/api/admin/products/:id/duplicate', requireAdmin, ({ params }) => {
    const p = plain(db.prepare('SELECT * FROM products WHERE id = ?').get(int(params.id))); if (!p) fail(404, 'Product nahi mila.');
    const id = db.transaction(() => {
      const nid = Number(db.prepare('INSERT INTO products (name, category, description, details, image, color, tag, active, sort, source) VALUES (?,?,?,?,?,?,?,0,?,?)')
        .run(`${p.name} (copy)`.slice(0, 80), p.category, p.description, p.details, '', p.color, p.tag, p.sort, '').lastInsertRowid);
      for (const pl of db.prepare('SELECT * FROM plans WHERE product_id = ? ORDER BY sort, id').all(p.id).map(plain))
        db.prepare('INSERT INTO plans (product_id, label, price, mrp, days, delivery, sort, price_usdt, api_action_id, api_ref) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(nid, pl.label, pl.price, pl.mrp, pl.days, pl.delivery, pl.sort, pl.price_usdt, pl.api_action_id, pl.api_ref);
      return nid;
    })();
    return { id };
  });
  // Supplier se dobara mangwao (order)
  api.post('/api/admin/orders/:id/fulfil', requireAdmin, async ({ params }) => {
    const r = await require('../lib/fulfil').run(int(params.id), { manual: true });
    return { ...r, order: orders.orderView(orders.getOrder(int(params.id)), { admin: true }) };
  });
  api.get('/api/admin/chats', requireAdmin, () => ({ status: require('../lib/support').status(), chats: require('../lib/support').adminList() }));
  api.get('/api/admin/referrals', requireAdmin, () => require('../lib/referral').adminList());
  const nl = require('../lib/newsletter');
  api.get('/api/admin/newsletter', requireAdmin, ({ query }) => ({ ...nl.stats(), subscribers: nl.list(query.get('q') || ''), campaigns: nl.campaigns() }));
  api.get('/api/admin/newsletter/export', requireAdmin, ({ ctx }) => { ctx.raw = { type: 'text/csv; charset=utf-8', name: `subscribers-${new Date().toISOString().slice(0, 10)}.csv`, data: Buffer.from(nl.csv()) }; });
  api.post('/api/admin/newsletter/campaign', requireAdmin, async ({ body }) => nl.campaign(body));
  api.post('/api/admin/newsletter/:id/unsubscribe', requireAdmin, ({ params }) => { db.prepare("UPDATE subscribers SET status='unsubscribed', unsub_at=datetime('now') WHERE id = ?").run(int(params.id)); return { ok: true }; });

  // ---------- BharatPe UPI auto-verify (unofficial) ----------
  const bharatpe = require('../lib/bharatpe');
  const bpLimit = rateLimit({ windowMs: 15 * 60e3, limit: 10, message: 'Bahut zyada OTP try. 15 minute baad.' });
  api.get('/api/admin/bharatpe', requireAdmin, () => bharatpe.status());
  api.post('/api/admin/bharatpe/otp', requireAdmin, bpLimit, async ({ body }) => bharatpe.requestOtp(str(body.mobile, 15).replace(/\D/g, '').slice(-10)));
  api.post('/api/admin/bharatpe/verify', requireAdmin, bpLimit, async ({ body }) => bharatpe.verifyOtp(str(body.uuid, 80), str(body.otp, 8)));
  api.post('/api/admin/bharatpe/test', requireAdmin, async () => {
    try { const r = await bharatpe.test(); return { ok: true, message: `✓ BharatPe se juda • pichhle 2 din ke ${r.count} payments`, ...bharatpe.status() }; }
    catch (e) { fail(502, e.message); }
  });
  api.post('/api/admin/bharatpe/logout', requireAdmin, () => { bharatpe.logout(); return bharatpe.status(); });
  api.post('/api/admin/bharatpe/recheck', requireAdmin, async () => { await require('../lib/upiverify').tick(); return { ok: true }; });

  // ---------- Crypto: Get It Sasta Pay connection ----------
  api.post('/api/admin/pay/test', requireAdmin, async () => {
    if (!pay.configured()) fail(400, 'PAY_URL aur PAY_API_KEY environment variables daalo, phir redeploy.');
    const list = await pay.test();
    return { ok: true, methods: list, webhook: !!config.PAY_WEBHOOK_SECRET };
  });
  // Order ko Pay app se dobara check karo (webhook miss ho gaya ho to)
  api.post('/api/admin/orders/:code/pay-check', requireAdmin, async ({ params }) => {
    const o = plain(db.prepare('SELECT * FROM orders WHERE code = ?').get(str(params.code, 20).toUpperCase()));
    if (!o) fail(404, 'Order nahi mila.');
    if (!o.gw_invoice) fail(400, 'Is order ka crypto invoice nahi bana.');
    const upd = await pay.refresh(o);
    return { status: upd.status };
  });

  api.post('/api/admin/test-email', requireAdmin, async ({ body }) => {
    if (!config.mailReady()) fail(400, 'Email set nahi hai. RESEND_API_KEY + MAIL_FROM (ya SMTP) environment variables daalo.');
    const to = str(body.to, 120) || getSettings().support_email;
    if (!isEmail(to)) fail(400, 'Sahi email daalo.');
    const s = getSettings();
    const { html, text } = layout({ storeName: s.store_name, title: 'Test email ✓', intro: 'Aapke store se emails sahi se ja rahe hain.' });
    try { await sendMail({ to, subject: 'Test email — ' + s.store_name, html, text, storeName: s.store_name, kind: 'test' }); }
    catch (e) { fail(502, 'Email nahi gaya: ' + e.message); }
    return { ok: true, to };
  });

  api.get('/api/admin/backup', requireAdmin, ({ ctx }) => {
    const file = makeBackup(db);
    ctx.raw = { type: 'application/vnd.sqlite3', name: file.split(/[\\/]/).pop(), data: fs.readFileSync(file) };
  });
};
