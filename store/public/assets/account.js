// Customer account: login / register / forgot + dashboard
(() => {
  const { $, $$, inr, esc, api, toast, fmtDate, fmtTime, daysLeft, planLen, paint, tile, icons, store } = GIS;
  const root = $('#account');
  const params = new URLSearchParams(location.search);
  let tab = ['orders', 'profile', 'subs', 'refer'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  let D = null, products = [];

  const STATUS = { awaiting_payment: ['Payment pending', 'st-wait'], verifying: ['Verifying', 'st-verify'], paid: ['Processing', 'st-paid'], delivered: ['Delivered', 'st-done'], cancelled: ['Cancelled', 'st-cancel'] };
  const pill = s => `<span class="st ${STATUS[s][1]}">${STATUS[s][0]}</span>`;
  const showErr = (el, m) => { el.textContent = m || ''; el.hidden = !m; };

  // ---------- Logged out ----------
  let OPTS = { otp: false };
  const nextUrl = () => { const n = params.get('next') || ''; return /^\/(?!\/)/.test(n) ? n : ''; };
  function afterLogin() {
    const n = nextUrl();
    if (n) { location.href = n; return; }
    history.replaceState(null, '', '/account'); load();
  }

  function authView(mode) {
    mode ||= params.get('mode') === 'register' ? 'register' : OPTS.otp ? 'otp' : 'login';
    const tabs = [...(OPTS.otp ? [['otp', 'Login with OTP']] : []), ['login', 'Password'], ['register', 'New account']];
    root.innerHTML = `<div class="auth-wrap">
      <section class="auth-pitch">
        <span class="tag-off">MEMBER</span>
        <h1>Your Sasta dashboard</h1>
        <ul class="pitch-list">
          <li>${icons.check}<span>All your orders and login details in one safe place</span></li>
          <li>${icons.check}<span>Expiry date and days left for every subscription</span></li>
          <li>${icons.check}<span>One-click renewal — same plan, same price</span></li>
          <li>${icons.check}<span>See exactly how much you have saved</span></li>
        </ul>
      </section>
      <section class="panel auth-card">
        <div class="seg" role="tablist" data-n="${tabs.length}">${tabs.map(([k, l]) => `<button role="tab" data-mode="${k}" aria-selected="${mode === k}">${l}</button>`).join('')}</div>
        <div id="authBody"></div>
      </section></div>`;
    $$('[data-mode]').forEach(b => { b.onclick = () => authView(b.dataset.mode); });
    const body = $('#authBody');
    const remembered = store.get('gis-customer', {});

    if (mode === 'otp') {
      body.innerHTML = `<form id="f" class="stack" novalidate>
        <p class="muted m0">We’ll email you a 6-digit code — no password to remember. New here? Your account is created automatically.</p>
        <label class="field">Email<input id="email" type="email" autocomplete="email" required value="${esc(remembered.email || '')}"></label>
        <p class="err" id="err" hidden></p>
        <button class="btn btn-primary" type="submit" id="go">Send OTP</button></form>`;
      $('#f').onsubmit = async e => {
        e.preventDefault(); const go = $('#go'); go.disabled = true; showErr($('#err'));
        const email = $('#email').value.trim();
        try { const r = await api('/api/account/otp/send', { method: 'POST', body: { email } }); otpStep(email, r.new_account); }
        catch (ex) { showErr($('#err'), ex.message); go.disabled = false; }
      };
    } else if (mode === 'login') {
      body.innerHTML = `<form id="f" class="stack" novalidate>
        <label class="field">Email<input id="email" type="email" autocomplete="email" required value="${esc(remembered.email || '')}"></label>
        <label class="field">Password<span class="pw-wrap"><input id="pw" type="password" autocomplete="current-password" required><button type="button" class="link" data-toggle-pw>Show</button></span></label>
        <p class="err" id="err" hidden></p>
        <button class="btn btn-ink" type="submit" id="go">Login</button>
        <button class="link left" type="button" id="forgot">Forgot password?</button></form>`;
      $('#forgot').onclick = () => authView('forgot');
      $('#f').onsubmit = submit('/api/account/login', () => ({ email: $('#email').value, password: $('#pw').value }));
    } else if (mode === 'register') {
      body.innerHTML = `<form id="f" class="stack" novalidate>
        <label class="field">Name<input id="name" autocomplete="name" required value="${esc(remembered.name || '')}"></label>
        <label class="field">Email<input id="email" type="email" autocomplete="email" required value="${esc(remembered.email || '')}"></label>
        <label class="field">Mobile (WhatsApp)<input id="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(remembered.phone || '')}"></label>
        <label class="field">Password<span class="pw-wrap"><input id="pw" type="password" autocomplete="new-password" minlength="8" required><button type="button" class="link" data-toggle-pw>Show</button></span><small>At least 8 characters</small></label>
        <p class="err" id="err" hidden></p>
        <button class="btn btn-primary" type="submit" id="go">Create account</button></form>`;
      $('#f').onsubmit = submit('/api/account/register', () => ({ name: $('#name').value, email: $('#email').value, phone: $('#phone').value, password: $('#pw').value }));
    } else {
      $$('[data-mode]').forEach(b => b.setAttribute('aria-selected', 'false'));
      body.innerHTML = `<form id="f" class="stack" novalidate>
        <h2 class="h3 m0">Password reset</h2>
        <p class="muted m0">We’ll email you an OTP to set a new password.</p>
        <label class="field">Email<input id="email" type="email" autocomplete="email" required value="${esc(remembered.email || '')}"></label>
        <p class="err" id="err" hidden></p><div id="ok"></div>
        <button class="btn btn-ink" type="submit" id="go">Send OTP</button>
        <button class="link left" type="button" id="back">← Back to login</button></form>`;
      $('#back').onclick = () => authView('login');
      $('#f').onsubmit = async e => {
        e.preventDefault(); const go = $('#go'); go.disabled = true; showErr($('#err'));
        const email = $('#email').value.trim();
        try {
          const r = await api('/api/account/forgot', { method: 'POST', body: { email } });
          if (!r.email) { $('#ok').innerHTML = `<div class="status-box paid"><p>To reset your password, message us on WhatsApp <span class="mono">+${esc(r.whatsapp)}</span> or email <span class="mono">${esc(r.support_email)}</span> with your account email.</p></div>`; go.disabled = false; return; }
          resetStep(email);
        } catch (ex) { showErr($('#err'), ex.message); go.disabled = false; }
      };
    }
    pwToggles(body);
  }

  function pwToggles(scope) {
    $$('[data-toggle-pw]', scope).forEach(b => { b.onclick = () => { const i = b.previousElementSibling; const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; }; });
  }

  // 6 boxes, paste support
  function otpInput() {
    return `<div class="otp-boxes" id="otpBoxes">${Array.from({ length: 6 }, (_, i) => `<input inputmode="numeric" maxlength="1" autocomplete="${i ? 'off' : 'one-time-code'}" aria-label="OTP digit ${i + 1}">`).join('')}</div>`;
  }
  function wireOtp(onFull) {
    const boxes = $$('#otpBoxes input');
    const val = () => boxes.map(b => b.value).join('');
    boxes.forEach((b, i) => {
      b.addEventListener('input', () => {
        const d = b.value.replace(/\D/g, '');
        if (d.length > 1) { d.slice(0, 6).split('').forEach((c, j) => { if (boxes[j]) boxes[j].value = c; }); boxes[Math.min(5, d.length - 1)].focus(); }
        else { b.value = d; if (d && boxes[i + 1]) boxes[i + 1].focus(); }
        if (val().length === 6) onFull(val());
      });
      b.addEventListener('keydown', e => { if (e.key === 'Backspace' && !b.value && boxes[i - 1]) boxes[i - 1].focus(); });
    });
    boxes[0].focus();
    return val;
  }

  function otpStep(email, isNew) {
    $('#authBody').innerHTML = `<form id="f2" class="stack" novalidate>
      <p class="m0">Code sent to <strong>${esc(email)}</strong> <button class="link" type="button" id="chg">change</button></p>
      ${otpInput()}
      ${isNew ? `<p class="muted m0 small">You’re creating a new account — please add your name too.</p>
        <label class="field">Name<input id="nName" autocomplete="name"></label>
        <label class="field">Mobile (WhatsApp)<input id="nPhone" type="tel" inputmode="tel" autocomplete="tel"></label>` : ''}
      <p class="err" id="err" hidden></p>
      <button class="btn btn-primary" type="submit" id="go">Verify and log in</button>
      <button class="link left" type="button" id="resend" disabled>New code (45s)</button></form>`;
    $('#chg').onclick = () => authView('otp');
    let left = 45; const rs = $('#resend');
    const tick = setInterval(() => { left--; rs.textContent = left > 0 ? `New code (${left}s)` : 'Send new code'; if (left <= 0) { rs.disabled = false; clearInterval(tick); } }, 1000);
    rs.onclick = async () => { rs.disabled = true; try { await api('/api/account/otp/send', { method: 'POST', body: { email } }); toast('New code sent'); otpStep(email, isNew); } catch (ex) { toast(ex.message); rs.disabled = false; } };
    const getVal = wireOtp(() => { if (!isNew) $('#f2').requestSubmit(); });
    $('#f2').onsubmit = async e => {
      e.preventDefault(); const go = $('#go'); go.disabled = true; showErr($('#err'));
      try { await api('/api/account/otp/verify', { method: 'POST', body: { email, code: getVal(), name: $('#nName')?.value, phone: $('#nPhone')?.value } }); clearInterval(tick); afterLogin(); }
      catch (ex) { showErr($('#err'), ex.message); go.disabled = false; }
    };
  }

  function resetStep(email) {
    $('#authBody').innerHTML = `<form id="f3" class="stack" novalidate>
      <p class="m0">If an account exists for <strong>${esc(email)}</strong>, we’ve sent it a code.</p>
      ${otpInput()}
      <label class="field">New password<span class="pw-wrap"><input id="np" type="password" autocomplete="new-password" minlength="8"><button type="button" class="link" data-toggle-pw>Show</button></span><small>At least 8 characters</small></label>
      <p class="err" id="err" hidden></p>
      <button class="btn btn-ink" type="submit" id="go">Set password</button></form>`;
    pwToggles($('#authBody'));
    const getVal = wireOtp(() => $('#np').focus());
    $('#f3').onsubmit = async e => {
      e.preventDefault(); const go = $('#go'); go.disabled = true; showErr($('#err'));
      try { await api('/api/account/reset', { method: 'POST', body: { email, code: getVal(), password: $('#np').value } }); toast('Password set'); afterLogin(); }
      catch (ex) { showErr($('#err'), ex.message); go.disabled = false; }
    };
  }

  function submit(url, payload) {
    return async e => {
      e.preventDefault(); const go = $('#go'); go.disabled = true; showErr($('#err'));
      try { await api(url, { method: 'POST', body: payload() }); afterLogin(); }
      catch (ex) { showErr($('#err'), ex.message); go.disabled = false; }
    };
  }

  // ---------- Dashboard ----------
  function subCard(s) {
    const p = products.find(x => x.id === s.product_id) || { name: s.product_name, color: '#5A2DF4' };
    const plan = p.plans?.find(x => x.id === s.plan_id);
    let state = s.state, meta = '', pct = 100;
    if (s.state === 'active') {
      const left = daysLeft(s.expires_at);
      pct = s.days ? Math.round(Math.max(0, left) / s.days * 100) : 100;
      if (left <= 5) state = 'soon';
      meta = `<span class="big-days">${left}</span><span>days left</span>`;
    } else if (s.state === 'expired') { pct = 0; meta = '<span class="big-days">0</span><span>Expired</span>'; }
    else meta = '<span class="big-days">∞</span><span>Lifetime</span>';
    const label = { active: 'Active', soon: 'Ending soon', expired: 'Expired', lifetime: 'Active' }[state];
    return `<article class="sub-card s-${state}">
      <div class="sub-top">${tile(p)}<div class="info"><strong>${esc(s.product_name)}</strong><small>${esc(s.plan_label)}</small></div><span class="sub-state">${label}</span></div>
      <div class="sub-meter"><div class="days">${meta}</div><div class="meter"><span data-w="${pct}"></span></div>
        <small class="muted">${s.expires_at ? (s.state === 'expired' ? 'Expired ' : 'Valid till ') + fmtDate(s.expires_at) : 'Delivered ' + fmtDate(s.delivered_at)}</small></div>
      <div class="sub-actions"><a class="btn btn-ghost sm" href="/order/${encodeURIComponent(s.order_code)}">Details</a>
        ${plan && plan.in_stock ? `<button class="btn btn-primary sm" data-renew="${plan.id}">${s.state === 'expired' || state === 'soon' ? 'Renew' : 'Buy again'} • ${inr(plan.price)}</button>` : ''}</div>
    </article>`;
  }

  function orderRow(o) {
    const cta = o.status === 'awaiting_payment' ? `<a class="btn btn-primary sm" href="/order/${encodeURIComponent(o.code)}">Pay now</a>` : `<a class="btn btn-ghost sm" href="/order/${encodeURIComponent(o.code)}">View</a>`;
    return `<li class="o-row">
      <div class="o-main"><span class="mono o-code">${esc(o.code)}</span><span class="muted">${fmtTime(o.created_at)}</span></div>
      <div class="o-items">${o.items.map(i => `${esc(i.product_name)} <span class="muted">• ${esc(i.plan_label)}${i.qty > 1 ? ' ×' + i.qty : ''}</span>`).join('<br>')}</div>
      <div class="o-total mono">${inr(o.total)}</div>
      <div class="o-status">${pill(o.status)}</div>
      <div class="o-cta">${cta}</div></li>`;
  }

  function dashboard() {
    const { me, stats, subscriptions: subs, orders, support, referral: R = { on: false } } = D;
    if (R.on && R.link?.startsWith('/')) R.link = location.origin + R.link;
    const pending = orders.filter(o => o.status === 'awaiting_payment');
    const first = esc(me.name.split(' ')[0]);
    const tabs = [['overview', 'Overview'], ['subs', `Subscriptions <span class="n">${subs.length}</span>`], ['orders', `Orders <span class="n">${orders.length}</span>`], ...(R.on ? [['refer', `Refer & earn${R.count ? ` <span class="n">${R.count}</span>` : ''}`]] : []), ['profile', 'Profile']];
    const shareText = R.on ? `Get premium tools for less on Get It Sasta. Use my link for ${R.friend_pct}% off your first order: ${R.link}` : '';
    const referBand = R.on ? `<section class="ref-band"><div><strong>Give friends ${R.friend_pct}% off, get ${R.reward_pct}% off yourself 🎁</strong><span class="muted">You get a new reward code for every friend’s first order.</span></div><button class="btn btn-primary sm" data-tab="refer">Refer now</button></section>` : '';
    let content = '';

    if (tab === 'overview') {
      content = `
        <div class="dash-stats">
          <div class="stat"><span class="l">Active subscriptions</span><span class="v">${stats.active}</span></div>
          <div class="stat"><span class="l">Total orders</span><span class="v">${stats.orders}</span></div>
          <div class="stat"><span class="l">Total spent</span><span class="v">${inr(stats.spent)}</span></div>
          <div class="stat saved"><span class="l">You saved</span><span class="v">${inr(stats.saved)}</span><span class="s">vs MRP and coupons</span></div>
        </div>
        ${pending.length ? `<section class="alert-band"><div><strong>${pending.length} order${pending.length > 1 ? 's' : ''} awaiting payment</strong><span class="muted">Delivery starts as soon as you pay.</span></div>
          <div class="alert-actions">${pending.slice(0, 3).map(o => `<a class="btn btn-primary sm" href="/order/${encodeURIComponent(o.code)}">${esc(o.code)} • ${inr(o.total)}</a>`).join('')}</div></section>` : ''}
        <section><div class="sec-head"><h2 class="h3 m0">My subscriptions</h2>${subs.length > 3 ? '<button class="link" data-tab="subs">View all →</button>' : ''}</div>
          ${subs.length ? `<div class="sub-grid">${subs.slice(0, 3).map(subCard).join('')}</div>` : emptyState('No subscriptions yet', 'Buy your first product — after delivery it appears here with its expiry date.')}</section>
        <section><div class="sec-head"><h2 class="h3 m0">Recent orders</h2>${orders.length > 4 ? '<button class="link" data-tab="orders">View all →</button>' : ''}</div>
          ${orders.length ? `<ul class="o-list">${orders.slice(0, 4).map(orderRow).join('')}</ul>` : emptyState('No orders yet', 'Every order you place shows up here with its status.')}</section>
        ${referBand}
        <section class="help-band"><div><strong>Need help?</strong><span class="muted">Message us with your order ID and we’ll reply quickly.</span></div>
          <a class="btn btn-wa sm" target="_blank" rel="noopener" href="https://wa.me/${esc(support.whatsapp)}?text=${encodeURIComponent('Hi, my account email is ' + me.email + '.')}">WhatsApp support</a></section>`;
    } else if (tab === 'subs') {
      content = subs.length ? `<div class="sub-grid">${subs.map(subCard).join('')}</div>` : emptyState('No subscriptions yet', 'Delivered products appear here with their expiry dates.');
    } else if (tab === 'refer' && R.on) {
      content = `<div class="ref-grid">
        <section class="panel stack ref-main">
          <h2 class="h3 m0">Refer & earn</h2>
          <ol class="ref-steps"><li><b>Share your link</b> — with friends on WhatsApp, Instagram or anywhere.</li><li><b>Your friend gets ${R.friend_pct}% off</b> — applied automatically to their first order when they open your link.</li><li><b>You get ${R.reward_pct}% off</b>${R.reward_max ? ` (up to ₹${R.reward_max})` : ''} — a new code as soon as your friend pays, valid for ${R.days} days. One code per friend.</li></ol>
          <label class="field">Your link<div class="ref-copy"><input id="refLink" value="${esc(R.link)}" readonly><button class="btn btn-ink sm" type="button" id="refCopy">Copy</button></div></label>
          <p class="m0 small muted">Or your friend can enter this code at checkout: <b class="mono">${esc(R.code)}</b> <button class="link" type="button" id="refCode">copy</button></p>
          <div class="row-gap"><a class="btn btn-wa sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText)}">Share on WhatsApp</a>${navigator.share ? '<button class="btn btn-ghost sm" type="button" id="refShare">Share</button>' : ''}</div>
        </section>
        <section class="panel stack">
          <h2 class="h3 m0">My rewards <span class="muted small">${R.count} friend${R.count === 1 ? '' : 's'}</span></h2>
          ${R.rewards.length ? `<ul class="ref-list">${R.rewards.map(r => `<li><div><strong>${esc(r.friend)}</strong><small class="muted">${fmtDate(r.at)}</small></div>${r.code ? `<button class="ref-code mono ${r.used || r.expired ? 'off' : ''}" type="button" data-copy="${esc(r.code)}" ${r.used || r.expired ? 'disabled' : ''}>${esc(r.code)}<small>${r.used ? 'used' : r.expired ? 'expired' : `${R.reward_pct}% off • copy`}</small></button>` : ''}</li>`).join('')}</ul>`
            : '<p class="muted m0">No rewards yet. When your first friend buys, your reward code will appear here and in your email.</p>'}
        </section></div>`;
    } else if (tab === 'orders') {
      content = orders.length ? `<ul class="o-list">${orders.map(orderRow).join('')}</ul>` : emptyState('No orders yet', 'Place your first order from the store.');
    } else {
      content = `<div class="profile-grid">
        <form class="panel stack" id="pf" novalidate><h2 class="h3 m0">Profile</h2>
          <label class="field">Name<input id="pName" value="${esc(me.name)}" autocomplete="name"></label>
          <label class="field">Email<input value="${esc(me.email)}" disabled>
            <small>${me.email_verified ? '<span class="ok-badge">✓ Verified</span>' : D.can_verify ? '<span class="warn">Not verified</span> — <button class="link" type="button" id="verifyBtn">verify now</button>' : 'To change your email, contact support.'}</small></label>
          <div id="verifyBox"></div>
          <label class="field">Mobile (WhatsApp)<input id="pPhone" value="${esc(me.phone)}" type="tel" autocomplete="tel"></label>
          <p class="err" id="pErr" hidden></p><button class="btn btn-ink" type="submit">Save</button></form>
        <div class="stack">
          <form class="panel stack" id="pw" novalidate><h2 class="h3 m0">${me.has_password ? 'Change password' : 'Set a password'}</h2>
            ${me.has_password ? '' : '<p class="muted m0 small">You currently log in with an OTP. Set a password to use either method.</p>'}
            ${me.has_password ? '<label class="field">Current password<input id="pwCur" type="password" autocomplete="current-password"></label>' : ''}
            <label class="field">New password<input id="pwNew" type="password" autocomplete="new-password"><small>At least 8 characters</small></label>
            <p class="err" id="pwErr" hidden></p><button class="btn btn-ghost" type="submit">${me.has_password ? 'Update password' : 'Set password'}</button></form>
          <div class="panel stack"><h2 class="h3 m0">Login security</h2>
            <ul class="sess-list" id="sessList"><li class="muted">Loading…</li></ul>
            <button class="btn btn-ghost" id="logoutAll" type="button">Log out of all other devices</button></div>
        </div>
      </div>`;
    }

    root.innerHTML = `
      <section class="dash-hero">
        <div class="dash-hello"><div class="avatar">${esc(GIS.initials(me.name))}</div>
          <div><p class="eyebrow">Member since ${fmtDate(me.created_at)}</p><h1>Hi, ${first}</h1></div></div>
        <div class="dash-hero-cta"><a class="btn btn-primary" href="/#shop">Shop now</a><button class="btn btn-ghost" id="logout">Logout</button></div>
      </section>
      <nav class="dash-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</nav>
      <div class="dash-body">${content}</div>`;
    paint(root);

    $$('[data-tab]', root).forEach(b => { b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', tab === 'overview' ? '/account' : '#' + tab); dashboard(); window.scrollTo({ top: 0 }); }; });
    $$('[data-renew]', root).forEach(b => { b.onclick = () => GIS.cart.buyNow(+b.dataset.renew, b); });
    $('#refCopy')?.addEventListener('click', () => GIS.copy(R.link));
    $('#refCode')?.addEventListener('click', () => GIS.copy(R.code));
    $('#refShare')?.addEventListener('click', () => navigator.share({ title: 'Get It Sasta', text: shareText, url: R.link }).catch(() => {}));
    $$('[data-copy]', root).forEach(b => { b.onclick = () => GIS.copy(b.dataset.copy); });
    $('#logout').onclick = async () => { try { await api('/api/account/logout', { method: 'POST', body: {} }); } catch {} location.href = '/'; };
    $('#pf')?.addEventListener('submit', async e => {
      e.preventDefault(); showErr($('#pErr'));
      try { const r = await api('/api/account/profile', { method: 'PUT', body: { name: $('#pName').value, phone: $('#pPhone').value } }); D.me = { ...D.me, ...r }; toast('Profile saved'); dashboard(); }
      catch (ex) { showErr($('#pErr'), ex.message); }
    });
    $('#pw')?.addEventListener('submit', async e => {
      e.preventDefault(); showErr($('#pwErr'));
      try { await api('/api/account/password', { method: 'POST', body: { current: $('#pwCur')?.value || '', next: $('#pwNew').value } }); toast(me.has_password ? 'Password changed' : 'Password set'); D.me.has_password = true; dashboard(); }
      catch (ex) { showErr($('#pwErr'), ex.message); }
    });
    if (tab === 'profile') {
      api('/api/account/sessions').then(list => {
        $('#sessList').innerHTML = list.map(s => `<li><div><strong>${esc(device(s.device))}</strong><small class="muted">${fmtTime(new Date(s.created_at).toISOString())}</small></div>${s.current ? '<span class="ok-badge">This device</span>' : ''}</li>`).join('');
      }).catch(() => {});
      $('#logoutAll').onclick = async () => { try { const r = await api('/api/account/logout-all', { method: 'POST', body: {} }); toast(`Logged out of ${r.removed} device${r.removed === 1 ? '' : 's'}`); dashboard(); } catch (ex) { toast(ex.message); } };
      $('#verifyBtn')?.addEventListener('click', async () => {
        try { await api('/api/account/verify/send', { method: 'POST', body: {} }); }
        catch (ex) { toast(ex.message); return; }
        $('#verifyBox').innerHTML = `<div class="stack"><p class="m0 small">Code sent to ${esc(me.email)}.</p>${otpInput()}<p class="err" id="vErr" hidden></p></div>`;
        wireOtp(async code => {
          try { await api('/api/account/verify/confirm', { method: 'POST', body: { code } }); toast('Email verified ✓'); D.me.email_verified = true; load(); }
          catch (ex) { showErr($('#vErr'), ex.message); }
        });
      });
    }
  }

  const device = ua => !ua ? 'Unknown device' : `${/Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device'} • ${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'}`;
  const emptyState = (t, s) => `<div class="empty-state">${icons.tag}<strong>${esc(t)}</strong><span class="muted">${esc(s)}</span><a class="btn btn-ghost sm" href="/#shop">Browse products</a></div>`;

  async function load() {
    try {
      const [d, sd] = await Promise.all([api('/api/account/dashboard'), GIS.storeData.catch(() => ({ products: [] }))]);
      D = d; products = sd.products || [];
      document.title = `Dashboard • Get It Sasta`;
      dashboard();
    } catch (e) {
      if (e.status === 401) { OPTS = await api('/api/account/options').catch(() => ({ otp: false })); authView(); } else root.innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p></div>`;
    }
  }
  load();
})();
