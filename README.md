# Get It Sasta

Sasti digital subscriptions ka store (getitsasta.com) + alag crypto payment panel.

| Folder | Kya hai |
| --- | --- |
| `store/` | Website + admin panel (Node.js 22.13+, zero dependencies, SQLite). Details: `store/README.md` |
| `pay/` | Get It Sasta Pay — crypto payments (Binance Pay, USDT BEP20/TRC20). Details: `pay/README.md` |
| `deploy/` | VPS installer (KVM 1): GitHub se install, update, rollback — `deploy/README-VPS.md` |

## Kabhi commit mat karo
- `.env` files (passwords, API keys) — server par `/etc/gis/*.env` mein rehti hain
- Database (`*.db`) aur `data/` folder

## Local chalana
```bash
cd store && ADMIN_PASSWORD=test12345 node server.js   # http://localhost:3000
cd pay && ADMIN_PASSWORD=test12345 PORT=3100 node server.js
```
