# Get It Sasta — getitsasta.com

Digital products store, **Hostinger Cloud Startup** ke liye tayyar.
Customer accounts (email OTP + password) + dashboard, BharatPe UPI + crypto (alag Get It Sasta Pay app: Binance Pay, USDT BEP20 / TRC20 / Polygon), login details / keys ki instant auto-delivery, coupons, emails (Resend) aur poora admin panel.
**Koi npm package nahi** — sirf Node.js 22.13+ / 24 chahiye. Database SQLite (alag DB ka kharcha nahi).

---

## Kya kya hai

**Customer**
- Store: product photos, categories, search, har product ke plans (1 month / 12 months), "Instant" badge, out-of-stock
- Product page `/p/<id>`: badi photo, poori details, plan cards, related products
- Cart: coupon code, MRP se bachat, guest ya account se checkout
- Payment: **BharatPe UPI** (QR / UPI ID + UTR, admin verify) aur **Crypto**: **Get It Sasta Pay** app se: Binance Pay (Order ID) + USDT BEP20 / TRC20 / Polygon (TxID), unique amount, har plan ka alag USDT price
- Login: **email OTP** (password ki zaroorat nahi) ya password; naya account OTP se apne aap; devices list + sab jagah se logout
- Delivery: login email / password / keys alag copy buttons ke saath, password chhupa hua; account wale order ki delivery sirf us account ke login par
- Order page: status timeline, delivery details / keys copy button, expiry date
- **Dashboard `/account`**: active subscriptions (kitne din bache + progress bar), ek-click renew, saare orders, total kharcha, kitna bachaya, pending payments, profile, password
- Login / register / password reset (email se)

**Admin `/admin/`**
- Dashboard: verify / deliver karne wale orders, aaj + mahine ki kamai, 14 din ka chart, top products, low stock alert, setup checklist
- Orders: filter, search (ID, naam, phone, UTR, crypto ref), Paid → Deliver, WhatsApp, CSV download
- Products: **apna naam, photo upload**, chhota + lamba description, badge, color, plans (price, MRP, validity din, Manual / **Auto delivery**)
- Stock: keys / links / codes paste karo → payment hote hi customer ko apne aap milte hain
- Customers, Coupons (% ya flat, minimum order, max uses, expiry)
- Settings: payment methods on/off, UPI ID + QR, connections status, webhook URL, test email, **backup download**

---

## Hostinger Cloud Startup par lagana

### 1. Node.js app banao
hPanel → **Websites** → **Add website** → **Node.js Apps** → **Upload your website files** → `getitsasta.zip` upload karo
(ya GitHub repo connect karo — har push par apne aap deploy hoga).

### 2. Build settings
| Setting | Value |
|---|---|
| Framework | Other |
| Node version | **24.x** (ya 22.x) |
| Entry file | `server.js` |
| Build command | khaali / none |
| Output directory | khaali |

### 3. Environment variables
Deploy se pehle **Environment variables** mein ye daalo (poori list `.env.example` mein hai):
```
NODE_ENV=production
PUBLIC_URL=https://getitsasta.com
ADMIN_PASSWORD=<strong password>
RESEND_API_KEY=re_xxx
MAIL_FROM=Get It Sasta <noreply@getitsasta.com>
ADMIN_EMAIL=<aapka email, admin OTP ke liye>
```
Phir **Deploy**. Domain `getitsasta.com` us app se connect karo; Hostinger SSL khud lagata hai.

### 4. Crypto: Get It Sasta Pay (alag app)
Crypto payment ek **alag app** se hota hai — `getitsasta-pay.zip` (apna login, apna database, Telegram / bot token se koi lena-dena nahi).
1. Hostinger mein dusri Node.js app banao (jaise subdomain `pay.getitsasta.com`), wahi zip upload, env: `ADMIN_PASSWORD`, `PUBLIC_URL=https://pay.getitsasta.com`.
2. Pay panel → **Methods**: Binance Pay (Pay ID + read-only API key) aur / ya USDT BEP20 / TRC20 / Polygon (Trust Wallet ya Binance deposit address + provider URL / API key).
3. Pay panel → **Stores (API)** → store banao, webhook URL `https://getitsasta.com/api/pay/webhook` → API key + webhook secret milenge.
4. Is store ke env mein `PAY_URL`, `PAY_API_KEY`, `PAY_WEBHOOK_SECRET` → Redeploy → admin → Settings → **Connection test**.
5. Har plan ka **Crypto price (USDT)** Products mein daalo (khaali = "1 USDT = ₹" rate se).

Customer "Crypto se pay karo" dabata hai → Pay page par unique amount (jaise 5.013 USDT) → Binance Pay se bheja to **Order ID**, wallet se bheja to **TxID** daalta hai →
Pay app check karti hai (amount bilkul wahi, sahi address, naya transaction, ek ID ek hi baar) → Paid → signed webhook → store order Paid / auto-deliver.
Amount match na ho to payment "Check karo" mein jaata hai, aap ek click se Approve karte ho. Poori setup guide `getitsasta-pay/README.md` mein.

### 4b. UPI auto-verify (BharatPe)
Admin → Settings → **BharatPe auto-verify**: BharatPe wala mobile → **OTP bhejo** → OTP → **Login karo** → **Test** → "UTR apne aap verify karo" tick → Save.
Customer UTR daalta hai → BharatPe ki payments list mein wahi UTR, "received + success", aur bilkul order jitna amount (aur order ke baad ka) mila to order turant **Paid**.
Na mile to order "verify ho raha hai" mein rehta hai, har minute dobara check hota hai, aur aap haath se bhi Paid kar sakte ho.
Dhyan: BharatPe ka official API nahi hai — ye BharatPe enterprise dashboard ke private endpoints use karta hai (sirf apne KYC merchant account ke saath). Login kuch dino mein expire hota hai → Telegram alert, UPI manual par chala jaata hai, dobara OTP se login karo.
Endpoints badal jaayein to env `BHARATPE_AUTH_HOST`, `BHARATPE_API_HOST`, `BHARATPE_MERCHANT_HOST` se badal sakte ho.

### 5. Store set karo
`https://getitsasta.com/admin/` → login (`admin` + aapka `ADMIN_PASSWORD`)
1. **Settings** → WhatsApp number, support email, UPI ID / QR, payment methods
2. **Products** → sample products ko apne naam, photo aur price se badlo (ya delete karke naye banao)
3. Auto delivery wale plans ke liye **Stock** mein keys / links daalo
4. **Settings → Email test** se check karo ki email ja rahe hain
5. ₹10–50 ka ek test product bana ke khud USDT bhej ke pura flow dekho

### Data kahan save hota hai (zaroori)
Hostinger har deploy par app ka folder (`hbuilds/`) badal deta hai. Isliye app database aur photos ko
**`~/domains/getitsasta.com/gis-data/`** mein rakhta hai — deploy se data nahi mitega.
Pehle deploy ke baad File Manager mein ye folder dikh jana chahiye (admin → Settings → Backup mein path likha hota hai).
Phir bhi **hafte mein ek baar admin → Settings → Backup download** kar lo. App roz apne aap ek backup `gis-data/backups/` mein bhi banata hai (last 14 rakhta hai).

### Admin password bhool gaye?
Environment variables mein `ADMIN_RESET_PASSWORD=<naya password>` daalo → Redeploy → login → wo variable hata ke dobara Redeploy.

### Hostinger ki baatein dhyaan rakho
- Traffic na ho to Hostinger app ko sula deta hai; agli request par 1–2 second mein jaag jaata hai. Data safe rehta hai.
- Logs: hPanel → Node.js app → **Runtime logs**. Wahan `Data folder:` aur `Crypto (Get It Sasta Pay): https://pay.getitsasta.com • Email: Resend • Admin 2-step: ON` line dikhni chahiye.
- Plan ke CPU / RAM limit dashboard par dikhte hain; ye app bahut halka hai (~40 MB RAM).

---

## Currency, language, newsletter, email budget

- **Country / currency / language:** har page par upar 🌐 button. Pehli baar country time-zone se apne aap. INR waale UPI + crypto dekhte hain; dusri currency waale crypto (USDT) se pay karte hain. Rates roz apne aap (open.er-api.com). Admin → Settings → "Currency + language".
- **Newsletter popup:** X second baad (aur desktop par tab band karte waqt) pehle order par 10% off. Har subscriber ka apna `WELCOME-XXXXXX` code — sirf usi email, sirf pehla order, ek baar. Admin → Newsletter: subscribers, CSV, naya product launch mail (pehle "Sirf test bhejo").
- **Email budget (50,000/saal):** Admin → Settings → "Emails — saal ka budget". Har mail type ka ON/OFF + kitne gaye. Newsletter "reserve" se pehle ruk jaata hai taaki OTP / order mails kabhi band na hon.

## Live chat (website → Telegram)

- Har page par neeche-daayein chat button. Bot pehle khud jawab deta hai (delivery, payment, UTR, refund, products ke price, order status `GIS-…`).
- Customer "Talk to a person" dabaye → aapke Telegram par `🙋 Naya live chat C4821 · Naam (email)` + ab tak ki baat aati hai. Uske baad customer ka har message `💬 C4821 · Naam` ke saath.
- **Jawab dena:** Telegram mein us message par *Reply* karo → website chat mein turant dikhega. Ya likho `/r C4821 jawab`. `/close C4821` chat band, `/chats` open chats ki list.
- Setup: BotFather se naya bot banao → token `SUPPORT_BOT_TOKEN` mein. Bot ko ek message bhejo, phir apna chat ID (ya group ID) `SUPPORT_CHAT_ID` mein. Sirf usi chat ke messages maane jaate hain.

## Integrations — koi bhi API (Admin → Integrations)

- **API connections:** kisi bhi supplier / website ki API (base URL + Bearer / header / basic / query key). Har call ka log (secrets hata ke).
- **Product import / sync:** supplier ki product list → aapke products + plans; price par markup % (aur currency rate), MRP, stock, photos; har 15 min se roz tak auto-sync.
- **Order delivery (supplier API):** plan ki Delivery = "API" → payment aate hi supplier ko order (`{{item.api_ref}}`, `{{order.email}}`, `{{idem}}` jaise placeholders), jo mile wo customer ko turant. Fail par 3 baar retry, phir Telegram alert + "Supplier se dobara mangwao" button.
- **Telegram bots:** jitne chaho; har bot ke kaam: Alerts, Live chat, Admin commands (`/orders`, `/order`, `/paid`, `/deliver`, `/cancel`, `/retry`, `/stats`, `/sync`).
- **Webhooks:** `order.created/paid/delivered/cancelled`, `chat.human`, `chat.message` … kisi bhi URL par, HMAC signed (`X-GIS-Signature`), 5 retries.
- **Store API:** `/api/v1/products`, `/api/v1/orders` (bana / padh / deliver) — API keys with permissions, 120 req/min.
- **Products CSV:** Products → CSV import (preview ke saath) / export / template; product "Copy banao".

## Payment flow
1. Customer order banata hai → **Payment baaki**
2. a) **Crypto**: customer Get It Sasta Pay page par unique amount bhejta hai, Order ID / TxID daalta hai → verify → webhook → **Paid**
   b) **BharatPe UPI**: UTR daalta hai → **Verify karo** → aap BharatPe app mein amount + UTR milake **Paid karo**
3. Agar saare items **Auto** hain aur stock hai → turant **Delivered**, keys order page aur dashboard par
4. Warna aap admin mein delivery details likh ke **Deliver karo** → customer ko email + order page par dikh jaata hai
5. Validity (din) wale plans ki expiry dashboard mein, khatam hone se pehle "Renew karo" button

---

## VPS par chalana (optional)
**Hostinger KVM 1 (recommended):** poori guide `deploy/README-VPS.md` mein. Short mein:

```bash
# dono zips /root mein upload karke
cd /root && apt-get update && apt-get install -y unzip
unzip -o -j getitsasta.zip deploy/install.sh deploy/update.sh -d /root/
sudo bash install.sh --domain getitsasta.com --email aap@gmail.com
```

Node 22, Nginx (HTTP/2, brotli/gzip), free SSL, firewall, swap, systemd (auto-restart), roz 3:30 baje backup — store + Pay dono. Settings `/etc/gis/store.env`, data `/var/lib/gis/store`. Update: `sudo gis-update store getitsasta.zip` (fail ho to apne aap purana version wapas).

## Apne computer par
```bash
cp .env.example .env    # NODE_ENV=development, ADMIN_PASSWORD set karo
npm start               # http://127.0.0.1:3000
```

## Structure
```
server.js              entry (Hostinger "Entry file")
src/server.js          HTTP server, security headers, routing
src/config.js          env + data folder (Hostinger auto-detect)
src/db.js              SQLite schema + migrations + sample data
src/routes/            public.js (store, orders, crypto + Pay webhook), customer.js, admin.js
src/lib/               orders (pricing, coupon, auto-delivery), paygate (Get It Sasta Pay se jodna), mailer (Resend/SMTP), otp, auth, images
public/                store, product, order, account (dashboard), track, admin panel
deploy/                VPS: install.sh (1-command), update.sh (update + rollback), README-VPS.md
```

**Security**: scrypt passwords, email OTP (hash, 10 min, 5 try), admin 2-step OTP, HttpOnly sessions + device list, rate limits, CSP, crypto webhook HMAC signature + timestamp check, amount Pay app aur store dono jagah check,
server-side prices, duplicate UTR block, image type check, JSON-only writes (CSRF), parameterised SQL.
