// Checkout page (/checkout): contact → payment method → place order. Right side: order summary.
(() => {
  const { $, $$, esc, store, api, toast, paint, tile, icons } = GIS;
  const t = (k, v) => GIS.t(k, v), money = (a, b) => GIS.money(a, b);
  const root = $('#co');
  let method = store.get('gis-paymethod', '');
  let built = false, placing = false, sumOpen = false;

  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const phoneOk = v => String(v).replace(/\D/g, '').length >= 10;

  function steps() {
    const s = [['co_step_cart', 'done'], ['co_step_details', 'now'], ['co_step_pay', ''], ['co_step_done', '']];
    return `<ol class="co-steps">${s.map(([k, c], i) => `<li class="${c}"><span class="n">${c === 'done' ? icons.check : i + 1}</span>${esc(t(k))}</li>`).join('<li class="sep" aria-hidden="true"></li>')}</ol>`;
  }

  function methods(d, T) {
    const p = d.payments || {}, intl = GIS.isIntl();
    const upiOk = p.upi && (!intl || !p.crypto);
    const opts = [];
    if (p.upi) opts.push({ id: 'upi', ok: upiOk, title: t('co_upi'), sub: t('co_upi_sub'), badge: `<span class="co-upi-mark">UPI</span>` });
    if (p.crypto) opts.push({ id: 'crypto', ok: true, title: t('co_crypto'), sub: (p.crypto_networks || []).map(n => n.label).join(' • ') || t('co_crypto_sub'), badge: `<span class="co-coin">${icons.coin}</span>` });
    if (!opts.length) return `<p class="err m0">${esc(t('co_no_method'))}</p>`;
    if (!opts.some(o => o.id === method && o.ok)) method = (opts.find(o => o.ok) || {}).id || '';
    const inrAmt = `₹${Number(T.total).toLocaleString('en-IN')}`, usdAmt = `$${T.totalU.toFixed(2)}`;
    return opts.map(o => `<label class="co-method ${o.ok ? '' : 'off'} ${method === o.id ? 'on' : ''}">
        <input type="radio" name="pm" value="${o.id}" ${method === o.id ? 'checked' : ''} ${o.ok ? '' : 'disabled'}>
        ${o.badge}
        <span class="co-m-txt"><strong>${esc(o.title)}</strong><small>${esc(o.sub)}</small>
          ${o.ok ? '' : `<small class="co-m-note">${esc(t('co_upi_inr'))} <button type="button" class="link" data-to-inr>${esc(t('co_switch_inr'))}</button></small>`}</span>
        <span class="co-m-amt amt">${o.id === 'upi' ? inrAmt : usdAmt}</span>
        <span class="co-radio" aria-hidden="true"></span>
      </label>`).join('');
  }

  function summary(st) {
    const { T, priced } = st;
    const n = T.ls.reduce((a, l) => a + l.qty, 0);
    const save = (T.mrp - T.sub) + T.disc;
    const saveU = Math.max(0, T.mrpU - T.subU) + T.discU;
    return `<div class="co-card co-sum">
      <div class="co-sum-head"><h2>${esc(t('co_summary'))} <span class="muted">· ${esc(GIS.loc.lang === 'en' || !GIS.loc.lang ? (n === 1 ? '1 item' : `${n} items`) : t('co_items', { n }))}</span></h2><button type="button" class="link" id="coEdit">${esc(t('co_edit'))}</button></div>
      <ul class="co-items">${T.ls.map(l => `<li>
        <div class="co-thumb">${tile(l.product)}${l.qty > 1 ? `<span class="q">${l.qty}</span>` : ''}</div>
        <div class="co-it"><strong>${esc(l.product.name)}</strong><small>${esc(l.plan.label)}${l.plan.instant ? ` · <b class="instant">${esc(t('instant'))}</b>` : ''}</small>
          <div class="qty sm"><button type="button" data-cq="${l.planId}" data-d="-1" aria-label="${esc(t('dec'))}">${icons.minus}</button><span>${l.qty}</span><button type="button" data-cq="${l.planId}" data-d="1" aria-label="${esc(t('inc'))}">${icons.plus}</button></div></div>
        <div class="co-pr"><span class="amt">${money(l.plan.price * l.qty, l.plan.usd * l.qty)}</span>${l.plan.mrp > l.plan.price ? `<s class="amt">${money(l.plan.mrp * l.qty, l.plan.usd_mrp * l.qty)}</s>` : ''}</div>
      </li>`).join('')}</ul>
      <div class="co-coupon">${GIS.cart.couponForm()}</div>
      <dl class="co-tot">
        <div><dt>${esc(t('subtotal'))}</dt><dd class="amt">${money(T.sub, T.subU)}</dd></div>
        ${T.disc ? `<div class="g"><dt>${esc(t('coupon'))} <span class="co-code">${esc(priced.coupon)}</span></dt><dd class="amt">−${money(T.disc, T.discU)}</dd></div>` : ''}
        <div class="co-grand"><dt>${esc(t('total'))}</dt><dd><span class="cur">${esc(GIS.loc.currency)}</span> <span class="amt big">${money(T.total, T.totalU)}</span></dd></div>
      </dl>
      ${save > 0 ? `<p class="co-save">${icons.tag}${esc(t('co_you_save', { x: GIS.money(save, saveU) }))}</p>` : ''}
      ${GIS.isIntl() && GIS.loc.currency !== 'USD' ? `<p class="usd-note m0">${esc(t('charged_usd', { usd: GIS.usdText(T.totalU) }))}</p>` : ''}
    </div>
    <ul class="co-trust">
      <li>${icons.shield}<div><strong>${esc(t('co_t1'))}</strong><small>${esc(t('co_t1p'))}</small></div></li>
      <li>${icons.bolt}<div><strong>${esc(t('co_t2'))}</strong><small>${esc(t('co_t2p'))}</small></div></li>
      <li>${icons.refresh}<div><strong>${esc(t('co_t3'))}</strong><small>${esc(t('co_t3p'))}</small></div></li>
    </ul>`;
  }

  function contact(d) {
    const c = d.customer, saved = store.get('gis-customer', {}), intl = GIS.isIntl();
    const phonePh = intl ? '+971 50 123 4567' : '98765 43210';
    const phone = `<label class="co-field"><span>${esc(t('mobile'))}</span><div class="co-in">${icons.phone}<input id="cPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="${phonePh}" value="${esc(c?.phone || saved.phone || '')}"></div><small>${esc(intl ? t('mobile_hint_intl') : t('co_wa'))}</small></label>`;
    if (c) return `<div class="co-who">${icons.user}<div><small>${esc(t('co_signed'))}</small><strong>${esc(c.name)}</strong><span>${esc(c.email)}</span></div><button type="button" class="link" id="coLogout">${esc(t('co_not_you'))} ${esc(t('co_logout'))}</button></div>${c.phone ? '' : phone}`;
    return `<label class="co-field"><span>${esc(t('email'))}</span><div class="co-in"><input id="cEmail" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(saved.email || '')}"></div><small>${esc(t('email_hint'))}</small></label>
      <div class="co-2">
        <label class="co-field"><span>${esc(t('name'))}</span><div class="co-in"><input id="cName" autocomplete="name" placeholder="Rahul Sharma" value="${esc(saved.name || '')}"></div></label>
        ${phone}
      </div>`;
  }

  function build() {
    const st = GIS.cart.state(), d = st.data;
    if (!d) return;
    if (!st.T.ls.length) {
      built = false;
      root.innerHTML = `<div class="wrap"><div class="co-empty">${icons.cart}<h1>${esc(t('co_empty'))}</h1><p class="muted">${esc(t('co_empty_p'))}</p><a class="btn btn-primary btn-lg" href="/#shop">${esc(t('see_products'))}</a></div></div>`;
      return;
    }
    $('#coSecure').innerHTML = `${icons.lock}<span>${esc(t('co_secure'))}</span>`;
    root.innerHTML = `<div class="wrap">
      <div class="co-top"><a class="co-back" href="/#shop">${icons.back}${esc(t('co_continue'))}</a>${steps()}</div>
      <button type="button" class="co-sum-toggle" id="coSumToggle" aria-expanded="false" aria-controls="coSide">
        <span>${icons.cart}<span id="coSumLbl">${esc(t('co_show'))}</span>${icons.chev}</span><b class="amt" id="coSumAmt"></b></button>
      <div class="co-grid">
        <form class="co-main" id="coForm" novalidate>
          <section class="co-card">
            <div class="co-card-head"><span class="co-num">1</span><div><h2>${esc(t('co_contact'))}</h2><p>${esc(t('co_contact_p'))}</p></div>
              ${d.customer ? '' : `<span class="co-acct">${esc(t('co_have_acct'))} <a href="/account?next=/checkout">${esc(t('co_login'))}</a></span>`}</div>
            <div class="co-fields" id="coContact">${contact(d)}</div>
          </section>
          <section class="co-card">
            <div class="co-card-head"><span class="co-num">2</span><div><h2>${esc(t('co_method'))}</h2><p>${esc(t('co_method_p'))}</p></div></div>
            <div class="co-methods" id="coMethods"></div>
          </section>
          <p class="err" id="cErr" hidden></p>
          <div class="co-pay">
            <div class="co-pay-sum"><small>${esc(t('co_total_due'))}</small><b class="amt" id="coDue"></b></div>
            <button class="btn btn-primary btn-lg co-place" id="placeOrder" type="submit">${icons.lock}<span id="placeLbl"></span><span class="co-place-amt" id="placeAmt"></span></button>
          </div>
          <p class="co-terms">${t('co_terms')}</p>
        </form>
        <aside class="co-side" id="coSide"></aside>
      </div></div>`;
    built = true;
    $('#coSumToggle').onclick = () => { sumOpen = !sumOpen; update(); };
    $('#coForm').onsubmit = place;
    $('#coLogout')?.addEventListener('click', async () => { try { await api('/api/account/logout', { method: 'POST', body: {} }); } catch {} location.reload(); });
    root.addEventListener('input', e => { const f = e.target.closest('.co-field'); if (f) f.classList.remove('bad'); });
    update();
  }

  function update() {
    if (!built) return build();
    const st = GIS.cart.state(), d = st.data;
    if (!st.T.ls.length) return build();
    $('#coSide').innerHTML = summary(st);
    $('#coSide').classList.toggle('open', sumOpen);
    $('#coSumToggle').setAttribute('aria-expanded', String(sumOpen));
    $('#coSumLbl').textContent = t(sumOpen ? 'co_hide' : 'co_show');
    $('#coSumToggle').classList.toggle('open', sumOpen);
    const total = money(st.T.total, st.T.totalU);
    $('#coSumAmt').textContent = total; $('#coDue').textContent = total;
    $('#placeLbl').textContent = t('co_pay_btn'); $('#placeAmt').textContent = `· ${total}`;
    $('#coMethods').innerHTML = methods(d, st.T);
    paint($('#coSide'));
    GIS.cart.wireCoupon($('#coSide'));
    $('#coEdit').onclick = () => GIS.cart.open(true);
    $$('[data-cq]').forEach(b => { b.onclick = () => GIS.cart.setQty(+b.dataset.cq, +b.dataset.d); });
    $$('input[name=pm]').forEach(r => { r.onchange = () => { method = r.value; store.set('gis-paymethod', method); update(); }; });
    $('[data-to-inr]')?.addEventListener('click', e => { e.preventDefault(); GIS.setLocale({ currency: 'INR' }); });
  }

  function bad(id, msg) {
    const f = $(id)?.closest('.co-field'); if (!f) return false;
    f.classList.add('bad'); f.querySelector('small.e')?.remove(); f.insertAdjacentHTML('beforeend', `<small class="e">${esc(msg)}</small>`);
    return true;
  }

  async function place(e) {
    e.preventDefault(); if (placing) return;
    const st = GIS.cart.state(), d = st.data, err = $('#cErr');
    const val = id => $(id)?.value.trim() || '';
    const cust = { name: val('#cName'), email: val('#cEmail'), phone: val('#cPhone') };
    err.hidden = true;
    let first = null;
    if (!d.customer) {
      if (!isEmail(cust.email) && bad('#cEmail', t('bad_email'))) first ||= '#cEmail';
      if (cust.name.length < 2 && bad('#cName', t('co_name_err'))) first ||= '#cName';
    }
    if ($('#cPhone') && !phoneOk(cust.phone) && bad('#cPhone', t('co_phone_err'))) first ||= '#cPhone';
    if (first) { $(first).focus(); return; }
    if (!method) { err.textContent = t('co_no_method'); err.hidden = false; return; }
    const btn = $('#placeOrder'); placing = true; btn.disabled = true; $('#placeLbl').textContent = t('placing'); $('#placeAmt').textContent = '';
    try {
      const r = await api('/api/orders', { method: 'POST', body: { ...cust, items: st.items, coupon: st.coupon, currency: GIS.loc.currency, lang: GIS.loc.lang } });
      if (!d.customer) store.set('gis-customer', cust);
      const orders = store.get('gis-orders', []).filter(o => o.code !== r.code);
      orders.unshift({ code: r.code, email: r.email, at: Date.now() });
      store.set('gis-orders', orders.slice(0, 30));
      try { sessionStorage.setItem('gis-paytab:' + r.code, method); } catch {}
      GIS.cart.clear();
      location.href = `/order/${encodeURIComponent(r.code)}`;
    } catch (ex) {
      placing = false; btn.disabled = false; update();
      err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (ex.status === 409) setTimeout(() => location.reload(), 1500);
    }
  }

  document.addEventListener('gis-cart', () => { if (GIS.cart?.state().data) update(); });
  document.addEventListener('gis-locale', () => {
    if (!GIS.cart?.state().data) return;
    const keep = Object.fromEntries(['#cEmail', '#cName', '#cPhone'].map(id => [id, $(id)?.value]));
    built = false; build();
    for (const [id, v] of Object.entries(keep)) if (v && $(id)) $(id).value = v;
  });
  GIS.storeData.then(build).catch(() => { root.innerHTML = `<div class="wrap"><p class="err">${esc(t('gen_err'))}</p></div>`; });
})();
