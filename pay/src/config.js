// Get It Sasta Pay — settings. Ye store se bilkul alag app hai: alag folder, alag database, alag login.
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

// Hostinger layout: ~/domains/<domain>/hbuilds/... → data: ~/domains/<domain>/pay-data (deploy par overwrite nahi hota)
const hostinger = ROOT.match(/^(.*?)[\\/]hbuilds[\\/]/);
const DATA_DIR = path.resolve(process.env.DATA_DIR || (hostinger ? path.join(hostinger[1], 'pay-data') : path.join(ROOT, 'data')));
fs.mkdirSync(DATA_DIR, { recursive: true });
loadEnvFile(path.join(DATA_DIR, '.env'));

const env = process.env;
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

module.exports = {
  ROOT,
  DATA_DIR,
  BACKUP_DIR: path.join(DATA_DIR, 'backups'),
  DB_FILE: env.DB_FILE || path.join(DATA_DIR, 'pay.db'),
  IS_HOSTINGER: !!hostinger,
  PORT: Number(env.PORT) || 3100,
  HOST: env.HOST || (hostinger || env.PORT ? '0.0.0.0' : '127.0.0.1'),
  IS_PROD: (env.NODE_ENV || (hostinger ? 'production' : '')) === 'production',
  TRUST_PROXY: bool(env.TRUST_PROXY, !!hostinger),
  PUBLIC_URL: (env.PUBLIC_URL || '').replace(/\/$/, ''),          // jaise https://pay.getitsasta.com
  ADMIN_USERNAME: env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
  RECHECK_MS: Number(env.RECHECK_MS) || 15000,                   // confirm ho rahe transactions dobara kab check karein
  WEBHOOK_TIMEOUT_MS: 10000,
};
fs.mkdirSync(module.exports.BACKUP_DIR, { recursive: true });
