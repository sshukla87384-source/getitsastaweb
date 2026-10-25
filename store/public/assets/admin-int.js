// Admin → Integrations: API connections + actions, Telegram bots, webhooks, store API keys, logs. Aur Products → CSV import.
(() => {
  const { $, $$, esc, toast, copy, fmtTime, icons } = GIS;
  const A = () => GIS.admin;
  let D = null, pane = 'apis', cur = null;

  const PH = [
    ['{{order.code}}', 'Order ID'], ['{{order.email}}', 'Customer email'], ['{{order.name}}', 'Naam'], ['{{order.phone}}', 'Phone'], ['{{order.total}}', 'Total ₹'],
    ['{{item.api_ref}}', 'Supplier SKU'], ['{{item.qty}}', 'Quantity'], ['{{item.product_name}}', 'Product'], ['{{item.plan_label}}', 'Plan'], ['{{idem}}', 'Unique ID (duplicate se bachao)'],
  ];
  const AUTH = { none: 'None', bearer: 'Bearer token', header: 'Header (apna naam)', basic: 'Basic (user + password)', query: 'URL query param' };
  const PURPOSE = { fulfil: 'Order delivery', import: 'Product import', custom: 'Custom' };
  const ROLE = { alerts: ['Alerts', 'Naye order, payment, problem ke messages'], support: ['Live chat', 'Website chat ke "Talk to a person" messages; Reply se jawab'], admin: ['Admin commands', '/orders, /paid, /deliver, /stats… Telegram se store chalao'] };
  const EVENT_HELP = { 'order.created': 'Order bana', 'order.paid': 'Payment mila', 'order.delivered': 'Deliver hua', 'order.cancelled': 'Cancel hua', 'chat.human': 'Customer ne insaan maanga', 'chat.message': 'Team ne chat reply kiya', 'subscriber.created': 'Newsletter join', 'referral.reward': 'Referral reward' };
  const SCOPE_HELP = { 'products:read': 'Products + price padhna', 'orders:read': 'Orders padhna', 'orders:write': 'Order banana / deliver karna' };

  const pre = (o, cls = '') => `<pre class="int-pre ${cls}">${esc(typeof o === 'string' ? o : JSON.stringify(o, null, 2))}</pre>`;
  const jsonTxt = v => (v && typeof v === 'object' && Object.keys(v).length ? JSON.stringify(v, null, 2) : '');
  const ago = t => (t ? fmtTime(typeof t === 'number' ? new Date(t).toISOString() : t) : '—');

  async function load() {
    try { D = await A().call('/api/admin/integrations'); } catch (e) { toast(e.message); return; }
    render();
  }
  function render() {
    $$('#intSeg [data-int]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.int === pane)));
    const body = $('#intBody');
    body.innerHTML = ({ apis: paneApis, bots: paneBots, hooks: paneHooks, keys: paneKeys, logs: () => '<div class="int-empty">Load ho raha hai…</div>' })[pane]();
    if (pane === 'logs') loadLogs();
    wirePane(body);
  }
  $('#intSeg').onclick = e => { const b = e.target.closest('[data-int]'); if (b) { pane = b.dataset.int; render(); } };

  // ================= API connections =================
  function paneApis() {
    const acts = id => D.actions.filter(a => a.integration_id === id);
    return `<div class="int-head"><div><h2 class="h3 m0">API connections</h2><p class="muted m0 small">Har supplier / website ki API ek connection. Uske andar actions: order par delivery, product import, ya custom call.</p></div>
        <button class="btn btn-primary" type="button" data-new-conn>+ API connection</button></div>
      ${D.connections.length ? '' : `<div class="int-steps"><ol>
        <li><b>Connection jodo</b> — supplier ka base URL (jaise https://api.supplier.com/v1) aur API key.</li>
        <li><b>"Product import" action</b> — unki product list ka path + mapping. Ek click mein saare products, price par aapka markup, stock sync.</li>
        <li><b>"Order delivery" action</b> — payment aate hi supplier ko order bhejo; jo login / key mile wo customer ko turant.</li></ol></div>`}
      <div class="int-list">${D.connections.map(c => `<article class="int-card">
        <div class="int-card-head"><div><strong>${esc(c.name)}</strong> ${c.active ? '' : '<span class="st off">Off</span>'}<br><code class="small">${esc(c.base_url)}</code> <span class="muted small">• ${esc(AUTH[c.auth_type])}${c.has_secret ? ' ' + esc(c.auth_value) : ''}</span></div>
          <div class="row-gap"><button class="btn btn-ghost sm" type="button" data-edit-conn="${c.id}">Edit / Test</button><button class="btn btn-ink sm" type="button" data-new-act="${c.id}">+ Action</button></div></div>
        ${acts(c.id).length ? `<table class="tbl int-tbl"><tbody>${acts(c.id).map(a => `<tr>
          <td><strong>${esc(a.name)}</strong><br><span class="pur ${a.purpose}">${PURPOSE[a.purpose]}</span></td>
          <td><code class="small">${esc(a.method)} ${esc(a.path || '/')}</code>${a.purpose === 'import' && a.options?.sync_minutes ? `<br><small class="muted">Auto-sync har ${a.options.sync_minutes} min • last ${ago(a.last_run_at)}</small>` : a.purpose === 'import' ? `<br><small class="muted">Last run ${ago(a.last_run_at)}</small>` : ''}</td>
          <td class="r"><div class="row-gap end">${a.purpose === 'import' ? `<button class="btn btn-brand sm" type="button" data-import="${a.id}">Import / Sync</button>` : ''}<button class="btn btn-ghost sm" type="button" data-edit-act="${a.id}">Edit</button></div></td></tr>`).join('')}</tbody></table>`
          : '<p class="muted small m0">Abhi koi action nahi. "+ Action" se banao.</p>'}
      </article>`).join('')}</div>`;
  }

  function connForm(c = {}) {
    cur = { kind: 'conn', id: c.id };
    $('#intTitle').textContent = c.id ? `API: ${c.name}` : 'Nayi API connection';
    $('#intForm').innerHTML = `
      <div class="two"><label class="field">Naam<input id="ic_name" value="${esc(c.name || '')}" placeholder="Supplier X" maxlength="60"></label>
        <label class="field">Timeout (second)<input id="ic_timeout" type="number" min="2" max="60" value="${Math.round((c.timeout_ms || 15000) / 1000)}"></label></div>
      <label class="field">Base URL<input id="ic_url" value="${esc(c.base_url || '')}" placeholder="https://api.supplier.com/v1" inputmode="url"><small>Action ka path iske aage judta hai.</small></label>
      <div class="two"><label class="field">Auth<select id="ic_auth">${Object.entries(AUTH).map(([k, l]) => `<option value="${k}"${(c.auth_type || 'bearer') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field" id="ic_key_wrap"><span id="ic_key_lbl">Header naam</span><input id="ic_key" value="${esc(c.auth_key || '')}" placeholder="X-API-Key"></label></div>
      <label class="field" id="ic_val_wrap"><span id="ic_val_lbl">API key / token</span><input id="ic_val" type="password" autocomplete="off" placeholder="${c.has_secret ? esc(c.auth_value) + ' (badalna ho to naya daalo)' : 'sk_live_…'}"><small>Secret kabhi poora dikhaya nahi jaata, aur logs se hata diya jaata hai.</small></label>
      <label class="field">Extra headers (JSON, optional)<textarea id="ic_headers" class="mono-ta short" placeholder='{"Accept-Language": "en"}'>${esc(jsonTxt(c.headers))}</textarea></label>
      <label class="toggle"><input type="checkbox" id="ic_active" ${c.active === false ? '' : 'checked'}> Chalu</label>
      ${c.id ? `<div class="int-test"><strong>Test request</strong><div class="test-row"><select id="it_method"><option>GET</option><option>POST</option></select><input id="it_path" placeholder="/products" value="/"><button class="btn btn-ghost sm" type="button" id="it_go">Bhejo</button></div><div id="it_out"></div></div>` : ''}
      <p class="err" id="intErr" hidden></p>`;
    const sync = () => {
      const t = $('#ic_auth').value;
      $('#ic_key_wrap').hidden = !['header', 'basic', 'query'].includes(t); $('#ic_val_wrap').hidden = t === 'none';
      $('#ic_key_lbl').textContent = t === 'basic' ? 'Username' : t === 'query' ? 'Param naam (jaise key, api_key)' : 'Header naam (jaise X-API-Key)';
      $('#ic_val_lbl').textContent = t === 'basic' ? 'Password' : 'API key / token';
    };
    $('#ic_auth').onchange = sync; sync();
    $('#it_go')?.addEventListener('click', async () => {
      const out = $('#it_out'); out.innerHTML = '<p class="muted small">Bhej rahe hain…</p>';
      try { const r = await A().call(`/api/admin/integrations/connections/${c.id}/test`, { method: 'POST', body: { method: $('#it_method').value, path: $('#it_path').value } });
        out.innerHTML = `<p class="small ${r.ok ? 'ok-t' : 'err'}">${r.ok ? '✓' : '✗'} HTTP ${r.status || '—'} • ${r.ms} ms • <code>${esc(r.url)}</code>${r.error ? ' • ' + esc(r.error) : ''}</p>${pre(prettyBody(r.body))}`; }
      catch (e) { out.innerHTML = `<p class="err small">${esc(e.message)}</p>`; }
    });
    foot(c.id ? 'Connection hatao' : '', async () => {
      const body = { name: $('#ic_name').value, base_url: $('#ic_url').value, auth_type: $('#ic_auth').value, auth_key: $('#ic_key').value, auth_value: $('#ic_val').value, headers: $('#ic_headers').value, timeout_ms: Number($('#ic_timeout').value) * 1000, active: $('#ic_active').checked };
      const r = await A().call(c.id ? `/api/admin/integrations/connections/${c.id}` : '/api/admin/integrations/connections', { method: c.id ? 'PUT' : 'POST', body });
      toast('Connection save ho gaya'); await load(); connForm(D.connections.find(x => x.id === r.id));
    }, async () => { await A().call(`/api/admin/integrations/connections/${c.id}`, { method: 'DELETE', body: {} }); toast('Hata diya'); A().drawer('#intDrawer', false); load(); });
    A().drawer('#intDrawer', true); $('#ic_name').focus();
  }
  const prettyBody = t => { try { return JSON.stringify(JSON.parse(t), null, 2).slice(0, 6000); } catch { return String(t || '').slice(0, 6000) || '(khaali)'; } };

  function actForm(a) {
    const opts = { ...D.import_defaults, ...(a.options || {}) }, map = a.map || {};
    cur = { kind: 'act', id: a.id };
    $('#intTitle').textContent = a.id ? `Action: ${a.name}` : 'Naya action';
    const fulfils = D.actions.filter(x => x.purpose === 'fulfil');
    const mapF = [['id', 'Supplier ID / SKU *', 'sku'], ['product', 'Product naam *', 'name'], ['plan', 'Plan / variant', 'variant'], ['price', 'Price / cost *', 'price'], ['mrp', 'MRP', 'mrp'], ['stock', 'Stock', 'stock'], ['category', 'Category', 'category'], ['description', 'Description', 'description'], ['image', 'Photo URL', 'image'], ['days', 'Validity din', 'days'], ['active', 'Active? (true/false)', 'available']];
    $('#intForm').innerHTML = `
      <div class="two"><label class="field">Connection<select id="ia_conn">${D.connections.map(c => `<option value="${c.id}"${c.id === a.integration_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field">Naam<input id="ia_name" value="${esc(a.name || '')}" placeholder="Netflix order" maxlength="80"></label></div>
      <div class="field">Kaam<div class="seg pur-seg" id="ia_pur">${Object.entries(PURPOSE).map(([k, l]) => `<button type="button" data-p="${k}" aria-selected="${(a.purpose || 'fulfil') === k}">${l}</button>`).join('')}</div></div>
      <p class="muted small m0" id="ia_pur_help"></p>
      <div class="req-grid"><label class="field">Method<select id="ia_method">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => `<option${(a.method || 'POST') === m ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="field">Path<input id="ia_path" value="${esc(a.path || '')}" placeholder="/orders  ya  /products?category={{item.api_ref}}"></label></div>
      <label class="field">Headers (JSON, optional)<textarea id="ia_headers" class="mono-ta short" placeholder='{"X-Shop": "gis"}'>${esc(jsonTxt(a.headers))}</textarea></label>
      <label class="field" id="ia_body_wrap">Body<textarea id="ia_body" class="mono-ta" placeholder='{"sku": "{{item.api_ref}}", "quantity": {{item.qty}}, "email": "{{order.email}}", "reference": "{{idem}}"}'>${esc(a.body || '')}</textarea>
        <small>JSON ho to text values "quotes" mein rakho. Form body bhi chalegi: <code>key={{order.email}}&amp;qty={{item.qty}}</code></small></label>
      <div class="ph-chips" id="ia_ph">${PH.map(([p, l]) => `<button type="button" data-ph="${esc(p)}" title="${esc(l)}">${esc(p)}</button>`).join('')}</div>
      <fieldset class="int-fs" data-for="fulfil custom"><legend>Response se kya lena hai</legend>
        <div class="two"><label class="field">Success field (optional)<input id="ia_okp" value="${esc(a.ok_path || '')}" placeholder="status  ya  data.success"></label>
          <label class="field">Success value (optional)<input id="ia_okv" value="${esc(a.ok_value || '')}" placeholder="ok  (khaali = field sach ho)"></label></div>
        <label class="field">Customer ko kya dikhe<textarea id="ia_res" class="mono-ta short" placeholder="Email: {{res.account.email}}&#10;Password: {{res.account.password}}">${esc(a.result_template || '')}</textarea>
          <small>{{res.…}} = supplier ka jawab. Khaali chhodo to poora jawab "key: value" lines mein.</small></label>
        <div class="two"><label class="field">Supplier order ID field<input id="ia_ref" value="${esc(a.ref_path || '')}" placeholder="order_id"></label>
          <label class="toggle mt"><input type="checkbox" id="ia_unit" ${opts.per_unit ? 'checked' : ''}> Har quantity ke liye alag call</label></div>
      </fieldset>
      <fieldset class="int-fs" data-for="import"><legend>Product list mapping</legend>
        <label class="field">List kahan hai (path)<input id="ia_list" value="${esc(a.list_path || '')}" placeholder="data.items  (khaali = poora jawab hi list hai)"></label>
        <div class="map-grid">${mapF.map(([k, l, ph]) => `<label class="field">${l}<input data-map="${k}" value="${esc(map[k] || '')}" placeholder="${ph}"></label>`).join('')}</div>
      </fieldset>
      <fieldset class="int-fs" data-for="import"><legend>Price, stock aur sync</legend>
        <div class="three"><label class="field">Price kaise<select id="io_mode"><option value="markup"${opts.price_mode === 'markup' ? ' selected' : ''}>Cost + markup %</option><option value="same"${opts.price_mode === 'same' ? ' selected' : ''}>Jo supplier de</option></select></label>
          <label class="field">Markup %<input id="io_markup" type="number" min="0" max="500" value="${opts.markup_pct}"></label>
          <label class="field">Currency rate ×<input id="io_rate" type="number" min="0.0001" step="0.0001" value="${opts.cost_rate}"><small>USD cost → ₹ ke liye 90</small></label></div>
        <div class="three"><label class="field">MRP = price + %<input id="io_mrp" type="number" min="0" max="500" value="${opts.mrp_pct}"><small>MRP field na ho tab</small></label>
          <label class="field">Auto-sync<select id="io_sync">${[[0, 'Band'], [15, '15 min'], [30, '30 min'], [60, '1 ghanta'], [360, '6 ghante'], [1440, 'Roz']].map(([v, l]) => `<option value="${v}"${Number(opts.sync_minutes) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Default category<input id="io_cat" value="${esc(opts.default_category || 'Imported')}"></label></div>
        <label class="field">Naye plans ki delivery<select id="io_fulfil"><option value="">Manual (aap deliver karoge)</option>${fulfils.map(f => `<option value="${f.id}"${Number(opts.fulfil_action_id) === f.id ? ' selected' : ''}>API → ${esc(f.name)}</option>`).join('')}</select></label>
        <div class="checks">
          <label class="toggle"><input type="checkbox" id="io_round" ${opts.round9 ? 'checked' : ''}> Price ke aakhir mein 9 (₹299, ₹1,559)</label>
          <label class="toggle"><input type="checkbox" id="io_new" ${opts.create_new ? 'checked' : ''}> Naye products banao</label>
          <label class="toggle"><input type="checkbox" id="io_act" ${opts.activate_new ? 'checked' : ''}> Naye products turant Live (warna Hidden, aap dekh ke ON karo)</label>
          <label class="toggle"><input type="checkbox" id="io_up" ${opts.update_price ? 'checked' : ''}> Sync par price update karo</label>
          <label class="toggle"><input type="checkbox" id="io_st" ${opts.update_stock ? 'checked' : ''}> Sync par stock update karo</label>
          <label class="toggle"><input type="checkbox" id="io_miss" ${opts.out_of_stock_missing ? 'checked' : ''}> List se gayab item = out of stock</label>
        </div>
      </fieldset>
      ${a.id ? `<div class="int-test" data-for="fulfil custom"><strong>Test</strong><p class="muted small m0">⚠️ Asli API call jaayegi — supplier ke paas test/sandbox mode ho to wahi use karo, warna asli order ban sakta hai.</p>
          <div class="test-row"><input id="itx_sku" placeholder="Supplier SKU (item.api_ref)"><input id="itx_qty" type="number" min="1" value="1" class="qty-in"><button class="btn btn-ghost sm" type="button" id="itx_go">Test chalao</button></div><div id="itx_out"></div></div>
        <div class="int-test" data-for="import"><strong>Preview</strong><p class="muted small m0">Kuch save nahi hota — sirf dikhata hai kya banega.</p><button class="btn btn-ghost sm" type="button" id="ipv_go">Preview dekho</button><div id="ipv_out"></div></div>` : '<p class="muted small">Save ke baad yahin test / preview kar sakte ho.</p>'}
      <p class="err" id="intErr" hidden></p>`;
    let purpose = a.purpose || 'fulfil';
    const sync = () => {
      $$('#ia_pur [data-p]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === purpose)));
      $$('#intForm [data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(purpose); });
      $('#ia_pur_help').textContent = { fulfil: 'Payment aate hi ye call jaati hai. Jo response se mile wo customer ke order page par. Plan mein Delivery = "API" aur ye action chuno.', import: 'Supplier ki product list padh ke aapke store mein products + plans banata / update karta hai.', custom: 'Koi bhi call — test karne ya future automation ke liye.' }[purpose];
      if (purpose === 'import' && !a.id && $('#ia_method').value === 'POST') $('#ia_method').value = 'GET';
    };
    $('#ia_pur').onclick = e => { const b = e.target.closest('[data-p]'); if (b) { purpose = b.dataset.p; sync(); } };
    sync();
    let lastTa = $('#ia_body');
    $$('#intForm textarea, #intForm input').forEach(el => el.addEventListener('focus', () => { if (el.id === 'ia_body' || el.id === 'ia_res' || el.id === 'ia_path') lastTa = el; }));
    $('#ia_ph').onclick = e => { const b = e.target.closest('[data-ph]'); if (!b) return; const t = lastTa, p = t.selectionStart ?? t.value.length; t.value = t.value.slice(0, p) + b.dataset.ph + t.value.slice(t.selectionEnd ?? p); t.focus(); t.selectionStart = t.selectionEnd = p + b.dataset.ph.length; };
    $('#itx_go')?.addEventListener('click', async () => {
      const out = $('#itx_out'); out.innerHTML = '<p class="muted small">Chal raha hai…</p>';
      try { const r = await A().call(`/api/admin/integrations/actions/${a.id}/test`, { method: 'POST', body: { api_ref: $('#itx_sku').value, qty: $('#itx_qty').value } });
        out.innerHTML = `<p class="small ${r.ok ? 'ok-t' : 'err'}">${r.ok ? '✓ Success' : '✗ Fail'} • HTTP ${r.status || '—'} • ${r.ms} ms${r.ref ? ` • supplier order ${esc(r.ref)}` : ''}${r.error ? ' • ' + esc(r.error) : ''}</p>${r.ok ? `<p class="small m0"><b>Customer ko dikhega:</b></p>${pre(r.result || '(khaali)', 'ok')}` : ''}<p class="small m0"><b>Supplier ka jawab:</b></p>${pre(prettyBody(r.body))}`; }
      catch (e) { out.innerHTML = `<p class="err small">${esc(e.message)}</p>`; }
    });
    $('#ipv_go')?.addEventListener('click', async () => {
      const out = $('#ipv_out'); out.innerHTML = '<p class="muted small">Supplier se list le rahe hain…</p>';
      try { const r = (await A().call(`/api/admin/integrations/actions/${a.id}/test`, { method: 'POST', body: {} })).import; out.innerHTML = importPreview(r); }
      catch (e) { out.innerHTML = `<p class="err small">${esc(e.message)}</p>`; }
    });
    foot(a.id ? 'Action hatao' : '', async () => {
      const map = Object.fromEntries($$('[data-map]').map(i => [i.dataset.map, i.value.trim()]).filter(([, v]) => v));
      const options = purpose === 'import' ? { price_mode: $('#io_mode').value, markup_pct: Number($('#io_markup').value), cost_rate: Number($('#io_rate').value) || 1, mrp_pct: Number($('#io_mrp').value), sync_minutes: Number($('#io_sync').value),
        default_category: $('#io_cat').value, fulfil_action_id: Number($('#io_fulfil').value) || null, round9: $('#io_round').checked, create_new: $('#io_new').checked, activate_new: $('#io_act').checked,
        update_price: $('#io_up').checked, update_stock: $('#io_st').checked, out_of_stock_missing: $('#io_miss').checked } : { per_unit: $('#ia_unit').checked };
      const body = { integration_id: $('#ia_conn').value, name: $('#ia_name').value, purpose, method: $('#ia_method').value, path: $('#ia_path').value, headers: $('#ia_headers').value, body: $('#ia_body').value,
        ok_path: $('#ia_okp').value, ok_value: $('#ia_okv').value, result_template: $('#ia_res').value, ref_path: $('#ia_ref').value, list_path: $('#ia_list').value, map, options };
      const r = await A().call(a.id ? `/api/admin/integrations/actions/${a.id}` : '/api/admin/integrations/actions', { method: a.id ? 'PUT' : 'POST', body });
      toast('Action save ho gaya'); await load(); actForm(D.actions.find(x => x.id === r.id));
    }, async () => { await A().call(`/api/admin/integrations/actions/${a.id}`, { method: 'DELETE', body: {} }); toast('Hata diya'); A().drawer('#intDrawer', false); load(); });
    A().drawer('#intDrawer', true);
  }

  function importPreview(r) {
    const s = r.summary;
    return `<div class="imp-sum"><span><b>${s.total}</b> items</span><span class="ok-t"><b>${s.create}</b> naye</span><span><b>${s.update}</b> update</span>${s.missing ? `<span class="warn"><b>${s.missing}</b> list se gayab</span>` : ''}${s.photos != null ? `<span><b>${s.photos}</b> photos</span>` : ''}</div>
      ${r.rows ? `<div class="table-wrap"><table class="tbl small-tbl"><thead><tr><th>Product • plan</th><th class="r">Cost</th><th class="r">Aapka price</th><th class="r">MRP</th><th class="r">Stock</th><th></th></tr></thead><tbody>${r.rows.slice(0, 40).map(x => `<tr><td>${esc(x.product)} <span class="muted">• ${esc(x.plan)}</span><br><code class="small">${esc(x.ref)}</code></td><td class="r mono">${x.cost}</td><td class="r mono"><b>₹${x.price}</b>${x.old_price != null && x.old_price !== x.price ? `<br><small class="muted">pehle ₹${x.old_price}</small>` : ''}</td><td class="r mono">₹${x.mrp}</td><td class="r mono">${x.stock ?? '∞'}</td><td><span class="st ${x.action === 'create' ? 'delivered' : x.action === 'update' ? 'paid' : 'off'}">${x.action === 'create' ? 'Naya' : x.action === 'update' ? 'Update' : 'Skip'}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
      ${r.raw_sample ? `<details class="small"><summary>Supplier ka raw jawab (sample)</summary>${pre(prettyBody(r.raw_sample))}</details>` : ''}`;
  }

  async function runImport(id) {
    const act = D.actions.find(a => a.id === id);
    $('#intTitle').textContent = `Import: ${act.name}`;
    $('#intForm').innerHTML = '<p class="muted">Supplier se list le rahe hain…</p>';
    $('#intFoot').innerHTML = '';
    A().drawer('#intDrawer', true);
    try {
      const r = await A().call(`/api/admin/integrations/actions/${id}/import`, { method: 'POST', body: { preview: true } });
      $('#intForm').innerHTML = importPreview(r) + `<p class="muted small">${act.options?.activate_new ? 'Naye products turant Live honge.' : 'Naye products Hidden banenge — Products tab mein dekh ke Live karo.'}</p><p class="err" id="intErr" hidden></p>`;
      $('#intFoot').innerHTML = `<div class="row-btns"><button class="btn btn-brand" type="button" id="impGo">Import karo (${r.summary.create} naye, ${r.summary.update} update)</button></div>`;
      $('#impGo').onclick = async e => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Import ho raha hai…';
        try { const x = await A().call(`/api/admin/integrations/actions/${id}/import`, { method: 'POST', body: {} }); toast(`✓ ${x.summary.create} naye, ${x.summary.update} update${x.summary.photos ? `, ${x.summary.photos} photos` : ''}`); A().drawer('#intDrawer', false); load(); A().loadProducts(); }
        catch (ex) { A().showErr($('#intErr'), ex.message); b.disabled = false; b.textContent = 'Dobara try karo'; }
      };
    } catch (e) { $('#intForm').innerHTML = `<p class="err">${esc(e.message)}</p><p class="muted small">Action edit karke "List path" aur mapping check karo — Preview mein supplier ka raw jawab dikhta hai.</p>`; }
  }

  // ================= Telegram bots =================
  function paneBots() {
    return `<div class="int-head"><div><h2 class="h3 m0">Telegram bots</h2><p class="muted m0 small">Jitne chaho bots. Har bot ko kaam do: alerts, live chat, ya admin commands (Telegram se order Paid / Deliver).</p></div>
        <button class="btn btn-primary" type="button" data-new-bot>+ Bot jodo</button></div>
      <div class="int-list">${D.bots.length ? D.bots.map(b => `<article class="int-card">
        <div class="int-card-head"><div><strong>${esc(b.name)}</strong> ${b.env ? '<span class="st off">.env</span>' : ''} ${b.active ? '' : '<span class="st off">Off</span>'}<br>
          <span class="muted small">Chat ${esc(b.chat_id)} • ${esc(b.token)}</span><div class="role-chips">${b.roles.map(r => `<span class="role ${r}">${ROLE[r]?.[0] || r}</span>`).join('')}</div></div>
          <div class="row-gap"><button class="btn btn-ghost sm" type="button" data-test-bot="${b.id}">Test message</button>${b.env ? '' : `<button class="btn btn-ghost sm" type="button" data-edit-bot="${b.id}">Edit</button>`}</div></div>
        <p class="small m0 ${b.error ? 'err' : 'muted'}">${b.error ? '⚠️ ' + esc(b.error) : b.listening ? `● Sun raha hai${b.last_ok ? ' • last ' + ago(b.last_ok) : ''}` : b.roles.includes('alerts') ? 'Sirf bhejta hai (alerts)' : ''}</p>
      </article>`).join('') : '<div class="int-steps"><ol><li>Telegram mein <b>@BotFather</b> → <code>/newbot</code> → naam do → <b>token</b> copy.</li><li>Apne naye bot ko <b>/start</b> bhejo (warna wo aapko message nahi bhej sakta).</li><li>Yahan "+ Bot jodo" → token + chat ID + kaam chuno → Test.</li></ol><p class="muted small">Chat ID nahi pata? Bot jodne ke baad usko /start bhejo — "Admin commands" ya "Live chat" wala bot aapka ID khud bata dega. Ya @userinfobot se.</p></div>'}</div>`;
  }
  function botForm(b = {}) {
    cur = { kind: 'bot', id: b.id };
    $('#intTitle').textContent = b.id ? `Bot: ${b.name}` : 'Naya Telegram bot';
    $('#intForm').innerHTML = `
      <label class="field">Naam<input id="ib_name" value="${esc(b.name || '')}" placeholder="Main bot" maxlength="60"></label>
      <label class="field">Bot token (BotFather se)<input id="ib_token" type="password" autocomplete="off" placeholder="${b.id ? esc(b.token) + ' (badalna ho to naya daalo)' : '123456789:AAH…'}"></label>
      <label class="field">Chat ID<input id="ib_chat" value="${esc(b.chat_id || '')}" placeholder="987654321  (group: -100…)" inputmode="numeric"><small>Kis chat / group mein messages aayein aur kaun commands de sake. Sirf isi chat ke commands maane jaate hain.</small></label>
      <div class="field">Kaam<div class="role-pick">${Object.entries(ROLE).map(([k, [l, d]]) => `<label class="role-opt"><input type="checkbox" value="${k}" ${(b.roles || ['alerts']).includes(k) ? 'checked' : ''}><span><b>${l}</b><small>${d}</small></span></label>`).join('')}</div></div>
      <p class="muted small m0">"Live chat" / "Admin commands" wala bot ye program lagaatar padhta hai — ise kisi aur program / website mein use mat karo.</p>
      <label class="toggle"><input type="checkbox" id="ib_active" ${b.active === false ? '' : 'checked'}> Chalu</label>
      <p class="err" id="intErr" hidden></p>`;
    foot(b.id ? 'Bot hatao' : '', async () => {
      const body = { name: $('#ib_name').value, token: $('#ib_token').value, chat_id: $('#ib_chat').value, roles: $$('.role-pick input:checked').map(i => i.value), active: $('#ib_active').checked };
      const r = await A().call(b.id ? `/api/admin/integrations/bots/${b.id}` : '/api/admin/integrations/bots', { method: b.id ? 'PUT' : 'POST', body });
      toast('Bot save ho gaya — ab "Test message" dabao'); A().drawer('#intDrawer', false); await load();
      return r;
    }, async () => { await A().call(`/api/admin/integrations/bots/${b.id}`, { method: 'DELETE', body: {} }); toast('Hata diya'); A().drawer('#intDrawer', false); load(); });
    A().drawer('#intDrawer', true); $('#ib_name').focus();
  }

  // ================= Webhooks =================
  function paneHooks() {
    return `<div class="int-head"><div><h2 class="h3 m0">Webhooks</h2><p class="muted m0 small">Events kisi bhi URL par: n8n, Zapier, Make, Google Apps Script, apni website. Fail ho to 5 baar dobara (6 ghante tak).</p></div>
        <button class="btn btn-primary" type="button" data-new-hook>+ Webhook</button></div>
      <div class="int-list">${D.webhooks.length ? D.webhooks.map(h => `<article class="int-card">
        <div class="int-card-head"><div><strong>${esc(h.name || 'Webhook')}</strong> ${h.active ? '' : '<span class="st off">Off</span>'}<br><code class="small">${esc(h.url)}</code><br>
          <span class="muted small">${h.events === '*' ? 'Saare events' : esc(h.events.split(',').join(', '))} • 7 din: <span class="ok-t">${h.stats.ok} ok</span>${h.stats.failed ? ` • <span class="err">${h.stats.failed} fail</span>` : ''}${h.stats.pending ? ` • ${h.stats.pending} baaki` : ''}</span></div>
          <div class="row-gap"><button class="btn btn-ghost sm" type="button" data-test-hook="${h.id}">Test bhejo</button><button class="btn btn-ghost sm" type="button" data-edit-hook="${h.id}">Edit / log</button></div></div>
      </article>`).join('') : '<p class="muted">Abhi koi webhook nahi.</p>'}</div>
      <details class="int-doc"><summary>Signature kaise check karein (aapke server par)</summary>
        <p class="small">Har request ke header: <code>X-GIS-Event</code>, <code>X-GIS-Signature: t=…,v1=…</code>. v1 = HMAC-SHA256(secret, "t.body").</p>
        ${pre(`// Node.js\nconst [t, v1] = req.headers['x-gis-signature'].match(/t=(\\d+),v1=(\\w+)/).slice(1);\nconst ok = crypto.createHmac('sha256', SECRET).update(t + '.' + rawBody).digest('hex') === v1\n  && Math.abs(Date.now() / 1000 - t) < 300;`)}
      </details>`;
  }
  async function hookForm(h = {}) {
    cur = { kind: 'hook', id: h.id };
    $('#intTitle').textContent = h.id ? `Webhook: ${h.name || h.url}` : 'Naya webhook';
    const sel = h.events && h.events !== '*' ? h.events.split(',') : [];
    $('#intForm').innerHTML = `
      <div class="two"><label class="field">Naam<input id="ih_name" value="${esc(h.name || '')}" placeholder="n8n orders"></label><label class="toggle mt"><input type="checkbox" id="ih_active" ${h.active === false ? '' : 'checked'}> Chalu</label></div>
      <label class="field">URL<input id="ih_url" value="${esc(h.url || '')}" placeholder="https://hooks.zapier.com/…" inputmode="url"></label>
      <div class="field">Events<label class="toggle"><input type="checkbox" id="ih_all" ${!sel.length ? 'checked' : ''}> Saare events</label>
        <div class="ev-grid" id="ih_ev">${D.events.map(e => `<label class="toggle"><input type="checkbox" value="${e}" ${sel.includes(e) ? 'checked' : ''}><span><code>${e}</code> <small class="muted">${EVENT_HELP[e] || ''}</small></span></label>`).join('')}</div></div>
      ${h.id ? `<label class="field">Signing secret<div class="test-row"><input id="ih_secret" value="${esc(h.secret)}" readonly class="mono"><button class="btn btn-ghost sm" type="button" id="ih_rot">Naya secret</button></div></label>
        <div class="int-test"><strong>Recent deliveries</strong><div id="ih_log"><p class="muted small">Load…</p></div></div>` : ''}
      <p class="err" id="intErr" hidden></p>`;
    const syncAll = () => { $('#ih_ev').hidden = $('#ih_all').checked; }; $('#ih_all').onchange = syncAll; syncAll();
    const save = async rotate => {
      const events = $('#ih_all').checked ? ['*'] : $$('#ih_ev input:checked').map(i => i.value);
      const r = await A().call(h.id ? `/api/admin/integrations/webhooks/${h.id}` : '/api/admin/integrations/webhooks', { method: h.id ? 'PUT' : 'POST', body: { name: $('#ih_name').value, url: $('#ih_url').value, events, active: $('#ih_active').checked, rotate_secret: !!rotate } });
      await load(); hookForm(r); toast(h.id ? 'Save ho gaya' : 'Webhook ban gaya — secret copy kar lo');
    };
    $('#ih_rot')?.addEventListener('click', () => save(true).catch(e => toast(e.message)));
    foot(h.id ? 'Webhook hatao' : '', () => save(false), async () => { await A().call(`/api/admin/integrations/webhooks/${h.id}`, { method: 'DELETE', body: {} }); toast('Hata diya'); A().drawer('#intDrawer', false); load(); });
    A().drawer('#intDrawer', true);
    if (h.id) {
      $('#ih_secret').onclick = () => copy($('#ih_secret').value);
      try {
        const rows = await A().call(`/api/admin/integrations/webhooks/${h.id}/deliveries`);
        $('#ih_log').innerHTML = rows.length ? `<ul class="dl-list">${rows.map(d => `<li><span class="st ${d.status === 'ok' ? 'delivered' : d.status === 'failed' ? 'cancelled' : 'paid'}">${d.status}</span> <code>${esc(d.event)}</code> <span class="muted small">${ago(d.created_at)} • ${d.last_code || '—'}${d.last_error ? ' • ' + esc(d.last_error) : ''}${d.tries > 1 ? ` • ${d.tries} try` : ''}</span>${d.status === 'failed' ? ` <button class="link" type="button" data-retry="${d.id}">retry</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">Abhi kuch nahi bheja gaya.</p>';
        $$('[data-retry]', $('#ih_log')).forEach(b => { b.onclick = async () => { await A().call(`/api/admin/integrations/deliveries/${b.dataset.retry}/retry`, { method: 'POST', body: {} }); toast('Dobara bhej rahe hain'); }; });
      } catch {}
    }
  }

  // ================= Store API keys =================
  let newKey = null;
  function paneKeys() {
    const base = D.base_url || location.origin;
    return `<div class="int-head"><div><h2 class="h3 m0">Store API</h2><p class="muted m0 small">Apne bot, app ya doosri website ko store se jodo: products padho, order banao, deliver karo.</p></div></div>
      <form class="panel stack key-form" id="keyForm" novalidate><strong>Nayi API key</strong>
        <div class="two"><label class="field">Naam<input id="ik_name" placeholder="Mera Telegram shop bot" maxlength="60"></label>
          <div class="field">Permissions<div class="checks">${D.scopes.map(s => `<label class="toggle"><input type="checkbox" value="${s}" ${s === 'products:read' ? 'checked' : ''}><span><code>${s}</code> <small class="muted">${SCOPE_HELP[s]}</small></span></label>`).join('')}</div></div></div>
        <button class="btn btn-ink" type="submit">Key banao</button>
        ${newKey ? `<div class="new-key"><b>Ye key sirf abhi dikh rahi hai — copy karke safe rakho:</b><div class="test-row"><input readonly class="mono" value="${esc(newKey)}" id="ik_new"><button class="btn btn-primary sm" type="button" id="ik_copy">Copy</button></div></div>` : ''}
      </form>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Naam</th><th>Key</th><th>Permissions</th><th>Last use</th><th></th></tr></thead><tbody>
        ${D.keys.length ? D.keys.map(k => `<tr${k.revoked ? ' class="dim"' : ''}><td>${esc(k.name)}</td><td><code>${esc(k.prefix)}…</code></td><td class="small">${k.scopes.map(esc).join('<br>')}</td><td class="small muted">${ago(k.last_used_at)}</td><td class="r">${k.revoked ? '<span class="st off">Band</span>' : `<button class="link danger-link" type="button" data-revoke="${k.id}">Band karo</button>`}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="5">Abhi koi key nahi.</td></tr>'}
      </tbody></table></div>
      <details class="int-doc" open><summary>API docs</summary>
        <p class="small">Base URL: <code>${esc(base)}/api/v1</code> • Header: <code>Authorization: Bearer gis_live_…</code> • 120 requests/minute</p>
        <table class="tbl small-tbl"><tbody>
          <tr><td><code>GET /api/v1/products</code></td><td>Saare live products + plans (<code>?all=1</code> hidden bhi)</td></tr>
          <tr><td><code>GET /api/v1/orders</code></td><td>Orders (<code>?status=paid&amp;email=…&amp;since=2026-10-01&amp;limit=50</code>)</td></tr>
          <tr><td><code>GET /api/v1/orders/GIS-XXXX</code></td><td>Ek order</td></tr>
          <tr><td><code>POST /api/v1/orders</code></td><td>Order banao: <code>{name, email, phone, items:[{plan_id, qty}], coupon?, currency?}</code> → <code>order_url</code> par customer pay kare</td></tr>
          <tr><td><code>POST /api/v1/orders/GIS-XXXX/deliver</code></td><td><code>{delivery: "Email: …"}</code></td></tr>
          <tr><td><code>POST /api/v1/orders/GIS-XXXX/status</code></td><td><code>{status: "paid" | "cancelled"}</code></td></tr>
        </tbody></table>
        ${pre(`curl ${base}/api/v1/products \\\n  -H "Authorization: Bearer gis_live_…"`)}
      </details>`;
  }

  // ================= Logs =================
  let onlyFail = false;
  async function loadLogs() {
    let rows; try { rows = await A().call(`/api/admin/integrations/logs${onlyFail ? '?failed=1' : ''}`); } catch (e) { $('#intBody').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    const name = id => D.connections.find(c => c.id === id)?.name || '—';
    $('#intBody').innerHTML = `<div class="int-head"><div><h2 class="h3 m0">API logs</h2><p class="muted m0 small">Last 100 calls. Secrets hata diye jaate hain.</p></div><label class="toggle"><input type="checkbox" id="lgFail" ${onlyFail ? 'checked' : ''}> Sirf fail</label></div>
      <div class="table-wrap"><table class="tbl log-tbl"><thead><tr><th>Time</th><th>API</th><th>Call</th><th class="r">Status</th><th class="r">ms</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr data-log="${r.id}" tabindex="0"><td class="small">${ago(r.created_at)}</td><td>${esc(name(r.integration_id))}<br><span class="pur ${esc(r.kind)}">${esc(r.kind)}</span>${r.ref ? ` <code class="small">${esc(r.ref)}</code>` : ''}</td><td><code class="small">${esc(r.method)} ${esc(r.url)}</code>${r.error ? `<br><small class="err">${esc(r.error)}</small>` : ''}</td><td class="r"><span class="st ${r.ok ? 'delivered' : 'cancelled'}">${r.status || '—'}</span></td><td class="r mono small">${r.ms}</td></tr>
        <tr class="log-detail" data-for="${r.id}" hidden><td colspan="5"><div class="two"><div><b class="small">Request</b>${pre(prettyBody(r.req) || '(khaali)')}</div><div><b class="small">Response</b>${pre(prettyBody(r.res))}</div></div></td></tr>`).join('') : '<tr class="empty-row"><td colspan="5">Abhi koi call nahi.</td></tr>'}
      </tbody></table></div>`;
    $('#lgFail').onchange = e => { onlyFail = e.target.checked; loadLogs(); };
    $$('[data-log]').forEach(tr => { tr.onclick = () => { const d = $(`[data-for="${tr.dataset.log}"]`); d.hidden = !d.hidden; }; });
  }

  // ================= Shared =================
  function foot(delLabel, onSave, onDelete) {
    $('#intFoot').innerHTML = `<div class="row-btns">${delLabel ? `<button class="btn btn-ghost danger" type="button" id="intDel">${esc(delLabel)}</button>` : ''}<button class="btn btn-ink" type="button" id="intSave">Save karo</button></div>`;
    $('#intSave').onclick = async () => {
      const b = $('#intSave'); A().showErr($('#intErr')); b.disabled = true;
      try { await onSave(); } catch (e) { A().showErr($('#intErr'), e.message); $('#intErr')?.scrollIntoView({ block: 'nearest' }); }
      if (document.body.contains(b)) b.disabled = false;
    };
    let armed = false;
    $('#intDel')?.addEventListener('click', async e => {
      const b = e.currentTarget;
      if (!armed) { armed = true; b.textContent = 'Pakka? Dobara dabao'; setTimeout(() => { armed = false; b.textContent = delLabel; }, 3500); return; }
      try { await onDelete(); } catch (ex) { A().showErr($('#intErr'), ex.message); }
    });
  }
  $('#intForm').onsubmit = e => e.preventDefault();

  function wirePane(body) {
    body.querySelector('[data-new-conn]')?.addEventListener('click', () => connForm());
    $$('[data-edit-conn]', body).forEach(b => { b.onclick = () => connForm(D.connections.find(c => c.id === +b.dataset.editConn)); });
    $$('[data-new-act]', body).forEach(b => { b.onclick = () => actForm({ integration_id: +b.dataset.newAct, purpose: 'fulfil', method: 'POST' }); });
    $$('[data-edit-act]', body).forEach(b => { b.onclick = () => actForm(D.actions.find(a => a.id === +b.dataset.editAct)); });
    $$('[data-import]', body).forEach(b => { b.onclick = () => runImport(+b.dataset.import); });
    body.querySelector('[data-new-bot]')?.addEventListener('click', () => botForm());
    $$('[data-edit-bot]', body).forEach(b => { b.onclick = () => botForm(D.bots.find(x => String(x.id) === b.dataset.editBot)); });
    $$('[data-test-bot]', body).forEach(b => { b.onclick = async () => { b.disabled = true; try { const r = await A().call(`/api/admin/integrations/bots/${b.dataset.testBot}/test`, { method: 'POST', body: {} }); toast(`✓ @${r.username} — Telegram check karo`); } catch (e) { toast(e.message); } b.disabled = false; load(); }; });
    body.querySelector('[data-new-hook]')?.addEventListener('click', () => hookForm());
    $$('[data-edit-hook]', body).forEach(b => { b.onclick = () => hookForm(D.webhooks.find(h => h.id === +b.dataset.editHook)); });
    $$('[data-test-hook]', body).forEach(b => { b.onclick = async () => { b.disabled = true; try { const r = await A().call(`/api/admin/integrations/webhooks/${b.dataset.testHook}/test`, { method: 'POST', body: {} }); toast(r.ok ? `✓ Pahunch gaya (HTTP ${r.code})` : `✗ ${r.error}`); } catch (e) { toast(e.message); } b.disabled = false; load(); }; });
    const kf = body.querySelector('#keyForm');
    if (kf) {
      kf.onsubmit = async e => { e.preventDefault(); try { const r = await A().call('/api/admin/integrations/keys', { method: 'POST', body: { name: $('#ik_name').value, scopes: $$('#keyForm .checks input:checked').map(i => i.value) } }); newKey = r.key; await load(); } catch (ex) { toast(ex.message); } };
      $('#ik_copy')?.addEventListener('click', () => copy(newKey));
      $$('[data-revoke]', body).forEach(b => { b.onclick = async () => { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Pakka?'; return; } await A().call(`/api/admin/integrations/keys/${b.dataset.revoke}`, { method: 'DELETE', body: {} }); toast('Key band'); load(); }; });
    }
  }

  // ================= Products: CSV import =================
  let csvText = '';
  function csvOpen() {
    csvText = '';
    $('#csvBody').innerHTML = `
      <ol class="int-steps-inline"><li><a href="/api/admin/products/csv?template=1">Template download karo</a> (ya "CSV export" se apni list)</li><li>Excel / Google Sheets mein bharo → <b>CSV</b> mein save</li><li>Yahan upload → Preview → Import</li></ol>
      <p class="muted small m0">Har line = ek plan. Same product naam ki lines ek product ban jaati hain. Pehle se maujood product + plan (naam se) update hote hain. Columns: <code>product, category, description, details, tag, active, plan, price, mrp, days, delivery, usdt_price, sku, image_url</code></p>
      <label class="btn btn-ghost file-btn">CSV file chuno<input type="file" id="csvFile" accept=".csv,text/csv,text/plain" class="sr"></label>
      <label class="field">Ya yahan paste karo<textarea id="csvPaste" class="mono-ta" placeholder="product,category,plan,price,mrp&#10;Netflix Premium,Entertainment,1 Month,499,649"></textarea></label>
      <div id="csvOut"></div><p class="err" id="csvErr" hidden></p>`;
    $('#csvFoot').innerHTML = '<div class="row-btns"><button class="btn btn-ghost" type="button" id="csvPrev">Preview</button><button class="btn btn-brand" type="button" id="csvGo" disabled>Import karo</button></div>';
    $('#csvFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { toast('CSV 5 MB se chhoti rakho'); return; } $('#csvPaste').value = await f.text(); preview(); };
    $('#csvPrev').onclick = preview;
    $('#csvGo').onclick = async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Import ho raha hai…'; A().showErr($('#csvErr'));
      try { const r = await A().call('/api/admin/products/csv', { method: 'POST', body: { csv: csvText } }); toast(`✓ ${r.products} products, ${r.new_plans} naye plans, ${r.updated_plans} update${r.photos ? `, ${r.photos} photos` : ''}`); A().drawer('#csvDrawer', false); A().loadProducts(); }
      catch (ex) { A().showErr($('#csvErr'), ex.message); b.disabled = false; b.textContent = 'Import karo'; }
    };
    A().drawer('#csvDrawer', true);
  }
  async function preview() {
    csvText = $('#csvPaste').value; A().showErr($('#csvErr')); $('#csvGo').disabled = true;
    if (!csvText.trim()) { A().showErr($('#csvErr'), 'Pehle file chuno ya paste karo.'); return; }
    try {
      const r = await A().call('/api/admin/products/csv', { method: 'POST', body: { csv: csvText, preview: true } });
      const s = r.summary;
      $('#csvOut').innerHTML = `<div class="imp-sum"><span><b>${s.products}</b> products</span><span class="ok-t"><b>${s.new_products}</b> naye products</span><span><b>${s.new_plans}</b> naye plans</span><span><b>${s.updated_plans}</b> update</span>${s.errors ? `<span class="err"><b>${s.errors}</b> galti</span>` : ''}</div>
        ${r.errors.length ? `<ul class="err small csv-errs">${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul><p class="small muted">Galtiyan theek karke dobara Preview karo.</p>` : ''}
        <div class="table-wrap"><table class="tbl small-tbl"><thead><tr><th>Product</th><th>Plan</th><th class="r">Price</th><th class="r">MRP</th><th class="r">Din</th><th></th></tr></thead><tbody>${r.lines.slice(0, 60).map(l => `<tr><td>${esc(l.product)}<br><small class="muted">${esc(l.category || '')}</small></td><td>${esc(l.plan)}</td><td class="r mono">₹${l.price}</td><td class="r mono">₹${l.mrp}</td><td class="r mono">${l.days}</td><td><span class="st ${l.plan_status === 'new' ? 'delivered' : 'paid'}">${l.plan_status === 'new' ? 'Naya' : 'Update'}</span></td></tr>`).join('')}</tbody></table></div>`;
      $('#csvGo').disabled = !!r.errors.length || !s.rows;
    } catch (ex) { A().showErr($('#csvErr'), ex.message); }
  }
  $('#csvImportBtn')?.addEventListener('click', csvOpen);

  GIS.adminInt = { load };
})();
