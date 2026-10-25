// Telegram bots: jitne chaho. Har bot ke roles: alerts (naye order / payment), support (live chat), admin (commands se store chalao).
// .env wale TELEGRAM_BOT_TOKEN / SUPPORT_BOT_TOKEN bhi "virtual" bots ki tarah chalte hain.
const crypto = require('crypto');
const config = require('../config');
const { db, plain, getSettings } = require('../db');
const { fail, str } = require('./util');

const ROLES = ['alerts', 'support', 'admin'];
const state = new Map();           // botId → { mode, error, last_ok, username }
const pollers = new Map();         // token → { stop, bot }

function envBots() {
  const out = [];
  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) out.push({ id: 'env-alerts', name: 'Alerts (.env)', token: config.TELEGRAM_BOT_TOKEN, chat_id: String(config.TELEGRAM_CHAT_ID), roles: ['alerts'], env: true, active: 1 });
  if (config.SUPPORT_BOT_TOKEN && config.SUPPORT_CHAT_ID && config.SUPPORT_POLL !== false) out.push({ id: 'env-support', name: 'Live chat (.env)', token: config.SUPPORT_BOT_TOKEN, chat_id: String(config.SUPPORT_CHAT_ID), roles: ['support'], env: true, active: 1 });
  return out;
}
function all() {
  const dbBots = db.prepare('SELECT * FROM bots WHERE active = 1 ORDER BY id').all().map(plain).map(b => ({ ...b, roles: b.roles.split(',').map(s => s.trim()).filter(Boolean) }));
  return [...dbBots, ...envBots()];
}
const byRole = role => all().filter(b => b.roles.includes(role));

async function call(token, method, body) {
  const r = await fetch(`${config.TELEGRAM_API}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 12000) });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) { const e = new Error(d.description || `Telegram ${r.status}`); e.code = d.error_code || r.status; throw e; }
  return d.result;
}
async function send(bot, text, extra = {}) {
  const r = await call(bot.token, 'sendMessage', { chat_id: bot.chat_id, text: String(text).slice(0, 4000), disable_web_page_preview: true, ...extra });
  setState(bot.id, { error: '' });
  return r;
}
function setState(id, patch) { state.set(String(id), { ...(state.get(String(id)) || { mode: 'idle', error: '', last_ok: 0 }), ...patch }); }

// Alerts: saare alert bots ko (koi fail ho to baaki chalte rahein)
async function notify(text) {
  await Promise.all(byRole('alerts').map(b => send(b, text).catch(e => { setState(b.id, { error: e.message }); console.error('[telegram alert]', b.name, e.message); })));
}

// ---------- Incoming ----------
function offsetGet(bot) { return bot.env ? Number(getSettings()['tgoff_' + hash(bot.token)] || (bot.id === 'env-support' ? getSettings().support_tg_offset : 0)) || 0 : Number(db.prepare('SELECT tg_offset FROM bots WHERE id = ?').get(bot.id)?.tg_offset) || 0; }
function offsetSet(bot, v) {
  if (bot.env) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('tgoff_' + hash(bot.token), String(v));
  else db.prepare('UPDATE bots SET tg_offset = ? WHERE id = ?').run(v, bot.id);
}
const hash = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

const HELP = roles => [
  'Get It Sasta bot ✓',
  ...(roles.includes('admin') ? ['', 'Store:', '/orders — verify / deliver baaki', '/order GIS-XXXX — order details', '/paid GIS-XXXX — payment mila maano', '/deliver GIS-XXXX details… — deliver karo', '/cancel GIS-XXXX — cancel', '/retry GIS-XXXX — supplier API dobara', '/stats — aaj / mahine ki kamai', '/sync — supplier products abhi sync'] : []),
  ...(roles.includes('support') ? ['', 'Live chat:', 'Customer ke message par Reply karo → jawab website par', '/r C1234 jawab • /close C1234 • /chats'] : []),
  ...(roles.includes('alerts') ? ['', 'Naye order aur payment ke alerts yahan aayenge.'] : []),
].join('\n');

async function onMessage(bot, m) {
  const text = String(m.text || m.caption || '').trim();
  if (String(m.chat?.id) !== String(bot.chat_id)) {
    // setup help: anjaan chat ko sirf uska chat ID batao, aur kuch nahi
    if (/^\/(start|id)\b/i.test(text)) await call(bot.token, 'sendMessage', { chat_id: m.chat.id, text: `Aapka chat ID: ${m.chat.id}\nIse admin panel → Integrations → Telegram bots mein "Chat ID" mein daalo.` }).catch(() => {});
    return;
  }
  if (/^\/(start|help)\b/i.test(text)) return send(bot, HELP(bot.roles));
  if (bot.roles.includes('support') && await require('./support').onAdminMessage(m, bot)) return;
  if (bot.roles.includes('admin') && text.startsWith('/')) return adminCommand(bot, text);
}

async function poll(bot, ctl) {
  setState(bot.id, { mode: 'polling' });
  let wait = 1000;
  while (!ctl.stop) {
    try {
      const ups = await call(bot.token, 'getUpdates', { offset: offsetGet(bot), timeout: 25, allowed_updates: ['message'] });
      setState(bot.id, { error: '', last_ok: Date.now(), mode: 'polling' }); wait = 1000;
      for (const u of ups) {
        offsetSet(bot, u.update_id + 1);
        if (u.message) await onMessage(bot, u.message).catch(e => console.error('[bot msg]', bot.name, e.message));
      }
    } catch (e) {
      if (ctl.stop) break;
      setState(bot.id, { error: e.code === 409 ? 'Is bot par koi aur program / webhook chal raha hai. Is kaam ke liye alag bot banao.' : e.code === 401 ? 'Token galat hai (BotFather se dobara copy karo).' : e.message });
      if (e.code === 401) { setState(bot.id, { mode: 'off' }); break; }
      await new Promise(r => setTimeout(r, wait)); wait = Math.min(60000, wait * 2);
    }
  }
}

// Kaunse bots ko sunna hai (support / admin role) — badlav par dobara
function reload() {
  const want = new Map();
  for (const b of all()) if (b.roles.some(r => r === 'support' || r === 'admin')) {
    const ex = want.get(b.token);
    if (ex) ex.roles = [...new Set([...ex.roles, ...b.roles])]; else want.set(b.token, { ...b });
  }
  for (const [token, ctl] of pollers) if (!want.has(token) || want.get(token).chat_id !== ctl.bot.chat_id || want.get(token).roles.join() !== ctl.bot.roles.join()) { ctl.stop = true; pollers.delete(token); }
  for (const [token, bot] of want) if (!pollers.has(token)) { const ctl = { stop: false, bot }; pollers.set(token, ctl); poll(bot, ctl).catch(e => console.error('[bot poll]', e.message)); }
}
function start() { setTimeout(reload, 2500).unref?.(); }

// ---------- Admin commands (Telegram se store) ----------
async function adminCommand(bot, text) {
  const orders = require('./orders');
  const [cmd, codeRaw, ...rest] = text.split(/\s+/);
  const code = String(codeRaw || '').toUpperCase();
  const find = () => { const o = plain(db.prepare('SELECT * FROM orders WHERE code = ?').get(code)); if (!o) throw new Error(`Order ${code || '?'} nahi mila. Likho: ${cmd} GIS-XXXXXXX`); return o; };
  const money = n => `₹${Number(n).toLocaleString('en-IN')}`;
  try {
    switch (cmd.toLowerCase().replace(/@\w+$/, '')) {
      case '/orders': {
        const rows = db.prepare("SELECT code, name, total, status, utr FROM orders WHERE status IN ('verifying','paid') ORDER BY id DESC LIMIT 15").all().map(plain);
        return send(bot, rows.length ? `Kaam baaki (${rows.length}):\n${rows.map(o => `• ${o.code} — ${o.name} — ${money(o.total)} — ${o.status === 'verifying' ? `UTR ${o.utr} verify karo` : 'deliver karo'}`).join('\n')}` : 'Sab clear ✓ Koi order baaki nahi.');
      }
      case '/order': {
        const o = find(), items = orders.getItems(o.id);
        return send(bot, `${o.code} — ${o.status}\n${o.name} • ${o.email} • ${o.phone}\n${items.map(i => `• ${i.product_name} (${i.plan_label}) ×${i.qty}${i.delivery_mode === 'api' ? ` [API: ${i.api_status || 'baaki'}]` : ''}`).join('\n')}\nTotal ${money(o.total)}${o.discount ? ` (coupon ${o.coupon_code})` : ''}${o.utr ? `\nUTR: ${o.utr}` : ''}${o.pay_method ? `\nPay: ${o.pay_method}` : ''}\n${orders.baseUrl()}/admin/#orders`);
      }
      case '/paid': { const o = find(); const r = orders.adminUpdate(o.id, { status: 'paid' }); return send(bot, `✓ ${o.code} → ${r.status}`); }
      case '/deliver': {
        const o = find(); const details = rest.join(' ').trim();
        const r = orders.adminUpdate(o.id, { status: 'delivered', delivery: details || undefined });
        return send(bot, `✓ ${o.code} delivered. Customer ko email chala gaya.${r.delivery ? '' : ''}`);
      }
      case '/cancel': { const o = find(); orders.adminUpdate(o.id, { status: 'cancelled' }); return send(bot, `✓ ${o.code} cancel.`); }
      case '/retry': { const o = find(); const r = await require('./fulfil').run(o.id, { manual: true }); return send(bot, r.report?.length ? r.report.map(x => x.ok ? '✓ mil gaya' : `✗ ${x.error}`).join('\n') : `Kuch baaki nahi (status: ${o.status}).`); }
      case '/stats': {
        const q = w => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE status IN ('paid','delivered') AND paid_at >= ${w}`).get();
        const d = q("datetime('now','+330 minutes','start of day','-330 minutes')"), mth = q("datetime('now','+330 minutes','start of month','-330 minutes')");
        const pend = db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('verifying','paid')").get().n;
        return send(bot, `Aaj: ${d.n} orders • ${money(d.s)}\nIs mahine: ${mth.n} orders • ${money(mth.s)}\nKaam baaki: ${pend}`);
      }
      case '/sync': {
        const acts = db.prepare("SELECT id, name FROM api_actions WHERE purpose = 'import'").all().map(plain);
        if (!acts.length) return send(bot, 'Koi import action nahi. Admin → Integrations mein banao.');
        const out = [];
        for (const a of acts) { try { const r = await require('./importer').run(a.id); out.push(`✓ ${a.name}: ${r.summary.create} naye, ${r.summary.update} update`); } catch (e) { out.push(`✗ ${a.name}: ${e.message}`); } }
        return send(bot, out.join('\n'));
      }
      default: return send(bot, HELP(bot.roles));
    }
  } catch (e) { return send(bot, `⚠️ ${e.message}`); }
}

// ---------- Admin CRUD ----------
function save(body, id) {
  const old = id ? plain(db.prepare('SELECT * FROM bots WHERE id = ?').get(id)) : null;
  if (id && !old) fail(404, 'Bot nahi mila.');
  const token = body.token && !String(body.token).includes('••') ? str(body.token, 100).trim() : old?.token;
  if (!/^\d{5,12}:[A-Za-z0-9_-]{30,}$/.test(token || '')) fail(400, 'Bot token sahi nahi (BotFather se aisa milta hai: 123456789:AAH…).');
  const chat_id = str(body.chat_id, 30).trim();
  if (!/^-?\d{3,20}$/.test(chat_id)) fail(400, 'Chat ID sirf number hota hai (group ka -100… se shuru). Bot ko /start bhejo — wo aapka ID bata dega.');
  let roles = (Array.isArray(body.roles) ? body.roles : String(body.roles || '').split(',')).map(r => String(r).trim()).filter(r => ROLES.includes(r));
  if (!roles.length) roles = ['alerts'];
  // ek token par sirf ek "suno" wala bot (warna Telegram 409)
  if (roles.some(r => r !== 'alerts')) {
    const clash = all().find(b => b.token === token && String(b.id) !== String(id) && b.roles.some(r => r !== 'alerts'));
    if (clash) fail(400, `Ye token pehle se "${clash.name}" mein support/admin ke liye laga hai. Ek hi bot ko dono roles do, ya alag bot banao.`);
  }
  const v = { name: str(body.name, 60) || 'Telegram bot', token, chat_id, roles: roles.join(','), active: body.active === false ? 0 : 1 };
  if (old) db.prepare('UPDATE bots SET name=?, token=?, chat_id=?, roles=?, active=? WHERE id=?').run(v.name, v.token, v.chat_id, v.roles, v.active, id);
  else id = Number(db.prepare('INSERT INTO bots (name, token, chat_id, roles, active) VALUES (?,?,?,?,?)').run(v.name, v.token, v.chat_id, v.roles, v.active).lastInsertRowid);
  setImmediate(reload);
  return list().find(b => String(b.id) === String(id));
}
function remove(id) { db.prepare('DELETE FROM bots WHERE id = ?').run(id); setImmediate(reload); }
function list() {
  const rows = [...db.prepare('SELECT * FROM bots ORDER BY id').all().map(plain).map(b => ({ ...b, roles: b.roles.split(',').filter(Boolean) })), ...envBots()];
  return rows.map(b => ({ id: b.id, name: b.name, chat_id: b.chat_id, roles: b.roles, active: !!b.active, env: !!b.env, token: `${String(b.token).split(':')[0]}:••••`, listening: pollers.has(b.token), ...(state.get(String(b.id)) || {}) }));
}
async function test(id) {
  const b = all().find(x => String(x.id) === String(id)) || (() => { const r = plain(db.prepare('SELECT * FROM bots WHERE id = ?').get(id)); return r && { ...r, roles: r.roles.split(',') }; })();
  if (!b) fail(404, 'Bot nahi mila.');
  try {
    const me = await call(b.token, 'getMe', {});
    if (!b.env) db.prepare('UPDATE bots SET username = ? WHERE id = ?').run(me.username || '', b.id);
    await send(b, `✓ Get It Sasta se test — bot @${me.username} juda hai.\nRoles: ${b.roles.join(', ')}`);
    return { ok: true, username: me.username };
  } catch (e) {
    setState(b.id, { error: e.message });
    fail(400, /chat not found/i.test(e.message) ? 'Chat nahi mila — pehle Telegram mein bot kholo aur /start bhejo, phir Chat ID check karo.' : `Telegram: ${e.message}`);
  }
}

module.exports = { all, byRole, send, notify, call, reload, start, save, remove, list, test, ROLES, onMessage };
