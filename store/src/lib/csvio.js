// Products CSV: Excel / Google Sheets se ek saath bahut products. Har line = ek plan; same product naam = ek product.
// Columns: product, category, description, details, tag, active, plan, price, mrp, days, delivery, usdt_price, sku, image_url
const { db, plain, listProducts } = require('../db');
const { fail } = require('./util');

const COLS = ['product', 'category', 'description', 'details', 'tag', 'active', 'plan', 'price', 'mrp', 'days', 'delivery', 'usdt_price', 'sku', 'image_url'];
const ALIASES = { name: 'product', product_name: 'product', title: 'product', plan_label: 'plan', variant: 'plan', duration: 'plan', selling_price: 'price', sale_price: 'price', mrp_price: 'mrp', original_price: 'mrp', usdt: 'usdt_price', image: 'image_url', photo: 'image_url', status: 'active', delivery_mode: 'delivery' };

function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') && !first.includes(',') ? '\t' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const num = v => { const n = Number(String(v ?? '').replace(/[₹$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
const yes = v => !/^(0|no|n|false|off|inactive|band)$/i.test(String(v ?? '').trim());
const daysFromLabel = l => { const m = String(l).match(/(\d+)\s*(day|month|year|din|mahina|saal)/i); if (!m) return 0; const n = +m[1]; return /day|din/i.test(m[2]) ? n : /month|mahina/i.test(m[2]) ? (n % 12 === 0 ? (n / 12) * 365 : n * 30) : n * 365; };

function analyse(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) fail(400, 'CSV mein header aur kam se kam ek line chahiye.');
  const head = rows[0].map(h => { const k = String(h).trim().toLowerCase().replace(/[\s-]+/g, '_'); return ALIASES[k] || k; });
  if (!head.includes('product') || !head.includes('price')) fail(400, 'CSV mein kam se kam "product" aur "price" columns hone chahiye.');
  const products = new Map(db.prepare('SELECT id, name FROM products').all().map(plain).map(p => [p.name.toLowerCase(), p]));
  const plansOf = id => db.prepare('SELECT id, label FROM plans WHERE product_id = ?').all(id).map(plain);
  const errors = [], lines = [];
  rows.slice(1, 3001).forEach((r, i) => {
    const o = Object.fromEntries(head.map((h, j) => [h, String(r[j] ?? '').trim()]));
    const line = i + 2;
    const product = o.product.slice(0, 80), plan = (o.plan || 'Standard').slice(0, 40);
    const price = Math.round(num(o.price)), mrp = o.mrp ? Math.round(num(o.mrp)) : price;
    if (!product) return errors.push(`Line ${line}: product ka naam khaali`);
    if (!(price > 0 && price <= 1e6)) return errors.push(`Line ${line}: "${product}" ka price sahi nahi (${o.price || 'khaali'})`);
    if (!(mrp >= price)) return errors.push(`Line ${line}: "${product}" ka MRP price se kam hai`);
    const usdt = o.usdt_price ? Math.round(num(o.usdt_price) * 100) / 100 : 0;
    if (o.usdt_price && !(usdt >= 0.1)) return errors.push(`Line ${line}: usdt_price sahi nahi`);
    const ex = products.get(product.toLowerCase());
    const exPlan = ex ? plansOf(ex.id).find(p => p.label.toLowerCase() === plan.toLowerCase()) : null;
    lines.push({ line, product, category: (o.category || '').slice(0, 40), description: (o.description || '').slice(0, 300), details: (o.details || '').replace(/\\n/g, '\n').slice(0, 4000),
      tag: (o.tag || '').slice(0, 20), active: o.active === undefined || o.active === '' ? null : yes(o.active), plan, price, mrp,
      days: o.days !== undefined && o.days !== '' ? Math.max(0, Math.floor(num(o.days)) || 0) : daysFromLabel(plan),
      delivery: ['auto', 'manual', 'api'].includes((o.delivery || '').toLowerCase()) ? o.delivery.toLowerCase() : null,
      usdt, sku: (o.sku || '').slice(0, 120), image_url: o.image_url || '', product_status: ex ? 'update' : 'new', plan_status: exPlan ? 'update' : 'new', plan_id: exPlan?.id || null, product_id: ex?.id || null });
  });
  const names = new Set(lines.map(l => l.product.toLowerCase()));
  return { lines, errors, summary: { rows: lines.length, products: names.size, new_products: new Set(lines.filter(l => l.product_status === 'new').map(l => l.product.toLowerCase())).size, new_plans: lines.filter(l => l.plan_status === 'new').length, updated_plans: lines.filter(l => l.plan_status === 'update').length, errors: errors.length } };
}

async function apply(text) {
  const { lines, errors, summary } = analyse(text);
  if (errors.length) fail(400, `CSV mein ${errors.length} galti: ${errors.slice(0, 5).join(' • ')}`);
  const imgs = [];
  db.transaction(() => {
    const pid = new Map();
    for (const l of lines) {
      const key = l.product.toLowerCase();
      let id = pid.get(key) || l.product_id;
      if (!id) {
        id = Number(db.prepare("INSERT INTO products (name, category, description, details, tag, active, sort, source) VALUES (?,?,?,?,?,?,?, 'csv')")
          .run(l.product, l.category || 'Other', l.description, l.details, l.tag, l.active === false ? 0 : 1, 50).lastInsertRowid);
        if (l.image_url) imgs.push([id, l.image_url]);
      } else if (!pid.has(key)) {
        // pehli line se product ki info update (jo bhari hai wahi)
        const set = [], args = [];
        for (const k of ['category', 'description', 'details', 'tag']) if (l[k]) { set.push(`${k} = ?`); args.push(l[k]); }
        if (l.active !== null) { set.push('active = ?'); args.push(l.active ? 1 : 0); }
        if (set.length) db.prepare(`UPDATE products SET ${set.join(', ')} WHERE id = ?`).run(...args, id);
        if (l.image_url) imgs.push([id, l.image_url]);
      }
      pid.set(key, id);
      const planId = l.plan_id || db.prepare('SELECT id FROM plans WHERE product_id = ? AND lower(label) = lower(?)').get(id, l.plan)?.id;
      if (planId) {
        db.prepare(`UPDATE plans SET price = ?, mrp = ?, days = ?, price_usdt = ?${l.delivery ? ', delivery = ?' : ''}${l.sku ? ', api_ref = ?' : ''} WHERE id = ?`)
          .run(...[l.price, l.mrp, l.days, l.usdt, ...(l.delivery ? [l.delivery === 'api' ? 'manual' : l.delivery] : []), ...(l.sku ? [l.sku] : []), planId]);
      } else {
        const sort = db.prepare('SELECT COUNT(*) n FROM plans WHERE product_id = ?').get(id).n;
        db.prepare('INSERT INTO plans (product_id, label, price, mrp, days, delivery, sort, price_usdt, api_ref) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, l.plan, l.price, l.mrp, l.days, l.delivery === 'auto' ? 'auto' : 'manual', sort, l.usdt, l.sku);
      }
    }
  })();
  const { saveImageFromUrl } = require('./images');
  let photos = 0;
  for (const [id, url] of imgs.slice(0, 40)) {
    if (db.prepare("SELECT image FROM products WHERE id = ?").get(id)?.image) continue;
    const name = await saveImageFromUrl(url); if (name) { db.prepare('UPDATE products SET image = ? WHERE id = ?').run(name, id); photos++; }
  }
  return { ...summary, photos };
}

function exportCsv(baseUrl = '') {
  const out = [COLS.join(',')];
  for (const p of listProducts({ includeInactive: true })) for (const pl of p.plans) {
    out.push([p.name, p.category, p.description, String(p.details || '').replace(/\n/g, '\\n'), p.tag, p.active ? 'yes' : 'no', pl.label, pl.price, pl.mrp, pl.days, pl.delivery, pl.price_usdt || '', pl.api_ref || '', p.image ? `${baseUrl}/uploads/${p.image}` : ''].map(csvCell).join(','));
  }
  return '﻿' + out.join('\r\n');
}
const template = () => '﻿' + [COLS.join(','), 'Netflix Premium,Entertainment,4K UHD + 4 screens,,Popular,yes,1 Month,499,649,30,manual,,,', 'Netflix Premium,Entertainment,,,,yes,3 Months,1399,1947,90,manual,,,', 'Canva Pro,Design,Premium templates + brand kit,,,yes,12 Months,2999,3999,365,auto,35,,'].join('\r\n');

module.exports = { parseCsv, analyse, apply, exportCsv, template };
