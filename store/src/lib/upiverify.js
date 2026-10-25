// UPI UTR → BharatPe se apne aap verify. Na ho paaye to order 'verifying' mein rehta hai (admin haath se Paid karta hai).
const { db, plain } = require('../db');
const bharatpe = require('./bharatpe');
const orders = require('./orders');

const sqlMs = s => Date.parse(String(s).replace(' ', 'T') + 'Z') || 0;
const noted = new Map();   // order id → last reason (ek hi alert baar baar na jaaye)

async function tryVerify(o) {
  if (!bharatpe.enabled() || o.status !== 'verifying' || !o.utr) return { status: o.status, reason: 'off' };
  const r = await bharatpe.check(o.utr, o.total, sqlMs(o.created_at));
  if (r.ok) {
    const upd = orders.markPaid(o.id, { method: 'upi', utr: o.utr });
    db.prepare("UPDATE orders SET admin_note = TRIM(COALESCE(admin_note,'') || ?) WHERE id = ?").run(`\nBharatPe auto ✓ ${r.tx.payer} ${r.tx.vpa}`.slice(0, 200), o.id);
    return { status: upd.status, reason: 'matched' };
  }
  if (['amount_mismatch', 'not_received', 'too_old'].includes(r.reason) && noted.get(o.id) !== r.reason) {
    noted.set(o.id, r.reason);
    const why = { amount_mismatch: `amount match nahi (aaya ₹${r.tx?.amount}, chahiye ₹${o.total})`, not_received: 'UTR mila par payment received/success nahi', too_old: 'UTR order se pehle ka hai' }[r.reason];
    orders.notifyTelegram(`⚠️ ${o.code} UTR ${o.utr}: ${why}. Admin panel se check karo.`);
  }
  return { status: o.status, reason: r.reason };
}

// Har minute: 'verifying' wale orders dobara (UTR BharatPe mein der se dikh sakta hai)
let busy = false;
async function tick() {
  if (busy || !bharatpe.enabled()) return; busy = true;
  try {
    const list = db.prepare("SELECT * FROM orders WHERE status = 'verifying' AND utr IS NOT NULL AND created_at > datetime('now','-3 days') ORDER BY id DESC LIMIT 30").all().map(plain);
    for (const o of list) { const r = await tryVerify(o); if (r.reason === 'expired' || r.reason === 'error') break; }
  } catch (e) { console.error('[upi verify]', e.message); }
  finally { busy = false; }
}
function start() { setInterval(() => tick().catch(() => {}), 60e3).unref(); }

module.exports = { tryVerify, tick, start };
