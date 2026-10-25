const config = require('../config');
const { db, plain, getSettings } = require('../db');
const { rateLimit } = require('../http');
const { hashPassword, verifyPassword } = require('../password');
const { str, fail, isEmail, normPhone, isPhone, sqlNow } = require('../lib/util');
const { startCustomerSession, endCustomerSession, requireCustomer, loadCustomer, jsonOnly } = require('../lib/auth');
const { sendMail, layout } = require('../lib/mailer');
const otp = require('../lib/otp');
const orders = require('../lib/orders');

const authLimit = rateLimit({ windowMs: 15 * 60e3, limit: 15, message: 'Bahut zyada try. 15 minute baad dobara karo.' });
const otpLimit = rateLimit({ windowMs: 60 * 60e3, limit: 10, message: 'Bahut zyada OTP maange. Ek ghante baad try karo.' });

const me = c => ({ name: c.name, email: c.email, phone: c.phone, created_at: c.created_at, email_verified: !!c.email_verified, has_password: !!c.password_hash || !!c.has_password });
const byEmail = e => plain(db.prepare('SELECT * FROM customers WHERE email = ?').get(e));
const byId = id => plain(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
const emailOf = body => str(body.email, 120).toLowerCase();

// Verified email → us email ke guest orders account mein jodo
function claimGuestOrders(customerId, email) {
  db.prepare('UPDATE orders SET customer_id = ? WHERE email = ? AND customer_id IS NULL').run(customerId, email);
}

async function sendOtpMail(email, code, what, purpose) {
  const s = getSettings();
  const { html, text } = layout({
    storeName: s.store_name, title: `Your code: ${code}`,
    intro: `Use this code for ${what.toLowerCase()}. It is valid for 10 minutes. Never share it — ${s.store_name} will never ask you for an OTP.`,
    footer: 'If you did not request this, you can safely ignore this email.',
  });
  try { if (!(await sendMail({ to: email, subject: `${code} is your ${s.store_name} code`, html, text, storeName: s.store_name, kind: 'otp' }))) throw new Error('OTP mail band / limit'); }
  catch (e) { console.error('[otp mail]', e.message); db.prepare('DELETE FROM otps WHERE email = ? AND purpose = ?').run(email, purpose); fail(502, 'OTP email nahi gaya. Thodi der baad try karo ya password se login karo.'); }
}

module.exports = api => {
  // ---------- Login options (frontend ko batao kya on hai) ----------
  api.get('/api/account/options', () => ({ otp: config.mailReady() && getSettings().otp_login === '1' && getSettings().mail_otp === '1' }));

  // ---------- Email OTP login / signup ----------
  api.post('/api/account/otp/send', otpLimit, async ({ req, body }) => {
    jsonOnly(req);
    if (!config.mailReady() || getSettings().otp_login !== '1' || getSettings().mail_otp !== '1') fail(400, 'OTP login abhi band hai. Password se login karo.');
    const email = emailOf(body);
    if (!isEmail(email)) fail(400, 'Sahi email daalo.');
    const code = otp.issue(email, 'login');
    await sendOtpMail(email, code, 'Login', 'login');
    return { ok: true, new_account: !byEmail(email) };
  });

  api.post('/api/account/otp/verify', authLimit, ({ req, body, ctx }) => {
    jsonOnly(req);
    const email = emailOf(body);
    if (!isEmail(email)) fail(400, 'Sahi email daalo.');
    otp.verify(email, 'login', body.code);
    let c = byEmail(email);
    let created = false;
    if (!c) {
      const name = str(body.name, 80) || email.split('@')[0];
      const phone = normPhone(body.phone);
      const id = Number(db.prepare("INSERT INTO customers (name, email, phone, password_hash, email_verified) VALUES (?,?,?,'',1)").run(name, email, isPhone(phone) ? phone : '').lastInsertRowid);
      c = byId(id); created = true;
    } else if (!c.email_verified) {
      db.prepare('UPDATE customers SET email_verified = 1 WHERE id = ?').run(c.id); c.email_verified = 1;
    }
    claimGuestOrders(c.id, email);
    startCustomerSession(ctx, c.id, req);
    return { ...me(c), created };
  });

  // ---------- Password register / login ----------
  api.post('/api/account/register', authLimit, ({ req, body, ctx }) => {
    jsonOnly(req);
    const name = str(body.name, 80), email = emailOf(body), phone = normPhone(body.phone), password = str(body.password, 200);
    if (name.length < 2) fail(400, 'Apna naam daalo.');
    if (!isEmail(email)) fail(400, 'Sahi email daalo.');
    if (phone && !isPhone(phone)) fail(400, 'Mobile number 10 digit ka hona chahiye.');
    if (password.length < 8) fail(400, 'Password kam se kam 8 characters ka rakho.');
    if (/^(.)\1+$/.test(password) || /^(12345678|password|qwerty)/i.test(password)) fail(400, 'Ye password bahut aasaan hai. Thoda strong rakho.');
    if (byEmail(email)) fail(409, 'Is email se account pehle se hai. Login karo ya OTP se andar aao.');
    const id = Number(db.prepare('INSERT INTO customers (name, email, phone, password_hash) VALUES (?,?,?,?)').run(name, email, phone, hashPassword(password)).lastInsertRowid);
    startCustomerSession(ctx, id, req);
    ctx.status = 201;
    return me(byId(id));
  });

  api.post('/api/account/login', authLimit, ({ req, body, ctx }) => {
    jsonOnly(req);
    const c = byEmail(emailOf(body));
    if (!c || !verifyPassword(str(body.password, 200), c.password_hash)) fail(401, c && !c.password_hash ? 'Is account mein password nahi hai. OTP se login karo.' : 'Email ya password galat hai.');
    startCustomerSession(ctx, c.id, req);
    return me(c);
  });

  api.post('/api/account/logout', ({ req, ctx }) => {
    jsonOnly(req);
    endCustomerSession(ctx, loadCustomer(req)?.token);
    return { ok: true };
  });

  api.get('/api/account/me', ({ req }) => {
    const c = loadCustomer(req);
    if (!c) fail(401, 'Login nahi hai');
    return me(c);
  });

  // ---------- Email verify (password se bane account ke liye) ----------
  api.post('/api/account/verify/send', otpLimit, async ({ req }) => {
    requireCustomer({ req });
    if (!config.mailReady()) fail(400, 'Email abhi set nahi hai. Support se contact karo.');
    if (req.customer.email_verified) return { ok: true, already: true };
    const code = otp.issue(req.customer.email, 'verify');
    await sendOtpMail(req.customer.email, code, 'Email verification', 'verify');
    return { ok: true };
  });
  api.post('/api/account/verify/confirm', requireCustomer, ({ req, body }) => {
    otp.verify(req.customer.email, 'verify', body.code);
    db.prepare('UPDATE customers SET email_verified = 1 WHERE id = ?').run(req.customer.id);
    claimGuestOrders(req.customer.id, req.customer.email);
    return { ok: true };
  });

  // ---------- Profile, password, sessions ----------
  api.put('/api/account/profile', requireCustomer, ({ req, body }) => {
    const name = str(body.name, 80), phone = normPhone(body.phone);
    if (name.length < 2) fail(400, 'Apna naam daalo.');
    if (phone && !isPhone(phone)) fail(400, 'Mobile number 10 digit ka hona chahiye.');
    db.prepare('UPDATE customers SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.customer.id);
    return me(byId(req.customer.id));
  });

  api.post('/api/account/password', requireCustomer, ({ req, body }) => {
    const c = byId(req.customer.id);
    if (c.password_hash && !verifyPassword(str(body.current, 200), c.password_hash)) fail(400, 'Purana password galat hai.');
    const next = str(body.next, 200);
    if (next.length < 8) fail(400, 'Naya password kam se kam 8 characters ka ho.');
    db.prepare('UPDATE customers SET password_hash = ? WHERE id = ?').run(hashPassword(next), c.id);
    db.prepare('DELETE FROM customer_sessions WHERE customer_id = ? AND token != ?').run(c.id, req.customer.token);
    return { ok: true };
  });

  api.get('/api/account/sessions', requireCustomer, ({ req }) =>
    db.prepare('SELECT token, created_at, user_agent, expires_at FROM customer_sessions WHERE customer_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20')
      .all(req.customer.id, Date.now()).map(s => ({ current: s.token === req.customer.token, created_at: s.created_at, device: s.user_agent })));

  api.post('/api/account/logout-all', requireCustomer, ({ req }) => {
    const r = db.prepare('DELETE FROM customer_sessions WHERE customer_id = ? AND token != ?').run(req.customer.id, req.customer.token);
    return { ok: true, removed: r.changes };
  });

  // ---------- Password bhool gaye: OTP se reset ----------
  api.post('/api/account/forgot', otpLimit, async ({ req, body }) => {
    jsonOnly(req);
    const s = getSettings();
    if (!config.mailReady()) return { ok: true, email: false, whatsapp: s.whatsapp, support_email: s.support_email };
    const email = emailOf(body);
    if (!isEmail(email)) fail(400, 'Sahi email daalo.');
    if (byEmail(email)) { const code = otp.issue(email, 'reset'); await sendOtpMail(email, code, 'Password reset', 'reset'); }
    return { ok: true, email: true };   // account ho ya na ho, same jawab (privacy)
  });

  api.post('/api/account/reset', authLimit, ({ req, body, ctx }) => {
    jsonOnly(req);
    const email = emailOf(body);
    const c = byEmail(email);
    if (!c) fail(400, 'OTP galat hai ya expire ho gaya.');
    otp.verify(email, 'reset', body.code);
    const pw = str(body.password, 200);
    if (pw.length < 8) fail(400, 'Password kam se kam 8 characters ka rakho.');
    db.transaction(() => {
      db.prepare('UPDATE customers SET password_hash = ?, email_verified = 1 WHERE id = ?').run(hashPassword(pw), c.id);
      db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(c.id);
      claimGuestOrders(c.id, email);
    })();
    startCustomerSession(ctx, c.id, req);
    return { ok: true };
  });

  // ---------- Dashboard ----------
  api.get('/api/account/dashboard', requireCustomer, ({ req }) => {
    const c = req.customer;
    const rows = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 200').all(c.id).map(plain);
    const list = rows.map(o => orders.orderView(o));
    const done = rows.filter(o => ['paid', 'delivered'].includes(o.status));
    const now = sqlNow();
    const subs = [];
    for (const o of list) {
      if (o.status !== 'delivered') continue;
      for (const i of o.items) {
        subs.push({
          order_code: o.code, product_id: i.product_id, plan_id: i.plan_id, product_name: i.product_name, plan_label: i.plan_label,
          delivered_at: o.delivered_at, expires_at: i.expires_at, days: i.days,
          state: !i.expires_at ? 'lifetime' : i.expires_at < now ? 'expired' : 'active',
        });
      }
    }
    const saved = done.reduce((a, o) => a + (o.discount || 0), 0) + db.prepare(`SELECT COALESCE(SUM((pl.mrp - oi.price) * oi.qty), 0) v
      FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN plans pl ON pl.id = oi.plan_id
      WHERE o.customer_id = ? AND o.status IN ('paid','delivered') AND pl.mrp > oi.price`).get(c.id).v;
    const s = getSettings();
    const referral = require('../lib/referral').forCustomer(c.id);
    return {
      referral,
      me: me(c),
      stats: {
        orders: rows.length, spent: done.reduce((a, o) => a + o.total, 0), saved,
        active: subs.filter(x => x.state === 'active').length,
        pending: rows.filter(o => ['awaiting_payment', 'verifying', 'paid'].includes(o.status)).length,
      },
      subscriptions: subs.sort((a, b) => (a.state === 'active' ? 0 : 1) - (b.state === 'active' ? 0 : 1) || String(a.expires_at || '9').localeCompare(String(b.expires_at || '9'))),
      orders: list,
      support: { whatsapp: s.whatsapp, email: s.support_email },
      can_verify: config.mailReady(),
    };
  });
};
