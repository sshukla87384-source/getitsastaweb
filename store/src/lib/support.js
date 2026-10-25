// Live chat: pehle website ki jaankari se apne aap jawab (bot), customer chahe to insaan (Telegram).
// Telegram par har message "C4821 · Naam" ke saath aata hai; admin us message par Reply kare → jawab website chat mein.
const crypto = require('crypto');
const config = require('../config');
const { db, plain, getSettings, listProducts } = require('../db');
const { str, fail, isEmail, inr } = require('./util');

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const setSetting = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
const bots = () => require('./bots');
const supportBot = () => bots().byRole('support')[0] || null;
const ready = () => !!supportBot();
const L = lang => (lang === 'hinglish' ? 'hg' : lang === 'hi' ? 'hi' : 'en');
const base = () => require('./orders').baseUrl();

// ---------- Knowledge base (website ki jaankari) ----------
// Har topic: keywords (English + Hinglish + Hindi) aur 3 bhashaon mein jawab.
const KB = [
  { id: 'delivery', kw: ['deliver', 'delivery', 'how long', 'when will', 'kab milega', 'kab tak', 'kitna time', 'time lagega', 'kitni der', 'jaldi', 'डिलीवरी', 'कब मिलेगा', 'कितना समय'],
    a: { en: 'Most orders are delivered within 15 minutes to 6 hours after payment is verified (9 am – 11 pm IST). The details appear on your private order page, and we email you too.',
      hg: 'Zyada tar orders payment verify hone ke 15 minute se 6 ghante mein deliver ho jaate hain (subah 9 – raat 11 baje IST). Details aapke order page par aati hain, email bhi aata hai.',
      hi: 'ज़्यादातर ऑर्डर पेमेंट वेरिफ़ाई होने के 15 मिनट से 6 घंटे में डिलीवर हो जाते हैं (सुबह 9 – रात 11 बजे IST)। डिटेल्स आपके ऑर्डर पेज पर आती हैं।' } },
  { id: 'payment', kw: ['payment method', 'how to pay', 'pay kaise', 'kaise pay', 'upi', 'gpay', 'google pay', 'phonepe', 'paytm', 'bhim', 'crypto', 'usdt', 'binance', 'bep20', 'trc20', 'card', 'paypal', 'पेमेंट', 'भुगतान'],
    a: { en: 'You can pay by UPI (GPay, PhonePe, Paytm, BHIM — India) or crypto: USDT on BEP20 / TRC20 or Binance Pay (worldwide). Choose the method at checkout; you pay on the next screen.',
      hg: 'Aap UPI se (GPay, PhonePe, Paytm, BHIM — India) ya crypto se pay kar sakte ho: USDT BEP20 / TRC20 ya Binance Pay (duniya mein kahin se). Method checkout par chuno, payment agli screen par.',
      hi: 'आप UPI (GPay, PhonePe, Paytm, BHIM — भारत) या क्रिप्टो से पे कर सकते हैं: USDT BEP20 / TRC20 या Binance Pay। तरीका चेकआउट पर चुनें।' } },
  { id: 'utr', kw: ['utr', 'transaction id', 'txid', 'tx id', 'ref no', 'reference number', 'upi ref', 'hash', 'यूटीआर'],
    a: { en: 'UTR is the 12-digit "UPI Ref No." — open the payment in GPay / PhonePe / Paytm history to see it. For crypto, it is the transaction hash in your wallet, or the Order ID in Binance Pay.',
      hg: 'UTR 12 digit ka "UPI Ref No." hota hai — GPay / PhonePe / Paytm ki history mein payment kholo, wahan milega. Crypto mein wallet ka transaction hash, ya Binance Pay ka Order ID.',
      hi: 'UTR 12 अंकों का "UPI Ref No." होता है — GPay / PhonePe / Paytm की हिस्ट्री में पेमेंट खोलें। क्रिप्टो में वॉलेट का ट्रांज़ैक्शन हैश।' } },
  { id: 'refund', kw: ['refund', 'warranty', 'replace', 'replacement', 'not working', 'stopped working', "doesn't work", 'kaam nahi', 'chal nahi', 'band ho gaya', 'paisa wapas', 'money back', 'guarantee', 'रिफ़ंड', 'रिफंड', 'वारंटी', 'काम नहीं'],
    a: { en: 'Every plan has a warranty for its full period. If something stops working we replace it; if that is not possible we refund the unused amount. No delivery within 24 hours of payment = full refund.',
      hg: 'Har plan par poore period tak warranty hai. Kuch band ho to replacement milega; na ho sake to bacha hua amount refund. Payment ke 24 ghante mein delivery na ho to poora refund.',
      hi: 'हर प्लान पर पूरी अवधि की वारंटी है। कुछ बंद हो तो रिप्लेसमेंट; न हो सके तो बचा हुआ रिफ़ंड। 24 घंटे में डिलीवरी न हो तो पूरा रिफ़ंड।' },
    links: [['Refund policy', '/policies#refund']] },
  { id: 'track', kw: ['track', 'status', 'my order', 'order kahan', 'order kab', 'where is my order', 'order status', 'mera order', 'ट्रैक', 'मेरा ऑर्डर'],
    a: { en: 'Send me your order ID (it starts with GIS-) and I will check it. You can also open Track order with your order ID and email.',
      hg: 'Apna order ID bhejo (GIS- se shuru hota hai), main check kar deta hoon. Ya Track order page par order ID aur email daalo.',
      hi: 'अपना ऑर्डर ID भेजें (GIS- से शुरू होता है), मैं चेक कर दूँगा। या Track order पेज पर ऑर्डर ID और ईमेल डालें।' },
    links: [['Track order', '/track']] },
  { id: 'account', kw: ['login', 'log in', 'account', 'password', 'otp', 'sign up', 'signup', 'register', 'लॉगिन', 'पासवर्ड', 'अकाउंट'],
    a: { en: 'You can order without an account. With one (password or email OTP) you see all orders, expiry dates and renewals in one dashboard. Forgot your password? Use "Forgot password?" on the login page.',
      hg: 'Bina account ke bhi order kar sakte ho. Account (password ya email OTP) se saare orders, expiry aur renewal ek dashboard mein. Password bhool gaye? Login page par "Forgot password?" dabao.',
      hi: 'बिना अकाउंट भी ऑर्डर कर सकते हैं। अकाउंट से सारे ऑर्डर, एक्सपायरी और रिन्यूअल एक डैशबोर्ड में। पासवर्ड भूल गए? लॉगिन पेज पर "Forgot password?" दबाएँ।' },
    links: [['My account', '/account']] },
  { id: 'trust', kw: ['safe', 'legit', 'genuine', 'real', 'fraud', 'scam', 'trust', 'fake', 'original', 'bharosa', 'sahi hai', 'असली', 'भरोसा', 'सुरक्षित'],
    a: { en: 'Every order comes with a warranty and a private order page, and payments are verified before delivery. If anything goes wrong, a real person on our team helps you on WhatsApp or right here in chat.',
      hg: 'Har order ke saath warranty aur private order page milta hai, payment verify hone ke baad hi delivery. Kuch gadbad ho to hamari team ka asli insaan WhatsApp ya yahin chat par madad karta hai.',
      hi: 'हर ऑर्डर के साथ वारंटी और निजी ऑर्डर पेज मिलता है। कुछ गड़बड़ हो तो हमारी टीम का असली इंसान WhatsApp या यहीं चैट पर मदद करता है।' } },
  { id: 'coupon', kw: ['coupon', 'discount', 'offer', 'promo', 'code', 'sale', 'cheaper', 'refer', 'referral', 'कूपन', 'छूट', 'ऑफ़र'],
    a: { en: 'Subscribe to our newsletter for a first-order discount code, and share your referral link (Account → Refer & earn): your friend gets a discount and you earn a reward code. Enter codes in the cart.',
      hg: 'Newsletter subscribe karo to pehle order ka discount code milta hai. Account → Refer & earn se link bhejo: dost ko discount, aapko reward code. Code cart mein lagao.',
      hi: 'न्यूज़लेटर सब्सक्राइब करें तो पहले ऑर्डर का डिस्काउंट कोड मिलता है। Account → Refer & earn से लिंक भेजें: दोस्त को छूट, आपको रिवॉर्ड कोड।' } },
  { id: 'howto', kw: ['how to buy', 'how to order', 'how do i order', 'order kaise', 'kaise kharide', 'kaise order', 'kharidna', 'buy', 'purchase', 'ऑर्डर कैसे', 'कैसे खरीदें'],
    a: { en: '1) Pick a product and plan and tap Buy now. 2) Enter your email and WhatsApp number, choose UPI or crypto, and place the order. 3) Pay — details appear on your order page once payment is verified.',
      hg: '1) Product aur plan chuno, Buy now dabao. 2) Email aur WhatsApp number daalo, UPI ya crypto chuno, order place karo. 3) Pay karo — verify hote hi details order page par.',
      hi: '1) प्रोडक्ट और प्लान चुनें, Buy now दबाएँ। 2) ईमेल और WhatsApp नंबर डालें, UPI या क्रिप्टो चुनें। 3) पे करें — डिटेल्स ऑर्डर पेज पर।' } },
];
const HUMAN_KW = ['human', 'agent', 'person', 'real person', 'someone', 'staff', 'team', 'talk to', 'speak to', 'baat kar', 'baat karni', 'insaan', 'call me', 'contact', 'इंसान', 'बात करनी', 'एजेंट'];
const HELLO_KW = ['hi', 'hello', 'hey', 'hii', 'helo', 'namaste', 'namaskar', 'good morning', 'good evening', 'नमस्ते', 'हेलो'];
const T = {
  hello: { en: 'Hi! 👋 I’m the Get It Sasta assistant. Ask me about products, prices, delivery or payment — or talk to our team anytime.', hg: 'Namaste! 👋 Main Get It Sasta assistant hoon. Products, price, delivery ya payment ke baare mein poochho — ya kabhi bhi team se baat karo.', hi: 'नमस्ते! 👋 मैं Get It Sasta असिस्टेंट हूँ। प्रोडक्ट, कीमत, डिलीवरी या पेमेंट के बारे में पूछें — या कभी भी टीम से बात करें।' },
  unknown: { en: 'I’m not sure about that one. Try one of these topics, or talk to a real person on our team.', hg: 'Iska pakka jawab mere paas nahi hai. Neeche wale topics try karo, ya hamari team ke insaan se baat karo.', hi: 'इसका पक्का जवाब मेरे पास नहीं है। नीचे के विषय देखें, या हमारी टीम से बात करें।' },
  helped: { en: 'Anything else? You can also talk to our team.', hg: 'Aur kuch? Team se bhi baat kar sakte ho.', hi: 'और कुछ? टीम से भी बात कर सकते हैं।' },
  connected: { en: 'You’re connected to our team ✓ A real person will reply here — usually within a few minutes (9 am – 11 pm IST). You can close this window; replies stay in this chat.', hg: 'Aap hamari team se jud gaye ✓ Asli insaan yahin jawab dega — aam taur par kuch minute mein (subah 9 – raat 11 baje). Window band kar sakte ho; jawab isi chat mein milega.', hi: 'आप हमारी टीम से जुड़ गए ✓ असली इंसान यहीं जवाब देगा — आमतौर पर कुछ मिनट में। जवाब इसी चैट में मिलेगा।' },
  offline: { en: 'Live support isn’t connected right now. Please message us on WhatsApp or email — we reply fast.', hg: 'Live support abhi juda nahi hai. WhatsApp ya email par message karo — jaldi jawab milega.', hi: 'लाइव सपोर्ट अभी जुड़ा नहीं है। WhatsApp या ईमेल पर संदेश भेजें।' },
  closed: { en: 'This conversation was closed by our team. Write again anytime to start a new one.', hg: 'Team ne ye baatcheet band kar di. Kabhi bhi dobara likho, nayi shuru ho jayegi.', hi: 'टीम ने यह बातचीत बंद कर दी। कभी भी दोबारा लिखें।' },
  order_not_found: { en: 'I couldn’t find order {c}. Please check the ID (it looks like GIS-AB12CD3).', hg: 'Order {c} nahi mila. ID check karo (aisa dikhta hai: GIS-AB12CD3).', hi: 'ऑर्डर {c} नहीं मिला। ID जाँचें (जैसे GIS-AB12CD3)।' },
  order_private: { en: 'I found order {c}. For your privacy, open it with the email you used when ordering:', hg: 'Order {c} mil gaya. Privacy ke liye use usi email se kholo jo order mein di thi:', hi: 'ऑर्डर {c} मिल गया। प्राइवेसी के लिए उसे उसी ईमेल से खोलें:' },
  order_status: { en: 'Order {c}: {s}.', hg: 'Order {c}: {s}.', hi: 'ऑर्डर {c}: {s}।' },
  products: { en: 'Here’s what I found:', hg: 'Ye mila:', hi: 'यह मिला:' },
  from: { en: 'from', hg: 'se shuru', hi: 'से शुरू' },
};
const STATUS = {
  awaiting_payment: { en: 'waiting for payment', hg: 'payment baaki hai', hi: 'पेमेंट बाकी है' },
  verifying: { en: 'payment is being verified', hg: 'payment verify ho raha hai', hi: 'पेमेंट वेरिफ़ाई हो रहा है' },
  paid: { en: 'paid — delivery in progress', hg: 'paid — delivery ho rahi hai', hi: 'पेमेंट मिला — डिलीवरी हो रही है' },
  delivered: { en: 'delivered ✓ — details are on your order page', hg: 'delivered ✓ — details order page par hain', hi: 'डिलीवर ✓ — डिटेल्स ऑर्डर पेज पर' },
  cancelled: { en: 'cancelled', hg: 'cancel ho gaya', hi: 'कैंसल' },
};
const CHIPS = {
  en: [['Delivery time', 'How long does delivery take?'], ['Payment methods', 'How can I pay?'], ['Refund & warranty', 'What about refund and warranty?'], ['Track my order', 'Track my order']],
  hg: [['Delivery kab?', 'Delivery kab tak milegi?'], ['Payment kaise?', 'Pay kaise karu?'], ['Refund / warranty', 'Refund aur warranty?'], ['Order track', 'Mera order track karo']],
  hi: [['डिलीवरी कब?', 'डिलीवरी कब तक मिलेगी?'], ['पेमेंट कैसे?', 'पेमेंट कैसे करें?'], ['रिफ़ंड / वारंटी', 'रिफ़ंड और वारंटी?'], ['ऑर्डर ट्रैक', 'मेरा ऑर्डर ट्रैक करें']],
};
const HUMAN_LABEL = { en: 'Talk to a person', hg: 'Insaan se baat karo', hi: 'इंसान से बात करें' };
const fmt = (s, v = {}) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(x), s);
const norm = s => ` ${String(s).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ')} `;
const has = (n, k) => (k.length <= 3 ? n.includes(` ${k} `) : n.includes(k));

function botReply(text, chat) {
  const l = L(chat.lang), n = norm(text);
  const chips = CHIPS[l].map(([label, q]) => ({ label, q }));
  const human = { label: HUMAN_LABEL[l], action: 'human' };
  // Order ID
  const m = String(text).toUpperCase().match(/GIS-[A-Z0-9]{5,10}/);
  if (m) {
    const o = plain(db.prepare('SELECT code, email, status, customer_id FROM orders WHERE code = ?').get(m[0]));
    if (!o) return { text: fmt(T.order_not_found[l], { c: m[0] }), chips: [human] };
    const mine = (chat.email && chat.email === o.email) || (chat.customer_id && chat.customer_id === o.customer_id);
    if (mine) return { text: fmt(T.order_status[l], { c: o.code, s: STATUS[o.status]?.[l] || o.status }), links: [[o.code, `/order/${o.code}`]], chips: [human] };
    return { text: fmt(T.order_private[l], { c: o.code }), links: [['Track order', `/track`]], chips: [human] };
  }
  if (HUMAN_KW.some(k => has(n, k))) return { text: '', escalate: true };
  // Products (naam ya category)
  const prods = listProducts().filter(p => p.active !== 0 && p.plans?.length);
  const hits = prods.filter(p => { const nm = norm(p.name).trim(); const first = nm.split(' ')[0]; return n.includes(` ${nm} `) || (first.length > 3 && has(n, first)) || has(n, norm(p.category).trim()); }).slice(0, 4);
  if (hits.length) {
    const lines = hits.map(p => { const pl = [...p.plans].sort((a, b) => a.price - b.price)[0]; return `• ${p.name} — ${l === 'en' ? `from ${inr(pl.price)}` : `${inr(pl.price)} ${T.from[l]}`} (${pl.label})${pl.mrp > pl.price ? `, MRP ${inr(pl.mrp)}` : ''}`; });
    const slug = p => `/p/${p.id}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    return { text: `${T.products[l]}\n${lines.join('\n')}`, links: hits.map(p => [p.name, slug(p)]), chips: [human] };
  }
  // Topics — sabse zyada keyword match
  let best = null, score = 0;
  for (const k of KB) { const sc = k.kw.filter(w => has(n, w)).length; if (sc > score) { best = k; score = sc; } }
  if (best) return { text: best.a[l], links: best.links, chips: [...chips.filter(c => !best.a[l].includes(c.q)).slice(0, 3), human] };
  if (HELLO_KW.some(k => has(n, k))) return { text: T.hello[l], chips: [...chips, human] };
  return { text: T.unknown[l], chips: [...chips, human] };
}

// ---------- Chat rows ----------
const byToken = token => (/^[a-f0-9]{48}$/.test(String(token || '')) ? plain(db.prepare('SELECT * FROM chats WHERE token = ?').get(token)) : null);
function addMsg(chatId, sender, text, meta = null, tg = null) {
  const id = Number(db.prepare('INSERT INTO chat_messages (chat_id, sender, text, meta, tg_message_id) VALUES (?,?,?,?,?)').run(chatId, sender, text, meta ? JSON.stringify(meta) : '', tg).lastInsertRowid);
  db.prepare('UPDATE chats SET last_at = ? WHERE id = ?').run(now(), chatId);
  return id;
}
function newChat({ lang, page, customer }) {
  for (let i = 0; i < 6; i++) {
    const code = 'C' + (1000 + crypto.randomInt(9000));
    if (db.prepare('SELECT 1 FROM chats WHERE code = ?').get(code)) continue;
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO chats (code, token, name, email, customer_id, lang, page) VALUES (?,?,?,?,?,?,?)')
      .run(code, token, customer?.name || '', customer?.email || '', customer?.id || null, lang || '', page || '');
    return byToken(token);
  }
  const code = 'C' + crypto.randomBytes(3).toString('hex').toUpperCase(), token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO chats (code, token, lang, page) VALUES (?,?,?,?)').run(code, token, lang || '', page || '');
  return byToken(token);
}
const view = m => ({ id: m.id, from: m.sender, text: m.text, at: m.created_at, ...(m.meta ? JSON.parse(m.meta) : {}) });
const messages = (chatId, after = 0) => db.prepare('SELECT * FROM chat_messages WHERE chat_id = ? AND id > ? ORDER BY id LIMIT 200').all(chatId, Number(after) || 0).map(plain).map(view).filter(m => !m.hidden);
const pub = c => ({ code: c.code, status: c.status, name: c.name, email: c.email, human_ready: ready() });

// ---------- Telegram (bots.js ke through) ----------
const label = c => `${c.code} · ${c.name || 'Guest'}${c.email ? ` (${c.email})` : ''}`;
async function toTelegram(c, text, rowId) {
  const bot = supportBot(); if (!bot) return;
  try {
    const r = await bots().send(bot, text.slice(0, 3900));
    if (rowId) db.prepare('UPDATE chat_messages SET tg_message_id = ? WHERE id = ?').run(r.message_id, rowId);
    else addMsg(c.id, 'system', '[telegram]', { hidden: true }, r.message_id);
    return r.message_id;
  } catch (e) { console.error('[support tg]', e.message); }
}

// Support bot par admin ne likha. true = ye live chat ka message tha (handle ho gaya)
async function onAdminMessage(m, bot) {
  const text = String(m.text || m.caption || '').trim(); if (!text) return false;
  const reply = t => bots().send(bot, t).catch(() => {});
  let chat = null, body = text;
  const cmd = text.match(/^\/(close|r|reply)(?:@\w+)?\s+#?(C[0-9A-F]{4,6})\b\s*([\s\S]*)$/i);
  const tagged = text.match(/^#?(C\d{4})\s+([\s\S]+)$/i);
  if (cmd) { chat = plain(db.prepare('SELECT * FROM chats WHERE code = ?').get(cmd[2].toUpperCase())); body = cmd[3].trim(); }
  else if (/^\/chats\b/i.test(text)) {
    const open = db.prepare("SELECT * FROM chats WHERE status = 'human' ORDER BY last_at DESC LIMIT 15").all().map(plain);
    await reply(open.length ? `Open chats:\n${open.map(c => `• ${label(c)} — ${c.last_at}`).join('\n')}\n\nReply karo kisi bhi message par, ya: /r C1234 jawab` : 'Koi open chat nahi.');
    return true;
  } else if (m.reply_to_message) {
    const row = plain(db.prepare('SELECT chat_id FROM chat_messages WHERE tg_message_id = ? ORDER BY id DESC LIMIT 1').get(m.reply_to_message.message_id));
    if (row) chat = plain(db.prepare('SELECT * FROM chats WHERE id = ?').get(row.chat_id));
    else return false;   // kisi aur message ka reply (jaise order alert) — admin commands dekhein
  } else if (tagged) { chat = plain(db.prepare('SELECT * FROM chats WHERE code = ?').get(tagged[1].toUpperCase())); body = tagged[2].trim(); }
  else return false;
  if (!chat) { await reply('⚠️ Ye chat nahi mili. Customer ke message par Reply karo, ya /r C1234 jawab likho.'); return true; }
  if (cmd && cmd[1].toLowerCase() === 'close') {
    db.prepare("UPDATE chats SET status = 'closed' WHERE id = ?").run(chat.id);
    addMsg(chat.id, 'system', T.closed[L(chat.lang)]);
    await reply(`✓ ${chat.code} band kar diya.`);
    return true;
  }
  if (!body) return true;
  const agent = m.from?.first_name ? String(m.from.first_name).slice(0, 30) : '';
  addMsg(chat.id, 'agent', body.slice(0, 2000), agent ? { agent } : null, m.message_id);
  db.prepare("UPDATE chats SET status = 'human', unread_agent = unread_agent + 1 WHERE id = ?").run(chat.id);
  try { require('./outhooks').emit('chat.message', { chat: chat.code, from: 'agent', text: body.slice(0, 2000) }); } catch {}
  return true;
}

function start() {}   // polling ab bots.js karta hai
const status = () => { const b = supportBot(); const st = b ? (bots().list().find(x => String(x.id) === String(b.id)) || {}) : {}; return { ready: !!b, bot: b?.name || '', error: st.error || '', mode: st.mode || 'off', last_ok: st.last_ok || 0 }; };

// ---------- Public API helpers ----------
function get(token, after) {
  const c = byToken(token); if (!c) fail(404, 'Chat not found');
  if (c.unread_agent) db.prepare('UPDATE chats SET unread_agent = 0 WHERE id = ?').run(c.id);
  return { chat: pub(c), messages: messages(c.id, after) };
}

async function send({ token, text, lang, page, after }, customer) {
  text = str(text, 1000).trim();
  if (!text) fail(400, 'Type a message.');
  let c = byToken(token);
  const fresh = !c;
  if (!c) c = newChat({ lang, page, customer });
  if (lang && ['en', 'hi', 'hinglish'].includes(lang) && lang !== c.lang) { db.prepare('UPDATE chats SET lang = ? WHERE id = ?').run(lang, c.id); c.lang = lang; }
  const recent = db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE chat_id = ? AND sender = 'user' AND created_at > datetime('now','-1 minute')").get(c.id).n;
  if (recent >= 12) fail(429, 'Too many messages. Please wait a minute.');
  if (c.status === 'closed') { db.prepare("UPDATE chats SET status = 'bot' WHERE id = ?").run(c.id); c.status = 'bot'; }
  const rowId = addMsg(c.id, 'user', text);
  if (c.status === 'human') {
    await toTelegram(c, `💬 ${label(c)}\n${text}`, rowId);
  } else {
    const r = botReply(text, c);
    if (r.escalate) return { token: c.token, ...(await human({ token: c.token }, customer, true)) };
    addMsg(c.id, 'bot', r.text, { chips: r.chips || [], links: (r.links || []).map(([l, u]) => ({ label: l, url: u })) });
  }
  return { token: c.token, chat: pub(byToken(c.token)), messages: messages(c.id, fresh ? 0 : after) };
}

// Insaan se baat: naam/email lo (zaroori nahi), Telegram par poori baat bhejo
async function human({ token, name, email, lang, page, after }, customer, viaText = false) {
  let c = byToken(token);
  if (!c) c = newChat({ lang, page, customer });
  const l = L(lang || c.lang);
  name = str(name || c.name || customer?.name || '', 60).trim();
  email = str(email || c.email || customer?.email || '', 120).trim().toLowerCase();
  if (email && !isEmail(email)) fail(400, 'Please enter a valid email.');
  db.prepare('UPDATE chats SET name = ?, email = ? WHERE id = ?').run(name, email, c.id);
  c = byToken(c.token);
  if (!ready()) {
    const s = getSettings();
    addMsg(c.id, 'bot', T.offline[l], { links: [...(s.whatsapp ? [{ label: 'WhatsApp', url: `https://wa.me/${s.whatsapp}` }] : []), ...(s.support_email ? [{ label: s.support_email, url: `mailto:${s.support_email}` }] : [])] });
    return { token: c.token, chat: pub(c), messages: messages(c.id, after) };
  }
  if (c.status !== 'human') {
    db.prepare("UPDATE chats SET status = 'human' WHERE id = ?").run(c.id);
    const hist = db.prepare("SELECT sender, text FROM chat_messages WHERE chat_id = ? AND sender IN ('user','bot') ORDER BY id DESC LIMIT 8").all(c.id).reverse();
    const ord = c.email ? plain(db.prepare('SELECT code, status FROM orders WHERE email = ? ORDER BY id DESC LIMIT 1').get(c.email)) : null;
    const head = `🙋 Naya live chat ${label(c)}\nPage: ${c.page || '/'}${ord ? `\nLast order: ${ord.code} (${ord.status})` : ''}${hist.length ? `\n\n— Ab tak —\n${hist.map(h => `${h.sender === 'user' ? '👤' : '🤖'} ${h.text.slice(0, 300)}`).join('\n')}` : ''}\n\n↩️ Is message par Reply karo — jawab website chat mein jayega.`;
    const lastUser = plain(db.prepare("SELECT id FROM chat_messages WHERE chat_id = ? AND sender = 'user' ORDER BY id DESC LIMIT 1").get(c.id));
    await toTelegram(c, head, viaText && lastUser ? lastUser.id : null);
    try { require('./outhooks').emit('chat.human', { chat: c.code, name: c.name, email: c.email, page: c.page }); } catch {}
    addMsg(c.id, 'system', T.connected[l]);
  }
  return { token: c.token, chat: pub(byToken(c.token)), messages: messages(c.id, after) };
}

function adminList() {
  return db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id AND m.sender = 'user') AS user_msgs FROM chats c ORDER BY c.last_at DESC LIMIT 100`).all().map(plain);
}
// 60 din purani bot-only chats hatao
function cleanup() { db.prepare("DELETE FROM chats WHERE status != 'human' AND last_at < datetime('now','-60 days')").run(); }
setInterval(cleanup, 12 * 3600e3).unref();

module.exports = { send, get, human, start, status, botReply, adminList, onAdminMessage, ready };
