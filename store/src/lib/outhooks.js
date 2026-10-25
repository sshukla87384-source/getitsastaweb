// Outgoing webhooks: order / payment / chat events kisi bhi URL par (n8n, Zapier, Make, apni website, Google Apps Script…)
// Har request signed: X-GIS-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<body>")>
const crypto = require('crypto');
const { db, plain } = require('../db');
const { fail, str } = require('./util');

const EVENTS = ['order.created', 'order.paid', 'order.delivered', 'order.cancelled', 'chat.human', 'chat.message', 'subscriber.created', 'referral.reward', 'test'];
const BACKOFF = [60, 300, 1800, 7200, 21600];     // 1m, 5m, 30m, 2h, 6h

function emit(event, data) {
  try {
    const hooks = db.prepare('SELECT * FROM webhooks WHERE active = 1').all().map(plain)
      .filter(h => h.events === '*' || h.events.split(',').map(s => s.trim()).includes(event));
    if (!hooks.length) return 0;
    const body = JSON.stringify({ id: 'evt_' + crypto.randomBytes(9).toString('hex'), event, created_at: new Date().toISOString(), data });
    const ins = db.prepare('INSERT INTO webhook_deliveries (webhook_id, event, payload, next_at) VALUES (?,?,?,?)');
    for (const h of hooks) ins.run(h.id, event, body, 0);
    setImmediate(tick);
    return hooks.length;
  } catch (e) { console.error('[outhooks emit]', e.message); return 0; }
}

async function deliver(d) {
  const h = plain(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(d.webhook_id));
  if (!h) return;
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', h.secret).update(`${t}.${d.payload}`).digest('hex');
  let code = 0, error = '';
  try {
    const r = await fetch(h.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'GetItSasta-Webhooks/1', 'X-GIS-Event': d.event, 'X-GIS-Delivery': String(d.id), 'X-GIS-Signature': `t=${t},v1=${sig}` }, body: d.payload });
    code = r.status; await r.arrayBuffer().catch(() => {});
    if (code < 200 || code >= 300) error = `HTTP ${code}`;
  } catch (e) { error = e.name === 'TimeoutError' ? 'Timeout (10s)' : e.message; }
  const tries = d.tries + 1;
  if (!error) db.prepare("UPDATE webhook_deliveries SET status='ok', tries=?, last_code=?, last_error='' WHERE id=?").run(tries, code, d.id);
  else if (tries > BACKOFF.length) db.prepare("UPDATE webhook_deliveries SET status='failed', tries=?, last_code=?, last_error=? WHERE id=?").run(tries, code || null, error.slice(0, 300), d.id);
  else db.prepare("UPDATE webhook_deliveries SET status='pending', tries=?, last_code=?, last_error=?, next_at=? WHERE id=?").run(tries, code || null, error.slice(0, 300), Date.now() + BACKOFF[tries - 1] * 1000, d.id);
  return { ok: !error, code, error };
}

let busy = false, again = false;
async function tick() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      const due = db.prepare("SELECT * FROM webhook_deliveries WHERE status = 'pending' AND next_at <= ? ORDER BY id LIMIT 25").all(Date.now()).map(plain);
      await Promise.all(due.map(async d => {
        if (!db.prepare("UPDATE webhook_deliveries SET status='sending' WHERE id = ? AND status='pending'").run(d.id).changes) return;
        await deliver(d);
      }));
      if (due.length === 25) again = true;
    } while (again);
  } catch (e) { console.error('[outhooks]', e.message); } finally { busy = false; }
}
function start() {
  db.prepare("UPDATE webhook_deliveries SET status='pending' WHERE status='sending'").run();
  setInterval(tick, 15000).unref();
  setInterval(() => { try { db.prepare("DELETE FROM webhook_deliveries WHERE status IN ('ok','failed') AND created_at < datetime('now','-30 days')").run(); } catch {} }, 6 * 3600e3).unref();
}

// ---------- Admin ----------
function save(body, id) {
  const old = id ? plain(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id)) : null;
  if (id && !old) fail(404, 'Webhook nahi mila.');
  const url = str(body.url, 500);
  if (!/^https?:\/\/[^\s]+$/i.test(url)) fail(400, 'URL https:// se shuru hona chahiye.');
  let events = Array.isArray(body.events) ? body.events : String(body.events || '*').split(',');
  events = events.map(e => String(e).trim()).filter(e => e === '*' || EVENTS.includes(e));
  const ev = !events.length || events.includes('*') ? '*' : events.join(',');
  const name = str(body.name, 60), active = body.active === false ? 0 : 1;
  if (old) db.prepare('UPDATE webhooks SET name=?, url=?, events=?, active=? WHERE id=?').run(name, url, ev, active, id);
  else id = Number(db.prepare('INSERT INTO webhooks (name, url, secret, events, active) VALUES (?,?,?,?,?)').run(name, url, 'whsec_' + crypto.randomBytes(24).toString('hex'), ev, active).lastInsertRowid);
  if (body.rotate_secret) db.prepare('UPDATE webhooks SET secret = ? WHERE id = ?').run('whsec_' + crypto.randomBytes(24).toString('hex'), id);
  return view(plain(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id)), true);
}
function view(h, showSecret = false) {
  const stats = db.prepare("SELECT SUM(status='ok') ok, SUM(status='failed') failed, SUM(status='pending') pending FROM webhook_deliveries WHERE webhook_id = ? AND created_at > datetime('now','-7 days')").get(h.id);
  return { ...h, active: !!h.active, secret: showSecret ? h.secret : `${h.secret.slice(0, 10)}••••`, stats: { ok: stats.ok || 0, failed: stats.failed || 0, pending: stats.pending || 0 } };
}
const list = () => db.prepare('SELECT * FROM webhooks ORDER BY id').all().map(plain).map(h => view(h));
const deliveries = id => db.prepare('SELECT id, event, status, tries, last_code, last_error, created_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 50').all(id).map(plain);
async function test(id) {
  const h = plain(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id)); if (!h) fail(404, 'Webhook nahi mila.');
  const body = JSON.stringify({ id: 'evt_test', event: 'test', created_at: new Date().toISOString(), data: { message: 'Get It Sasta webhook test ✓' } });
  const did = Number(db.prepare("INSERT INTO webhook_deliveries (webhook_id, event, payload, status, next_at) VALUES (?, 'test', ?, 'sending', 0)").run(id, body).lastInsertRowid);
  const r = await deliver(plain(db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(did)));
  if (!r.ok) db.prepare("UPDATE webhook_deliveries SET status='failed' WHERE id = ?").run(did);   // test ka retry nahi
  return r;
}
function retry(deliveryId) { db.prepare("UPDATE webhook_deliveries SET status='pending', next_at=0 WHERE id = ? AND status = 'failed'").run(deliveryId); setImmediate(tick); }

// Order ka saaf payload (secrets / delivery content nahi)
function orderPayload(o, items) {
  return { code: o.code, status: o.status, name: o.name, email: o.email, phone: o.phone, currency: o.currency, total_inr: o.total, discount_inr: o.discount, coupon: o.coupon_code || null,
    usdt: o.usdt_micro ? o.usdt_micro / 1e6 : null, pay_method: o.pay_method || null, utr: o.utr || null, created_at: o.created_at, paid_at: o.paid_at || null, delivered_at: o.delivered_at || null,
    items: (items || []).map(i => ({ product: i.product_name, plan: i.plan_label, qty: i.qty, price_inr: i.price, delivery_mode: i.delivery_mode, plan_id: i.plan_id })) };
}

module.exports = { EVENTS, emit, start, tick, save, list, deliveries, test, retry, orderPayload };
