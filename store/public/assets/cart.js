// Cart + checkout drawer — har customer page par chalta hai
(() => {
  const { $, $$, esc, store, api, toast, paint, tile, icons } = GIS;
  const t = (k, v) => GIS.t(k, v), money = (a, b) => GIS.money(a, b);

  let data = null, priced = null, priceErr = '';
  let cart = store.get('gis-cart', []);
  let coupon = store.get('gis-coupon', '');
  const index = new Map();

  GIS.storeData = api('/api/store').then(d => {
    data = d;
    for (const p of d.products) for (const pl of p.plans) index.set(pl.id, { product: p, plan: pl });
    cart = cart.filter(c => index.has(c.planId));
    save();
    renderAccountLink();
    if (d.settings.announcement && $('#announce')) $('#announce').textContent = d.settings.announcement;
    $$('[data-support-email]').forEach(el => { el.textContent = d.settings.support_email; });
    render();
    return d;
  });
  GIS.storeData.catch(() => {});

  function renderAccountLink() {
    const a = $('#acctLink'); if (!a) return;
    const c = data?.customer;
    a.innerHTML = `${icons.user}<span>${c ? esc(c.name.split(' ')[0]) : esc(t('login'))}</span>`;
    a.setAttribute('aria-label', c ? t('my_account') : t('login_or_signup'));
  }

  // ---------- Drawer markup ----------
  if (!$('#drawer')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="scrim" id="scrim" hidden></div>
      <aside class="drawer" id="drawer" hidden aria-label="Cart" aria-modal="true" role="dialog">
        <header><h2 id="drawerTitle"></h2><button class="icon-btn" id="closeCart" aria-label="Close">${icons.x}</button></header>
        <div class="body" id="cartBody"></div>
        <footer id="cartFoot"></footer>
      </aside>`);
  }

  const save = () => { store.set('gis-cart', cart); store.set('gis-coupon', coupon); };
  const lines = () => cart.map(c => ({ ...c, ...index.get(c.planId) })).filter(l => l.plan);
  const count = () => cart.reduce((a, c) => a + c.qty, 0);

  function localTotals() {
    const ls = lines();
    const sub = ls.reduce((a, l) => a + l.plan.price * l.qty, 0);
    const mrp = ls.reduce((a, l) => a + l.plan.mrp * l.qty, 0);
    const disc = priced && priced.subtotal === sub ? priced.discount : 0;
    // USD (crypto) — server jaisa: har plan ka USD, coupon usi % se, cent tak upar
    const subU = Math.round(ls.reduce((a, l) => a + l.plan.usd * 100 * l.qty, 0)) / 100;
    const mrpU = Math.round(ls.reduce((a, l) => a + l.plan.usd_mrp * 100 * l.qty, 0)) / 100;
    const totalU = sub ? Math.max(0.1, Math.ceil(Math.round(subU * 100) * (sub - disc) / sub) / 100) : 0;
    return { ls, sub, mrp, disc, total: sub - disc, subU, mrpU, totalU, discU: Math.round((subU - totalU) * 100) / 100 };
  }

  let priceT;
  function reprice() {
    clearTimeout(priceT);
    if (!coupon || !cart.length) { priced = null; priceErr = ''; return; }
    priceT = setTimeout(async () => {
      const em = data?.customer?.email || store.get('gis-customer', {}).email || '';
      try { priced = await api('/api/cart/price', { method: 'POST', body: { items: cart, coupon, email: em } }); priceErr = ''; }
      catch (e) { priced = null; priceErr = e.message; }
      render();
    }, 150);
  }

  function add(planId, btn) {
    const e = index.get(planId);
    if (!e) return;
    if (!e.plan.in_stock) { toast(t('oos_toast')); return; }
    const ex = cart.find(c => c.planId === planId);
    const qty = (ex?.qty || 0) + 1;
    if (e.plan.stock_left !== null && qty > e.plan.stock_left) { toast(t('only_left', { n: e.plan.stock_left })); return; }
    if (ex) ex.qty = Math.min(10, qty); else cart.push({ planId, qty: 1 });
    save(); reprice(); render();
    const cb = $('#openCart'); if (cb) { cb.classList.remove('bump'); void cb.offsetWidth; cb.classList.add('bump'); }
    if (btn) { const o = btn.innerHTML; btn.classList.add('done'); btn.innerHTML = `${icons.check}${esc(t('added'))}`; setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = o; }, 1300); }
  }

  const couponForm = () => `<form class="coupon" data-coupon-form novalidate>
      <label class="sr" for="couponIn">${esc(t('coupon_ph'))}</label>
      <span class="ico">${icons.tag}</span>
      <input data-coupon-in placeholder="${esc(t('coupon_ph'))}" value="${esc(coupon)}" autocomplete="off" autocapitalize="characters" ${coupon ? 'readonly' : ''}>
      ${coupon ? `<button type="button" class="link" data-coupon-rm>${esc(t('remove'))}</button>` : `<button class="link" type="submit">${esc(t('apply'))}</button>`}
    </form>${priceErr ? `<p class="err m0">${esc(priceErr)}</p>` : ''}`;
  function wireCoupon(scope) {
    const f = scope.querySelector('[data-coupon-form]'); if (!f) return;
    f.onsubmit = e => { e.preventDefault(); coupon = f.querySelector('[data-coupon-in]').value.trim().toUpperCase(); save(); reprice(); };
    f.querySelector('[data-coupon-rm]')?.addEventListener('click', () => { coupon = ''; priced = null; priceErr = ''; save(); render(); });
  }

  function render() {
    $$('.cart-count').forEach(el => { el.textContent = count(); });
    document.dispatchEvent(new CustomEvent('gis-cart'));
    const body = $('#cartBody'), foot = $('#cartFoot');
    if (!body) return;
    const T = localTotals();

    if (!T.ls.length) {
      $('#drawerTitle').textContent = t('your_cart');
      body.innerHTML = `<div class="cart-empty">${icons.cart}<p>${t('cart_empty')}</p></div>`;
      foot.innerHTML = `<a class="btn btn-ghost btn-block" href="/#shop" data-close>${esc(t('see_products'))}</a>`;
      return;
    }

    const intl = GIS.isIntl();
    const summary = `<div class="sum">
      <div><span>${esc(t('subtotal'))}</span><span class="mono">${money(T.sub, T.subU)}</span></div>
      ${T.mrp > T.sub ? `<div class="save"><span>${esc(t('mrp_save'))}</span><span class="mono">${money(T.mrp - T.sub, Math.max(0, T.mrpU - T.subU))}</span></div>` : ''}
      ${T.disc ? `<div class="save"><span>${esc(t('coupon'))} ${esc(priced.coupon)}</span><span class="mono">−${money(T.disc, T.discU)}</span></div>` : ''}
      <div class="total"><span>${esc(t('total'))}</span><span>${money(T.total, T.totalU)}</span></div>
      ${intl && GIS.loc.currency !== 'USD' ? `<div class="usd-note"><span>${esc(t('charged_usd', { usd: GIS.usdText(T.totalU) }))}</span></div>` : ''}</div>`;

    $('#drawerTitle').textContent = `${t('your_cart')} (${count()})`;
    body.innerHTML = T.ls.map(l => `<div class="line">
        ${tile(l.product)}
        <div class="info"><strong>${esc(l.product.name)}</strong><small>${esc(l.plan.label)} • ${money(l.plan.price, l.plan.usd)}${l.plan.instant ? ` • <b class="instant">${esc(t('instant'))}</b>` : ''}</small></div>
        <div class="qty"><button data-dec="${l.planId}" aria-label="${esc(t('dec'))}">${icons.minus}</button><span>${l.qty}</span><button data-inc="${l.planId}" aria-label="${esc(t('inc'))}">${icons.plus}</button></div>
      </div>`).join('') + couponForm();
    foot.innerHTML = summary + `<a class="btn btn-primary btn-block btn-lg" id="toCheckout" href="/checkout">${icons.lock}${esc(t('checkout_btn'))}</a>
      <p class="muted m0 center small">${esc(t(intl ? 'next_pay_intl' : 'next_pay'))}</p>`;
    wireCoupon(body);
    paint(body);
  }

  // ---------- Open / close ----------
  let lastFocus;
  function open(v = true) {
    $('#drawer').hidden = !v; $('#scrim').hidden = !v;
    document.body.classList.toggle('no-scroll', v);
    if (v) { lastFocus = document.activeElement; reprice(); render(); $('#closeCart').focus(); }
    else lastFocus?.focus?.();
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-inc],[data-dec],[data-close],#openCart,#closeCart,#scrim');
    if (!t) return;
    if (t.id === 'openCart') { e.preventDefault(); open(true); }
    else if (t.id === 'closeCart' || t.id === 'scrim' || t.hasAttribute('data-close')) open(false);
    else if (t.dataset.inc) setQty(+t.dataset.inc, 1);
    else if (t.dataset.dec) setQty(+t.dataset.dec, -1);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawer').hidden) open(false); });
  window.addEventListener('storage', e => { if (e.key === 'gis-cart') { cart = store.get('gis-cart', []); render(); } });

  // Login ke baad checkout par wapas
  if (new URLSearchParams(location.search).get('checkout') === '1') location.replace('/checkout');

  document.addEventListener('gis-locale', () => { renderAccountLink(); render(); });
  const setQty = (planId, d) => {
    const c = cart.find(x => x.planId === planId); if (!c) return;
    const e2 = index.get(planId);
    if (d > 0) { if (e2.plan.stock_left === null || c.qty < e2.plan.stock_left) c.qty = Math.min(10, c.qty + 1); else toast(t('only_left', { n: e2.plan.stock_left })); }
    else if (--c.qty <= 0) cart = cart.filter(x => x !== c);
    save(); reprice(); render();
  };
  GIS.cart = {
    add, open, count: () => cart.length, setQty, couponForm, wireCoupon, render,
    setCoupon: c => { coupon = String(c || '').toUpperCase(); save(); reprice(); render(); },
    buyNow: (id, btn) => { add(id, btn); location.href = '/checkout'; },
    // Checkout page ke liye
    state: () => ({ T: localTotals(), coupon, priced, priceErr, items: cart.map(c => ({ ...c })), data }),
    clear: () => { cart = []; coupon = ''; priced = null; save(); },
    reprice,
  };
  // Referral link (?ref=REF-XXXXXX): code yaad rakho aur cart mein apne aap lagao
  (() => {
    const q = new URLSearchParams(location.search), ref = String(q.get('ref') || '').toUpperCase();
    if (!/^REF-[A-Z0-9]{6}$/.test(ref)) return;
    store.set('gis-ref', { code: ref, at: Date.now() });
    if (!coupon) GIS.cart.setCoupon(ref);
    q.delete('ref'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    GIS.storeData.then(d => { if (d.referral?.on) toast(GIS.t('ref_welcome', { p: d.referral.pct })); }).catch(() => {});
  })();
  render();
})();
