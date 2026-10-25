// Newsletter popup: thodi der baad (ya page chhodte waqt, desktop par) — pehle order par X% off ka apna code.
// Ek baar band kiya to 7 din tak nahi; subscribe ho gaya to kabhi nahi.
(() => {
  const { $, esc, store, api, copy, icons } = GIS;
  const t = (k, v) => GIS.t(k, v);
  const KEY = 'gis-nl';
  const seen = store.get(KEY, {});
  if (seen.done || (seen.closed && Date.now() - seen.closed < 7 * 86400e3)) return;
  // Payment / account page par beech mein popup nahi
  if (/^\/(order|account|reset|unsubscribe)/.test(location.pathname)) return;
  // Referral link se aaya hai to discount pehle se hai — popup nahi
  const ref = store.get('gis-ref', {});
  if (/[?&]ref=REF-/i.test(location.search) || (ref.at && Date.now() - ref.at < 30 * 86400e3)) return;

  let cfg = null, shown = false, timer;
  GIS.storeData?.then(d => {
    cfg = d.newsletter;
    if (!cfg || !cfg.on) return;
    timer = setTimeout(show, Math.max(3, cfg.delay) * 1000);
    // Desktop: mouse upar se bahar gaya (tab band karne ja raha hai) → abhi dikhao
    document.addEventListener('mouseout', e => { if (!e.relatedTarget && e.clientY < 8 && window.innerWidth > 900) show(); });
  }).catch(() => {});

  function close(remember = true) {
    const el = $('#nlPop'); if (el) el.remove();
    document.body.classList.remove('no-scroll');
    if (remember) store.set(KEY, { ...store.get(KEY, {}), closed: Date.now() });
  }
  function show() {
    if (shown || !cfg) return;
    // Cart / checkout khula ho to beech mein mat aao
    if (!$('#drawer')?.hidden || document.querySelector('.loc-pop:not([hidden])')) { timer = setTimeout(show, 15000); return; }
    shown = true; clearTimeout(timer);
    const p = cfg.pct;
    document.body.insertAdjacentHTML('beforeend', `<div class="nl-wrap" id="nlPop" role="dialog" aria-modal="true" aria-labelledby="nlTitle">
      <div class="nl-card">
        <button class="icon-btn nl-x" type="button" id="nlX" aria-label="${esc(t('close'))}">${icons.x}</button>
        <div class="nl-badge"><span>${p}%</span><small>OFF</small></div>
        <div class="nl-body" id="nlBody">
          <h2 id="nlTitle">${esc(t('nl_title', { p }))}</h2>
          <p>${esc(t('nl_p'))}</p>
          <form id="nlForm" class="nl-form" novalidate>
            <label class="sr" for="nlEmail">Email</label>
            <input id="nlEmail" type="email" autocomplete="email" required placeholder="${esc(t('nl_ph'))}" value="${esc(store.get('gis-customer', {}).email || '')}">
            <button class="btn btn-primary" type="submit" id="nlBtn">${esc(t('nl_btn', { p }))}</button>
          </form>
          <p class="err" id="nlErr" hidden></p>
          <button class="link nl-no" type="button" id="nlNo">${esc(t('nl_no'))}</button>
          <p class="nl-small">${esc(t('nl_small'))}</p>
        </div>
      </div></div>`);
    $('#nlX').onclick = () => close(); $('#nlNo').onclick = () => close();
    $('#nlPop').addEventListener('click', e => { if (e.target.id === 'nlPop') close(); });
    document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape' && $('#nlPop')) { close(); document.removeEventListener('keydown', esc_); } });
    $('#nlForm').onsubmit = submit;
    setTimeout(() => $('#nlEmail')?.focus(), 50);
  }
  async function submit(e) {
    e.preventDefault();
    const email = $('#nlEmail').value.trim(), btn = $('#nlBtn'), err = $('#nlErr');
    err.hidden = true; btn.disabled = true;
    try {
      const r = await api('/api/newsletter', { method: 'POST', body: { email, lang: GIS.loc.lang, country: GIS.loc.country } });
      store.set(KEY, { done: Date.now() });
      const c = store.get('gis-customer', {}); if (!c.email) store.set('gis-customer', { ...c, email });
      const body = $('#nlBody');
      if (r.code) {
        body.innerHTML = `<h2 id="nlTitle">${esc(t('nl_done'))}</h2>
          <button class="nl-code" type="button" id="nlCode" aria-label="${esc(t('copy'))}">${esc(r.code)} ${icons.copy}</button>
          <p>${esc(t(r.emailed ? 'nl_done_p' : 'nl_done_p2', { p: r.pct, e: email }))}</p>
          <button class="btn btn-primary btn-block" type="button" id="nlUse">${esc(t('nl_apply'))}</button>`;
        $('#nlCode').onclick = () => copy(r.code);
        $('#nlUse').onclick = () => {
          GIS.cart?.setCoupon(r.code); close(false);
          if (GIS.cart?.count()) GIS.cart.open(true);
          else { GIS.toast(t('nl_saved')); const shop = document.getElementById('shop'); if (shop) shop.scrollIntoView({ behavior: 'smooth' }); else location.href = '/#shop'; }
        };
      } else {
        body.innerHTML = `<h2 id="nlTitle">✓</h2><p>${esc(t(r.already ? 'nl_already' : 'nl_existing'))}</p><button class="btn btn-ghost btn-block" type="button" id="nlOk">${esc(t('close'))}</button>`;
        $('#nlOk').onclick = () => close(false);
      }
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  }
})();
