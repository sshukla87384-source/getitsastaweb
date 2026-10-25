// Public REST API (v1) — API key se. Docs: Admin → Integrations → Store API.
const { db, plain, listProducts, getSettings } = require('../db');
const { str, int, fail, isEmail, normPhone, isPhone } = require('../lib/util');
const keys = require('../lib/apikeys');
const orders = require('../lib/orders');
const fx = require('../lib/fx');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-API-Key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const scope = s => ({ req, ctx }) => { Object.assign(ctx.headers, CORS); req.apiKey = keys.auth(req, s); };

function productOut(p) {
  const rate = fx.inrPerUsd();
  return { id: p.id, name: p.name, category: p.category, description: p.description, active: !!p.active, image: p.image ? `${orders.baseUrl()}/uploads/${p.image}` : null,
    plans: p.plans.map(pl => ({ id: pl.id, label: pl.label, price_inr: pl.price, mrp_inr: pl.mrp, price_usd: orders.planUsd(pl, rate), days: pl.days, delivery: pl.delivery,
      in_stock: pl.delivery === 'auto' ? pl.stock_left > 0 : pl.delivery === 'api' ? (pl.api_stock == null || pl.api_stock > 0) : true })) };
}
function orderOut(o) {
  const v = orders.orderView(o, { admin: false });
  return { code: o.code, status: o.status, name: o.name, email: o.email, phone: o.phone, currency: o.currency, total_inr: o.total, discount_inr: o.discount, coupon: o.coupon_code || null,
    usdt: o.usdt_micro ? o.usdt_micro / 1e6 : null, pay_method: o.pay_method || null, utr: o.utr || null, created_at: o.created_at, paid_at: o.paid_at, delivered_at: o.delivered_at,
    order_url: `${orders.baseUrl()}/order/${o.code}?email=${encodeURIComponent(o.email)}`,
    items: v.items.map(i => ({ product: i.product_name, plan: i.plan_label, plan_id: i.plan_id, qty: i.qty, price_inr: i.price, delivery_mode: i.delivery_mode, expires_at: i.expires_at })) };
}
const findOrder = code => { const o = plain(db.prepare('SELECT * FROM orders WHERE code = ?').get(str(code, 20).toUpperCase())); if (!o) fail(404, 'Order not found'); return o; };

module.exports = api => {
  api.get('/api/v1', scope(null), () => ({ ok: true, store: getSettings().store_name, version: 1, docs: `${orders.baseUrl()}/admin/#integrations` }));
  api.get('/api/v1/products', scope('products:read'), ({ query }) => {
    const all = query.get('all') === '1';
    return { data: listProducts({ includeInactive: all }).filter(p => all || p.plans.length).map(productOut) };
  });
  api.get('/api/v1/products/:id', scope('products:read'), ({ params }) => {
    const p = listProducts({ includeInactive: true }).find(x => x.id === int(params.id)); if (!p) fail(404, 'Product not found');
    return { data: productOut(p) };
  });
  api.get('/api/v1/orders', scope('orders:read'), ({ query }) => {
    const where = [], args = [];
    const st = query.get('status'); if (st) { where.push('status = ?'); args.push(st); }
    const em = query.get('email'); if (em) { where.push('email = ?'); args.push(em.toLowerCase()); }
    const since = query.get('since'); if (since) { where.push('created_at >= ?'); args.push(since.replace('T', ' ').slice(0, 19)); }
    const limit = Math.min(200, Math.max(1, int(query.get('limit')) || 50));
    const rows = db.prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit).map(plain);
    return { data: rows.map(orderOut) };
  });
  api.get('/api/v1/orders/:code', scope('orders:read'), ({ params }) => ({ data: orderOut(findOrder(params.code)) }));
  api.post('/api/v1/orders', scope('orders:write'), ({ body, ctx }) => {
    const name = str(body.name, 80), email = str(body.email, 120).toLowerCase(), phone = normPhone(body.phone || '');
    if (name.length < 2) fail(400, 'name required');
    if (!isEmail(email)) fail(400, 'valid email required');
    if (!isPhone(phone)) fail(400, 'valid phone required');
    const items = (Array.isArray(body.items) ? body.items : []).map(i => ({ planId: int(i.plan_id ?? i.planId), qty: int(i.qty) || 1 }));
    const currency = fx.valid(body.currency) ? String(body.currency).toUpperCase() : 'INR';
    const o = orders.createOrder({ name, email, phone, items, coupon: str(body.coupon, 30), currency, lang: ['en', 'hi', 'hinglish'].includes(body.lang) ? body.lang : '' });
    ctx.status = 201;
    return { data: orderOut(orders.getOrder(o.id)) };
  });
  api.post('/api/v1/orders/:code/status', scope('orders:write'), ({ params, body }) => {
    const o = findOrder(params.code);
    return { data: orderOut(orders.adminUpdate(o.id, { status: str(body.status, 20) })) };
  });
  api.post('/api/v1/orders/:code/deliver', scope('orders:write'), ({ params, body }) => {
    const o = findOrder(params.code);
    const delivery = str(body.delivery, 4000);
    if (!delivery) fail(400, 'delivery text required');
    return { data: orderOut(orders.adminUpdate(o.id, { status: 'delivered', delivery })) };
  });
};
module.exports.CORS = CORS;
