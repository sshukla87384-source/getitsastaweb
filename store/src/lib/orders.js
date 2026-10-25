// Orders ka saara business logic: pricing, coupon, payment mark, auto-delivery, emails
const config = require('../config');
const { db, plain, getSettings } = require('../db');
const { str, int, fail, orderCode, inr, sqlNow, sqlPlusDays } = require('./util');
const { queueMail, layout } = require('./mailer');

const STATUSES = ['awaiting_payment', 'verifying', 'paid', 'delivered', 'cancelled'];
const STATUS_LABEL = { awaiting_payment: 'Payment baaki', verifying: 'Payment verify ho raha hai', paid: 'Payment mil gaya', delivered: 'Delivered', cancelled: 'Cancelled' };

const baseUrl = () => config.PUBLIC_URL || '';

async function notifyTelegram(text) {
  try { await require('./bots').notify(text); } catch (e) { console.error('[telegram]', e.message); }
}

// ---------- Coupon ----------
function findCoupon(code) {
  code = str(code, 30).toUpperCase();
  if (!code) return null;
  return plain(db.prepare('SELECT * FROM coupons WHERE code = ?').get(code)) || require('./referral').asCoupon(code);
}

function couponDiscount(c, subtotal) {
  if (!c || !c.active) fail(400, 'Ye coupon code valid nahi hai.');
  if (c.expires_at && c.expires_at < sqlNow()) fail(400, 'Ye coupon expire ho chuka hai.');
  if (c.max_uses && c.used >= c.max_uses) fail(400, 'Ye coupon ki limit poori ho chuki hai.');
  if (subtotal < c.min_total) fail(400, `Ye coupon ${inr(c.min_total)} ya usse zyada ke order par chalta hai.`);
  let d = c.kind === 'flat' ? c.value : Math.floor(subtotal * c.value / 100);
  if (c.kind === 'percent' && c.max_discount) d = Math.min(d, c.max_discount);
  return Math.max(0, Math.min(d, subtotal - 1));
}

// ---------- Cart pricing (hamesha database se) ----------
const getPlanRow = db.prepare(`SELECT pl.*, p.name AS product_name, p.id AS pid,
  (SELECT COUNT(*) FROM stock s WHERE s.plan_id = pl.id AND s.order_item_id IS NULL) AS stock_left
  FROM plans pl JOIN products p ON p.id = pl.product_id WHERE pl.id = ? AND p.active = 1`);

function priceCart(items, couponCode) {
  if (!Array.isArray(items) || !items.length) fail(400, 'Cart khaali hai.');
  const lines = [];
  for (const it of items.slice(0, 30)) {
    const plan = plain(getPlanRow.get(int(it.planId)));
    const qty = int(it.qty);
    if (!plan || !(qty >= 1 && qty <= 10)) fail(409, 'Cart ka koi product ab available nahi hai. Page refresh karke dobara add karo.');
    const same = lines.find(l => l.id === plan.id);
    if (same) same.qty = Math.min(10, same.qty + qty); else lines.push({ ...plan, qty });
  }
  for (const l of lines) {
    if (l.delivery === 'api' && l.api_stock !== null && l.api_stock !== undefined && l.api_stock < l.qty) fail(409, l.api_stock > 0 ? `${l.product_name} (${l.label}) ke sirf ${l.api_stock} piece bache hain.` : `${l.product_name} (${l.label}) abhi out of stock hai.`);
    if (l.delivery === 'auto' && l.stock_left < l.qty) {
      fail(409, l.stock_left ? `${l.product_name} (${l.label}) ke sirf ${l.stock_left} piece bache hain.` : `${l.product_name} (${l.label}) abhi out of stock hai.`);
    }
  }
  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
  let coupon = null, discount = 0;
  if (str(couponCode)) { coupon = findCoupon(couponCode); discount = couponDiscount(coupon, subtotal); }
  return { lines, subtotal, discount, total: subtotal - discount, coupon };
}

// Ek plan ka USD (= USDT) price, cent tak: plan ka apna USDT price, warna ₹ / rate
const planUsd = (pl, rate = Number(getSettings().usdt_inr_rate) || 90) => Math.round((pl.price_usdt > 0 ? pl.price_usdt : pl.price / rate) * 100) / 100;
// Crypto / USD ka total: har plan ka USD price, coupon usi % se kam.
function usdtLines(priced) {
  const rate = Number(getSettings().usdt_inr_rate) || 90;
  const lines = priced.lines.map(l => Math.round(planUsd(l, rate) * 100) * 10000);
  const sub = lines.reduce((a, m, i) => a + m * priced.lines[i].qty, 0);
  // coupon ka hissa integer maths se (float rounding se ek cent upar na jaaye)
  const num = BigInt(sub) * BigInt(priced.total), den = BigInt(priced.subtotal || 1) * 10000n;
  const cents = Number((num + den - 1n) / den);
  return { lines, total: Math.max(100000, cents * 10000) };   // cent tak upar, kam se kam 0.10 USDT
}

// Newsletter coupon: sirf usi email par, aur sirf pehle order par
function checkCouponOwner(c, email) {
  if (!c) return;
  if (c.ref_owner_email && c.ref_owner_email === String(email || '').toLowerCase()) fail(400, 'Apna referral code khud par nahi chalta — ise dosto ko bhejo.');
  if (c.email && c.email !== String(email || '').toLowerCase()) fail(400, 'Ye coupon kisi aur email ke liye hai. Wahi email daalo jis par coupon aaya tha.');
  if (c.first_order && db.prepare("SELECT 1 FROM orders WHERE email = ? AND status IN ('paid','delivered') LIMIT 1").get(String(email || '').toLowerCase())) fail(400, 'Ye coupon sirf pehle order ke liye hai.');
}

function createOrder({ customerId, name, email, phone, items, coupon, currency = 'INR', lang = '' }) {
  const priced = priceCart(items, coupon);
  checkCouponOwner(priced.coupon, email);
  const usdt = usdtLines(priced);
  const code = orderCode();
  const id = db.transaction(() => {
    const oid = Number(db.prepare(`INSERT INTO orders (code, customer_id, name, email, phone, subtotal, discount, total, coupon_code, usdt_micro, currency, lang)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, customerId || null, name, email, phone, priced.subtotal, priced.discount, priced.total, priced.coupon?.code || '', usdt.total, currency, lang).lastInsertRowid);
    const ins = db.prepare(`INSERT INTO order_items (order_id, product_id, plan_id, product_name, plan_label, price, qty, days, delivery_mode, usdt_micro)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    priced.lines.forEach((l, i) => ins.run(oid, l.pid, l.id, l.product_name, l.label, l.price, l.qty, l.days, l.delivery, usdt.lines[i]));
    return oid;
  })();
  const order = getOrder(id);
  const s = getSettings();
  notifyTelegram(`🛒 Naya order ${code}\n${name} • ${phone}\n${priced.lines.map(l => `• ${l.product_name} (${l.label}) x${l.qty}`).join('\n')}\nTotal: ₹${priced.total}${currency !== 'INR' ? ` ($${(usdt.total / 1e6).toFixed(2)} • ${currency})` : ''}${priced.discount ? ` (coupon ${priced.coupon.code} −₹${priced.discount})` : ''}\n${baseUrl()}/admin/`);
  mailCustomer(order, s, 'placed');
  hook('order.created', order);
  return order;
}

const hook = (event, o) => { try { require('./outhooks').emit(event, require('./outhooks').orderPayload(o, getItems(o.id))); } catch (e) { console.error('[hook]', e.message); } };
const getOrder = id => plain(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
const getItems = orderId => db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId).map(plain);

// ---------- Payment mila ----------
function markPaid(orderId, { method, ref, utr } = {}) {
  const changed = db.transaction(() => {
    const o = getOrder(orderId);
    if (!o || !['awaiting_payment', 'verifying'].includes(o.status)) return false;
    db.prepare(`UPDATE orders SET status = 'paid', paid_at = datetime('now'), pay_method = COALESCE(NULLIF(?, ''), pay_method),
      gw_ref = COALESCE(?, gw_ref), utr = COALESCE(?, utr), updated_at = datetime('now') WHERE id = ?`)
      .run(method || '', ref || null, utr || null, o.id);
    if (o.coupon_code) db.prepare('UPDATE coupons SET used = used + 1 WHERE code = ?').run(o.coupon_code);
    autoDeliver(o.id);
    return true;
  })();
  if (!changed) return getOrder(orderId);
  const o = getOrder(orderId);
  const s = getSettings();
  notifyTelegram(`💰 Payment mila ${o.code} • ₹${o.total} (${o.pay_method || 'manual'})${o.status === 'delivered' ? '\n✅ Auto-delivered' : '\nAdmin panel se deliver karo.'}`);
  mailCustomer(o, s, o.status === 'delivered' ? 'delivered' : 'paid');
  if (o.coupon_code) require('./referral').reward(o).catch(e => console.error('[referral]', e.message));
  hook('order.paid', o);
  if (o.status === 'delivered') hook('order.delivered', o);
  else if (getItems(o.id).some(i => i.delivery_mode === 'api')) require('./fulfil').run(o.id).catch(e => console.error('[fulfil]', e.message));
  return o;
}

// Stock wale (auto) plans ke liye keys/links apne aap assign — transaction ke andar call hota hai
function autoDeliver(orderId) {
  const items = getItems(orderId);
  const take = db.prepare('SELECT id, content FROM stock WHERE plan_id = ? AND order_item_id IS NULL ORDER BY id LIMIT ?');
  const use = db.prepare("UPDATE stock SET order_item_id = ?, used_at = datetime('now') WHERE id = ?");
  const setContent = db.prepare('UPDATE order_items SET auto_content = ? WHERE id = ?');
  let allDone = items.length > 0;
  for (const it of items) {
    if (it.delivery_mode !== 'auto' || it.auto_content) { if (!it.auto_content) allDone = false; continue; }
    const rows = take.all(it.plan_id, it.qty);
    if (rows.length < it.qty) { allDone = false; continue; }
    for (const r of rows) use.run(it.id, r.id);
    setContent.run(rows.map(r => r.content).join('\n'), it.id);
  }
  if (allDone) setDelivered(orderId, '');
}

// Supplier API (ya stock) se sab items mil gaye → order delivered
function completeIfReady(orderId) {
  const o = getOrder(orderId);
  if (!o || o.status !== 'paid') return false;
  const items = getItems(orderId);
  if (!items.length || items.some(i => !i.auto_content)) return false;
  setDelivered(orderId, o.delivery || '');
  const upd = getOrder(orderId);
  notifyTelegram(`✅ Auto-delivered ${o.code} (supplier API)`);
  mailCustomer(upd, getSettings(), 'delivered');
  hook('order.delivered', upd);
  return true;
}

function setDelivered(orderId, delivery) {
  const now = sqlNow();
  db.prepare("UPDATE orders SET status = 'delivered', delivered_at = ?, delivery = ?, updated_at = datetime('now') WHERE id = ?").run(now, delivery, orderId);
  for (const it of getItems(orderId)) {
    if (it.days > 0) db.prepare('UPDATE order_items SET expires_at = ? WHERE id = ?').run(sqlPlusDays(now, it.days), it.id);
  }
}

// Admin: status / delivery badlo
function adminUpdate(orderId, { status, delivery, admin_note }) {
  const o = getOrder(orderId);
  if (!o) fail(404, 'Order nahi mila');
  status = status ?? o.status;
  if (!STATUSES.includes(status)) fail(400, 'Galat status');
  delivery = delivery !== undefined ? str(delivery, 4000) : o.delivery;
  const note = admin_note !== undefined ? str(admin_note, 1000) : o.admin_note;
  const hasAuto = getItems(o.id).some(i => i.auto_content);
  if (status === 'delivered' && !delivery && !hasAuto) fail(400, 'Delivered karne se pehle delivery details likho. Customer ko yahi dikhega.');

  db.prepare("UPDATE orders SET admin_note = ?, delivery = ?, updated_at = datetime('now') WHERE id = ?").run(note, delivery, o.id);
  if (status !== o.status) {
    if (status === 'paid' && ['awaiting_payment', 'verifying'].includes(o.status)) return markPaid(o.id, { method: o.pay_method || 'upi' });
    if (status === 'delivered') {
      db.transaction(() => {
        if (['awaiting_payment', 'verifying'].includes(o.status)) {
          db.prepare("UPDATE orders SET paid_at = COALESCE(paid_at, datetime('now')), pay_method = COALESCE(NULLIF(pay_method,''), 'upi') WHERE id = ?").run(o.id);
          if (o.coupon_code) db.prepare('UPDATE coupons SET used = used + 1 WHERE code = ?').run(o.coupon_code);
        }
        setDelivered(o.id, delivery);
      })();
      const upd = getOrder(o.id);
      mailCustomer(upd, getSettings(), 'delivered');
      hook('order.delivered', upd);
      return upd;
    }
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, o.id);
    if (status === 'cancelled') {
      // jo keys assign hui thi woh wapas stock mein
      db.prepare('UPDATE stock SET order_item_id = NULL, used_at = NULL WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)').run(o.id);
      db.prepare("UPDATE order_items SET auto_content = '' WHERE order_id = ? AND delivery_mode = 'auto'").run(o.id);
      hook('order.cancelled', getOrder(o.id));
    }
  } else if (status === 'delivered' && delivery !== o.delivery) {
    mailCustomer(getOrder(o.id), getSettings(), 'delivered');
  }
  return getOrder(o.id);
}

// ---------- Customer ko dikhane wala view ----------
function orderView(o, { admin = false, locked = false } = {}) {
  const showSecrets = admin || (!locked && (o.status === 'delivered' || o.status === 'paid'));
  const items = getItems(o.id).map(i => ({
    id: i.id, product_id: i.product_id, plan_id: i.plan_id, product_name: i.product_name, plan_label: i.plan_label,
    price: i.price, usd: i.usdt_micro ? i.usdt_micro / 1e6 : 0, qty: i.qty, days: i.days, delivery_mode: i.delivery_mode, expires_at: i.expires_at,
    auto_content: showSecrets ? i.auto_content : '',
    ...(admin ? { api_status: i.api_status, api_error: i.api_error, api_ref: i.api_ref, api_tries: i.api_tries } : { pending_supplier: i.delivery_mode === 'api' && !i.auto_content }),
  }));
  const v = {
    code: o.code, name: o.name, email: o.email, status: o.status, status_label: STATUS_LABEL[o.status],
    subtotal: o.subtotal || o.total, discount: o.discount, total: o.total, coupon_code: o.coupon_code,
    pay_method: o.pay_method, utr: o.utr, items, created_at: o.created_at, paid_at: o.paid_at, delivered_at: o.delivered_at,
    delivery: admin || (!locked && o.status === 'delivered') ? o.delivery : '',
    locked: !admin && locked && ['paid', 'delivered'].includes(o.status),
    crypto_amount: o.gw_amount || '',
    usdt_total: o.usdt_micro ? (o.usdt_micro / 1e6).toFixed(2) : '',
    currency: o.currency || 'INR',
  };
  if (admin) Object.assign(v, { id: o.id, phone: o.phone, admin_note: o.admin_note, customer_id: o.customer_id, gw_invoice: o.gw_invoice, gw_ref: o.gw_ref });
  return v;
}

// ---------- Emails ----------
function mailCustomer(o, s, kind) {
  const link = `${baseUrl()}/order/${o.code}`;
  const items = getItems(o.id);
  const usd = (o.currency || 'INR') !== 'INR';
  const money = (inrAmt, micro) => (usd ? '$' + (micro / 1e6).toFixed(2) : inr(inrAmt));
  const rows = [...items.map(i => [`${i.product_name} • ${i.plan_label}${i.qty > 1 ? ' × ' + i.qty : ''}`, money(i.price * i.qty, (i.usdt_micro || 0) * i.qty)])];
  if (o.discount) rows.push([`Coupon ${o.coupon_code}`, usd ? 'applied' : '−' + inr(o.discount)]);
  rows.push(['Total', money(o.total, o.usdt_micro)]);
  const first = o.name.split(' ')[0];
  const hing = o.lang === 'hinglish' || o.lang === 'hi';   // default English
  const t = (hing ? {
    placed: { subject: `Order ${o.code} ban gaya — payment karo`, title: `Shukriya ${first}! Order ban gaya.`, intro: `Order ${o.code} ka payment abhi baaki hai. Neeche button se order page kholo aur pay karo.`, button: { label: 'Payment karo', url: link } },
    paid: { subject: `Payment mil gaya — ${o.code}`, title: 'Payment mil gaya ✓', intro: `Order ${o.code} ka ${money(o.total, o.usdt_micro)} payment confirm ho gaya. Delivery jaldi hi order page par aa jayegi.`, button: { label: 'Order dekho', url: link } },
    delivered: { subject: `Delivered — ${o.code}`, title: 'Aapka order deliver ho gaya 🎉', intro: `Order ${o.code} ki delivery details (login email / password / keys) aapke order page par hain. Security ke liye ye details email mein nahi bheji jaati.`, button: { label: 'Delivery details dekho', url: link } },
  } : {
    placed: { subject: `Order ${o.code} placed — complete your payment`, title: `Thanks ${first}! Your order is placed.`, intro: `Payment for order ${o.code} is still pending. Open your order page with the button below to pay.`, button: { label: 'Pay now', url: link } },
    paid: { subject: `Payment received — ${o.code}`, title: 'Payment received ✓', intro: `We have confirmed your payment of ${money(o.total, o.usdt_micro)} for order ${o.code}. Your delivery will appear on the order page shortly.`, button: { label: 'View order', url: link } },
    delivered: { subject: `Delivered — ${o.code}`, title: 'Your order is delivered 🎉', intro: `The delivery details for order ${o.code} (login email / password / keys) are on your order page. For your security we never send them by email.`, button: { label: 'View delivery details', url: link } },
  })[kind];
  if (!t) return;
  const { html, text } = layout({ storeName: s.store_name, ...t, rows, footer: hing ? `Koi dikkat? WhatsApp +${s.whatsapp} ya ${s.support_email} par order ID ke saath likho.` : `Need help? Message us on WhatsApp +${s.whatsapp} or email ${s.support_email} with your order ID.` });
  queueMail({ to: o.email, subject: t.subject, html, text, storeName: s.store_name, kind: 'order_' + kind });
}

module.exports = { completeIfReady, mailCustomer, planUsd, checkCouponOwner, STATUSES, STATUS_LABEL, priceCart, createOrder, getOrder, getItems, markPaid, adminUpdate, orderView, findCoupon, couponDiscount, notifyTelegram, baseUrl };
