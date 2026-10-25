// Sessions: admin aur customer dono ke liye (HttpOnly cookies, database mein tokens)
const config = require('../config');
const { db } = require('../db');
const { parseCookies } = require('../http');
const { fail, token } = require('./util');

const ADMIN_COOKIE = 'gis_admin', CUST_COOKIE = 'gis_cust';
const ADMIN_DAYS = 7, CUST_DAYS = 60;

const cookie = (name, value, maxAge, sameSite) =>
  `${name}=${value}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${maxAge}${config.IS_PROD ? '; Secure' : ''}`;

// Likhne wali requests sirf JSON se — cross-site form se CSRF possible nahi
function jsonOnly(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !(req.headers['content-type'] || '').includes('application/json')) fail(415, 'Invalid request');
}

// ---------- Admin ----------
function startAdminSession(ctx, adminId) {
  const t = token();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, admin_id, expires_at) VALUES (?,?,?)').run(t, adminId, Date.now() + ADMIN_DAYS * 86400e3);
  ctx.cookies.push(cookie(ADMIN_COOKIE, t, ADMIN_DAYS * 86400, 'Strict'));
}
function endAdminSession(ctx, t) {
  if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
  ctx.cookies.push(cookie(ADMIN_COOKIE, '', 0, 'Strict'));
}
function requireAdmin({ req }) {
  jsonOnly(req);
  const t = parseCookies(req)[ADMIN_COOKIE];
  if (!t) fail(401, 'Login karo');
  const row = db.prepare('SELECT s.admin_id, s.expires_at, a.username FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token = ?').get(t);
  if (!row || row.expires_at < Date.now()) fail(401, 'Session khatam. Dobara login karo.');
  req.admin = { id: row.admin_id, username: row.username, token: t };
}

// ---------- Customer ----------
function startCustomerSession(ctx, customerId, req) {
  const t = token();
  db.prepare('DELETE FROM customer_sessions WHERE expires_at < ?').run(Date.now());
  const ua = String(req?.headers?.['user-agent'] || '').slice(0, 200);
  db.prepare('INSERT INTO customer_sessions (token, customer_id, expires_at, created_at, user_agent) VALUES (?,?,?,?,?)').run(t, customerId, Date.now() + CUST_DAYS * 86400e3, Date.now(), ua);
  db.prepare("UPDATE customers SET last_login = datetime('now') WHERE id = ?").run(customerId);
  ctx.cookies.push(cookie(CUST_COOKIE, t, CUST_DAYS * 86400, 'Lax'));
}
function endCustomerSession(ctx, t) {
  if (t) db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(t);
  ctx.cookies.push(cookie(CUST_COOKIE, '', 0, 'Lax'));
}
// Login ho to req.customer set, warna null (error nahi)
function loadCustomer(req) {
  if (req.customer !== undefined) return req.customer;
  const t = parseCookies(req)[CUST_COOKIE];
  req.customer = null;
  if (!t) return null;
  const row = db.prepare(`SELECT c.id, c.name, c.email, c.phone, c.created_at, c.email_verified, c.password_hash, s.expires_at FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id WHERE s.token = ?`).get(t);
  if (row && row.expires_at > Date.now()) req.customer = { id: row.id, name: row.name, email: row.email, phone: row.phone, created_at: row.created_at, email_verified: !!row.email_verified, has_password: !!row.password_hash, token: t };
  return req.customer;
}
function requireCustomer({ req }) {
  jsonOnly(req);
  if (!loadCustomer(req)) fail(401, 'Pehle login karo.');
}

module.exports = { jsonOnly, startAdminSession, endAdminSession, requireAdmin, startCustomerSession, endCustomerSession, loadCustomer, requireCustomer, CUST_COOKIE, ADMIN_COOKIE };
