// Password bhool gaye? VPS par chalao:  npm run reset-admin -- admin NayaPassword123
require('./config');
const { hashPassword } = require('./password');
const { db } = require('./db');

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.log('Use: npm run reset-admin -- <username> <naya-password (8+ characters)>');
  process.exit(1);
}
const hash = hashPassword(password);
const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
if (existing) {
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, existing.id);
  db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(existing.id);
  console.log(`"${username}" ka password badal diya.`);
} else {
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`Naya admin "${username}" bana diya.`);
}
