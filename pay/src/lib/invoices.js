// Invoices: unique amount, method chunna, TxID / Binance Order ID se verify, Paid → webhook.
const config = require('../config');
const { db, plain, getSettings } = require('../db');
const { fail, invoiceId, usdt, usdt3, str, isHttpUrl } = require('./util');
const chain = require('./chain');
const binance = require('./binance');
const webhooks = require('./webhooks');

const { CHAINS } = chain;
const METHOD_KEYS = ['binance', 'trc20', 'bep20', 'polygon'];
const STEP = 1000;            // 0.001 USDT — "1.013" jaisa unique amount
const MAX_OFFSET = 199;       // +0.001 … +0.199
const EARLY_MS = 10 * 60e3;   // amount milne se 10 min pehle tak ka tx maan lo (ghadi ka farq)
const GRACE_MS = 15 * 60e3;   // time khatam hone ke 15 min baad tak amount kisi aur ko nahi milta
const lateMs = (s = getSettings()) => { const h = Number(s.late_hours); return (Number.isFinite(h) && s.late_hours !== '' ? h : 48) * 3600e3; };
// Jo invoice abhi apna amount "pakde" hue hai: confirming / review, ya pending jiska time (+15 min) bacha hai
const HOLDING = `(status IN ('confirming','review') OR (status = 'pending' AND expires_at + ${GRACE_MS} > ?))`;

const cfgOf = (key, s = getSettings()) => { try { return JSON.parse(s[`net_${key}`] || '{}'); } catch { return {}; } };
const log = (invId, kind, message) => db.prepare('INSERT INTO events (invoice_id, kind, message, created_at) VALUES (?,?,?,?)').run(invId, kind, String(message).slice(0, 500), Date.now());

function methodReady(key, c) {
  if (!c.on) return false;
  if (key === 'binance') return !!(c.pay_id && c.api_key && c.api_secret);
  return !!(c.address && c.url);
}
function methods(s = getSettings()) {
  return METHOD_KEYS.filter(k => methodReady(k, cfgOf(k, s))).map(k => {
    const c = cfgOf(k, s);
    if (k === 'binance') return { key: 'binance', label: 'Binance Pay', chain: 'Binance app (Pay)', pay_id: c.pay_id, name: c.name || '', refLabel: 'Binance Pay Order ID', refHint: 'Binance app → Pay → History → transaction → Order ID' };
    const n = CHAINS[k];
    return { key: k, label: n.label, chain: n.chain, address: c.address, fee: n.fee, refLabel: 'Transaction ID (TxID / hash)', refHint: n.txHint };
  });
}
const get = id => plain(db.prepare('SELECT * FROM invoices WHERE id = ?').get(String(id)));

function view(inv, { admin = false } = {}) {
  const s = getSettings();
  const now = Date.now();
  const expired = inv.status === 'pending' && now > inv.expires_at;
  const late = expired && now < inv.expires_at + lateMs(s);
  const allowed = inv.networks ? inv.networks.split(',') : METHOD_KEYS;
  const v = {
    id: inv.id, order_id: inv.order_id, status: expired ? 'expired' : inv.status, currency: 'USDT',
    amount: usdt3(inv.amount_micro), base: usdt(inv.base_micro), description: inv.description,
    method: inv.network || '', address: inv.address || '', expires_at: inv.expires_at, created_at: inv.created_at,
    paid_at: inv.paid_at || 0, tx: inv.tx || '', paid_amount: inv.paid_micro ? usdt(inv.paid_micro) : '',
    explorer: inv.tx && CHAINS[inv.network] ? CHAINS[inv.network].explorer + inv.tx : '',
    confirmations: inv.confirmations, needed: CHAINS[inv.network] ? Number(cfgOf(inv.network, s).confirmations) || 0 : 0,
    return_url: inv.return_url, can_submit: inv.status === 'pending' && (!expired || late),
    methods: methods(s).filter(m => allowed.includes(m.key)),
    brand: s.brand_name, support: s.support_contact,
  };
  if (admin) Object.assign(v, { client_id: inv.client_id, customer_email: inv.customer_email, manual: !!inv.manual, note: inv.note, review_reason: inv.review_reason, tx_from: inv.tx_from, tx_time: inv.tx_time, metadata: safeJson(inv.metadata), raw_status: inv.status });
  else if (inv.status === 'review') v.review_reason = 'Amount match nahi hua — team check kar rahi hai';
  return v;
}
const safeJson = s => { try { return JSON.parse(s); } catch { return {}; } };

// ---------- Unique amount ----------
const holders = (micro, exceptId) => db.prepare(`SELECT * FROM invoices WHERE amount_micro = ? AND id != ? AND ${HOLDING}`).all(micro, exceptId || '', Date.now()).map(plain);
function uniqueAmount(baseMicro, exceptId) {
  const taken = new Set(db.prepare(`SELECT amount_micro m FROM invoices WHERE id != ? AND ${HOLDING}`).all(exceptId || '', Date.now()).map(r => r.m));
  const start = Math.floor(Math.random() * MAX_OFFSET);
  for (let i = 0; i < MAX_OFFSET; i++) {
    const k = ((start + i) % MAX_OFFSET) + 1;
    const m = baseMicro + k * STEP;
    if (!taken.has(m)) return m;
  }
  fail(503, 'Is amount ke bahut saare payments khule hain. 10 minute baad try karo.');
}

// ---------- Create (store API se) ----------
function create(client, body) {
  const orderId = str(body.order_id, 64);
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(orderId)) fail(400, 'order_id chahiye (A-Z, 0-9, _ - . :, max 64)');
  const amt = Number(body.amount);
  if (!(amt >= 0.1 && amt <= 100000)) fail(400, 'amount 0.1 se 100000 USDT ke beech hona chahiye');
  if (!/^\d+(\.\d{1,3})?$/.test(String(body.amount).trim())) fail(400, 'amount zyada se zyada 3 decimal tak (jaise 5.00)');
  const baseMicro = Math.round(amt * 1000) * 1000;
  const returnUrl = str(body.return_url, 500);
  if (returnUrl && !isHttpUrl(returnUrl)) fail(400, 'return_url http(s) URL hona chahiye');
  let nets = Array.isArray(body.methods) ? body.methods.filter(k => METHOD_KEYS.includes(k)) : [];
  const meta = JSON.stringify(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}).slice(0, 4000);
  const s = getSettings();
  const minutes = Number(s.invoice_minutes) || 60;
  const now = Date.now();

  return db.transaction(() => {
    const ex = plain(db.prepare('SELECT * FROM invoices WHERE client_id = ? AND order_id = ?').get(client.id, orderId));
    if (ex) {
      if (['paid', 'confirming', 'review', 'cancelled'].includes(ex.status) || ex.tx) return ex;
      const expired = now > ex.expires_at;
      if (ex.base_micro === baseMicro && !expired && ex.status === 'pending') return ex;
      // Late window mein wahi amount rakho (customer ne shayad bhej diya ho), bas time badhao — agar amount kisi aur ke paas nahi gaya
      const keep = ex.base_micro === baseMicro && ex.status === 'pending' && now < ex.expires_at + lateMs(s) && !holders(ex.amount_micro, ex.id).length;
      const amount = keep ? ex.amount_micro : uniqueAmount(baseMicro, ex.id);
      db.prepare(`UPDATE invoices SET base_micro=?, amount_micro=?, amount_at=?, status='pending', expires_at=?, description=?, customer_email=?, return_url=?, networks=?, metadata=?, updated_at=? WHERE id=?`)
        .run(baseMicro, amount, keep ? ex.amount_at || ex.created_at : now, now + minutes * 60e3, str(body.description, 200), str(body.customer_email, 120), returnUrl, nets.join(','), meta, now, ex.id);
      log(ex.id, 'renew', keep ? `Wahi amount ${usdt(amount)} USDT, time badhaya` : `Naya amount ${usdt(amount)} USDT, naya time`);
      return get(ex.id);
    }
    const id = invoiceId();
    const amount = uniqueAmount(baseMicro);
    db.prepare(`INSERT INTO invoices (id, client_id, order_id, base_micro, amount_micro, amount_at, description, customer_email, return_url, networks, metadata, status, expires_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`).run(id, client.id, orderId, baseMicro, amount, now, str(body.description, 200), str(body.customer_email, 120), returnUrl, nets.join(','), meta, now + minutes * 60e3, now, now);
    log(id, 'created', `${client.name}: ${orderId} • ${usdt(amount)} USDT`);
    return get(id);
  })();
}

// ---------- Customer method chunta hai ----------
function choose(inv, key) {
  const v = view(inv);
  if (!v.can_submit) fail(409, inv.status === 'paid' ? 'Ye payment ho chuka hai.' : 'Is payment ka time khatam ho gaya.');
  const m = v.methods.find(x => x.key === key);
  if (!m) fail(400, 'Ye payment method abhi available nahi hai.');
  const target = key === 'binance' ? m.pay_id : m.address;
  db.prepare('UPDATE invoices SET network = ?, address = ?, updated_at = ? WHERE id = ?').run(key, target, Date.now(), inv.id);
  return get(inv.id);
}

// ---------- TxID / Order ID submit ----------
async function submit(inv, key, refRaw) {
  if (inv.status === 'paid') return inv;
  const v = view(inv);
  if (!v.can_submit) fail(409, inv.status === 'review' ? 'Aapka payment check ho raha hai.' : inv.status === 'confirming' ? 'Transaction confirm ho raha hai, thoda ruko.' : 'Is payment ka time khatam ho gaya. Store se naya order banao.');
  if (!v.methods.find(x => x.key === key)) fail(400, 'Ye payment method abhi available nahi hai.');
  if (inv.network !== key) inv = choose(inv, key);
  const s = getSettings(), c = cfgOf(key, s);
  let ref, r;
  if (key === 'binance') {
    ref = String(refRaw || '').trim();
    if (!binance.validOrderId(ref)) fail(400, 'Binance Pay ka Order ID daalo (Binance app → Pay → History → transaction kholo → Order ID copy).');
  } else {
    ref = chain.normTx(key, refRaw);
    if (!chain.txValid(key, ref)) fail(400, `Transaction ID sahi nahi lagta — ${CHAINS[key].txHint}.`);
  }
  const usedRow = () => plain(db.prepare('SELECT * FROM used_txs WHERE network = ? AND tx = ?').get(key, ref));
  const used = usedRow();
  const usedBy = used && used.invoice_id !== inv.id ? get(used.invoice_id) : null;
  // Doosre invoice ke paas hai — sirf tab chhinenge jab woh 'review' mein ho aur amount uska nahi (neeche, exact match par)
  if (usedBy && !(usedBy.status === 'review' && usedBy.paid_micro !== usedBy.amount_micro)) { log(inv.id, 'reuse', `${ref} pehle ${used.invoice_id} mein use hua`); fail(409, 'Ye ID pehle hi kisi aur payment mein use ho chuki hai.'); }

  try { r = key === 'binance' ? await binance.find(c, ref) : await chain.check(key, c, ref, inv.address); }
  catch (e) { console.error('[verify]', key, e.message); log(inv.id, 'error', `${key}: ${e.message}`); fail(502, 'Abhi check nahi ho paaya. 1 minute baad dobara try karo.'); }

  if (!r.found) fail(404, key === 'binance' ? 'Ye Order ID abhi nahi mila. Payment ke 1–2 minute baad dobara try karo, aur dekho ki sahi Pay ID par bheja tha.' : `Ye transaction ${CHAINS[key].chain} par nahi mila. Network sahi chuna hai? Abhi bheja hai to 1–2 minute ruko.`);
  if (r.failed) fail(400, 'Ye transaction fail hua tha. Wallet mein status dekho.');
  if (key === 'binance' && !r.incoming) fail(400, 'Is Order ID mein paisa humein nahi aaya (ye bhejne wala record hai).');
  if (key === 'binance' && r.badType) fail(400, 'Ye Binance Pay transfer nahi lagta (refund / gift box). Pay → Send se bhejo.');
  if (!r.micro) fail(400, key === 'binance' ? 'Is payment mein USDT nahi mila. USDT hi bhejo.' : `Is transaction mein hamare address par USDT (${CHAINS[key].label}) nahi aaya.`);
  const since = inv.amount_at || inv.created_at;
  if (!r.ts || r.ts < since - EARLY_MS) { log(inv.id, 'old', `${ref} amount milne se pehle ka (ya time nahi mila)`); fail(400, 'Ye payment is order se pehle ka hai. Is order ke liye naya payment karo.'); }

  const exact = r.micro === inv.amount_micro;
  // Ye payment kisi aur khule order ke amount se bilkul match karta hai? To woh uska hai — bind mat karo.
  const owner = holders(r.micro, inv.id).find(o => r.ts >= (o.amount_at || o.created_at) - EARLY_MS);
  if (owner && (!exact || owner.amount_micro === inv.amount_micro)) {
    log(inv.id, 'conflict', `${ref} ka amount ${usdt(r.micro)} invoice ${owner.id} (${owner.order_id}) se match karta hai`);
    fail(409, exact ? 'Is amount par ek aur payment khula hai. Support se contact karo, hum check karke order complete kar denge.' : `Ye payment ${usdt(r.micro)} USDT ka hai, jo kisi aur order ka amount hai. Aapka amount ${usdt(inv.amount_micro)} USDT hai.`);
  }
  if (usedBy && !exact) fail(409, 'Ye ID pehle hi kisi aur payment mein use ho chuki hai.');

  const need = key === 'binance' ? 0 : Number(c.confirmations) || 0;
  const status = !exact ? 'review' : (r.confirmations ?? need) < need ? 'confirming' : 'paid';
  const reason = exact ? '' : r.micro < inv.amount_micro ? `Kam aaya: ${usdt(r.micro)} / ${usdt(inv.amount_micro)} USDT` : `Amount alag: ${usdt(r.micro)} aaya, ${usdt(inv.amount_micro)} chahiye tha`;

  db.transaction(() => {
    const cur = get(inv.id);
    if (cur.status !== 'pending' || (cur.tx && cur.tx !== ref)) fail(409, 'Is payment ki status badal gayi hai. Page refresh karo.');
    const u = usedRow();
    if (u && u.invoice_id !== inv.id) {
      const holder = get(u.invoice_id);
      if (!(exact && holder && holder.status === 'review' && holder.paid_micro !== holder.amount_micro)) fail(409, 'Ye ID pehle hi kisi aur payment mein use ho chuki hai.');
      // Galat order par daali gayi ID asli order ko wapas
      db.prepare('DELETE FROM used_txs WHERE network = ? AND tx = ?').run(key, ref);
      db.prepare(`UPDATE invoices SET status='pending', tx='', tx_from='', paid_micro=0, tx_time=0, confirmations=0, review_reason='', updated_at=? WHERE id=?`).run(Date.now(), holder.id);
      log(holder.id, 'released', `${ref} asli order ${inv.order_id} (exact amount) ko diya gaya`);
    }
    db.prepare('INSERT OR IGNORE INTO used_txs (network, tx, invoice_id, created_at) VALUES (?,?,?,?)').run(key, ref, inv.id, Date.now());
    db.prepare(`UPDATE invoices SET tx=?, tx_from=?, paid_micro=?, tx_time=?, confirmations=?, status=?, review_reason=?, submitted_at=?, updated_at=? WHERE id=?`)
      .run(ref, r.from || '', r.micro, r.ts || 0, r.confirmations || 0, status === 'paid' ? 'confirming' : status, reason, Date.now(), Date.now(), inv.id);
  })();
  log(inv.id, 'submit', `${key} ${ref} • ${usdt(r.micro)} USDT • ${status}${reason ? ' • ' + reason : ''}`);
  if (status === 'paid') return markPaid(get(inv.id), { by: 'auto' });
  return get(inv.id);
}

function markPaid(inv, { by = 'auto', note = '' } = {}) {
  const ok = db.transaction(() => {
    const cur = get(inv.id);
    if (!cur || cur.status === 'paid' || cur.status === 'cancelled') return false;
    db.prepare(`UPDATE invoices SET status='paid', paid_at=?, manual=?, note=CASE WHEN ? != '' THEN ? ELSE note END, updated_at=? WHERE id=?`)
      .run(Date.now(), by === 'auto' ? 0 : 1, note, note, Date.now(), inv.id);
    return true;
  })();
  const fresh = get(inv.id);
  if (ok) { log(inv.id, 'paid', by === 'auto' ? 'Auto verify ✓' : `Admin ne Paid kiya${note ? ': ' + note : ''}`); webhooks.enqueue(fresh, 'invoice.paid', view(fresh)); }
  return fresh;
}

// ---------- Worker: confirm ho rahe transactions + expiry ----------
let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    db.prepare(`UPDATE invoices SET status='expired', updated_at=? WHERE status='pending' AND tx='' AND expires_at < ?`).run(Date.now(), Date.now() - lateMs() - GRACE_MS);
    const list = db.prepare("SELECT * FROM invoices WHERE status='confirming' ORDER BY updated_at LIMIT 20").all().map(plain);
    for (const inv of list) {
      const c = cfgOf(inv.network);
      try {
        const r = await chain.check(inv.network, c, inv.tx, inv.address);
        if (!r.found) { if (Date.now() - inv.updated_at > 3600e3) review(inv, 'Transaction chain se gaayab (1 ghante se)'); continue; }
        if (r.failed) { review(inv, 'Transaction fail ho gaya'); continue; }
        db.prepare('UPDATE invoices SET confirmations = ? WHERE id = ?').run(r.confirmations || 0, inv.id);
        if ((r.confirmations || 0) >= (Number(c.confirmations) || 0) && r.micro === inv.amount_micro) markPaid(get(inv.id));
        else if (Date.now() - (inv.submitted_at || inv.updated_at) > 6 * 3600e3) review(inv, 'Confirmations 6 ghante mein poori nahi hui');
      } catch (e) { console.error('[recheck]', inv.id, e.message); }
    }
  } finally { running = false; }
}
function review(inv, reason) {
  db.prepare("UPDATE invoices SET status='review', review_reason=?, updated_at=? WHERE id=?").run(reason, Date.now(), inv.id);
  log(inv.id, 'review', reason);
}
function start() { setInterval(() => tick().catch(e => console.error('[tick]', e.message)), config.RECHECK_MS).unref(); }

// ---------- Admin ----------
function adminAction(inv, action, note) {
  note = str(note, 200);
  if (action === 'approve' || action === 'paid') {
    if (inv.status === 'paid') fail(409, 'Pehle se Paid hai.');
    if (action === 'approve' && inv.status !== 'review') fail(409, 'Approve sirf "Check karo" wale payment par hota hai.');
    if (inv.status === 'cancelled') fail(409, 'Cancelled invoice Paid nahi ho sakta.');
    if (action === 'paid' && !note) fail(400, 'Note likho (jaise Binance internal transfer ID ya kisne bheja).');
    return markPaid(inv, { by: 'admin', note });
  }
  if (action === 'cancel') {
    if (inv.status === 'paid') fail(409, 'Paid invoice cancel nahi hoga.');
    db.prepare("UPDATE invoices SET status='cancelled', note=?, updated_at=? WHERE id=?").run(note || inv.note, Date.now(), inv.id);
    log(inv.id, 'cancel', 'Admin ne cancel kiya' + (note ? ': ' + note : ''));
    webhooks.enqueue(get(inv.id), 'invoice.cancelled', view(get(inv.id)));
    return get(inv.id);
  }
  if (action === 'reopen') {
    if (!['review', 'expired', 'cancelled'].includes(inv.status) && !(inv.status === 'pending')) fail(409, 'Ye invoice dobara nahi khul sakta.');
    let amount;
    db.transaction(() => {
      if (inv.tx) db.prepare('DELETE FROM used_txs WHERE network = ? AND tx = ? AND invoice_id = ?').run(inv.network, inv.tx, inv.id);
      amount = holders(inv.amount_micro, inv.id).length ? uniqueAmount(inv.base_micro, inv.id) : inv.amount_micro;
      db.prepare(`UPDATE invoices SET status='pending', amount_micro=?, amount_at=?, tx='', tx_from='', paid_micro=0, tx_time=0, confirmations=0, review_reason='', expires_at=?, updated_at=? WHERE id=?`)
        .run(amount, Date.now(), Date.now() + (Number(getSettings().invoice_minutes) || 60) * 60e3, Date.now(), inv.id);
    })();
    log(inv.id, 'reopen', `Admin ne dobara khola (TxID chhod diya), amount ${usdt(amount)} USDT` + (note ? ': ' + note : ''));
    return get(inv.id);
  }
  if (action === 'resend') { if (inv.status !== 'paid') fail(400, 'Sirf Paid invoice ka webhook bhejte hain.'); webhooks.enqueue(inv, 'invoice.paid', view(inv)); return inv; }
  fail(400, 'Galat action');
}

module.exports = { METHOD_KEYS, cfgOf, methodReady, methods, get, view, create, choose, submit, markPaid, adminAction, tick, start, log };
