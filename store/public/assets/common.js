// Shared helpers for every page
const GIS = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = n => String(n).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '★';
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const productUrl = p => `/p/${p.id}-${slug(p.name)}`;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  async function api(url, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin',
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-Lang': (typeof GIS !== 'undefined' && GIS.loc && GIS.loc.lang) || 'en' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error(GIS.t ? GIS.t('net_err') : 'Check your internet connection and try again.'); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(data.error || (GIS.t ? GIS.t('gen_err') : 'Something went wrong. Please try again.')); e.status = res.status; throw e; }
    return data;
  }

  let toastTimer;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); toast(GIS.t ? GIS.t('copied') : 'Copied'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast(GIS.t ? GIS.t('copied') : 'Copied'); } catch { toast(GIS.t ? GIS.t('copy_fail') : 'Could not copy — please select it manually.'); }
      ta.remove();
    }
    if (btn) { const o = btn.innerHTML; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.innerHTML = o; }, 1500); }
  }

  // CSP inline style allow nahi karta — colors aur widths JS se
  function paint(root = document) {
    $$('[data-bg]', root).forEach(el => { el.style.background = el.dataset.bg; });
    $$('[data-w]', root).forEach(el => { el.style.width = Math.max(0, Math.min(100, +el.dataset.w)) + '%'; });
  }

  // Product ki photo, ya photo na ho to rangeen tile
  function cover(p, cls = 'cover') {
    return p.image
      ? `<div class="${cls} has-img"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async"></div>`
      : `<div class="${cls}" data-bg="${esc(p.color)}"><span>${esc(initials(p.name))}</span></div>`;
  }
  function tile(p, cls = 'tile') {
    return p.image
      ? `<div class="${cls} has-img"><img src="${esc(p.image)}" alt="" loading="lazy"></div>`
      : `<div class="${cls}" data-bg="${esc(p.color)}">${esc(initials(p.name))}</div>`;
  }

  const toDate = s => (s ? new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z')) : null);
  const fmtDate = s => { const d = toDate(s); return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
  const fmtTime = s => { const d = toDate(s); return d ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; };
  const daysLeft = s => { const d = toDate(s); return d ? Math.ceil((d - Date.now()) / 86400e3) : null; };
  const planLen = days => !days ? '' : days % 365 === 0 ? `${days / 365} saal` : days % 30 === 0 ? `${days / 30} mahina` : `${days} din`;

  const icons = {
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 8h4.5a2 2 0 0 1 0 4H9h5a2 2 0 0 1 0 4H9M9 8v8M11 6v2M11 16v2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12.2 2.2 2.2 4.3-4.6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 21v-5h-5"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  };

  // Delivery text → credential card: "Email: x" / "Password: y" lines alag copy buttons ke saath, password chhupa hua
  const SECRET = /pass|pwd|pin|otp|secret|2fa|code|key/i;
  function creds(text, title) {
    const lines = String(text || '').split(/\r?\n/);
    const rows = [], notes = [];
    for (const l of lines) {
      const m = l.match(/^\s*([A-Za-z][\w ./()-]{0,28}?)\s*[:=]\s*(.+?)\s*$/);
      if (m && !/^https?$/i.test(m[1])) rows.push([m[1], m[2]]); else if (l.trim()) notes.push(l.trim());
    }
    const all = esc(text);
    return `<div class="cred">
      <div class="cred-head"><strong>${esc(title || 'Delivery details')}</strong><button class="btn btn-ghost sm" type="button" data-copy="${all}">${icons.copy}Sab copy</button></div>
      ${rows.length ? `<dl class="cred-rows">${rows.map(([k, v]) => {
        const secret = SECRET.test(k);
        return `<div class="cred-row"><dt>${esc(k)}</dt><dd><span class="cred-val${secret ? ' masked' : ''}" data-val="${esc(v)}">${secret ? '••••••••' : esc(v)}</span></dd>
          <div class="cred-act">${secret ? `<button type="button" class="link" data-reveal>Dikhao</button>` : ''}<button type="button" class="icon-btn sm" data-copy="${esc(v)}" aria-label="${esc(k)} copy karo">${icons.copy}</button></div></div>`;
      }).join('')}</dl>` : ''}
      ${notes.length ? `<pre class="delivery">${esc(notes.join('\n'))}</pre>` : ''}
    </div>`;
  }
  // Ek baar lagao: copy + dikhao/chhupao buttons
  document.addEventListener('click', e => {
    const r = e.target.closest('[data-reveal]');
    if (r) {
      const v = r.closest('.cred-row').querySelector('.cred-val');
      const show = v.classList.toggle('masked') === false;
      v.textContent = show ? v.dataset.val : '••••••••';
      r.textContent = show ? 'Chhupao' : 'Dikhao';
      return;
    }
    const c = e.target.closest('[data-copy]');
    if (c && c.closest('.cred, .copy-scope')) copy(c.dataset.copy, c.classList.contains('icon-btn') ? null : c);
  });

  document.addEventListener('DOMContentLoaded', () => { $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); }); });

  return { $, $$, inr, esc, initials, slug, productUrl, store, api, toast, copy, paint, cover, tile, toDate, fmtDate, fmtTime, daysLeft, planLen, icons, creds };
})();
