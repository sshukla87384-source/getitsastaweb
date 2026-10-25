// Order page: payment (BharatPe UPI / crypto), status, delivery
(() => {
  const { $, $$, inr, esc, store, api, copy, toast, fmtDate, fmtTime, daysLeft, icons, creds } = GIS;
  const t = (k, v) => GIS.t(k, v);
  // Order jis currency mein bana: INR = ₹, baaki = USD (USDT)
  const usdOrder = o => (o.currency || 'INR') !== 'INR';
  const omoney = (o, inrAmt, usd) => (usdOrder(o) ? GIS.usdText(usd) : inr(inrAmt));
  let payTab = null, ctPoll = null, ctTimer = null, ctPicking = false;
  try { payTab = sessionStorage.getItem('gis-paytab:' + decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '').toUpperCase()) || null; } catch {}
  const root = $('#order');
  const code = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '').toUpperCase();
  let email = (store.get('gis-orders', []).find(o => o.code === code) || {}).email || new URLSearchParams(location.search).get('email') || '';
  let pollTimer, order;

  const STEPS = [['awaiting_payment', 'st_pay'], ['verifying', 'st_verify'], ['paid', 'st_proc'], ['delivered', 'st_done']];

  function askEmail(msg) {
    root.innerHTML = `<div class="panel prose narrow">
      <h1>${esc(t('order'))} ${esc(code)}</h1>
      <p class="muted">${t('order_email_ask')}</p>
      <form id="ef" class="stack" novalidate>
        <label class="field">${esc(t('email'))}<input id="ee" type="email" autocomplete="email" required value="${esc(email)}"></label>
        ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
        <button class="btn btn-primary" type="submit">${esc(t('see_order'))}</button>
      </form></div>`;
    $('#ef').onsubmit = e => { e.preventDefault(); email = $('#ee').value.trim(); load(); };
  }

  function remember() {
    const list = store.get('gis-orders', []).filter(o => o.code !== code);
    list.unshift({ code, email: email || order.email, at: Date.now() });
    store.set('gis-orders', list.slice(0, 30));
  }

  const timeline = status => {
    if (status === 'cancelled') return '';
    const i = STEPS.findIndex(s => s[0] === status);
    return `<ol class="timeline" aria-label="Order status">${STEPS.map((s, j) => `<li class="${j < i || status === 'delivered' ? 'done' : j === i ? 'now' : ''}">${esc(t(s[1]))}</li>`).join('')}</ol>`;
  };

  function codesBlock(o) {
    return o.items.filter(i => i.auto_content).map(i => creds(i.auto_content, `${i.product_name} • ${i.plan_label}`)).join('');
  }
  const lockedBlock = () => `<div class="status-box paid"><strong>${icons.lock} ${esc(t('login_to_see'))}</strong>
    <p>${esc(t('locked_p'))}</p>
    <a class="btn btn-ink" href="/account?next=${encodeURIComponent(location.pathname)}">${esc(t('login'))}</a></div>`;

  function payBlock(o) {
    const p = o.payment || {};
    const usd = usdOrder(o);
    const parts = [`<h2 class="h3 m0">${esc(t('pay_now'))}</h2>
      <div class="amount"><span class="big">${omoney(o, o.total, Number(o.usdt_total))}</span>${o.discount ? `<span class="tag-off">${usd ? esc(t('coupon')) + ' ✓' : esc(t('coupon_off', { x: inr(o.discount) }))}</span>` : ''}</div>
      ${usd && p.intl ? `<p class="muted m0 small">${esc(t('intl_note'))}</p>` : ''}`];
    const upiInner = u => `<div class="pay-opt upi-flow">
        <div class="pay-opt-head"><span class="co-upi-mark">UPI</span><div><strong>${esc(p.upi_label || 'UPI')}</strong><span class="muted small">${esc(t('upi_apps'))}</span></div></div>
        <div class="uf-step"><span class="uf-n">1</span><div class="uf-body"><b>${esc(t('uf_pay', { x: inr(o.total) }))}</b>
          <a class="btn btn-primary btn-block btn-lg" href="${esc(u.link)}">${icons.phone}${esc(t('open_upi'))}</a>
          ${u.qr ? `<div class="qr"><img src="${esc(u.qr)}" alt="UPI QR code"></div><p class="muted m0 center small">${t('scan_qr', { x: inr(o.total) })}</p>` : ''}
          <div class="payrow"><div><span>${esc(t('or_upi_id', { x: inr(o.total) }))}</span><code>${esc(u.upi_id)}</code></div><button class="btn btn-ghost sm" id="copyUpi" type="button">${icons.copy}${esc(t('copy'))}</button></div></div></div>
        <form id="utrForm" class="uf-step" novalidate><span class="uf-n">2</span><div class="uf-body">
          <label class="co-field" for="utr"><span>${esc(t('utr_label'))}</span>
            <div class="co-in"><input id="utr" inputmode="numeric" autocomplete="off" placeholder="${esc(t('utr_ph'))}" required maxlength="22"></div>
            <small>${esc(t('utr_hint'))}</small></label>
          <p class="err m0" id="utrErr" hidden></p>
          <button class="btn btn-ink btn-block btn-lg" type="submit" id="utrBtn">${icons.check}${esc(t('i_paid'))}</button></div>
        </form></div>`;
    payTab ||= o.crypto?.started || usd ? 'crypto' : p.upi ? 'upi' : 'crypto';
    if (p.upi && p.crypto) parts.push(`<div class="seg pay-seg" role="tablist">
        <button role="tab" data-pay="upi" aria-selected="${payTab === 'upi'}">${esc(p.upi_label || 'UPI')}</button>
        <button role="tab" data-pay="crypto" aria-selected="${payTab === 'crypto'}">${icons.coin}${esc(t('crypto_tab'))}</button></div>`);
    if (p.upi && (payTab === 'upi' || !p.crypto)) parts.push(upiInner(p.upi));
    if (p.crypto && (payTab === 'crypto' || !p.upi)) parts.push(cryptoTerminal(o, p));
    if (!p.crypto && !p.upi) parts.push(`<p class="err">${esc(t('pay_off'))}</p>`);
    return parts.join('');
  }

  // ---------- Crypto: Get It Sasta Pay (alag secure pay page) ----------
  function cryptoTerminal(o, p) {
    const c = o.crypto || {};
    const nets = (p.crypto_networks || []).map(m => `<span class="ct-chip">${esc(m.label)}</span>`).join('');
    return `<div class="ct" id="ct">
      <div class="ct-head"><span class="ct-title">${icons.coin} ${esc(t('crypto_tab'))}</span><span class="ct-live"><i></i>Live</span></div>
      <div class="ct-amount"><span class="ct-k">${esc(t('approx_amt'))}</span>
        <div class="ct-amt-row"><span class="ct-amt mono">${esc(c.amount || c.usdt)}</span><span class="ct-cur">USDT</span></div>
        <span class="ct-note">${t('exact_note', { x: esc(c.usdt) })}</span></div>
      ${nets ? `<div class="ct-chips">${nets}</div>` : ''}
      <button class="btn btn-primary btn-block" type="button" id="ctPay">${esc(t(c.started ? 'reopen_pay' : 'pay_crypto'))}</button>
      ${c.started ? `<button class="btn btn-ghost btn-block" type="button" id="ctCheck">${esc(t('check_paid'))}</button>` : ''}
      <p class="muted m0 small">${t('crypto_help')}</p>
    </div>`;
  }

  function wireCrypto(o) {
    clearInterval(ctPoll); clearInterval(ctTimer);
    $$('[data-pay]').forEach(b => { b.onclick = () => { payTab = b.dataset.pay; render(order); }; });
    const check = async quiet => {
      try { const r = await api(`/api/orders/${encodeURIComponent(code)}/crypto/check`, { method: 'POST', body: { email } }); if (r.status !== 'awaiting_payment') { clearInterval(ctPoll); toast(t('paid_toast')); load(); return true; } }
      catch (ex) { if (!quiet) toast(ex.message); return false; }
      if (!quiet) toast(t('not_yet'));
      return false;
    };
    $('#ctPay')?.addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = t('opening_pay');
      try { const r = await api(`/api/orders/${encodeURIComponent(code)}/crypto`, { method: 'POST', body: { email } }); location.href = r.pay_url; }
      catch (ex) { toast(ex.message); b.disabled = false; b.textContent = t('pay_crypto'); }
    });
    $('#ctCheck')?.addEventListener('click', async e => { const b = e.currentTarget; b.disabled = true; await check(false); b.disabled = false; });
    if ($('#ct') && o.crypto?.started) {
      check(true);
      ctPoll = setInterval(() => { if (!document.hidden) check(true); }, 15000);
    }
  }

  function render(o) {
    order = o;
    document.title = `Order ${o.code} • ${o.store_name || 'Get It Sasta'}`;
    const help = `https://wa.me/${encodeURIComponent(o.whatsapp)}?text=${encodeURIComponent(t('wa_msg', { c: o.code }))}`;
    let main = '';
    if (o.status === 'awaiting_payment') main = payBlock(o);
    else if (o.status === 'verifying') main = `<div class="status-box verifying"><strong><span class="pulse"></span>${esc(t('verifying_t'))}</strong>
        <p>${t('verifying_p', { u: `<span class="mono">${esc(o.utr)}</span>` })}</p></div>`;
    else if (o.locked) main = lockedBlock();
    else if (o.status === 'paid') main = `<div class="status-box paid"><strong>${esc(t('paid_t'))}</strong>
        <p>${esc(t('paid_p'))}</p></div>${codesBlock(o)}`;
    else if (o.status === 'delivered') main = `<div class="status-box delivered"><strong>${esc(t('deliv_t'))}</strong><p>${esc(t('deliv_p'))}</p></div>
        ${codesBlock(o)}
        ${o.delivery ? creds(o.delivery, t('delivery_details')) : ''}
        ${o.pay_method === 'crypto' && o.crypto?.amount ? `<p class="muted m0 small">${esc(t('crypto_paid'))}: ${esc(o.crypto.amount)} USDT${o.crypto.ref ? ` • ${esc(o.crypto.ref.split(':').pop().slice(0, 18))}…` : ''}</p>` : ''}
        ${o.items.some(i => i.expires_at) ? `<div class="expiry-list">${o.items.filter(i => i.expires_at).map(i => { const d = daysLeft(i.expires_at); return `<div><span>${esc(i.product_name)}</span><span class="${d <= 5 ? 'warn' : ''}">${d > 0 ? esc(t('days_left', { d, date: fmtDate(i.expires_at) })) : esc(t('expired'))}</span></div>`; }).join('')}</div>` : ''}`;
    else main = `<div class="status-box cancelled"><strong>${esc(t('cancelled_t'))}</strong><p>${esc(t('cancelled_p'))}</p></div>`;

    root.innerHTML = `
      <div class="order-head"><div><p class="eyebrow">${fmtTime(o.created_at)}</p><h1>${o.status === 'delivered' ? esc(t('thanks', { n: o.name.split(' ')[0] })) : esc(t('your_order'))}</h1></div><span class="code">${esc(o.code)}</span></div>
      ${timeline(o.status)}
      <div class="order-grid">
        <section class="panel stack">${main}</section>
        <aside class="side">
          <div class="panel"><h2 class="h3">${esc(t('summary'))}</h2>
            <ul class="items-list">${o.items.map(i => `<li><span>${esc(i.product_name)} <span class="muted">• ${esc(i.plan_label)}${i.qty > 1 ? ' × ' + i.qty : ''}</span></span><span class="amt">${omoney(o, i.price * i.qty, i.usd * i.qty)}</span></li>`).join('')}
            ${o.discount ? `<li class="save"><span>${esc(t('coupon'))} ${esc(o.coupon_code)}</span><span>${usdOrder(o) ? '✓' : '−' + inr(o.discount)}</span></li>` : ''}
            <li class="t"><span>${esc(t('total'))}</span><span class="amt">${omoney(o, o.total, Number(o.usdt_total))}</span></li></ul></div>
          <div class="panel stack"><h2 class="h3 m0">${esc(t('need_help'))}</h2>
            <a class="btn btn-wa" href="${esc(help)}" target="_blank" rel="noopener">${esc(t('wa_chat'))}</a>
            <p class="muted m0">${esc(t('or_email'))} <span class="mono">${esc(o.support_email || '')}</span></p>
            <p class="muted m0">${esc(t('all_orders'))} <a href="/account">${esc(t('my_dashboard'))}</a></p></div>
        </aside>
      </div>`;

    $('#copyUpi')?.addEventListener('click', e => copy(o.payment.upi.upi_id, e.currentTarget));
    $('#utrForm')?.addEventListener('submit', submitUtr);
    if (o.status === 'awaiting_payment') wireCrypto(o); else { clearInterval(ctPoll); clearInterval(ctTimer); }

    clearTimeout(pollTimer);
    if (o.status === 'verifying' || o.status === 'paid') pollTimer = setTimeout(() => load(true), 15000);
  }

  async function submitUtr(e) {
    e.preventDefault();
    const btn = $('#utrBtn'), err = $('#utrErr');
    err.hidden = true; btn.disabled = true; btn.textContent = t('submitting');
    try {
      await api(`/api/orders/${encodeURIComponent(code)}/utr`, { method: 'POST', body: { email, utr: $('#utr').value } });
      load();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = t('i_paid'); }
  }

  async function load(quiet) {
    if (!code) return askEmail();
    try {
      const o = await api(`/api/orders/${encodeURIComponent(code)}?email=${encodeURIComponent(email)}`);
      if (!email) email = o.email;
      remember(); render(o);
    } catch (e) {
      if (quiet) { pollTimer = setTimeout(() => load(true), 30000); return; }
      askEmail(email ? e.message : '');
    }
  }
  document.addEventListener('gis-locale', () => { if (order) render(order); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && order && order.status !== 'delivered') load(true); });
  load();
})();
