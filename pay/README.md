# Get It Sasta Pay

Store se **bilkul alag** crypto payment panel. Apna login, apna database, apna domain (jaise `pay.getitsasta.com`).
Telegram / BotFather token se koi lena-dena nahi. Koi seed / 12 words nahi — paisa seedha aapke Binance account ya Trust Wallet mein.

**Methods**
- **Binance Pay** — customer aapke Binance Pay ID par USDT bhejta hai aur **Order ID** daalta hai. Panel aapke (KYC wale) Binance account ki **read-only** API key se Pay history mein check karta hai.
- **USDT BEP20 / TRC20 / Polygon** — customer aapke address (Trust Wallet ya Binance deposit address) par bhejta hai aur **TxID** daalta hai. Panel aapke chune provider (TronGrid, Ankr, QuickNode, NOWNodes ya apna node — URL + API key) se chain par check karta hai.

**Unique amount** — store 5.00 USDT maange to customer ko 5.013 jaisa amount milta hai (0.001–0.099 upar, khule payments mein kisi se match nahi).
Auto-verify **sirf tab** jab aaya hua amount bilkul wahi ho. Kam / zyada aaya to payment **"Check karo"** mein jaata hai — aap ek click se Approve karo.
Isse koi doosre ka TxID / Order ID chura ke apne order par nahi laga sakta.

Har check: sahi address / Pay ID, sahi token (USDT contract), transaction invoice se pehle ka nahi, confirmations poori, aur **ek ID sirf ek baar**.

Node.js 22.13+ ya 24, koi npm package nahi.

---

## Setup (Hostinger Cloud)

### 1. Dusri Node.js app banao
hPanel → Websites → **Add website** → Node.js app → domain / subdomain `pay.getitsasta.com` (DNS mein subdomain banana padega).
`getitsasta-pay.zip` upload karo. Build settings: Node **22.x** ya **24.x**, Entry file `server.js`, build command khaali / `npm install`.

### 2. Environment variables
```
NODE_ENV=production
PUBLIC_URL=https://pay.getitsasta.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<naya strong password, store wala nahi>
```
Deploy → `https://pay.getitsasta.com/admin/` → login.

### 3. Methods (Pay panel → Methods)
**Binance Pay** (0 fees, sabse aasaan):
1. Binance → Profile → **API Management** → Create API (System generated).
2. Permission sirf **Enable Reading**. Withdraw / Trading **kabhi ON mat karna**. "Restrict access to trusted IPs" mein Hostinger server ka IP daalo.
3. Panel mein Pay ID (Binance app → Pay → apna Pay ID), naam, API key, Secret → **Test connection** → ON → Save.

**USDT BEP20 (Trust Wallet)** (fees sabse kam):
1. Trust Wallet → USDT (BNB Smart Chain) → Receive → address copy.
2. Provider: Ankr / QuickNode / Alchemy ka BSC URL (key URL mein hoti hai), ya NOWNodes `https://bsc.nownodes.io` + header `api-key`. Free public: `https://bsc-dataseed.bnbchain.org` (dheema, kabhi limit lagti hai).
3. Confirmations 15 (≈45 sec) → Test → ON → Save.

**USDT TRC20**: address (Trust Wallet USDT TRON, ya Binance → Deposit → USDT → TRX network), provider `https://api.trongrid.io` + header `TRON-PRO-API-KEY` + trongrid.io ki free key, confirmations 19.

**Polygon**: jaisa BEP20, Polygon RPC URL ke saath.

> Binance deposit address par **Binance se hi** bheja gaya paisa aksar "internal transfer" hota hai — chain par TxID nahi banta, auto-verify nahi hoga. Binance users ko **Binance Pay** chunne bolo. Aise payment Pay panel → Payments → **Haath se Paid karo** (note ke saath) se pura karo.

### 4. Store jodo (Pay panel → Stores (API))
1. **Store banao**: naam `Get It Sasta`, Webhook URL `https://getitsasta.com/api/pay/webhook`.
2. API key + webhook secret **abhi copy karo** (dobara nahi dikhte).
3. Store ki Hostinger app ke env mein: `PAY_URL=https://pay.getitsasta.com`, `PAY_API_KEY=…`, `PAY_WEBHOOK_SECRET=…` → Redeploy.
4. Pay panel → store card → **Test webhook** → "✓ Store ne webhook le liya". Store admin → Settings → **Connection test**.

### 5. Test
Store par sasta product → Crypto se pay karo → Binance Pay se exact amount (jaise 1.013) bhejo → Order ID daalo → turant Paid, store par order Paid / delivered.

---

## Roz ka kaam
- **Dashboard → Check karne wale payments**: amount match nahi hua → Binance / wallet mein dekh ke **Approve**, ya **Dobara kholo** (customer sahi ID dobara daal sake), ya **Cancel**.
- Webhook fail dikhe → invoice kholo → **dobara bhejo**. Store bhi customer ke "check karo" par Pay app se status le leta hai.
- Binance API key kabhi leak lage → Binance mein delete karo, nayi banake panel mein daalo.

## Store API (kisi bhi website ke liye)
```
POST /api/v1/invoices         Authorization: Bearer <API key>
{ "order_id": "GIS-ABC1234", "amount": "5.00", "description": "Get It Sasta", "customer_email": "a@b.com", "return_url": "https://…" }
→ 201 { "id": "inv_…", "pay_url": "https://pay…/i/inv_…", "amount": "5.013", "status": "pending", … }   (same order_id = wahi invoice)

GET  /api/v1/invoices/:id     → status: pending | confirming | review | paid | expired | cancelled
GET  /api/v1/methods          → chalu methods
```
Webhook: `POST <webhook URL>` body `{ event: "invoice.paid", created, data: <invoice> }`, headers `X-GSP-Timestamp`, `X-GSP-Signature` = HMAC-SHA256(webhook secret, `timestamp + "." + body`) hex.
2xx na mile to 30s, 2m, 10m, 30m, 2h, 6h, 12h par dobara.

## Files
```
server.js                Hostinger entry
src/routes.js            store API, pay page API, admin API
src/lib/invoices.js      unique amount, verify, review, worker
src/lib/chain.js         TRC20 / BEP20 / Polygon check (koi bhi provider)
src/lib/binance.js       Binance Pay Order ID check (read-only API key)
src/lib/webhooks.js      signed webhooks + retries
public/pay.html          customer pay page   •   public/admin/  Pay panel
```
Data: `~/domains/<domain>/pay-data/pay.db` (Hostinger), roz backup `pay-data/backups`.
