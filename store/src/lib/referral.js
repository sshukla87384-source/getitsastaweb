// Refer & earn: har customer ka apna REF-XXXXXX code / link.
// Dost us code se pehla order kare → dost ko X% off. Dost ka payment aate hi refer karne wale ko
// apna reward code (Y% off, sirf uski email par, ek baar). Ek dost sirf ek baar gina jaata hai.
const crypto = require('crypto');
const { db, plain, getSettings } = require('../db');
const { sendMail, layout } = require('./mailer');

const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rand = n => [...crypto.randomBytes(n)].map(b => A[b % A.length]).join('');
const sqlPlus = days => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
const on = (s = getSettings()) => s.ref_on === '1';
const isRef = code => /^REF-[A-Z0-9]{6}$/.test(String(code || '').toUpperCase());

function codeFor(customerId) {
  const c = db.prepare('SELECT ref_code FROM customers WHERE id = ?').get(customerId);
  if (!c) return '';
  if (c.ref_code) return c.ref_code;
  for (let i = 0; i < 5; i++) {
    const code = 'REF-' + rand(6);
    if (db.prepare('SELECT 1 FROM customers WHERE ref_code = ?').get(code) || db.prepare('SELECT 1 FROM coupons WHERE code = ?').get(code)) continue;
    db.prepare("UPDATE customers SET ref_code = ? WHERE id = ? AND ref_code = ''").run(code, customerId);
    return db.prepare('SELECT ref_code FROM customers WHERE id = ?').get(customerId).ref_code;
  }
  return '';
}

// Checkout ke liye: REF code ko coupon jaisa banao (coupons table mein nahi hota)
function asCoupon(code) {
  if (!isRef(code)) return null;
  const owner = plain(db.prepare('SELECT id, email, name FROM customers WHERE ref_code = ?').get(String(code).toUpperCase()));
  if (!owner) return null;
  const s = getSettings();
  return { code: String(code).toUpperCase(), kind: 'percent', value: Math.min(90, Math.max(1, Number(s.ref_friend_pct) || 10)), min_total: 0, max_discount: 0, max_uses: 0, used: 0,
    active: on(s) ? 1 : 0, expires_at: null, email: '', first_order: 1, note: 'referral', ref_owner_id: owner.id, ref_owner_email: owner.email.toLowerCase() };
}

// Dost ka payment aa gaya → refer karne wale ko reward
async function reward(order) {
  if (!isRef(order.coupon_code)) return null;
  const s = getSettings();
  const owner = plain(db.prepare('SELECT * FROM customers WHERE ref_code = ?').get(order.coupon_code));
  const friend = String(order.email).toLowerCase();
  if (!owner || owner.email.toLowerCase() === friend) return null;
  const pct = Math.min(90, Math.max(1, Number(s.ref_reward_pct) || 10)), days = Number(s.ref_days) || 60;
  let code = '';
  const made = db.transaction(() => {
    const r = db.prepare('INSERT OR IGNORE INTO referrals (referrer_id, referrer_email, friend_email, order_id, order_total) VALUES (?,?,?,?,?)').run(owner.id, owner.email.toLowerCase(), friend, order.id, order.total);
    if (!r.changes) return false;   // ye dost pehle hi gina ja chuka
    for (let i = 0; i < 5 && !code; i++) {
      const c = 'REWARD-' + rand(6);
      try {
        db.prepare(`INSERT INTO coupons (code, kind, value, min_total, max_discount, max_uses, active, expires_at, email, first_order, note)
          VALUES (?, 'percent', ?, 0, ?, 1, 1, ?, ?, 0, 'referral')`).run(c, pct, Number(s.ref_reward_max) || 0, sqlPlus(days), owner.email.toLowerCase());
        code = c;
      } catch (e) { if (!String(e.message).includes('UNIQUE')) throw e; }
    }
    db.prepare('UPDATE referrals SET reward_code = ? WHERE order_id = ?').run(code, order.id);
    return true;
  })();
  if (!made) return null;
  const { notifyTelegram, baseUrl } = require('./orders');
  notifyTelegram(`🎁 Referral: ${owner.email} ke dost (${friend}) ne ${order.code} kharida → reward ${code} (${pct}% off)`);
  const first = String(owner.name || '').split(' ')[0];
  const { html, text } = layout({
    storeName: s.store_name,
    title: `${first ? first + ', here is' : 'Here is'} your ${pct}% off reward 🎁`,
    intro: `A friend just ordered using your referral. Use ${code} on your next order for ${pct}% off${Number(s.ref_reward_max) ? ` (up to ₹${s.ref_reward_max})` : ''} — valid for ${days} days, only for your email. Invite more friends, earn more rewards!`,
    button: { label: 'Shop now', url: baseUrl() + '/#shop' },
  });
  sendMail({ to: owner.email, subject: `🎁 Your ${pct}% off reward — ${code}`, html, text, storeName: s.store_name, kind: 'referral' }).catch(e => console.error('[referral mail]', e.message));
  return code;
}

function forCustomer(customerId) {
  const s = getSettings();
  if (!on(s)) return { on: false };
  const code = codeFor(customerId);
  const { baseUrl } = require('./orders');
  const list = db.prepare(`SELECT r.friend_email, r.created_at, r.reward_code, c.used, c.expires_at FROM referrals r LEFT JOIN coupons c ON c.code = r.reward_code
    WHERE r.referrer_id = ? ORDER BY r.id DESC LIMIT 50`).all(customerId).map(plain)
    .map(r => ({ friend: r.friend_email.replace(/^(.{2}).*(@.*)$/, '$1•••$2'), at: r.created_at, code: r.reward_code, used: !!r.used, expired: !!r.expires_at && r.expires_at < new Date().toISOString().slice(0, 19).replace('T', ' ') }));
  return { on: true, code, link: `${baseUrl()}/?ref=${code}`, friend_pct: Number(s.ref_friend_pct) || 10, reward_pct: Number(s.ref_reward_pct) || 10, reward_max: Number(s.ref_reward_max) || 0, days: Number(s.ref_days) || 60, count: list.length, rewards: list };
}

function adminList() {
  const rows = db.prepare('SELECT r.*, c.used FROM referrals r LEFT JOIN coupons c ON c.code = r.reward_code ORDER BY r.id DESC LIMIT 300').all().map(plain);
  const top = db.prepare('SELECT referrer_email, COUNT(*) n, SUM(order_total) total FROM referrals GROUP BY referrer_email ORDER BY n DESC LIMIT 10').all().map(plain);
  return { total: rows.length, rewards_used: rows.filter(r => r.used).length, revenue: rows.reduce((a, r) => a + r.order_total, 0), rows, top };
}

module.exports = { isRef, asCoupon, reward, forCustomer, codeFor, adminList, on };
