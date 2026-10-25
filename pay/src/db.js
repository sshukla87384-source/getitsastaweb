const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { hashPassword } = require('./password');

const db = new DatabaseSync(config.DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
db.transaction = fn => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};
const plain = r => (r ? { ...r } : null);

db.exec(`
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Stores / websites jo is Pay app se payment lete hain
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  webhook_url TEXT NOT NULL DEFAULT '',
  webhook_secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,                       -- inv_xxxxxxxx (public)
  client_id INTEGER NOT NULL REFERENCES clients(id),
  order_id TEXT NOT NULL,                    -- store ka order code
  base_micro INTEGER NOT NULL,               -- store ne jo USDT maanga (1 USDT = 1,000,000)
  amount_micro INTEGER NOT NULL,             -- customer ko dikhaya unique amount (base + 0.001…0.099), isi se match
  description TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  return_url TEXT NOT NULL DEFAULT '',
  networks TEXT NOT NULL DEFAULT '',         -- allowed, csv
  network TEXT NOT NULL DEFAULT '',          -- customer ne chuna
  address TEXT NOT NULL DEFAULT '',          -- us waqt ka receive address
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | confirming | review | paid | expired | cancelled
  review_reason TEXT NOT NULL DEFAULT '',
  tx TEXT NOT NULL DEFAULT '',
  tx_from TEXT NOT NULL DEFAULT '',
  paid_micro INTEGER NOT NULL DEFAULT 0,
  tx_time INTEGER NOT NULL DEFAULT 0,
  confirmations INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER NOT NULL,
  paid_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_order ON invoices(client_id, order_id);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_inv_created ON invoices(created_at);

-- Ek TxID sirf ek baar
CREATE TABLE IF NOT EXISTS used_txs (
  network TEXT NOT NULL,
  tx TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (network, tx)
);

CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  client_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | sent | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  last_code INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wh_due ON webhooks(status, next_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ev_inv ON events(invoice_id);
`);

// naye columns (purane database ke liye)
for (const [col, def] of [['amount_at', 'INTEGER NOT NULL DEFAULT 0'], ['submitted_at', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!db.prepare('PRAGMA table_info(invoices)').all().some(c => c.name === col)) db.exec(`ALTER TABLE invoices ADD COLUMN ${col} ${def}`);
}

const DEFAULT_SETTINGS = {
  brand_name: 'Get It Sasta Pay',
  support_contact: '',                 // jaise WhatsApp link ya email, pay page par dikhega
  invoice_minutes: '60',
  late_hours: '48',                    // expire hone ke baad bhi itne ghante tak TxID maan lo
  // Binance Pay (KYC wala Binance account): customer Pay ID par bhejta hai, Order ID daalta hai → Binance API se check
  net_binance: JSON.stringify({ on: false, pay_id: '', name: '', url: 'https://api.binance.com', api_key: '', api_secret: '' }),
  // network config JSON: on, address, url, header, key, confirmations
  net_trc20: JSON.stringify({ on: false, address: '', url: 'https://api.trongrid.io', header: 'TRON-PRO-API-KEY', key: '', confirmations: 19 }),
  net_bep20: JSON.stringify({ on: false, address: '', url: 'https://bsc-dataseed.bnbchain.org', header: '', key: '', confirmations: 15 }),
  net_polygon: JSON.stringify({ on: false, address: '', url: 'https://polygon-rpc.com', header: '', key: '', confirmations: 64 }),
};
const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);

function getSettings() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
}
const setSetting = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));

if (!db.prepare('SELECT COUNT(*) c FROM admins').get().c) {
  if (config.ADMIN_PASSWORD.length >= 8) {
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(config.ADMIN_USERNAME, hashPassword(config.ADMIN_PASSWORD));
    console.log(`[db] Admin "${config.ADMIN_USERNAME}" bana diya`);
  } else console.warn('[db] ADMIN_PASSWORD (8+ characters) environment variable daalo, phir restart karo — tab admin banega.');
}

module.exports = { db, plain, getSettings, setSetting };
