// Store ko signed webhook: X-GSP-Signature = HMAC-SHA256(webhook_secret, `${timestamp}.${body}`)
const config = require('../config');
const { db, plain } = require('../db');
const { hmac } = require('./util');

const BACKOFF = [0, 30e3, 2 * 60e3, 10 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3, 12 * 3600e3];

function enqueue(inv, event, data) {
  const payload = JSON.stringify({ event, created: Date.now(), data });
  const r = db.prepare('INSERT INTO webhooks (invoice_id, client_id, event, payload, status, next_at, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(inv.id, inv.client_id, event, payload, 'pending', Date.now(), Date.now());
  setImmediate(() => deliver(Number(r.lastInsertRowid)).catch(() => {}));
}

async function deliver(id) {
  const w = plain(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id));
  if (!w || w.status !== 'pending') return;
  // Ek hi webhook do jagah se ek saath na jaaye: pehle "claim" karo
  if (!db.prepare("UPDATE webhooks SET status='sending' WHERE id = ? AND status='pending'").run(id).changes) return;
  const c = plain(db.prepare('SELECT * FROM clients WHERE id = ?').get(w.client_id));
  if (!c || !c.webhook_url) { db.prepare("UPDATE webhooks SET status='failed', last_error='Webhook URL set nahi' WHERE id=?").run(id); return; }
  const ts = String(Math.floor(Date.now() / 1000));
  let code = 0, err = '';
  try {
    const res = await fetch(c.webhook_url, {
      method: 'POST', body: w.payload, signal: AbortSignal.timeout(config.WEBHOOK_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'GetItSastaPay/1', 'X-GSP-Timestamp': ts, 'X-GSP-Signature': hmac(c.webhook_secret, `${ts}.${w.payload}`), 'X-GSP-Event': w.event },
    });
    code = res.status;
    if (!res.ok) err = (await res.text().catch(() => '')).slice(0, 200) || `HTTP ${code}`;
  } catch (e) { err = e.message; }
  const attempts = w.attempts + 1;
  if (!err) db.prepare("UPDATE webhooks SET status='sent', attempts=?, last_code=?, last_error='' WHERE id=?").run(attempts, code, id);
  else if (attempts >= BACKOFF.length) db.prepare("UPDATE webhooks SET status='failed', attempts=?, last_code=?, last_error=? WHERE id=?").run(attempts, code, err, id);
  else db.prepare("UPDATE webhooks SET status='pending', attempts=?, last_code=?, last_error=?, next_at=? WHERE id=?").run(attempts, code, err, Date.now() + BACKOFF[attempts], id);
}

let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try { for (const r of db.prepare("SELECT id FROM webhooks WHERE status='pending' AND next_at <= ? ORDER BY id LIMIT 20").all(Date.now())) await deliver(r.id); }
  finally { busy = false; }
}
function start() { setInterval(() => tick().catch(() => {}), 5000).unref(); }
function retry(id) { db.prepare("UPDATE webhooks SET status='pending', next_at=? WHERE id=? AND status != 'sending'").run(Date.now(), id); return deliver(id); }
// Process restart par 'sending' mein atke webhooks wapas line mein
db.prepare("UPDATE webhooks SET status='pending' WHERE status='sending'").run();

module.exports = { enqueue, deliver, start, retry };
