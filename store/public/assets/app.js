// Home page catalog
(() => {
  const { $, esc, cover, paint, productUrl, icons } = GIS;
  const t = (k, v) => GIS.t(k, v);
  let PRODUCTS = [], cat = '*', query = '';
  const sel = {};

  GIS.storeData.then(d => {
    PRODUCTS = d.products;
    const cats = [...new Set(PRODUCTS.map(p => p.category))];
    const tick = [...cats, ...PRODUCTS.slice(0, 8).map(p => p.name)];
    $('#ticker').innerHTML = [...tick, ...tick].map(t => `<span>${esc(t)}</span>`).join('');
    $('#shopSub').textContent = t('n_products', { n: PRODUCTS.length, c: cats.length });
    const h = decodeURIComponent(location.hash.slice(1));
    if (cats.includes(h)) cat = h;
    renderChips(); renderGrid(); heroTags();
    const wa = $('#ctaWa'); if (wa) { if (d.settings.whatsapp) wa.href = `https://wa.me/${encodeURIComponent(d.settings.whatsapp)}`; else wa.hidden = true; }
  }).catch(e => {
    $('#grid').innerHTML = `<div class="empty">${esc(t('load_fail'))} ${esc(e.message)}<br><br><button class="btn btn-ghost" id="retry">${esc(t('retry'))}</button></div>`;
    $('#retry').onclick = () => location.reload();
  });

  function renderChips() {
    const counts = PRODUCTS.reduce((m, p) => (m[p.category] = (m[p.category] || 0) + 1, m), {});
    $('#chips').innerHTML = [['*', PRODUCTS.length], ...Object.entries(counts)]
      .map(([c, n]) => `<button class="chip" aria-pressed="${c === cat}" data-cat="${esc(c)}">${esc(c === '*' ? t('all') : c)}<span class="c">${n}</span></button>`).join('');
  }

  function renderGrid() {
    const q = query.toLowerCase();
    const list = PRODUCTS.filter(p => (cat === '*' || p.category === cat) && `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q));
    if (!list.length) { $('#grid').innerHTML = `<div class="empty">${esc(t('no_match', { q: query }))}</div>`; return; }
    $('#grid').innerHTML = list.map(p => {
      const k = sel[p.id] ?? Math.max(0, p.plans.findIndex(x => x.in_stock)), pl = p.plans[k];
      const off = Math.round((1 - pl.price / pl.mrp) * 100);
      return `<article class="card">
        <a class="cover-link" href="${productUrl(p)}" aria-label="${esc(p.name)} details">${cover(p)}
          ${p.tag ? `<span class="badge">${esc(p.tag)}</span>` : ''}
          ${off > 0 ? `<span class="tag-off cover-off">−${off}%</span>` : ''}</a>
        <div class="card-body">
          <div class="cat">${esc(p.category)}${pl.instant && pl.in_stock ? `<span class="instant-chip">${icons.bolt}${esc(t('instant'))}</span>` : ''}</div>
          <h3><a href="${productUrl(p)}">${esc(p.name)}</a></h3>
          <p class="desc">${esc(p.description)}</p>
          <div class="plans" role="group" aria-label="Plan">${p.plans.map((x, j) => `<button class="plan${x.in_stock ? '' : ' oos'}" data-p="${p.id}" data-j="${j}" aria-pressed="${j === k}">${esc(x.label)}</button>`).join('')}</div>
          <div class="buy">
            <div class="price-block"><span class="price">${GIS.money(pl.price, pl.usd)}</span>${pl.mrp > pl.price ? `<span class="price-meta"><span class="strike">${GIS.money(pl.mrp, pl.usd_mrp)}</span><span class="save-chip">${esc(t('save_x', { x: GIS.money(pl.mrp - pl.price, Math.max(0, pl.usd_mrp - pl.usd)) }))}</span></span>` : ''}</div>
            ${pl.in_stock ? '' : `<span class="oos-label">${esc(t('oos'))}</span>`}
          </div>
          ${pl.in_stock ? `<div class="buy-btns"><button class="add ghost" data-add="${pl.id}" aria-label="${esc(t('add'))}: ${esc(p.name)}">${icons.cart}${esc(t('add'))}</button><button class="add" data-buynow="${pl.id}">${icons.bolt}${esc(t('buy_now'))}</button></div>` : ''}
        </div>
      </article>`;
    }).join('');
    paint($('#grid'));
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.cat) { cat = t.dataset.cat; renderChips(); renderGrid(); }
    else if (t.dataset.j !== undefined) { sel[t.dataset.p] = +t.dataset.j; renderGrid(); }
    else if (t.dataset.add) GIS.cart.add(+t.dataset.add, t);
    else if (t.dataset.buynow) GIS.cart.buyNow(+t.dataset.buynow, null);
  });
  document.addEventListener('gis-locale', () => { if (PRODUCTS.length) { $('#shopSub').textContent = t('n_products', { n: PRODUCTS.length, c: new Set(PRODUCTS.map(p => p.category)).size }); renderChips(); renderGrid(); heroTags(); } });
  // Hero ke 3 price tags: asli products se, chuni currency mein
  function heroTags() {
    const picks = ['CapCut Pro', 'ChatGPT Plus', 'Canva Pro'].map(n => PRODUCTS.find(p => p.name === n)).filter(Boolean);
    const stage = $('#heroTags'); if (!stage || picks.length < 3) return;
    stage.innerHTML = picks.map((p, i) => { const pl = p.plans[0], off = Math.round((1 - pl.price / pl.mrp) * 100);
      return `<div class="swing s${i + 1}">${off > 0 ? `<span class="tag-off">−${off}%</span>` : ''}<div class="nm">${esc(p.name)}</div><div class="pr">${GIS.money(pl.price, pl.usd)}</div><div class="row"><span class="strike">${GIS.money(pl.mrp, pl.usd_mrp)}</span><span class="mono">${esc(pl.label)}</span></div></div>`; }).join('');
  }
  let qt; $('#q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { query = e.target.value.trim(); renderGrid(); }, 120); });
})();
