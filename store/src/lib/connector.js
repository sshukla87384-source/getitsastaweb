// Koi bhi HTTP API: connection (URL + auth) + action (method, path, body template) → call, log, result nikaalo.
// Templates: {{order.email}}, {{item.api_ref}}, {{res.data.key}} … Filters: {{x | json}}, {{x | url}}, {{x | upper}}, {{x | lower}}, {{x | default:abc}}
const { db, plain } = require('../db');
const { fail, str } = require('./util');

const SAFE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const parse = (s, d) => { try { const v = JSON.parse(s || ''); return v ?? d; } catch { return d; } };

// a.b[0].c  ya  a.b.0.c
function get(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const k of String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

const jsonEsc = v => JSON.stringify(String(v ?? '')).slice(1, -1);
function applyFilter(v, f) {
  const [name, arg] = f.split(':').map(x => x.trim());
  switch (name) {
    case 'json': return JSON.stringify(v ?? null);
    case 'url': return encodeURIComponent(v ?? '');
    case 'upper': return String(v ?? '').toUpperCase();
    case 'lower': return String(v ?? '').toLowerCase();
    case 'default': return v === undefined || v === null || v === '' ? (arg ?? '') : v;
    case 'raw': return v;
    default: return v;
  }
}
// mode: 'json' (string ke andar safe), 'url' (path/query), 'text'
function render(tpl, ctx, mode = 'text') {
  return String(tpl || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const [path, ...filters] = expr.split('|').map(s => s.trim());
    let v = get(ctx, path);
    let explicit = false;
    for (const f of filters) { v = applyFilter(v, f); if (/^(json|url|raw)$/.test(f.split(':')[0].trim())) explicit = true; }
    if (v !== null && typeof v === 'object') v = JSON.stringify(v);
    if (explicit) return String(v ?? '');
    if (mode === 'json') return jsonEsc(v);
    if (mode === 'url') return encodeURIComponent(v ?? '');
    return String(v ?? '');
  });
}

const mask = s => (!s ? '' : s.length <= 6 ? '••••' : `${s.slice(0, 3)}••••${s.slice(-2)}`);
function integrationView(i) {
  return { id: i.id, name: i.name, base_url: i.base_url, auth_type: i.auth_type, auth_key: i.auth_key, auth_value: mask(i.auth_value), has_secret: !!i.auth_value,
    headers: parse(i.headers, {}), timeout_ms: i.timeout_ms, active: !!i.active, created_at: i.created_at };
}
const getIntegration = id => plain(db.prepare('SELECT * FROM integrations WHERE id = ?').get(id));
const getAction = id => plain(db.prepare('SELECT * FROM api_actions WHERE id = ?').get(id));

function buildUrl(base, path, query) {
  const p = String(path || '');
  let url = /^https?:\/\//i.test(p) ? p : String(base || '').replace(/\/+$/, '') + (p ? (p.startsWith('/') || p.startsWith('?') ? p : '/' + p) : '');
  if (query) url += (url.includes('?') ? '&' : '?') + query;
  if (!/^https?:\/\//i.test(url)) fail(400, 'API URL http:// ya https:// se shuru hona chahiye.');
  return url;
}

// Secret ko logs se hatao
function redact(text, secrets) {
  let t = String(text || '');
  for (const s of secrets) if (s && s.length >= 4) t = t.split(s).join('••••');
  return t.length > 4000 ? t.slice(0, 4000) + '…' : t;
}

function logCall(row) {
  db.prepare(`INSERT INTO api_logs (integration_id, action_id, kind, method, url, status, ms, ok, req, res, error, ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.integration_id || null, row.action_id || null, row.kind || '', row.method || '', row.url || '', row.status || null, row.ms || 0, row.ok ? 1 : 0, row.req || '', row.res || '', row.error || '', row.ref || '');
}
// 3000 se zyada logs → purane hatao
setInterval(() => { try { db.prepare('DELETE FROM api_logs WHERE id <= (SELECT id FROM api_logs ORDER BY id DESC LIMIT 1 OFFSET 3000)').run(); } catch {} }, 3600e3).unref();

// Asli call
async function request(integration, { method = 'GET', path = '', headers = {}, body = '', ctx = {}, kind = 'custom', actionId = null, ref = '' } = {}) {
  const i = integration;
  if (!i) fail(404, 'API connection nahi mila.');
  if (!i.active) fail(400, `"${i.name}" connection band hai.`);
  method = String(method || 'GET').toUpperCase();
  if (!SAFE_METHODS.includes(method)) fail(400, 'Method GET, POST, PUT, PATCH ya DELETE ho.');
  const h = { Accept: 'application/json, text/plain, */*', 'User-Agent': 'GetItSasta/3 (+store)' };
  for (const [k, v] of Object.entries(parse(i.headers, {}))) h[k] = render(v, ctx).replace(/[\r\n]/g, '');
  for (const [k, v] of Object.entries(typeof headers === 'string' ? parse(headers, {}) : headers || {})) h[k] = render(v, ctx).replace(/[\r\n]/g, '');
  let query = '';
  if (i.auth_type === 'bearer') h.Authorization = `Bearer ${i.auth_value}`;
  else if (i.auth_type === 'header') h[i.auth_key || 'X-API-Key'] = i.auth_value;
  else if (i.auth_type === 'basic') h.Authorization = 'Basic ' + Buffer.from(`${i.auth_key}:${i.auth_value}`).toString('base64');
  else if (i.auth_type === 'query') query = `${encodeURIComponent(i.auth_key || 'key')}=${encodeURIComponent(i.auth_value)}`;
  const url = buildUrl(i.base_url, render(path, ctx, 'url').replace(/%2F/gi, '/'), query);
  let payload;
  if (body && method !== 'GET') {
    const looksJson = /^\s*[[{]/.test(body);
    payload = render(body, ctx, looksJson ? 'json' : 'text');
    if (looksJson && !Object.keys(h).some(k => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    if (!looksJson && !Object.keys(h).some(k => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const secrets = [i.auth_value];
  const t0 = Date.now();
  let status = 0, text = '', data = null, error = '';
  try {
    const r = await fetch(url, { method, headers: h, body: payload, redirect: 'follow', signal: AbortSignal.timeout(Math.min(60000, Math.max(2000, i.timeout_ms || 15000))) });
    status = r.status;
    const buf = Buffer.from(await r.arrayBuffer());
    text = buf.subarray(0, 2 * 1024 * 1024).toString('utf8');
    data = parse(text, null);
  } catch (e) { error = e.name === 'TimeoutError' ? 'Timeout — API ne time par jawab nahi diya' : e.message; }
  const ms = Date.now() - t0;
  const ok = !error && status >= 200 && status < 300;
  logCall({ integration_id: i.id, action_id: actionId, kind, method, url: redact(url, secrets), status, ms, ok, ref,
    req: redact(payload || '', secrets), res: redact(text, secrets), error: redact(error || (ok ? '' : `HTTP ${status}`), secrets) });
  return { ok, status, data, text, error: error || (ok ? '' : `HTTP ${status}${data?.message ? ` — ${String(data.message).slice(0, 200)}` : data?.error ? ` — ${String(typeof data.error === 'string' ? data.error : JSON.stringify(data.error)).slice(0, 200)}` : ''}`), ms, url: redact(url, secrets) };
}

// Action chalao: success check + result nikaalo
async function runAction(action, ctx, { kind, ref } = {}) {
  const a = typeof action === 'object' ? action : getAction(action);
  if (!a) fail(404, 'API action nahi mila.');
  const i = getIntegration(a.integration_id);
  const r = await request(i, { method: a.method, path: a.path, headers: a.headers, body: a.body, ctx, kind: kind || a.purpose, actionId: a.id, ref });
  const res = r.data ?? r.text;
  let ok = r.ok;
  if (ok && a.ok_path) {
    const v = get(res, a.ok_path);
    ok = a.ok_value !== '' ? String(v) === a.ok_value : !!v && v !== 'false' && v !== 0;
    if (!ok) r.error = `Response mein ${a.ok_path} = ${JSON.stringify(v)}${a.ok_value !== '' ? ` (chahiye: ${a.ok_value})` : ''}`;
  }
  const full = { ...ctx, res, status: r.status };
  const result = ok ? (a.result_template ? render(a.result_template, full).trim() : typeof res === 'string' ? res.slice(0, 4000) : pretty(res)) : '';
  const supplierRef = ok && a.ref_path ? String(get(res, a.ref_path) ?? '') : '';
  return { ...r, ok, res, result, ref: supplierRef };
}

// object → "key: value" lines (customer ko padhne layak)
function pretty(v, prefix = '') {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  const lines = [];
  for (const [k, x] of Object.entries(v)) {
    if (x && typeof x === 'object') lines.push(pretty(x, `${prefix}${k}.`));
    else lines.push(`${prefix}${k}: ${x}`);
  }
  return lines.filter(Boolean).join('\n').slice(0, 4000);
}

// ---------- Admin CRUD ----------
function saveIntegration(body, id) {
  const old = id ? getIntegration(id) : null;
  if (id && !old) fail(404, 'Connection nahi mila.');
  const v = {
    name: str(body.name, 60), base_url: str(body.base_url, 300).replace(/\/+$/, ''),
    auth_type: ['none', 'bearer', 'header', 'basic', 'query'].includes(body.auth_type) ? body.auth_type : 'none',
    auth_key: str(body.auth_key, 80), timeout_ms: Math.min(60000, Math.max(2000, Number(body.timeout_ms) || 15000)), active: body.active === false ? 0 : 1,
  };
  if (!v.name) fail(400, 'Connection ka naam likho.');
  if (!/^https?:\/\/[^\s]+$/i.test(v.base_url)) fail(400, 'Base URL https:// se shuru hona chahiye (jaise https://api.supplier.com/v1).');
  let headers = body.headers ?? {};
  if (typeof headers === 'string') { headers = headers.trim() ? parse(headers, null) : {}; if (headers === null) fail(400, 'Headers sahi JSON nahi hai. Jaise: {"Accept-Language": "en"}'); }
  // secret: naya diya to badlo, warna purana rakho
  const secret = body.auth_value !== undefined && body.auth_value !== '' && !String(body.auth_value).includes('••••') ? str(body.auth_value, 2000) : old?.auth_value || '';
  if (v.auth_type !== 'none' && !secret) fail(400, 'API key / token daalo (ya Auth "None" chuno).');
  if (old) db.prepare('UPDATE integrations SET name=?, base_url=?, auth_type=?, auth_key=?, auth_value=?, headers=?, timeout_ms=?, active=? WHERE id=?')
    .run(v.name, v.base_url, v.auth_type, v.auth_key, secret, JSON.stringify(headers), v.timeout_ms, v.active, id);
  else id = Number(db.prepare('INSERT INTO integrations (name, base_url, auth_type, auth_key, auth_value, headers, timeout_ms, active) VALUES (?,?,?,?,?,?,?,?)')
    .run(v.name, v.base_url, v.auth_type, v.auth_key, secret, JSON.stringify(headers), v.timeout_ms, v.active).lastInsertRowid);
  return integrationView(getIntegration(id));
}

function saveAction(body, id) {
  const old = id ? getAction(id) : null;
  if (id && !old) fail(404, 'Action nahi mila.');
  const integration_id = Number(body.integration_id || old?.integration_id);
  if (!getIntegration(integration_id)) fail(400, 'Pehle connection chuno.');
  const jsonField = (v, label) => { if (v === undefined || v === null || v === '') return '{}'; if (typeof v === 'object') return JSON.stringify(v); const p = parse(v, null); if (p === null) fail(400, `${label} sahi JSON nahi hai.`); return JSON.stringify(p); };
  const a = {
    integration_id, name: str(body.name, 80), purpose: ['fulfil', 'import', 'custom'].includes(body.purpose) ? body.purpose : 'custom',
    method: SAFE_METHODS.includes(String(body.method).toUpperCase()) ? String(body.method).toUpperCase() : 'POST',
    path: str(body.path, 500), headers: jsonField(body.headers, 'Headers'), body: str(body.body, 8000),
    ok_path: str(body.ok_path, 120), ok_value: str(body.ok_value, 120), result_template: str(body.result_template, 4000), ref_path: str(body.ref_path, 120),
    list_path: str(body.list_path, 120), map: jsonField(body.map, 'Mapping'), options: jsonField(body.options, 'Options'),
  };
  if (!a.name) fail(400, 'Action ka naam likho.');
  if (a.body && /^\s*[[{]/.test(a.body)) {
    // template hatake JSON check (placeholders ko dummy se badal ke)
    const probe = a.body.replace(/"\{\{[^}]+\}\}"/g, '"x"').replace(/\{\{[^}]+\}\}/g, '0');
    if (parse(probe, null) === null) fail(400, 'Body sahi JSON nahi lag rahi. Text values ko "{{order.email}}" jaise quotes mein rakho.');
  }
  const cols = Object.keys(a);
  if (old) db.prepare(`UPDATE api_actions SET ${cols.map(c => `${c}=?`).join(', ')} WHERE id=?`).run(...cols.map(c => a[c]), id);
  else id = Number(db.prepare(`INSERT INTO api_actions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => a[c])).lastInsertRowid);
  return actionView(getAction(id));
}
const actionView = a => ({ ...a, headers: parse(a.headers, {}), map: parse(a.map, {}), options: parse(a.options, {}) });

// Test context (dummy order) — admin "Test" button ke liye
function sampleCtx(overrides = {}) {
  const { baseUrl } = require('./orders');
  return {
    order: { code: 'GIS-TEST123', email: 'test@example.com', name: 'Test Customer', phone: '+919876543210', total: 499, currency: 'INR', created_at: new Date().toISOString() },
    item: { product_name: 'Test Product', plan_label: '1 Month', qty: 1, price: 499, plan_id: 0, api_ref: 'SKU-TEST', days: 30 },
    idem: 'GIS-TEST123-0-1', store: { url: baseUrl(), name: 'Get It Sasta' }, now: new Date().toISOString(), ...overrides,
  };
}

module.exports = { get, render, request, runAction, pretty, saveIntegration, saveAction, integrationView, actionView, getIntegration, getAction, sampleCtx, parse, mask };
