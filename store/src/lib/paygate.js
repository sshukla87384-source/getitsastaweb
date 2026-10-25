// Get It Sasta Pay se jodna (alag app, apne server / subdomain par).
// Store sirf invoice banata hai aur signed webhook / status se Paid karta hai. Koi wallet, seed ya bot token yahan nahi.
const crypto = require('crypto');
const config = require('../config');
const { db, plain, getSettings } = require('../db');
const { fail } = require('./util');
const orders = require('./orders');

const usdt = micro => { const v = (Number(micro) || 0) / 1e6; let s = v.toFixed(6).replace(/0+$/, ''); if (/\.\d?$/.test(s)) s = v.toFixed(2); return s; };
const toMicro = s => { const m = String(s ?? '').match(/^(\d+)(?:\.(\d{1,6}))?$/); return m ? Number(m[1]) * 1e6 + Number(((m[2] || '') + '000000').slice(0, 6)) : NaN; };

const configured = () => !!(config.PAY_URL && config.PAY_API_KEY);
const ready = () => configured() && getSettings().pay_crypto === '1';

async function call(path, { method = 'GET', body } = {}) {
  if (!configured()) fail(503, 'Crypto payment abhi set nahi hai.');
  let res;
  try {
    res = await fetch(config.PAY_URL + path, {
      method, signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${config.PAY_API_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { console.error('[pay]', path, e.message); fail(502, 'Payment server se connect nahi hua. 1 minute baad try karo.'); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('[pay]', path, res.status, d.error); fail(res.status >= 500 ? 502 : 400, d.error || 'Payment server ne mana kar diya.'); }
  return d;
}

// Methods list (Binance Pay, USDT BEP20…) — 5 minute cache
let mcache = { at: 0, list: [] };
async function methods() {
  if (!configured()) return [];
  if (Date.now() - mcache.at < 5 * 60e3) return mcache.list;
  try { const d = await call('/api/v1/methods'); mcache = { at: Date.now(), list: d.methods || [] }; }
  catch { mcache.at = Date.now() - 4 * 60e3; }   // 1 minute baad dobara
  return mcache.list;
}
const cachedMethods = () => mcache.list;

async function createInvoice(o, returnUrl) {
  if (!ready()) fail(400, 'Crypto payment abhi band hai.');
  if (o.status !== 'awaiting_payment') fail(409, 'Is order ka payment ho chuka hai.');
  if (!(o.usdt_micro > 0)) fail(400, 'Is order ka USDT price nahi bana. Support se baat karo.');
  const inv = await call('/api/v1/invoices', { method: 'POST', body: {
    order_id: o.code, amount: usdt(o.usdt_micro), description: getSettings().store_name,
    customer_email: o.email, return_url: returnUrl,
  } });
  if (inv.order_id !== o.code) fail(502, 'Payment server ka jawab match nahi hua.');
  db.prepare(`UPDATE orders SET gw_invoice = ?, gw_url = ?, crypto_amount_micro = ?, pay_method = 'crypto', gw_amount = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(inv.id, inv.pay_url, toMicro(inv.amount), `${inv.amount} USDT`, o.id);
  return inv;
}

// Pay app se aaya invoice (webhook ya status) → order Paid
function settle(o, inv) {
  if (!o || !inv) return o;
  if (inv.status !== 'paid') return o;
  if (inv.order_id !== o.code || (o.gw_invoice && inv.id !== o.gw_invoice)) { console.error('[pay] invoice order se match nahi', inv.id, o.code); return o; }
  if (!(toMicro(inv.base) >= o.usdt_micro)) { console.error('[pay] amount kam', inv.base, usdt(o.usdt_micro)); orders.notifyTelegram(`⚠️ ${o.code}: Pay invoice ${inv.base} USDT, order ${usdt(o.usdt_micro)} USDT — haath se check karo.`); return o; }
  if (!['awaiting_payment', 'verifying'].includes(o.status)) {
    if (o.status === 'cancelled') orders.notifyTelegram(`⚠️ ${o.code} cancelled hai, par crypto payment aa gaya (${inv.amount} USDT, ${inv.method}). Customer se baat karo / refund.`);
    return o;
  }
  if (!o.gw_invoice) db.prepare('UPDATE orders SET gw_invoice = ? WHERE id = ?').run(inv.id, o.id);
  const ref = inv.tx ? `${inv.method}:${inv.tx}` : inv.id;
  return orders.markPaid(o.id, { method: 'crypto', ref: ref.slice(0, 120) });
}

async function refresh(o) {
  if (!o.gw_invoice || o.status !== 'awaiting_payment') return o;
  const inv = await call(`/api/v1/invoices/${encodeURIComponent(o.gw_invoice)}`);
  return settle(o, inv);
}

// Signed webhook: X-GSP-Signature = HMAC-SHA256(secret, `${X-GSP-Timestamp}.${raw body}`)
function verifyWebhook(req, raw) {
  if (!config.PAY_WEBHOOK_SECRET) fail(503, 'PAY_WEBHOOK_SECRET set nahi hai');
  const ts = String(req.headers['x-gsp-timestamp'] || ''), sig = String(req.headers['x-gsp-signature'] || '');
  if (!/^\d{9,11}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) fail(401, 'Purana ya galat timestamp');
  const want = crypto.createHmac('sha256', config.PAY_WEBHOOK_SECRET).update(`${ts}.`).update(raw).digest();
  let got; try { got = Buffer.from(sig, 'hex'); } catch { got = Buffer.alloc(0); }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) fail(401, 'Signature galat');
}
function onWebhook(req, raw, body) {
  verifyWebhook(req, raw);
  if (body.event === 'ping') return { ok: true, pong: true };
  if (body.event !== 'invoice.paid') return { ok: true, ignored: body.event };
  const inv = body.data || {};
  const o = plain(db.prepare('SELECT * FROM orders WHERE code = ?').get(String(inv.order_id || '')));
  if (!o) fail(404, 'Order nahi mila');
  const upd = settle(o, inv);
  return { ok: true, status: upd.status };
}

async function test() {
  const d = await call('/api/v1/methods');
  mcache = { at: Date.now(), list: d.methods || [] };
  return d.methods || [];
}

module.exports = { configured, ready, methods, cachedMethods, createInvoice, refresh, settle, onWebhook, test, usdt };
