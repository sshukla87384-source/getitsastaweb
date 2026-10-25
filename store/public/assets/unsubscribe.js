(() => {
  const ok = new URLSearchParams(location.search).get('ok') === '1';
  const el = document.getElementById('unsubMsg');
  el.dataset.i18n = ok ? 'unsub_ok' : 'unsub_bad';
  el.innerHTML = GIS.t(el.dataset.i18n);
})();
