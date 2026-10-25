(() => {
  const { $, api } = GIS;
  const t = new URLSearchParams(location.search).get('token') || '';
  $('#rf').onsubmit = async e => {
    e.preventDefault();
    const err = $('#rErr'), btn = $('#rBtn');
    if ($('#r1').value !== $('#r2').value) { err.textContent = 'The two passwords don’t match.'; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true;
    try { await api('/api/account/reset', { method: 'POST', body: { token: t, password: $('#r1').value } }); location.href = '/account'; }
    catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
})();
