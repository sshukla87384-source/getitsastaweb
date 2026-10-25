// Database ka safe backup. CLI: npm run backup   |   Admin panel se bhi download hota hai.
const fs = require('fs');
const path = require('path');
const config = require('./config');

function makeBackup(db, keep = 14) {
  const stamp = new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const out = path.join(config.BACKUP_DIR, `store-${stamp}.db`);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(config.BACKUP_DIR).filter(f => /^store-.*\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(config.BACKUP_DIR, f));
  return out;
}

module.exports = { makeBackup };

if (require.main === module) {
  const { db } = require('./db');
  console.log('Backup ban gaya:', makeBackup(db));
}
