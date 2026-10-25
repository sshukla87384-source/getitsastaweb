// Binance Pay check — aapke apne (KYC wale) Binance account ki READ-ONLY API key se.
// Customer aapke Binance Pay ID par USDT bhejta hai aur "Order ID" daalta hai.
// Hum GET /sapi/v1/pay/transactions (Pay trade history) mein wahi Order ID dhoondte hain:
// amount positive (aapko mila), currency USDT, aur amount bilkul invoice wala unique amount.
const crypto = require('crypto');

let cache = { at: 0, key: '', list: [] };
const PAYMENT_TYPES = ['C2C', 'PAY'];   // Pay ID par bheja (C2C) ya merchant pay (PAY). Refund / Crypto Box nahi.

async function page(cfg, start, end) {
  const now = Date.now();
  const q = new URLSearchParams({ startTime: String(start), endTime: String(end), limit: '100', recvWindow: '10000', timestamp: String(now) }).toString();
  const sig = crypto.createHmac('sha256', cfg.api_secret).update(q).digest('hex');
  const res = await fetch(`${(cfg.url || 'https://api.binance.com').replace(/\/+$/, '')}/sapi/v1/pay/transactions?${q}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': cfg.api_key }, signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let d; try { d = JSON.parse(text); } catch { throw new Error(`Binance ka jawab samajh nahi aaya (HTTP ${res.status})`); }
  if (!res.ok || (d.code && d.code !== '000000' && d.code !== 0) || d.success === false) {
    throw new Error(`Binance API: ${d.msg || d.message || 'HTTP ' + res.status}${d.code ? ` (code ${d.code})` : ''}`);
  }
  return Array.isArray(d.data) ? d.data : [];
}

// Pichhle 3 din ki Pay history (100-100 karke, max 5 pages)
const MIN_GAP = 3000;   // Binance ko 3 sec mein ek se zyada baar nahi poochhte (API weight bachao)
let inflight = null;
async function history(cfg, { force = false, nocache = false } = {}) {
  if (!cfg.api_key || !cfg.api_secret) throw new Error('Binance API key / secret set nahi hai');
  const ck = `${cfg.url}|${cfg.api_key}|${cfg.api_secret}`;
  if (!nocache && cache.key === ck) {
    const age = Date.now() - cache.at;
    if (age < (force ? MIN_GAP : 15000)) {
      if (!force) return cache.list;
      await new Promise(r => setTimeout(r, MIN_GAP - age));   // thoda ruk ke taaza list
    }
  }
  if (inflight && inflight.ck === ck) return inflight.p;
  const p = load(cfg, ck);
  inflight = { ck, p };
  try { return await p; } finally { if (inflight && inflight.p === p) inflight = null; }
}
async function load(cfg, ck) {
  const start = Date.now() - 3 * 86400e3;
  let end = Date.now(), all = [];
  for (let i = 0; i < 5; i++) {
    const rows = await page(cfg, start, end);
    all = all.concat(rows);
    if (rows.length < 100) break;
    const oldest = Math.min(...rows.map(r => Number(r.transactionTime) || end));
    if (!(oldest > start)) break;
    end = oldest - 1;
  }
  cache = { at: Date.now(), key: ck, list: all };
  return all;
}

const amountMicro = s => { const m = String(s).match(/^(-?)(\d+)(?:\.(\d+))?$/); if (!m) return NaN; return (m[1] ? -1 : 1) * (Number(m[2]) * 1e6 + Number(((m[3] || '') + '000000').slice(0, 6))); };

async function find(cfg, orderId) {
  const id = String(orderId).trim();
  let list = await history(cfg);
  let t = list.find(x => String(x.transactionId) === id);
  if (!t) { list = await history(cfg, { force: true }); t = list.find(x => String(x.transactionId) === id); }
  if (!t) return { found: false };
  // USDT kitna aaya: currency USDT ho to amount, warna fundsDetail mein USDT
  let micro = 0;
  if (String(t.currency).toUpperCase() === 'USDT') micro = amountMicro(t.amount);
  else {
    const f = (t.fundsDetail || []).find(x => String(x.currency).toUpperCase() === 'USDT');
    micro = f ? amountMicro(f.amount) * (amountMicro(t.amount) < 0 ? -1 : 1) : 0;
  }
  return {
    found: true, incoming: micro > 0, badType: !PAYMENT_TYPES.includes(String(t.orderType || '').toUpperCase()), micro: Math.abs(micro) || 0, currency: t.currency, ts: Number(t.transactionTime) || 0,
    from: [t.payerInfo?.name, t.payerInfo?.binanceId].filter(Boolean).join(' · '), type: t.orderType || '',
  };
}

async function test(cfg) {
  const t0 = Date.now();
  const list = await history(cfg, { nocache: true });
  return { count: list.length, ms: Date.now() - t0 };
}

const validOrderId = s => /^[A-Za-z0-9_-]{6,64}$/.test(String(s || '').trim());

module.exports = { find, test, validOrderId };
