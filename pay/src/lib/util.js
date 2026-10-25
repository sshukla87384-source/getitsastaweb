const crypto = require('crypto');
const { HttpError } = require('../http');

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '');
const fail = (status, msg, extra) => { const e = new HttpError(status, msg); if (extra) e.extra = extra; throw e; };
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('hex');
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const isHttpUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } };

function invoiceId() {
  const a = 'abcdefghijkmnopqrstuvwxyz23456789';
  let s = 'inv_';
  for (const b of crypto.randomBytes(16)) s += a[b % a.length];
  return s;
}

// micro-USDT (6 decimals) → "4.4431" (kam se kam 2 decimal)
function usdt(micro) {
  const v = (Number(micro) || 0) / 1e6;
  let s = v.toFixed(6).replace(/0+$/, '');
  if (/\.\d?$/.test(s)) s = (Number(s) || 0).toFixed(2);
  return s;
}
// Customer ko dikhne wala amount: hamesha kam se kam 3 decimal (5.050, 5.013)
function usdt3(micro) {
  const v = (Number(micro) || 0) / 1e6;
  let s = v.toFixed(6).replace(/0+$/, '');
  const d = (s.split('.')[1] || '').length;
  return d < 3 ? v.toFixed(3) : s;
}
// "4.4431" → 4443100 (6 decimals se zyada nahi)
function toMicro(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(s)) return NaN;
  const [i, f = ''] = s.split('.');
  return Number(i) * 1e6 + Number((f + '000000').slice(0, 6));
}

module.exports = { str, fail, token, sha256, hmac, isEmail, isHttpUrl, invoiceId, usdt, usdt3, toMicro };
