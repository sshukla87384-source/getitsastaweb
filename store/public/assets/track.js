(() => {
  const { $, esc, store } = GIS;
  const saved = store.get('gis-orders', []);
  if (saved.length) {
    $('#savedWrap').hidden = false;
    $('#saved').innerHTML = saved.map(o => `<a href="/order/${encodeURIComponent(o.code)}"><span>${esc(o.code)}</span><span class="muted">${new Date(o.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} →</span></a>`).join('');
  }
  const c = store.get('gis-customer', {});
  if (c.email) $('#tEmail').value = c.email;
  $('#trackForm').onsubmit = e => {
    e.preventDefault();
    const code = $('#tCode').value.trim().toUpperCase(), email = $('#tEmail').value.trim().toLowerCase();
    const err = $('#tErr');
    if (!/^GIS-[A-Z0-9]{7}$/.test(code)) { err.textContent = GIS.t('bad_code'); err.hidden = false; return; }
    if (!email.includes('@')) { err.textContent = GIS.t('bad_email'); err.hidden = false; return; }
    const list = store.get('gis-orders', []).filter(o => o.code !== code);
    list.unshift({ code, email, at: Date.now() });
    store.set('gis-orders', list.slice(0, 20));
    location.href = `/order/${encodeURIComponent(code)}`;
  };
})();
