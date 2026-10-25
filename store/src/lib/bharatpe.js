// BharatPe UPI auto-verify (UNOFFICIAL).
// BharatPe ka koi public API nahi hai. Ye wahi private endpoints use karta hai jo BharatPe ka
// enterprise dashboard (enterprise.bharatpe.in) khud use karta hai: mobile + OTP se login,
// phir "payments received" list. Sirf apne KYC wale merchant account ke saath use karo.
// BharatPe kabhi bhi ye endpoints badal sakta hai — isliye sab hosts admin settings / env se badal sakte ho,
// aur session band ho to UPI wapas manual (UTR → admin verify) par chala jaata hai.
const { db, getSettings } = require('../db');
const { fail } = require('./util');

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const host = (k, d) => (process.env[k] || d).replace(/\/+$/, '');
const AUTH = () => host('BHARATPE_AUTH_HOST', 'https://enterprise.bharatpe.in');
const API = () => host('BHARATPE_API_HOST', 'https://payments-tesseract.bharatpe.in');
const MERCHANT_API = () => host('BHARATPE_MERCHANT_HOST', 'https://api-merchant.bharatpe.in');

const set = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
const get = k => getSettings()[k] || '';

// Session (token + cookie) settings mein — admin panel ke bahar kabhi nahi dikhta
function session() { try { return JSON.parse(get('bharatpe_session') || '{}'); } catch { return {}; } }
const connected = () => !!session().token;
const enabled = () => getSettings().bharatpe_auto === '1' && connected();

// ---------- simple cookie jar ----------
function mergeCookies(jar, res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of list) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
  return jar;
}
const cookieHeader = jar => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

// ---------- Login: mobile → OTP ----------
const pending = new Map();   // uuid → { jar, csrf, mobile, at }
async function requestOtp(mobile) {
  if (!/^\d{10}$/.test(mobile)) fail(400, 'BharatPe wala 10 digit mobile number daalo.');
  let res, html;
  const jar = {};
  try {
    res = await fetch(AUTH() + '/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    mergeCookies(jar, res); html = await res.text();
  } catch (e) { fail(502, 'BharatPe site se connect nahi hua: ' + e.message); }
  const m = html.match(/name="csrf-token" content="([^"]+)"/);
  if (!m) fail(502, 'BharatPe login page badal gaya lagta hai (csrf-token nahi mila). Manual UPI verify chalate raho.');
  const csrf = m[1];
  const r = await fetch(AUTH() + '/v1/api/user/requestotp', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body: new URLSearchParams({ mobile, _token: csrf }).toString(),
  }).catch(e => fail(502, 'BharatPe se OTP nahi maang paaye: ' + e.message));
  mergeCookies(jar, r);
  const d = await r.json().catch(() => ({}));
  if (!d.success || !d.data?.uuid) fail(400, 'BharatPe ne OTP nahi bheja: ' + (d.message || `HTTP ${r.status}`));
  pending.set(d.data.uuid, { jar, csrf, mobile, at: Date.now() });
  return { uuid: d.data.uuid };
}

async function verifyOtp(uuid, otp) {
  const p = pending.get(String(uuid));
  if (!p || Date.now() - p.at > 10 * 60e3) fail(400, 'OTP session khatam. Dobara "OTP bhejo" dabao.');
  if (!/^\d{4,6}$/.test(String(otp))) fail(400, 'OTP 4–6 digit ka hota hai.');
  const r = await fetch(AUTH() + '/v1/api/user/verifyotp', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(p.jar) },
    body: new URLSearchParams({ mobile: p.mobile, uuid: String(uuid), otp: String(otp), _token: p.csrf }).toString(),
  }).catch(e => fail(502, 'BharatPe se connect nahi hua: ' + e.message));
  mergeCookies(p.jar, r);
  const d = await r.json().catch(() => ({}));
  if (!d.success || !d.data?.accessToken) fail(400, 'OTP galat ya expire: ' + (d.message || `HTTP ${r.status}`));
  pending.delete(String(uuid));
  const s = { token: d.data.accessToken, cookie: cookieHeader(p.jar), mobile: p.mobile.replace(/^(\d{2})\d+(\d{2})$/, '$1••••••$2'), at: Date.now(), merchant_id: '' };
  try {
    const mr = await fetch(MERCHANT_API() + '/merchant/v3/getmerchantinfo', { headers: { token: s.token, 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    s.merchant_id = String((await mr.json()).data?.merchantId || '');
  } catch {}
  set('bharatpe_session', JSON.stringify(s));
  set('bharatpe_status', 'ok');
  cache.at = 0;
  return status();
}

function logout() { set('bharatpe_session', '{}'); set('bharatpe_status', ''); cache.at = 0; }

// ---------- Payments received ----------
let cache = { at: 0, list: [] };
class Expired extends Error {}
async function transactions({ force = false } = {}) {
  const s = session();
  if (!s.token) throw new Expired('BharatPe login nahi hai');
  if (!force && Date.now() - cache.at < 15000) return cache.list;
  const now = Date.now();
  const q = new URLSearchParams({ module: 'PAYMENT_QR', sDate: String(now - 2 * 86400e3), eDate: String(now + 86400e3), pageSize: '50', pageCount: '0', isFromOtDashboard: '1' });
  if (s.merchant_id) q.set('merchantId', s.merchant_id);
  let r;
  try { r = await fetch(`${API()}/api/v1/merchant/transactions?${q}`, { headers: { token: s.token, Cookie: s.cookie || '', 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new Error('BharatPe se connect nahi hua: ' + e.message); }
  const d = await r.json().catch(() => ({}));
  if ((d.status && d.message === 'SUCCESS') || d.success) {
    cache = { at: Date.now(), list: Array.isArray(d.data?.transactions) ? d.data.transactions : [] };
    if (get('bharatpe_status') !== 'ok') set('bharatpe_status', 'ok');
    return cache.list;
  }
  const msg = d.message || `HTTP ${r.status}`;
  if (['UNAUTHORIZED', 'UNAUTHENTICATED', 'TOKEN_EXPIRED', 'SESSION_EXPIRED'].includes(msg) || r.status === 401 || r.status === 403) {
    if (get('bharatpe_status') !== 'expired') { set('bharatpe_status', 'expired'); require('./orders').notifyTelegram('⚠️ BharatPe login expire ho gaya. Admin → Settings → BharatPe se dobara OTP login karo. Tab tak UPI manual verify par hai.'); }
    throw new Expired('BharatPe session expire');
  }
  throw new Error('BharatPe: ' + msg);
}

// UTR + amount match karo. Returns { ok, reason, tx }
//   reason: matched | not_found | not_received | amount_mismatch | too_old | expired | error
async function check(utr, amountInr, sinceMs) {
  let list;
  try { list = await transactions(); } catch (e) { return { ok: false, reason: e instanceof Expired ? 'expired' : 'error', error: e.message }; }
  let tx = list.find(t => String(t.bankReferenceNo || '').trim() === utr);
  if (!tx) {
    try { list = await transactions({ force: true }); } catch (e) { return { ok: false, reason: e instanceof Expired ? 'expired' : 'error', error: e.message }; }
    tx = list.find(t => String(t.bankReferenceNo || '').trim() === utr);
  }
  if (!tx) return { ok: false, reason: 'not_found' };
  if (tx.type !== 'PAYMENT_RECV' || tx.status !== 'SUCCESS') return { ok: false, reason: 'not_received', tx };
  const paise = Math.round(Number(tx.amount) * 100);
  if (paise !== Math.round(Number(amountInr) * 100)) return { ok: false, reason: 'amount_mismatch', tx };
  const ts = Number(tx.paymentTimestamp) || 0;
  if (ts && sinceMs && ts < sinceMs - 10 * 60e3) return { ok: false, reason: 'too_old', tx };
  return { ok: true, reason: 'matched', tx: { utr, amount: Number(tx.amount), payer: tx.payerName || '', vpa: tx.payerVpa || '', ts } };
}

function status() {
  const s = session();
  return { connected: !!s.token, enabled: enabled(), auto: getSettings().bharatpe_auto === '1', mobile: s.mobile || '', merchant_id: s.merchant_id ? '••' + s.merchant_id.slice(-4) : '', since: s.at || 0, state: get('bharatpe_status') || '' };
}
async function test() {
  const list = await transactions({ force: true });
  return { count: list.length };
}

module.exports = { requestOtp, verifyOtp, logout, check, status, test, enabled, connected, Expired };
