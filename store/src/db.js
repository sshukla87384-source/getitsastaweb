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

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#5A2DF4',
  tag TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  price INTEGER NOT NULL,
  mrp INTEGER NOT NULL,
  days INTEGER NOT NULL DEFAULT 0,
  delivery TEXT NOT NULL DEFAULT 'manual',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  order_item_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS customer_sessions (
  token TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  utr TEXT,
  delivery TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  plan_label TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON otps(email, purpose);
CREATE TABLE IF NOT EXISTS crypto_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL,
  tx TEXT NOT NULL,
  from_addr TEXT NOT NULL DEFAULT '',
  to_addr TEXT NOT NULL DEFAULT '',
  amount_micro INTEGER NOT NULL,
  ts INTEGER NOT NULL DEFAULT 0,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_tx ON crypto_transfers(network, tx);
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'percent',
  value INTEGER NOT NULL,
  min_total INTEGER NOT NULL DEFAULT 0,
  max_discount INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
`);

// ---- Purane database mein naye columns jodna (safe migration) ----
function addColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('products', 'details', "TEXT NOT NULL DEFAULT ''");
addColumn('products', 'image', "TEXT NOT NULL DEFAULT ''");
addColumn('plans', 'days', 'INTEGER NOT NULL DEFAULT 0');
addColumn('plans', 'delivery', "TEXT NOT NULL DEFAULT 'manual'");
addColumn('plans', 'price_usdt', 'REAL NOT NULL DEFAULT 0');   // crypto ka alag price (0 = ₹ rate se)
addColumn('order_items', 'usdt_micro', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'currency', "TEXT NOT NULL DEFAULT 'INR'");   // customer ne kis currency mein dekha (INR = UPI, baaki = USD/USDT)
addColumn('orders', 'lang', "TEXT NOT NULL DEFAULT ''");
addColumn('coupons', 'email', "TEXT NOT NULL DEFAULT ''");         // sirf is email ke liye (newsletter coupon)
addColumn('coupons', 'first_order', 'INTEGER NOT NULL DEFAULT 0'); // sirf pehle order par
addColumn('coupons', 'note', "TEXT NOT NULL DEFAULT ''");
addColumn('plans', 'api_action_id', 'INTEGER');                      // delivery = 'api' → is action se supplier se mangwao
addColumn('plans', 'api_ref', "TEXT NOT NULL DEFAULT ''");          // supplier ka product / SKU id
addColumn('plans', 'api_stock', 'INTEGER');                         // supplier ka stock (NULL = unlimited)
addColumn('plans', 'api_cost', 'REAL');                             // supplier ki keemat (sync se)
addColumn('products', 'source', "TEXT NOT NULL DEFAULT ''");        // '' | csv | api:<action id>
addColumn('order_items', 'api_status', "TEXT NOT NULL DEFAULT ''"); // '' | pending | ok | failed
addColumn('order_items', 'api_tries', 'INTEGER NOT NULL DEFAULT 0');
addColumn('order_items', 'api_error', "TEXT NOT NULL DEFAULT ''");
addColumn('order_items', 'api_ref', "TEXT NOT NULL DEFAULT ''");
addColumn('customers', 'ref_code', "TEXT NOT NULL DEFAULT ''");   // REF-XXXXXX (pehli baar account dashboard kholne par banta hai)
db.exec(`
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',     -- active | unsubscribed
  token TEXT NOT NULL,
  coupon_code TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'popup',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  unsub_at TEXT
);
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL,
  referrer_email TEXT NOT NULL,
  friend_email TEXT NOT NULL UNIQUE,       -- ek dost sirf ek baar gina jaata hai
  order_id INTEGER NOT NULL,
  order_total INTEGER NOT NULL DEFAULT 0,
  reward_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                 -- C4821 (Telegram par dikhta hai)
  token TEXT NOT NULL UNIQUE,                -- visitor ka secret
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  customer_id INTEGER,
  lang TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'bot',        -- bot | human | closed
  unread_agent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,                      -- user | bot | agent | system
  text TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',             -- bot ke quick-reply chips (JSON)
  tg_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_msgs ON chat_messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_tg ON chat_messages(tg_message_id);
CREATE TABLE IF NOT EXISTS integrations (            -- koi bhi bahari API (supplier, SMS, CRM…)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'none',              -- none | bearer | header | basic | query
  auth_key TEXT NOT NULL DEFAULT '',                   -- header / query param ka naam, ya basic ka username
  auth_value TEXT NOT NULL DEFAULT '',                 -- secret (admin ko kabhi poora nahi dikhta)
  headers TEXT NOT NULL DEFAULT '{}',
  timeout_ms INTEGER NOT NULL DEFAULT 15000,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_actions (             -- ek API call ka template
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'fulfil',              -- fulfil | import | custom
  method TEXT NOT NULL DEFAULT 'POST',
  path TEXT NOT NULL DEFAULT '',
  headers TEXT NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '',
  ok_path TEXT NOT NULL DEFAULT '',                    -- response mein ye field sach ho tabhi success
  ok_value TEXT NOT NULL DEFAULT '',
  result_template TEXT NOT NULL DEFAULT '',            -- customer ko kya dikhe, jaise "Email: {{res.data.email}}"
  ref_path TEXT NOT NULL DEFAULT '',                   -- supplier ka order id
  list_path TEXT NOT NULL DEFAULT '',                  -- import: products ki list kahan hai
  map TEXT NOT NULL DEFAULT '{}',                      -- import: field mapping
  options TEXT NOT NULL DEFAULT '{}',                  -- import: markup, sync, fulfil action…
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER, action_id INTEGER, kind TEXT NOT NULL DEFAULT '',
  method TEXT, url TEXT, status INTEGER, ms INTEGER, ok INTEGER NOT NULL DEFAULT 0,
  req TEXT NOT NULL DEFAULT '', res TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '*',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',              -- pending | sending | ok | failed
  tries INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
  last_code INTEGER, last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_whd_due ON webhook_deliveries(status, next_at);
CREATE TABLE IF NOT EXISTS bots (                    -- Telegram bots
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT 'alerts',                -- alerts,support,admin
  active INTEGER NOT NULL DEFAULT 1,
  tg_offset INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_keys (                -- store ki apni API
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT 'products:read',
  last_used_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mail_stats (period TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (period, kind));
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  recipients INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addColumn('orders', 'usdt_micro', 'INTEGER NOT NULL DEFAULT 0');   // order ka USDT total (coupon ke baad)
addColumn('orders', 'customer_id', 'INTEGER REFERENCES customers(id) ON DELETE SET NULL');
addColumn('orders', 'subtotal', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'discount', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'coupon_code', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'pay_method', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'gw_invoice', 'TEXT');     // crypto gateway invoice uuid
addColumn('orders', 'gw_url', 'TEXT');         // crypto payment page
addColumn('orders', 'gw_ref', 'TEXT');         // txid / payment ref
addColumn('orders', 'gw_amount', "TEXT NOT NULL DEFAULT ''");   // jaise "5.95 USD"
addColumn('orders', 'crypto_network', 'TEXT');
addColumn('orders', 'crypto_address', 'TEXT');
addColumn('orders', 'crypto_amount_micro', 'INTEGER');   // unique amount, 1 USDT = 1,000,000
addColumn('orders', 'crypto_base_micro', 'INTEGER');
addColumn('orders', 'crypto_rate', 'REAL');
addColumn('orders', 'crypto_expires', 'INTEGER');
addColumn('customers', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
addColumn('customer_sessions', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
addColumn('customer_sessions', 'user_agent', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'paid_at', 'TEXT');
addColumn('orders', 'delivered_at', 'TEXT');
addColumn('order_items', 'product_id', 'INTEGER');
addColumn('order_items', 'plan_id', 'INTEGER');
addColumn('order_items', 'days', 'INTEGER NOT NULL DEFAULT 0');
addColumn('order_items', 'delivery_mode', "TEXT NOT NULL DEFAULT 'manual'");
addColumn('order_items', 'auto_content', "TEXT NOT NULL DEFAULT ''");
addColumn('order_items', 'expires_at', 'TEXT');

db.exec(`
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_utr ON orders(utr) WHERE utr IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_gw ON orders(gw_invoice) WHERE gw_invoice IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_crypto ON orders(crypto_network, crypto_amount_micro) WHERE crypto_network IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_free ON stock(plan_id, order_item_id);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
`);

// ---- Default settings ----
const DEFAULT_SETTINGS = {
  store_name: 'Get It Sasta',
  tagline: 'Premium tools. Sasta price.',
  announcement: 'Same-day delivery • UPI payment • WhatsApp support',
  upi_id: 'yourname@upi',
  upi_name: 'Get It Sasta',
  upi_qr: '',
  whatsapp: '919999999999',
  support_email: 'support@getitsasta.com',
  pay_upi: '1',          // BharatPe / UPI QR + UTR on/off
  pay_crypto: '1',       // Get It Sasta Pay (alag app) se crypto on/off
  usdt_inr_rate: '90',   // 1 USDT = kitne ₹ — jis plan ka USDT price khaali hai uske liye
  upi_label: 'BharatPe UPI',
  bharatpe_auto: '0',
  // Currency / language
  currencies_on: 'INR,USD,EUR,GBP,AED,SAR,CAD,AUD,SGD',
  fx_rates: '',          // 1 USD = kitna (auto roz update), JSON
  fx_at: '0',
  default_lang: 'en',
  // Newsletter
  newsletter_on: '1',
  newsletter_pct: '10',          // pehle order par kitna % off
  newsletter_max_off: '0',       // max discount ₹ (0 = koi limit nahi)
  newsletter_delay: '25',        // kitne second baad popup
  newsletter_days: '30',         // coupon kitne din chalega
  // Email budget (saal bhar mein)
  mail_year_cap: '50000',
  mail_reserve: '3000',          // marketing yahan tak ruk jaati hai — itne OTP / order mails ke liye bache rahte hain
  mail_otp: '1', mail_admin_otp: '1', mail_order_placed: '0', mail_order_paid: '1', mail_order_delivered: '1',
  mail_welcome: '1', mail_campaign: '1', mail_referral: '1',
  ref_on: '1', ref_friend_pct: '10', ref_reward_pct: '10', ref_reward_max: '0', ref_days: '60',   // referral: dost ko % off, refer karne wale ko reward code
  otp_login: '1',        // customer email OTP login on/off
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

// ---- Seed text + default language: English (sirf jo admin ne badla nahi) ----
const SEED_DETAILS = "What you get:\n• All premium features\n• Activation on your own account\n• Warranty: replacement for the full plan period\n\nDelivery: on your order page and by email once payment is verified.";

// ---- Pehli baar sample products ----
const daysFromLabel = l => { const m = String(l).match(/(\d+)\s*(day|month|year)/i); if (!m) return 0; const n = +m[1]; return /day/i.test(m[2]) ? n : /month/i.test(m[2]) ? (n % 12 === 0 ? (n / 12) * 365 : n * 30) : n * 365; };
if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
  const seed = [
    ['ChatGPT Plus', 'AI Tools', 'Latest GPT models, image generation and file analysis.', '#10A37F', 'Bestseller', [['1 Month', 1559, 1999], ['3 Months', 4679, 5997]]],
    ['OpenAI API Credits', 'AI Tools', 'API usage credits for developers.', '#1F2937', '', [['$5 Credit', 469, 600], ['$10 Credit', 939, 1200], ['$25 Credit', 2349, 3000]]],
    ['Gemini Advanced', 'AI Tools', "Google's most capable AI, with 2TB storage.", '#4C6FFF', '', [['1 Month', 1529, 1950], ['12 Months', 18259, 23400]]],
    ['Perplexity Pro', 'AI Tools', 'AI search with cited sources.', '#20808D', '', [['1 Month', 1329, 1700], ['12 Months', 13269, 17000]]],
    ['CapCut Pro', 'Video Editing', 'Premium effects, no watermark, cloud storage.', '#111111', 'Popular', [['1 Month', 469, 599], ['6 Months', 2809, 3594], ['12 Months', 5609, 7188]]],
    ['Filmora', 'Video Editing', 'Easy video editor with AI features.', '#0BB9A0', '', [['12 Months', 3899, 4999]]],
    ['Canva Pro', 'Design', 'Premium templates, background remover, brand kit.', '#7D2AE8', 'Popular', [['1 Month', 389, 499], ['12 Months', 3119, 3999]]],
    ['Adobe Creative Cloud', 'Design', 'Photoshop, Premiere, Illustrator and more.', '#DA1F26', '', [['1 Month', 3299, 4230], ['12 Months', 39599, 50760]]],
    ['Grammarly Premium', 'Productivity', 'Grammar, tone and clarity suggestions.', '#15C39A', '', [['1 Month', 1879, 2400], ['12 Months', 9369, 12000]]],
    ['Microsoft 365', 'Productivity', 'Word, Excel, PowerPoint + 1TB OneDrive.', '#D83B01', '', [['12 Months', 3829, 4899]]],
    ['Spotify Premium', 'Entertainment', 'Ad-free music, offline downloads.', '#1DB954', '', [['3 Months', 279, 357], ['12 Months', 1119, 1428]]],
    ['YouTube Premium', 'Entertainment', 'No ads, background play, YouTube Music.', '#FF0033', '', [['1 Month', 119, 149], ['12 Months', 1169, 1490]]],
  ];
  const details = SEED_DETAILS;
  const insP = db.prepare('INSERT INTO products (name, category, description, details, color, tag, sort) VALUES (?,?,?,?,?,?,?)');
  const insPl = db.prepare('INSERT INTO plans (product_id, label, price, mrp, days, sort) VALUES (?,?,?,?,?,?)');
  db.transaction(() => {
    seed.forEach(([n, c, d, col, tag, plans], i) => {
      const id = Number(insP.run(n, c, d, details, col, tag, i).lastInsertRowid);
      plans.forEach(([l, p, m], j) => insPl.run(id, l, p, m, daysFromLabel(l), j));
    });
  })();
  console.log('[db] Sample products add kiye');
}

if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_en_v1'").get()) {
  const OLD_DETAILS = 'Kya milega:\n• Poore premium features\n• Aapke apne account par activation\n• Warranty: poore plan tak replacement\n\nDelivery: payment verify hone ke baad order page aur email par.';
  const DESC = {"GPT ke latest models, image banana, file analysis.": "Latest GPT models, image generation and file analysis.", "Developers ke liye API usage credits.": "API usage credits for developers.", "Google ka advanced AI, 2TB storage ke saath.": "Google's most capable AI, with 2TB storage.", "AI search, sources ke saath answers.": "AI search with cited sources.", "Easy video editor, AI features ke saath.": "Easy video editor with AI features.", "Photoshop, Premiere, Illustrator sab.": "Photoshop, Premiere, Illustrator and more.", "Grammar, tone aur clarity suggestions.": "Grammar, tone and clarity suggestions."};
  db.transaction(() => {
    db.prepare('UPDATE products SET details = ? WHERE details = ?').run(SEED_DETAILS, OLD_DETAILS);
    for (const [a, b] of Object.entries(DESC)) db.prepare('UPDATE products SET description = ? WHERE description = ?').run(b, a);
    db.prepare("UPDATE settings SET value = 'en' WHERE key = 'default_lang' AND value = 'hinglish'").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_en_v1', '1')").run();
  })();
}

// ---- Pehla admin (.env / environment variable se) ----
if (db.prepare('SELECT COUNT(*) c FROM admins').get().c === 0) {
  if (config.ADMIN_PASSWORD.length < 8) {
    console.warn('[db] ADMIN_PASSWORD set karo (kam se kam 8 characters) aur app restart karo — tabhi admin login banega.');
  } else {
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(config.ADMIN_USERNAME, hashPassword(config.ADMIN_PASSWORD));
    console.log(`[db] Admin "${config.ADMIN_USERNAME}" bana diya`);
  }
}

// ---- Helpers ----
const plain = r => (r ? { ...r } : r);
function getSettings() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
}

function listProducts({ includeInactive = false } = {}) {
  const products = db.prepare(`SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`).all().map(plain);
  const plans = db.prepare(`SELECT pl.*, (SELECT COUNT(*) FROM stock s WHERE s.plan_id = pl.id AND s.order_item_id IS NULL) AS stock_left
    FROM plans pl ORDER BY pl.sort, pl.id`).all().map(plain);
  const byProduct = {};
  for (const pl of plans) (byProduct[pl.product_id] ||= []).push(pl);
  return products.map(p => ({ ...p, active: !!p.active, plans: byProduct[p.id] || [] }));
}


// ---- Ek baar: purane sample prices (bahut sasta) ko naye (~22% off MRP) se badlo ----
// Sirf wahi plans badalte hain jinka price abhi bhi purana sample price hai — admin ne jo badla, woh nahi chhuta.
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_prices_v2'").get()) {
  const OLD = [
  ['ChatGPT Plus', '1 Month', 399],
  ['ChatGPT Plus', '3 Months', 1099],
  ['OpenAI API Credits', '$5 Credit', 549],
  ['OpenAI API Credits', '$10 Credit', 1049],
  ['OpenAI API Credits', '$25 Credit', 2549],
  ['Gemini Advanced', '1 Month', 299],
  ['Gemini Advanced', '12 Months', 2999],
  ['Perplexity Pro', '1 Month', 249],
  ['Perplexity Pro', '12 Months', 1999],
  ['CapCut Pro', '1 Month', 149],
  ['CapCut Pro', '6 Months', 699],
  ['CapCut Pro', '12 Months', 1199],
  ['Filmora', '12 Months', 1499],
  ['Canva Pro', '1 Month', 99],
  ['Canva Pro', '12 Months', 799],
  ['Adobe Creative Cloud', '1 Month', 899],
  ['Adobe Creative Cloud', '12 Months', 8999],
  ['Grammarly Premium', '1 Month', 299],
  ['Grammarly Premium', '12 Months', 1999],
  ['Microsoft 365', '12 Months', 1499],
  ['Spotify Premium', '3 Months', 299],
  ['Spotify Premium', '12 Months', 999],
  ['YouTube Premium', '1 Month', 99],
  ['YouTube Premium', '12 Months', 999],
  ];
  const upd = db.prepare(`UPDATE plans SET price = CAST(mrp * 0.78 / 10 AS INTEGER) * 10 + 9
    WHERE label = ? AND price = ? AND product_id IN (SELECT id FROM products WHERE name = ?)`);
  let n = 0;
  db.transaction(() => {
    for (const [name, label, price] of OLD) n += Number(upd.run(label, price, name).changes);
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_prices_v2', '1')").run();
  })();
  if (n) console.log(`[db] ${n} sample plans ke price ~22% off MRP kar diye`);
}

module.exports = { db, plain, getSettings, listProducts, DEFAULT_SETTINGS, daysFromLabel };
