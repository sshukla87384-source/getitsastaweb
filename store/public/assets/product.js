// Product detail page: /p/:id-name
(() => {
  const { $, esc, cover, paint, productUrl, icons } = GIS;
  const t = (k, v) => GIS.t(k, v), money = (a, b) => GIS.money(a, b);
  const id = parseInt(location.pathname.split('/')[2], 10);
  const root = $('#product');
  let k = 0;

  GIS.storeData.then(d => {
    const p = d.products.find(x => x.id === id);
    if (!p) {
      root.innerHTML = `<div class="panel prose"><h1>${esc(t('not_found'))}</h1><p>${esc(t('not_found_p'))}</p><p><a class="btn btn-primary" href="/#shop">${esc(t('see_more'))}</a></p></div>`;
      return;
    }
    document.title = `${p.name} • ${d.settings.store_name}`;
    if (location.pathname !== productUrl(p)) history.replaceState(null, '', productUrl(p));
    k = Math.max(0, p.plans.findIndex(x => x.in_stock));
    const related = d.products.filter(x => x.category === p.category && x.id !== p.id).slice(0, 4);

    const render = () => {
      const pl = p.plans[k], off = Math.round((1 - pl.price / pl.mrp) * 100);
      root.innerHTML = `
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">${esc(t('home'))}</a><span>/</span><a href="/#${encodeURIComponent(p.category)}">${esc(p.category)}</a><span>/</span><span>${esc(p.name)}</span></nav>
        <div class="pd">
          <div class="pd-media">${cover(p, 'cover big')}${p.tag ? `<span class="badge">${esc(p.tag)}</span>` : ''}</div>
          <div class="pd-info">
            <div class="cat">${esc(p.category)}</div>
            <h1>${esc(p.name)}</h1>
            <p class="lead">${esc(p.description)}</p>
            <div class="pd-price"><span class="price">${money(pl.price, pl.usd)}</span>${pl.mrp > pl.price ? `<span class="strike">${money(pl.mrp, pl.usd_mrp)}</span><span class="tag-off">−${off}%</span>` : ''}</div>
            <div class="field"><span>${esc(t('pick_plan'))}</span>
              <div class="plan-cards">${p.plans.map((x, j) => `<button class="plan-card${x.in_stock ? '' : ' oos'}" data-j="${j}" aria-pressed="${j === k}" ${x.in_stock ? '' : 'disabled'}>
                <strong>${esc(x.label)}</strong><span class="mono">${money(x.price, x.usd)}</span>
                <small>${x.in_stock ? (x.instant ? `${icons.bolt} ${esc(t('instant_delivery'))}` : esc(t('same_day'))) : esc(t('oos'))}</small></button>`).join('')}</div></div>
            <ul class="pd-facts">
              <li>${icons.bolt}<span>${esc(t(pl.instant ? 'fact_instant' : 'fact_sameday'))}</span></li>
              ${pl.days ? `<li>${icons.check}<span>${esc(t('validity', { d: GIS.planLen(pl.days) }))}</span></li>` : ''}
              <li>${icons.lock}<span>${esc(t(GIS.isIntl() ? 'fact_pay_intl' : 'fact_pay'))}</span></li>
            </ul>
            <div class="pd-cta">
              ${pl.in_stock ? `<button class="btn btn-primary" id="buyNow">${esc(t('buy_now'))} • ${money(pl.price, pl.usd)}</button><button class="btn btn-ghost" id="addCart">${icons.plus}${esc(t('add_cart'))}</button>` : `<button class="btn btn-ghost" disabled>${esc(t('oos'))}</button>`}
            </div>
          </div>
        </div>
        ${p.details ? `<section class="panel pd-details"><h2 class="h3">${esc(t('details'))}</h2><div class="details-text">${esc(p.details)}</div></section>` : ''}
        ${related.length ? `<section class="related"><h2 class="h3">${esc(t('more_in_cat'))}</h2><div class="grid mini">${related.map(r => `<a class="mini-card" href="${productUrl(r)}">${cover(r)}<div><strong>${esc(r.name)}</strong><span class="mono">${(() => { const m = r.plans.reduce((a, x) => (x.price < a.price ? x : a)); return money(m.price, m.usd); })()} ${esc(t('from'))}</span></div></a>`).join('')}</div></section>` : ''}`;
      paint(root);
      root.querySelectorAll('[data-j]').forEach(b => { b.onclick = () => { k = +b.dataset.j; render(); }; });
      $('#buyNow')?.addEventListener('click', e => GIS.cart.buyNow(pl.id, null));
      $('#addCart')?.addEventListener('click', e => GIS.cart.add(pl.id, e.currentTarget));
    };
    render();
    document.addEventListener('gis-locale', render);
  }).catch(e => { root.innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p></div>`; });
})();
