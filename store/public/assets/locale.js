// Country → currency + language. Customer khud badal sakta hai (header ka 🌐 button).
// Prices: INR = asli ₹ price; baaki currency = USD price (wahi USDT mein charge hota hai) × rate.
(() => {
  const { $, $$, esc, store } = GIS;

  // ---------- Countries ----------
  const COUNTRIES = [
    ['IN', 'India', 'INR', '🇮🇳'], ['US', 'United States', 'USD', '🇺🇸'], ['GB', 'United Kingdom', 'GBP', '🇬🇧'], ['AE', 'UAE', 'AED', '🇦🇪'],
    ['SA', 'Saudi Arabia', 'SAR', '🇸🇦'], ['CA', 'Canada', 'CAD', '🇨🇦'], ['AU', 'Australia', 'AUD', '🇦🇺'], ['SG', 'Singapore', 'SGD', '🇸🇬'],
    ['NP', 'Nepal', 'NPR', '🇳🇵'], ['BD', 'Bangladesh', 'BDT', '🇧🇩'], ['DE', 'Germany', 'EUR', '🇩🇪'], ['FR', 'France', 'EUR', '🇫🇷'],
    ['NL', 'Netherlands', 'EUR', '🇳🇱'], ['IT', 'Italy', 'EUR', '🇮🇹'], ['ES', 'Spain', 'EUR', '🇪🇸'], ['IE', 'Ireland', 'EUR', '🇮🇪'],
    ['QA', 'Qatar', 'USD', '🇶🇦'], ['KW', 'Kuwait', 'USD', '🇰🇼'], ['OM', 'Oman', 'USD', '🇴🇲'], ['BH', 'Bahrain', 'USD', '🇧🇭'],
    ['MY', 'Malaysia', 'USD', '🇲🇾'], ['PK', 'Pakistan', 'USD', '🇵🇰'], ['LK', 'Sri Lanka', 'USD', '🇱🇰'], ['NZ', 'New Zealand', 'USD', '🇳🇿'],
    ['XX', 'Other country', 'USD', '🌐'],
  ];
  const TZ = { 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Europe/London': 'GB', 'Asia/Singapore': 'SG', 'Asia/Kathmandu': 'NP', 'Asia/Katmandu': 'NP', 'Asia/Dhaka': 'BD',
    'Europe/Berlin': 'DE', 'Europe/Paris': 'FR', 'Europe/Amsterdam': 'NL', 'Europe/Rome': 'IT', 'Europe/Madrid': 'ES', 'Europe/Dublin': 'IE', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Muscat': 'OM', 'Asia/Bahrain': 'BH',
    'Asia/Kuala_Lumpur': 'MY', 'Asia/Karachi': 'PK', 'Asia/Colombo': 'LK', 'Pacific/Auckland': 'NZ' };
  function detect() {
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
    if (TZ[tz]) return TZ[tz];
    if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns)/.test(tz)) return 'CA';
    if (/^America\//.test(tz)) return 'US';
    if (/^Australia\//.test(tz)) return 'AU';
    const reg = (navigator.language || '').split('-')[1];
    return reg && COUNTRIES.some(c => c[0] === reg.toUpperCase()) ? reg.toUpperCase() : 'XX';
  }
  const countryOf = code => COUNTRIES.find(c => c[0] === code) || COUNTRIES.at(-1);

  // ---------- State ----------
  const saved = store.get('gis-locale', null);
  // v2: English default ho gaya — purane auto-saved Hinglish ko hata do (customer dobara chun sakta hai)
  if (saved && saved.v !== 2) delete saved.lang;
  const detected = detect();
  const st = {
    country: saved?.country || detected,
    currency: saved?.currency || countryOf(saved?.country || detected)[2],
    lang: saved?.lang || '',   // '' = store ka default (English)
  };
  let currencies = [{ code: 'INR', symbol: '₹', decimals: 0, rate: 90 }, { code: 'USD', symbol: '$', decimals: 2, rate: 1 }];

  // ---------- Strings ----------
  const D = {
    en: {
      nav_products: 'Products', nav_track: 'Track order', login: 'Login', my_account: 'My account', cart: 'Cart', open_cart: 'Open cart',
      hero_lead: 'AI, video editing, design and entertainment subscriptions in one place. Pay by UPI or crypto, same-day delivery right on your order page.',
      hero_lead_intl: 'AI, video editing, design and entertainment subscriptions in one place. Pay in USD with crypto (USDT / Binance Pay), same-day delivery.',
      see_products: 'See products', my_dashboard: 'My dashboard', trust_pay: 'UPI & crypto', trust_pay_intl: 'USD · crypto payment', trust_fast: 'Same-day delivery', trust_support: 'Replacement support',
      shop_title: 'Everything, sasta', loading_products: 'Loading products…', n_products: '{n} products • {c} categories', all: 'All',
      search_ph: 'Search… e.g. CapCut', no_match: 'No product found for "{q}". Try another name.', load_fail: 'Products did not load.', retry: 'Try again',
      add: 'Add', added: 'Added', oos: 'Out of stock', instant: 'Instant', from: 'from',
      how_title: 'How ordering works', s1_t: 'Add to cart', s1_p: 'Pick a product and plan, enter name, email and mobile to place the order.',
      s2_t: 'Pay', s2_p: 'On the order page pay by UPI (India) or crypto — USDT / Binance Pay (worldwide).', s3_t: 'Get delivery', s3_p: 'As soon as payment is verified, details appear on your order page. Keep the link.',
      faq1_q: 'How long does delivery take?', faq1_a: 'Most orders are delivered within 15 minutes to 6 hours after payment (9 am – 11 pm IST).',
      faq2_q: 'Where do I find the UTR / TxID?', faq2_a: 'UPI: open the payment in GPay / PhonePe / Paytm — the 12-digit "UPI Ref No". Crypto: the transaction hash in your wallet, or the Order ID in Binance Pay.',
      faq3_q: 'What if something does not work?', faq3_a: 'Message us on WhatsApp from the order page with your order ID. Replacement or refund within warranty.',
      foot_refund: 'Refund policy', foot_terms: 'Terms', foot_privacy: 'Privacy',
      // cart
      your_cart: 'Your cart', cart_empty: 'Your cart is empty.<br>Pick a product and press "Add".', subtotal: 'Subtotal', mrp_save: 'You save vs MRP', coupon: 'Coupon', total: 'Total',
      coupon_ph: 'Coupon code', apply: 'Apply', remove: 'Remove', checkout_btn: 'Checkout →', dec: 'Decrease', inc: 'Increase', checkout: 'Checkout',
      saved_to_dash: 'This order will be saved in your dashboard.', name: 'Name', email: 'Email', email_hint: 'Order details and updates go to this email.', mobile: 'Mobile (WhatsApp)',
      mobile_hint_intl: 'With country code, e.g. +971 50 123 4567', acct_hint: 'With an account you get all orders, expiry dates and renewals in one place.', login_or_signup: 'Login / Create account',
      back_cart: '← Back to cart', place_order: 'Place order', placing: 'Placing order…', next_pay: 'Pay on the next page with UPI or crypto', next_pay_intl: 'Pay on the next page in USD with crypto (USDT / Binance Pay)',
      only_left: 'Only {n} left', oos_toast: 'This plan is out of stock right now', charged_usd: 'Charged in USD (USDT): {usd}', approx: '≈',
      // product
      not_found: 'Product not found', not_found_p: 'This product is no longer available.', see_more: 'See other products', pick_plan: 'Choose a plan', instant_delivery: 'Instant delivery', same_day: 'Same-day delivery',
      fact_instant: 'Instant delivery on your order page as soon as you pay', fact_sameday: 'Same-day delivery after payment is verified', validity: 'Validity: {d} (expiry date shows in your dashboard)',
      fact_pay: 'Payment: UPI (India) or crypto — USDT, Binance Pay', fact_pay_intl: 'Payment: USD via crypto — USDT (BEP20 / TRC20) or Binance Pay', buy_now: 'Buy now', add_cart: 'Add to cart', details: 'Product details', more_in_cat: 'More in this category', home: 'Home',
      d_year: '{n} year', d_month: '{n} month', d_day: '{n} days',
      // order
      order: 'Order', order_email_ask: 'Enter the email you used for this order, or <a href="/account">log in</a>.', see_order: 'View order',
      st_pay: 'Payment', st_verify: 'Verify', st_proc: 'Processing', st_done: 'Delivered', pay_now: 'Pay now', coupon_off: '−{x} coupon',
      upi_apps: 'GPay, PhonePe, Paytm, BharatPe — any UPI app', open_upi: 'Open UPI app (on phone)', scan_qr: 'Scan the QR and enter exactly <strong>{x}</strong>.',
      or_upi_id: 'Or send {x} to this UPI ID', copy: 'Copy', utr_label: 'After paying, enter the UTR / Transaction ID', utr_ph: '12 digits, e.g. 412345678901',
      utr_hint: 'Find it as "UPI Ref No." or "UTR" in your payment app history.', i_paid: 'I have paid', submitting: 'Submitting…', pay_off: 'Payment is off right now. Contact us on WhatsApp.',
      crypto_tab: 'Crypto · USDT', approx_amt: 'About', exact_note: 'On the pay page you get your <b>exact amount</b> (like {x}3) — send exactly that, it identifies your payment.',
      pay_crypto: 'Pay with crypto →', reopen_pay: 'Open payment page again →', check_paid: 'I have paid — check status', crypto_help: 'Enter the Binance Pay <b>Order ID</b> or your wallet <b>TxID</b> on the pay page and the order is marked paid instantly.',
      opening_pay: 'Opening secure payment page…', paid_toast: 'Payment received ✓', not_yet: 'Payment not confirmed yet. Did you enter the ID on the pay page?',
      intl_note: 'You are paying in USD. UPI is only for India.', verifying_t: 'Payment is being verified', verifying_p: 'UTR {u} received. Checking with the bank — this page updates by itself.',
      login_to_see: 'Log in to see the delivery', locked_p: 'This order belongs to an account. For security, logins and keys are shown only after logging in to that account.',
      paid_t: 'Payment confirmed ✓', paid_p: 'Your order is being prepared. Delivery will appear here and you will get an email. Keep this page open or check your dashboard later.',
      deliv_t: 'Your order is delivered 🎉', deliv_p: 'Your login details are below. Do not share them, and change the password after first login where possible.',
      days_left: '{d} days left • until {date}', expired: 'Expired', cancelled_t: 'Order cancelled', cancelled_p: 'If you had paid, message us on WhatsApp with your order ID.',
      thanks: 'Thank you, {n}!', your_order: 'Your order', summary: 'Order summary', need_help: 'Need help?', wa_chat: 'Chat on WhatsApp', or_email: 'Or email:', all_orders: 'All orders in one place:',
      wa_msg: 'Hello, my order is {c}. I need help.', delivery_details: 'Delivery details', crypto_paid: 'Crypto payment',
      // track
      track_title: 'Track your order', track_p: 'Enter the order ID and the email you used. With an account you see all orders in your <a href="/account">dashboard</a>.',
      order_id: 'Order ID', this_device: 'Orders on this device', bad_code: 'Order ID starts with GIS-, e.g. GIS-AB12CD3.', bad_email: 'Enter a valid email.',
      // newsletter
      nl_title: 'Get {p}% off your first order', nl_p: 'Subscribe for new launches and offers. Your personal code comes instantly.', nl_ph: 'your@email.com', nl_btn: 'Get my {p}% code',
      nl_no: 'No thanks', nl_done: 'Your code', nl_done_p: '{p}% off on your first order, only for {e}. We also emailed it to you.', nl_done_p2: '{p}% off on your first order, only for {e}.',
      nl_apply: 'Use it in my cart', nl_saved: 'Code saved — it applies automatically in your cart.', chat_title: 'Get It Sasta Support', chat_sub_bot: 'Assistant · instant answers', chat_sub_human: 'Connected to our team', chat_ph: 'Type your question…', chat_hello: 'Hi! 👋 Ask me anything about products, prices, delivery or payment. Need a person? Tap “Talk to a person”.',
      chat_c1: 'Delivery time', chat_q1: 'How long does delivery take?', chat_c2: 'Payment methods', chat_q2: 'How can I pay?', chat_c3: 'Refund & warranty', chat_q3: 'What about refund and warranty?', chat_c4: 'Track my order', chat_q4: 'Track my order',
      chat_human: 'Talk to a person', chat_foot_human: 'Our team replies right here — usually within minutes.', chat_team: 'Team', chat_form_t: 'Talk to our team', chat_form_p: 'We reply right here in this chat. Add your email so we can reach you if you leave.', chat_email_opt: 'Email (optional)', chat_connect: 'Connect', chat_cancel: 'Cancel',
      hero_eyebrow: 'Up to 25% below official prices · Same-day delivery', how_btn: 'How it works', why_kicker: 'Why Get It Sasta', why_title: 'Premium tools, without the premium price',
      w1_t: 'Real savings', w1_p: 'Every plan is priced below the official rate — you see exactly how much you save.', w2_t: 'Same-day delivery', w2_p: 'Details land on your private order page as soon as payment is verified.',
      w3_t: 'Warranty included', w3_p: 'If something stops working during your plan, we replace it or refund the rest.', w4_t: 'Pay your way', w4_p: 'UPI in India, or USDT / Binance Pay from anywhere in the world.',
      how_kicker: '3 simple steps', faq_title: 'Questions, answered', faq_p: 'Still stuck? Message us on WhatsApp — a real person replies.', cta_title: 'Start saving on your favourite tools', cta_p: 'Pick a plan, pay in a minute, get it the same day.', save_x: 'Save {x}',
      co_secure: 'Secure checkout', co_continue: 'Continue shopping', co_step_cart: 'Cart', co_step_details: 'Details', co_step_pay: 'Payment', co_step_done: 'Delivery',
      co_contact: 'Contact details', co_contact_p: 'Your order and delivery details are sent here.', co_have_acct: 'Have an account?', co_login: 'Log in', co_signed: 'Signed in as', co_not_you: 'Not you?', co_logout: 'Log out',
      co_method: 'Payment method', co_method_p: 'You pay on the next screen — nothing is charged yet.', co_upi: 'UPI', co_upi_sub: 'GPay, PhonePe, Paytm, BHIM or any UPI app', co_crypto: 'Crypto (USDT)', co_crypto_sub: 'Binance Pay, BEP20 or TRC20',
      co_upi_inr: 'UPI works with Indian Rupees only.', co_switch_inr: 'Switch to ₹ INR', co_no_method: 'Online payment is not available right now. Please contact support.',
      co_summary: 'Order summary', co_edit: 'Edit', co_show: 'Show order summary', co_hide: 'Hide order summary', co_you_save: 'You save {x}', co_items: '{n} item(s)',
      co_terms: 'By placing your order you agree to our <a href="/policies#terms">Terms</a> and <a href="/policies#refund">Refund policy</a>.',
      co_t1: 'Secure payment', co_t1p: 'Verified UPI & crypto', co_t2: 'Fast delivery', co_t2p: 'Same day, on your order page', co_t3: 'Warranty', co_t3p: 'Free replacement for the full plan',
      co_empty: 'Your cart is empty', co_empty_p: 'Add a product to start your order.', co_pay_btn: 'Place order', co_wa: 'For delivery updates on WhatsApp', co_total_due: 'Total due', uf_pay: 'Pay {x} with any UPI app', co_name_err: 'Please enter your name.', co_phone_err: 'Please enter a valid mobile number.',
      net_err: 'Check your internet connection and try again.', copied: 'Copied', copy_fail: 'Could not copy — please select it manually.', gen_err: 'Something went wrong. Please try again.', ref_welcome: 'Your friend sent you {p}% off your first order — already applied in your cart 🎁', nl_already: 'You are already subscribed.', nl_existing: 'You are subscribed ✓ — the welcome code is only for first orders.', nl_small: 'No spam. Unsubscribe any time.',
      // picker
      region: 'Region', country: 'Country', currency: 'Currency', language: 'Language', save: 'Save', close: 'Close',
      unsub_ok: 'You are unsubscribed. You will not get newsletter emails any more.', unsub_bad: 'This link is not valid any more.', back_home: 'Back to store',
    },
    hinglish: {
      nav_products: 'Products', nav_track: 'Order track', login: 'Login', my_account: 'Mera account', cart: 'Cart', open_cart: 'Cart kholo',
      hero_lead: 'AI, video editing, design aur entertainment ke subscriptions ek jagah. UPI ya crypto se pay karo, delivery usi din, seedha aapke order page par.',
      hero_lead_intl: 'AI, video editing, design aur entertainment ke subscriptions ek jagah. USD mein crypto (USDT / Binance Pay) se pay karo, delivery usi din.',
      see_products: 'Products dekho', my_dashboard: 'Mera dashboard', trust_pay: 'UPI aur crypto', trust_pay_intl: 'USD · crypto payment', trust_fast: 'Same-day delivery', trust_support: 'Replacement support',
      shop_title: 'Sab kuch, sasta', loading_products: 'Products load ho rahe hain…', n_products: '{n} products • {c} categories', all: 'Sab',
      search_ph: 'Search karo… jaise CapCut', no_match: '"{q}" se koi product nahi mila. Dusra naam try karo.', load_fail: 'Products load nahi hue.', retry: 'Dobara try karo',
      add: 'Add', added: 'Added', oos: 'Out of stock', instant: 'Instant', from: 'se',
      how_title: 'Order kaise hota hai', s1_t: 'Cart mein daalo', s1_p: 'Product aur plan chuno, naam, email aur mobile daal ke order banao.',
      s2_t: 'Pay karo', s2_p: 'Order page par UPI (India) ya crypto — USDT / Binance Pay (duniya bhar se) se pay karo.', s3_t: 'Delivery lo', s3_p: 'Payment verify hote hi details aapke order page par aa jayengi. Link save rakhna.',
      faq1_q: 'Delivery mein kitna time lagta hai?', faq1_a: 'Zyadatar orders payment ke 15 minute se 6 ghante ke andar deliver ho jaate hain (subah 9 se raat 11 baje tak).',
      faq2_q: 'UTR / TxID kahaan milega?', faq2_a: 'UPI: GPay / PhonePe / Paytm mein payment kholo — 12 digit ka "UPI Ref No". Crypto: wallet mein transaction hash, ya Binance Pay ka Order ID.',
      faq3_q: 'Kuch kaam na kare to?', faq3_a: 'Order page se WhatsApp par order ID ke saath message karo. Warranty mein replacement ya refund milega.',
      foot_refund: 'Refund policy', foot_terms: 'Terms', foot_privacy: 'Privacy',
      your_cart: 'Aapka cart', cart_empty: 'Cart khaali hai.<br>Koi product chuno aur "Add" dabao.', subtotal: 'Subtotal', mrp_save: 'MRP se bachat', coupon: 'Coupon', total: 'Total',
      coupon_ph: 'Coupon code', apply: 'Lagao', remove: 'Hatao', checkout_btn: 'Checkout karo →', dec: 'Kam karo', inc: 'Badhao', checkout: 'Checkout',
      saved_to_dash: 'Order aapke dashboard mein save hoga.', name: 'Naam', email: 'Email', email_hint: 'Order details aur updates isi email par.', mobile: 'Mobile (WhatsApp)',
      mobile_hint_intl: 'Country code ke saath, jaise +971 50 123 4567', acct_hint: 'Account banane se saare orders, expiry aur renew ek jagah milte hain.', login_or_signup: 'Login / Account banao',
      back_cart: '← Cart par wapas', place_order: 'Order karo', placing: 'Order ban raha hai…', next_pay: 'Agle page par UPI ya crypto se pay karo', next_pay_intl: 'Agle page par USD mein crypto (USDT / Binance Pay) se pay karo',
      only_left: 'Sirf {n} piece bache hain', oos_toast: 'Ye plan abhi out of stock hai', charged_usd: 'Payment USD (USDT) mein: {usd}', approx: '≈',
      not_found: 'Product nahi mila', not_found_p: 'Ye product ab available nahi hai.', see_more: 'Baaki products dekho', pick_plan: 'Plan chuno', instant_delivery: 'Instant delivery', same_day: 'Same-day delivery',
      fact_instant: 'Payment hote hi turant delivery, order page par', fact_sameday: 'Payment verify hone ke baad same-day delivery', validity: 'Validity: {d} (dashboard mein expiry date dikhegi)',
      fact_pay: 'Payment: UPI (India) ya crypto — USDT, Binance Pay', fact_pay_intl: 'Payment: USD mein crypto — USDT (BEP20 / TRC20) ya Binance Pay', buy_now: 'Abhi kharido', add_cart: 'Cart mein daalo', details: 'Product details', more_in_cat: 'Isi category mein aur', home: 'Home',
      d_year: '{n} saal', d_month: '{n} mahina', d_day: '{n} din',
      order: 'Order', order_email_ask: 'Ye order dekhne ke liye woh email daalo jo order karte waqt diya tha, ya <a href="/account">login karo</a>.', see_order: 'Order dekho',
      st_pay: 'Payment', st_verify: 'Verify', st_proc: 'Processing', st_done: 'Delivered', pay_now: 'Pay karo', coupon_off: '−{x} coupon',
      upi_apps: 'GPay, PhonePe, Paytm, BharatPe — koi bhi UPI app', open_upi: 'UPI app kholo (phone par)', scan_qr: 'QR scan karke exact <strong>{x}</strong> daalo.',
      or_upi_id: 'Ya is UPI ID par {x} bhejo', copy: 'Copy', utr_label: 'Pay karne ke baad UTR / Transaction ID daalo', utr_ph: '12 digit, jaise 412345678901',
      utr_hint: 'Payment app ki history mein "UPI Ref No." ya "UTR" ke naam se milega.', i_paid: 'Maine pay kar diya', submitting: 'Submit ho raha hai…', pay_off: 'Payment abhi band hai. WhatsApp par contact karo.',
      crypto_tab: 'Crypto · USDT', approx_amt: 'Lagbhag', exact_note: 'Pay page par aapka <b>exact amount</b> (jaise {x}3) milega — bilkul wahi bhejna, usi se payment pehchana jaata hai.',
      pay_crypto: 'Crypto se pay karo →', reopen_pay: 'Payment page dobara kholo →', check_paid: 'Maine pay kar diya — status check karo', crypto_help: 'Binance Pay ka <b>Order ID</b> ya wallet ka <b>TxID</b> pay page par daaloge, wahi check hoke order turant Paid ho jayega.',
      opening_pay: 'Secure payment page khul raha hai…', paid_toast: 'Payment mil gaya ✓', not_yet: 'Abhi payment confirm nahi hua. Pay page par ID daali hai?',
      intl_note: 'Aap USD mein pay kar rahe ho. UPI sirf India ke liye hai.', verifying_t: 'Payment verify ho raha hai', verifying_p: 'UTR {u} mil gaya. Bank mein check ho raha hai, ye page apne aap update hoga.',
      login_to_see: 'Login karke delivery dekho', locked_p: 'Ye order kisi account se juda hai. Security ke liye login email / password aur keys sirf us account mein login karke dikhte hain.',
      paid_t: 'Payment confirm ✓', paid_p: 'Order taiyaar ho raha hai. Delivery yahin aayegi aur email par khabar milegi. Page khula rakho ya baad mein dashboard se dekho.',
      deliv_t: 'Order deliver ho gaya 🎉', deliv_p: 'Neeche aapki login details hain. Inhe kisi ke saath share mat karna, aur pehli baar login ke baad jahan ho sake password badal lo.',
      days_left: '{d} din bache • {date} tak', expired: 'Expire ho gaya', cancelled_t: 'Order cancel ho gaya', cancelled_p: 'Agar aapne payment kiya tha to WhatsApp par order ID ke saath message karo.',
      thanks: 'Shukriya, {n}!', your_order: 'Aapka order', summary: 'Order summary', need_help: 'Help chahiye?', wa_chat: 'WhatsApp par baat karo', or_email: 'Ya email karo:', all_orders: 'Saare orders ek jagah:',
      wa_msg: 'Namaste, mera order {c} hai. Mujhe help chahiye.', delivery_details: 'Delivery details', crypto_paid: 'Crypto payment',
      track_title: 'Order track karo', track_p: 'Order ID aur woh email daalo jo order karte waqt diya tha. Account hai to <a href="/account">dashboard</a> mein saare orders milenge.',
      order_id: 'Order ID', this_device: 'Is device ke orders', bad_code: 'Order ID GIS- se shuru hota hai, jaise GIS-AB12CD3.', bad_email: 'Sahi email daalo.',
      nl_title: 'Pehle order par {p}% off', nl_p: 'Subscribe karo — naye products aur offers ki khabar. Aapka code turant milega.', nl_ph: 'aapka@email.com', nl_btn: 'Mera {p}% code do',
      nl_no: 'Nahi chahiye', nl_done: 'Aapka code', nl_done_p: 'Pehle order par {p}% off, sirf {e} ke liye. Email par bhi bhej diya.', nl_done_p2: 'Pehle order par {p}% off, sirf {e} ke liye.',
      nl_apply: 'Cart mein lagao', nl_saved: 'Code save ho gaya — cart mein apne aap lagega.', chat_title: 'Get It Sasta Support', chat_sub_bot: 'Assistant · turant jawab', chat_sub_human: 'Team se jude hue ho', chat_ph: 'Apna sawaal likho…', chat_hello: 'Namaste! 👋 Products, price, delivery ya payment — kuch bhi poochho. Insaan se baat karni hai? “Insaan se baat karo” dabao.',
      chat_c1: 'Delivery kab?', chat_q1: 'Delivery kab tak milegi?', chat_c2: 'Payment kaise?', chat_q2: 'Pay kaise karu?', chat_c3: 'Refund / warranty', chat_q3: 'Refund aur warranty?', chat_c4: 'Order track', chat_q4: 'Mera order track karo',
      chat_human: 'Insaan se baat karo', chat_foot_human: 'Team yahin jawab degi — aam taur par kuch minute mein.', chat_team: 'Team', chat_form_t: 'Team se baat karo', chat_form_p: 'Hum isi chat mein jawab denge. Email daal do taaki chale jao to bhi contact kar sakein.', chat_email_opt: 'Email (zaroori nahi)', chat_connect: 'Jodo', chat_cancel: 'Rehne do',
      hero_eyebrow: 'Official price se 25% tak sasta · Usi din delivery', how_btn: 'Kaise kaam karta hai', why_kicker: 'Get It Sasta kyun', why_title: 'Premium tools, bina premium price ke',
      w1_t: 'Asli bachat', w1_p: 'Har plan official rate se sasta — kitna bacha, saaf dikhta hai.', w2_t: 'Usi din delivery', w2_p: 'Payment verify hote hi details aapke private order page par.',
      w3_t: 'Warranty saath mein', w3_p: 'Plan ke beech kuch band ho to replacement ya bacha hua refund.', w4_t: 'Jaise chaho pay karo', w4_p: 'India mein UPI, ya duniya mein kahin se USDT / Binance Pay.',
      how_kicker: '3 aasaan steps', faq_title: 'Aapke sawaal', faq_p: 'Phir bhi dikkat? WhatsApp karo — asli insaan jawab deta hai.', cta_title: 'Apne favourite tools par aaj se bachat', cta_p: 'Plan chuno, ek minute mein pay karo, usi din pao.', save_x: '{x} bachao',
      co_secure: 'Secure checkout', co_continue: 'Shopping jaari rakho', co_step_cart: 'Cart', co_step_details: 'Details', co_step_pay: 'Payment', co_step_done: 'Delivery',
      co_contact: 'Contact details', co_contact_p: 'Order aur delivery details yahin aayengi.', co_have_acct: 'Account hai?', co_login: 'Login karo', co_signed: 'Logged in:', co_not_you: 'Aap nahi?', co_logout: 'Logout',
      co_method: 'Payment method', co_method_p: 'Payment agli screen par — abhi kuch nahi katega.', co_upi: 'UPI', co_upi_sub: 'GPay, PhonePe, Paytm, BHIM ya koi bhi UPI app', co_crypto: 'Crypto (USDT)', co_crypto_sub: 'Binance Pay, BEP20 ya TRC20',
      co_upi_inr: 'UPI sirf Indian Rupee mein chalta hai.', co_switch_inr: '₹ INR par jao', co_no_method: 'Online payment abhi band hai. Support se baat karo.',
      co_summary: 'Order summary', co_edit: 'Badlo', co_show: 'Order summary dekho', co_hide: 'Order summary chhupao', co_you_save: 'Aapki bachat {x}', co_items: '{n} item',
      co_terms: 'Order karke aap hamari <a href="/policies#terms">Terms</a> aur <a href="/policies#refund">Refund policy</a> maante ho.',
      co_t1: 'Secure payment', co_t1p: 'Verified UPI aur crypto', co_t2: 'Fast delivery', co_t2p: 'Usi din, order page par', co_t3: 'Warranty', co_t3p: 'Poore plan tak free replacement',
      co_empty: 'Cart khaali hai', co_empty_p: 'Order shuru karne ke liye product add karo.', co_pay_btn: 'Order place karo', co_wa: 'WhatsApp par delivery updates ke liye', co_total_due: 'Kul rakam', uf_pay: 'Kisi bhi UPI app se {x} pay karo', co_name_err: 'Apna naam daalo.', co_phone_err: 'Sahi mobile number daalo.',
      net_err: 'Internet connection check karo aur dobara try karo.', copied: 'Copy ho gaya', copy_fail: 'Copy nahi hua, haath se select karo', gen_err: 'Kuch gadbad hui. Dobara try karo.', ref_welcome: 'Dost ne aapko pehle order par {p}% off bheja hai — cart mein lag gaya 🎁', nl_already: 'Aap pehle se subscribed ho.', nl_existing: 'Subscribe ho gaya ✓ — welcome code sirf pehle order ke liye hai.', nl_small: 'Spam nahi. Kabhi bhi unsubscribe kar sakte ho.',
      region: 'Region', country: 'Desh', currency: 'Currency', language: 'Bhasha', save: 'Save', close: 'Band karo',
      unsub_ok: 'Aap unsubscribe ho gaye. Ab newsletter emails nahi aayenge.', unsub_bad: 'Ye link ab valid nahi hai.', back_home: 'Store par wapas',
    },
    hi: {
      nav_products: 'प्रोडक्ट्स', nav_track: 'ऑर्डर ट्रैक', login: 'लॉगिन', my_account: 'मेरा अकाउंट', cart: 'कार्ट', open_cart: 'कार्ट खोलें',
      hero_lead: 'AI, वीडियो एडिटिंग, डिज़ाइन और एंटरटेनमेंट के सब्सक्रिप्शन एक जगह। UPI या क्रिप्टो से पेमेंट करें, उसी दिन डिलीवरी, सीधे आपके ऑर्डर पेज पर।',
      hero_lead_intl: 'AI, वीडियो एडिटिंग, डिज़ाइन और एंटरटेनमेंट के सब्सक्रिप्शन एक जगह। USD में क्रिप्टो (USDT / Binance Pay) से पेमेंट करें, उसी दिन डिलीवरी।',
      see_products: 'प्रोडक्ट्स देखें', my_dashboard: 'मेरा डैशबोर्ड', trust_pay: 'UPI और क्रिप्टो', trust_pay_intl: 'USD · क्रिप्टो पेमेंट', trust_fast: 'उसी दिन डिलीवरी', trust_support: 'रिप्लेसमेंट सपोर्ट',
      shop_title: 'सब कुछ, सस्ता', loading_products: 'प्रोडक्ट्स लोड हो रहे हैं…', n_products: '{n} प्रोडक्ट्स • {c} कैटेगरी', all: 'सभी',
      search_ph: 'खोजें… जैसे CapCut', no_match: '"{q}" से कोई प्रोडक्ट नहीं मिला। दूसरा नाम आज़माएँ।', load_fail: 'प्रोडक्ट्स लोड नहीं हुए।', retry: 'फिर से कोशिश करें',
      add: 'जोड़ें', added: 'जुड़ गया', oos: 'स्टॉक में नहीं', instant: 'तुरंत', from: 'से',
      how_title: 'ऑर्डर कैसे होता है', s1_t: 'कार्ट में डालें', s1_p: 'प्रोडक्ट और प्लान चुनें, नाम, ईमेल और मोबाइल डालकर ऑर्डर बनाएँ।',
      s2_t: 'पेमेंट करें', s2_p: 'ऑर्डर पेज पर UPI (भारत) या क्रिप्टो — USDT / Binance Pay (दुनिया भर से) से पेमेंट करें।', s3_t: 'डिलीवरी लें', s3_p: 'पेमेंट वेरिफ़ाई होते ही डिटेल्स आपके ऑर्डर पेज पर आ जाएँगी। लिंक सेव रखें।',
      faq1_q: 'डिलीवरी में कितना समय लगता है?', faq1_a: 'ज़्यादातर ऑर्डर पेमेंट के 15 मिनट से 6 घंटे में डिलीवर हो जाते हैं (सुबह 9 से रात 11 बजे तक)।',
      faq2_q: 'UTR / TxID कहाँ मिलेगा?', faq2_a: 'UPI: GPay / PhonePe / Paytm में पेमेंट खोलें — 12 अंकों का "UPI Ref No"। क्रिप्टो: वॉलेट में ट्रांज़ैक्शन हैश, या Binance Pay का Order ID।',
      faq3_q: 'कुछ काम न करे तो?', faq3_a: 'ऑर्डर पेज से ऑर्डर ID के साथ WhatsApp करें। वारंटी में रिप्लेसमेंट या रिफ़ंड मिलेगा।',
      foot_refund: 'रिफ़ंड पॉलिसी', foot_terms: 'शर्तें', foot_privacy: 'प्राइवेसी',
      your_cart: 'आपका कार्ट', cart_empty: 'कार्ट खाली है।<br>कोई प्रोडक्ट चुनें और "जोड़ें" दबाएँ।', subtotal: 'सबटोटल', mrp_save: 'MRP से बचत', coupon: 'कूपन', total: 'कुल',
      coupon_ph: 'कूपन कोड', apply: 'लगाएँ', remove: 'हटाएँ', checkout_btn: 'चेकआउट करें →', dec: 'कम करें', inc: 'बढ़ाएँ', checkout: 'चेकआउट',
      saved_to_dash: 'ऑर्डर आपके डैशबोर्ड में सेव होगा।', name: 'नाम', email: 'ईमेल', email_hint: 'ऑर्डर डिटेल्स और अपडेट इसी ईमेल पर।', mobile: 'मोबाइल (WhatsApp)',
      mobile_hint_intl: 'कंट्री कोड के साथ, जैसे +971 50 123 4567', acct_hint: 'अकाउंट बनाने से सारे ऑर्डर, एक्सपायरी और रिन्यू एक जगह मिलते हैं।', login_or_signup: 'लॉगिन / अकाउंट बनाएँ',
      back_cart: '← कार्ट पर वापस', place_order: 'ऑर्डर करें', placing: 'ऑर्डर बन रहा है…', next_pay: 'अगले पेज पर UPI या क्रिप्टो से पेमेंट करें', next_pay_intl: 'अगले पेज पर USD में क्रिप्टो (USDT / Binance Pay) से पेमेंट करें',
      only_left: 'सिर्फ़ {n} बचे हैं', oos_toast: 'यह प्लान अभी स्टॉक में नहीं है', charged_usd: 'पेमेंट USD (USDT) में: {usd}', approx: '≈',
      not_found: 'प्रोडक्ट नहीं मिला', not_found_p: 'यह प्रोडक्ट अब उपलब्ध नहीं है।', see_more: 'दूसरे प्रोडक्ट्स देखें', pick_plan: 'प्लान चुनें', instant_delivery: 'तुरंत डिलीवरी', same_day: 'उसी दिन डिलीवरी',
      fact_instant: 'पेमेंट होते ही तुरंत डिलीवरी, ऑर्डर पेज पर', fact_sameday: 'पेमेंट वेरिफ़ाई होने के बाद उसी दिन डिलीवरी', validity: 'वैलिडिटी: {d} (डैशबोर्ड में एक्सपायरी तारीख दिखेगी)',
      fact_pay: 'पेमेंट: UPI (भारत) या क्रिप्टो — USDT, Binance Pay', fact_pay_intl: 'पेमेंट: USD में क्रिप्टो — USDT (BEP20 / TRC20) या Binance Pay', buy_now: 'अभी ख़रीदें', add_cart: 'कार्ट में डालें', details: 'प्रोडक्ट डिटेल्स', more_in_cat: 'इसी कैटेगरी में और', home: 'होम',
      d_year: '{n} साल', d_month: '{n} महीना', d_day: '{n} दिन',
      order: 'ऑर्डर', order_email_ask: 'यह ऑर्डर देखने के लिए वही ईमेल डालें जो ऑर्डर करते समय दिया था, या <a href="/account">लॉगिन करें</a>।', see_order: 'ऑर्डर देखें',
      st_pay: 'पेमेंट', st_verify: 'वेरिफ़ाई', st_proc: 'प्रोसेसिंग', st_done: 'डिलीवर', pay_now: 'पेमेंट करें', coupon_off: '−{x} कूपन',
      upi_apps: 'GPay, PhonePe, Paytm, BharatPe — कोई भी UPI ऐप', open_upi: 'UPI ऐप खोलें (फ़ोन पर)', scan_qr: 'QR स्कैन करके ठीक <strong>{x}</strong> डालें।',
      or_upi_id: 'या इस UPI ID पर {x} भेजें', copy: 'कॉपी', utr_label: 'पेमेंट के बाद UTR / ट्रांज़ैक्शन ID डालें', utr_ph: '12 अंक, जैसे 412345678901',
      utr_hint: 'पेमेंट ऐप की हिस्ट्री में "UPI Ref No." या "UTR" नाम से मिलेगा।', i_paid: 'मैंने पेमेंट कर दिया', submitting: 'सबमिट हो रहा है…', pay_off: 'पेमेंट अभी बंद है। WhatsApp पर संपर्क करें।',
      crypto_tab: 'क्रिप्टो · USDT', approx_amt: 'लगभग', exact_note: 'पे पेज पर आपका <b>सटीक अमाउंट</b> (जैसे {x}3) मिलेगा — ठीक वही भेजें, उसी से पेमेंट पहचाना जाता है।',
      pay_crypto: 'क्रिप्टो से पेमेंट करें →', reopen_pay: 'पेमेंट पेज फिर खोलें →', check_paid: 'मैंने पेमेंट कर दिया — स्टेटस देखें', crypto_help: 'पे पेज पर Binance Pay का <b>Order ID</b> या वॉलेट का <b>TxID</b> डालें, ऑर्डर तुरंत Paid हो जाएगा।',
      opening_pay: 'सुरक्षित पेमेंट पेज खुल रहा है…', paid_toast: 'पेमेंट मिल गया ✓', not_yet: 'पेमेंट अभी कन्फ़र्म नहीं हुआ। क्या पे पेज पर ID डाली?',
      intl_note: 'आप USD में पेमेंट कर रहे हैं। UPI सिर्फ़ भारत के लिए है।', verifying_t: 'पेमेंट वेरिफ़ाई हो रहा है', verifying_p: 'UTR {u} मिल गया। बैंक में जाँच हो रही है, यह पेज अपने आप अपडेट होगा।',
      login_to_see: 'डिलीवरी देखने के लिए लॉगिन करें', locked_p: 'यह ऑर्डर किसी अकाउंट से जुड़ा है। सुरक्षा के लिए लॉगिन डिटेल्स और कीज़ सिर्फ़ उस अकाउंट में लॉगिन करके दिखती हैं।',
      paid_t: 'पेमेंट कन्फ़र्म ✓', paid_p: 'ऑर्डर तैयार हो रहा है। डिलीवरी यहीं आएगी और ईमेल पर सूचना मिलेगी।',
      deliv_t: 'ऑर्डर डिलीवर हो गया 🎉', deliv_p: 'नीचे आपकी लॉगिन डिटेल्स हैं। इन्हें किसी से शेयर न करें, और पहली बार लॉगिन के बाद जहाँ हो सके पासवर्ड बदल लें।',
      days_left: '{d} दिन बचे • {date} तक', expired: 'एक्सपायर हो गया', cancelled_t: 'ऑर्डर कैंसल हो गया', cancelled_p: 'अगर आपने पेमेंट किया था तो ऑर्डर ID के साथ WhatsApp करें।',
      thanks: 'धन्यवाद, {n}!', your_order: 'आपका ऑर्डर', summary: 'ऑर्डर सारांश', need_help: 'मदद चाहिए?', wa_chat: 'WhatsApp पर बात करें', or_email: 'या ईमेल करें:', all_orders: 'सारे ऑर्डर एक जगह:',
      wa_msg: 'नमस्ते, मेरा ऑर्डर {c} है। मुझे मदद चाहिए।', delivery_details: 'डिलीवरी डिटेल्स', crypto_paid: 'क्रिप्टो पेमेंट',
      track_title: 'ऑर्डर ट्रैक करें', track_p: 'ऑर्डर ID और वही ईमेल डालें जो ऑर्डर करते समय दिया था। अकाउंट है तो <a href="/account">डैशबोर्ड</a> में सारे ऑर्डर मिलेंगे।',
      order_id: 'ऑर्डर ID', this_device: 'इस डिवाइस के ऑर्डर', bad_code: 'ऑर्डर ID GIS- से शुरू होती है, जैसे GIS-AB12CD3।', bad_email: 'सही ईमेल डालें।',
      nl_title: 'पहले ऑर्डर पर {p}% की छूट', nl_p: 'सब्सक्राइब करें — नए प्रोडक्ट्स और ऑफ़र की ख़बर। आपका कोड तुरंत मिलेगा।', nl_ph: 'aapka@email.com', nl_btn: 'मेरा {p}% कोड दें',
      nl_no: 'नहीं चाहिए', nl_done: 'आपका कोड', nl_done_p: 'पहले ऑर्डर पर {p}% छूट, सिर्फ़ {e} के लिए। ईमेल पर भी भेज दिया।', nl_done_p2: 'पहले ऑर्डर पर {p}% छूट, सिर्फ़ {e} के लिए।',
      nl_apply: 'कार्ट में लगाएँ', nl_saved: 'कोड सेव हो गया — कार्ट में अपने आप लगेगा।', chat_title: 'Get It Sasta सपोर्ट', chat_sub_bot: 'असिस्टेंट · तुरंत जवाब', chat_sub_human: 'टीम से जुड़े हैं', chat_ph: 'अपना सवाल लिखें…', chat_hello: 'नमस्ते! 👋 प्रोडक्ट, कीमत, डिलीवरी या पेमेंट — कुछ भी पूछें। इंसान से बात करनी है? “इंसान से बात करें” दबाएँ।',
      chat_c1: 'डिलीवरी कब?', chat_q1: 'डिलीवरी कब तक मिलेगी?', chat_c2: 'पेमेंट कैसे?', chat_q2: 'पेमेंट कैसे करें?', chat_c3: 'रिफ़ंड / वारंटी', chat_q3: 'रिफ़ंड और वारंटी?', chat_c4: 'ऑर्डर ट्रैक', chat_q4: 'मेरा ऑर्डर ट्रैक करें',
      chat_human: 'इंसान से बात करें', chat_foot_human: 'टीम यहीं जवाब देगी — आमतौर पर कुछ मिनट में।', chat_team: 'टीम', chat_form_t: 'टीम से बात करें', chat_form_p: 'हम इसी चैट में जवाब देंगे। ईमेल डालें ताकि बाद में भी संपर्क कर सकें।', chat_email_opt: 'ईमेल (ज़रूरी नहीं)', chat_connect: 'जोड़ें', chat_cancel: 'रहने दें',
      hero_eyebrow: 'ऑफ़िशियल कीमत से 25% तक सस्ता · उसी दिन डिलीवरी', how_btn: 'कैसे काम करता है', why_kicker: 'Get It Sasta क्यों', why_title: 'प्रीमियम टूल्स, बिना प्रीमियम कीमत के',
      w1_t: 'असली बचत', w1_p: 'हर प्लान ऑफ़िशियल रेट से सस्ता — कितना बचा, साफ़ दिखता है।', w2_t: 'उसी दिन डिलीवरी', w2_p: 'पेमेंट वेरिफ़ाई होते ही डिटेल्स आपके निजी ऑर्डर पेज पर।',
      w3_t: 'वारंटी शामिल', w3_p: 'प्लान के दौरान कुछ बंद हो तो रिप्लेसमेंट या बचा हुआ रिफ़ंड।', w4_t: 'अपने तरीके से पे करें', w4_p: 'भारत में UPI, या दुनिया में कहीं से USDT / Binance Pay।',
      how_kicker: '3 आसान स्टेप', faq_title: 'आपके सवाल', faq_p: 'फिर भी दिक़्क़त? WhatsApp करें — असली इंसान जवाब देता है।', cta_title: 'अपने पसंदीदा टूल्स पर आज से बचत', cta_p: 'प्लान चुनें, एक मिनट में पे करें, उसी दिन पाएँ।', save_x: '{x} बचाएँ',
      co_secure: 'सुरक्षित चेकआउट', co_continue: 'शॉपिंग जारी रखें', co_step_cart: 'कार्ट', co_step_details: 'विवरण', co_step_pay: 'पेमेंट', co_step_done: 'डिलीवरी',
      co_contact: 'संपर्क विवरण', co_contact_p: 'ऑर्डर और डिलीवरी की जानकारी यहीं भेजी जाएगी।', co_have_acct: 'अकाउंट है?', co_login: 'लॉगिन करें', co_signed: 'लॉगिन:', co_not_you: 'आप नहीं?', co_logout: 'लॉगआउट',
      co_method: 'पेमेंट का तरीका', co_method_p: 'पेमेंट अगली स्क्रीन पर — अभी कुछ नहीं कटेगा।', co_upi: 'UPI', co_upi_sub: 'GPay, PhonePe, Paytm, BHIM या कोई भी UPI ऐप', co_crypto: 'क्रिप्टो (USDT)', co_crypto_sub: 'Binance Pay, BEP20 या TRC20',
      co_upi_inr: 'UPI सिर्फ़ भारतीय रुपये में चलता है।', co_switch_inr: '₹ INR चुनें', co_no_method: 'ऑनलाइन पेमेंट अभी बंद है। सपोर्ट से संपर्क करें।',
      co_summary: 'ऑर्डर सारांश', co_edit: 'बदलें', co_show: 'ऑर्डर सारांश देखें', co_hide: 'ऑर्डर सारांश छिपाएँ', co_you_save: 'आपकी बचत {x}', co_items: '{n} आइटम',
      co_terms: 'ऑर्डर करके आप हमारी <a href="/policies#terms">शर्तें</a> और <a href="/policies#refund">रिफ़ंड नीति</a> मानते हैं।',
      co_t1: 'सुरक्षित पेमेंट', co_t1p: 'वेरिफ़ाइड UPI और क्रिप्टो', co_t2: 'तेज़ डिलीवरी', co_t2p: 'उसी दिन, ऑर्डर पेज पर', co_t3: 'वारंटी', co_t3p: 'पूरे प्लान तक मुफ़्त रिप्लेसमेंट',
      co_empty: 'कार्ट ख़ाली है', co_empty_p: 'ऑर्डर शुरू करने के लिए प्रोडक्ट जोड़ें।', co_pay_btn: 'ऑर्डर करें', co_wa: 'WhatsApp पर डिलीवरी अपडेट के लिए', co_total_due: 'कुल राशि', uf_pay: 'किसी भी UPI ऐप से {x} पे करें', co_name_err: 'अपना नाम डालें।', co_phone_err: 'सही मोबाइल नंबर डालें।',
      net_err: 'इंटरनेट कनेक्शन जाँचें और फिर कोशिश करें।', copied: 'कॉपी हो गया', copy_fail: 'कॉपी नहीं हुआ, हाथ से चुनें', gen_err: 'कुछ गड़बड़ हुई। फिर कोशिश करें।', ref_welcome: 'दोस्त ने आपको पहले ऑर्डर पर {p}% छूट भेजी है — कार्ट में लग गई 🎁', nl_already: 'आप पहले से सब्सक्राइब हैं।', nl_existing: 'सब्सक्राइब हो गया ✓ — वेलकम कोड सिर्फ़ पहले ऑर्डर के लिए है।', nl_small: 'स्पैम नहीं। कभी भी अनसब्सक्राइब करें।',
      region: 'क्षेत्र', country: 'देश', currency: 'करेंसी', language: 'भाषा', save: 'सेव', close: 'बंद करें',
      unsub_ok: 'आप अनसब्सक्राइब हो गए। अब न्यूज़लेटर ईमेल नहीं आएँगे।', unsub_bad: 'यह लिंक अब मान्य नहीं है।', back_home: 'स्टोर पर वापस',
    },
  };
  const LANGS = [['en', 'English'], ['hinglish', 'Hinglish'], ['hi', 'हिंदी']];
  const lang = () => st.lang || 'en';
  function t(key, vars) {
    let s = (D[lang()] && D[lang()][key]) ?? D.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
  }

  // ---------- Money ----------
  const cur = () => currencies.find(c => c.code === st.currency) || currencies.find(c => c.code === 'USD');
  const intl = () => cur().code !== 'INR';
  function fmt(amount, c = cur()) {
    try { return new Intl.NumberFormat(lang() === 'en' ? 'en-US' : 'en-IN', { style: 'currency', currency: c.code, minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals }).format(amount); }
    catch { return `${c.symbol} ${Number(amount).toFixed(c.decimals)}`; }
  }
  // inr: ₹ amount, usd: USD amount (plan.usd)
  function money(inr, usd) {
    const c = cur();
    if (c.code === 'INR') return GIS.inr(inr);
    if (c.code === 'USD') return fmt(usd, c);
    return fmt(usd * c.rate, c);
  }
  const usdText = usd => fmt(usd, currencies.find(c => c.code === 'USD') || { code: 'USD', symbol: '$', decimals: 2 });

  // ---------- Static text ----------
  function apply(root = document) {
    document.documentElement.lang = lang() === 'en' ? 'en' : 'hi';
    $$('[data-i18n]', root).forEach(el => { el.innerHTML = t(el.dataset.i18n); });
    $$('[data-i18n-ph]', root).forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    $$('[data-i18n-aria]', root).forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $$('[data-i18n-intl]', root).forEach(el => { el.innerHTML = t(intl() ? el.dataset.i18nIntl : el.dataset.i18nIn); });
    const btn = $('#locBtn'); if (btn) btn.innerHTML = `<span aria-hidden="true">${countryOf(st.country)[3]}</span><span class="loc-cur">${esc(cur().code)}</span><span class="loc-lang">${({ en: 'EN', hi: 'हिं', hinglish: 'Hing' })[lang()] || 'EN'}</span>`; if (btn) btn.setAttribute('aria-label', 'Country, currency, language');
  }

  // ---------- Picker ----------
  function mountPicker() {
    const bar = $('.bar-actions'); if (!bar || $('#locBtn')) return;
    bar.insertAdjacentHTML('afterbegin', `<button class="loc-btn" id="locBtn" type="button" aria-haspopup="dialog" aria-expanded="false"></button>`);
    document.body.insertAdjacentHTML('beforeend', `<div class="loc-pop" id="locPop" role="dialog" aria-modal="false" aria-labelledby="locTitle" hidden>
      <div class="loc-head"><strong id="locTitle"></strong><button class="icon-btn sm" type="button" id="locClose">${GIS.icons.x}</button></div>
      <label class="field"><span id="locL1"></span><select id="locCountry"></select></label>
      <label class="field"><span id="locL2"></span><select id="locCur"></select></label>
      <label class="field"><span id="locL3"></span><select id="locLang"></select></label>
      <button class="btn btn-primary btn-block" type="button" id="locSave"></button></div>`);
    const fill = () => {
      $('#locTitle').textContent = t('region'); $('#locL1').textContent = t('country'); $('#locL2').textContent = t('currency'); $('#locL3').textContent = t('language'); $('#locSave').textContent = t('save');
      $('#locClose').setAttribute('aria-label', t('close'));
      $('#locCountry').innerHTML = COUNTRIES.map(c => `<option value="${c[0]}"${c[0] === st.country ? ' selected' : ''}>${c[3]} ${esc(c[1])}</option>`).join('');
      $('#locCur').innerHTML = currencies.map(c => `<option value="${c.code}"${c.code === st.currency ? ' selected' : ''}>${esc(c.code)} — ${esc(c.symbol)}</option>`).join('');
      $('#locLang').innerHTML = LANGS.map(([k, n]) => `<option value="${k}"${k === lang() ? ' selected' : ''}>${n}</option>`).join('');
    };
    const pop = $('#locPop'), btn = $('#locBtn');
    const open = v => { pop.hidden = !v; btn.setAttribute('aria-expanded', String(v)); if (v) { fill(); const r = btn.getBoundingClientRect(); pop.style.top = `${r.bottom + window.scrollY + 8}px`; const W = document.documentElement.clientWidth; pop.style.right = `${Math.max(12, Math.min(W - r.right, W - pop.offsetWidth - 12))}px`; $('#locCountry').focus(); } };
    btn.onclick = () => open(pop.hidden);
    $('#locClose').onclick = () => { open(false); btn.focus(); };
    $('#locCountry').onchange = e => { const c = countryOf(e.target.value)[2]; if (currencies.some(x => x.code === c)) $('#locCur').value = c; else $('#locCur').value = 'USD'; };
    $('#locSave').onclick = () => { set({ country: $('#locCountry').value, currency: $('#locCur').value, lang: $('#locLang').value }); open(false); btn.focus(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { open(false); btn.focus(); } });
    document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('#locPop, #locBtn')) open(false); });
  }

  function set(next) {
    Object.assign(st, next);
    store.set('gis-locale', { v: 2, country: st.country, currency: st.currency, lang: st.lang });
    apply();
    document.dispatchEvent(new CustomEvent('gis-locale'));
  }

  GIS.t = t; GIS.money = money; GIS.usdText = usdText; GIS.loc = st; GIS.isIntl = intl; GIS.setLocale = set; GIS.applyI18n = apply;
  GIS.planLen = days => !days ? '' : days % 365 === 0 ? t('d_year', { n: days / 365 }) : days % 30 === 0 ? t('d_month', { n: days / 30 }) : t('d_day', { n: days });

  mountPicker();
  apply();
  // Store se currencies + default language
  const ready = () => GIS.storeData && GIS.storeData.then(d => {
    if (d.currency?.list?.length) currencies = d.currency.list;
    if (!currencies.some(c => c.code === st.currency)) st.currency = currencies.some(c => c.code === countryOf(st.country)[2]) ? countryOf(st.country)[2] : 'USD';
    if (!st.lang) st.lang = d.default_lang || 'en';
    apply();
    document.dispatchEvent(new CustomEvent('gis-locale'));
  }).catch(() => {});
  if (GIS.storeData) ready(); else document.addEventListener('DOMContentLoaded', ready);
})();
