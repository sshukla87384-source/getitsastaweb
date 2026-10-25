(() => {
  const { $, $$, esc, api, toast, copy, time, ICON } = GSP;
  let tab = 'dash', filter = '', S = null;
  const STATUS = { pending: 'Pending', confirming: 'Confirming', review: 'Check karo', paid: 'Paid', expired: 'Expired', cancelled: 'Cancelled' };
  const MLABEL = { binance: 'Binance Pay', trc20: 'USDT · TRC20', bep20: 'USDT · BEP20', polygon: 'USDT · Polygon' };
  const pill = s => `<span class="pill ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
  const showErr = (el, m) => { el.textContent = m || ''; el.hidden = !m; };
  async function call(url, opts) { try { return await api(url, opts); } catch (e) { if (e.status === 401 && !/login/.test(url)) boot(); throw e; } }

  // ---------- Auth ----------
  async function boot() {
    try { const me = await api('/api/admin/me'); $('#who').textContent = me.username; $('#login').hidden = true; $('#app').hidden = false; go(location.hash.slice(1) || 'dash'); }
    catch { $('#app').hidden = true; $('#login').hidden = false; $('#lp').focus(); }
  }
  $('#loginForm').onsubmit = async e => {
    e.preventDefault(); showErr($('#lErr'));
    const b = $('#lBtn'); b.disabled = true;
    try { await api('/api/admin/login', { method: 'POST', body: { username: $('#lu').value, password: $('#lp').value } }); $('#lp').value = ''; boot(); }
    catch (ex) { showErr($('#lErr'), ex.message); }
    b.disabled = false;
  };
  $('#logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST', body: {} }).catch(() => {}); boot(); };

  // ---------- Tabs ----------
  function go(t) {
    if (!['dash', 'payments', 'methods', 'stores', 'settings'].includes(t)) t = 'dash';
    tab = t; history.replaceState(null, '', '#' + t);
    $$('#tabs button').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $$('[data-view]').forEach(v => { v.hidden = v.dataset.view !== t; });
    ({ dash: loadDash, payments: loadInvoices, methods: loadMethods, stores: loadClients, settings: loadSettings })[t]();
  }
  $$('#tabs button').forEach(b => { b.onclick = () => go(b.dataset.tab); });
  $$('[data-refresh]').forEach(b => { b.onclick = () => { go(tab); toast('Refresh ho gaya'); }; });

  // ---------- Dashboard ----------
  async function loadDash() {
    let o; try { o = await call('/api/admin/overview'); } catch (e) { toast(e.message); return; }
    $('#navReview').textContent = o.review; $('#navReview').hidden = !o.review;
    const ready = o.methods.filter(m => m.ready);
    const todo = [];
    if (!ready.length) todo.push('<b>Methods</b> mein kam se kam ek method ON karo (Binance Pay ya USDT BEP20 / TRC20).');
    if (!o.clients) todo.push('<b>Stores (API)</b> mein apna store jodo aur API key store ke env mein daalo.');
    if (!o.public_url) todo.push('Environment mein <code>PUBLIC_URL</code> daalo (jaise https://pay.getitsasta.com), warna payment link galat ban sakta hai.');
    if (o.webhook_failed) todo.push(`${o.webhook_failed} webhook store tak nahi pahunche — Payments mein dekho aur "Webhook dobara bhejo" dabao.`);
    $('#setup').hidden = !todo.length;
    $('#setup').innerHTML = `<strong>Setup baaki hai</strong><ul>${todo.map(t => `<li>${t}</li>`).join('')}</ul>`;
    $('#kpis').innerHTML = `
      <div class="kpi"><span class="l">Paid (24 ghante)</span><span class="v">${o.paid24}</span><span class="s">${esc(o.paid24_usdt)} USDT</span></div>
      <button class="kpi ${o.review ? 'alert' : ''}" type="button" data-goto="payments" data-filter="review"><span class="l">Check karne hain</span><span class="v">${o.review}</span><span class="s">amount match nahi / manual</span></button>
      <div class="kpi"><span class="l">Khule payments</span><span class="v">${o.open}</span><span class="s">pending + confirming</span></div>
      <div class="kpi"><span class="l">Methods live</span><span class="v">${ready.length}/4</span><span class="s">${ready.map(m => esc(MLABEL[m.key])).join(', ') || 'koi nahi'}</span></div>`;
    let list = []; try { list = await call('/api/admin/invoices?status=review'); } catch {}
    $('#reviewList').innerHTML = list.length ? `<div class="mini-list">${list.slice(0, 8).map(i => `<button class="mini" type="button" data-inv="${esc(i.id)}">
        <span><b class="mono">${esc(i.order_id)}</b> • ${esc(i.client)}<br><small>${esc(i.review_reason)}</small></span><span class="mono">${esc(i.paid_amount || i.amount)}</span></button>`).join('')}</div>`
      : '<p class="empty">Sab saaf hai — koi payment check karne ko nahi. ✓</p>';
    bindGoto(); $$('[data-inv]').forEach(b => { b.onclick = () => openInv(b.dataset.inv); });
  }
  function bindGoto() { $$('[data-goto]').forEach(b => { b.onclick = () => { if (b.dataset.filter !== undefined) setFilter(b.dataset.filter); go(b.dataset.goto); }; }); }

  // ---------- Payments ----------
  function setFilter(f) { filter = f; $$('#chips button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.st === f))); }
  $$('#chips button').forEach(b => { b.onclick = () => { setFilter(b.dataset.st); loadInvoices(); }; });
  let qt; $('#q').oninput = () => { clearTimeout(qt); qt = setTimeout(loadInvoices, 250); };
  async function loadInvoices() {
    let list; try { list = await call(`/api/admin/invoices?status=${encodeURIComponent(filter)}&q=${encodeURIComponent($('#q').value.trim())}`); } catch (e) { toast(e.message); return; }
    $('#invTbl tbody').innerHTML = list.length ? list.map(i => `<tr data-inv="${esc(i.id)}" tabindex="0">
      <td>${time(i.created_at)}<small>${esc(i.client)}</small></td>
      <td><b class="mono">${esc(i.order_id)}</b><small>${esc(i.customer_email || i.id)}</small></td>
      <td class="r mono">${esc(i.amount)}${i.paid_amount && i.paid_amount !== i.amount ? `<small>aaya ${esc(i.paid_amount)}</small>` : ''}</td>
      <td>${esc(MLABEL[i.method] || '—')}</td>
      <td>${pill(i.status)}${i.manual ? '<small>haath se</small>' : ''}</td>
      <td class="mono tx">${esc(i.tx || '—')}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Koi payment nahi mila.</td></tr>';
    $$('#invTbl tbody tr[data-inv]').forEach(r => { r.onclick = () => openInv(r.dataset.inv); r.onkeydown = e => { if (e.key === 'Enter') openInv(r.dataset.inv); }; });
  }

  // ---------- Invoice drawer ----------
  const drawer = open => { $('#drawer').hidden = !open; document.body.style.overflow = open ? 'hidden' : ''; };
  $('#dClose').onclick = () => drawer(false);
  $('#drawer').onclick = e => { if (e.target.id === 'drawer') drawer(false); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawer').hidden) drawer(false); });
  async function openInv(id) {
    let i; try { i = await call(`/api/admin/invoices/${encodeURIComponent(id)}`); } catch (e) { toast(e.message); return; }
    $('#dTitle').textContent = i.order_id;
    const act = [];
    if (i.raw_status === 'review') act.push('<button class="btn btn-primary" data-act="approve">✓ Approve — Paid karo</button>');
    if (['pending', 'expired', 'confirming'].includes(i.raw_status) || (i.status === 'expired')) act.push('<button class="btn btn-ink" data-act="paid">Haath se Paid karo</button>');
    if (['review', 'expired', 'cancelled'].includes(i.raw_status) || i.status === 'expired') act.push('<button class="btn btn-ghost" data-act="reopen">Dobara kholo</button>');
    if (i.raw_status === 'paid') act.push('<button class="btn btn-ghost" data-act="resend">Webhook dobara bhejo</button>');
    if (!['paid', 'cancelled'].includes(i.raw_status)) act.push('<button class="btn btn-danger" data-act="cancel">Cancel</button>');
    $('#dBody').innerHTML = `
      <div class="spread"><span class="big-amt">${esc(i.amount)} <small class="muted">USDT</small></span>${pill(i.status)}</div>
      ${i.review_reason ? `<p class="reason m0">${esc(i.review_reason)}</p>` : ''}
      <dl class="kv">
        <dt>Store</dt><dd>${esc(i.client)}</dd>
        <dt>Order</dt><dd class="mono">${esc(i.order_id)}</dd>
        <dt>Invoice</dt><dd class="mono">${esc(i.id)} <a href="/i/${esc(i.id)}" target="_blank" rel="noopener">page ↗</a></dd>
        <dt>Store ne maanga</dt><dd class="mono">${esc(i.base)} USDT</dd>
        <dt>Method</dt><dd>${esc(MLABEL[i.method] || '—')}</dd>
        ${i.address ? `<dt>${i.method === 'binance' ? 'Pay ID' : 'Address'}</dt><dd class="mono">${esc(i.address)}</dd>` : ''}
        ${i.tx ? `<dt>${i.method === 'binance' ? 'Order ID' : 'TxID'}</dt><dd class="mono">${i.explorer ? `<a href="${esc(i.explorer)}" target="_blank" rel="noopener">${esc(i.tx)}</a>` : esc(i.tx)}</dd>` : ''}
        ${i.paid_amount ? `<dt>Aaya</dt><dd class="mono">${esc(i.paid_amount)} USDT${i.paid_amount !== i.amount ? ' ⚠️' : ' ✓'}</dd>` : ''}
        ${i.tx_from ? `<dt>Bhejne wala</dt><dd class="mono">${esc(i.tx_from)}</dd>` : ''}
        ${i.method && i.method !== 'binance' && i.tx ? `<dt>Confirmations</dt><dd>${i.confirmations}/${i.needed}</dd>` : ''}
        <dt>Customer</dt><dd>${esc(i.customer_email || '—')}</dd>
        <dt>Bana</dt><dd>${time(i.created_at)}</dd>
        ${i.paid_at ? `<dt>Paid</dt><dd>${time(i.paid_at)}${i.manual ? ' (haath se)' : ''}</dd>` : ''}
        ${i.note ? `<dt>Note</dt><dd>${esc(i.note)}</dd>` : ''}
      </dl>
      ${act.length ? `<label class="field">Note (haath se Paid / cancel ke liye)<input id="aNote" placeholder="jaise Binance internal transfer, 21 Oct 7:40 pm"></label><div class="actions">${act.join('')}</div><p class="err" id="aErr" hidden></p>` : ''}
      <h3 class="h3">Webhooks</h3>
      ${i.webhooks.length ? `<ul class="timeline">${i.webhooks.map(w => `<li class="${w.status === 'sent' ? 'paid' : w.status === 'failed' ? 'review' : ''}">${esc(w.event)} • <b>${esc(w.status)}</b> • ${w.attempts} try${w.last_code ? ` • HTTP ${w.last_code}` : ''}${w.status !== 'sent' ? ` <button class="link" data-retry="${w.id}">dobara bhejo</button>` : ''}<small>${time(w.created_at)}${w.last_error ? ' • ' + esc(w.last_error) : ''}</small></li>`).join('')}</ul>` : '<p class="muted m0">Abhi koi nahi.</p>'}
      <h3 class="h3">History</h3>
      <ul class="timeline">${i.events.map(e => `<li class="${esc(e.kind)}">${esc(e.message)}<small>${time(e.created_at)} • ${esc(e.kind)}</small></li>`).join('')}</ul>`;
    $$('#dBody [data-act]').forEach(b => { b.onclick = async () => {
      showErr($('#aErr'));
      const action = b.dataset.act;
      if (action === 'cancel' && !confirmTwice(b)) return;
      try { await call(`/api/admin/invoices/${encodeURIComponent(i.id)}/action`, { method: 'POST', body: { action, note: $('#aNote')?.value || '' } }); toast('Ho gaya'); openInv(i.id); if (tab === 'payments') loadInvoices(); if (tab === 'dash') loadDash(); }
      catch (ex) { showErr($('#aErr'), ex.message); }
    }; });
    $$('#dBody [data-retry]').forEach(b => { b.onclick = async () => { try { const r = await call(`/api/admin/webhooks/${b.dataset.retry}/retry`, { method: 'POST', body: {} }); toast(r.status === 'sent' ? 'Webhook pahunch gaya ✓' : 'Abhi bhi fail: ' + (r.last_error || '')); openInv(i.id); } catch (ex) { toast(ex.message); } }; });
    drawer(true); $('#dClose').focus();
  }
  // "Cancel" do baar dabana (browser confirm dialog nahi)
  function confirmTwice(b) {
    if (b.dataset.sure) return true;
    b.dataset.sure = '1'; b.textContent = 'Pakka? Dobara dabao';
    setTimeout(() => { delete b.dataset.sure; b.textContent = 'Cancel'; }, 4000);
    return false;
  }

  // ---------- Methods ----------
  const HELP = {
    binance: `<details class="help"><summary>Binance API key kaise banayein</summary><ul>
      <li>Binance (KYC wala account) → Profile → <b>API Management</b> → Create API → "System generated".</li>
      <li>Permission: sirf <b>Enable Reading</b>. Withdraw / Trading kabhi ON mat karna.</li>
      <li><b>Restrict access to trusted IPs</b> mein apne server ka IP daalo (Hostinger hPanel mein milta hai).</li>
      <li>Pay ID: Binance app → Pay → upar apna <b>Pay ID</b> (number).</li></ul></details>`,
    trc20: `<details class="help"><summary>Provider examples</summary><ul>
      <li><b>TronGrid</b>: URL <code>https://api.trongrid.io</code>, header <code>TRON-PRO-API-KEY</code>, key trongrid.io se (free).</li>
      <li>NOWNodes: URL <code>https://trx.nownodes.io</code>, header <code>api-key</code>.</li>
      <li>Apna java-tron node: <code>http://ip:8090</code>, header khaali.</li>
      <li>Address: Trust Wallet → USDT (TRC20) → Receive, ya Binance → Deposit → USDT → TRX network.</li></ul></details>`,
    evm: `<details class="help"><summary>Provider examples</summary><ul>
      <li>Ankr / QuickNode / Alchemy: dashboard se poora URL copy karo (key URL mein hoti hai), header khaali.</li>
      <li>NOWNodes: <code>https://bsc.nownodes.io</code> / <code>https://matic.nownodes.io</code>, header <code>api-key</code>.</li>
      <li>Public (free, dheema): <code>https://bsc-dataseed.bnbchain.org</code>, <code>https://polygon-rpc.com</code>.</li>
      <li>Address: Trust Wallet → USDT (BNB Smart Chain / Polygon) → Receive — 0x… wala.</li></ul></details>`,
  };
  async function loadMethods() {
    try { S = await call('/api/admin/settings'); } catch (e) { toast(e.message); return; }
    const card = k => {
      const c = S.methods[k], isB = k === 'binance';
      const st = c.ready ? '<span class="state-dot live"><i></i>Live</span>' : c.on ? '<span class="state-dot half"><i></i>Details baaki</span>' : '<span class="state-dot"><i></i>Off</span>';
      const f = (name, label, opts = {}) => `<label class="field">${label}<input data-f="${name}" class="${opts.mono ? 'mono-in' : ''}" ${opts.type ? `type="${opts.type}"` : ''} value="${esc(c[name] ?? '')}" placeholder="${esc(opts.ph || '')}" spellcheck="false" autocomplete="off">${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
      return `<form class="panel mcard" data-m="${k}" novalidate>
        <div class="mcard-head"><div><h2 class="h3">${esc(MLABEL[k])}</h2><p class="muted small">${isB ? 'Customer Binance app se Pay ID par bhejta hai, <b>Order ID</b> daalta hai.' : 'Customer is address par bhejta hai, <b>TxID</b> daalta hai.'}</p></div>${st}</div>
        <label class="toggle"><input type="checkbox" data-f="on" ${c.on ? 'checked' : ''}> Customers ko dikhao (ON)</label>
        ${isB ? `<div class="grid2">${f('pay_id', 'Binance Pay ID', { mono: true, ph: '123456789' })}${f('name', 'Naam (customer ko dikhega)', { ph: 'Get It Sasta' })}</div>
          ${f('api_key', 'API key', { mono: true })}${f('api_secret', 'Secret key', { mono: true, type: 'password', hint: 'Sirf "Enable Reading" wali key. Save ke baad chhupi rahegi.' })}
          ${f('url', 'Binance API URL', { mono: true, hint: 'Normal: https://api.binance.com' })}`
        : `${f('address', 'Aapka receive address', { mono: true, ph: k === 'trc20' ? 'T…' : '0x…', hint: 'Binance deposit address ya Trust Wallet address' })}
          ${f('url', 'Provider URL', { mono: true, ph: 'https://…' })}
          <div class="grid2">${f('header', 'API key header', { mono: true, ph: k === 'trc20' ? 'TRON-PRO-API-KEY' : '(khaali)' })}${f('key', 'API key', { mono: true, type: 'password' })}</div>
          ${f('confirmations', 'Confirmations', { type: 'number', hint: k === 'trc20' ? '19 ≈ 1 minute' : k === 'bep20' ? '15 ≈ 45 second' : '64 ≈ 2 minute' })}`}
        ${HELP[isB ? 'binance' : k === 'trc20' ? 'trc20' : 'evm']}
        <p class="test-res" data-res></p><p class="err" data-err hidden></p>
        <div class="row"><button class="btn btn-ghost" type="button" data-test>Test connection</button><button class="btn btn-primary" type="submit">Save</button></div>
      </form>`;
    };
    $('#methodsGrid').innerHTML = ['binance', 'bep20', 'trc20', 'polygon'].map(card).join('');
    $$('#methodsGrid form').forEach(form => {
      const k = form.dataset.m;
      const vals = () => Object.fromEntries($$('[data-f]', form).map(i => [i.dataset.f, i.type === 'checkbox' ? i.checked : i.value.trim()]));
      form.onsubmit = async e => {
        e.preventDefault(); showErr($('[data-err]', form));
        try { S = await call('/api/admin/settings', { method: 'PUT', body: { methods: { [k]: vals() } } }); toast(`${MLABEL[k]} save ho gaya`); loadMethods(); }
        catch (ex) { showErr($('[data-err]', form), ex.message); }
      };
      $('[data-test]', form).onclick = async () => {
        const out = $('[data-res]', form); out.className = 'test-res'; out.textContent = 'Check ho raha hai…';
        const v = vals(); delete v.on;
        try { const r = await call(`/api/admin/test/${k}`, { method: 'POST', body: v }); out.classList.add('ok'); out.textContent = r.message; }
        catch (ex) { out.classList.add('bad'); out.textContent = ex.message; }
      };
    });
  }

  // ---------- Stores ----------
  async function loadClients() {
    let list; try { list = await call('/api/admin/clients'); } catch (e) { toast(e.message); return; }
    $('#clients').innerHTML = list.map(c => `<form class="panel client" data-c="${c.id}" novalidate>
      <div class="spread"><h2 class="h3">${esc(c.name)}</h2><span class="pill ${c.active ? 'paid' : ''}">${c.active ? 'Active' : 'Band'}</span></div>
      <dl class="kv"><dt>API key</dt><dd class="mono">${esc(c.key_prefix)}…</dd><dt>Bana</dt><dd>${time(c.created_at)}</dd><dt>Last use</dt><dd>${time(c.last_used_at)}</dd></dl>
      <label class="field">Webhook URL<input data-hook class="mono-in" value="${esc(c.webhook_url)}" placeholder="https://getitsasta.com/api/pay/webhook"></label>
      <label class="toggle"><input type="checkbox" data-active ${c.active ? 'checked' : ''}> Active</label>
      <p class="test-res" data-res></p>
      <div class="row"><button class="btn btn-primary sm" type="submit">Save</button><button class="btn btn-ghost sm" type="button" data-ping>Test webhook</button>
        <button class="btn btn-ghost sm" type="button" data-rot="key">Nayi API key</button><button class="btn btn-ghost sm" type="button" data-rot="secret">Naya webhook secret</button></div>
    </form>`).join('') || '<p class="empty">Abhi koi store nahi juda.</p>';
    $$('#clients form').forEach(f => {
      const id = f.dataset.c, out = $('[data-res]', f);
      f.onsubmit = async e => { e.preventDefault(); try { await call(`/api/admin/clients/${id}`, { method: 'PUT', body: { webhook_url: $('[data-hook]', f).value.trim(), active: $('[data-active]', f).checked } }); toast('Save ho gaya'); loadClients(); } catch (ex) { out.className = 'test-res bad'; out.textContent = ex.message; } };
      $('[data-ping]', f).onclick = async () => { out.className = 'test-res'; out.textContent = 'Bhej raha hai…'; try { const r = await call(`/api/admin/clients/${id}/test-webhook`, { method: 'POST', body: {} }); out.classList.add('ok'); out.textContent = r.message; } catch (ex) { out.classList.add('bad'); out.textContent = ex.message; } };
      $$('[data-rot]', f).forEach(b => { b.onclick = async () => {
        if (!b.dataset.sure) { b.dataset.sure = '1'; const t = b.textContent; b.textContent = 'Pakka? Purani band ho jayegi'; setTimeout(() => { delete b.dataset.sure; b.textContent = t; }, 4000); return; }
        try { const r = await call(`/api/admin/clients/${id}/rotate`, { method: 'POST', body: { what: b.dataset.rot } }); showSecrets(r, f.querySelector('h2').textContent); loadClients(); } catch (ex) { toast(ex.message); }
      }; });
    });
  }
  function showSecrets(r, name) {
    const box = $('#secretBox');
    const row = (label, v, env) => `<div class="field">${label}<div class="secret"><code>${esc(v)}</code><button class="icon-btn" type="button" data-copy="${esc(v)}" aria-label="Copy">${ICON.copy}</button></div><small>Store ke environment variable <code>${env}</code> mein daalo.</small></div>`;
    box.innerHTML = `<h2 class="h3">🔑 ${esc(name)} — ye abhi copy kar lo</h2><p class="m0 small muted">Ye dobara kabhi nahi dikhega. Kho gaya to "Nayi API key" se nayi bana lena.</p>
      ${r.api_key ? row('API key', r.api_key, 'PAY_API_KEY') : ''}${r.webhook_secret ? row('Webhook secret', r.webhook_secret, 'PAY_WEBHOOK_SECRET') : ''}
      <button class="btn btn-ghost sm" type="button" id="secretDone">Copy kar liya, chhupao</button>`;
    box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $$('[data-copy]', box).forEach(b => { b.onclick = () => copy(b.dataset.copy); });
    $('#secretDone').onclick = () => { box.hidden = true; box.innerHTML = ''; };
  }
  $('#clientForm').onsubmit = async e => {
    e.preventDefault(); showErr($('#cErr'));
    try { const r = await call('/api/admin/clients', { method: 'POST', body: { name: $('#cName').value, webhook_url: $('#cHook').value.trim() } }); $('#cName').value = $('#cHook').value = ''; showSecrets(r, r.name); loadClients(); }
    catch (ex) { showErr($('#cErr'), ex.message); }
  };

  // ---------- Settings ----------
  async function loadSettings() {
    try { S = await call('/api/admin/settings'); } catch (e) { toast(e.message); return; }
    $('#sBrand').value = S.brand_name; $('#sSupport').value = S.support_contact; $('#sMin').value = S.invoice_minutes; $('#sLate').value = S.late_hours;
  }
  $('#genForm').onsubmit = async e => {
    e.preventDefault(); showErr($('#sErr'));
    try { S = await call('/api/admin/settings', { method: 'PUT', body: { brand_name: $('#sBrand').value, support_contact: $('#sSupport').value, invoice_minutes: $('#sMin').value, late_hours: $('#sLate').value } }); toast('Save ho gaya'); }
    catch (ex) { showErr($('#sErr'), ex.message); }
  };
  $('#pwForm').onsubmit = async e => {
    e.preventDefault(); showErr($('#pwErr'));
    try { await call('/api/admin/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNew').value } }); $('#pwCur').value = $('#pwNew').value = ''; toast('Password badal gaya'); }
    catch (ex) { showErr($('#pwErr'), ex.message); }
  };

  setInterval(() => { if (!document.hidden && !$('#app').hidden && $('#drawer').hidden) { if (tab === 'dash') loadDash(); if (tab === 'payments') loadInvoices(); } }, 30000);
  boot();
})();
