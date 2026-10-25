// Newsletter: popup se subscribe → pehle order par X% off ka apna coupon (sirf usi email par, ek baar).
// Naye product / offer ki khabar: admin panel se ek click (email budget ke andar).
const crypto = require('crypto');
const { db, plain, getSettings } = require('../db');
const { str, fail, isEmail } = require('./util');
const { sendMail, sendBulk, layout, allowance, usage } = require('./mailer');
const { baseUrl } = require('./orders');

const sqlPlus = days => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
const unsubUrl = t => `${baseUrl()}/api/newsletter/unsubscribe?t=${t}`;
const listHeaders = t => ({ 'List-Unsubscribe': `<${unsubUrl(t)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

function makeCoupon(email, s) {
  const pct = Math.min(90, Math.max(1, Number(s.newsletter_pct) || 10));
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 5; i++) {
    const code = 'WELCOME-' + [...crypto.randomBytes(6)].map(b => A[b % A.length]).join('');
    try {
      db.prepare(`INSERT INTO coupons (code, kind, value, min_total, max_discount, max_uses, active, expires_at, email, first_order, note)
        VALUES (?, 'percent', ?, 0, ?, 1, 1, ?, ?, 1, 'newsletter')`).run(code, pct, Number(s.newsletter_max_off) || 0, sqlPlus(Number(s.newsletter_days) || 30), email);
      return { code, pct };
    } catch (e) { if (!String(e.message).includes('UNIQUE')) throw e; }
  }
  fail(500, 'Coupon nahi ban paaya, dobara try karo.');
}

async function subscribe(body) {
  const s = getSettings();
  if (s.newsletter_on !== '1') fail(400, 'Newsletter abhi band hai.');
  const email = str(body.email, 120).toLowerCase();
  if (!isEmail(email)) fail(400, 'Sahi email daalo.');
  const lang = ['en', 'hi', 'hinglish'].includes(body.lang) ? body.lang : '';
  const country = /^[A-Z]{2}$/.test(String(body.country || '')) ? body.country : '';
  let sub = plain(db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email));
  const ordered = !!db.prepare("SELECT 1 FROM orders WHERE email = ? AND status IN ('paid','delivered') LIMIT 1").get(email);
  if (sub && sub.status === 'active') {
    const c = sub.coupon_code ? plain(db.prepare('SELECT * FROM coupons WHERE code = ?').get(sub.coupon_code)) : null;
    return { ok: true, already: true, code: c && c.active && c.used < 1 && !ordered ? c.code : '', pct: c?.value || 0 };
  }
  // Pehle order ho chuka hai to welcome coupon nahi (sirf naye customers ke liye)
  const coupon = ordered ? null : makeCoupon(email, s);
  const token = crypto.randomBytes(18).toString('hex');
  if (sub) db.prepare("UPDATE subscribers SET status='active', token=?, coupon_code=COALESCE(NULLIF(?, ''), coupon_code), lang=?, country=?, unsub_at=NULL WHERE id=?").run(token, coupon?.code || '', lang, country, sub.id);
  else db.prepare('INSERT INTO subscribers (email, token, coupon_code, lang, country) VALUES (?,?,?,?,?)').run(email, token, coupon?.code || '', lang, country);

  let emailed = false;
  if (allowance('welcome').ok) {
    const en = lang !== 'hinglish' && lang !== 'hi';   // default English
    const { html, text } = layout({
      storeName: s.store_name,
      title: coupon ? (en ? `Your ${coupon.pct}% off code: ${coupon.code}` : `Aapka ${coupon.pct}% off code: ${coupon.code}`) : (en ? 'You are subscribed ✓' : 'Subscribe ho gaya ✓'),
      intro: coupon
        ? (en ? `Use ${coupon.code} on your first order (valid ${Number(s.newsletter_days) || 30} days, only for this email). We will also tell you when new products launch.` : `Pehle order par ${coupon.code} lagao (${Number(s.newsletter_days) || 30} din tak, sirf isi email ke liye). Naye products aate hi aapko bata denge.`)
        : (en ? 'We will tell you when new products and offers launch.' : 'Naye products aur offers aate hi aapko bata denge.'),
      button: { label: en ? 'Shop now' : 'Products dekho', url: baseUrl() + '/#shop' }, unsubUrl: unsubUrl(token),
    });
    try { emailed = await sendMail({ to: email, subject: coupon ? `${coupon.pct}% off — ${coupon.code}` : `${s.store_name} newsletter`, html, text, storeName: s.store_name, kind: 'welcome', headers: listHeaders(token) }); }
    catch (e) { console.error('[newsletter mail]', e.message); }
  }
  return { ok: true, code: coupon?.code || '', pct: coupon?.pct || 0, emailed, existing_customer: ordered };
}

function unsubscribe(token) {
  if (!/^[a-f0-9]{36}$/.test(token)) return false;
  return db.prepare("UPDATE subscribers SET status='unsubscribed', unsub_at=datetime('now') WHERE token = ? AND status='active'").run(token).changes > 0
    || !!db.prepare("SELECT 1 FROM subscribers WHERE token = ?").get(token);
}

// ---------- Admin ----------
function stats() {
  const n = (w, ...a) => db.prepare(`SELECT COUNT(*) n FROM subscribers ${w}`).get(...a).n;
  const used = db.prepare("SELECT COUNT(*) n FROM coupons WHERE note='newsletter' AND used > 0").get().n;
  return { active: n("WHERE status='active'"), unsubscribed: n("WHERE status='unsubscribed'"), week: n("WHERE created_at > datetime('now','-7 days')"), coupons_used: used, budget: usage(), can_send: allowance('campaign') };
}
function list(q = '') {
  const like = `%${str(q, 80)}%`;
  return db.prepare("SELECT s.*, c.used AS coupon_used FROM subscribers s LEFT JOIN coupons c ON c.code = s.coupon_code WHERE s.email LIKE ? ORDER BY s.id DESC LIMIT 300").all(like).map(plain);
}
function csv() {
  const rows = db.prepare('SELECT email, status, lang, country, coupon_code, created_at FROM subscribers ORDER BY id').all();
  return ['email,status,lang,country,coupon,joined', ...rows.map(r => [r.email, r.status, r.lang, r.country, r.coupon_code, r.created_at].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
}

// Campaign: naya product launch ya apna message. test_to diya ho to sirf us email par (budget mein ginti).
async function campaign(body) {
  const s = getSettings();
  let subject = str(body.subject, 150), title = str(body.title, 150), intro = str(body.intro, 1500), btnLabel = str(body.button_label, 40), btnUrl = str(body.button_url, 300);
  if (body.product_id) {
    const p = plain(db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(body.product_id)));
    if (!p) fail(404, 'Product nahi mila (ya band hai).');
    const pl = plain(db.prepare('SELECT * FROM plans WHERE product_id = ? ORDER BY price LIMIT 1').get(p.id));
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    subject ||= `New: ${p.name}${pl ? ` — from ₹${pl.price}` : ''}`;
    title ||= `${p.name} is now on Get It Sasta 🎉`;
    intro ||= `${p.description}${pl ? ` Starting at just ₹${pl.price} (MRP ₹${pl.mrp}).` : ''}`;
    btnLabel ||= 'View now'; btnUrl ||= `${baseUrl()}/p/${p.id}-${slug}`;
  }
  if (!subject || !title || !intro) fail(400, 'Subject, heading aur message teeno likho (ya product chuno).');
  if (btnUrl && !/^https?:\/\//.test(btnUrl)) fail(400, 'Button link https:// se shuru hona chahiye.');
  const build = (to, token) => {
    const { html, text } = layout({ storeName: s.store_name, title, intro, button: btnUrl ? { label: btnLabel || 'View', url: btnUrl } : null, unsubUrl: unsubUrl(token) });
    return { to, subject, html, text, headers: listHeaders(token) };
  };
  if (body.test_to) {
    const to = str(body.test_to, 120).toLowerCase();
    if (!isEmail(to)) fail(400, 'Test ke liye sahi email daalo.');
    if (!allowance('campaign').ok) fail(400, 'Newsletter mails band hain ya saal ki marketing limit khatam.');
    const r = await sendBulk([build(to, 'test')], { storeName: s.store_name, kind: 'campaign' });
    return { test: true, ...r };
  }
  const subs = db.prepare("SELECT email, token FROM subscribers WHERE status='active' ORDER BY id").all();
  if (!subs.length) fail(400, 'Abhi koi subscriber nahi hai.');
  const a = allowance('campaign');
  if (!a.ok) fail(400, a.why === 'off' ? 'Settings → Emails mein "Newsletter: naya product / offer" ON karo.' : 'Saal ki marketing email limit khatam.');
  if (subs.length > a.left) fail(400, `${subs.length} subscribers hain, par is saal sirf ${a.left} marketing mails bache hain. Limit badhao ya baad mein bhejo.`);
  const id = Number(db.prepare("INSERT INTO campaigns (subject, kind, recipients) VALUES (?, ?, ?)").run(subject, body.product_id ? 'product' : 'custom', subs.length).lastInsertRowid);
  // Background mein bhejo, admin turant wapas
  sendBulk(subs.map(x => build(x.email, x.token)), { storeName: s.store_name, kind: 'campaign' })
    .then(r => db.prepare("UPDATE campaigns SET sent=?, failed=?, status='done' WHERE id=?").run(r.sent, r.failed, id))
    .catch(e => { console.error('[campaign]', e.message); db.prepare("UPDATE campaigns SET status='failed' WHERE id=?").run(id); });
  return { id, recipients: subs.length };
}
const campaigns = () => db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 30').all().map(plain);

module.exports = { subscribe, unsubscribe, stats, list, csv, campaign, campaigns };
