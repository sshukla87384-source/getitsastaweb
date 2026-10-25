// Live chat widget: bot pehle jawab deta hai, "Talk to a person" se Telegram par team.
(() => {
  const { $, esc, store, api, icons } = GIS;
  const t = (k, v) => GIS.t(k, v);
  const KEY = 'gis-chat';
  let st = store.get(KEY, {});            // { token, last, seen }
  let msgs = [], chat = null, open = false, busy = false, timer = null, formOpen = false;

  const BUBBLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>';
  const SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 14-7-5 15-3-6z"/></svg>';
  document.body.insertAdjacentHTML('beforeend', `
    <button class="chat-fab" id="chatFab" type="button" aria-label="Chat" aria-expanded="false">${BUBBLE}<span class="chat-badge" id="chatBadge" hidden></span></button>
    <section class="chat-panel" id="chatPanel" role="dialog" aria-modal="false" aria-labelledby="chatTitle" hidden>
      <header class="chat-head">
        <div class="chat-av"><img src="/favicon.svg" alt=""><i class="on"></i></div>
        <div class="chat-hd"><strong id="chatTitle"></strong><small id="chatSub"></small></div>
        <button class="icon-btn" type="button" id="chatClose" aria-label="Close">${icons.x}</button>
      </header>
      <div class="chat-body" id="chatBody" aria-live="polite"></div>
      <form class="chat-in" id="chatForm" novalidate>
        <label class="sr" for="chatText">Message</label>
        <textarea id="chatText" rows="1" maxlength="1000" autocomplete="off"></textarea>
        <button class="chat-send" type="submit" id="chatSend" aria-label="Send">${SEND}</button>
      </form>
      <p class="chat-foot" id="chatFoot"></p>
    </section>`);
  const panel = $('#chatPanel'), body = $('#chatBody'), input = $('#chatText');

  const save = () => store.set(KEY, st);
  const lastId = () => msgs.reduce((a, m) => Math.max(a, m.id || 0), 0);
  const human = () => chat?.status === 'human';
  const linkify = s => esc(s).replace(/(GIS-[A-Z0-9]{5,10})/g, '<a href="/order/$1">$1</a>').replace(/\n/g, '<br>');
  const time = at => { try { return new Date(at.replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

  function header() {
    $('#chatTitle').textContent = t('chat_title');
    $('#chatSub').textContent = human() ? t('chat_sub_human') : t('chat_sub_bot');
    input.placeholder = t('chat_ph');
    $('#chatFoot').innerHTML = human() ? esc(t('chat_foot_human')) : `<button type="button" class="link" data-human>${esc(t('chat_human'))}</button>`;
  }

  function greeting() {
    return { id: 0, from: 'bot', text: t('chat_hello'), chips: [1, 2, 3, 4].map(i => ({ label: t('chat_c' + i), q: t('chat_q' + i) })).concat([{ label: t('chat_human'), action: 'human' }]) };
  }

  function bubble(m, i, list) {
    if (m.from === 'system') return `<div class="cm sys">${linkify(m.text)}</div>`;
    const mine = m.from === 'user';
    const lastOfGroup = !list[i + 1] || list[i + 1].from !== m.from;
    const who = m.from === 'agent' ? `<span class="cm-who">${esc(m.agent || t('chat_team'))} · ${esc(t('chat_team'))}</span>` : '';
    const isLast = i === list.length - 1;
    const chips = !mine && isLast && m.chips?.length && !busy ? `<div class="cm-chips">${m.chips.map(c => c.action === 'human'
      ? (human() ? '' : `<button type="button" class="chip-h" data-human>${icons.user}${esc(c.label)}</button>`)
      : `<button type="button" data-q="${esc(c.q)}">${esc(c.label)}</button>`).join('')}</div>` : '';
    const links = m.links?.length ? `<div class="cm-links">${m.links.map(l => `<a href="${esc(l.url)}"${/^https?:/.test(l.url) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)} →</a>`).join('')}</div>` : '';
    return `<div class="cm ${mine ? 'me' : m.from}${lastOfGroup ? ' tail' : ''}">${who}<div class="cm-b">${linkify(m.text)}${links}</div>${lastOfGroup && m.at ? `<span class="cm-t">${time(m.at)}</span>` : ''}</div>${chips}`;
  }

  function render() {
    header();
    const list = [greeting(), ...msgs.filter(m => m.text)];
    let html = list.map(bubble).join('');
    if (busy) html += `<div class="cm bot tail"><div class="cm-b typing"><i></i><i></i><i></i></div></div>`;
    if (formOpen) {
      const c = GIS.storeData && window.__gisCustomer || store.get('gis-customer', {});
      html += `<form class="chat-form" id="humanForm" novalidate>
        <strong>${esc(t('chat_form_t'))}</strong><small>${esc(t('chat_form_p'))}</small>
        <input id="hName" placeholder="${esc(t('name'))}" autocomplete="name" value="${esc(chat?.name || c.name || '')}">
        <input id="hEmail" type="email" placeholder="${esc(t('chat_email_opt'))}" autocomplete="email" value="${esc(chat?.email || c.email || '')}">
        <p class="err m0" id="hErr" hidden></p>
        <div class="row-gap"><button class="btn btn-primary" type="submit">${esc(t('chat_connect'))}</button><button class="btn btn-ghost" type="button" id="hCancel">${esc(t('chat_cancel'))}</button></div></form>`;
    }
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
    if (formOpen) { $('#humanForm').onsubmit = connect; $('#hCancel').onclick = () => { formOpen = false; render(); }; setTimeout(() => $('#hName')?.focus(), 30); }
  }

  async function load(quiet) {
    if (!st.token) return;
    try {
      const r = await api(`/api/chat?token=${encodeURIComponent(st.token)}&after=${quiet ? lastId() : 0}`);
      chat = r.chat;
      if (!quiet) msgs = r.messages; else if (r.messages.length) msgs = msgs.concat(r.messages.filter(m => !msgs.some(x => x.id === m.id)));
      const lastAgent = [...msgs].reverse().find(m => m.from === 'agent');
      if (lastAgent && lastAgent.id > (st.seen || 0)) { if (open) { st.seen = lastAgent.id; save(); } else badge(true); }
      if (open && (!quiet || r.messages.length)) render();
    } catch (e) { if (e.status === 404) { st = {}; save(); msgs = []; chat = null; if (open) render(); } }
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (!st.token || !human()) return;
    timer = setTimeout(() => { if (!document.hidden) load(true); else schedule(); }, open ? 4000 : 25000);
  }
  function badge(v) { $('#chatBadge').hidden = !v; }

  async function send(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    const after = lastId();
    msgs.push({ id: 1e12 + Date.now(), from: 'user', text, at: new Date().toISOString().slice(0, 19).replace('T', ' '), pending: true });
    busy = !human(); render();
    try {
      const r = await api('/api/chat/send', { method: 'POST', body: { token: st.token, text, lang: GIS.loc.lang, page: location.pathname, after } });
      st.token = r.token; save(); chat = r.chat;
      msgs = msgs.filter(m => !m.pending);
      msgs = msgs.concat(r.messages.filter(m => !msgs.some(x => x.id === m.id)));
    } catch (e) {
      msgs = msgs.filter(m => !m.pending);
      msgs.push({ id: 0, from: 'system', text: e.message });
    }
    busy = false; render(); schedule();
  }

  async function connect(e) {
    e.preventDefault();
    const err = $('#hErr'); err.hidden = true;
    try {
      const r = await api('/api/chat/human', { method: 'POST', body: { token: st.token, name: $('#hName').value, email: $('#hEmail').value, lang: GIS.loc.lang, page: location.pathname, after: lastId() } });
      st.token = r.token; save(); chat = r.chat; formOpen = false;
      msgs = msgs.concat(r.messages.filter(m => !msgs.some(x => x.id === m.id)));
      render(); schedule();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  }

  function toggle(v) {
    open = v; panel.hidden = !v; $('#chatFab').setAttribute('aria-expanded', String(v)); $('#chatFab').classList.toggle('on', v);
    document.body.classList.toggle('chat-open', v);
    if (v) { badge(false); render(); load(); setTimeout(() => input.focus(), 50); } else schedule();
  }

  $('#chatFab').onclick = () => toggle(!open);
  $('#chatClose').onclick = () => toggle(false);
  $('#chatForm').onsubmit = e => { e.preventDefault(); const v = input.value; input.value = ''; input.style.height = ''; send(v); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
  panel.addEventListener('click', e => {
    const q = e.target.closest('[data-q]'); if (q) return send(q.dataset.q);
    if (e.target.closest('[data-human]')) { formOpen = true; render(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) toggle(false); });
  document.addEventListener('gis-locale', () => { if (open) render(); });
  GIS.storeData?.then(d => { window.__gisCustomer = d.customer || null; }).catch(() => {});
  GIS.chat = { open: () => toggle(true) };
  if (st.token) load(true);
})();
