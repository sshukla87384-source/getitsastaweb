// Email OTP: 6 digit, 10 minute, 5 galat try ke baad khatam
const crypto = require('crypto');
const { db } = require('../db');
const { fail } = require('./util');

const TTL = 10 * 60e3, MAX_TRIES = 5, MAX_PER_HOUR = 6;
const hash = (email, purpose, code) => crypto.createHash('sha256').update(`${email}|${purpose}|${code}`).digest('hex');

function issue(email, purpose) {
  const now = Date.now();
  db.prepare('DELETE FROM otps WHERE created_at < ?').run(now - 24 * 3600e3);
  const recent = db.prepare('SELECT COUNT(*) n FROM otps WHERE email = ? AND created_at > ?').get(email, now - 3600e3).n;
  if (recent >= MAX_PER_HOUR) fail(429, 'Bahut zyada OTP maange gaye. Ek ghante baad try karo.');
  const last = db.prepare('SELECT created_at FROM otps WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1').get(email, purpose);
  if (last && now - last.created_at < 45e3) fail(429, 'Naya OTP 45 second baad maango.');
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  db.prepare('DELETE FROM otps WHERE email = ? AND purpose = ?').run(email, purpose);
  db.prepare('INSERT INTO otps (email, purpose, code_hash, expires_at, created_at) VALUES (?,?,?,?,?)').run(email, purpose, hash(email, purpose, code), now + TTL, now);
  return code;
}

function verify(email, purpose, code) {
  const row = db.prepare('SELECT * FROM otps WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1').get(email, purpose);
  if (!row || row.expires_at < Date.now()) fail(400, 'OTP expire ho gaya. Naya OTP maango.');
  if (row.attempts >= MAX_TRIES) fail(429, 'Bahut galat try. Naya OTP maango.');
  const a = Buffer.from(hash(email, purpose, String(code || '').replace(/\D/g, ''))), b = Buffer.from(row.code_hash);
  if (!crypto.timingSafeEqual(a, b)) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    fail(400, `OTP galat hai. ${MAX_TRIES - row.attempts - 1} try bache.`);
  }
  db.prepare('DELETE FROM otps WHERE id = ?').run(row.id);
  return true;
}

module.exports = { issue, verify };
