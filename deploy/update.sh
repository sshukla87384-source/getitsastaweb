#!/usr/bin/env bash
# ============================================================================
#  Get It Sasta — update / rollback   (install.sh ke baad: sudo gis-update ...)
#
#    sudo gis-update pull [store|pay|all] [--ref <branch|tag|sha>] [--force]   # GitHub se
#    sudo gis-update store getitsasta.zip                                       # zip se
#    sudo gis-update pay   getitsasta-pay.zip
#    sudo gis-update rollback store|pay                                         # pichhla version
#    sudo gis-update status                                                     # deployed vs GitHub
#    sudo gis-update restore-old-site [-y]                                      # --take-over se pehle wali site wapas
#
#  Har update: backup → release banao (validate, .env/*.db mana) → atomic swap
#  (/opt/gis/<app>.prev rakhta hai) → restart → health check → fail = auto-rollback.
# ============================================================================
set -euo pipefail
umask 022

SCRIPT_DIR=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
# shellcheck source=gis-common.sh
. "$SCRIPT_DIR/gis-common.sh" 2>/dev/null || { echo "gis-common.sh $SCRIPT_DIR mein nahi mila" >&2; exit 1; }

usage() { sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

check_app() {
  [[ $1 == store || $1 == pay ]] || die "App 'store' ya 'pay' hona chahiye (mila: '$1')"
  [[ -f $SYSTEMD_DIR/gis-$1.service ]] || die "gis-$1 installed nahi hai — pehle install.sh chalao"
}
installed() { [[ -f $SYSTEMD_DIR/gis-$1.service ]]; }

do_backup() {
  step "Backup pehle ($1)"
  if backup_app "$1"; then ok "backup ho gaya ($VAR/$1/backups)"
  elif [[ ${GIS_SKIP_BACKUP:-0} == 1 ]]; then warn "backup fail — GIS_SKIP_BACKUP=1 isliye aage"
  else die "backup fail, update roka. (Zabardasti: GIS_SKIP_BACKUP=1 sudo gis-update ...)"; fi
}

deploy_rel() { # app rel → swap + verify, message
  local app=$1 rel=$2 r=0
  step "Swap + restart gis-$app"
  swap_and_verify "$app" "$rel" || r=$?
  case $r in
    0) ok "gis-$app update ho gaya — $(basename "$rel")"; return 0 ;;
    1) warn "gis-$app update FAIL — purana version wapas chal raha hai. Logs: journalctl -u gis-$app -n 100"; return 1 ;;
    *) warn "gis-$app FAIL aur rollback bhi nahi chala! Backup: $VAR/$app/backups"; return 2 ;;
  esac
}

cmd_zip() {
  local app=$1 zip=${2:-} rel
  check_app "$app"
  [[ -n $zip ]] || die "Zip ka path do: sudo gis-update $app <zip>"
  [[ -f $zip ]] || die "Zip nahi mila: $zip"
  zip=$(readlink -f "$zip")
  node_version_ok "$NODE_BIN" || die "Node nahi mila ($NODE_BIN) — install.sh dobara chalao"
  do_backup "$app"
  step "Zip check: $(basename "$zip")"
  rel=$(stage_release "$app" "$zip") || die "zip validate nahi hua — kuch nahi badla"
  ok "staged: $(basename "$rel")"
  deploy_rel "$app" "$rel"
}

# ---------------------------------------------------------------- git pull
cmd_pull() {
  local which=all ref='' force=0 apps=() app old commit branch rel rc=0 updated=() n
  while (($#)); do
    case $1 in
      store|pay|all) which=$1; shift ;;
      --ref) ref=${2:-}; [[ -n $ref ]] || die "--ref ko value chahiye"; shift 2 ;;
      --ref=*) ref=${1#*=}; shift ;;
      --force) force=1; shift ;;
      *) die "pull: anjaan option '$1'" ;;
    esac
  done
  [[ -d $GIT_SRC/.git ]] || die "GitHub source nahi mila ($GIT_SRC). install.sh --git git@github.com:USER/REPO.git se install karo."
  node_version_ok "$NODE_BIN" || die "Node nahi mila ($NODE_BIN) — install.sh dobara chalao"
  branch=$(conf_get "$CONF_FILE" GIT_BRANCH); branch=${branch:-main}
  ref=${ref:-$branch}

  step "GitHub fetch ($(origin_url))"
  gitc fetch -q --prune --tags origin || die "git fetch fail — internet? (private git@ repo ho to GitHub par deploy key $DEPLOY_KEY.pub chahiye)"
  commit=$(git_resolve "$ref") || die "ref '$ref' nahi mila (branch / tag / commit sha do)"
  gitc checkout -q -f --detach "$commit"
  ok "$ref → ${commit:0:10}  $(gitc log -1 --format='%s (%an, %cr)' "$commit" | cut -c1-90)"

  case $which in all) apps=(store pay) ;; *) apps=("$which") ;; esac
  for app in "${apps[@]}"; do
    if ! installed "$app"; then [[ $which == all ]] || die "gis-$app installed nahi"; continue; fi
    old=$(deployed_commit "$app")
    if ((force == 0)) && [[ $old == "$commit" ]]; then ok "$app: pehle se ${commit:0:10} par"; continue; fi
    if ((force == 0)) && ! app_changed "$app" "$old" "$commit"; then
      ok "$app: $app/ folder mein koi badlav nahi (${old:0:10} → ${commit:0:10}) — skip"
      continue
    fi
    if ! gitc cat-file -e "$commit:$app/package.json" 2>/dev/null; then warn "$app: is commit mein $app/package.json nahi — skip"; rc=1; continue; fi
    if [[ $old =~ ^[0-9a-f]{40}$ ]] && gitc cat-file -e "$old^{commit}" 2>/dev/null; then
      n=$(gitc diff --name-only "$old" "$commit" -- "$app/" | wc -l); info "$app: $n files badli (${old:0:10} → ${commit:0:10})"
    fi
    do_backup "$app"
    step "Release: $app @ ${commit:0:10}"
    if ! rel=$(stage_git_release "$app" "$commit"); then warn "$app: release nahi bana — kuch nahi badla"; rc=1; continue; fi
    if deploy_rel "$app" "$rel"; then updated+=("$app"); else rc=1; fi
  done
  refresh_scripts "$commit"
  echo
  if ((${#updated[@]})); then ok "updated: ${updated[*]}"; else info "kuch update nahi hua"; fi
  return "$rc"
}

# Deploy scripts (/opt/gis/bin) ko is commit ke deploy/ se refresh karo (atomic mv — chalti script safe)
refresh_scripts() {
  local c=$1 f tmp changed=0
  for f in gis-common.sh update.sh uninstall.sh install.sh README-VPS.md; do
    gitc cat-file -e "$c:deploy/$f" 2>/dev/null || continue
    tmp=$(mktemp "$GIS_BIN_DIR/.gis-tmp.XXXXXX")
    gitc show "$c:deploy/$f" >"$tmp"
    if cmp -s "$tmp" "$GIS_BIN_DIR/$f"; then rm -f "$tmp"; continue; fi
    chmod 755 "$tmp"; mv -f "$tmp" "$GIS_BIN_DIR/$f"
    changed=1
    [[ $f == install.sh || $f == gis-common.sh ]] && NEED_INSTALL=1
  done
  ((changed)) && info "deploy scripts refresh: $GIS_BIN_DIR"
  if ((${NEED_INSTALL:-0})); then
    warn "deploy/ (install.sh) badla hai — systemd/nginx settings ke liye: sudo bash $GIS_BIN_DIR/install.sh"
  fi
  return 0
}

# ---------------------------------------------------------------- rollback / status
cmd_rollback() {
  local app=$1 cur prev
  check_app "$app"
  cur=$(readlink -f "$OPT/$app" 2>/dev/null || true)
  prev=$(readlink -f "$OPT/$app.prev" 2>/dev/null || true)
  [[ -n $prev && -d $prev ]] || die "Rollback ke liye pichhla version ($OPT/$app.prev) nahi hai"
  do_backup "$app"
  step "Rollback gis-$app: $(basename "$cur") → $(basename "$prev")"
  set_link "$prev" "$OPT/$app"
  set_link "$cur" "$OPT/$app.prev"     # dobara 'rollback' = wapas naya
  systemctl restart "gis-$app" || true
  if wait_healthy "$(port_of "$app")" 40; then
    record_commit "$app"
    ok "rollback ho gaya, health ok (commit $(deployed_commit "$app" | cut -c1-12))"
    info "Agar naye version ne database badla tha aur purana code error de, to backup restore karo (README-VPS.md)."
    return 0
  fi
  warn "Rollback version health check FAIL — wapas $(basename "$cur") par"
  show_logs "$app"
  set_link "$cur" "$OPT/$app"; set_link "$prev" "$OPT/$app.prev"
  systemctl restart "gis-$app" || true
  wait_healthy "$(port_of "$app")" 40 || true
  record_commit "$app"
  die "Rollback nahi hua (purana version start nahi hua)"
}

cmd_status() {
  local app cur prev dc origin='' branch behind
  branch=$(conf_get "$CONF_FILE" GIT_BRANCH); branch=${branch:-main}
  if [[ -d $GIT_SRC/.git ]]; then
    local -a envs=(GIT_TERMINAL_PROMPT=0)
    url_is_ssh "$(origin_url)" && envs+=("GIT_SSH_COMMAND=$(git_ssh_cmd)")
    timeout 20 env "${envs[@]}" git -c safe.directory="$GIT_SRC" -C "$GIT_SRC" fetch -q origin 2>/dev/null \
      || warn "GitHub fetch nahi hua — local info dikha rahe hain"
    origin=$(git_resolve "$branch" 2>/dev/null || true)
    printf '%sgit%s    origin/%s = %s  %s\n' "$C_B" "$C_R" "$branch" "${origin:0:10}" "$(gitc log -1 --format=%s "$origin" 2>/dev/null | cut -c1-60)"
  fi
  for app in store pay; do
    installed "$app" || continue
    cur=$(readlink -f "$OPT/$app" 2>/dev/null || echo -)
    prev=$(readlink -f "$OPT/$app.prev" 2>/dev/null || echo -)
    dc=$(deployed_commit "$app")
    behind=''
    if [[ -n $origin && $dc =~ ^[0-9a-f]{40}$ ]]; then
      if [[ $dc == "$origin" ]]; then behind='up to date'
      elif app_changed "$app" "$dc" "$origin"; then behind="$(gitc rev-list --count "$dc..$origin" -- "$app/" 2>/dev/null || echo '?') naye commits $app/ mein → sudo gis-update pull $app"
      else behind="origin aage hai par $app/ same"; fi
    fi
    printf '%s%-6s%s %-8s health=%-4s port=%s commit=%s %s\n' "$C_B" "$app" "$C_R" \
      "$(systemctl is-active "gis-$app" 2>/dev/null || true)" \
      "$(curl -fsS --max-time 3 "http://$(health_host):$(port_of "$app")/healthz" 2>/dev/null || echo FAIL)" \
      "$(port_of "$app")" "${dc:0:12}" "${behind:+($behind)}"
    printf '       current=%s  prev=%s\n' "$(basename "$cur")" "$(basename "$prev")"
  done
}

main() {
  [[ $# -ge 1 ]] || usage 1
  case $1 in -h|--help) usage 0 ;; esac
  [[ $(id -u) -eq 0 ]] || die "Root se chalao: sudo gis-update ..."
  load_conf
  case $1 in
    restore-old-site|switch-back) shift; exec bash "$SCRIPT_DIR/install.sh" --restore-old-site "$@" ;;
  esac
  if [[ $1 != status ]]; then
    exec 9>"$LOCK_FILE"
    flock -n 9 || die "Doosra install/update chal raha hai — thodi der baad"
  fi
  case $1 in
    pull)      shift; cmd_pull "$@" ;;
    store|pay) cmd_zip "$1" "${2:-}" ;;
    rollback)  [[ -n ${2:-} ]] || die "Kaunsa app? sudo gis-update rollback store"; cmd_rollback "$2" ;;
    status)    cmd_status ;;
    *) usage 1 ;;
  esac
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
