// Chhota SMTP client (Hostinger email, Gmail, Zoho sab ke saath chalta hai). Koi package nahi.
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');
const config = require('../config');
const { esc } = require('./util');

function smtpSession(opts) {
  return new Promise((resolve, reject) => {
    let socket, buf = '', waiter = null, done = false;
    const timeout = setTimeout(() => finish(new Error('SMTP timeout')), 20000);
    const finish = err => {
      if (done) return; done = true; clearTimeout(timeout);
      try { socket?.end(); } catch {}
      err ? reject(err) : resolve();
    };
    const onData = d => {
      buf += d.toString('utf8');
      if (!waiter) return;
      // poora response: aakhri line "250 ..." (dash ke bina)
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const resp = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null; w?.(resp); return;
        }
      }
    };
    const read = () => new Promise(r => { waiter = r; if (buf) onData(''); });
    const cmd = async (line, expect) => {
      if (line !== null) socket.write(line + '\r\n');
      const resp = await read();
      if (expect && !expect.test(resp)) throw new Error(`SMTP: "${line ? line.split(' ')[0] : 'connect'}" fail — ${resp.slice(0, 200)}`);
      return resp;
    };
    const attach = s => { socket = s; s.on('data', onData); s.on('error', finish); };

    const run = async () => {
      await cmd(null, /^220/);
      const host = os.hostname() || 'localhost';
      let ehlo = await cmd(`EHLO ${host}`, /^250/);
      if (!opts.secure && /STARTTLS/i.test(ehlo)) {
        await cmd('STARTTLS', /^220/);
        socket.removeListener('data', onData);
        await new Promise((res, rej) => { const t = tls.connect({ socket, servername: opts.host }, res); t.on('error', rej); attach(t); });
        ehlo = await cmd(`EHLO ${host}`, /^250/);
      }
      if (opts.user) {
        await cmd('AUTH LOGIN', /^334/);
        await cmd(Buffer.from(opts.user).toString('base64'), /^334/);
        await cmd(Buffer.from(opts.pass).toString('base64'), /^235/);
      }
      await cmd(`MAIL FROM:<${opts.fromAddr}>`, /^250/);
      await cmd(`RCPT TO:<${opts.to}>`, /^25[01]/);
      await cmd('DATA', /^354/);
      const body = opts.message.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      await cmd(body + '\r\n.', /^250/);
      socket.write('QUIT\r\n');
      finish();
    };

    const s = opts.secure
      ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host })
      : net.connect({ host: opts.host, port: opts.port });
    attach(s);
    s.once(opts.secure ? 'secureConnect' : 'connect', () => run().catch(finish));
  });
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
const encWord = s => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;

function buildMessage({ fromName, fromAddr, to, subject, text, html }) {
  const boundary = 'gis_' + crypto.randomBytes(8).toString('hex');
  const domain = fromAddr.split('@')[1] || 'localhost';
  return [
    `From: ${encWord(fromName)} <${fromAddr}>`,
    `To: <${to}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html),
    `--${boundary}--`, '',
  ].join('\r\n');
}

// ---------- Email budget: saal bhar ki limit + har type ka ON/OFF ----------
// kind → setting key. 'test' hamesha jaata hai.
const KINDS = {
  otp: { key: 'mail_otp', group: 'essential', label: 'Customer OTP (login, email verify, password reset)' },
  admin_otp: { key: 'mail_admin_otp', group: 'essential', label: 'Admin login OTP' },
  order_placed: { key: 'mail_order_placed', group: 'order', label: 'Order ban gaya — payment karo' },
  order_paid: { key: 'mail_order_paid', group: 'order', label: 'Payment mil gaya' },
  order_delivered: { key: 'mail_order_delivered', group: 'order', label: 'Order delivered' },
  welcome: { key: 'mail_welcome', group: 'marketing', label: 'Newsletter: welcome + coupon code' },
  referral: { key: 'mail_referral', group: 'order', label: 'Referral reward (dost ne kharida → aapka code)' },
  campaign: { key: 'mail_campaign', group: 'marketing', label: 'Newsletter: naya product / offer (aap bhejte ho)' },
  test: { key: '', group: 'essential', label: 'Test email' },
};
const { db, getSettings } = require('../db');
const year = () => String(new Date().getFullYear());
const month = () => new Date().toISOString().slice(0, 7);
function usage() {
  const s = getSettings();
  const y = db.prepare('SELECT COALESCE(SUM(n),0) v FROM mail_stats WHERE period = ?').get(year()).v;
  const m = db.prepare('SELECT COALESCE(SUM(n),0) v FROM mail_stats WHERE period = ?').get(month()).v;
  const byKind = Object.fromEntries(db.prepare('SELECT kind, n FROM mail_stats WHERE period = ?').all(year()).map(r => [r.kind, r.n]));
  const cap = Number(s.mail_year_cap) || 50000, reserve = Math.min(cap, Number(s.mail_reserve) || 0);
  return { year: y, month: m, cap, reserve, left: Math.max(0, cap - y), marketing_left: Math.max(0, cap - reserve - y), byKind };
}
function count(kind, n = 1) {
  const up = db.prepare('INSERT INTO mail_stats (period, kind, n) VALUES (?, ?, ?) ON CONFLICT(period, kind) DO UPDATE SET n = n + excluded.n');
  up.run(year(), kind, n); up.run(month(), kind, n);
}
// kitne mail bheje ja sakte hain is type ke (0 = band / limit khatam)
function allowance(kind) {
  const k = KINDS[kind] || KINDS.order_paid;
  if (k.key && getSettings()[k.key] !== '1') return { ok: false, why: 'off' };
  const u = usage();
  const left = k.group === 'marketing' ? u.marketing_left : k.group === 'essential' ? Infinity : u.left;
  return left > 0 ? { ok: true, left } : { ok: false, why: 'limit' };
}

async function resendSend(payload) {
  const res = await fetch(config.RESEND_API + '/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || `Resend error ${res.status}`); }
}
const fromLine = storeName => (/</.test(config.MAIL_FROM) ? config.MAIL_FROM : `${storeName || 'Get It Sasta'} <${config.MAIL_FROM}>`);
const replyTo = () => { const e = getSettings().support_email; return e && /@/.test(e) ? e : undefined; };

async function sendMail({ to, subject, text, html, storeName, kind = 'order_paid', headers }) {
  const a = allowance(kind);
  if (!a.ok) { console.log(`[mail] ${kind} skip (${a.why === 'off' ? 'admin ne band kiya' : 'saal ki limit'}) → ${to}`); return false; }
  const sent = await rawSend({ to, subject, text, html, storeName, headers });
  if (sent) count(kind);
  return sent;
}

async function rawSend({ to, subject, text, html, storeName, headers }) {
  if (config.resendReady()) {
    // Resend API: https://resend.com/docs/api-reference/emails/send-email
    await resendSend({ from: fromLine(storeName), to: [to], subject, html, text, reply_to: replyTo(), headers });
    return true;
  }
  if (!config.smtpReady()) return false;
  const fromAddr = (config.SMTP.from.match(/<([^>]+)>/) || [, config.SMTP.from])[1];
  const message = buildMessage({ fromName: storeName || 'Get It Sasta', fromAddr, to, subject, text, html });
  await smtpSession({ ...config.SMTP, fromAddr, to, message });
  return true;
}

// Bahut saare (newsletter): Resend batch (100 ek call mein), warna ek-ek SMTP se
async function sendBulk(messages, { storeName, kind = 'campaign' } = {}) {
  let sent = 0, failed = 0;
  if (config.resendReady()) {
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100).map(m => ({ from: fromLine(storeName), to: [m.to], subject: m.subject, html: m.html, text: m.text, reply_to: replyTo(), headers: m.headers }));
      try {
        const res = await fetch(config.RESEND_API + '/emails/batch', {
          method: 'POST', headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk), signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || `Resend batch ${res.status}`); }
        sent += chunk.length; count(kind, chunk.length);
      } catch (e) { console.error('[mail batch]', e.message); failed += chunk.length; }
      await new Promise(r => setTimeout(r, 600));   // Resend rate limit (≈2 req/sec)
    }
  } else {
    for (const m of messages) {
      try { if (await rawSend({ ...m, storeName })) { sent++; count(kind); } else failed++; } catch { failed++; }
    }
  }
  return { sent, failed };
}

// Background mein bhejo — order flow kabhi email ki wajah se na ruke
function queueMail(args) {
  sendMail(args).catch(e => console.error('[mail]', args.to, e.message));
}

// ---- Branded email layout ----
function layout({ storeName, title, intro, rows = [], button, footer, unsubUrl }) {
  const rowsHtml = rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0">${rows.map(([a, b]) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #ECEAF4;color:#6B6488;font-size:14px">${esc(a)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #ECEAF4;font-weight:600;color:#1B1240;font-size:14px">${esc(b)}</td></tr>`).join('')}</table>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#F6F5FA;font-family:Arial,Helvetica,sans-serif;color:#1B1240">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E4E1EF">
<tr><td style="background:#1B1240;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:800">get it <span style="background:#FFD23F;color:#2B1D00;padding:2px 7px;border-radius:6px">sasta</span></td></tr>
<tr><td style="padding:26px 24px">
<h1 style="margin:0 0 10px;font-size:22px;line-height:1.25">${esc(title)}</h1>
<p style="margin:0;color:#3D3466;font-size:15px;line-height:1.55">${esc(intro)}</p>
${rowsHtml}
${button ? `<p style="margin:22px 0 4px"><a href="${esc(button.url)}" style="display:inline-block;background:#FFD23F;color:#2B1D00;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(button.label)}</a></p>` : ''}
${footer ? `<p style="margin:18px 0 0;color:#6B6488;font-size:13px;line-height:1.5">${esc(footer)}</p>` : ''}
</td></tr></table>
<p style="color:#9C95BF;font-size:12px;margin:14px 0 0">${esc(storeName)} • getitsasta.com${unsubUrl ? ` • <a href="${esc(unsubUrl)}" style="color:#9C95BF">Unsubscribe</a>` : ''}</p>
</td></tr></table></body></html>`;
  const text = [title, '', intro, '', ...rows.map(([a, b]) => `${a}: ${b}`), '', button ? `${button.label}: ${button.url}` : '', footer || '', unsubUrl ? `\nUnsubscribe: ${unsubUrl}` : ''].join('\n');
  return { html, text };
}

module.exports = { sendMail, queueMail, sendBulk, layout, usage, allowance, KINDS };
