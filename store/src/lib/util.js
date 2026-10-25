const crypto = require('crypto');
const { HttpError } = require('../http');

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '');
const int = v => (v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
const fail = (status, msg) => { throw new HttpError(status, msg); };
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const normPhone = p => str(p, 20).replace(/[^\d+]/g, '');
const isPhone = p => /^\+?\d{10,13}$/.test(p);

function orderCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'GIS-';
  for (const b of crypto.randomBytes(7)) s += alphabet[b % alphabet.length];
  return s;
}

const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// SQLite datetime('now') format (UTC)
const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const sqlPlusDays = (from, days) => new Date(new Date(from.replace(' ', 'T') + 'Z').getTime() + days * 86400e3).toISOString().slice(0, 19).replace('T', ' ');

module.exports = { str, int, fail, token, sha256, isEmail, normPhone, isPhone, orderCode, inr, esc, sqlNow, sqlPlusDays };
