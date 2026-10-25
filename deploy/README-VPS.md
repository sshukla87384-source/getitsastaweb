# Get It Sasta — Hostinger VPS par deploy (shared VPS safe)

Ek VPS par dono apps chalenge, chahe us VPS par pehle se doosri websites ho:

| App | Address | Andar ka port | Code | Data | Settings |
|---|---|---|---|---|---|
| Store | `https://getitsasta.com` (+ `www` → redirect) | 127.0.0.1:3000* | `/opt/gis/store` | `/var/lib/gis/store` | `/etc/gis/store.env` |
| Pay | `https://pay.getitsasta.com` | 127.0.0.1:3100* | `/opt/gis/pay` | `/var/lib/gis/pay` | `/etc/gis/pay.env` |

\* Agar port busy ho to installer 3300–3399 mein se khaali port leta hai aur `/etc/gis/ports` mein save karta hai.

Repo layout (monorepo): `store/`, `pay/`, `deploy/` (`install.sh`, `update.sh`, `uninstall.sh`, `gis-common.sh`, ye README).

---

## VPS par pehle se doosri cheezein hain? (zaroor padho)

**Installer kya karta hai:**
- Sirf `gis` naam ki cheezein banata hai:
  - user `gis`;
  - services `gis-store`, `gis-pay`, `gis-backup.timer`;
  - folders `/opt/gis`, `/var/lib/gis`, `/etc/gis`;
  - commands `/usr/local/sbin/gis-update` aur `gis-backup`;
  - nginx files `gis-store.conf`, `gis-pay.conf`, `gis-zones.conf`;
  - certificates `gis-getitsasta.com` aur `gis-pay.getitsasta.com`.
- **Node apna alag** rakhta hai. Ye nodejs.org se download hota hai (SHA256 check ke saath) aur `/opt/gis/node` mein jaata hai. System ka Node waise hi rehta hai.
- Packages sirf wahi install hote hain jo **missing** hain, `--no-upgrade` ke saath. Agar apt kisi installed package ko upgrade ya remove karna chahe, to installer **ruk jaata hai**.
- Agar `gis` naam ki koi cheez pehle se ho jo hamare installer ne nahi banayi (yaani `/etc/gis/.installed-by-gis` marker nahi hai), to installer ruk jaata hai. Kuch overwrite nahi hota.

**Installer kya NAHI karta:**
- `nginx.conf` edit nahi karta, Ubuntu ki default site nahi hatata, aur `default_server` / catch-all block nahi banata.
- nginx ko restart ya stop kabhi nahi karta. Sirf `nginx -t` aur phir `reload` karta hai.
- Doosre SSL certificates ko haath nahi lagata. `certbot --nginx` (jo config badalta hai) nahi chalata, sirf `certonly --webroot` chalata hai.
- ufw enable nahi karta aur policy nahi badalta. `--firewall` doge aur ufw pehle se active hai, tabhi sirf 80/443 allow karega.
- `apt upgrade` / `autoremove` kabhi nahi chalata. journald aur sysctl tabhi chhedta hai jab `--tune` do.
- Swap sirf tab banta hai jab server par **koi swap nahi** ho, aur woh file `/swapfile-gis` hoti hai (`--no-swap` se band).

**Web server ke hisaab se installer kya karta hai (apne aap detect):**

| VPS par kya mila | Installer kya karega | SSL |
|---|---|---|
| Kuch nahi (80/443 khaali) | nginx install (`--no-upgrade`), sirf hamari gis files | certbot (hum) |
| Plain nginx (bina panel) | sirf hamari `gis-*.conf` files | certbot (hum) |
| Apache / Caddy / LiteSpeed / Traefik / Docker proxy | nginx nahi lagata, 80/443 bind nahi karta. Apps 127.0.0.1 par chalti hain, aur copy-paste snippet print hota hai (`/etc/gis/proxy-snippets/`) | aapka server |
| CloudPanel / aaPanel / Hestia / CyberPanel / Plesk / cPanel / Coolify / Dokploy / CapRover / NPM | panel ka nginx nahi chhedta. Panel mein "reverse proxy" site banane ke steps print hote hain | panel |

Docker wale proxy (NPM, Traefik, Coolify) container ke andar se host ka `127.0.0.1` nahi dekh sakte. Unke liye install mein `--bind 172.17.0.1` lagao.

---

## GitHub se deploy (recommended) — seedha getitsasta.com par

### Step 0: DNS

hPanel → Domains → DNS records mein **A** records daalo: `@`, `www`, `pay` → VPS ka IP. Agar purani site isi VPS par hai to `@` aur `www` pehle se sahi honge, sirf `pay` add karo.

### Step 1: SSH login (Windows PowerShell)

```powershell
ssh root@1.2.3.4
```

### Step 2: Deploy key banao (repo private hai)

```bash
sudo apt-get install -y --no-upgrade git          # agar git nahi hai
sudo mkdir -p /etc/gis && sudo chmod 750 /etc/gis
sudo ssh-keygen -t ed25519 -N "" -f /etc/gis/deploy_key -C gis-deploy
sudo chmod 600 /etc/gis/deploy_key
sudo cat /etc/gis/deploy_key.pub
```

Jo line print ho (`ssh-ed25519 AAAA... gis-deploy`), use copy karo, phir GitHub par: repo → **Settings → Deploy keys → Add deploy key**. Title `gis-vps` rakho, key paste karo. **"Allow write access" tick MAT karo**, phir Add key.

### Step 3: Repo clone (sirf is key se; aapka `~/.ssh` aur global git config nahi chhuta)

```bash
sudo GIT_SSH_COMMAND="ssh -i /etc/gis/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/etc/gis/known_hosts" \
  git clone git@github.com:USER/REPO.git /opt/gis/src
```

(Short raasta: step 2 aur 3 chhod ke seedha `install.sh --git git@github.com:USER/REPO.git` bhi chala sakte ho. Script key banayegi, public key dikhayegi, aur Enter ka intezaar karegi.)

### Step 4: Pehle check karo

```bash
sudo bash /opt/gis/src/deploy/install.sh --check --domain getitsasta.com
```

Isme dikhega:
- 80/443 par kaun hai, aur koi panel hai ya nahi;
- ports, Node aur DNS;
- **kaunsi purani nginx files `getitsasta.com` use kar rahi hain**, aur `--take-over` unke saath kya karega. Agar woh REFUSE karega to wajah bhi dikhegi.

### Step 5: Dry-run (kuch nahi badlega)

```bash
sudo bash /opt/gis/src/deploy/install.sh --domain getitsasta.com --email you@gmail.com --take-over --dry-run
```

Isme poora plan dikhega: packages, files, ports, proxy mode, firewall, aur purani site ki kaunsi file disable hogi.

### Step 6: Install + purani site ki jagah lena

```bash
sudo bash /opt/gis/src/deploy/install.sh --domain getitsasta.com --email you@gmail.com --take-over
```

`--take-over` ye karta hai:
1. Pehle dono apps start karke health check karta hai. Agar store healthy nahi hai to purani site ko **haath nahi lagata**.
2. Jo enabled configs `getitsasta.com` / `www.getitsasta.com` use karti hain, unka backup `/etc/gis/backup-nginx-<time>/` mein leta hai (original path ke saath). Phir **sirf unhe** disable karta hai:
   - `sites-enabled` ka symlink hata deta hai (asli site file aur webroot rehte hain);
   - `conf.d/x.conf` ko `x.conf.disabled-by-gis` naam de deta hai.
3. Agar ek file mein **doosre domains** bhi hain, to poori file disable nahi karta. Woh ruk jaata hai aur batata hai ki kya edit karna hai.
4. Hamari config likhta hai → `nginx -t` → reload → SSL (certonly) → HTTPS config → reload.
5. Kisi bhi step par fail hua (nginx -t ya SSL), to **purani site apne aap wapas** aa jaati hai.

Switch ke waqt ~1 minute HTTPS ka gap ho sakta hai, jab tak naya certificate banta hai.

Bina `--take-over` ke, agar domain pehle se kisi config mein hai to installer ruk jaata hai aur `--take-over` lagane ko kehta hai.

### Step 7: Verify

```bash
sudo gis-update status                                    # dono apps: active, health, commit
curl -sI https://getitsasta.com | head -5                 # 200 aana chahiye
curl -s https://getitsasta.com/healthz                    # ok
curl -s https://pay.getitsasta.com/healthz                # ok
sudo nginx -t                                             # successful
```

Browser mein `https://getitsasta.com/admin/` aur `https://pay.getitsasta.com/admin/` kholo. Passwords summary mein dikhe the, aur `sudo cat /root/gis-credentials.txt` mein bhi hain. Login karke password badlo.

### Step 8: Kuch gadbad? Purani site wapas (ek command)

```bash
sudo gis-update restore-old-site          # -y = bina sawaal
```

Isse ye hota hai:
- backup se purani configs wapas aati hain;
- hamari store site ka nginx config band hota hai (apps 127.0.0.1 par chalti rehti hain);
- `nginx -t` chalta hai, phir reload.

Dobara nayi site lagani ho to: `sudo bash /opt/gis/bin/install.sh --take-over`

### Updates (GitHub par push karo, phir)

```bash
sudo gis-update pull                       # sirf jis app ka folder badla, wahi update hoga
sudo gis-update pull store --ref v1.2.0    # koi tag / branch / commit
sudo gis-update pull all --force           # zabardasti dono
sudo gis-update status                     # deployed commit vs GitHub
sudo gis-update rollback store             # pichhla version
```

Har update par ye hota hai: pehle backup, phir release banta hai, phir swap, phir health check. Fail hua to **auto-rollback**.
Agar repo mein `store/.env`, `pay/.env` ya `*.db` file mili, to deploy **REFUSE** ho jaata hai. Secrets sirf `/etc/gis/*.env` mein rakho.

---

## Zip se deploy (bina GitHub)

`install.sh`, `update.sh`, `uninstall.sh` aur `gis-common.sh` ek hi folder mein rakho, saath mein `getitsasta.zip` aur `getitsasta-pay.zip`. Phir:

```bash
sudo bash install.sh --domain getitsasta.com --email you@gmail.com --take-over --dry-run   # pehle
sudo bash install.sh --domain getitsasta.com --email you@gmail.com --take-over
sudo gis-update store getitsasta.zip          # baad mein update
```

Upload karne ke liye: `scp getitsasta.zip root@1.2.3.4:/root/`, ya WinSCP/FileZilla (SFTP) use karo.

## Doosre flags

| Flag | Matlab |
|---|---|
| `--pay-domain pay.example.com` | Pay ka domain (default `pay.<apex>`) |
| `--domain new.getitsasta.com` | Subdomain par test install (www block nahi banta; Pay default `pay.getitsasta.com`) |
| `--proxy=none` | Sirf apps install hongi, reverse proxy aap khud lagaoge (snippets milenge) |
| `--no-pay` / `--no-ssl` / `--no-swap` | Pay skip / SSL baad mein / swap mat banao |
| `--firewall` | ufw active ho to sirf 80/443 allow |
| `--tune` | journald 200M cap + sysctl (system-wide, opt-in) |
| `--system-node` | System ka Node (>= 22.13) use karo |

## Roz ke kaam

```bash
sudo nano /etc/gis/store.env && sudo systemctl restart gis-store    # settings (Resend, Telegram, Pay keys)
sudo nano /etc/gis/pay.env   && sudo systemctl restart gis-pay
journalctl -u gis-store -f                                          # live logs
sudo gis-backup                                                     # turant backup (roz 03:30 IST apne aap hota hai)
```

**Backups download (PowerShell):**

```powershell
scp "root@1.2.3.4:/var/lib/gis/store/backups/store-*.db" .
scp "root@1.2.3.4:/var/lib/gis/pay/backups/*.db" .
scp -r root@1.2.3.4:/var/lib/gis/store/uploads .
```

**Restore:**

```bash
sudo systemctl stop gis-store
cd /var/lib/gis/store && sudo cp store.db /root/store-before-restore.db
sudo rm -f store.db-wal store.db-shm
sudo cp backups/store-2026-10-25-03-30-00.db store.db && sudo chown gis:gis store.db
sudo systemctl start gis-store && sudo gis-update status
```

**Panel ke andar reverse proxy (agar panel mila):**
- **CloudPanel**: Sites → Add Site → Create a Reverse Proxy → `http://127.0.0.1:3000` → SSL/TLS → Let's Encrypt.
- **aaPanel**: Website → Add site → Reverse proxy → `http://127.0.0.1:3000` → SSL.
- **HestiaCP**: proxy template banao (`proxy_pass http://127.0.0.1:3000`) → domain par lagao → SSL.
- **CyberPanel**: vHost Conf mein `extprocessor` + `context / { type proxy }` → Issue SSL.
- **Nginx Proxy Manager**: Proxy Host → `172.17.0.1:3000` (install `--bind 172.17.0.1` ke saath) → SSL tab.

Pay ke liye sab jagah `pay.getitsasta.com` → port 3100. Exact text `/etc/gis/proxy-snippets/` mein milega.

**Uninstall (sirf gis cheezein):** `sudo bash /opt/gis/bin/uninstall.sh` (`--purge-data` lagane par database bhi delete hoga; confirm maangega). ufw rules aur nginx/certbot packages waise hi rehte hain.

## Troubleshooting

| Problem | Kya karo |
|---|---|
| "Ye domain pehle se kisi purani nginx site par hai" | `--check` se dekho, phir `--take-over` lagao |
| "--take-over nahi kar sakte: doosre naam bhi hain" | Batayi gayi file se sirf getitsasta.com wala `server { }` block hatao, phir `sudo nginx -t && sudo systemctl reload nginx`, phir dobara chalao |
| "gis naam ki cheezein pehle se hain" | Kisi aur ne `gis` user/service banaya hai. Check karo; hum overwrite nahi karte |
| "apt ... upgrade karna chahta hai" | Doosre apps ki safety ke liye installer ruka hai. Theek lage to `--allow-dep-upgrades` lagao |
| SSL nahi laga / take-over auto-restore hua | DNS check karo: `dig +short getitsasta.com @1.1.1.1` mein VPS ka IP aana chahiye. hPanel firewall mein 80/443 khule hone chahiye |
| `502 Bad Gateway` | `journalctl -u gis-store -n 50` dekho, phir `sudo systemctl restart gis-store` |
| Update ke baad auto-rollback | `journalctl -u gis-store -n 100` dekho. Commit theek karke push karo, phir `gis-update pull` |
| "deploy REFUSED: .env / .db" | `git rm --cached store/.env` karo, `.gitignore` mein daalo, push karo |
| `git fetch fail` | GitHub par deploy key hai? Test: `sudo GIT_SSH_COMMAND="ssh -i /etc/gis/deploy_key" git ls-remote git@github.com:USER/REPO.git` |
| Port 3000 busy | Installer apne aap 33xx port leta hai. Dekho: `cat /etc/gis/ports` |
| Admin login nahi hota | HTTPS se kholo, http se nahi (production cookies `Secure` hain) |
