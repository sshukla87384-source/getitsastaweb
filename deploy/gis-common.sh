# shellcheck shell=bash
# ============================================================================
#  Get It Sasta — shared helpers for install.sh / update.sh / uninstall.sh
#  Sirf "gis" naam wali cheezein chhoota hai. Is file ko seedha mat chalao.
# ============================================================================

# GIS_FSROOT sirf tests ke liye (fake root). Production mein khaali.
R=${GIS_FSROOT:-}
GIS_USER=${GIS_USER:-gis}
OPT=$R/opt/gis
REL=$OPT/releases
NODE_LINK=$OPT/node
GIS_BIN_DIR=$OPT/bin
VAR=$R/var/lib/gis
ACME_DIR=$VAR/acme
ETC=$R/etc/gis
MARKER=$ETC/.installed-by-gis
PORTS_FILE=$ETC/ports
CONF_FILE=$ETC/install.conf
SNIPPET_DIR=$ETC/proxy-snippets
CRED=$R/root/gis-credentials.txt
LOG=$R/var/log/gis-install.log
SYSTEMD_DIR=$R/etc/systemd/system
NGINX_DIR=$R/etc/nginx
LE_DIR=$R/etc/letsencrypt
SBIN=$R/usr/local/sbin
FSTAB=$R/etc/fstab
SWAPFILE=$R/swapfile-gis
LOCK_FILE=$R/run/gis-deploy.lock
DEFAULT_STORE_PORT=3000
DEFAULT_PAY_PORT=3100
PORT_RANGE_START=3300
PORT_RANGE_END=3399
NODE_MIN=22.13
GIS_MARK='# managed-by: gis-install (Get It Sasta) — hath se edit mat karo, install.sh dobara likhta hai'
DRY=${DRY:-0}

# ---------------------------------------------------------------- logging
if [[ -t 1 ]]; then
  C_R=$'\e[0m' C_B=$'\e[1m' C_RED=$'\e[31m' C_GRN=$'\e[32m' C_YEL=$'\e[33m' C_BLU=$'\e[34m' C_CYN=$'\e[36m'
else
  C_R='' C_B='' C_RED='' C_GRN='' C_YEL='' C_BLU='' C_CYN=''
fi
WARNINGS=()
step() { printf '\n%s==> %s%s\n' "$C_B$C_BLU" "$*" "$C_R"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s[OK]%s %s\n' "$C_GRN" "$C_R" "$*"; }
warn() { printf '    %s[WARN]%s %s\n' "$C_YEL" "$C_R" "$*" >&2; WARNINGS+=("$*"); }
die()  { printf '\n%s[ERROR]%s %s\n' "$C_RED$C_B" "$C_R" "$*" >&2; exit 1; }
drymsg() { printf '    %s[dry-run]%s %s\n' "$C_CYN" "$C_R" "$*"; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- dry-run aware mutations
# run cmd... → dry-run mein sirf print
run() {
  if ((DRY)); then drymsg "$*"; return 0; fi
  "$@"
}
# write_file path mode owner:group  < content
write_file() {
  local f=$1 mode=$2 own=${3:-root:root} tmp n
  if ((DRY)); then
    n=$(wc -l)
    if [[ -e $f ]]; then drymsg "update $f ($n lines, $mode $own)"; else drymsg "create $f ($n lines, $mode $own)"; fi
    return 0
  fi
  mkdir -p "$(dirname "$f")"
  tmp=$(mktemp "$(dirname "$f")/.gis-tmp.XXXXXX")
  cat >"$tmp"
  chmod "$mode" "$tmp"
  chown "$own" "$tmp"
  mv -f "$tmp" "$f"
}
mkdir_owned() { # mkdir_owned mode owner:group dir...
  local mode=$1 own=$2 d
  shift 2
  for d in "$@"; do
    if ((DRY)); then [[ -d $d ]] || drymsg "mkdir $d ($mode $own)"; continue; fi
    mkdir -p "$d"; chmod "$mode" "$d"; chown "$own" "$d"
  done
}

# ---------------------------------------------------------------- config (ports, node, domain)
conf_get() { # conf_get file KEY
  [[ -f $1 ]] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n1
}

load_conf() {
  SAVED_STORE_PORT=$(conf_get "$PORTS_FILE" STORE_PORT)
  SAVED_PAY_PORT=$(conf_get "$PORTS_FILE" PAY_PORT)
  SAVED_BIND=$(conf_get "$PORTS_FILE" BIND_HOST)
  STORE_PORT=${SAVED_STORE_PORT:-$DEFAULT_STORE_PORT}
  PAY_PORT=${SAVED_PAY_PORT:-$DEFAULT_PAY_PORT}
  BIND_HOST=${SAVED_BIND:-127.0.0.1}
  NODE_BIN=$(conf_get "$CONF_FILE" NODE_BIN)
  NODE_BIN=${NODE_BIN:-$NODE_LINK/bin/node}
  SAVED_DOMAIN=$(conf_get "$CONF_FILE" DOMAIN)
  SAVED_EMAIL=$(conf_get "$CONF_FILE" EMAIL)
  SAVED_PROXY_MODE=$(conf_get "$CONF_FILE" PROXY_MODE)
  return 0
}

port_of() { case $1 in store) echo "$STORE_PORT" ;; pay) echo "$PAY_PORT" ;; *) return 1 ;; esac; }
expected_pkg_name() { case $1 in store) echo getitsasta ;; pay) echo getitsasta-pay ;; esac; }
health_host() { [[ $BIND_HOST == 0.0.0.0 ]] && echo 127.0.0.1 || echo "$BIND_HOST"; }

version_ge() { # version_ge 1.24.0 1.25.1 → false
  [[ -n $1 && $(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1) == "$2" ]]
}
node_version_ok() { # node_version_ok /path/to/node
  local v
  [[ -x $1 ]] || return 1
  v=$("$1" -p 'process.versions.node' 2>/dev/null) || return 1
  version_ge "$v" "$NODE_MIN"
}

# ---------------------------------------------------------------- health + releases
wait_healthy() { # wait_healthy port [tries]
  local port=$1 tries=${2:-30} i body host
  host=$(health_host)
  for ((i = 0; i < tries; i++)); do
    body=$(curl -fsS --max-time 3 "http://$host:$port/healthz" 2>/dev/null || true)
    [[ $body == ok ]] && return 0
    sleep 1
  done
  return 1
}

validate_app_dir() {
  local app=$1 dir=$2 name want node=${NODE_BIN:-node}
  [[ -x $node ]] || node=node
  [[ -f $dir/server.js ]]    || { warn "$app: server.js nahi mila (zip ke root par hona chahiye)"; return 1; }
  [[ -f $dir/package.json ]] || { warn "$app: package.json nahi mila (zip ke root par hona chahiye)"; return 1; }
  name=$("$node" -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name||""))}catch(e){process.exit(3)}' "$dir/package.json") \
    || { warn "$app: package.json valid JSON nahi hai"; return 1; }
  want=$(expected_pkg_name "$app")
  if [[ $name != "$want" ]]; then
    if [[ ${GIS_FORCE:-0} == 1 ]]; then
      warn "$app: package.json name '$name' hai ('$want' chahiye tha) — GIS_FORCE=1 isliye aage badh rahe hain"
    else
      warn "$app: ye zip galat app ka lagta hai (package.json name '$name', chahiye '$want'). Sahi zip do, ya GIS_FORCE=1 lagao."
      return 1
    fi
  fi
  return 0
}

# Secret / database files jo kabhi deploy nahi hone chahiye
forbidden_files() { # dir → relative paths
  (cd "$1" && find . -type f \( -name .env -o \( -name '.env.*' ! -name '.env.example' ! -name '.env.sample' \) \
     -o -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' -o -name '*.sqlite' -o -name '*.sqlite3' \) -print 2>/dev/null \
     | sed 's#^\./##' | sort | head -n 20)
}

# src dir (tmp ke andar) ko validate karke $REL/<app>-<time>-<tag> banao. Path stdout par.
_finalize_release() { # app src tmp tag meta
  local app=$1 src=$2 tmp=$3 tag=$4 meta=$5 bad rel
  if ! validate_app_dir "$app" "$src"; then rm -rf "$tmp"; return 1; fi
  bad=$(forbidden_files "$src")
  if [[ -n $bad ]]; then
    rm -rf "$tmp"
    warn "SECURITY: $app mein secret/database files hain — deploy REFUSED: $(paste -sd' ' <<<"$bad")"
    warn "Inhe repo/zip se hatao (git rm --cached + .gitignore). Settings sirf $ETC/$app.env mein, data $VAR/$app mein."
    return 1
  fi
  rel=$REL/$app-$(date +%Y%m%d-%H%M%S)-$tag
  [[ -e $rel ]] && rel=$rel-$$
  mv "$src" "$rel"
  rm -rf "$tmp"
  printf '%s\nstaged=%s\n' "$meta" "$(date -Is)" >"$rel/.gis-release"
  chown -R root:root "$rel" 2>/dev/null || true
  chmod -R u=rwX,go=rX "$rel"
  printf '%s\n' "$rel"
}

_new_stage() { mkdir -p "$REL"; mktemp -d "$REL/.stage-$1-XXXXXX"; }

# Zip se release
stage_release() { # app zip
  local app=$1 zip=$2 sha tmp src entries=()
  [[ -f $zip ]] || { warn "zip nahi mila: $zip"; return 1; }
  unzip -tqq "$zip" >/dev/null 2>&1 || { warn "$zip kharab/adhoori zip hai (dobara upload karo)"; return 1; }
  sha=$(sha256sum "$zip" | cut -d' ' -f1)
  tmp=$(_new_stage "$app")
  if ! unzip -qq -o "$zip" -d "$tmp/x" >/dev/null 2>&1; then rm -rf "$tmp"; warn "$zip unzip nahi hua"; return 1; fi
  src=$tmp/x
  if [[ ! -f $src/package.json ]]; then   # folder hi zip ho gaya ho
    mapfile -t entries < <(find "$src" -mindepth 1 -maxdepth 1 ! -name '__MACOSX' ! -name '.DS_Store')
    if ((${#entries[@]} == 1)) && [[ -d ${entries[0]} && -f ${entries[0]}/package.json ]]; then src=${entries[0]}; fi
  fi
  _finalize_release "$app" "$src" "$tmp" "${sha:0:10}" "source=zip
zip=$(basename "$zip")
sha256=$sha
commit=zip:${sha:0:12}"
}

# Local folder se release (repo clone ka ../store, ../pay)
stage_dir_release() { # app dir
  local app=$1 dir=$2 tmp c='' tag=dir
  [[ -d $dir ]] || { warn "folder nahi mila: $dir"; return 1; }
  tmp=$(_new_stage "$app")
  mkdir -p "$tmp/x"
  tar -C "$dir" --exclude=.git --exclude=node_modules -cf - . | tar -C "$tmp/x" -xf -
  if have git && c=$(git -c safe.directory='*' -C "$dir" rev-parse HEAD 2>/dev/null); then tag=${c:0:10}; else c=''; fi
  _finalize_release "$app" "$tmp/x" "$tmp" "$tag" "source=dir
path=$dir
commit=dir:${c:-none}"
}

# Git commit se release (git archive = exactly us commit ki files)
stage_git_release() { # app commit
  local app=$1 commit=$2 tmp
  tmp=$(_new_stage "$app")
  mkdir -p "$tmp/x"
  if ! gitc archive --format=tar "$commit" "$app" | tar -C "$tmp/x" -xf -; then
    rm -rf "$tmp"; warn "git archive fail ($app @ ${commit:0:10}) — repo mein '$app/' folder hai?"; return 1
  fi
  _finalize_release "$app" "$tmp/x/$app" "$tmp" "${commit:0:10}" "source=git
commit=$commit"
}

release_commit() { sed -n 's/^commit=//p' "$1/.gis-release" 2>/dev/null || true; }
deployed_commit() { cat "$ETC/$1.commit" 2>/dev/null || true; }
record_commit() {
  local c
  c=$(release_commit "$(readlink -f "$OPT/$1")")
  printf '%s\n' "${c:-unknown}" | write_file "$ETC/$1.commit" 644 root:root
}

# ---------------------------------------------------------------- git (deploy key, kabhi ~/.ssh ya global config nahi)
GIT_SRC=$OPT/src
DEPLOY_KEY=$ETC/deploy_key
KNOWN_HOSTS=$ETC/known_hosts
git_ssh_cmd() { printf 'ssh -i %s -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=%s' "$DEPLOY_KEY" "$KNOWN_HOSTS"; }
gitx() { GIT_SSH_COMMAND=$(git_ssh_cmd) GIT_TERMINAL_PROMPT=0 git -c safe.directory="$GIT_SRC" "$@"; }
gitc() { gitx -C "$GIT_SRC" "$@"; }
url_is_ssh() { [[ $1 == git@* || $1 == ssh://* ]]; }
url_has_creds() { [[ $1 =~ ^https?://[^/]*@ ]]; }
git_resolve() { # branch/tag/sha → commit sha
  local ref=$1 c s
  for c in "refs/remotes/origin/$ref" "refs/tags/$ref" "$ref"; do
    if s=$(gitc rev-parse -q --verify "$c^{commit}" 2>/dev/null); then printf '%s\n' "$s"; return 0; fi
  done
  return 1
}
# app folder old..new ke beech badla? (old anjaan ho to "badla")
app_changed() { # app old new
  [[ $2 =~ ^[0-9a-f]{40}$ ]] || return 0
  gitc cat-file -e "$2^{commit}" 2>/dev/null || return 0
  ! gitc diff --quiet "$2" "$3" -- "$1/"
}

# ---------------------------------------------------------------- swap + health + auto-rollback
show_logs() { journalctl -u "gis-$1" -n 25 --no-pager 2>/dev/null || true; }

# swap_and_verify app rel → 0 ok | 1 fail, purana wapas | 2 fail, rollback bhi nahi chala
swap_and_verify() {
  local app=$1 rel=$2 old_cur old_prev port
  port=$(port_of "$app")
  old_cur=$(readlink -f "$OPT/$app" 2>/dev/null || true)
  old_prev=$(readlink -f "$OPT/$app.prev" 2>/dev/null || true)
  if [[ -n $old_cur && -d $old_cur && $old_cur != "$rel" ]]; then set_link "$old_cur" "$OPT/$app.prev"; fi
  set_link "$rel" "$OPT/$app"
  info "$OPT/$app → $(basename "$rel")"
  systemctl restart "gis-$app" || true
  if wait_healthy "$port" "${HEALTH_TRIES:-40}"; then
    prune_releases "$app"; record_commit "$app"; ok "gis-$app naya version healthy"; return 0
  fi
  warn "gis-$app: naya version health check mein FAIL"
  show_logs "$app"
  [[ -n $old_cur && -d $old_cur && $old_cur != "$rel" ]] || return 2
  step "Auto-rollback gis-$app → $(basename "$old_cur")"
  set_link "$old_cur" "$OPT/$app"
  if [[ -n $old_prev && -d $old_prev ]]; then set_link "$old_prev" "$OPT/$app.prev"; else rm -f "$OPT/$app.prev"; fi
  rm -rf "$rel"
  systemctl restart "gis-$app" || true
  if wait_healthy "$port" "${HEALTH_TRIES:-40}"; then record_commit "$app"; warn "gis-$app: purana version wapas chal raha hai"; return 1; fi
  show_logs "$app"
  return 2
}

backup_app() { # backup_app store|pay → gis-backup
  local b=$SBIN/gis-backup
  [[ -x $b ]] || b=$GIS_BIN_DIR/gis-backup
  [[ -x $b ]] || { warn "gis-backup nahi mila"; return 1; }
  "$b" "$1"
}

release_sha() { sed -n 's/^sha256=//p' "$1/.gis-release" 2>/dev/null || true; }

set_link() { # atomic symlink swap (rename(2))
  local target=$1 link=$2 tmpl
  tmpl="$(dirname "$link")/.$(basename "$link").$$"
  ln -sfn "$target" "$tmpl"
  mv -Tf "$tmpl" "$link"
}

activate_release() {
  local app=$1 rel=$2 cur
  cur=$(readlink -f "$OPT/$app" 2>/dev/null || true)
  if [[ -n $cur && -d $cur && $cur != "$rel" ]]; then set_link "$cur" "$OPT/$app.prev"; fi
  set_link "$rel" "$OPT/$app"
}

prune_releases() {
  local app=$1 cur prev d
  cur=$(readlink -f "$OPT/$app" 2>/dev/null || true)
  prev=$(readlink -f "$OPT/$app.prev" 2>/dev/null || true)
  for d in "$REL/$app"-*; do
    [[ -d $d ]] || continue
    [[ $d == "$cur" || $d == "$prev" ]] && continue
    rm -rf "$d"
  done
  return 0
}

# ---------------------------------------------------------------- detection (read-only)
# Port par kaun sun raha hai → process names ("nginx apache2"), ya "unknown"
listeners_on() {
  local out
  out=$(ss -Hltnp "sport = :$1" 2>/dev/null || true)
  [[ -n $out ]] || return 0
  local names
  names=$(grep -oE 'users:\(\("[^"]+"' <<<"$out" | sed -E 's/users:\(\("//; s/"$//' | sort -u | paste -sd' ' || true)
  printf '%s\n' "${names:-unknown}"
}
port_in_use() { [[ -n $(ss -Hltn "sport = :$1" 2>/dev/null || true) ]]; }
port_owner_pid() { ss -Hltnp "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -n1 | cut -d= -f2 || true; }

detect_panels() {
  PANELS=()
  if [[ -d $R/home/clp ]] || have clpctl; then PANELS+=(cloudpanel); fi
  if [[ -d $R/www/server/panel ]]; then PANELS+=(aapanel); fi
  if [[ -d $R/usr/local/hestia ]]; then PANELS+=(hestia); fi
  if [[ -d $R/usr/local/vesta ]]; then PANELS+=(vesta); fi
  if [[ -d $R/usr/local/CyberCP ]]; then PANELS+=(cyberpanel); fi
  if [[ -d $R/usr/local/psa || -d $R/opt/psa ]]; then PANELS+=(plesk); fi
  if [[ -d $R/usr/local/cpanel ]]; then PANELS+=(cpanel); fi
  if [[ -d $R/data/coolify ]]; then PANELS+=(coolify); fi
  if [[ -d $R/etc/dokploy ]]; then PANELS+=(dokploy); fi
  if [[ -d $R/captain ]]; then PANELS+=(caprover); fi
  if have docker; then
    local ps
    ps=$(timeout 5 docker ps --format '{{.Image}} {{.Names}}' 2>/dev/null || true)
    if grep -qi 'nginx-proxy-manager' <<<"$ps"; then PANELS+=(npm); fi
    if grep -qi 'captain-captain\|caprover/caprover' <<<"$ps" && [[ " ${PANELS[*]} " != *" caprover "* ]]; then PANELS+=(caprover); fi
    if grep -qiE '(^|[ /])traefik' <<<"$ps"; then DOCKER_TRAEFIK=1; fi
  fi
  return 0
}

detect_web() {
  DOCKER_TRAEFIK=${DOCKER_TRAEFIK:-0}
  WEB_OWNERS=$( { listeners_on 80; listeners_on 443; } | tr ' ' '\n' | grep -v '^$' | sort -u | paste -sd' ' || true)
  WEB_ACTIVE=()
  local s
  for s in nginx apache2 httpd caddy lighttpd lsws lshttpd openlitespeed traefik; do
    if systemctl is-active --quiet "$s" 2>/dev/null; then WEB_ACTIVE+=("$s"); fi
  done
  NGINX_INSTALLED=0
  if have nginx || dpkg -s nginx >/dev/null 2>&1 || dpkg -s nginx-core >/dev/null 2>&1; then NGINX_INSTALLED=1; fi
  return 0
}

web_kind() { # process/service name → kind
  case $1 in
    nginx) echo nginx ;;
    apache2|httpd|apache) echo apache ;;
    caddy) echo caddy ;;
    litespeed|lshttpd|lsws|openlitespeed|lsphp*) echo litespeed ;;
    traefik) echo traefik ;;
    docker-proxy|docker*|containerd*) echo docker ;;
    lighttpd) echo lighttpd ;;
    haproxy) echo haproxy ;;
    *) echo unknown ;;
  esac
}

# PROXY_REQ (auto|nginx|none) → PROXY_MODE=nginx|external, NGINX_STATE=existing|install, EXTERNAL_KIND
decide_proxy_mode() {
  local req=${PROXY_REQ:-auto} o others=() active_other=()
  detect_panels
  detect_web
  for o in $WEB_OWNERS; do [[ $(web_kind "$o") == nginx ]] || others+=("$o"); done
  for o in "${WEB_ACTIVE[@]}"; do [[ $o == nginx ]] || active_other+=("$o"); done
  PROXY_MODE='' NGINX_STATE='' EXTERNAL_KIND='' PROXY_REASON=''
  case $req in
    none)
      PROXY_MODE=external
      PROXY_REASON="--proxy=none"
      ;;
    nginx)
      ((${#PANELS[@]} == 0)) || die "Control panel mila (${PANELS[*]}) — uska nginx hum nahi chhedte. --proxy=none use karo aur panel mein reverse proxy banao."
      ((${#others[@]} == 0)) || die "Port 80/443 par pehle se '${others[*]}' chal raha hai — nginx wahan bind nahi kar sakta. --proxy=none use karo."
      PROXY_MODE=nginx
      PROXY_REASON="--proxy=nginx"
      ;;
    auto)
      if ((${#PANELS[@]})); then
        PROXY_MODE=external; PROXY_REASON="control panel: ${PANELS[*]}"
      elif ((${#others[@]})); then
        PROXY_MODE=external; PROXY_REASON="80/443 par: ${others[*]}"
      elif ((${#active_other[@]})); then
        PROXY_MODE=external; PROXY_REASON="web server service active: ${active_other[*]}"
      else
        PROXY_MODE=nginx
        if [[ -n $WEB_OWNERS ]]; then PROXY_REASON="80/443 par nginx (koi panel nahi)"
        elif ((NGINX_INSTALLED)); then PROXY_REASON="nginx installed, 80/443 khaali"
        else PROXY_REASON="80/443 khaali — nginx install karenge"; fi
      fi
      ;;
    *) die "--proxy sirf auto|nginx|none ho sakta hai (mila: $req)" ;;
  esac
  if [[ $PROXY_MODE == nginx ]]; then
    if ((NGINX_INSTALLED)); then NGINX_STATE=existing; else NGINX_STATE=install; fi
  else
    if ((${#PANELS[@]})); then EXTERNAL_KIND=${PANELS[0]}
    elif ((${#others[@]})); then EXTERNAL_KIND=$(web_kind "${others[0]}")
    elif ((${#active_other[@]})); then EXTERNAL_KIND=$(web_kind "${active_other[0]}")
    else EXTERNAL_KIND=unknown; fi
    if [[ $EXTERNAL_KIND == docker && ${DOCKER_TRAEFIK:-0} == 1 ]]; then EXTERNAL_KIND=traefik; fi
  fi
  return 0
}

is_docker_kind() { case $1 in docker|npm|coolify|dokploy|caprover|traefik) return 0 ;; *) return 1 ;; esac; }

# ---------------------------------------------------------------- nginx helpers (read-only)
# nginx -T se saari config, "file<TAB>line" — gis-* files chhod ke, comments hata ke
ngx_dump_nongis() {
  local dump
  if have nginx && dump=$(nginx -T 2>/dev/null); then
    awk '/^# configuration file /{f=$4; sub(/:$/,"",f); next}
         { if (f ~ /(^|\/)gis-[^\/]*$/) next; l=$0; sub(/#.*/,"",l); if (l ~ /[^[:space:]]/) print f "\t" l }' <<<"$dump"
    return 0
  fi
  # nginx -T nahi chala → files khud padho
  local f
  for f in "$NGINX_DIR"/sites-enabled/* "$NGINX_DIR"/conf.d/*.conf; do
    [[ -f $f ]] || continue
    [[ $(basename "$f") == gis-* ]] && continue
    awk -v f="$f" '{ l=$0; sub(/#.*/,"",l); if (l ~ /[^[:space:]]/) print f "\t" l }' "$f"
  done
  return 0
}

# Saare non-gis server_name tokens → "file<TAB>token"
ngx_server_names() {
  local f line t toks
  while IFS=$'\t' read -r f line; do
    [[ $line =~ server_name[[:space:]]+([^\;]*) ]] || continue
    read -ra toks <<<"${BASH_REMATCH[1]}"
    for t in "${toks[@]}"; do printf '%s\t%s\n' "$f" "${t,,}"; done
  done < <(ngx_dump_nongis)
  return 0
}

# Hamare hosts doosri config mein? → "E<TAB>file<TAB>host" (exact = asli takrav), "W<TAB>file<TAB>*.apex" (wildcard; exact naam jeet-ta hai)
ngx_name_conflicts() { # apex host...
  local apex=$1 f tok h
  shift
  while IFS=$'\t' read -r f tok; do
    if [[ $tok == ".$apex" || $tok == "*.$apex" ]]; then printf 'W\t%s\t%s\n' "$f" "$tok"; continue; fi
    for h in "$@"; do [[ $tok == "$h" ]] && printf 'E\t%s\t%s\n' "$f" "$tok"; done
  done < <(ngx_server_names)
  return 0
}

# --take-over plan: kaunsi purani files disable hongi. TO_ACT=("action<TAB>path<TAB>new"), TO_REFUSE=(msgs)
takeover_plan() { # host...
  TO_ACT=() TO_REFUSE=()
  local files=() f others
  mapfile -t files < <(ngx_name_conflicts "${APEX:-$1}" "$@" | awk -F'\t' '$1=="E"{print $2}' | sort -u)
  for f in "${files[@]}"; do
    [[ -n $f ]] || continue
    others=$(ngx_server_names | awk -F'\t' -v f="$f" '$1==f{print $2}' | sort -u | grep -vxF -f <(printf '%s\n' "$@") | paste -sd' ' || true)
    if [[ -n $others ]]; then
      TO_REFUSE+=("$f — is file mein doosre naam bhi hain ($others). Poori file disable karne se woh sites bhi band hongi. Khud edit karo: is file se sirf '$*' wale server { } blocks hatao/comment karo (ya naam server_name se nikaalo), 'sudo nginx -t && sudo systemctl reload nginx', phir install dobara chalao.")
      continue
    fi
    case $f in
      "$NGINX_DIR"/sites-enabled/*)
        if [[ -L $f ]]; then TO_ACT+=("unlink"$'\t'"$f"$'\t'"$(readlink "$f")")
        else TO_ACT+=("move"$'\t'"$f"$'\t'"$NGINX_DIR/sites-available/$(basename "$f").disabled-by-gis"); fi ;;
      "$NGINX_DIR"/conf.d/*.conf) TO_ACT+=("rename"$'\t'"$f"$'\t'"$f.disabled-by-gis") ;;
      *) TO_REFUSE+=("$f — sites-enabled/conf.d ke bahar se include hoti hai. Isme se '$*' wale blocks khud hatao, phir dobara chalao.") ;;
    esac
  done
  return 0
}

takeover_describe() { # TO_ACT ko human-readable print
  local a act p n
  for a in "${TO_ACT[@]}"; do
    IFS=$'\t' read -r act p n <<<"$a"
    case $act in
      unlink) echo "symlink hataenge (site file $n rahegi): $p" ;;
      rename) echo "rename: $p → $(basename "$n")" ;;
      move)   echo "move (sites-enabled se bahar): $p → $n" ;;
    esac
  done
  return 0
}

# Purani configs: backup + disable. Path: $ETC/backup-nginx-<ts>/ (manifest = original paths)
takeover_disable() { # host...
  ((${#TO_ACT[@]})) || return 0
  local dir a act p n
  dir=$ETC/backup-nginx-$(date +%Y%m%d-%H%M%S)
  local i=1 base=$dir
  while [[ -e $dir ]]; do dir=$base-$i; i=$((i + 1)); done   # har take-over ka alag backup
  if ((DRY)); then drymsg "backup → $dir/ (+ manifest)"; takeover_describe | while read -r l; do drymsg "$l"; done; return 0; fi
  mkdir -p "$dir"; chmod 700 "$dir"
  printf '%s\n' "$*" >"$dir/hosts"
  : >"$dir/manifest"
  for a in "${TO_ACT[@]}"; do
    IFS=$'\t' read -r act p n <<<"$a"
    [[ $act != unlink && -e $n ]] && die "$n pehle se hai — kuch nahi badla"
    cp -aL "$p" "$dir/$(tr '/' '_' <<<"${p#/}")"
    printf '%s\t%s\t%s\n' "$act" "$p" "$n" >>"$dir/manifest"
  done
  for a in "${TO_ACT[@]}"; do
    IFS=$'\t' read -r act p n <<<"$a"
    case $act in unlink) rm -f "$p" ;; rename|move) mv "$p" "$n" ;; esac
    info "disabled: $p"
  done
  printf '%s\n' "$dir" >"$ETC/takeover.last"
  TAKEOVER_DIR=$dir
  ok "purani site config(s) disable — backup: $dir"
}

# Manifest se purani configs wapas (sirf jo abhi missing hain)
takeover_restore() { # dir
  local dir=$1 act p n
  [[ -f $dir/manifest ]] || return 1
  while IFS=$'\t' read -r act p n; do
    case $act in
      unlink) [[ -e $p || -L $p ]] || ln -s "$n" "$p" ;;
      rename|move) if [[ ! -e $p && -e $n ]]; then mv "$n" "$p"; fi ;;
    esac
    info "restored: $p"
  done <"$dir/manifest"
  return 0
}

# nginx.conf ka layout: sites (sites-enabled include) ya confd
ngx_layout() {
  local conf=$NGINX_DIR/nginx.conf
  NGX_LAYOUT='' NGX_CONFD_INCLUDED=0
  if [[ ! -f $conf ]]; then NGX_LAYOUT=sites; NGX_CONFD_INCLUDED=1; return 0; fi   # abhi install hoga (Ubuntu layout)
  if grep -Eq '^[[:space:]]*include[[:space:]]+[^;]*conf\.d/' "$conf"; then NGX_CONFD_INCLUDED=1; fi
  if grep -Eq '^[[:space:]]*include[[:space:]]+[^;]*sites-enabled/' "$conf" && [[ -d $NGINX_DIR/sites-enabled ]]; then NGX_LAYOUT=sites
  elif ((NGX_CONFD_INCLUDED)); then NGX_LAYOUT=confd
  else NGX_LAYOUT=unknown; fi
  return 0
}

# Hamari nginx files ke paths (layout ke hisaab se)
ngx_paths() {
  if [[ $NGX_LAYOUT == sites ]]; then
    NGX_STORE_FILE=$NGINX_DIR/sites-available/gis-store.conf
    NGX_PAY_FILE=$NGINX_DIR/sites-available/gis-pay.conf
    NGX_STORE_LINK=$NGINX_DIR/sites-enabled/gis-store.conf
    NGX_PAY_LINK=$NGINX_DIR/sites-enabled/gis-pay.conf
  else
    NGX_STORE_FILE=$NGINX_DIR/conf.d/gis-store.conf
    NGX_PAY_FILE=$NGINX_DIR/conf.d/gis-pay.conf
    NGX_STORE_LINK='' NGX_PAY_LINK=''
  fi
  if ((NGX_CONFD_INCLUDED)); then NGX_ZONES_FILE=$NGINX_DIR/conf.d/gis-zones.conf; NGX_ZONES_LINK=''
  else NGX_ZONES_FILE=$NGINX_DIR/sites-available/gis-zones.conf; NGX_ZONES_LINK=$NGINX_DIR/sites-enabled/00-gis-zones.conf; fi
  return 0
}

# Sab jagah jahan hamari nginx files ho sakti hain (uninstall / guard ke liye)
ngx_all_gis_files() {
  local f
  for f in "$NGINX_DIR"/sites-available/gis-*.conf "$NGINX_DIR"/sites-enabled/gis-*.conf \
           "$NGINX_DIR"/sites-enabled/00-gis-zones.conf "$NGINX_DIR"/conf.d/gis-*.conf; do
    [[ -e $f || -L $f ]] && printf '%s\n' "$f"
  done
  return 0
}
is_our_file() { [[ -L $1 ]] || head -n 3 "$1" 2>/dev/null | grep -qF 'managed-by: gis-install'; }

ufw_active() { have ufw && ufw status 2>/dev/null | grep -q '^Status: active'; }
