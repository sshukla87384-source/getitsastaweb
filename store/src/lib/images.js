// Product photo upload: browser se base64 aata hai, file ke asli bytes check karke disk par save hota hai
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { fail } = require('./util');

const MAX_BYTES = 3 * 1024 * 1024;

function detect(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}

function saveImage(dataUrl) {
  const m = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) fail(400, 'Photo JPG, PNG, WEBP ya GIF honi chahiye.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) fail(413, 'Photo 3 MB se chhoti rakho.');
  const ext = detect(buf);
  if (!ext) fail(400, 'Ye file sahi image nahi hai.');
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(config.UPLOAD_DIR, name), buf);
  return name;
}

// URL se photo (supplier import) — sirf http(s), 3 MB tak, asli image bytes
async function saveImageFromUrl(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return '';
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return '';
    const ext = detect(buf); if (!ext) return '';
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(config.UPLOAD_DIR, name), buf);
    return name;
  } catch { return ''; }
}

function deleteImage(name) {
  if (!name || !/^[\w.-]+$/.test(name)) return;
  fs.rm(path.join(config.UPLOAD_DIR, name), { force: true }, () => {});
}

module.exports = { saveImage, saveImageFromUrl, deleteImage };
