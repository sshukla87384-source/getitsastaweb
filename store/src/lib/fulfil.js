// Supplier API se auto-delivery: plan ka delivery = 'api' ho to payment aate hi supplier ki API call,
// jo mile (login, key, link) wahi customer ke order page par. Fail ho to retry, phir Telegram alert.
const { db, plain } = require('../db');
const connector = require('./connector');

const running = new Set();
const MAX_TRIES = 3;

function ctxFor(o, it, plan, n) {
  const { baseUrl } = require('./orders');
  return {
    order: { code: o.code, email: o.email, name: o.name, phone: o.phone, total: o.total, currency: o.currency, lang: o.lang, created_at: o.created_at },
    item: { id: it.id, product_name: it.product_name, plan_label: it.plan_label, qty: it.qty, price: it.price, plan_id: it.plan_id, days: it.days, api_ref: plan?.api_ref || '', unit: n + 1 },
    idem: `${o.code}-${it.id}-${n + 1}`,
    store: { url: baseUrl() }, now: new Date().toISOString(),
  };
}

async function run(orderId, { manual = false } = {}) {
  if (running.has(orderId)) return { busy: true };
  running.add(orderId);
  const orders = require('./orders');
  const report = [];
  try {
    const o = orders.getOrder(orderId);
    if (!o || o.status !== 'paid') return { skipped: true };
    const items = orders.getItems(orderId).filter(i => i.delivery_mode === 'api' && i.api_status !== 'ok' && (manual || i.api_status !== 'failed'));
    for (const it of items) {
      const plan = plain(db.prepare('SELECT * FROM plans WHERE id = ?').get(it.plan_id));
      const action = plan?.api_action_id ? connector.getAction(plan.api_action_id) : null;
      const tries = (manual ? 0 : it.api_tries) + 1;
      if (!action) { setItem(it.id, 'failed', tries, 'Is plan ka supplier API action set nahi hai (Products → plan → API action).'); report.push({ item: it.id, ok: false }); alert(o, it, 'API action set nahi'); continue; }
      db.prepare("UPDATE order_items SET api_status = 'pending', api_tries = ? WHERE id = ?").run(tries, it.id);
      const opts = connector.parse(action.options, {});
      const units = opts.per_unit ? Math.max(1, it.qty) : 1;
      const results = [], refs = [];
      let err = '', retryable = false;
      for (let n = 0; n < units; n++) {
        let r;
        try { r = await connector.runAction(action, ctxFor(o, it, plan, n), { kind: 'fulfil', ref: o.code }); }
        catch (e) { r = { ok: false, error: e.message, status: 0 }; }
        if (!r.ok) {
          err = r.error || 'API fail';
          // Timeout par dobara mat bhejo (supplier ne shayad bana diya ho) — sirf connection error / 5xx / 429 par retry
          retryable = !/Timeout/.test(err) && (r.status === 0 || r.status >= 500 || r.status === 429);
          break;
        }
        results.push(r.result || '(supplier ne khaali jawab diya)'); if (r.ref) refs.push(r.ref);
      }
      if (!err) {
        db.prepare("UPDATE order_items SET api_status = 'ok', api_error = '', api_ref = ?, auto_content = ? WHERE id = ?")
          .run(refs.join(','), results.join('\n\n— — —\n\n').slice(0, 8000), it.id);
        report.push({ item: it.id, ok: true });
      } else {
        const final = !retryable || tries >= MAX_TRIES;
        setItem(it.id, final ? 'failed' : 'retry', tries, err);
        if (final) alert(o, it, err);
        report.push({ item: it.id, ok: false, error: err, final });
      }
    }
    orders.completeIfReady(orderId);
    return { report };
  } finally { running.delete(orderId); }
}

function setItem(id, status, tries, error) {
  db.prepare('UPDATE order_items SET api_status = ?, api_tries = ?, api_error = ? WHERE id = ?').run(status, tries, String(error).slice(0, 500), id);
}
function alert(o, it, err) {
  require('./orders').notifyTelegram(`⚠️ Supplier API fail — ${o.code}\n${it.product_name} (${it.plan_label}) ×${it.qty}\n${String(err).slice(0, 300)}\n\nAdmin → Orders → ${o.code} → "Supplier se dobara mangwao" ya haath se deliver karo.`);
}

// Har minute: retry wale + atke hue (pending 10 min se zyada)
function tick() {
  const rows = db.prepare(`SELECT DISTINCT oi.order_id FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'paid' AND oi.delivery_mode = 'api' AND (oi.api_status IN ('', 'retry') OR (oi.api_status = 'pending' AND o.paid_at < datetime('now','-10 minutes'))) LIMIT 20`).all();
  for (const r of rows) run(r.order_id).catch(e => console.error('[fulfil]', e.message));
}
function start() { setInterval(tick, 60e3).unref(); setTimeout(tick, 8000).unref(); }

module.exports = { run, start, tick };
