// Currency: 1 USD = kitne (EUR, GBP, AED…). Roz ek baar internet se taaza (open.er-api.com, free, bina key),
// na mile to purana / default. INR ka rate admin ka "1 USDT = ₹" hi hai (wahi crypto mein lagta hai).
const { db, getSettings } = require('../db');

const CURRENCIES = {
  INR: { symbol: '₹', name: 'Indian Rupee', fallback: 0, decimals: 0 },
  USD: { symbol: '$', name: 'US Dollar', fallback: 1, decimals: 2 },
  EUR: { symbol: '€', name: 'Euro', fallback: 0.92, decimals: 2 },
  GBP: { symbol: '£', name: 'British Pound', fallback: 0.79, decimals: 2 },
  AED: { symbol: 'AED', name: 'UAE Dirham', fallback: 3.6725, decimals: 2 },
  SAR: { symbol: 'SAR', name: 'Saudi Riyal', fallback: 3.75, decimals: 2 },
  CAD: { symbol: 'C$', name: 'Canadian Dollar', fallback: 1.37, decimals: 2 },
  AUD: { symbol: 'A$', name: 'Australian Dollar', fallback: 1.52, decimals: 2 },
  SGD: { symbol: 'S$', name: 'Singapore Dollar', fallback: 1.34, decimals: 2 },
  NPR: { symbol: 'Rs', name: 'Nepalese Rupee', fallback: 135, decimals: 0 },
  BDT: { symbol: '৳', name: 'Bangladeshi Taka', fallback: 120, decimals: 0 },
};
const set = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
const inrPerUsd = (s = getSettings()) => Number(s.usdt_inr_rate) || 90;

function enabled(s = getSettings()) {
  const list = String(s.currencies_on || 'INR,USD').split(',').map(x => x.trim().toUpperCase()).filter(c => CURRENCIES[c]);
  if (!list.includes('INR')) list.unshift('INR');
  if (!list.includes('USD')) list.push('USD');
  return list;
}
function rates(s = getSettings()) {
  let live = {}; try { live = JSON.parse(s.fx_rates || '{}'); } catch {}
  const out = {};
  for (const c of enabled(s)) out[c] = c === 'INR' ? inrPerUsd(s) : c === 'USD' ? 1 : Number(live[c]) || CURRENCIES[c].fallback;
  return out;
}
function publicInfo(s = getSettings()) {
  const r = rates(s);
  return { list: enabled(s).map(c => ({ code: c, symbol: CURRENCIES[c].symbol, name: CURRENCIES[c].name, decimals: CURRENCIES[c].decimals, rate: r[c] })), updated: Number(s.fx_at) || 0 };
}
const valid = c => enabled().includes(String(c || '').toUpperCase());

async function refresh() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(15000) });
    const d = await res.json();
    if (d.result !== 'success' || !d.rates) throw new Error(d['error-type'] || 'bad response');
    const keep = {};
    for (const c of Object.keys(CURRENCIES)) if (c !== 'INR' && c !== 'USD' && Number(d.rates[c]) > 0) keep[c] = Number(d.rates[c]);
    set('fx_rates', JSON.stringify(keep)); set('fx_at', Date.now());
    return keep;
  } catch (e) { console.error('[fx]', e.message); return null; }
}
function start() {
  const due = () => Date.now() - (Number(getSettings().fx_at) || 0) > 20 * 3600e3;
  setTimeout(() => { if (due()) refresh(); }, 5000).unref();
  setInterval(() => { if (due()) refresh(); }, 3 * 3600e3).unref();
}

module.exports = { CURRENCIES, enabled, rates, publicInfo, valid, refresh, start, inrPerUsd };
