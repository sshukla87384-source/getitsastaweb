const config = require('../config');
const { db, plain, getSettings, listProducts } = require('../db');
const { rateLimit } = require('../http');
const { str, int, fail, isEmail, normPhone, isPhone } = require('../lib/util');
const { jsonOnly, loadCustomer } = require('../lib/auth');
const orders = require('../lib/orders');
const pay = require('../lib/paygate');
const fx = require('../lib/fx');
const newsletter = require('../lib/newsletter');

const orderLimit = rateLimit({ windowMs: 15 * 60e3, limit: 20, message: 'Bahut zyada orders. 15 minute baad try karo.' });
const lookupLimit = rateLimit({ windowMs: 60e3, limit: 60 });
const couponLimit = rateLimit({ windowMs: 60e3, limit: 20, message: 'Bahut zyada coupon try. Ek minute ruko.' });

const chatLimit = rateLimit({ windowMs: 60e3, limit: 40, message: 'Bahut zyada requests. Thodi der baad try karo.' });
const support = require('../lib/support');
const imageUrl = name => (name ? `/uploads/${name}` : '');

function publicProduct(p) {
  const rate = fx.inrPerUsd();
  return {
    id: p.id, name: p.name, category: p.category, description: p.description, details: p.details,
    image: imageUrl(p.image), color: p.color, tag: p.tag,
    plans: p.plans.map(pl => ({
      id: pl.id, label: pl.label, price: pl.price, mrp: pl.mrp, days: pl.days,
      usd: orders.planUsd(pl, rate), usd_mrp: Math.round(pl.mrp * (orders.planUsd(pl, rate) / pl.price) * 100) / 100,
      instant: pl.delivery === 'auto' || pl.delivery === 'api',
      in_stock: pl.delivery === 'auto' ? pl.stock_left > 0 : pl.delivery === 'api' ? (pl.api_stock === null || pl.api_stock === undefined || pl.api_stock > 0) : true,
      stock_left: pl.delivery === 'auto' ? Math.min(pl.stock_left, 99) : pl.delivery === 'api' && pl.api_stock !== null && pl.api_stock !== undefined ? Math.min(pl.api_stock, 99) : null,
    })),
  };
}

function paymentOptions(s) {
  const nets = pay.ready() ? pay.cachedMethods() : [];
  if (pay.ready()) pay.methods().catch(() => {});   // cache taaza rakho
  return { upi: s.pay_upi === '1', crypto: pay.ready() && nets.length > 0, crypto_networks: nets, upi_label: s.upi_label || 'UPI' };
}

// Order sirf woh dekh sake jiske paas order ID + email ho, ya jo us account se logged in ho
function accessOrder(req, code, email) {
  code = str(code, 20).toUpperCase();
  const o = plain(db.prepare('SELECT * FROM orders WHERE code = ?').get(code));
  if (!o) fail(404, 'Is order ID se koi order nahi mila.');
  const c = loadCustomer(req);
  const byEmail = str(email, 120).toLowerCase() === o.email;
  const byAccount = c && o.customer_id === c.id;
  if (!byEmail && !byAccount) fail(404, 'Is order ID aur email se koi order nahi mila.');
  // logged-in customer apna (same email wala) guest order khole to account mein jod do
  if (c && !o.customer_id && c.email === o.email && c.email_verified) { db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(c.id, o.id); o.customer_id = c.id; }
  // account wale order ki delivery (email/password, keys) sirf usi account ke login par dikhe
  o._locked = !!o.customer_id && !(c && o.customer_id === c.id);
  return o;
}

module.exports = api => {
  // ---------- Live chat ----------
  api.get('/api/chat', chatLimit, ({ query }) => support.get(query.get('token'), query.get('after')));
  api.post('/api/chat/send', chatLimit, async ({ req, body }) => { jsonOnly(req); return support.send(body, loadCustomer(req)); });
  api.post('/api/chat/human', chatLimit, async ({ req, body }) => { jsonOnly(req); return support.human(body, loadCustomer(req)); });
  api.get('/api/store', ({ req }) => {
    const s = getSettings();
    const c = loadCustomer(req);
    return {
      settings: { store_name: s.store_name, tagline: s.tagline, whatsapp: s.whatsapp, support_email: s.support_email, announcement: s.announcement },
      payments: paymentOptions(s),
      currency: fx.publicInfo(s),
      default_lang: s.default_lang || 'en',
      referral: { on: s.ref_on === '1', pct: Number(s.ref_friend_pct) || 10 },
      newsletter: { on: s.newsletter_on === '1', pct: Number(s.newsletter_pct) || 10, delay: Number(s.newsletter_delay) || 25 },
      customer: c ? { name: c.name, email: c.email, phone: c.phone } : null,
      products: listProducts().filter(p => p.plans.length).map(publicProduct),
    };
  });

  api.get('/api/products/:id', ({ params }) => {
    const p = listProducts().find(x => x.id === int(params.id));
    if (!p || !p.plans.length) fail(404, 'Ye product ab available nahi hai.');
    return publicProduct(p);
  });

  api.post('/api/cart/price', couponLimit, ({ body }) => {
    const r = orders.priceCart(body.items, body.coupon);
    if (body.email && isEmail(str(body.email, 120))) orders.checkCouponOwner(r.coupon, str(body.email, 120));
    return { subtotal: r.subtotal, discount: r.discount, total: r.total, coupon: r.coupon ? r.coupon.code : '', referral: !!r.coupon?.ref_owner_id };
  });

  api.post('/api/orders', orderLimit, ({ req, body, ctx }) => {
    jsonOnly(req);
    const c = loadCustomer(req);
    const name = str(body.name, 80) || c?.name || '';
    const email = (str(body.email, 120) || c?.email || '').toLowerCase();
    const phone = normPhone(body.phone || c?.phone || '');
    if (name.length < 2) fail(400, 'Apna naam daalo.');
    if (!isEmail(email)) fail(400, 'Sahi email daalo, order isi se track hoga.');
    if (!isPhone(phone)) fail(400, 'Sahi mobile number daalo (10 digit).');
    const currency = fx.valid(body.currency) ? String(body.currency).toUpperCase() : 'INR';
    const lang = ['en', 'hi', 'hinglish'].includes(body.lang) ? body.lang : '';
    const o = orders.createOrder({ customerId: c?.id || null, name, email, phone, items: body.items, coupon: body.coupon, currency, lang });
    if (c && !c.phone && phone) db.prepare('UPDATE customers SET phone = ? WHERE id = ?').run(phone, c.id);
    ctx.status = 201;
    return { code: o.code, email: o.email, total: o.total };
  });

  api.get('/api/orders/:code', lookupLimit, ({ req, params, query }) => {
    const o = accessOrder(req, params.code, query.get('email'));
    const s = getSettings();
    const v = orders.orderView(o, { locked: o._locked });
    if (o.status === 'awaiting_payment') {
      const pay = paymentOptions(s);
      // INR = UPI (+ crypto). Baaki currency = USD / USDT (crypto). Crypto band ho to UPI hi.
      const intl = (o.currency || 'INR') !== 'INR';
      const showUpi = pay.upi && (!intl || !pay.crypto);
      v.payment = {
        crypto: pay.crypto, crypto_networks: pay.crypto_networks, upi_label: pay.upi_label, intl,
        upi: showUpi ? {
          upi_id: s.upi_id, upi_name: s.upi_name, qr: s.upi_qr || '',
          link: `upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.upi_name)}&am=${o.total}.00&cu=INR&tn=${encodeURIComponent(o.code)}`,
        } : null,
      };
    }
    v.crypto = { usdt: pay.usdt(o.usdt_micro), amount: o.crypto_amount_micro ? pay.usdt(o.crypto_amount_micro) : '', started: !!o.gw_invoice, ref: o.pay_method === 'crypto' ? o.gw_ref || '' : '' };
    v.whatsapp = s.whatsapp;
    v.support_email = s.support_email;
    v.store_name = s.store_name;
    return v;
  });

  api.post('/api/orders/:code/utr', lookupLimit, async ({ req, params, body }) => {
    jsonOnly(req);
    const o = accessOrder(req, params.code, body.email);
    if (getSettings().pay_upi !== '1') fail(400, 'Manual UPI payment abhi band hai. Online pay karo.');
    if (o.status !== 'awaiting_payment') fail(409, 'Is order ka payment pehle hi submit ho chuka hai.');
    const utr = str(body.utr, 30).replace(/\s/g, '');
    if (!/^[A-Za-z0-9]{10,22}$/.test(utr)) fail(400, 'UTR / Transaction ID 12 digit ka hota hai. Apne payment app ki history mein dekho.');
    try {
      db.prepare("UPDATE orders SET utr = ?, status = 'verifying', pay_method = 'upi', updated_at = datetime('now') WHERE id = ?").run(utr, o.id);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) fail(409, 'Ye UTR pehle hi kisi aur order mein use ho chuka hai.');
      throw e;
    }
    // BharatPe auto-verify (chalu ho to) — turant Paid
    let auto = { status: 'verifying', reason: 'off' };
    try { auto = await require('../lib/upiverify').tryVerify(plain(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id))); } catch (e) { console.error('[upi verify]', e.message); }
    if (auto.status === 'verifying') orders.notifyTelegram(`🧾 UTR submit ${o.code}\nUTR: ${utr} • ₹${o.total}\n${auto.reason === 'off' ? 'Bank app mein check karke admin panel se "Paid" karo.' : `BharatPe auto-check: ${auto.reason} — thodi der mein dobara check hoga, warna haath se Paid karo.`}`);
    return { ok: true, status: auto.status };
  });

  // ---------- Newsletter ----------
  const subLimit = rateLimit({ windowMs: 60 * 60e3, limit: 8, message: 'Bahut zyada try. Ek ghante baad.' });
  api.post('/api/newsletter', subLimit, async ({ req, body }) => { jsonOnly(req); return newsletter.subscribe(body); });
  api.get('/api/newsletter/unsubscribe', ({ query, ctx }) => {
    const ok = newsletter.unsubscribe(str(query.get('t'), 80));
    ctx.status = 302; ctx.headers.Location = `/unsubscribe${ok ? '?ok=1' : ''}`;
    return {};
  });
  // Email app ka "Unsubscribe" button (RFC 8058 one-click)
  api.post('/api/newsletter/unsubscribe', ({ query }) => ({ ok: newsletter.unsubscribe(str(query.get('t'), 80)) }));

  // ---------- Crypto: Get It Sasta Pay ----------
  // Customer "Crypto se pay" dabata hai → Pay app par invoice → pay page ka link
  api.post('/api/orders/:code/crypto', lookupLimit, async ({ req, params, body }) => {
    jsonOnly(req);
    const o = accessOrder(req, params.code, body.email);
    const base = config.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
    const inv = await pay.createInvoice(o, `${base}/order/${o.code}?email=${encodeURIComponent(o.email)}`);
    return { pay_url: inv.pay_url, amount: inv.amount };
  });
  // Pay page se wapas aaye / "check karo" — Pay app se status
  api.post('/api/orders/:code/crypto/check', lookupLimit, async ({ req, params, body }) => {
    jsonOnly(req);
    const o = accessOrder(req, params.code, body.email);
    if (o.status !== 'awaiting_payment' || !o.gw_invoice) return { status: o.status };
    const upd = await pay.refresh(o);
    return { status: upd.status };
  });
  // Pay app ka signed webhook
  api.post('/api/pay/webhook', ({ req, raw, body }) => pay.onWebhook(req, raw, body));
};

module.exports.publicProduct = publicProduct;
