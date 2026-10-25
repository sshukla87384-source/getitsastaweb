(() => {
  const { $, $$, esc, api, toast, copy, ICON } = GSP;
  const id = location.pathname.split('/').filter(Boolean)[1];
  let inv = null, pick = '', poll, tick;

  const splitAmt = a => { const [i, f = ''] = String(a).split('.'); return `${esc(i)}.<span class="uniq">${esc(f)}</span>`; };
  const left = () => Math.max(0, inv.expires_at - Date.now());
  const mmss = ms => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };

  async function load() {
    try { inv = await api(`/api/pay/${id}`); }
    catch (e) { $('#app').innerHTML = `<div class="card state dead"><div class="ico">!</div><h1>Link sahi nahi hai</h1><p class="muted">${esc(e.message)}</p></div>`; return; }
    if (!pick) pick = inv.method && inv.methods.some(m => m.key === inv.method) ? inv.method : '';
    render();
  }

  function header() {
    return `<section class="card amt-card">
      <div class="order"><span>Order <b>${esc(inv.order_id)}</b></span>${inv.description ? `<span>${esc(inv.description)}</span>` : ''}</div>
      <div><div class="amt-k">Bilkul itna bhejo</div>
        <div class="amt-row"><span class="amt">${splitAmt(inv.amount)}</span><span class="cur">USDT</span>
          <button type="button" class="amt-copy" data-copy="${esc(inv.amount)}">${ICON.copy}Copy</button></div></div>
      <p class="amt-note">Aakhri digits (<b>${esc(inv.amount.split('.')[1] || '')}</b>) se aapka payment pehchana jaata hai. Amount <b>round mat karna</b> — ${esc(inv.amount)} se kam ya zyada aaya to auto-verify nahi hoga.</p>
      <span class="timer"><i></i><span id="tmr">${mmss(left())}</span> bache</span>
    </section>`;
  }

  function methodCard(m) {
    const rec = m.key === 'bep20' ? '<span class="rec">Sabse sasti fees</span>' : m.key === 'binance' ? '<span class="rec">0 fees</span>' : '';
    return `<button type="button" class="method" data-method="${m.key}" aria-pressed="${pick === m.key}"><strong>${esc(m.label)}</strong><small>${esc(m.chain)}</small>${rec}</button>`;
  }

  function destination(m) {
    if (m.key === 'binance') {
      return `<div class="dest"><div class="qr" id="qr"></div><div>
          <div class="dest-k">Binance Pay ID</div>
          <div class="dest-v big">${esc(m.pay_id)}</div>
          ${m.name ? `<div class="muted small">Naam: <b>${esc(m.name)}</b></div>` : ''}
          <button type="button" class="btn btn-ghost sm" data-copy="${esc(m.pay_id)}">${ICON.copy}Pay ID copy</button></div></div>
        <ol class="steps">
          <li>Binance app → <b>Pay</b> → <b>Send</b> → <b>Pay ID</b> → <span class="mono">${esc(m.pay_id)}</span> daalo</li>
          <li>Coin <b>USDT</b> chuno, amount <b class="mono">${esc(inv.amount)}</b> bilkul yahi</li>
          <li>Bhejne ke baad <b>Pay → History</b> → transaction kholo → <b>Order ID</b> copy karke neeche daalo</li>
        </ol>`;
    }
    return `<div class="dest"><div class="qr" id="qr"></div><div>
        <div class="dest-k">Is address par (${esc(m.chain)})</div>
        <div class="dest-v">${esc(m.address)}</div>
        <button type="button" class="btn btn-ghost sm" data-copy="${esc(m.address)}">${ICON.copy}Address copy</button></div></div>
      <div class="warn-box">Sirf <b>USDT</b>, sirf <b>${esc(m.chain)}</b> network. Galat network = paisa wapas nahi aata.<br>
        Exchange (Binance, WazirX…) se bhej rahe ho to withdrawal fee alag se lagti hai — <b>receive amount ${esc(inv.amount)}</b> hona chahiye. ${esc(m.fee)}.</div>`;
  }

  function payView() {
    const m = inv.methods.find(x => x.key === pick);
    let h = header();
    if (!inv.methods.length) return h + '<section class="card"><p class="m0">Abhi koi payment method chalu nahi hai. Store se contact karo.</p></section>';
    h += `<section class="card"><h2 class="h-step"><span>1</span>Kaise pay karoge?</h2><div class="methods">${inv.methods.map(methodCard).join('')}</div>`;
    if (m) {
      h += `<h2 class="h-step"><span>2</span>${m.key === 'binance' ? 'Binance Pay se bhejo' : 'USDT bhejo'}</h2>${destination(m)}
        <h2 class="h-step"><span>3</span>${esc(m.refLabel)} daalo</h2>
        <form class="ref-form" id="refForm" novalidate>
          <label class="field">${esc(m.refLabel)}<input id="ref" class="mono-in" autocomplete="off" spellcheck="false" placeholder="${m.key === 'binance' ? 'jaise 3517728472934' : esc(m.refHint)}" required>
            <small>${esc(m.refHint)}</small></label>
          <p class="err" id="refErr" hidden></p>
          <button class="btn btn-primary wide" id="refBtn" type="submit">Payment verify karo</button>
        </form>`;
    }
    return h + '</section>';
  }

  function stateView() {
    const s = inv.status;
    const back = inv.return_url ? `<a class="btn btn-ink" href="${esc(inv.return_url)}">Store par wapas jao</a>` : '';
    const kv = `<dl class="kv"><dt>Order</dt><dd>${esc(inv.order_id)}</dd><dt>Amount</dt><dd>${esc(inv.paid_amount || inv.amount)} USDT</dd>${inv.tx ? `<dt>${inv.method === 'binance' ? 'Order ID' : 'TxID'}</dt><dd>${inv.explorer ? `<a href="${esc(inv.explorer)}" target="_blank" rel="noopener">${esc(inv.tx)}</a>` : esc(inv.tx)}</dd>` : ''}</dl>`;
    if (s === 'paid') return `<section class="card state ok"><div class="ico">${ICON.check}</div><h1>Payment mil gaya ✓</h1><p class="muted">Dhanyavaad! Aapka order ab process ho raha hai.${inv.return_url ? ' 5 second mein store par wapas le ja rahe hain…' : ''}</p>${kv}${back}</section>`;
    if (s === 'confirming') {
      const pct = inv.needed ? Math.min(100, (inv.confirmations / inv.needed) * 100) : 50;
      return `<section class="card state wait"><div class="ico"><div class="spin"></div></div><h1>Transaction confirm ho raha hai</h1>
        <p class="muted">Blockchain par mil gaya. ${inv.confirmations}/${inv.needed} confirmations — ye page khud update hoga.</p><div class="bar"><i id="bar"></i></div>${kv}</section>`;
    }
    if (s === 'review') return `<section class="card state rev"><div class="ico">⏳</div><h1>Payment check ho raha hai</h1><p class="muted">${esc(inv.review_reason || 'Amount match nahi hua')}. Team haath se check karke order complete karegi.${inv.support ? ` Madad: ${esc(inv.support)}` : ''}</p>${kv}${back}</section>`;
    if (s === 'cancelled') return `<section class="card state dead"><div class="ico">✕</div><h1>Ye payment cancel ho gaya</h1><p class="muted">Store par naya order banao.</p>${back}</section>`;
    return '';
  }

  function render() {
    clearInterval(tick); clearTimeout(poll);
    const s = inv.status;
    const app = $('#app');
    if (s === 'pending' || (s === 'expired' && inv.can_submit)) {
      app.innerHTML = (s === 'expired' ? '<section class="card"><p class="m0"><b>Time khatam ho gaya.</b> Agar aap pehle hi bhej chuke ho to neeche ID daal do — hum abhi bhi check kar lenge.</p></section>' : '') + payView();
      const m = inv.methods.find(x => x.key === pick);
      if (m && window.QR) $('#qr').innerHTML = QR.svg(m.key === 'binance' ? m.pay_id : m.address, { margin: 2 });
      $$('[data-method]').forEach(b => { b.onclick = async () => {
        pick = b.dataset.method; render();
        try { inv = await api(`/api/pay/${id}/method`, { method: 'POST', body: { method: pick } }); } catch (e) { toast(e.message); }
        $('#ref')?.focus();
      }; });
      $('#refForm') && ($('#refForm').onsubmit = submit);
      let lastLoad = 0;
      tick = setInterval(() => { const t = $('#tmr'); if (t) t.textContent = mmss(left()); if (!left() && s === 'pending' && Date.now() - lastLoad > 15000) { lastLoad = Date.now(); load(); } }, 1000);
      if (s === 'expired') $('.timer')?.remove();
    } else if (s === 'expired') {
      app.innerHTML = `<section class="card state dead"><div class="ico">⌛</div><h1>Payment ka time khatam</h1><p class="muted">Store par wapas jaake dobara "Crypto se pay" dabao — naya amount milega.</p>${inv.return_url ? `<a class="btn btn-ink" href="${esc(inv.return_url)}">Store par wapas jao</a>` : ''}</section>`;
    } else {
      app.innerHTML = stateView();
      const bar = $('#bar'); if (bar) requestAnimationFrame(() => { bar.style.width = Math.min(100, inv.needed ? (inv.confirmations / inv.needed) * 100 : 50) + '%'; });
      if (s === 'confirming' || s === 'review') poll = setTimeout(load, s === 'confirming' ? 8000 : 30000);
      if (s === 'paid' && inv.return_url) poll = setTimeout(() => { location.href = inv.return_url; }, 5000);
    }
    $$('[data-copy]').forEach(b => { b.onclick = () => copy(b.dataset.copy); });
    $('#foot').innerHTML = `${esc(inv.brand || 'Get It Sasta Pay')}${inv.support ? ` • Madad: ${esc(inv.support)}` : ''}`;
  }

  async function submit(e) {
    e.preventDefault();
    const err = $('#refErr'), btn = $('#refBtn'), ref = $('#ref').value.trim();
    err.hidden = true;
    if (!ref) { err.textContent = 'Pehle ID daalo.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Check ho raha hai…';
    try { inv = await api(`/api/pay/${id}/submit`, { method: 'POST', body: { method: pick, ref } }); render(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Payment verify karo'; }
  }

  load();
})();
