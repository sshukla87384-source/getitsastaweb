// Saari settings ek jagah. Hostinger Cloud par app ka folder har deploy par overwrite hota hai,
// isliye database aur uploads us folder ke BAHAR rakhe jaate hain.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

// Hostinger layout: ~/domains/<domain>/hbuilds/current/nodejs  → data: ~/domains/<domain>/gis-data
const hostinger = ROOT.match(/^(.*?)[\\/]hbuilds[\\/]/);
const DATA_DIR = path.resolve(process.env.DATA_DIR || (hostinger ? path.join(hostinger[1], 'gis-data') : path.join(ROOT, 'data')));
fs.mkdirSync(DATA_DIR, { recursive: true });

loadEnvFile(path.join(DATA_DIR, '.env'));   // Hostinger par secrets yahan bhi rakh sakte ho

const env = process.env;
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

const config = {
  ROOT,
  DATA_DIR,
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  BACKUP_DIR: path.join(DATA_DIR, 'backups'),
  DB_FILE: env.DB_FILE || path.join(DATA_DIR, 'store.db'),
  IS_HOSTINGER: !!hostinger,
  PORT: Number(env.PORT) || 3000,
  // Hostinger PORT deta hai aur apne proxy se request bhejta hai; VPS par Nginx ke peeche 127.0.0.1 kaafi hai
  HOST: env.HOST || (hostinger || env.PORT ? '0.0.0.0' : '127.0.0.1'),
  IS_PROD: (env.NODE_ENV || (hostinger ? 'production' : '')) === 'production',
  TRUST_PROXY: bool(env.TRUST_PROXY, !!hostinger),
  PUBLIC_URL: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  ADMIN_USERNAME: env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
  // Crypto: Get It Sasta Pay (alag app). Pay panel → Stores (API) se key aur secret milte hain.
  PAY_URL: (env.PAY_URL || '').replace(/\/+$/, ''),                // jaise https://pay.getitsasta.com
  PAY_API_KEY: env.PAY_API_KEY || '',
  PAY_WEBHOOK_SECRET: env.PAY_WEBHOOK_SECRET || '',
  // Emails: Resend API (behtar) ya SMTP
  RESEND_API_KEY: env.RESEND_API_KEY || '',
  RESEND_API: env.RESEND_API || 'https://api.resend.com',
  MAIL_FROM: env.MAIL_FROM || env.SMTP_FROM || '',
  // Admin 2-step login: password ke baad is email par OTP
  ADMIN_EMAIL: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
  SMTP: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 465,
    secure: bool(env.SMTP_SECURE, (Number(env.SMTP_PORT) || 465) === 465),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || env.SMTP_USER || '',
  },
  TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID || '',
  TELEGRAM_API: (env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, ''),
  // Live chat support: ALAG bot zaroori (BotFather → /newbot). Alert wala bot nahi — warna uske doosre program ke messages kha jayega.
  SUPPORT_BOT_TOKEN: env.SUPPORT_BOT_TOKEN || '',
  SUPPORT_CHAT_ID: env.SUPPORT_CHAT_ID || env.TELEGRAM_CHAT_ID || '',
  SUPPORT_POLL: bool(env.SUPPORT_POLL, true),   // Telegram se replies lene ke liye long-polling
};
fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
fs.mkdirSync(config.BACKUP_DIR, { recursive: true });

config.smtpReady = () => !!(config.SMTP.host && config.SMTP.user && config.SMTP.pass);
config.resendReady = () => !!(config.RESEND_API_KEY && config.MAIL_FROM);
config.mailReady = () => config.resendReady() || config.smtpReady();

module.exports = config;
