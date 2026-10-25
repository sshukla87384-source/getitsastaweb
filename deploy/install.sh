#!/usr/bin/env bash
# ============================================================================
#  Get It Sasta — Hostinger VPS installer (Ubuntu 22.04 / 24.04), SHARED-VPS SAFE
#
#  Store → https://<domain> (+www)      Pay → https://pay.<domain>
#
#  GitHub se (recommended, public repo = https, koi key nahi):
#    sudo git clone https://github.com/sshukla87384-source/getitsastaweb.git /opt/gis/src
#    sudo bash /opt/gis/src/deploy/install.sh --domain getitsasta.com --email you@x.com --take-over
#  ya: install.sh --git https://github.com/USER/REPO.git [--branch main] ...   (private: git@github.com:USER/REPO.git → deploy key)
#  Repo clone ke andar se (../store, ../pay):
#    sudo bash deploy/install.sh --domain getitsasta.com --email you@x.com
#  Zip se:
#    sudo bash install.sh --domain getitsasta.com --email you@x.com [--store-zip a.zip] [--pay-zip b.zip]
#
#  Options:
#    --take-over          domain pehle se kisi purani nginx site par hai → us config ka backup + disable
#                         (sirf wahi files; fail = auto-restore). Wapas: sudo gis-update restore-old-site
#    --pay-domain HOST    default pay.<apex>  (new.getitsasta.com → pay.getitsasta.com)
#    --restore-old-site   purani site ki configs wapas, hamari store site band (-y = bina sawaal)
#    --dry-run            kuch nahi badlega, sirf plan dikhega (PEHLE YE CHALAO)
#    --check | doctor     web server / panel / ports / node / DNS detect karke dikhao
#    --proxy=auto|nginx|none   (default auto) none = sirf apps, proxy aapka server/panel
#    --bind IP            apps kis IP par sunein (default 127.0.0.1; Docker proxy ke liye 172.17.0.1)
#    --no-pay  --no-ssl  --no-swap  --tune (journald/sysctl)  --firewall (ufw active ho to 80/443 allow)
#    --system-node        system ka Node (>= 22.13) use karo; default = private Node /opt/gis/node
#    --update-node        private Node ko latest 22.x par le jao
#    --allow-dep-upgrades apt ko dependency upgrade karne do (default: mana)
#    -y | --yes           koi sawaal mat poochho
#
#  Sirf "gis" naam ki cheezein banata hai. Dobara chalana safe hai.
# ============================================================================
set -euo pipefail
umask 022

SCRIPT_DIR=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
# shellcheck source=gis-common.sh
. "$SCRIPT_DIR/gis-common.sh" 2>/dev/null || { echo "gis-common.sh $SCRIPT_DIR mein nahi mila — poora deploy/ folder rakho" >&2; exit 1; }
OWN=${GIS_OWNER:-$GIS_USER}

# ---------------------------------------------------------------- args
DOMAIN='' EMAIL='' STORE_ZIP='' PAY_ZIP='' GIT_URL='' GIT_BRANCH=''
NO_PAY=0 NO_SSL=0 NO_SWAP=0 TUNE=0 FIREWALL=0 USE_SYSTEM_NODE=0 UPDATE_NODE=0
ALLOW_DEP_UPGRADES=0 ASSUME_YES=0 CHECK=0 PROXY_REQ=auto BIND_REQ=''
TAKE_OVER=0 RESTORE_OLD=0 PAY_DOMAIN='' APEX='' IS_APEX=1

usage() { sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

parse_args() {
  local v
  while (($#)); do
    case $1 in
      --*=*) v=${1#*=}; set -- "${1%%=*}" "$v" "${@:2}"; continue ;;
    esac
    case $1 in
      --domain)    DOMAIN=${2:-}; shift 2 ;;
      --email)     EMAIL=${2:-}; shift 2 ;;
      --store-zip) STORE_ZIP=${2:-}; shift 2 ;;
      --pay-zip)   PAY_ZIP=${2:-}; shift 2 ;;
      --git)       GIT_URL=${2:-}; shift 2 ;;
      --branch)    GIT_BRANCH=${2:-}; shift 2 ;;
      --proxy)     PROXY_REQ=${2:-}; shift 2 ;;
      --bind)      BIND_REQ=${2:-}; shift 2 ;;
      --no-pay)    NO_PAY=1; shift ;;
      --take-over|--takeover) TAKE_OVER=1; shift ;;
      --pay-domain) PAY_DOMAIN=${2:-}; shift 2 ;;
      --restore-old-site|--switch-back) RESTORE_OLD=1; shift ;;
      --no-ssl)    NO_SSL=1; shift ;;
      --no-swap)   NO_SWAP=1; shift ;;
      --tune)      TUNE=1; shift ;;
      --firewall)  FIREWALL=1; shift ;;
      --system-node) USE_SYSTEM_NODE=1; shift ;;
      --update-node) UPDATE_NODE=1; shift ;;
      --allow-dep-upgrades) ALLOW_DEP_UPGRADES=1; shift ;;
      --dry-run)   DRY=1; shift ;;
      --check|doctor|check) CHECK=1; shift ;;
      -y|--yes)    ASSUME_YES=1; shift ;;
      -h|--help)   usage 0 ;;
      *) die "Unknown option: $1  (help: bash install.sh --help)" ;;
    esac
  done
  case $PROXY_REQ in auto|nginx|none) ;; *) die "--proxy auto|nginx|none hona chahiye" ;; esac
  if [[ -n $BIND_REQ && ! $BIND_REQ =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then die "--bind IPv4 hona chahiye (jaise 127.0.0.1)"; fi
  return 0
}

interactive() { [[ -t 0 && $ASSUME_YES == 0 ]]; }
ask() { local q=$1 def=${2:-} a=''; read -r -p "    $q${def:+ [$def]}: " a || true; printf '%s' "${a:-$def}"; }

normalize_domain() {
  local d=${1,,}
  d=${d#http://}; d=${d#https://}; d=${d%%/*}; d=${d%.}; d=${d#www.}
  printf '%s' "$d"
}

find_zip() { # store|pay → newest matching zip in $PWD / SCRIPT_DIR
  local kind=$1 dir f best='' newest=0 m
  for dir in "$PWD" "$SCRIPT_DIR"; do
    for f in "$dir"/getitsasta*.zip; do
      [[ -f $f ]] || continue
      case $kind:$(basename "$f") in
        pay:getitsasta-pay*) ;;
        store:getitsasta-pay*) continue ;;
        store:*) ;;
        *) continue ;;
      esac
      m=$(stat -c %Y "$f")
      if ((m > newest)); then newest=$m; best=$(readlink -f "$f"); fi
    done
  done
  printf '%s' "$best"
}

# ---------------------------------------------------------------- inputs + sources
declare -A SRC_KIND=() SRC_PATH=() NEW_REL=() WAS_INSTALLED=() UNIT_CHANGED=()
REPO_ROOT='' IN_REPO=0

gather_inputs() {
  [[ -z $DOMAIN ]] && DOMAIN=$SAVED_DOMAIN
  [[ -z $EMAIL ]] && EMAIL=$SAVED_EMAIL
  if [[ -z $DOMAIN ]] && interactive; then DOMAIN=$(ask "Domain (jaise getitsasta.com)"); fi
  if [[ -z $EMAIL && $NO_SSL == 0 ]] && interactive; then EMAIL=$(ask "Email (SSL notices, khaali chhod sakte ho)"); fi
  DOMAIN=$(normalize_domain "$DOMAIN")
  [[ -n $DOMAIN ]] || die "Domain chahiye: --domain getitsasta.com"
  [[ $DOMAIN =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die "Domain sahi nahi lagta: '$DOMAIN'"
  if [[ -n $EMAIL && ! $EMAIL =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then die "Email sahi nahi lagta: '$EMAIL'"; fi
  set_domains

  # Git source: flag > saved > hamara clone (/opt/gis/src) se chal rahe hain
  [[ -z $GIT_URL ]] && GIT_URL=$(conf_get "$CONF_FILE" GIT_URL)
  [[ -z $GIT_BRANCH ]] && GIT_BRANCH=$(conf_get "$CONF_FILE" GIT_BRANCH)
  REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
  if [[ -z $GIT_URL && $REPO_ROOT == "$GIT_SRC" && -d $GIT_SRC/.git ]]; then
    GIT_URL=$(origin_url)
  fi
  if [[ $REPO_ROOT != "$OPT" && $REPO_ROOT != "$GIT_SRC" && -f $REPO_ROOT/store/package.json ]]; then IN_REPO=1; fi
  if [[ -n $GIT_URL ]] && url_has_creds "$GIT_URL"; then
    die "Git URL mein password/token hai — ye log/config mein aa jayega. SSH URL (git@github.com:USER/REPO.git) + deploy key use karo."
  fi

  local app zip
  for app in store pay; do
    if [[ $app == pay && $NO_PAY == 1 ]]; then
      if [[ -L $OPT/pay ]]; then SRC_KIND[pay]=keep; else SRC_KIND[pay]=none; fi
      continue
    fi
    [[ $app == store ]] && zip=$STORE_ZIP || zip=$PAY_ZIP
    if [[ -n $zip ]]; then
      [[ -f $zip ]] || die "$app zip nahi mila: $zip"
      SRC_KIND[$app]=zip; SRC_PATH[$app]=$(readlink -f "$zip")
    elif [[ -n $GIT_URL ]]; then
      SRC_KIND[$app]=git
    elif ((IN_REPO)) && [[ -f $REPO_ROOT/$app/package.json ]]; then
      SRC_KIND[$app]=dir; SRC_PATH[$app]=$REPO_ROOT/$app
    elif zip=$(find_zip "$app") && [[ -n $zip ]]; then
      SRC_KIND[$app]=zip; SRC_PATH[$app]=$zip
    elif [[ -L $OPT/$app ]]; then
      SRC_KIND[$app]=keep
    else
      SRC_KIND[$app]=none
    fi
  done
  [[ ${SRC_KIND[store]} != none ]] || die "Store ka source nahi mila. --git <url>, repo clone ke andar se chalao, ya getitsasta.zip isi folder mein rakho."
  return 0
}

apex_of() { # new.getitsasta.com → getitsasta.com ; shop.example.co.in → example.co.in
  local d=$1 n IFS=.
  local -a l
  read -ra l <<<"$d"; n=${#l[@]}
  if ((n <= 2)); then echo "$d"; return 0; fi
  if [[ ${l[n-2]} =~ ^(co|com|net|org|gov|edu|ac|gen|firm|ind|nic|res)$ && ${#l[n-1]} == 2 ]]; then echo "${l[n-3]}.${l[n-2]}.${l[n-1]}"
  else echo "${l[n-2]}.${l[n-1]}"; fi
}
set_domains() {
  APEX=$(apex_of "$DOMAIN")
  [[ $DOMAIN == "$APEX" ]] && IS_APEX=1 || IS_APEX=0
  [[ -z $PAY_DOMAIN ]] && PAY_DOMAIN=$(conf_get "$CONF_FILE" PAY_DOMAIN)
  PAY_DOMAIN=$(normalize_domain "${PAY_DOMAIN:-pay.$APEX}")
  [[ $PAY_DOMAIN != "$DOMAIN" ]] || die "--pay-domain store domain se alag hona chahiye"
  return 0
}
our_hosts() { # store (+www agar apex) + pay
  echo "$DOMAIN"
  ((IS_APEX)) && echo "www.$DOMAIN"
  app_on pay && echo "$PAY_DOMAIN"
  return 0
}
store_hosts() { echo "$DOMAIN"; ((IS_APEX)) && echo "www.$DOMAIN"; return 0; }

src_label() { # app → human readable
  case ${SRC_KIND[$1]} in
    zip) echo "zip $(basename "${SRC_PATH[$1]}")" ;;
    dir) echo "folder ${SRC_PATH[$1]}" ;;
    git) echo "git ${GIT_URL} (${GIT_BRANCH:-default branch}) → $1/" ;;
    keep) echo "jo installed hai wahi (koi naya source nahi)" ;;
    none) echo "skip" ;;
  esac
}

# ---------------------------------------------------------------- safety checks
preflight() {
  if [[ $(id -u) -ne 0 ]]; then
    ((DRY || CHECK)) && { warn "root nahi ho — kuch detection (process names, nginx -T) adhoori ho sakti hai"; return 0; }
    die "Root se chalao: sudo bash install.sh ..."
  fi
  if [[ -f $R/etc/os-release ]]; then
    local id ver
    id=$(sed -n 's/^ID=//p' "$R/etc/os-release" | tr -d '"'); ver=$(sed -n 's/^VERSION_ID=//p' "$R/etc/os-release" | tr -d '"')
    if [[ $id != ubuntu ]]; then warn "Ye script Ubuntu 22.04/24.04 ke liye hai (mila: $id $ver)"
    elif [[ $ver != 22.04 && $ver != 24.04 ]]; then warn "Ubuntu $ver test nahi hua (22.04/24.04 recommended)"; fi
  fi
  have systemctl || die "systemd nahi mila"
  have ss || die "'ss' (iproute2) nahi mila"
  return 0
}

# Naam takrav: "gis" naam ki cheez pehle se hai par humne nahi banayi → ruk jao
namespace_guard() {
  step "Naam check (gis-*)"
  if [[ -f $MARKER ]]; then ok "pehle ka gis install mila ($MARKER) — update/re-run mode"; return 0; fi
  local c=() f u extra
  if id "$GIS_USER" >/dev/null 2>&1; then c+=("Linux user '$GIS_USER' pehle se hai"); fi
  if [[ -e $OPT ]]; then
    extra=$(find "$OPT" -mindepth 1 -maxdepth 1 ! -name src -printf '%f ' 2>/dev/null || true)
    if [[ -n $extra ]]; then c+=("$OPT pehle se hai ($extra)"); fi
    if [[ -e $OPT/src && ! -d $OPT/src/.git ]]; then c+=("$OPT/src hai par git repo nahi"); fi
  fi
  if [[ -e $ETC ]]; then   # docs ke manual steps se sirf deploy key ho sakti hai
    extra=$(find "$ETC" -mindepth 1 -maxdepth 1 ! -name deploy_key ! -name deploy_key.pub ! -name known_hosts -printf '%f ' 2>/dev/null || true)
    if [[ -n $extra ]]; then c+=("$ETC pehle se hai ($extra)"); fi
  fi
  for f in "$VAR" "$SBIN/gis-update" "$SBIN/gis-backup" "$SWAPFILE"; do
    if [[ -e $f ]]; then c+=("$f pehle se hai"); fi
  done
  for u in gis-store.service gis-pay.service gis-backup.service gis-backup.timer; do
    if [[ -e $SYSTEMD_DIR/$u ]] || systemctl list-unit-files --no-legend "$u" 2>/dev/null | grep -q "^$u"; then c+=("systemd unit $u pehle se hai"); fi
  done
  while read -r f; do [[ -n $f ]] && c+=("nginx file $f pehle se hai"); done < <(ngx_all_gis_files)
  if ((${#c[@]})); then
    printf '\n%s[ERROR]%s "gis" naam ki ye cheezein pehle se hain, lekin hamare installer ne nahi banayi (marker %s nahi mila):\n' "$C_RED$C_B" "$C_R" "$MARKER" >&2
    printf '   - %s\n' "${c[@]}" >&2
    printf '\n   Hum kisi doosre ki cheez overwrite nahi karte. Inhe check karo / hatao, phir dobara chalao.\n' >&2
    exit 1
  fi
  ok "koi takrav nahi"
}

check_nginx_mode() { # nginx mode ke pre-checks
  ngx_layout
  [[ $NGX_LAYOUT != unknown ]] || die "nginx.conf mein na sites-enabled na conf.d include hai (custom layout). Hum nginx.conf edit nahi karte — --proxy=none use karo aur snippet khud lagao."
  ngx_paths
  local hosts=() all exact wild
  mapfile -t hosts < <(our_hosts)
  all=$(ngx_name_conflicts "$APEX" "${hosts[@]}")
  exact=$(awk -F'\t' '$1=="E"{print "   " $2 "  (server_name " $3 ")"}' <<<"$all" | sort -u)
  wild=$(awk -F'\t' '$1=="W"{print $2 " (" $3 ")"}' <<<"$all" | sort -u | paste -sd' ')
  [[ -n $wild ]] && warn "wildcard server_name mila: $wild — hamare exact naam usse upar chalenge (nginx rule), koi problem nahi"
  TO_ACT=() TO_REFUSE=()
  if [[ -n $exact ]]; then
    if ((TAKE_OVER == 0)); then
      printf '\n%s[ERROR]%s Ye domain pehle se kisi purani nginx site par hai:\n%s\n' "$C_RED$C_B" "$C_R" "$exact" >&2
      printf '\n   Do jagah ek hi server_name = galat site khulegi, isliye ruk gaye (kuch nahi badla).\n' >&2
      printf '   Purani site hata ke nayi lagani hai? --take-over lagao: hum sirf yahi files backup karke disable karenge\n' >&2
      printf '   (fail par auto-restore; baad mein wapas: sudo gis-update restore-old-site). Pehle dekh lo: --dry-run --take-over\n' >&2
      exit 1
    fi
    mapfile -t TAKEN_HOSTS < <(awk -F'\t' '$1=="E"{print $3}' <<<"$all" | sort -u)
    takeover_plan "${hosts[@]}"
    if ((${#TO_REFUSE[@]})); then
      printf '\n%s[ERROR]%s --take-over nahi kar sakte:\n' "$C_RED$C_B" "$C_R" >&2
      printf '   - %s\n' "${TO_REFUSE[@]}" >&2
      printf '   Kuch nahi badla.\n' >&2
      exit 1
    fi
    ok "--take-over: ${#TO_ACT[@]} purani config(s) disable hongi:"
    takeover_describe | sed 's/^/      /'
  fi
  if [[ $NGINX_STATE == existing ]] && have nginx && ! nginx -t >/dev/null 2>&1; then
    die "Aapka nginx config ABHI se fail hai (nginx -t). Hum kuch nahi likhenge — pehle use theek karo."
  fi
  ngx_decide_http2
  ok "nginx: $NGINX_STATE, layout=$NGX_LAYOUT, http2=$NGX_HTTP2, files: $(basename "$NGX_STORE_FILE") $( [[ ${SRC_KIND[pay]} != none ]] && basename "$NGX_PAY_FILE") $(basename "$NGX_ZONES_FILE")"
}

NGX_HTTP2=listen NGX_IPV6=0 NGX_BROTLI=0
ngx_decide_http2() {
  local v others
  [[ -f /proc/net/if_inet6 ]] && NGX_IPV6=1
  if ls "$NGINX_DIR"/modules-enabled/ 2>/dev/null | grep -qi brotli; then NGX_BROTLI=1; fi   # sirf agar pehle se loaded
  v=$(nginx -v 2>&1 | sed -n 's#.*nginx/\([0-9.]*\).*#\1#p' || true)
  if version_ge "$v" 1.25.1; then NGX_HTTP2=directive; return 0; fi
  NGX_HTTP2=listen
  # nginx < 1.25.1: "listen 443 http2" poore socket par lagta hai → doosri sites ka protocol badal sakta hai
  others=$(ngx_dump_nongis | cut -f2 | grep -E '^[[:space:]]*listen[[:space:]][^;]*443' || true)
  if [[ -n $others ]] && grep -qv 'http2' <<<"$others"; then
    NGX_HTTP2=off
    warn "Doosri sites 443 par bina http2 ke hain (nginx $v) — unhe na badalne ke liye hamari sites par HTTP/2 off"
  fi
  return 0
}

# ---------------------------------------------------------------- ports
pick_port() { # want avoid → free port
  local want=$1 avoid=$2 p
  if [[ $want != "$avoid" ]] && ! port_in_use "$want"; then echo "$want"; return 0; fi
  for ((p = PORT_RANGE_START; p <= PORT_RANGE_END; p++)); do
    [[ $p == "$avoid" ]] && continue
    if ! port_in_use "$p"; then echo "$p"; return 0; fi
  done
  return 1
}

choose_ports() {
  step "Ports"
  BIND_HOST=${BIND_REQ:-${SAVED_BIND:-127.0.0.1}}
  if [[ -n $SAVED_STORE_PORT && -n $SAVED_PAY_PORT ]]; then
    STORE_PORT=$SAVED_STORE_PORT PAY_PORT=$SAVED_PAY_PORT
    ok "saved ports dobara use: store=$STORE_PORT pay=$PAY_PORT ($PORTS_FILE)"
    local app p pid our
    for app in store pay; do
      p=$(port_of "$app"); pid=$(port_owner_pid "$p")
      [[ -n $pid ]] || continue
      our=$(systemctl show -p MainPID --value "gis-$app" 2>/dev/null || echo 0)
      if [[ $pid != "$our" ]]; then warn "port $p (gis-$app) par ab koi aur process hai ($(listeners_on "$p"), pid $pid) — $PORTS_FILE badlo"; fi
    done
  else
    STORE_PORT=$(pick_port "$DEFAULT_STORE_PORT" '') || die "$PORT_RANGE_START-$PORT_RANGE_END mein koi port khaali nahi"
    PAY_PORT=$(pick_port "$DEFAULT_PAY_PORT" "$STORE_PORT") || die "$PORT_RANGE_START-$PORT_RANGE_END mein koi port khaali nahi"
    if [[ $STORE_PORT != "$DEFAULT_STORE_PORT" ]]; then warn "port $DEFAULT_STORE_PORT busy ($(listeners_on "$DEFAULT_STORE_PORT")) → store port $STORE_PORT"; fi
    if [[ $PAY_PORT != "$DEFAULT_PAY_PORT" ]]; then warn "port $DEFAULT_PAY_PORT busy ($(listeners_on "$DEFAULT_PAY_PORT")) → pay port $PAY_PORT"; fi
    ok "store=$BIND_HOST:$STORE_PORT  pay=$BIND_HOST:$PAY_PORT (save honge: $PORTS_FILE)"
  fi
  if [[ $PROXY_MODE == external ]] && is_docker_kind "$EXTERNAL_KIND" && [[ $BIND_HOST == 127.0.0.1 ]]; then
    warn "Proxy Docker mein hai ($EXTERNAL_KIND) — container se host ka 127.0.0.1 nahi dikhta. Zarurat ho to: install.sh --bind 172.17.0.1"
  fi
  return 0
}

# ---------------------------------------------------------------- packages (sirf missing, --no-upgrade)
PKGS_NEW=()
missing_pkgs() { local p; for p; do dpkg -s "$p" >/dev/null 2>&1 || echo "$p"; done; return 0; }

apt_simulate() { # → new packages print; upgrades/removals par roko
  local sim up rm new
  sim=$(apt-get -s -o Debug::NoLocking=1 install --no-upgrade --no-install-recommends "$@" 2>&1) || {
    warn "apt simulation fail: $(tail -n 2 <<<"$sim" | paste -sd' ')"; ((DRY)) && return 0; return 1; }
  new=$(grep -E '^Inst [^ ]+ \(' <<<"$sim" | awk '{print $2}' | paste -sd' ' || true)
  up=$(grep -E '^Inst [^ ]+ \[' <<<"$sim" | awk '{print $2}' | paste -sd' ' || true)
  rm=$(grep -E '^Remv ' <<<"$sim" | awk '{print $2}' | paste -sd' ' || true)
  info "naye packages (dependencies samet): ${new:-none}"
  if [[ -n $rm ]]; then
    ((DRY)) && { warn "apt ye packages HATANA chahta hai: $rm — asli run ruk jayega"; return 0; }
    die "apt ye installed packages HATANA chahta hai: $rm — ruk gaye (aapke system ko nahi chhedte)"
  fi
  if [[ -n $up ]]; then
    if ((ALLOW_DEP_UPGRADES)); then warn "dependency upgrade hoga (--allow-dep-upgrades): $up"
    elif ((DRY)); then warn "apt ye installed packages UPGRADE karega: $up — asli run ruk jayega (ya --allow-dep-upgrades)"
    else die "apt ye installed packages upgrade karna chahta hai: $up. Doosre apps toot sakte hain, isliye ruk gaye. Manzoor ho to --allow-dep-upgrades."; fi
  fi
  return 0
}

install_packages() {
  step "Packages (sirf jo missing hain, --no-upgrade; kabhi apt upgrade/autoremove nahi)"
  local want=(ca-certificates curl unzip sqlite3 openssl tar) missing=()
  if [[ ${SRC_KIND[store]} == git || ${SRC_KIND[pay]:-} == git ]]; then want+=(git openssh-client); fi
  if [[ $PROXY_MODE == nginx ]]; then
    ((NGINX_INSTALLED)) || want+=(nginx)
    if ((NO_SSL == 0)) && ! have certbot; then want+=(certbot); fi
  fi
  mapfile -t missing < <(missing_pkgs "${want[@]}")
  if ((${#missing[@]} == 0)); then ok "sab zaroori packages pehle se hain — kuch install nahi"; return 0; fi
  info "missing: ${missing[*]}"
  export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l NEEDRESTART_SUSPEND=1   # needrestart doosri services restart na kare
  if ((DRY)); then
    drymsg "apt-get update"
    apt_simulate "${missing[@]}"
    drymsg "apt-get install -y --no-upgrade --no-install-recommends ${missing[*]}"
    return 0
  fi
  apt-get -o DPkg::Lock::Timeout=600 update -q
  apt_simulate "${missing[@]}"
  apt-get -o DPkg::Lock::Timeout=600 install -y -q --no-upgrade --no-install-recommends "${missing[@]}"
  PKGS_NEW=("${missing[@]}")
  ok "installed: ${missing[*]}"
}

# ---------------------------------------------------------------- node (private copy)
install_node() {
  step "Node.js (system Node ko haath nahi lagate)"
  local sn
  if ((USE_SYSTEM_NODE)); then
    sn=$(command -v node || true)
    if [[ -z $sn ]] || ! node_version_ok "$sn"; then
      die "--system-node: system Node >= $NODE_MIN nahi mila ($("${sn:-node}" -v 2>/dev/null || echo none)). Flag hatao — private Node $OPT/node lagega."
    fi
    NODE_BIN=$sn; ok "system Node $("$sn" -v) use hoga ($sn) — upgrade nahi karenge"; return 0
  fi
  NODE_BIN=$NODE_LINK/bin/node
  if ((UPDATE_NODE == 0)) && node_version_ok "$NODE_BIN"; then ok "private Node $("$NODE_BIN" -v) ($NODE_LINK)"; return 0; fi
  sn=$(command -v node || true)
  [[ -n $sn ]] && info "system Node ($sn, $("$sn" -v 2>/dev/null || echo ?)) waise hi rahega"
  local arch base=https://nodejs.org/dist shas file ver sum dir tmp
  case $(uname -m) in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) die "CPU $(uname -m) support nahi (x64/arm64 chahiye)" ;; esac
  if [[ -n ${GIS_NODE_VERSION:-} ]]; then ver=v${GIS_NODE_VERSION#v}; shas=$(curl -fsSL --retry 3 "$base/$ver/SHASUMS256.txt" 2>/dev/null || true)
  else shas=$(curl -fsSL --retry 3 "$base/latest-v22.x/SHASUMS256.txt" 2>/dev/null || true); fi
  if [[ -z $shas ]]; then
    ((DRY)) && { drymsg "download Node 22 LTS ($arch) from $base (abhi nodejs.org nahi mila)"; return 0; }
    die "nodejs.org se SHASUMS256.txt nahi mila (internet/DNS check karo)"
  fi
  file=$(grep -oE "node-v[0-9]+\.[0-9]+\.[0-9]+-linux-$arch\.tar\.gz" <<<"$shas" | head -n1 || true)
  sum=$(awk -v f="$file" '$2==f{print $1}' <<<"$shas")
  [[ -n $file && $sum =~ ^[0-9a-f]{64}$ ]] || die "SHASUMS256.txt mein $arch tarball nahi mila"
  ver=${file#node-}; ver=${ver%-linux-*}
  dir=$OPT/node-$ver
  if ((DRY)); then drymsg "download $base/$ver/$file → sha256 verify → $dir, link $NODE_LINK"; return 0; fi
  if [[ ! -x $dir/bin/node ]]; then
    tmp=$(mktemp -d "$OPT/.node-dl-XXXXXX")
    curl -fSL --retry 3 -o "$tmp/$file" "$base/$ver/$file" || { rm -rf "$tmp"; die "Node download fail"; }
    (cd "$tmp" && printf '%s  %s\n' "$sum" "$file" | sha256sum -c --quiet -) || { rm -rf "$tmp"; die "Node tarball ka SHA256 match nahi hua — download kharab/badla hua"; }
    tar -xzf "$tmp/$file" -C "$tmp"
    mv "$tmp/node-$ver-linux-$arch" "$dir"
    rm -rf "$tmp"
    chown -R root:root "$dir"; chmod -R go-w "$dir"
  fi
  set_link "$dir" "$NODE_LINK"
  node_version_ok "$NODE_BIN" || die "private Node chal nahi raha: $NODE_BIN"
  local d cur
  cur=$(readlink -f "$NODE_LINK")
  for d in "$OPT"/node-v*; do [[ -d $d && $d != "$cur" ]] && rm -rf "$d"; done
  ok "private Node $("$NODE_BIN" -v) → $NODE_LINK (SHA256 verified)"
}

# ---------------------------------------------------------------- system (opt-in / opt-out)
setup_swap() {
  step "Swap"
  if ((NO_SWAP)); then info "--no-swap: kuch nahi kiya"; return 0; fi
  if [[ -n $(swapon --show --noheadings 2>/dev/null || true) ]]; then ok "swap pehle se hai — kuch nahi badla"; return 0; fi
  local size_mb=2048 free_mb
  free_mb=$(df -Pm / | awk 'NR==2{print $4}')
  ((free_mb < 15000)) && size_mb=1024
  if ((free_mb < 4000)); then warn "disk kam (${free_mb} MB) — swap nahi banaya"; return 0; fi
  if ((DRY)); then drymsg "create $SWAPFILE (${size_mb} MB), swapon, $FSTAB mein 1 line (# gis-swap)"; return 0; fi
  if [[ ! -f $SWAPFILE ]]; then
    fallocate -l "${size_mb}M" "$SWAPFILE" 2>/dev/null || dd if=/dev/zero of="$SWAPFILE" bs=1M count="$size_mb" status=none
    chmod 600 "$SWAPFILE"; mkswap "$SWAPFILE" >/dev/null
  fi
  if swapon "$SWAPFILE" 2>/dev/null; then
    grep -q '# gis-swap' "$FSTAB" 2>/dev/null || echo "$SWAPFILE none swap sw 0 0 # gis-swap" >>"$FSTAB"
    ok "BANAYA: $SWAPFILE (${size_mb} MB) + $FSTAB mein ek line '# gis-swap' (hatana: uninstall.sh --remove-swap)"
  else
    rm -f "$SWAPFILE"; warn "swapon nahi chala — swap ke bina"
  fi
}

tune_system() {
  ((TUNE)) || return 0
  step "--tune: journald cap + sysctl (system-wide)"
  printf '%s\n[Journal]\nSystemMaxUse=200M\nSystemKeepFree=1G\n' "$GIS_MARK" | write_file "$R/etc/systemd/journald.conf.d/90-gis.conf" 644
  printf '%s\nvm.swappiness = 10\nnet.core.somaxconn = 1024\n' "$GIS_MARK" | write_file "$R/etc/sysctl.d/90-gis.conf" 644
  run systemctl restart systemd-journald || warn "journald restart nahi hua"
  run sysctl -q -p "$R/etc/sysctl.d/90-gis.conf" || warn "sysctl apply nahi hua"
}

setup_user_dirs() {
  step "User '$GIS_USER' + folders"
  local created=0
  if ! id "$GIS_USER" >/dev/null 2>&1; then
    run useradd --system --home-dir "$VAR" --no-create-home --shell /usr/sbin/nologin "$GIS_USER"; created=1
  fi
  mkdir_owned 755 root:root "$OPT" "$REL" "$GIS_BIN_DIR"
  mkdir_owned 751 "root:$OWN" "$VAR"      # 751: nginx sirf acme folder tak pahunch sake
  mkdir_owned 750 "root:$OWN" "$ETC"
  mkdir_owned 755 root:root "$ACME_DIR"
  [[ -d $SBIN ]] || run mkdir -p "$SBIN"     # Ubuntu par hamesha hota hai; permissions nahi chhedte
  if [[ ! -f $MARKER ]]; then
    printf 'Get It Sasta install marker — is folder ki gis-* cheezein install.sh ne banayi.\ncreated=%s\ncreated_user=%s\n' "$(date -Is)" "$created" \
      | write_file "$MARKER" 644 root:root
  fi
  local app
  for app in store pay; do
    [[ ${SRC_KIND[$app]} == none ]] && continue
    mkdir_owned 750 "$OWN:$OWN" "$VAR/$app" "$VAR/$app/backups"
  done
  ok "$OPT (code), $VAR (data), $ETC (settings)"
}

# ---------------------------------------------------------------- git source
GIT_COMMIT=''
ensure_deploy_key() {
  url_is_ssh "$GIT_URL" || return 0
  if [[ ! -f $DEPLOY_KEY ]]; then
    if ((DRY)); then drymsg "ssh-keygen -t ed25519 → $DEPLOY_KEY (root-only, 600)"; return 0; fi
    have ssh-keygen || die "ssh-keygen nahi mila (openssh-client)"
    ssh-keygen -q -t ed25519 -N "" -C "gis-deploy@$(hostname)" -f "$DEPLOY_KEY"
    ok "deploy key bani: $DEPLOY_KEY"
  fi
  if ((DRY)); then return 0; fi
  chmod 600 "$DEPLOY_KEY"; chown root:root "$DEPLOY_KEY" "$DEPLOY_KEY.pub" 2>/dev/null || true
  local tries=0
  while ! gitx ls-remote -q "$GIT_URL" HEAD >/dev/null 2>&1; do
    if ((tries == 0)); then
      echo
      echo "${C_B}  GitHub par ye PUBLIC key Deploy key ke roop mein add karo (read-only):${C_R}"
      echo
      echo "    $(cat "$DEPLOY_KEY.pub")"
      echo
      echo "  GitHub → aapki repo → Settings → Deploy keys → Add deploy key"
      echo "    Title: gis-$(hostname)    Key: upar wali line    'Allow write access' TICK MAT karo → Add key"
      echo
    fi
    tries=$((tries + 1))
    if ! interactive; then
      echo "  Key add karke yahi command dobara chalao." >&2
      exit 3
    fi
    ((tries > 5)) && die "Repo access nahi mila. URL sahi hai? Key add hui? (test: sudo GIT_SSH_COMMAND=\"$(git_ssh_cmd)\" git ls-remote $GIT_URL)"
    read -r -p "    Key add karke Enter dabao (Ctrl+C = baad mein) " _ || true
  done
  ok "GitHub repo access OK (deploy key)"
}

setup_git_source() {
  [[ ${SRC_KIND[store]} == git || ${SRC_KIND[pay]} == git ]] || return 0
  step "GitHub source: $GIT_URL"
  GIT_URL_CTX=$GIT_URL
  if url_is_ssh "$GIT_URL"; then ensure_deploy_key
  else info "https repo — deploy key ki zarurat nahi"
    if ((DRY == 0)) && [[ ! -d $GIT_SRC/.git ]] && ! gitx ls-remote -q "$GIT_URL" HEAD >/dev/null 2>&1; then
      die "Repo nahi mila: $GIT_URL (URL sahi hai? repo public hai? Private repo ke liye git@github.com:USER/REPO.git + deploy key)"
    fi
  fi
  if [[ -d $GIT_SRC/.git ]]; then
    local origin
    origin=$(origin_url)
    [[ $(repo_id "$origin") == "$(repo_id "$GIT_URL")" ]] || die "$GIT_SRC ka origin '$origin' hai, aapne '$GIT_URL' diya. Galti se doosri repo na lage — check karo."
    info "$GIT_SRC pehle se isi repo ka clone hai — reuse (fetch + checkout)"
    if [[ $origin != "$GIT_URL" ]]; then run gitc remote set-url origin "$GIT_URL"; fi
    if ((DRY)); then drymsg "git fetch origin (in $GIT_SRC)"; else gitc fetch -q --prune --tags origin || die "git fetch fail (internet? private repo ho to deploy key)"; fi
  else
    if ((DRY)); then drymsg "git clone $GIT_URL → $GIT_SRC (deploy key se)"; GIT_COMMIT=dry-run; return 0; fi
    gitx clone -q ${GIT_BRANCH:+--branch "$GIT_BRANCH"} "$GIT_URL" "$GIT_SRC" || die "git clone fail"
    chmod 750 "$GIT_SRC"
    url_is_ssh "$GIT_URL" && gitc config core.sshCommand "$(git_ssh_cmd)"   # sirf is repo ka local config
  fi
  if [[ -z $GIT_BRANCH ]]; then
    GIT_BRANCH=$(gitc symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)
    GIT_BRANCH=${GIT_BRANCH:-main}
  fi
  GIT_COMMIT=$(git_resolve "$GIT_BRANCH") || die "branch/ref '$GIT_BRANCH' repo mein nahi mila"
  run gitc checkout -q -f --detach "$GIT_COMMIT"
  gitc cat-file -e "$GIT_COMMIT:store/package.json" 2>/dev/null || die "repo mein store/package.json nahi — layout: store/ pay/ deploy/"
  if [[ ${SRC_KIND[pay]} == git ]] && ! gitc cat-file -e "$GIT_COMMIT:pay/package.json" 2>/dev/null; then
    warn "repo mein pay/ nahi — Pay skip"; SRC_KIND[pay]=none
  fi
  ok "branch $GIT_BRANCH @ ${GIT_COMMIT:0:10}: $(gitc log -1 --format=%s "$GIT_COMMIT" | cut -c1-70)"
}

# ---------------------------------------------------------------- deploy
prepare_release() { # app → NEW_REL[app] (activate baad mein)
  local app=$1 kind=${SRC_KIND[$1]} cur rel=''
  WAS_INSTALLED[$app]=0
  [[ -f $SYSTEMD_DIR/gis-$app.service && -L $OPT/$app ]] && WAS_INSTALLED[$app]=1
  NEW_REL[$app]=''
  step "App code: $app ← $(src_label "$app")"
  cur=$(readlink -f "$OPT/$app" 2>/dev/null || true)
  case $kind in
    none) info "skip"; return 0 ;;
    keep) ok "jo installed hai wahi: $(basename "${cur:-?}")"; return 0 ;;
    zip)
      if [[ -n $cur && $(release_sha "$cur") == "$(sha256sum "${SRC_PATH[$app]}" | cut -d' ' -f1)" ]]; then ok "ye zip pehle se deployed — skip"; return 0; fi
      ((DRY)) && { drymsg "unzip + validate → $REL/$app-<time>-<sha>"; NEW_REL[$app]=dry; return 0; }
      rel=$(stage_release "$app" "${SRC_PATH[$app]}") || die "$app zip validate nahi hua — kuch nahi badla"
      ;;
    dir)
      ((DRY)) && { drymsg "copy ${SRC_PATH[$app]} → $REL/$app-<time>-<sha>"; NEW_REL[$app]=dry; return 0; }
      rel=$(stage_dir_release "$app" "${SRC_PATH[$app]}") || die "$app folder validate nahi hua — kuch nahi badla"
      if [[ -n $cur && $(release_commit "$cur") == "$(release_commit "$rel")" && $(release_commit "$rel") != dir:none ]]; then
        rm -rf "$rel"; ok "same commit pehle se deployed — skip"; return 0
      fi
      ;;
    git)
      if [[ -n $cur && $(deployed_commit "$app") == "$GIT_COMMIT" ]]; then ok "commit ${GIT_COMMIT:0:10} pehle se deployed — skip"; return 0; fi
      ((DRY)) && { drymsg "git archive $app/ @ ${GIT_COMMIT:0:10} → $REL/$app-<time>-<sha>"; NEW_REL[$app]=dry; return 0; }
      rel=$(stage_git_release "$app" "$GIT_COMMIT") || die "$app release nahi bana — kuch nahi badla"
      ;;
  esac
  NEW_REL[$app]=$rel
  ok "staged: $(basename "$rel")"
}

# ---------------------------------------------------------------- env files
NEW_STORE_PASS='' NEW_PAY_PASS=''
gen_password() { local p=''; while ((${#p} < 20)); do p+=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9'); done; printf '%s' "${p:0:20}"; }
app_on() { [[ ${SRC_KIND[$1]} != none ]]; }

write_env_files() {
  step "Settings ($ETC) — sirf agar missing hon"
  local f=$ETC/store.env pay_url=''
  app_on pay && pay_url="https://$PAY_DOMAIN"
  if [[ -f $f ]]; then
    ok "$f pehle se hai — chheda nahi"
    if [[ -n $pay_url ]] && grep -qE '^PAY_URL=\s*$' "$f"; then run sed -i "s#^PAY_URL=.*#PAY_URL=$pay_url#" "$f"; ok "khaali PAY_URL bhara: $pay_url"; fi
  else
    ((DRY)) && NEW_STORE_PASS='(dry-run)' || NEW_STORE_PASS=$(gen_password)
    write_file "$f" 640 "root:$OWN" <<EOF
# ==========================================================================
#  Get It Sasta (store) — settings. Badalne ke baad: sudo systemctl restart gis-store
#  HOST, PORT, DATA_DIR, TRUST_PROXY systemd unit mein fixed hain — yahan mat daalo.
#  Value mein space ho to "double quotes". Ye file kabhi git repo mein mat daalo.
# ==========================================================================
NODE_ENV=production
PUBLIC_URL=https://$DOMAIN
ADMIN_USERNAME=admin
# Sirf PEHLI baar start par admin banane ke liye. Baad mein panel se badlo.
ADMIN_PASSWORD=$NEW_STORE_PASS

# ---- Crypto: Get It Sasta Pay (Pay panel → Stores (API)) ----
# Webhook URL (Pay panel mein): https://$DOMAIN/api/pay/webhook
PAY_URL=$pay_url
PAY_API_KEY=
PAY_WEBHOOK_SECRET=

# ---- Emails + OTP login: Resend ----
RESEND_API_KEY=
MAIL_FROM="Get It Sasta <noreply@$APEX>"
ADMIN_EMAIL=

# ---- Telegram ----
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SUPPORT_BOT_TOKEN=
SUPPORT_CHAT_ID=
EOF
    ok "$f bana (naya admin password)"
  fi
  if app_on pay; then
    f=$ETC/pay.env
    if [[ -f $f ]]; then ok "$f pehle se hai — chheda nahi"
    else
      ((DRY)) && NEW_PAY_PASS='(dry-run)' || NEW_PAY_PASS=$(gen_password)
      write_file "$f" 640 "root:$OWN" <<EOF
# ==========================================================================
#  Get It Sasta Pay — settings (ALAG app, ALAG password). Badalne ke baad: sudo systemctl restart gis-pay
#  HOST, PORT, DATA_DIR, TRUST_PROXY systemd unit mein fixed hain.
# ==========================================================================
NODE_ENV=production
PUBLIC_URL=https://$PAY_DOMAIN
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$NEW_PAY_PASS
EOF
      ok "$f bana (naya admin password)"
    fi
  fi
  if [[ -n $NEW_STORE_PASS || -n $NEW_PAY_PASS ]] && ((DRY == 0)); then
    {
      [[ -f $CRED ]] && cat "$CRED"
      echo "# Get It Sasta — admin logins ($(date '+%Y-%m-%d %H:%M %z')). Login ke baad panel se badlo."
      [[ -n $NEW_STORE_PASS ]] && echo "Store admin: https://$DOMAIN/admin/      user: admin   password: $NEW_STORE_PASS"
      [[ -n $NEW_PAY_PASS ]] && echo "Pay admin:   https://$PAY_DOMAIN/admin/  user: admin   password: $NEW_PAY_PASS"
      echo
    } | write_file "$CRED" 600 root:root
  elif [[ -n $NEW_STORE_PASS || -n $NEW_PAY_PASS ]]; then drymsg "append admin passwords → $CRED (600)"; fi

  write_file "$PORTS_FILE" 644 root:root <<EOF
$GIS_MARK
# Re-run par yahi ports use honge. Badalna ho to yahan badlo, phir install.sh dobara chalao.
STORE_PORT=$STORE_PORT
PAY_PORT=$PAY_PORT
BIND_HOST=$BIND_HOST
EOF
  write_file "$CONF_FILE" 644 root:root <<EOF
$GIS_MARK
DOMAIN=$DOMAIN
EMAIL=$EMAIL
PROXY_MODE=$PROXY_MODE
EXTERNAL_KIND=$EXTERNAL_KIND
PAY_DOMAIN=$PAY_DOMAIN
NGINX_STATE=$NGINX_STATE
NODE_BIN=$NODE_BIN
GIT_URL=$GIT_URL
GIT_BRANCH=$GIT_BRANCH
WITH_PAY=$(app_on pay && echo 1 || echo 0)
PKGS_INSTALLED_BY_GIS=$(printf '%s ' "$(conf_get "$CONF_FILE" PKGS_INSTALLED_BY_GIS)" "${PKGS_NEW[@]}" | xargs -n1 2>/dev/null | sort -u | paste -sd' ' || true)
UPDATED=$(date -Is)
EOF
}

# ---------------------------------------------------------------- systemd
unit_file() {
  local app=$1 port desc
  port=$(port_of "$app")
  [[ $app == store ]] && desc="Get It Sasta — store" || desc="Get It Sasta Pay — crypto panel"
  cat <<EOF
$GIS_MARK
[Unit]
Description=$desc
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$GIS_USER
Group=$GIS_USER
WorkingDirectory=$OPT/$app
Environment=NODE_ENV=production
Environment=HOST=$BIND_HOST
Environment=PORT=$port
Environment=DATA_DIR=$VAR/$app
Environment=TRUST_PROXY=1
EnvironmentFile=$ETC/$app.env
ExecStart=$NODE_BIN --max-old-space-size=512 --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=3
TimeoutStopSec=15
SyslogIdentifier=gis-$app
MemoryHigh=600M
MemoryMax=700M
LimitNOFILE=65536
UMask=0027
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths=$VAR/$app
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF
}

backup_script() {
  local s
  s=$(cat <<'EOF'
#!/usr/bin/env bash
@MARK@
# Use: sudo gis-backup [store|pay|all]
#   store → @VAR@/store/backups/store-*.db        (src/backup.js, VACUUM INTO, 14 rakhta hai)
#   pay   → @VAR@/pay/backups/nightly-pay-*.db    (sqlite3 .backup, 14 rakhta hai)
set -euo pipefail
if [[ $(id -u) -eq 0 && @USER@ != root && -z ${GIS_BACKUP_CHILD:-} ]]; then exec runuser -u @USER@ -- env GIS_BACKUP_CHILD=1 "$0" "$@"; fi
what=${1:-all}
KEEP=14
NODE=@NODE@
stamp=$(TZ=Asia/Kolkata date +%Y-%m-%d-%H-%M-%S)
rc=0
backup_store() {
  local d=@VAR@/store
  if [[ ! -f $d/store.db ]]; then echo "store: database abhi nahi — skip"; return 0; fi
  (cd @OPT@/store && DATA_DIR=$d NODE_ENV=production "$NODE" --disable-warning=ExperimentalWarning src/backup.js)
}
backup_pay() {
  local d=@VAR@/pay out files=() i
  if [[ ! -f $d/pay.db ]]; then echo "pay: database abhi nahi — skip"; return 0; fi
  mkdir -p "$d/backups"
  out=$d/backups/nightly-pay-$stamp.db
  sqlite3 "$d/pay.db" ".timeout 15000" ".backup '$out'"
  if [[ $(sqlite3 "$out" 'PRAGMA integrity_check;') != ok ]]; then echo "pay: integrity check FAIL: $out" >&2; return 1; fi
  mapfile -t files < <(find "$d/backups" -maxdepth 1 -name 'nightly-pay-*.db' -printf '%f\n' | sort)
  for ((i = 0; i < ${#files[@]} - KEEP; i++)); do rm -f "$d/backups/${files[i]}"; done
  echo "Pay backup ban gaya: $out"
}
case $what in
  store) backup_store || rc=1 ;;
  pay)   backup_pay || rc=1 ;;
  all)   if [[ -e @OPT@/store ]]; then backup_store || rc=1; fi
         if [[ -e @OPT@/pay ]]; then backup_pay || rc=1; fi ;;
  *) echo "Use: gis-backup [store|pay|all]" >&2; exit 2 ;;
esac
exit "$rc"
EOF
)
  s=${s//@MARK@/$GIS_MARK}; s=${s//@VAR@/$VAR}; s=${s//@OPT@/$OPT}; s=${s//@USER@/$GIS_USER}; s=${s//@NODE@/$NODE_BIN}
  printf '%s\n' "$s"
}

write_if_changed() { # path mode owner < content → 0 agar badla
  local f=$1 content
  content=$(cat)
  if [[ -f $f && "$(cat "$f")" == "$content" ]]; then return 1; fi
  printf '%s\n' "$content" | write_file "$f" "$2" "$3"
  return 0
}

install_bin_scripts() { # deploy scripts → /opt/gis/bin, links in /usr/local/sbin
  local from=$SCRIPT_DIR f
  if [[ -n $GIT_COMMIT && $GIT_COMMIT != dry-run && -d $GIT_SRC/deploy ]]; then from=$GIT_SRC/deploy; fi
  for f in gis-common.sh install.sh update.sh uninstall.sh README-VPS.md; do
    [[ -f $from/$f ]] || continue
    [[ $(readlink -f "$from/$f") == "$(readlink -f "$GIS_BIN_DIR/$f" 2>/dev/null)" ]] && continue
    write_if_changed "$GIS_BIN_DIR/$f" 755 root:root <"$from/$f" || true
  done
  run ln -sfn "$GIS_BIN_DIR/update.sh" "$SBIN/gis-update"
}

setup_services() {
  step "systemd: gis-store, gis-pay, gis-backup.timer"
  local app cal
  for app in store pay; do
    UNIT_CHANGED[$app]=0
    app_on "$app" || continue
    if unit_file "$app" | write_if_changed "$SYSTEMD_DIR/gis-$app.service" 644 root:root; then UNIT_CHANGED[$app]=1; fi
  done
  backup_script | write_if_changed "$GIS_BIN_DIR/gis-backup" 755 root:root || true
  run ln -sfn "$GIS_BIN_DIR/gis-backup" "$SBIN/gis-backup"
  cal='*-*-* 03:30:00 Asia/Kolkata'
  systemd-analyze calendar "$cal" >/dev/null 2>&1 || cal='*-*-* 22:00:00 UTC'
  write_if_changed "$SYSTEMD_DIR/gis-backup.service" 644 root:root <<EOF || true
$GIS_MARK
[Unit]
Description=Get It Sasta — daily database backup
After=gis-store.service gis-pay.service

[Service]
Type=oneshot
User=$GIS_USER
Group=$GIS_USER
ExecStart=$GIS_BIN_DIR/gis-backup all
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$VAR
EOF
  write_if_changed "$SYSTEMD_DIR/gis-backup.timer" 644 root:root <<EOF || true
$GIS_MARK
[Unit]
Description=Get It Sasta — daily backup 03:30 IST

[Timer]
OnCalendar=$cal
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
EOF
  install_bin_scripts
  run systemctl daemon-reload
  for app in store pay; do app_on "$app" && run systemctl enable "gis-$app" >/dev/null 2>&1; done
  run systemctl enable --now gis-backup.timer >/dev/null 2>&1
  ok "units ready (backup: $cal)"
}

DEPLOY_FAILED=()
activate_apps() {
  step "Apps start / update"
  local app rel r
  for app in store pay; do
    app_on "$app" || continue
    rel=${NEW_REL[$app]}
    if ((DRY)); then
      [[ -n $rel ]] && drymsg "swap $OPT/$app → new release, restart gis-$app, health check, fail par auto-rollback" \
                    || drymsg "systemctl restart/start gis-$app (agar unit badla ya band hai)"
      continue
    fi
    if [[ -n $rel ]]; then
      if ((WAS_INSTALLED[$app])); then
        backup_app "$app" || warn "$app backup fail (aage badh rahe hain)"
        r=0; swap_and_verify "$app" "$rel" || r=$?
        ((r == 0)) || DEPLOY_FAILED+=("$app")
        continue
      fi
      activate_release "$app" "$rel"; prune_releases "$app"; record_commit "$app"
      systemctl restart "gis-$app" || warn "gis-$app start nahi hua"
    elif ((UNIT_CHANGED[$app])) || ! systemctl is-active --quiet "gis-$app"; then
      systemctl restart "gis-$app" || warn "gis-$app start nahi hua"
    fi
  done
}

HEALTH_STORE=0 HEALTH_PAY=0
health_checks() {
  step "Health check ($(health_host))"
  ((DRY)) && { drymsg "curl http://$(health_host):$STORE_PORT/healthz (+ pay :$PAY_PORT)"; return 0; }
  if wait_healthy "$STORE_PORT" 30; then HEALTH_STORE=1; ok "store :$STORE_PORT/healthz = ok"
  else warn "store health check fail — journalctl -u gis-store -n 50"; show_logs store; fi
  if app_on pay; then
    if wait_healthy "$PAY_PORT" 30; then HEALTH_PAY=1; ok "pay :$PAY_PORT/healthz = ok"
    else warn "pay health check fail — journalctl -u gis-pay -n 50"; show_logs pay; fi
  fi
  return 0
}

# ---------------------------------------------------------------- DNS
server_ips() { ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1; }
is_private_ip() { [[ $1 =~ ^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.) ]]; }
PUBLIC_IP=''
detect_public_ip() {
  local ip
  while read -r ip; do
    if [[ -n $ip ]] && ! is_private_ip "$ip"; then PUBLIC_IP=$ip; return 0; fi
  done < <(server_ips)
  PUBLIC_IP=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  [[ $PUBLIC_IP =~ ^[0-9.]+$ ]] || PUBLIC_IP=$(server_ips | head -n1)
  return 0
}
resolve_a() {
  local h=$1 out r
  if have dig; then
    for r in 1.1.1.1 8.8.8.8; do
      out=$(dig +short +time=3 +tries=1 A "$h" "@$r" 2>/dev/null | grep -E '^[0-9]+(\.[0-9]+){3}$' || true)
      [[ -n $out ]] && { printf '%s\n' "$out"; return 0; }
    done
  fi
  getent ahostsv4 "$h" 2>/dev/null | awk '{print $1}' | sort -u || true
}
dns_points_here() { # quiet=1 → warn nahi
  local h=$1 quiet=${2:-0} a mine ip
  a=$(resolve_a "$h")
  if [[ -z $a ]]; then ((quiet)) || warn "DNS: $h ka A record nahi mila"; DNS_NOTE="$h: A record nahi"; return 1; fi
  mine=$( { server_ips; echo "$PUBLIC_IP"; } | sort -u)
  while read -r ip; do
    if grep -qxF "$ip" <<<"$mine"; then DNS_NOTE="$h → $ip (ye server)"; return 0; fi
  done <<<"$a"
  DNS_NOTE="$h → $(paste -sd, <<<"$a") (ye server: $PUBLIC_IP)"
  ((quiet)) || warn "DNS: $DNS_NOTE"
  return 1
}

# ---------------------------------------------------------------- nginx (sirf hamari gis-* files)
STORE_SSL=0 WWW_SSL=0 PAY_SSL=0
cert_name_store() { echo "gis-$DOMAIN"; }
cert_name_pay() { echo "gis-$PAY_DOMAIN"; }  # alag naam: doosre certificates se kabhi takrav nahi
cert_has() { # certname host
  local f=$LE_DIR/live/$1/fullchain.pem
  [[ -f $f ]] || return 1
  openssl x509 -in "$f" -noout -text 2>/dev/null | grep -Eq "DNS:${2//./\\.}(,|\$|[[:space:]])"
}
detect_ssl_state() {
  STORE_SSL=0 WWW_SSL=0 PAY_SSL=0
  if cert_has "$(cert_name_store)" "$DOMAIN"; then STORE_SSL=1; fi
  if ((STORE_SSL)) && cert_has "$(cert_name_store)" "www.$DOMAIN"; then WWW_SSL=1; fi
  if app_on pay && cert_has "$(cert_name_pay)" "$PAY_DOMAIN"; then PAY_SSL=1; fi
  return 0
}

ngx_listen() { # 80|443
  local p=$1 s=''
  if [[ $p == 443 ]]; then s=' ssl'; [[ $NGX_HTTP2 == listen ]] && s=' ssl http2'; fi
  echo "    listen $p$s;"
  ((NGX_IPV6)) && echo "    listen [::]:$p$s;"
  [[ $p == 443 && $NGX_HTTP2 == directive ]] && echo "    http2 on;"
  return 0
}
ngx_ssl() {
  cat <<EOF
    ssl_certificate     $LE_DIR/live/$1/fullchain.pem;
    ssl_certificate_key $LE_DIR/live/$1/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
EOF
}
ngx_acme() { echo "    location ^~ /.well-known/acme-challenge/ { root $ACME_DIR; default_type \"text/plain\"; try_files \$uri =404; }"; }
ngx_common() {
  cat <<'EOF'
    server_tokens off;
    client_max_body_size 8m;
    limit_req_status 429;
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml application/javascript application/json application/xml image/svg+xml;
EOF
  if ((NGX_BROTLI)); then
    echo "    brotli on;"
    echo "    brotli_types text/plain text/css text/xml application/javascript application/json application/xml image/svg+xml;"
  fi
  cat <<'EOF'
    # App X-Forwarded-For ki AAKHRI value par bharosa karta hai → sirf $remote_addr (append nahi)
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_connect_timeout 5s;
    proxy_send_timeout 75s;
    proxy_read_timeout 75s;
    # Security headers (CSP, HSTS ...) app khud bhejta hai — yahan dobara nahi
EOF
}
ngx_locations() { # store|pay
  local up=gis_$1
  if [[ $1 == store ]]; then
    echo "    location ^~ /api/admin/login { limit_req zone=gis_login burst=5 nodelay;    proxy_pass http://$up; }"
    echo "    location ^~ /api/account/    { limit_req zone=gis_account burst=20 nodelay; proxy_pass http://$up; }"
  else
    echo "    location ^~ /api/admin/login { limit_req zone=gis_login burst=5 nodelay;    proxy_pass http://$up; }"
  fi
  cat <<EOF
    location /api/   { limit_req zone=gis_api burst=50 nodelay; proxy_pass http://$up; }
    location /assets/ {
        proxy_pass http://$up;
        expires \$gis_asset_expires;                 # sirf ?v= par 1y
        add_header Cache-Control \$gis_asset_cache;  # khaali = app ka header
    }
    location = /healthz { access_log off; proxy_pass http://$up; }
    location /          { proxy_pass http://$up; }
EOF
}
ngx_redirect() { # host port target [cert]
  echo "server {"; ngx_listen "$2"; echo "    server_name $1;"
  [[ -n ${4:-} ]] && ngx_ssl "$4"
  echo "    server_tokens off;"
  [[ $2 == 80 ]] && ngx_acme
  echo "    location / { return 301 $3\$request_uri; }"
  echo "}"
}
ngx_app() { # app host port [cert]
  echo "server {"; ngx_listen "$3"; echo "    server_name $2;"
  [[ -n ${4:-} ]] && ngx_ssl "$4"
  ngx_common
  [[ $3 == 80 ]] && ngx_acme
  ngx_locations "$1"
  echo "}"
}
ngx_zones_conf() {
  local ip
  echo "$GIS_MARK"
  echo "# http-level: sirf gis_ naam ke zones/maps (doosri sites par koi asar nahi)"
  echo "geo \$gis_limited {"
  echo "    default 1;"
  echo "    127.0.0.1/32 0;"
  echo "    ::1/128 0;"
  for ip in $NGX_EXEMPT_IPS; do echo "    $ip/32 0;"; done
  cat <<'EOF'
}
map $gis_limited $gis_limit_key { 0 ""; default $binary_remote_addr; }
limit_req_zone $gis_limit_key zone=gis_api:10m     rate=10r/s;
limit_req_zone $gis_limit_key zone=gis_login:10m   rate=10r/m;
limit_req_zone $gis_limit_key zone=gis_account:10m rate=30r/m;
map $arg_v $gis_asset_expires { default 1y; "" off; }
map $arg_v $gis_asset_cache   { default "public, max-age=31536000, immutable"; "" ""; }
EOF
}
ngx_store_conf() {
  echo "$GIS_MARK"
  echo "upstream gis_store { server $(health_host):$STORE_PORT; keepalive 16; }"
  echo
  if ((STORE_SSL)); then
    ngx_redirect "$DOMAIN" 80 "https://$DOMAIN"; echo
    ngx_app store "$DOMAIN" 443 "$(cert_name_store)"; echo
    ((IS_APEX)) && { ngx_redirect "www.$DOMAIN" 80 "https://$DOMAIN"; echo; }
    if ((IS_APEX && WWW_SSL)); then ngx_redirect "www.$DOMAIN" 443 "https://$DOMAIN" "$(cert_name_store)"; fi
  else
    ngx_app store "$DOMAIN" 80; echo
    if ((IS_APEX)); then ngx_redirect "www.$DOMAIN" 80 "http://$DOMAIN"; fi
  fi
  return 0
}
ngx_pay_conf() {
  echo "$GIS_MARK"
  echo "upstream gis_pay { server $(health_host):$PAY_PORT; keepalive 8; }"
  echo
  if ((PAY_SSL)); then
    ngx_redirect "$PAY_DOMAIN" 80 "https://$PAY_DOMAIN"; echo
    ngx_app pay "$PAY_DOMAIN" 443 "$(cert_name_pay)"
  else
    ngx_app pay "$PAY_DOMAIN" 80
  fi
}

NGX_EXEMPT_IPS=''
render_nginx_to() { # dir → gis files likho (test/dry ke liye bhi)
  local d=$1
  ngx_zones_conf >"$d/$(basename "$NGX_ZONES_FILE")"
  ngx_store_conf >"$d/gis-store.conf"
  if app_on pay; then ngx_pay_conf >"$d/gis-pay.conf"; fi
}

apply_nginx() {
  NGX_EXEMPT_IPS=$( { server_ips; echo "$PUBLIC_IP"; } | grep -E '^[0-9.]+$' | sort -u | paste -sd' ' || true)
  detect_ssl_state
  local tmp bak f
  tmp=$(mktemp -d)
  render_nginx_to "$tmp"
  if ((DRY)); then
    drymsg "nginx: likhenge (aur kuch nahi):"
    for f in "$NGX_ZONES_FILE" "$NGX_STORE_FILE" ${NGX_STORE_LINK:+"$NGX_STORE_LINK"}; do drymsg "  $f"; done
    if app_on pay; then for f in "$NGX_PAY_FILE" ${NGX_PAY_LINK:+"$NGX_PAY_LINK"}; do drymsg "  $f"; done; fi
    [[ -n $NGX_ZONES_LINK ]] && drymsg "  $NGX_ZONES_LINK"
    drymsg "  server_names: $(cat "$tmp"/*.conf | sed -n 's/^ *server_name \(.*\);/\1/p' | sort -u | paste -sd' ')"
    drymsg "nginx -t, phir systemctl reload nginx (restart/stop kabhi nahi)"
    rm -rf "$tmp"; return 0
  fi
  bak=$(mktemp -d)
  for f in "$NGX_ZONES_FILE" "$NGX_STORE_FILE" "$NGX_PAY_FILE"; do [[ -f $f ]] && cp -a "$f" "$bak/"; done
  install -m 644 "$tmp/$(basename "$NGX_ZONES_FILE")" "$NGX_ZONES_FILE"
  install -m 644 "$tmp/gis-store.conf" "$NGX_STORE_FILE"
  [[ -n $NGX_ZONES_LINK ]] && ln -sfn "$NGX_ZONES_FILE" "$NGX_ZONES_LINK"
  [[ -n $NGX_STORE_LINK ]] && ln -sfn "$NGX_STORE_FILE" "$NGX_STORE_LINK"
  if app_on pay; then
    install -m 644 "$tmp/gis-pay.conf" "$NGX_PAY_FILE"
    [[ -n $NGX_PAY_LINK ]] && ln -sfn "$NGX_PAY_FILE" "$NGX_PAY_LINK"
  fi
  rm -rf "$tmp"
  local out
  if ! out=$(nginx -t 2>&1); then
    printf '%s\n' "$out" | tail -n 8 >&2
    rm -f "$NGX_ZONES_FILE" "$NGX_STORE_FILE" "$NGX_PAY_FILE" ${NGX_ZONES_LINK:+"$NGX_ZONES_LINK"} ${NGX_STORE_LINK:+"$NGX_STORE_LINK"} ${NGX_PAY_LINK:+"$NGX_PAY_LINK"}
    local restored=0
    for f in "$bak"/*; do
      [[ -f $f ]] || continue
      case $(basename "$f") in
        gis-store.conf) cp -a "$f" "$NGX_STORE_FILE"; [[ -n $NGX_STORE_LINK ]] && ln -sfn "$NGX_STORE_FILE" "$NGX_STORE_LINK" ;;
        gis-pay.conf)   cp -a "$f" "$NGX_PAY_FILE";   [[ -n $NGX_PAY_LINK ]] && ln -sfn "$NGX_PAY_FILE" "$NGX_PAY_LINK" ;;
        *)              cp -a "$f" "$NGX_ZONES_FILE"; [[ -n $NGX_ZONES_LINK ]] && ln -sfn "$NGX_ZONES_FILE" "$NGX_ZONES_LINK" ;;
      esac
      restored=1
    done
    rm -rf "$bak"
    if ((${NGX_SOFT:-0})); then warn "hamari nginx config fail — hamari files purani/hata di"; return 1; fi
    if nginx -t >/dev/null 2>&1; then
      die "Hamari nayi nginx config fail hui (upar error). Hamari files $( ((restored)) && echo 'purane version par wapas' || echo 'hata di') — doosri sites pe koi asar nahi. nginx reload NAHI kiya."
    fi
    die "Hamari files hatane ke baad bhi nginx -t fail — aapka baaki config kharab hai (hamari wajah se nahi). nginx reload NAHI kiya."
  fi
  rm -rf "$bak"
  if systemctl is-active --quiet nginx; then systemctl reload nginx
  else warn "nginx band tha — start kar rahe hain"; systemctl start nginx; fi
  ok "nginx (reload): store=$STORE_SSL www=$WWW_SSL pay=$PAY_SSL ssl"
}

SSL_SKIPPED=()
obtain_certs() {
  if ((NO_SSL)); then mapfile -t SSL_SKIPPED < <(our_hosts); return 0; fi
  step "SSL (Let's Encrypt, webroot — sirf hamare domains, doosre certificates ko haath nahi)"
  local em=() names=() cb
  if [[ -n $EMAIL ]]; then em=(--email "$EMAIL"); else em=(--register-unsafely-without-email); fi
  cb=(certbot certonly --webroot -w "$ACME_DIR" --non-interactive --agree-tos "${em[@]}" --keep-until-expiring --expand --deploy-hook "systemctl reload nginx")
  if dns_points_here "$DOMAIN"; then
    names=(-d "$DOMAIN")
    if ((IS_APEX)); then
      if dns_points_here "www.$DOMAIN"; then names+=(-d "www.$DOMAIN"); else SSL_SKIPPED+=("www.$DOMAIN"); fi
    fi
    if run "${cb[@]}" --cert-name "$(cert_name_store)" "${names[@]}"; then ok "cert $(cert_name_store)"
    else warn "certbot fail ($DOMAIN)"; SSL_SKIPPED+=("$DOMAIN"); fi
  else mapfile -t SSL_SKIPPED < <(store_hosts); fi
  if app_on pay; then
    if dns_points_here "$PAY_DOMAIN"; then
      if run "${cb[@]}" --cert-name "$(cert_name_pay)" -d "$PAY_DOMAIN"; then ok "cert $(cert_name_pay)"
      else warn "certbot fail ($PAY_DOMAIN)"; SSL_SKIPPED+=("$PAY_DOMAIN"); fi
    else SSL_SKIPPED+=("$PAY_DOMAIN"); fi
  fi
  ((DRY)) && return 0
  apply_nginx || { ((${#TO_ACT[@]})) && takeover_abort "HTTPS nginx config fail"; die "HTTPS nginx config fail"; }
  detect_ssl_state
  if ((STORE_SSL)); then
    if certbot renew --dry-run --cert-name "$(cert_name_store)" >/dev/null 2>&1; then ok "auto-renew dry-run pass ($(cert_name_store))"
    else warn "certbot renew --dry-run fail — baad mein: sudo certbot renew --dry-run --cert-name $(cert_name_store)"; fi
  fi
  if ((STORE_SSL || PAY_SSL)) && ! systemctl is-enabled --quiet certbot.timer 2>/dev/null && ! have snap; then
    warn "certbot.timer enabled nahi dikh raha — auto-renew ke liye: sudo systemctl enable --now certbot.timer"
  fi
  return 0
}

# ---------------------------------------------------------------- take-over (purani site)
TO_ACT=() TO_REFUSE=() TAKEN_HOSTS=() TAKEOVER_DIR=''
remove_our_site_files() { # store|pay...
  local a
  for a; do
    if [[ $a == store ]]; then rm -f "$NGX_STORE_FILE" ${NGX_STORE_LINK:+"$NGX_STORE_LINK"}; fi
    if [[ $a == pay ]]; then rm -f "$NGX_PAY_FILE" ${NGX_PAY_LINK:+"$NGX_PAY_LINK"}; fi
  done
  return 0
}
takeover_abort() { # reason
  local why=$1
  warn "$why — purani site wapas laga rahe hain"
  remove_our_site_files store pay
  takeover_restore "$TAKEOVER_DIR" || true
  touch "$TAKEOVER_DIR/restored"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx || true
    die "$why. Purani site WAPAS chal rahi hai (backup: $TAKEOVER_DIR). Hamari apps sirf $(health_host) par chal rahi hain. Theek karke dobara: --take-over"
  fi
  die "$why. Restore ke baad bhi nginx -t fail — manual: $TAKEOVER_DIR/manifest dekho"
}

nginx_phase() {
  step "Nginx (sirf hamari gis-* files)"
  if ((${#TO_ACT[@]})); then
    ((DRY || HEALTH_STORE)) || die "Store healthy nahi — purani site ko haath NAHI lagaya. Pehle: journalctl -u gis-store -n 50"
    step "Take-over: purani site ki configs ($(printf '%s ' "${TAKEN_HOSTS[@]}"))"
    takeover_disable "${TAKEN_HOSTS[@]}"
    NGX_SOFT=1
    if ((DRY)); then apply_nginx; else apply_nginx || takeover_abort "nayi nginx config fail"; fi
  else
    apply_nginx
  fi
  firewall_step
  obtain_certs
  if ((${#TO_ACT[@]} && DRY == 0 && NO_SSL == 0 && STORE_SSL == 0)); then
    takeover_abort "SSL certificate nahi mila ($DOMAIN) — HTTPS ke bina purani site todna theek nahi"
  fi
  if ((${#TO_ACT[@]} && DRY == 0)); then
    ok "Take-over poora. Purani site wapas chahiye: sudo gis-update restore-old-site"
  fi
  return 0
}

restore_old_site() {
  step "Purani site wapas (restore-old-site)"
  [[ -f $MARKER ]] || die "gis install nahi mila"
  load_conf
  DOMAIN=$SAVED_DOMAIN; PAY_DOMAIN=$(conf_get "$CONF_FILE" PAY_DOMAIN)
  local dir act p n hosts ans a
  dir=$(cat "$ETC/takeover.last" 2>/dev/null || true)
  [[ -n $dir && -f $dir/manifest ]] || die "Koi take-over backup nahi mila ($ETC/takeover.last) — kuch nahi badla"
  [[ ! -f $dir/restored ]] || die "Ye backup pehle hi restore ho chuka hai ($dir)"
  hosts=$(paste -sd' ' "$dir/hosts")
  ngx_layout; ngx_paths
  info "Backup: $dir  (hosts: $hosts)"
  while IFS=$'\t' read -r act p n; do info "wapas enable: $p"; done <"$dir/manifest"
  local ours=(store)
  [[ " $hosts " == *" $PAY_DOMAIN "* ]] && ours+=(pay)
  info "hamari site config band: ${ours[*]} (copy → $dir/ours/; apps $(health_host) par chalti rahengi)"
  if ((DRY)); then drymsg "upar wala restore, phir nginx -t && systemctl reload nginx"; return 0; fi
  if [[ -t 0 && $ASSUME_YES == 0 ]]; then read -r -p "    Aage badhein? (y/n): " ans || true; [[ $ans =~ ^[Yy] ]] || die "Ruk gaye — kuch nahi badla."; fi
  mkdir -p "$dir/ours"
  for a in "${ours[@]}"; do
    if [[ $a == store && -f $NGX_STORE_FILE ]]; then cp -a "$NGX_STORE_FILE" "$dir/ours/"; fi
    if [[ $a == pay && -f $NGX_PAY_FILE ]]; then cp -a "$NGX_PAY_FILE" "$dir/ours/"; fi
  done
  remove_our_site_files "${ours[@]}"
  takeover_restore "$dir"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    touch "$dir/restored"
    ok "Purani site wapas chal rahi hai. Nayi site dobara: sudo bash $GIS_BIN_DIR/install.sh --take-over"
    return 0
  fi
  nginx -t 2>&1 | tail -n 5 >&2 || true
  while IFS=$'\t' read -r act p n; do      # undo: purani dobara disable, hamari wapas
    case $act in unlink) rm -f "$p" ;; rename|move) if [[ -e $p && ! -e $n ]]; then mv "$p" "$n"; fi ;; esac
  done <"$dir/manifest"
  for a in "$dir"/ours/*; do [[ -f $a ]] && cp -a "$a" "$(dirname "$NGX_STORE_FILE")/"; done
  if [[ -n $NGX_STORE_LINK && -f $NGX_STORE_FILE ]]; then ln -sfn "$NGX_STORE_FILE" "$NGX_STORE_LINK"; fi
  if [[ -n $NGX_PAY_LINK && -f $NGX_PAY_FILE ]]; then ln -sfn "$NGX_PAY_FILE" "$NGX_PAY_LINK"; fi
  die "Purani config ke saath nginx -t fail — kuch nahi badla (nayi site hi chal rahi hai). Purani config theek karo: $dir"
}

# ---------------------------------------------------------------- firewall
firewall_step() {
  step "Firewall"
  local active=0
  ufw_active && active=1
  if [[ $PROXY_MODE != nginx ]]; then info "proxy aapka web server/panel hai — firewall ko haath nahi lagaya"; return 0; fi
  if ((FIREWALL == 0)); then
    if ((active)) && ! ufw status 2>/dev/null | grep -qE '^(80|443|80,443)(/tcp)?[[:space:]].*ALLOW|Nginx (Full|HTTP)'; then
      warn "ufw active hai par 80/443 allow nahi dikh rahe. Chahiye to: sudo ufw allow 80/tcp && sudo ufw allow 443/tcp (ya --firewall)"
    else info "firewall ko haath nahi lagaya (ufw: $( ((active)) && echo active || echo 'inactive/not installed')). Hostinger hPanel firewall mein bhi 80/443 khule hon."; fi
    return 0
  fi
  if ((active == 0)); then info "--firewall: ufw active nahi hai — kuch nahi kiya (hum ufw enable nahi karte)"; return 0; fi
  run ufw allow 80/tcp >/dev/null
  run ufw allow 443/tcp >/dev/null
  ok "ufw: 80/tcp, 443/tcp allow (baaki rules/policy waise hi)"
}

# ---------------------------------------------------------------- external proxy snippets
upstream_host() { echo "$(health_host)"; }
snippet_apache() {
  local h; h=$(upstream_host)
  cat <<EOF
# Apache (mod_proxy). Pehle: sudo a2enmod proxy proxy_http headers
# File: /etc/apache2/sites-available/gis-store.conf → sudo a2ensite gis-store && sudo apachectl configtest && sudo systemctl reload apache2
<VirtualHost *:80>
    ServerName $DOMAIN
    ServerAlias www.$DOMAIN
    ProxyPreserveHost On
    ProxyTimeout 75
    LimitRequestBody 8388608
    RequestHeader set X-Forwarded-Proto "http"
    ProxyPass        / http://$h:$STORE_PORT/
    ProxyPassReverse / http://$h:$STORE_PORT/
</VirtualHost>
EOF
  app_on pay && cat <<EOF
<VirtualHost *:80>
    ServerName $PAY_DOMAIN
    ProxyPreserveHost On
    ProxyTimeout 75
    RequestHeader set X-Forwarded-Proto "http"
    ProxyPass        / http://$h:$PAY_PORT/
    ProxyPassReverse / http://$h:$PAY_PORT/
</VirtualHost>
EOF
  cat <<EOF
# SSL: sudo certbot --apache -d $DOMAIN -d www.$DOMAIN$(app_on pay && echo " -d $PAY_DOMAIN")
# (certbot 443 vhost banayega; usme X-Forwarded-Proto "https" kar dena)
EOF
}
snippet_caddy() {
  local h; h=$(upstream_host)
  cat <<EOF
# Caddyfile mein jodo, phir: sudo systemctl reload caddy   (SSL Caddy khud lagata hai)
$DOMAIN {
    request_body {
        max_size 8MB
    }
    reverse_proxy $h:$STORE_PORT {
        transport http {
            read_timeout 75s
        }
    }
}
www.$DOMAIN {
    redir https://$DOMAIN{uri} permanent
}
EOF
  app_on pay && cat <<EOF
$PAY_DOMAIN {
    reverse_proxy $h:$PAY_PORT
}
EOF
  return 0
}
snippet_traefik() {
  local h re
  h=$(upstream_host)
  re="^https?://www\\.${DOMAIN//./\\.}/(.*)"
  cat <<EOF
# Traefik dynamic file (file provider), jaise /etc/traefik/dynamic/gis.yml
# (Coolify: /data/coolify/proxy/dynamic/gis.yml · Dokploy: /etc/dokploy/traefik/dynamic/gis.yml)
# Labels sirf Docker containers ke liye hote hain — hamare apps systemd par hain, isliye file provider.
# Traefik Docker mein ho to apps ko --bind 172.17.0.1 se chalao aur neeche wahi IP rakho.
# entryPoints / certResolver ke naam apne Traefik config se milao.
http:
  routers:
    gis-store:
      rule: "Host(\`$DOMAIN\`)"
      entryPoints: [websecure]
      service: gis-store
      tls: { certResolver: letsencrypt }
    gis-www:
      rule: "Host(\`www.$DOMAIN\`)"
      entryPoints: [websecure]
      middlewares: [gis-www-redirect]
      service: gis-store
      tls: { certResolver: letsencrypt }
EOF
  app_on pay && cat <<EOF
    gis-pay:
      rule: "Host(\`$PAY_DOMAIN\`)"
      entryPoints: [websecure]
      service: gis-pay
      tls: { certResolver: letsencrypt }
EOF
  cat <<EOF
  middlewares:
    gis-www-redirect:
      redirectRegex:
        regex: '$re'
        replacement: "https://$DOMAIN/\${1}"
        permanent: true
  services:
    gis-store:
      loadBalancer:
        servers: [{ url: "http://$h:$STORE_PORT" }]
EOF
  app_on pay && cat <<EOF
    gis-pay:
      loadBalancer:
        servers: [{ url: "http://$h:$PAY_PORT" }]
EOF
  return 0
}
snippet_nginx_location() {
  local h; h=$(upstream_host)
  cat <<EOF
# Panel ke "custom nginx directives" / vhost mein (store site). Pay site mein port $PAY_PORT.
location / {
    proxy_pass http://$h:$STORE_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 75s;
    client_max_body_size 8m;
}
EOF
}
panel_steps() { # kind
  local h; h=$(upstream_host)
  local s="http://$h:$STORE_PORT" p="http://$h:$PAY_PORT"
  case $1 in
    cloudpanel) cat <<EOF
CloudPanel: Sites → Add Site → "Create a Reverse Proxy" → Domain: $DOMAIN, Reverse Proxy Url: $s
  → site → SSL/TLS → Actions → New Let's Encrypt Certificate (www bhi).  Pay ke liye: $PAY_DOMAIN → $p
EOF
    ;;
    aapanel) cat <<EOF
aaPanel: Website → Add site ($DOMAIN, www.$DOMAIN; PHP: static) → site Conf → Reverse proxy → Add
  → Target URL: $s, Sent Domain: \$host → SSL → Let's Encrypt.  Pay: $PAY_DOMAIN → $p
EOF
    ;;
    hestia|vesta) cat <<EOF
HestiaCP/VestaCP: Web → Add Web Domain ($DOMAIN, alias www.$DOMAIN). Proxy template ke liye:
  /usr/local/hestia/data/templates/web/nginx/ mein default.tpl/.stpl copy karke gis-store.tpl/.stpl banao,
  'location /' mein: proxy_pass $s;  → domain edit → Proxy Template: gis-store → SSL: Let's Encrypt.
  Pay: $PAY_DOMAIN → $p (gis-pay template)
EOF
    ;;
    cyberpanel) cat <<EOF
CyberPanel (OpenLiteSpeed): Websites → Create ($DOMAIN) → Manage → vHost Conf mein jodo:
  extprocessor gisstore { type proxy  address $h:$STORE_PORT  maxConns 100  initTimeout 75  retryTimeout 0 }
  context / { type proxy  handler gisstore  addDefaultCharset off }
  → Save → SSL → Issue SSL.  Pay: $PAY_DOMAIN → $h:$PAY_PORT
EOF
    ;;
    npm) cat <<EOF
Nginx Proxy Manager: Hosts → Proxy Hosts → Add → Domain: $DOMAIN, www.$DOMAIN · Scheme http
  · Forward Hostname: 172.17.0.1 (host gateway; apps ko --bind 172.17.0.1 se chalao) · Port $STORE_PORT
  · SSL tab: Request new certificate + Force SSL.  Pay: $PAY_DOMAIN → port $PAY_PORT
EOF
    ;;
    plesk) cat <<EOF
Plesk: Websites & Domains → Add Domain ($DOMAIN) → Apache & nginx Settings → "Additional nginx directives"
  mein neeche wala location block (proxy_pass $s) → SSL/TLS: Let's Encrypt.  Pay subdomain → $p
EOF
    ;;
    cpanel) cat <<EOF
cPanel/WHM: Apache include → /etc/apache2/conf.d/userdata/std/2_4/<user>/$DOMAIN/gis.conf aur .../ssl/2_4/... mein:
  ProxyPreserveHost On / ProxyPass / $s/ / ProxyPassReverse / $s/  → /scripts/rebuildhttpdconf && systemctl reload httpd. SSL: AutoSSL.
EOF
    ;;
    coolify|dokploy|traefik) echo "Traefik ($1): neeche wali dynamic file uske dynamic folder mein rakho; SSL Traefik ka certResolver karega." ;;
    caprover) echo "CapRover: apne nginx (captain) mein custom site ke liye 'nginx location' snippet use karo, ya simple: Docker proxy → --bind 172.17.0.1 + Traefik/NPM jaisa reverse proxy." ;;
    *) echo "Apne web server/panel mein reverse proxy banao: $DOMAIN (+www) → $s, $PAY_DOMAIN → $p. SSL wahi lagayega." ;;
  esac
}

write_snippets() {
  step "Reverse-proxy snippets (aapka $EXTERNAL_KIND 80/443 sambhalta hai — hum nginx install/bind NAHI karte)"
  mkdir_owned 755 root:root "$SNIPPET_DIR"
  snippet_apache | write_file "$SNIPPET_DIR/apache-gis.conf" 644
  snippet_caddy | write_file "$SNIPPET_DIR/Caddyfile-gis" 644
  snippet_traefik | write_file "$SNIPPET_DIR/traefik-gis.yml" 644
  snippet_nginx_location | write_file "$SNIPPET_DIR/nginx-location-gis.conf" 644
  panel_steps "$EXTERNAL_KIND" | write_file "$SNIPPET_DIR/panel-steps.txt" 644
  echo
  echo "${C_B}  Aapke setup ($EXTERNAL_KIND) ke liye:${C_R}"
  panel_steps "$EXTERNAL_KIND" | sed 's/^/    /'
  echo
  case $EXTERNAL_KIND in
    apache|cpanel) snippet_apache | sed 's/^/    /' ;;
    caddy) snippet_caddy | sed 's/^/    /' ;;
    traefik|coolify|dokploy|docker) snippet_traefik | sed 's/^/    /' ;;
    cloudpanel|aapanel|hestia|vesta|plesk|caprover|npm|cyberpanel) ;;
    *) snippet_nginx_location | sed 's/^/    /' ;;
  esac
  echo "    Sab snippets: $SNIPPET_DIR/   ·   SSL aapka panel/server lagayega (hum certbot nahi chalate)."
}

# ---------------------------------------------------------------- plan / doctor / summary
print_plan() {
  step "Plan${DRY:+ }$( ((DRY)) && echo '(DRY-RUN — kuch nahi badlega)')"
  info "Domain:   $DOMAIN$( ((IS_APEX)) && echo " (www → apex)")$(app_on pay && echo ", pay: $PAY_DOMAIN")"
  if ((${#TO_ACT[@]})); then info "TAKE-OVER: purani site configs (backup → $ETC/backup-nginx-<time>/, fail = auto-restore):"; takeover_describe | sed 's/^/              /'; fi
  info "Store:    $(src_label store)"
  info "Pay:      $(src_label pay)"
  info "Node:     $( ((USE_SYSTEM_NODE)) && echo "system $(command -v node || echo '?')" || echo "private $NODE_LINK (nodejs.org, SHA256 verified)")"
  info "Ports:    store $BIND_HOST:$STORE_PORT, pay $BIND_HOST:$PAY_PORT"
  info "Proxy:    $PROXY_MODE ($PROXY_REASON)$( [[ $PROXY_MODE == nginx ]] && echo " — nginx $NGINX_STATE, sirf gis-*.conf" || echo " — kind: $EXTERNAL_KIND, snippets milenge")"
  info "SSL:      $( ((NO_SSL)) && echo off || { [[ $PROXY_MODE == nginx ]] && echo "certbot webroot (cert: gis-$DOMAIN)" || echo "aapka panel/server"; })"
  info "Firewall: $( ((FIREWALL)) && echo "ufw active ho to sirf 80/443 allow" || echo "haath nahi lagayenge")"
  info "Swap:     $( ((NO_SWAP)) && echo skip || echo "sirf agar koi swap nahi → $SWAPFILE")   Tune: $( ((TUNE)) && echo on || echo off)"
  info "NAHI chhedenge: system Node, doosri nginx sites/nginx.conf, doosre certificates, ufw policy, apt upgrade/autoremove"
}

doctor() {
  step "Doctor — kya mila (kuch badla nahi)"
  load_conf
  local d=${DOMAIN:-$SAVED_DOMAIN} sn
  info "OS:        $(sed -n 's/^PRETTY_NAME=//p' "$R/etc/os-release" 2>/dev/null | tr -d '"')  · RAM $(free -m 2>/dev/null | awk '/Mem:/{print $2" MB"}') · swap: $(swapon --show --noheadings 2>/dev/null | awk '{print $1" "$3}' | paste -sd, || true)"
  sn=$(command -v node || true)
  info "Node:      system=${sn:-none} $([[ -n $sn ]] && "$sn" -v 2>/dev/null) $([[ -n $sn ]] && { node_version_ok "$sn" && echo '(>=22.13, --system-node possible)' || echo '(purana — use nahi karenge)'; })"
  info "           private=$( node_version_ok "$NODE_LINK/bin/node" && "$NODE_LINK/bin/node" -v || echo 'not installed')"
  decide_proxy_mode
  info "80/443:    ${WEB_OWNERS:-koi nahi}"
  info "Services:  ${WEB_ACTIVE[*]:-koi web server active nahi}"
  info "Panels:    ${PANELS[*]:-koi nahi}"
  info "→ Proxy:   $PROXY_MODE ($PROXY_REASON)${EXTERNAL_KIND:+, kind=$EXTERNAL_KIND}${NGINX_STATE:+, nginx=$NGINX_STATE}"
  if [[ $PROXY_MODE == nginx ]] && ((NGINX_INSTALLED)); then
    ngx_layout; ngx_paths
    info "nginx:     $(nginx -v 2>&1 | sed 's/.*: //') layout=$NGX_LAYOUT · config test: $(nginx -t >/dev/null 2>&1 && echo ok || echo FAIL)"
    if [[ -n $d ]]; then
      local c hosts=()
      DOMAIN=$d; SRC_KIND[store]=keep; SRC_KIND[pay]=keep; set_domains
      mapfile -t hosts < <(our_hosts)
      c=$(ngx_name_conflicts "$APEX" "${hosts[@]}" | awk -F'\t' '{print ($1=="E"?"exact":"wildcard") ": " $2 " (" $3 ")"}' | sort -u)
      info "Hosts:     ${hosts[*]}"
      info "Takrav:    ${c:-koi nahi}"
      if grep -q '^exact' <<<"$c"; then
        takeover_plan "${hosts[@]}"
        if ((${#TO_REFUSE[@]})); then printf '    --take-over REFUSE: %s\n' "${TO_REFUSE[@]}"
        else info "--take-over karega:"; takeover_describe | sed 's/^/              /'; fi
      fi
    fi
  fi
  local p
  for p in "$DEFAULT_STORE_PORT" "$DEFAULT_PAY_PORT"; do info "Port $p:  $(port_in_use "$p" && echo "busy ($(listeners_on "$p"))" || echo free)"; done
  [[ -f $PORTS_FILE ]] && info "Saved:     $(grep -E '^(STORE_PORT|PAY_PORT|BIND_HOST)=' "$PORTS_FILE" | paste -sd' ')"
  info "ufw:       $(have ufw && ufw status 2>/dev/null | head -n1 || echo 'not installed')"
  info "gis:       $( [[ -f $MARKER ]] && echo "installed (marker)" || echo "not installed")$(for a in store pay; do [[ -e $SYSTEMD_DIR/gis-$a.service ]] && printf ' · gis-%s=%s commit=%s' "$a" "$(systemctl is-active "gis-$a" 2>/dev/null || true)" "$(deployed_commit "$a" | cut -c1-12)"; done)"
  if [[ -n $d ]]; then
    detect_public_ip
    DOMAIN=$d; SRC_KIND[store]=keep; SRC_KIND[pay]=keep; set_domains
    for p in $(our_hosts); do dns_points_here "$p" 1 || true; info "DNS:       $DNS_NOTE"; done
  fi
}

summary() {
  local s_url p_url
  if [[ $PROXY_MODE == nginx ]]; then
    ((STORE_SSL)) && s_url="https://$DOMAIN" || s_url="http://$DOMAIN"
    ((PAY_SSL)) && p_url="https://$PAY_DOMAIN" || p_url="http://$PAY_DOMAIN"
  else s_url="https://$DOMAIN"; p_url="https://$PAY_DOMAIN"; fi
  echo
  echo "${C_B}${C_GRN}=====================================================================${C_R}"
  if ((DRY)); then echo "${C_B}  DRY-RUN khatam — kuch bhi nahi badla. Upar ka plan theek ho to --dry-run hata ke chalao.${C_R}"
    echo "${C_B}${C_GRN}=====================================================================${C_R}"; return 0; fi
  echo "${C_B}  Get It Sasta — installation poori hui${C_R}"
  echo "${C_B}${C_GRN}=====================================================================${C_R}"
  if ((HEALTH_STORE)); then echo "  ${C_GRN}Store chal raha hai:${C_R} $s_url  •  Admin: $s_url/admin/   (andar: $(health_host):$STORE_PORT)"
  else echo "  ${C_RED}Store abhi nahi chal raha${C_R} — journalctl -u gis-store -n 50"; fi
  [[ -n $NEW_STORE_PASS ]] && echo "    Admin user: admin  •  Admin password: ${C_B}$NEW_STORE_PASS${C_R}" || echo "    Admin password: pehle wala ($CRED)"
  if app_on pay; then
    if ((HEALTH_PAY)); then echo "  ${C_GRN}Pay chal raha hai:${C_R}   $p_url  •  Admin: $p_url/admin/   (andar: $(health_host):$PAY_PORT)"
    else echo "  ${C_RED}Pay abhi nahi chal raha${C_R} — journalctl -u gis-pay -n 50"; fi
    [[ -n $NEW_PAY_PASS ]] && echo "    Admin user: admin  •  Admin password: ${C_B}$NEW_PAY_PASS${C_R}" || echo "    Admin password: pehle wala ($CRED)"
  fi
  [[ -n $NEW_STORE_PASS || -n $NEW_PAY_PASS ]] && echo "  Passwords ek hi baar dikhte hain — copy kar lo. Saved: $CRED (sirf root)"
  ((${#DEPLOY_FAILED[@]})) && echo "  ${C_RED}Update fail (purana version chal raha hai):${C_R} ${DEPLOY_FAILED[*]}"
  [[ $(conf_get "$CONF_FILE" GIT_URL) ]] && echo "  Source: GitHub $(conf_get "$CONF_FILE" GIT_BRANCH) @ $(deployed_commit store | cut -c1-10)"
  echo
  echo "${C_B}  Aage kya karna hai:${C_R}"
  echo "  1. DNS (Hostinger → Domains → DNS records): A records @, www$(app_on pay && echo ', pay') → ${C_B}$PUBLIC_IP${C_R}"
  if [[ $PROXY_MODE == nginx ]]; then
    if ((${#SSL_SKIPPED[@]})); then
      echo "  2. ${C_YEL}SSL abhi in par nahi laga:${C_R} ${SSL_SKIPPED[*]} — DNS ke baad yahi command dobara chalao."
      echo "     (HTTPS ke bina admin login nahi hoga — production cookies 'Secure' hain)"
    else echo "  2. SSL laga hai (cert gis-$DOMAIN), auto-renew system certbot timer se."; fi
  else
    echo "  2. ${C_YEL}Reverse proxy + SSL apne $EXTERNAL_KIND mein lagao${C_R} — steps upar, files: $SNIPPET_DIR/"
  fi
  echo "  3. Settings: sudo nano $ETC/store.env  →  sudo systemctl restart gis-store"
  app_on pay && echo "              sudo nano $ETC/pay.env    →  sudo systemctl restart gis-pay"
  echo "  4. Logs: journalctl -u gis-store -f   ·   Status: sudo gis-update status"
  if [[ -n $(conf_get "$CONF_FILE" GIT_URL) ]]; then echo "  5. Update: GitHub par push → sudo gis-update pull"
  else echo "  5. Update: sudo gis-update store getitsasta.zip   (rollback: sudo gis-update rollback store)"; fi
  echo "  6. Backups roz 03:30 IST: $VAR/store/backups, $VAR/pay/backups  (abhi: sudo gis-backup)"
  echo "  Humne SIRF gis-* cheezein banayi. Doosri sites, nginx.conf, system Node, firewall policy waise hi hain."
  echo "  Hatana ho: sudo bash $GIS_BIN_DIR/uninstall.sh"
  if ((${#WARNINGS[@]})); then
    echo; echo "${C_YEL}  Dhyan do:${C_R}"; local w; for w in "${WARNINGS[@]}"; do echo "   - $w"; done
  fi
  echo "  Log: $LOG"
  echo "${C_B}${C_GRN}=====================================================================${C_R}"
}

# ---------------------------------------------------------------- main
main() {
  parse_args "$@"
  if ((CHECK)); then preflight; doctor; exit 0; fi
  if ((RESTORE_OLD)); then
    preflight
    exec 9>"$LOCK_FILE"; flock -n 9 || die "Doosra install/update chal raha hai"
    restore_old_site; exit 0
  fi
  preflight
  load_conf
  if ((DRY == 0)); then
    mkdir -p "$(dirname "$LOG")"; touch "$LOG"; chmod 600 "$LOG"
    exec > >(tee -a "$LOG") 2>&1
    echo "---- install.sh $(date -Is) ----"
    exec 9>"$LOCK_FILE"
    flock -n 9 || die "Doosra install/update chal raha hai — thodi der baad"
  fi
  gather_inputs
  namespace_guard
  decide_proxy_mode
  [[ $PROXY_MODE == nginx ]] && check_nginx_mode
  choose_ports
  detect_public_ip
  print_plan
  if interactive && ((DRY == 0)); then
    local a; a=$(ask "Aage badhein? (y/n)" y); [[ $a =~ ^[Yy] ]] || die "Ruk gaye — kuch nahi badla."
  fi

  install_packages
  setup_user_dirs
  install_node
  setup_swap
  tune_system
  setup_git_source
  prepare_release store
  prepare_release pay
  write_env_files
  setup_services
  activate_apps
  health_checks
  if [[ $PROXY_MODE == nginx ]]; then
    nginx_phase
  else
    write_snippets
    firewall_step
  fi
  summary
  ((${#DEPLOY_FAILED[@]} == 0))
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
