// Store ki apni API ke keys: gis_live_<random>. DB mein sirf hash; poori key sirf banate waqt ek baar dikhti hai.
const crypto = require('crypto');
const { db, plain } = require('../db');
const { fail, str } = require('./util');

const SCOPES = ['products:read', 'orders:read', 'orders:write'];
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function create(body) {
  const name = str(body.name, 60) || 'API key';
  let scopes = (Array.isArray(body.scopes) ? body.scopes : String(body.scopes || '').split(',')).map(s => String(s).trim()).filter(s => SCOPES.includes(s));
  if (!scopes.length) scopes = ['products:read'];
  const key = 'gis_live_' + crypto.randomBytes(24).toString('base64url');
  const id = Number(db.prepare('INSERT INTO api_keys (name, prefix, key_hash, scopes) VALUES (?,?,?,?)').run(name, key.slice(0, 14), sha(key), scopes.join(',')).lastInsertRowid);
  return { id, name, key, scopes };
}
const list = () => db.prepare('SELECT id, name, prefix, scopes, last_used_at, revoked, created_at FROM api_keys ORDER BY id DESC').all().map(plain).map(k => ({ ...k, scopes: k.scopes.split(','), revoked: !!k.revoked }));
const revoke = id => db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(id);

// Request se key → scopes check
const hits = new Map();
function auth(req, scope) {
  const h = String(req.headers.authorization || '');
  const key = h.startsWith('Bearer ') ? h.slice(7).trim() : String(req.headers['x-api-key'] || '').trim();
  if (!/^gis_live_[A-Za-z0-9_-]{20,}$/.test(key)) fail(401, 'API key chahiye: Authorization: Bearer gis_live_…');
  const row = plain(db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(sha(key)));
  if (!row || row.revoked) fail(401, 'API key galat ya band hai.');
  if (scope && !row.scopes.split(',').includes(scope)) fail(403, `Is key ke paas "${scope}" permission nahi hai.`);
  // 120 requests / minute per key
  const now = Date.now(), e = hits.get(row.id) || { n: 0, t: now };
  if (now - e.t > 60e3) { e.n = 0; e.t = now; }
  if (++e.n > 120) fail(429, 'Rate limit: 120 requests / minute.');
  hits.set(row.id, e);
  if (!row.last_used_at || now - Date.parse(row.last_used_at.replace(' ', 'T') + 'Z') > 60e3) db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return row;
}

module.exports = { SCOPES, create, list, revoke, auth };
