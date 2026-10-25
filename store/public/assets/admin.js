(() => {
  const { $, $$, inr, esc, api, toast, copy, paint, tile, fmtTime, fmtDate, icons } = GIS;
  const STATUS = { awaiting_payment: 'Payment baaki', verifying: 'Verify karo', paid: 'Deliver karo', delivered: 'Delivered', cancelled: 'Cancelled' };
  const TABS = ['dash', 'orders', 'products', 'customers', 'coupons', 'newsletter', 'referrals', 'integrations', 'settings'];
  let tab = 'dash', orderFilter = 'verifying', orderQ = '', orders = [], products = [], coupons = [], settings = {};

  $$('[data-close-drawer]').forEach(b => { b.innerHTML = icons.x; });
  const showErr = (el, msg) => { el.textContent = msg || ''; el.hidden = !msg; };
  const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

  // ---------- Auth ----------
  async function boot() {
    try {
      const me = await api('/api/admin/me');
      $('#who').textContent = me.username;
      $('#login').hidden = true; $('#app').hidden = false;
      const h = location.hash.slice(1);
      go(TABS.includes(h) ? h : 'dash');
    } catch { $('#app').hidden = true; $('#login').hidden = false; $('#lp').focus(); }
  }
  $('#loginForm').onsubmit = async e => {
    e.preventDefault(); const b = $('#lBtn'); b.disabled = true; showErr($('#lErr'));
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: { username: $('#lu').value, password: $('#lp').value } });
      $('#lp').value = '';
      if (r.otp_required) { $('#loginForm').hidden = true; $('#otpForm').hidden = false; $('#otpSent').textContent = `Code ${r.sent_to} par bheja hai.`; $('#lOtp').focus(); }
      else boot();
    } catch (ex) { showErr($('#lErr'), ex.message); }
    b.disabled = false;
  };
  $('#otpForm').onsubmit = async e => {
    e.preventDefault(); const b = $('#oBtn'); b.disabled = true; showErr($('#oErr'));
    try { await api('/api/admin/login/otp', { method: 'POST', body: { username: $('#lu').value, code: $('#lOtp').value } }); $('#otpForm').hidden = true; $('#loginForm').hidden = false; $('#lOtp').value = ''; boot(); }
    catch (ex) { showErr($('#oErr'), ex.message); }
    b.disabled = false;
  };
  $('#oBack').onclick = () => { $('#otpForm').hidden = true; $('#loginForm').hidden = false; };
  $('#logout').onclick = async () => { try { await api('/api/admin/logout', { method: 'POST', body: {} }); } catch {} boot(); };
  async function call(url, opts) { try { return await api(url, opts); } catch (e) { if (e.status === 401) boot(); throw e; } }

  // ---------- Tabs ----------
  function go(t) {
    tab = t; history.replaceState(null, '', '#' + t);
    $$('#tabs button').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $$('[data-view]').forEach(v => { v.hidden = v.dataset.view !== t; });
    refresh();
  }
  $('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
  $$('[data-refresh]').forEach(b => { b.onclick = () => { refresh(); toast('Refresh ho gaya'); }; });
  function refresh() {
    loadStats();
    ({ orders: loadOrders, products: loadProducts, customers: loadCustomers, coupons: loadCoupons, newsletter: loadNewsletter, referrals: loadReferrals, integrations: () => GIS.adminInt?.load(), settings: loadSettings})[tab]?.();
  }

  // ---------- Drawers ----------
  function drawer(id, v) {
    $(id).hidden = !v;
    $('#scrim').hidden = !$$('.drawer').some(d => !d.hidden);
    document.body.classList.toggle('no-scroll', !$('#scrim').hidden);
  }
  $('#scrim').onclick = () => { $$('.drawer').forEach(d => { d.hidden = true; }); $('#scrim').hidden = true; document.body.classList.remove('no-scroll'); };
  $$('[data-close-drawer]').forEach(b => { b.onclick = () => drawer('#' + b.closest('.drawer').id, false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const open = $$('.drawer').filter(d => !d.hidden).pop(); if (open) drawer('#' + open.id, false); } });

  // ---------- Dashboard ----------
  async function loadStats() {
    let s; try { s = await call('/api/admin/stats'); } catch { return; }
    const nv = $('#navVerify'); nv.textContent = s.to_verify + s.to_deliver; nv.hidden = !(s.to_verify + s.to_deliver);
    if (tab !== 'dash') return;
    const i = s.integrations, todo = [];
    if (!i.crypto_configured) todo.push('Crypto ke liye <b>Get It Sasta Pay</b> app chalao aur <b>PAY_URL</b>, <b>PAY_API_KEY</b>, <b>PAY_WEBHOOK_SECRET</b> daalo');
    if (!i.email) todo.push('OTP login aur customer emails ke liye <b>RESEND_API_KEY</b> + <b>MAIL_FROM</b> daalo');
    else if (!i.admin_2fa) todo.push('Admin login par OTP (2-step) ke liye <b>ADMIN_EMAIL</b> daalo');
    if (!i.public_url) todo.push('<b>PUBLIC_URL</b> = https://getitsasta.com daalo (email links ke liye)');
    $('#setupBanner').innerHTML = todo.length ? `<div class="setup"><strong>Setup baaki hai</strong><ul>${todo.map(t => `<li>${t}</li>`).join('')}</ul><small class="muted">hPanel → Websites → Node.js app → Environment variables. Phir Redeploy.</small></div>` : '';
    $('#kpis').innerHTML = `
      <button class="kpi ${s.to_verify ? 'alert' : ''}" data-jump="verifying"><span class="l">UTR verify karna hai</span><span class="v">${s.to_verify}</span><span class="s">Bank app se milao</span></button>
      <button class="kpi ${s.to_deliver ? 'alert' : ''}" data-jump="paid"><span class="l">Deliver karna hai</span><span class="v">${s.to_deliver}</span><span class="s">Paid orders</span></button>
      <div class="kpi"><span class="l">Aaj ki kamai</span><span class="v">${inr(s.today_revenue)}</span><span class="s">${s.awaiting} order payment ke intezaar mein</span></div>
      <div class="kpi"><span class="l">Is mahine</span><span class="v">${inr(s.month_revenue)}</span><span class="s">${s.customers} customers • ${s.delivered_total} delivered</span></div>`;
    $$('[data-jump]').forEach(b => { b.onclick = () => { orderFilter = b.dataset.jump; go('orders'); }; });
    drawChart(s.series);
    const max = Math.max(1, ...s.top.map(t => t.v));
    $('#top').innerHTML = s.top.length ? s.top.map(t => `<li><span>${esc(t.product_name)} <span class="muted">× ${t.n}</span></span><span class="mono">${inr(t.v)}</span><span class="bar-bg"><span class="bar-fg" data-w="${(t.v / max) * 100}"></span></span></li>`).join('')
      : '<li class="muted">Abhi koi paid order nahi. Pehla order aate hi yahan dikhega.</li>';
    $('#lowStockPanel').hidden = !s.low_stock.length;
    $('#lowStock').innerHTML = s.low_stock.map(l => `<li><span>${esc(l.name)} <span class="muted">• ${esc(l.label)}</span></span><span class="st ${l.n ? 'verifying' : 'cancelled'}">${l.n} bache</span></li>`).join('');
    paint($('[data-view=dash]'));
  }

  function drawChart(series) {
    const W = 640, H = 220, pl = 52, pr = 8, pt = 12, pb = 28;
    const max = Math.max(...series.map(d => d.v));
    const nice = max <= 0 ? 1000 : (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
    const iw = W - pl - pr, ih = H - pt - pb, bw = iw / series.length;
    const y = v => pt + ih - (v / nice) * ih;
    const short = v => v >= 1e5 ? +(v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? +(v / 1e3).toFixed(1) + 'k' : String(v);
    $('#chartTotal').textContent = inr(series.reduce((a, d) => a + d.v, 0)) + ' total';
    $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="14 din ki kamai">
      ${[0, nice / 2, nice].map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${pl - 8}" y="${y(t) + 4}" text-anchor="end">₹${short(t)}</text>`).join('')}
      ${series.map((d, i) => {
        const h = d.v ? Math.max(2, ih - (y(d.v) - pt)) : 0, x = pl + i * bw + bw * 0.18, last = i === series.length - 1;
        const day = new Date(d.d + 'T00:00:00').getDate();
        return `<rect x="${x}" y="${pt + ih - h}" width="${bw * 0.64}" height="${h}" rx="4" fill="${last ? 'var(--sasta)' : 'var(--brand)'}"><title>${d.d}: ${inr(d.v)} (${d.n} orders)</title></rect>
          ${(series.length - 1 - i) % 2 === 0 ? `<text x="${x + bw * 0.32}" y="${H - 8}" text-anchor="middle">${day}</text>` : ''}`;
      }).join('')}</svg>`;
  }

  // ---------- Orders ----------
  function renderStatusChips() {
    const opts = [['', 'Sab'], ['verifying', 'Verify karo'], ['paid', 'Deliver karo'], ['awaiting_payment', 'Payment baaki'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
    $('#statusChips').innerHTML = opts.map(([v, l]) => `<button class="chip" data-st="${v}" aria-pressed="${v === orderFilter}">${l}</button>`).join('');
  }
  $('#statusChips').onclick = e => { const b = e.target.closest('[data-st]'); if (b) { orderFilter = b.dataset.st; loadOrders(); } };
  let oqT; $('#oq').oninput = e => { clearTimeout(oqT); oqT = setTimeout(() => { orderQ = e.target.value.trim(); loadOrders(); }, 250); };
  const payLabel = o => o.pay_method === 'crypto' ? `<span class="mono">Crypto</span><small>${esc(o.crypto_amount || '')}${o.gw_ref ? ' • ' + esc(o.gw_ref.slice(0, 14)) : ''}</small>` : o.utr ? `<span class="mono">UPI</span><small>${esc(o.utr)}</small>` : '<span class="muted">—</span>';

  async function loadOrders() {
    renderStatusChips();
    const qs = `status=${encodeURIComponent(orderFilter)}&q=${encodeURIComponent(orderQ)}`;
    $('#csvLink').href = `/api/admin/orders.csv?${qs}`;
    try { orders = await call(`/api/admin/orders?${qs}`); } catch (e) { toast(e.message); return; }
    $('#ordersTbl tbody').innerHTML = orders.length ? orders.map(o => `<tr data-id="${o.id}" tabindex="0">
      <td><strong class="mono">${esc(o.code)}</strong>${o.customer_id ? '<small>Account</small>' : '<small>Guest</small>'}</td>
      <td>${esc(o.name)}<small>${esc(o.phone)}</small></td>
      <td>${o.items.map(i => `${esc(i.product_name)} <span class="muted">${esc(i.plan_label)}${i.qty > 1 ? ' ×' + i.qty : ''}</span>${i.delivery_mode === 'auto' ? ' <span class="mini-auto">auto</span>' : ''}`).join('<br>')}</td>
      <td class="r mono"><strong>${inr(o.total)}</strong>${o.discount ? `<small>−${inr(o.discount)} ${esc(o.coupon_code)}</small>` : ''}</td>
      <td>${payLabel(o)}</td>
      <td><span class="st ${o.status}">${STATUS[o.status]}</span></td>
      <td class="muted">${fmtTime(o.created_at)}</td></tr>`).join('')
      : `<tr class="empty-row"><td colspan="7">Is filter mein koi order nahi.</td></tr>`;
  }
  $('#ordersTbl tbody').addEventListener('click', e => { const r = e.target.closest('tr[data-id]'); if (r) openOrder(+r.dataset.id); });
  $('#ordersTbl tbody').addEventListener('keydown', e => { const r = e.target.closest('tr[data-id]'); if (r && e.key === 'Enter') openOrder(+r.dataset.id); });
  const waNumber = p => { const d = String(p).replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };

  function openOrder(id) {
    const o = orders.find(x => x.id === id); if (!o) return;
    let status = o.status;
    $('#odTitle').textContent = o.code;
    const link = `${location.origin}/order/${o.code}`;
    $('#odBody').innerHTML = `
      <dl class="kv">
        <dt>Customer</dt><dd>${esc(o.name)} ${o.customer_id ? '<span class="mini-auto">account</span>' : ''}</dd>
        <dt>Phone</dt><dd class="mono">${esc(o.phone)}</dd>
        <dt>Email</dt><dd>${esc(o.email)}</dd>
        <dt>Amount</dt><dd class="mono"><strong>${inr(o.total)}</strong>${o.discount ? ` <span class="muted">(${inr(o.subtotal)} − ${inr(o.discount)} ${esc(o.coupon_code)})</span>` : ''}</dd>
        <dt>Payment</dt><dd class="mono">${o.pay_method === 'crypto' ? `Crypto ${esc(o.crypto_amount)} ${o.gw_ref ? '• ' + esc(o.gw_ref) : '(pending)'}` : o.utr ? `UPI UTR ${esc(o.utr)} <button class="link" id="cpUtr" type="button">copy</button>` : '—'}</dd>
        <dt>Bana</dt><dd>${fmtTime(o.created_at)}</dd>
        ${o.paid_at ? `<dt>Paid</dt><dd>${fmtTime(o.paid_at)}</dd>` : ''}
      </dl>
      <ul class="items-list">${o.items.map(i => `<li><span>${esc(i.product_name)} <span class="muted">• ${esc(i.plan_label)}${i.qty > 1 ? ' × ' + i.qty : ''}</span>${i.delivery_mode === 'api' ? `<br><span class="api-st ${esc(i.api_status || 'wait')}">Supplier API: ${({ ok: '✓ mil gaya', failed: '✗ fail', retry: '↻ dobara try hoga', pending: '… chal raha' })[i.api_status] || 'payment ka intezaar'}${i.api_ref ? ` • ${esc(i.api_ref)}` : ''}</span>${i.api_error && i.api_status !== 'ok' ? `<br><small class="err">${esc(i.api_error)}</small>` : ''}` : ''}${i.auto_content ? `<pre class="delivery sm">${esc(i.auto_content)}</pre>` : i.delivery_mode === 'auto' ? '<br><small class="warn">Auto item — stock khatam tha, manual deliver karo</small>' : ''}</span><span>${inr(i.price * i.qty)}</span></li>`).join('')}</ul>
      <div class="field">Status<div class="status-pick" id="stPick">${Object.entries(STATUS).map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === status}">${l}</button>`).join('')}</div></div>
      <div class="cred-helper">
        <strong>Login details bhejo</strong>
        <div class="two"><label class="field">Login email / ID<input id="cdEmail" autocomplete="off"></label><label class="field">Password<input id="cdPass" autocomplete="off"></label></div>
        <button type="button" class="btn btn-ghost sm" id="cdAdd">Delivery mein jodo ↓</button>
      </div>
      <label class="field">Delivery details (customer ko login ke peeche dikhega)<textarea id="odDelivery" placeholder="Email: user@mail.com&#10;Password: ••••••&#10;Note: profile 2 use karo">${esc(o.delivery)}</textarea>
        <small>"Naam: value" wali har line customer ko alag copy button ke saath dikhti hai. Password apne aap chhupa rehta hai.</small></label>
      <label class="field">Private note (sirf admin)<input id="odNote" value="${esc(o.admin_note)}"></label>
      <a class="btn btn-wa" target="_blank" rel="noopener" id="odWa">Customer ko WhatsApp karo</a>
      <p class="err" id="odErr" hidden></p>`;
    const setWa = () => {
      const f = o.name.split(' ')[0];
      const msg = status === 'delivered' ? `Namaste ${f}, aapka order ${o.code} deliver ho gaya hai. Details: ${link}` : `Namaste ${f}, aapke order ${o.code} ke baare mein: ${link}`;
      $('#odWa').href = `https://wa.me/${waNumber(o.phone)}?text=${encodeURIComponent(msg)}`;
    };
    setWa();
    $('#cdAdd').onclick = () => {
      const em = $('#cdEmail').value.trim(), pw = $('#cdPass').value.trim();
      if (!em && !pw) return;
      const t = $('#odDelivery'); t.value = (t.value.trim() ? t.value.trim() + '\n' : '') + (em ? `Email: ${em}\n` : '') + (pw ? `Password: ${pw}` : '');
      $('#cdEmail').value = $('#cdPass').value = '';
    };
    $('#cpUtr')?.addEventListener('click', e => copy(o.utr, e.currentTarget));
    $('#stPick').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; status = b.dataset.k; $$('#stPick button').forEach(x => x.setAttribute('aria-pressed', x === b)); setWa(); };
    const apiPending = o.status === 'paid' && o.items.some(i => i.delivery_mode === 'api' && i.api_status !== 'ok');
    const quick = (apiPending ? '<button class="btn btn-ghost" id="odFulfil" type="button">↻ Supplier se dobara mangwao</button>' : '') + (o.status === 'verifying' ? '<button class="btn btn-brand" id="odQuick" type="button">Payment mila ✓ Paid karo</button>'
      : o.status === 'paid' ? '<button class="btn btn-brand" id="odQuick" type="button">Deliver karo</button>' : '');
    $('#odFoot').innerHTML = `<div class="row-btns">${quick}<button class="btn btn-ink" id="odSave" type="button">Save karo</button></div>`;
    const save = async st => {
      showErr($('#odErr'));
      try {
        const upd = await call(`/api/admin/orders/${o.id}`, { method: 'PATCH', body: { status: st ?? status, delivery: $('#odDelivery').value, admin_note: $('#odNote').value } });
        toast(`${upd.code}: ${STATUS[upd.status]}`); drawer('#orderDrawer', false); loadOrders(); loadStats();
      } catch (e) { showErr($('#odErr'), e.message); }
    };
    $('#odSave').onclick = () => save();
    $('#odFulfil')?.addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Supplier se mangwa rahe hain…';
      try { const r = await call(`/api/admin/orders/${o.id}/fulfil`, { method: 'POST', body: {} }); const bad = (r.report || []).filter(x => !x.ok); toast(bad.length ? `Fail: ${bad[0].error}` : 'Supplier se mil gaya ✓'); await loadOrders(); openOrder(o.id); }
      catch (ex) { toast(ex.message); b.disabled = false; b.textContent = '↻ Supplier se dobara mangwao'; }
    });
    $('#odQuick')?.addEventListener('click', () => {
      if (o.status === 'paid' && !$('#odDelivery').value.trim() && !o.items.some(i => i.auto_content)) { showErr($('#odErr'), 'Pehle delivery details likho, phir "Deliver karo" dabao.'); $('#odDelivery').focus(); return; }
      save(o.status === 'verifying' ? 'paid' : 'delivered');
    });
    drawer('#orderDrawer', true);
  }

  // ---------- Products ----------
  $('#bulkForm').onsubmit = async e => {
    e.preventDefault();
    const pct = Number($('#bulkPct').value), b = $('#bulkBtn');
    if (!(pct >= 1 && pct <= 90)) { toast('1 se 90 ke beech % daalo'); return; }
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = `Pakka? Sab ${pct}% off — dobara dabao`; setTimeout(() => { delete b.dataset.sure; b.textContent = 'Sab plans par lagao'; }, 5000); return; }
    delete b.dataset.sure; b.disabled = true;
    try { const r = await call('/api/admin/products/bulk-price', { method: 'POST', body: { percent: pct } }); toast(`${r.updated} plans ka price badal gaya`); await loadProducts(); }
    catch (ex) { toast(ex.message); }
    b.disabled = false; b.textContent = 'Sab plans par lagao';
  };
  async function loadProducts() {
    try { products = await call('/api/admin/products'); } catch (e) { toast(e.message); return; }
    $('#productsTbl tbody').innerHTML = products.length ? products.map(p => `<tr data-pid="${p.id}" tabindex="0">
      <td><div class="line">${tile({ ...p, image: p.image_url })}<div class="info"><strong>${esc(p.name)}</strong><small>${esc(p.tag || '')}</small></div></div></td>
      <td>${esc(p.category)}</td>
      <td class="mono">${p.plans.map(pl => `${esc(pl.label)}: ${inr(pl.price)}`).join('<br>')}</td>
      <td>${p.plans.map(pl => pl.delivery === 'auto' ? `<span class="st ${pl.stock_left ? 'delivered' : 'cancelled'}">Auto • ${pl.stock_left}</span>` : pl.delivery === 'api' ? `<span class="st ${pl.api_stock === 0 ? 'cancelled' : 'paid'}">API${pl.api_stock != null ? ' • ' + pl.api_stock : ''}</span>` : '<span class="st off">Manual</span>').join('<br>')}${p.source ? `<br><small class="muted">${p.source.startsWith('api') ? 'Supplier import' : 'CSV'}</small>` : ''}</td>
      <td>${p.active ? '<span class="st delivered">Live</span>' : '<span class="st off">Hidden</span>'}</td>
      <td class="r"><button class="btn btn-ghost sm" type="button">Edit</button></td></tr>`).join('')
      : `<tr class="empty-row"><td colspan="6">Abhi koi product nahi. "+ Naya product" se pehla product jodo.</td></tr>`;
    paint($('#productsTbl'));
    $('#catList').innerHTML = [...new Set(products.map(p => p.category))].map(c => `<option value="${esc(c)}">`).join('');
  }
  $('#productsTbl tbody').addEventListener('click', e => { const r = e.target.closest('tr[data-pid]'); if (r) openProduct(products.find(p => p.id === +r.dataset.pid)); });
  $('#productsTbl tbody').addEventListener('keydown', e => { const r = e.target.closest('tr[data-pid]'); if (r && e.key === 'Enter') openProduct(products.find(p => p.id === +r.dataset.pid)); });
  $('#newProduct').onclick = () => openProduct(null);

  let editing = null, imageData = null, removeImage = false;
  function renderImgPrev() {
    const url = imageData || (!removeImage && editing?.image_url) || '';
    const name = $('#p_name').value || 'Product';
    $('#imgPrev').innerHTML = url ? `<img src="${esc(url)}" alt="">` : `<span>${esc(GIS.initials(name))}</span>`;
    $('#imgPrev').style.background = url ? 'var(--paper)' : $('#p_color').value;
    $('#imgRemove').hidden = !url;
  }
  $('#p_image').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { toast('Photo 3 MB se chhoti rakho'); return; }
    imageData = await readFile(f); removeImage = false; renderImgPrev();
  };
  $('#imgRemove').onclick = () => { imageData = null; removeImage = true; renderImgPrev(); };
  $('#p_color').oninput = renderImgPrev;
  $('#p_name').oninput = renderImgPrev;

  let fulfilActions = [];
  const fulfilOptions = sel => fulfilActions.length ? fulfilActions.map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.integration_name)} → ${esc(a.name)}</option>`).join('') : '<option value="">— Integrations mein action banao —</option>';
  async function loadFulfil() { try { fulfilActions = (await call('/api/admin/integrations')).actions.filter(a => a.purpose === 'fulfil'); } catch { fulfilActions = []; } }
  function planRow(pl = {}) {
    const d = document.createElement('div'); d.className = 'plan-block';
    d.dataset.id = pl.id || '';
    d.innerHTML = `<div class="plan-grid">
        <label class="field">Plan naam<input placeholder="1 Month" value="${esc(pl.label || '')}" data-f="label"></label>
        <label class="field">Price ₹<input type="number" inputmode="numeric" min="1" placeholder="199" value="${pl.price ?? ''}" data-f="price"></label>
        <label class="field">MRP ₹<input type="number" inputmode="numeric" min="1" placeholder="599" value="${pl.mrp ?? ''}" data-f="mrp"></label>
        <label class="field">Crypto price (USDT)<input type="number" inputmode="decimal" min="0" step="0.01" placeholder="${pl.price ? 'auto ' + (pl.price / (Number(settings?.usdt_inr_rate) || 90)).toFixed(2) : 'khaali = ₹ rate se'}" value="${pl.price_usdt ? pl.price_usdt : ''}" data-f="price_usdt"></label>
        <label class="field">Validity (din)<input type="number" inputmode="numeric" min="0" placeholder="30" value="${pl.days ?? ''}" data-f="days"></label>
        <label class="field">Delivery<select data-f="delivery"><option value="manual">Manual</option><option value="auto"${pl.delivery === 'auto' ? ' selected' : ''}>Auto (stock se)</option><option value="api"${pl.delivery === 'api' ? ' selected' : ''}>API (supplier se auto)</option></select></label>
      </div>
      <div class="plan-api" ${pl.delivery === 'api' ? '' : 'hidden'}>
        <label class="field">Supplier action<select data-f="api_action_id">${fulfilOptions(pl.api_action_id)}</select></label>
        <label class="field">Supplier SKU / product ID<input data-f="api_ref" value="${esc(pl.api_ref || '')}" placeholder="jaise NF-1M" maxlength="120"><small>Body mein {{item.api_ref}} isi se bharta hai</small></label>
        ${pl.api_cost != null ? `<p class="muted small m0">Supplier cost: ${pl.api_cost} • Supplier stock: ${pl.api_stock ?? '∞'}</p>` : ''}
      </div>
      <div class="plan-foot">
        ${pl.id ? `<button type="button" class="btn btn-ghost sm" data-stock="${pl.id}">Stock: ${pl.stock_left ?? 0} bache →</button>` : '<span class="muted small">Save ke baad stock daal sakte ho</span>'}
        <button type="button" class="link danger-link" data-rm>Plan hatao</button>
      </div>`;
    d.querySelector('[data-rm]').onclick = () => d.remove();
    d.querySelector('[data-f=delivery]').onchange = e => { d.querySelector('.plan-api').hidden = e.target.value !== 'api'; if (e.target.value === 'api' && !fulfilActions.length) toast('Pehle Integrations → API connection + "Order delivery" action banao'); };
    d.querySelector('[data-stock]')?.addEventListener('click', () => openStock(editing, pl));
    $('#planRows').append(d);
  }
  $('#addPlan').onclick = () => planRow({ days: 30 });

  async function openProduct(p) {
    editing = p; imageData = null; removeImage = false;
    await loadFulfil();
    $('#pDup').hidden = !p;
    $('#pdTitle').textContent = p ? 'Product edit karo' : 'Naya product';
    $('#p_name').value = p?.name || ''; $('#p_category').value = p?.category || '';
    $('#p_description').value = p?.description || ''; $('#p_details').value = p?.details || '';
    $('#p_color').value = p?.color || '#5A2DF4'; $('#p_tag').value = p?.tag || '';
    $('#p_sort').value = p?.sort ?? products.length; $('#p_active').checked = p ? p.active : true;
    $('#planRows').innerHTML = ''; (p?.plans?.length ? p.plans : [{ days: 30 }]).forEach(planRow);
    $('#pDelete').hidden = !p; showErr($('#pErr'));
    renderImgPrev();
    drawer('#productDrawer', true); $('#p_name').focus();
  }
  $('#pdForm').onsubmit = async e => {
    e.preventDefault();
    const body = {
      name: $('#p_name').value, category: $('#p_category').value, description: $('#p_description').value, details: $('#p_details').value,
      color: $('#p_color').value, tag: $('#p_tag').value, sort: $('#p_sort').value, active: $('#p_active').checked,
      plans: $$('#planRows .plan-block').map(r => ({ id: r.dataset.id || null, ...Object.fromEntries($$('[data-f]', r).map(i => [i.dataset.f, i.value])) })),
    };
    if (imageData) body.image_data = imageData;
    if (removeImage) body.remove_image = true;
    const btn = $('#pSave'); btn.disabled = true; btn.textContent = 'Save ho raha hai…';
    try {
      const r = await call(editing ? `/api/admin/products/${editing.id}` : '/api/admin/products', { method: editing ? 'PUT' : 'POST', body });
      toast('Product save ho gaya'); await loadProducts();
      openProduct(products.find(x => x.id === r.id));   // naye plans ke stock buttons dikh jayein
    } catch (ex) { showErr($('#pErr'), ex.message); }
    btn.disabled = false; btn.textContent = 'Save karo';
  };
  $('#pDup').onclick = async () => {
    try { const r = await call(`/api/admin/products/${editing.id}/duplicate`, { method: 'POST', body: {} }); toast('Copy ban gayi (Hidden) — naam/price badal ke Live karo'); await loadProducts(); openProduct(products.find(x => x.id === r.id)); }
    catch (ex) { toast(ex.message); }
  };
  let delArmed = false;
  $('#pDelete').onclick = async () => {
    const b = $('#pDelete');
    if (!delArmed) { delArmed = true; b.textContent = 'Pakka? Dobara dabao'; setTimeout(() => { delArmed = false; b.textContent = 'Delete'; }, 3500); return; }
    delArmed = false; b.textContent = 'Delete';
    try { await call(`/api/admin/products/${editing.id}`, { method: 'DELETE', body: {} }); toast('Product delete ho gaya'); drawer('#productDrawer', false); loadProducts(); }
    catch (ex) { showErr($('#pErr'), ex.message); }
  };

  // ---------- Stock ----------
  async function openStock(p, pl) {
    $('#skTitle').textContent = `Stock • ${p.name} (${pl.label})`;
    const body = $('#skBody');
    body.innerHTML = '<p class="muted">Load ho raha hai…</p>';
    drawer('#stockDrawer', true);
    const render = async () => {
      let s; try { s = await call(`/api/admin/plans/${pl.id}/stock`); } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
      body.innerHTML = `
        ${pl.delivery !== 'auto' ? '<div class="setup"><strong>Ye plan abhi Manual hai.</strong> Stock tabhi apne aap jayega jab plan ka Delivery "Auto" ho (product edit → Delivery → Auto → Save).</div>' : ''}
        <form id="skForm" class="stack" novalidate>
          <label class="field">Naye items paste karo<textarea id="skText" placeholder="user1@mail.com | Pass@123&#10;user2@mail.com | Pass@456 | Profile 2"></textarea>
            <small>Accounts ke liye: har line "email | password" (teesra hissa note). Keys ya links ke liye neeche "Har line ek item" chuno.</small></label>
          <label class="field">Items kaise alag hain<select id="skSep"><option value="pair">Email | Password (har line ek account)</option><option value="line">Har line ek item (key / link / code)</option><option value="blank">Khaali line se alag (kai lines ka ek item)</option></select></label>
          <button class="btn btn-ink" type="submit">Stock mein daalo</button>
        </form>
        <h3 class="h3">Available (${s.free.length})</h3>
        <ul class="stock-list">${s.free.map(r => `<li><pre>${esc(r.content)}</pre><button class="icon-btn" data-del="${r.id}" aria-label="Hatao">${icons.x}</button></li>`).join('') || '<li class="muted">Stock khaali hai.</li>'}</ul>
        ${s.used.length ? `<h3 class="h3">Diye ja chuke (${s.used.length})</h3><ul class="stock-list used">${s.used.map(r => `<li><pre>${esc(r.content)}</pre><span class="mono small">${esc(r.order_code)}</span></li>`).join('')}</ul>` : ''}`;
      $('#skForm').onsubmit = async e => {
        e.preventDefault();
        try { const r = await call(`/api/admin/plans/${pl.id}/stock`, { method: 'POST', body: { text: $('#skText').value, separator: $('#skSep').value } }); toast(`${r.added} items add hue`); render(); loadProducts(); }
        catch (ex) { toast(ex.message); }
      };
      $$('[data-del]', body).forEach(b => { b.onclick = async () => { try { await call(`/api/admin/stock/${b.dataset.del}`, { method: 'DELETE', body: {} }); render(); loadProducts(); } catch (ex) { toast(ex.message); } }; });
    };
    render();
  }

  // ---------- Customers ----------
  let cqT; $('#cq').oninput = () => { clearTimeout(cqT); cqT = setTimeout(loadCustomers, 250); };
  async function loadCustomers() {
    let list; try { list = await call(`/api/admin/customers?q=${encodeURIComponent($('#cq').value.trim())}`); } catch (e) { toast(e.message); return; }
    $('#custTbl tbody').innerHTML = list.length ? list.map(c => `<tr data-email="${esc(c.email)}" tabindex="0">
      <td><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></td><td class="mono">${esc(c.phone || '—')}</td>
      <td class="r mono">${c.orders}</td><td class="r mono">${inr(c.spent)}</td>
      <td class="muted">${fmtDate(c.created_at)}</td><td class="muted">${c.last_login ? fmtTime(c.last_login) : '—'}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="6">Abhi koi customer account nahi.</td></tr>';
  }
  $('#custTbl tbody').addEventListener('click', e => { const r = e.target.closest('tr[data-email]'); if (r) { orderFilter = ''; orderQ = r.dataset.email; $('#oq').value = orderQ; go('orders'); } });

  // ---------- Coupons ----------
  async function loadCoupons() {
    try { coupons = (await call('/api/admin/coupons')).filter(c => c.note !== 'newsletter' && c.note !== 'referral'); } catch (e) { toast(e.message); return; }
    $('#couponTbl tbody').innerHTML = coupons.length ? coupons.map(c => `<tr data-cid="${c.id}" tabindex="0">
      <td><strong class="mono">${esc(c.code)}</strong>${c.email ? `<br><small class="muted">${c.note === 'newsletter' ? 'Newsletter • ' : ''}sirf ${esc(c.email)}${c.first_order ? ' • pehla order' : ''}</small>` : ''}</td>
      <td>${c.kind === 'percent' ? `${c.value}%${c.max_discount ? ` (max ${inr(c.max_discount)})` : ''}` : inr(c.value)}</td>
      <td class="mono">${c.min_total ? inr(c.min_total) : '—'}</td>
      <td class="mono">${c.used}${c.max_uses ? ' / ' + c.max_uses : ''}</td>
      <td class="muted">${c.expires_at ? fmtDate(c.expires_at) : '—'}</td>
      <td>${c.active ? '<span class="st delivered">Active</span>' : '<span class="st off">Off</span>'}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="6">Koi coupon nahi. "+ Naya coupon" se banao, jaise SASTA10.</td></tr>';
    $('#couponTbl tbody').insertAdjacentHTML('beforeend', '<tr class="empty-row"><td colspan="6">Newsletter ke WELCOME-… aur referral ke REWARD-… codes yahan nahi dikhte — woh Newsletter / Referrals tab mein hain.</td></tr>');
  }
  let editingC = null;
  function openCoupon(c) {
    editingC = c;
    $('#cpTitle').textContent = c ? `Coupon ${c.code}` : 'Naya coupon';
    $('#c_code').value = c?.code || ''; $('#c_kind').value = c?.kind || 'percent'; $('#c_value').value = c?.value ?? 10;
    $('#c_min').value = c?.min_total ?? 0; $('#c_maxd').value = c?.max_discount ?? 0; $('#c_uses').value = c?.max_uses ?? 0;
    const exp = c?.expires_at ? new Date(c.expires_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '';
    $('#c_exp').value = exp; $('#c_active').checked = c ? c.active : true;
    $('#cDelete').hidden = !c; showErr($('#cErr'));
    drawer('#couponDrawer', true); $('#c_code').focus();
  }
  $('#newCoupon').onclick = () => openCoupon(null);
  $('#couponTbl tbody').addEventListener('click', e => { const r = e.target.closest('tr[data-cid]'); if (r) openCoupon(coupons.find(c => c.id === +r.dataset.cid)); });
  $('#cpForm').onsubmit = async e => {
    e.preventDefault(); showErr($('#cErr'));
    const body = { code: $('#c_code').value, kind: $('#c_kind').value, value: $('#c_value').value, min_total: $('#c_min').value, max_discount: $('#c_maxd').value, max_uses: $('#c_uses').value, expires_at: $('#c_exp').value, active: $('#c_active').checked };
    try { await call(editingC ? `/api/admin/coupons/${editingC.id}` : '/api/admin/coupons', { method: editingC ? 'PUT' : 'POST', body }); toast('Coupon save ho gaya'); drawer('#couponDrawer', false); loadCoupons(); }
    catch (ex) { showErr($('#cErr'), ex.message); }
  };
  $('#cDelete').onclick = async () => {
    try { await call(`/api/admin/coupons/${editingC.id}`, { method: 'DELETE', body: {} }); toast('Coupon delete ho gaya'); drawer('#couponDrawer', false); loadCoupons(); }
    catch (ex) { showErr($('#cErr'), ex.message); }
  };

  // ---------- Settings ----------
  const S_KEYS = ['store_name', 'tagline', 'announcement', 'upi_id', 'upi_name', 'upi_label', 'whatsapp', 'support_email'];
  async function loadSettings() {
    try { settings = await call('/api/admin/settings'); } catch (e) { toast(e.message); return; }
    for (const k of S_KEYS) $('#s_' + k).value = settings[k] || '';
    $('#s_pay_upi').checked = settings.pay_upi === '1';
    $('#s_otp_login').checked = settings.otp_login === '1';
    $('#s_pay_crypto').checked = settings.pay_crypto === '1';
    $('#s_bharatpe_auto').checked = settings.bharatpe_auto === '1';
    loadBharatpe();
    $('#s_usdt_inr_rate').value = settings.usdt_inr_rate || '';
    renderPayConn();
    const st = await call('/api/admin/stats').catch(() => null);
    const i = st?.integrations || {};
    const row = (ok, name, hint) => `<li class="${ok ? 'ok' : 'no'}"><span class="dot"></span><div><strong>${name}</strong><small>${ok ? 'Connected' : hint}</small></div></li>`;
    $('#integr').innerHTML = [
      row(i.crypto_configured, 'Crypto (Get It Sasta Pay)', 'PAY_URL + PAY_API_KEY + PAY_WEBHOOK_SECRET daalo'),
      row(i.email, `Emails + OTP${i.email_via ? ' (' + i.email_via + ')' : ''}`, 'RESEND_API_KEY + MAIL_FROM daalo'),
      row(i.admin_2fa, 'Admin 2-step OTP', 'ADMIN_EMAIL daalo (email chalu hona chahiye)'),
      row(i.telegram, 'Telegram order alerts', 'TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (optional)'),
      row(i.public_url, 'Site URL', 'PUBLIC_URL daalo'),
    ].join('');
    call('/api/admin/chats').then(c => {
      const st = c.status, open = c.chats.filter(x => x.status === 'human').length;
      $('#integr').insertAdjacentHTML('beforeend', `<li class="${st.ready && !st.error ? 'ok' : 'no'}"><span class="dot"></span><div><strong>Live chat → Telegram</strong><small>${st.ready ? (st.error ? esc(st.error) : `Connected • ${open} open chat • Telegram par message ka Reply karo`) : 'Naya bot banao (BotFather) → SUPPORT_BOT_TOKEN + SUPPORT_CHAT_ID daalo'}</small></div></li>`);
    }).catch(() => {});
    $('#webhookBox').innerHTML = '';
    $('#dataDir').textContent = `Data folder: ${settings.data_dir}`;
    renderQr(); loadMail(); loadFx();
  }

  // ---------- Emails: budget + har mail ON/OFF ----------
  const MAIL_HELP = {
    otp: 'Customer ka login / email verify / password reset code. OFF = customer sirf password se login kar payega, "password bhool gaye" nahi chalega. ON rakho.',
    admin_otp: 'Aapke admin login ka 2-step code (ADMIN_EMAIL par). OFF = sirf password se admin login — kam safe. ON rakho; mahine mein 10–30 mail hi lagte hain.',
    order_placed: 'Order banate hi "payment karo" mail. Customer us waqt screen par hi hota hai, isliye OFF rakhna best — sabse zyada mail yahi bachata hai.',
    order_paid: 'Payment confirm hone ki receipt + order link. Customer ka bharosa badhta hai. ON rakho (har paid order par 1).',
    order_delivered: 'Delivery ho gayi — login details / key dekhne ka link. Sabse zaroori; ON rakho (har order par 1).',
    welcome: 'Newsletter join karne par WELCOME code ka mail. OFF karo to code popup par hi dikhta hai (copy + "Cart mein lagao"), mail nahi jaata.',
    referral: 'Dost ne aapke referral se kharida → refer karne wale ko reward code ka mail. OFF karo to code sirf uske account → "Refer & earn" mein dikhta hai.',
    campaign: 'Aap jab Newsletter tab se naya product / offer bhejte ho. Har bhejne par = jitne subscribers utne mail. Limit ke paas ho to OFF.',
  };
  const GROUP = { essential: 'Zaroori (login)', order: 'Order updates', marketing: 'Marketing (newsletter)' };
  let mailInfo = null;
  async function loadMail() {
    try { mailInfo = await call('/api/admin/mail'); } catch { return; }
    const u = mailInfo.usage, pct = Math.min(100, u.year / u.cap * 100);
    $('#s_mail_year_cap').value = u.cap; $('#s_mail_reserve').value = u.reserve;
    $('#mailMeter').innerHTML = '<i></i><b></b>';
    const bar = $('#mailMeter i'); bar.style.width = pct + '%'; bar.className = pct > 90 ? 'bad' : pct > 70 ? 'warn' : '';
    $('#mailMeter b').style.left = Math.max(0, (u.cap - u.reserve) / u.cap * 100) + '%';
    const n = x => x.toLocaleString('en-IN');
    const perMonth = Math.floor(u.left / Math.max(1, 12 - new Date().getMonth()));
    $('#mailUse').innerHTML = `Is saal <b>${n(u.year)}</b> / ${n(u.cap)} • is mahine ${n(u.month)} • bache <b>${n(u.left)}</b> (≈ ${n(perMonth)}/mahina). Newsletter ${n(u.marketing_left)} aur bhej sakte ho (${n(u.reserve)} zaroori mails ke liye bache rahenge — kaali line).${mailInfo.ready ? ` • Bhej raha hai: ${esc(mailInfo.via)}` : ' • <b class="err">Email abhi set nahi (RESEND_API_KEY + MAIL_FROM)</b>'}`;
    let last = '';
    $('#mailKinds').innerHTML = mailInfo.kinds.map(k => {
      const head = k.group !== last ? `<p class="mk-group">${GROUP[k.group]}</p>` : ''; last = k.group;
      return `${head}<label class="mk"><input type="checkbox" data-mk="${k.key}" ${k.on ? 'checked' : ''}><strong>${esc(k.label)}<span class="tag ${k.group}">${k.on ? 'ON' : 'OFF'}</span></strong><span class="n">${n(k.sent)} is saal</span><small>${esc(MAIL_HELP[k.kind] || '')}</small></label>`;
    }).join('');
    $('#mailKinds').onchange = e => { const t = e.target.closest('[data-mk]'); if (t) t.parentElement.querySelector('.tag').textContent = t.checked ? 'ON' : 'OFF'; };
  }
  $('#budgetForm').onsubmit = async e => {
    e.preventDefault();
    const body = { mail_year_cap: $('#s_mail_year_cap').value, mail_reserve: $('#s_mail_reserve').value };
    $$('[data-mk]').forEach(x => { body[x.dataset.mk] = x.checked; });
    try { settings = await call('/api/admin/settings', { method: 'PUT', body }); toast('Email settings save ho gayi'); loadMail(); } catch (ex) { toast(ex.message); }
  };

  // ---------- Currency + language ----------
  async function loadFx() {
    let fx; try { fx = await call('/api/admin/fx'); } catch { return; }
    const on = new Set(fx.list.map(c => c.code)), rate = Object.fromEntries(fx.list.map(c => [c.code, c.rate]));
    $('#curList').innerHTML = fx.all.map(c => `<label><input type="checkbox" data-cur="${c}" ${on.has(c) ? 'checked' : ''} ${c === 'INR' || c === 'USD' ? 'disabled' : ''}> ${c}${rate[c] && c !== 'USD' ? ` <small>$1 = ${rate[c]}</small>` : ''}</label>`).join('');
    $('#fxAt').textContent = fx.updated ? `Rates update: ${fmtTime(new Date(fx.updated).toISOString())}` : 'Rates abhi default hain (server start hote hi update honge).';
    $('#s_default_lang').value = settings.default_lang || 'en';
  }
  $('#curForm').onsubmit = async e => {
    e.preventDefault();
    const list = ['INR', 'USD', ...$$('[data-cur]').filter(x => x.checked && !x.disabled).map(x => x.dataset.cur)];
    try { settings = await call('/api/admin/settings', { method: 'PUT', body: { currencies_on: list.join(','), default_lang: $('#s_default_lang').value } }); toast('Currency settings save ho gayi'); loadFx(); } catch (ex) { toast(ex.message); }
  };
  $('#fxRefresh').onclick = async () => { try { await call('/api/admin/fx/refresh', { method: 'POST', body: {} }); toast('Rates update ho gaye'); loadFx(); } catch (ex) { toast(ex.message); } };

  // ---------- Referrals ----------
  const REF_KEYS = ['ref_friend_pct', 'ref_reward_pct', 'ref_reward_max', 'ref_days'];
  async function loadReferrals() {
    let d; try { [d, settings] = await Promise.all([call('/api/admin/referrals'), call('/api/admin/settings')]); } catch (e) { toast(e.message); return; }
    $('#s_ref_on').checked = settings.ref_on === '1';
    for (const k of REF_KEYS) $('#s_' + k).value = settings[k] || '';
    $('#refKpis').innerHTML = `
      <div class="kpi"><span class="l">Referral se orders</span><span class="v">${d.total}</span><span class="s">naye customers</span></div>
      <div class="kpi"><span class="l">Referral se kamai</span><span class="v">${inr(d.revenue)}</span><span class="s">dosto ke pehle order</span></div>
      <div class="kpi"><span class="l">Reward codes use hue</span><span class="v">${d.rewards_used}</span><span class="s">${d.total - d.rewards_used} abhi baaki</span></div>
      <div class="kpi"><span class="l">Status</span><span class="v">${settings.ref_on === '1' ? 'ON' : 'OFF'}</span><span class="s">dost ${settings.ref_friend_pct}% • reward ${settings.ref_reward_pct}%</span></div>`;
    $('#refTop').innerHTML = d.top.length ? d.top.map(t => `<li><span>${esc(t.referrer_email)}</span><span class="mono">${t.n} • ${inr(t.total)}</span></li>`).join('') : '<li class="muted">Abhi koi nahi.</li>';
    $('#refTbl tbody').innerHTML = d.rows.length ? d.rows.map(r => `<tr><td>${esc(r.referrer_email)}<br><small class="muted">${fmtDate(r.created_at)}</small></td><td>${esc(r.friend_email)}<br><small class="muted">${inr(r.order_total)}</small></td><td class="mono small">${esc(r.reward_code || '—')}${r.used ? ' ✓ used' : ''}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="3">Abhi tak koi referral order nahi.</td></tr>';
  }
  $('#refForm').onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(REF_KEYS.map(k => [k, $('#s_' + k).value || '0'])); body.ref_on = $('#s_ref_on').checked;
    try { settings = await call('/api/admin/settings', { method: 'PUT', body }); toast('Referral settings save ho gayi'); loadReferrals(); } catch (ex) { toast(ex.message); }
  };

  // ---------- Newsletter ----------
  const NL_KEYS = ['newsletter_pct', 'newsletter_max_off', 'newsletter_delay', 'newsletter_days'];
  let nlTimer;
  async function loadNewsletter() {
    let d; try { [d, settings] = await Promise.all([call('/api/admin/newsletter?q=' + encodeURIComponent($('#nlq').value.trim())), call('/api/admin/settings')]); } catch (e) { toast(e.message); return; }
    $('#s_newsletter_on').checked = settings.newsletter_on === '1';
    for (const k of NL_KEYS) $('#s_' + k).value = settings[k] || '';
    const n = x => Number(x).toLocaleString('en-IN');
    $('#nlKpis').innerHTML = `
      <div class="kpi"><span class="l">Active subscribers</span><span class="v">${n(d.active)}</span><span class="s">${n(d.week)} is hafte</span></div>
      <div class="kpi"><span class="l">Welcome code use hue</span><span class="v">${n(d.coupons_used)}</span><span class="s">pehle order par</span></div>
      <div class="kpi"><span class="l">Unsubscribed</span><span class="v">${n(d.unsubscribed)}</span><span class="s">inko mail nahi jaata</span></div>
      <div class="kpi ${d.can_send.ok ? '' : 'alert'}"><span class="l">Newsletter mail bache</span><span class="v">${n(d.budget.marketing_left)}</span><span class="s">${d.can_send.ok ? 'is saal' : d.can_send.why === 'off' ? 'Settings mein OFF hai' : 'limit khatam'}</span></div>`;
    $('#campBudget').innerHTML = `Ek baar bhejne par <b>${n(d.active)}</b> mail lagenge • newsletter ke liye bache <b>${n(d.budget.marketing_left)}</b>.${d.can_send.ok ? '' : ' <b class="err">Abhi nahi bhej sakte (Settings → Emails).</b>'}`;
    $('#subTbl tbody').innerHTML = d.subscribers.length ? d.subscribers.map(x => `<tr>
      <td>${esc(x.email)}${x.status !== 'active' ? ' <span class="st off">Unsub</span>' : ''}<br><small class="muted">${fmtDate(x.created_at)}${x.lang ? ' • ' + esc(x.lang) : ''}${x.country ? ' • ' + esc(x.country) : ''}</small></td>
      <td class="mono small">${x.coupon_code ? esc(x.coupon_code) + (x.coupon_used ? ' ✓ used' : '') : '—'}</td>
      <td>${x.status === 'active' ? `<button class="link danger-link" data-unsub="${x.id}">Hatao</button>` : ''}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="3">Abhi koi subscriber nahi. Store par popup ON hai to aane lagenge.</td></tr>';
    $('#campList').innerHTML = d.campaigns.length ? d.campaigns.map(c => `<li><strong>${esc(c.subject)}</strong><span class="mono small">${c.status === 'done' ? `${c.sent}/${c.recipients}` : c.status === 'failed' ? 'fail' : 'bhej rahe…'}</span><small>${fmtTime(c.created_at)}${c.failed ? ` • ${c.failed} fail` : ''}</small></li>`).join('') : '<li class="muted">Abhi tak koi nahi.</li>';
    const sel = $('#campProduct'), cur = sel.value;
    if (!products.length) products = await call('/api/admin/products').catch(() => []);
    sel.innerHTML = '<option value="">— Apna message likhna hai —</option>' + products.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    sel.value = cur;
  }
  $('#nlq').oninput = () => { clearTimeout(nlTimer); nlTimer = setTimeout(loadNewsletter, 300); };
  $('#subTbl tbody').addEventListener('click', async e => {
    const b = e.target.closest('[data-unsub]'); if (!b) return;
    try { await call(`/api/admin/newsletter/${b.dataset.unsub}/unsubscribe`, { method: 'POST', body: {} }); toast('Hata diya'); loadNewsletter(); } catch (ex) { toast(ex.message); }
  });
  $('#nlSetForm').onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(NL_KEYS.map(k => [k, $('#s_' + k).value || '0'])); body.newsletter_on = $('#s_newsletter_on').checked;
    try { settings = await call('/api/admin/settings', { method: 'PUT', body }); toast('Newsletter settings save ho gayi'); } catch (ex) { toast(ex.message); }
  };
  const campBody = () => ({ product_id: $('#campProduct').value || undefined, subject: $('#campSubject').value, title: $('#campTitle').value, intro: $('#campIntro').value, button_label: $('#campBtnLabel').value, button_url: $('#campBtnUrl').value });
  $('#campTestBtn').onclick = async () => {
    showErr($('#campErr'));
    try { const r = await call('/api/admin/newsletter/campaign', { method: 'POST', body: { ...campBody(), test_to: $('#campTest').value } }); toast(r.sent ? 'Test mail bheja' : 'Test mail nahi gaya'); loadNewsletter(); } catch (ex) { showErr($('#campErr'), ex.message); }
  };
  $('#campForm').onsubmit = async e => {
    e.preventDefault(); showErr($('#campErr'));
    const b = $('#campSend');
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Pakka? Dobara dabao — sabko jayega'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Sab subscribers ko bhejo'; }, 6000); return; }
    b.dataset.sure = ''; b.textContent = 'Sab subscribers ko bhejo'; b.disabled = true;
    try { const r = await call('/api/admin/newsletter/campaign', { method: 'POST', body: campBody() }); toast(`${r.recipients} subscribers ko bhej rahe hain`); loadNewsletter(); } catch (ex) { showErr($('#campErr'), ex.message); }
    b.disabled = false;
  };
  // ---------- BharatPe ----------
  let bpUuid = '';
  const bpRes = (msg, ok) => { const r = $('#bpRes'); r.textContent = msg || ''; r.className = 'small m0 ' + (ok === true ? 'ok-t' : ok === false ? 'err' : ''); };
  function renderBp(st) {
    $('#bpStatus').innerHTML = st.connected
      ? `${st.state === 'expired' ? '<b class="err">⚠️ Login expire ho gaya — dobara OTP se login karo.</b>' : '<b class="ok-t">✓ BharatPe juda hai</b>'} • ${esc(st.mobile)}${st.merchant_id ? ` • merchant ${esc(st.merchant_id)}` : ''} • ${st.auto ? 'Auto-verify ON' : 'Auto-verify OFF (neeche tick karke Save)'}`
      : 'BharatPe login nahi hai — UTR abhi haath se verify hote hain.';
    $('#bpLogin').hidden = st.connected && st.state !== 'expired';
    $('#bpActions').hidden = !st.connected;
  }
  async function loadBharatpe() { try { renderBp(await call('/api/admin/bharatpe')); } catch {} }
  $('#bpOtpBtn').onclick = async () => {
    bpRes('OTP bhej rahe hain…');
    try { const r = await call('/api/admin/bharatpe/otp', { method: 'POST', body: { mobile: $('#bpMobile').value.trim() } }); bpUuid = r.uuid; $('#bpOtpWrap').hidden = $('#bpVerifyBtn').hidden = false; $('#bpOtp').focus(); bpRes('BharatPe ne OTP bheja — daal ke "Login karo" dabao.', true); }
    catch (ex) { bpRes(ex.message, false); }
  };
  $('#bpVerifyBtn').onclick = async () => {
    try { const st = await call('/api/admin/bharatpe/verify', { method: 'POST', body: { uuid: bpUuid, otp: $('#bpOtp').value.trim() } }); $('#bpOtp').value = ''; $('#bpOtpWrap').hidden = $('#bpVerifyBtn').hidden = true; renderBp(st); bpRes('✓ Login ho gaya. Ab "Test" dabao, phir auto-verify tick karke Save.', true); }
    catch (ex) { bpRes(ex.message, false); }
  };
  $('#bpTest').onclick = async () => { bpRes('Check ho raha hai…'); try { const r = await call('/api/admin/bharatpe/test', { method: 'POST', body: {} }); renderBp(r); bpRes(r.message, true); } catch (ex) { bpRes(ex.message, false); loadBharatpe(); } };
  $('#bpRecheck').onclick = async () => { try { await call('/api/admin/bharatpe/recheck', { method: 'POST', body: {} }); bpRes('Pending UTR check ho gaye.', true); loadStats(); } catch (ex) { bpRes(ex.message, false); } };
  $('#bpLogout').onclick = async () => { try { renderBp(await call('/api/admin/bharatpe/logout', { method: 'POST', body: {} })); bpRes('BharatPe se logout ho gaya.'); } catch (ex) { bpRes(ex.message, false); } };

  function renderPayConn() {
    const box = $('#payConn');
    if (!settings.crypto_configured) { box.innerHTML = '<p class="muted m0 small">Crypto ke liye alag <b>Get It Sasta Pay</b> app chahiye. Uske panel → Stores (API) se key lo aur yahan env mein <code>PAY_URL</code>, <code>PAY_API_KEY</code>, <code>PAY_WEBHOOK_SECRET</code> daalo. Webhook URL: <code>' + esc(location.origin) + '/api/pay/webhook</code></p>'; return; }
    box.innerHTML = `<p class="muted m0 small">Pay app: <b class="mono">${esc(settings.pay_url)}</b>${settings.pay_webhook ? '' : ' • <b class="warn">PAY_WEBHOOK_SECRET nahi hai</b>'} • Webhook URL (Pay panel mein daalo): <code>${esc(location.origin)}/api/pay/webhook</code></p>
      <div class="row-gap"><button class="btn btn-ghost sm" type="button" id="payTest">Connection test</button><span class="small" id="payRes"></span></div>`;
    $('#payTest').onclick = async () => {
      const r0 = $('#payRes'); r0.textContent = 'Check ho raha hai…'; r0.className = 'small';
      try { const r = await call('/api/admin/pay/test', { method: 'POST', body: {} }); r0.className = 'small ok-t'; r0.textContent = r.methods.length ? `✓ Juda hai • ${r.methods.map(m => m.label).join(', ')}` : '✓ Juda hai, par Pay panel mein koi method ON nahi'; }
      catch (ex) { r0.className = 'small err'; r0.textContent = ex.message; }
    };
  }
  function renderQr() {
    $('#qrPreview').innerHTML = settings.upi_qr ? `<img src="${esc(settings.upi_qr)}" alt="UPI QR">` : '<span class="muted">Koi QR nahi</span>';
    $('#qrRemove').hidden = !settings.upi_qr;
  }
  $('#setForm').onsubmit = async e => {
    e.preventDefault(); showErr($('#sErr'));
    const body = Object.fromEntries(S_KEYS.map(k => [k, $('#s_' + k).value.trim()]));
    body.pay_upi = $('#s_pay_upi').checked; body.otp_login = $('#s_otp_login').checked;
    body.pay_crypto = $('#s_pay_crypto').checked; body.usdt_inr_rate = $('#s_usdt_inr_rate').value; body.bharatpe_auto = $('#s_bharatpe_auto').checked;
    try { settings = await call('/api/admin/settings', { method: 'PUT', body }); toast('Settings save ho gayi'); }
    catch (ex) { showErr($('#sErr'), ex.message); }
  };
  $('#qrFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 600 * 1024) { toast('QR image 600 KB se chhoti rakho'); return; }
    try { settings = await call('/api/admin/settings', { method: 'PUT', body: { upi_qr: await readFile(f) } }); renderQr(); toast('QR upload ho gaya'); } catch (ex) { toast(ex.message); }
  };
  $('#qrRemove').onclick = async () => { try { settings = await call('/api/admin/settings', { method: 'PUT', body: { upi_qr: '' } }); renderQr(); toast('QR hata diya'); } catch (ex) { toast(ex.message); } };
  $('#mailForm').onsubmit = async e => {
    e.preventDefault();
    try { const r = await call('/api/admin/test-email', { method: 'POST', body: { to: $('#testTo').value } }); toast(`Test email ${r.to} par bheja`); } catch (ex) { toast(ex.message); }
  };
  $('#pwForm').onsubmit = async e => {
    e.preventDefault(); showErr($('#pwErr'));
    try { await call('/api/admin/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNew').value } }); $('#pwCur').value = $('#pwNew').value = ''; toast('Password badal gaya'); }
    catch (ex) { showErr($('#pwErr'), ex.message); }
  };

  $('#adminLogoutAll').onclick = async () => { try { await call('/api/admin/logout-all', { method: 'POST', body: {} }); toast('Baaki devices se logout ho gaya'); } catch (ex) { toast(ex.message); } };

  setInterval(() => { if (!document.hidden && !$('#app').hidden) { loadStats(); if (tab === 'orders' && $('#orderDrawer').hidden) loadOrders(); } }, 45000);
  GIS.admin = { call, drawer, showErr, loadProducts: () => loadProducts(), get products() { return products; } };
  boot();
})();
