// Supplier API se products import / sync: list → mapping → apne products + plans (price par markup, stock, photo).
// Naye products pehle "Off" bante hain (aap dekh ke ON karo) jab tak options.activate_new = true na ho.
const { db, plain } = require('../db');
const { fail } = require('./util');
const connector = require('./connector');

const COLORS = ['#10A37F', '#4C6FFF', '#7D2AE8', '#E8590C', '#0BB9A0', '#D6336C', '#1F2937', '#20808D', '#FF0033', '#1DB954'];
const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : NaN; };
const end9 = x => Math.max(9, Math.ceil(x / 10) * 10 - 1);
const daysFromLabel = l => { const m = String(l).match(/(\d+)\s*(day|month|year|din|mahina|saal)/i); if (!m) return 0; const n = +m[1]; return /day|din/i.test(m[2]) ? n : /month|mahina/i.test(m[2]) ? (n % 12 === 0 ? (n / 12) * 365 : n * 30) : n * 365; };

const DEFAULTS = { price_mode: 'markup', markup_pct: 25, cost_rate: 1, mrp_pct: 30, round9: true, create_new: true, activate_new: false, update_price: true, update_stock: true, out_of_stock_missing: true, sync_minutes: 0, default_category: 'Imported', fulfil_action_id: null };

function priceFor(cost, o) {
  let p = cost * (Number(o.cost_rate) || 1);
  if (o.price_mode === 'markup') p *= 1 + (Number(o.markup_pct) || 0) / 100;
  return o.round9 ? end9(p) : Math.max(1, Math.round(p));
}

// API response → saaf rows
function parseRows(res, action) {
  const map = connector.parse(action.map, {});
  let list = connector.get(res, action.list_path);
  if (list && !Array.isArray(list) && typeof list === 'object') list = Object.entries(list).map(([k, v]) => (v && typeof v === 'object' ? { _key: k, ...v } : { _key: k, value: v }));
  if (!Array.isArray(list)) fail(400, `Response mein list nahi mili${action.list_path ? ` ("${action.list_path}" par)` : ''}. "List path" check karo.`);
  if (!map.id || !map.product || !map.price) fail(400, 'Mapping mein kam se kam id, product (naam) aur price ka path daalo.');
  const f = (it, k) => (map[k] ? connector.get(it, map[k]) : undefined);
  return list.slice(0, 2000).map(it => {
    const stock = f(it, 'stock');
    return {
      ref: String(f(it, 'id') ?? '').slice(0, 120), product: String(f(it, 'product') ?? '').trim().slice(0, 80),
      plan: String(f(it, 'plan') ?? '').trim().slice(0, 40) || 'Standard', cost: num(f(it, 'price')), mrp_src: num(f(it, 'mrp')),
      stock: stock === undefined || stock === null || stock === '' ? null : Math.max(0, Math.floor(num(stock)) || 0),
      category: String(f(it, 'category') ?? '').trim().slice(0, 40), description: String(f(it, 'description') ?? '').trim().slice(0, 300),
      image: String(f(it, 'image') ?? ''), days: Number.isFinite(num(f(it, 'days'))) ? Math.max(0, Math.floor(num(f(it, 'days')))) : null,
      active: map.active ? !!f(it, 'active') && f(it, 'active') !== 'false' && f(it, 'active') !== 0 : true,
    };
  }).filter(r => r.ref && r.product && r.cost > 0);
}

async function run(actionId, { preview = false } = {}) {
  const action = connector.getAction(actionId);
  if (!action || action.purpose !== 'import') fail(404, 'Import action nahi mila.');
  const o = { ...DEFAULTS, ...connector.parse(action.options, {}) };
  const r = await connector.request(connector.getIntegration(action.integration_id), { method: action.method || 'GET', path: action.path, headers: action.headers, body: action.body, ctx: connector.sampleCtx(), kind: 'import', actionId: action.id });
  if (!r.ok) fail(502, `Supplier API: ${r.error}`);
  const rows = parseRows(r.data ?? r.text, action);
  const source = `api:${action.id}`;
  const existing = new Map(db.prepare(`SELECT pl.*, p.name AS product_name FROM plans pl JOIN products p ON p.id = pl.product_id WHERE p.source = ?`).all(source).map(plain).map(x => [x.api_ref, x]));
  const out = rows.map(x => {
    const price = priceFor(x.cost, o);
    let mrp = x.mrp_src > 0 ? (o.round9 ? end9(x.mrp_src * (Number(o.cost_rate) || 1)) : Math.round(x.mrp_src * (Number(o.cost_rate) || 1))) : end9(price * (1 + (Number(o.mrp_pct) || 0) / 100));
    if (mrp < price) mrp = price;
    const ex = existing.get(x.ref);
    return { ...x, price, mrp, action: ex ? 'update' : o.create_new ? 'create' : 'skip', plan_id: ex?.id || null, old_price: ex?.price ?? null };
  });
  const summary = { total: out.length, create: out.filter(x => x.action === 'create').length, update: out.filter(x => x.action === 'update').length,
    missing: [...existing.keys()].filter(k => !rows.some(x => x.ref === k)).length };
  if (preview) return { summary, rows: out.slice(0, 100), raw_sample: JSON.stringify(Array.isArray(r.data) ? r.data.slice(0, 2) : r.data ?? r.text).slice(0, 1500) };

  const fulfilId = o.fulfil_action_id && db.prepare("SELECT 1 FROM api_actions WHERE id = ? AND purpose = 'fulfil'").get(o.fulfil_action_id) ? Number(o.fulfil_action_id) : null;
  const imagesToFetch = [];
  db.transaction(() => {
    const prodByName = new Map(db.prepare('SELECT id, name, image FROM products WHERE source = ?').all(source).map(plain).map(p => [p.name.toLowerCase(), p]));
    for (const x of out) {
      if (x.action === 'update') {
        const sets = [], args = [];
        if (o.update_price) { sets.push('price = ?', 'mrp = ?', 'api_cost = ?'); args.push(x.price, x.mrp, x.cost); }
        if (o.update_stock) { sets.push('api_stock = ?'); args.push(x.active ? x.stock : 0); }
        if (sets.length) db.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`).run(...args, x.plan_id);
      } else if (x.action === 'create') {
        let p = prodByName.get(x.product.toLowerCase());
        if (!p) {
          const id = Number(db.prepare('INSERT INTO products (name, category, description, details, color, active, sort, source) VALUES (?,?,?,?,?,?,?,?)')
            .run(x.product, x.category || o.default_category, x.description, '', COLORS[prodByName.size % COLORS.length], o.activate_new ? 1 : 0, 100, source).lastInsertRowid);
          p = { id, name: x.product, image: '' }; prodByName.set(x.product.toLowerCase(), p);
          if (x.image) imagesToFetch.push([id, x.image]);
        }
        const sort = db.prepare('SELECT COUNT(*) n FROM plans WHERE product_id = ?').get(p.id).n;
        db.prepare('INSERT INTO plans (product_id, label, price, mrp, days, delivery, sort, api_action_id, api_ref, api_stock, api_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(p.id, x.plan, x.price, x.mrp, x.days ?? daysFromLabel(x.plan), fulfilId ? 'api' : 'manual', sort, fulfilId, x.ref, x.active ? x.stock : 0, x.cost);
      }
    }
    if (o.out_of_stock_missing) for (const [ref, pl] of existing) if (!rows.some(x => x.ref === ref)) db.prepare('UPDATE plans SET api_stock = 0 WHERE id = ?').run(pl.id);
    db.prepare("UPDATE api_actions SET last_run_at = datetime('now') WHERE id = ?").run(action.id);
  })();
  // Photos (max 25 ek baar mein)
  const { saveImageFromUrl } = require('./images');
  let photos = 0;
  for (const [pid, url] of imagesToFetch.slice(0, 25)) { const name = await saveImageFromUrl(url); if (name) { db.prepare("UPDATE products SET image = ? WHERE id = ? AND image = ''").run(name, pid); photos++; } }
  return { summary: { ...summary, photos }, done: true };
}

// Har minute: jin import actions ka sync on hai aur samay ho gaya
let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    for (const a of db.prepare("SELECT * FROM api_actions WHERE purpose = 'import'").all().map(plain)) {
      const o = { ...DEFAULTS, ...connector.parse(a.options, {}) };
      if (!(o.sync_minutes >= 5)) continue;
      const last = a.last_run_at ? Date.parse(a.last_run_at.replace(' ', 'T') + 'Z') : 0;
      if (Date.now() - last < o.sync_minutes * 60e3) continue;
      try { await run(a.id); } catch (e) {
        db.prepare("UPDATE api_actions SET last_run_at = datetime('now') WHERE id = ?").run(a.id);
        console.error('[import sync]', a.name, e.message);
        require('./orders').notifyTelegram(`⚠️ Product sync fail: ${a.name}\n${String(e.message).slice(0, 300)}`);
      }
    }
  } finally { busy = false; }
}
function start() { setInterval(tick, 60e3).unref(); }

module.exports = { run, start, tick, parseRows, DEFAULTS, priceFor };
