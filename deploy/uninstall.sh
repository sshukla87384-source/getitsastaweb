#!/usr/bin/env bash
# ============================================================================
#  Get It Sasta — uninstall (SIRF gis-* cheezein hatata hai)
#
#    sudo bash uninstall.sh [--dry-run] [-y]
#        units gis-store / gis-pay / gis-backup.*, nginx gis-*.conf (phir nginx -t + reload),
#        /opt/gis (code, private Node, git clone), gis-update / gis-backup commands
#    --purge-data   + /var/lib/gis (DATABASE!), /etc/gis (settings, deploy key), user gis,
#                   gis-* SSL certificates, /root/gis-credentials.txt   (confirm maangega)
#    --remove-swap  + /swapfile-gis aur /etc/fstab ki '# gis-swap' line
#
#  Kabhi nahi: doosri nginx sites / nginx.conf, nginx/certbot packages, ufw rules, system Node.
# ============================================================================
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
# shellcheck source=gis-common.sh
. "$SCRIPT_DIR/gis-common.sh" 2>/dev/null || { echo "gis-common.sh $SCRIPT_DIR mein nahi mila" >&2; exit 1; }

PURGE=0 REMOVE_SWAP=0 YES=0
usage() { sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

rm_path() { # sirf gis paths
  local p
  for p; do
    [[ -e $p || -L $p ]] || continue
    case $p in
      "$OPT"|"$OPT"/*|"$VAR"|"$VAR"/*|"$ETC"|"$ETC"/*|"$SYSTEMD_DIR"/gis-*|"$SBIN"/gis-*|"$NGINX_DIR"/*/gis-*|"$NGINX_DIR"/sites-enabled/00-gis-zones.conf|"$SWAPFILE"|"$CRED") ;;
      *) die "BUG: '$p' gis path nahi — nahi hatayenge" ;;
    esac
    run rm -rf -- "$p"
    ((DRY)) || info "hataya: $p"
  done
  return 0
}

main() {
  while (($#)); do
    case $1 in
      --purge-data) PURGE=1 ;;
      --remove-swap) REMOVE_SWAP=1 ;;
      --dry-run) DRY=1 ;;
      -y|--yes) YES=1 ;;
      -h|--help) usage 0 ;;
      *) die "Unknown option: $1" ;;
    esac
    shift
  done
  [[ $(id -u) -eq 0 ]] || ((DRY)) || die "Root se chalao: sudo bash uninstall.sh"
  [[ -f $MARKER ]] || die "$MARKER nahi mila — ye server par hamara install nahi dikhta. Kuch nahi hataya."
  load_conf
  local domain=$SAVED_DOMAIN a f nginx_files=() pk
  pk=$(conf_get "$CONF_FILE" PKGS_INSTALLED_BY_GIS)

  mapfile -t nginx_files < <(ngx_all_gis_files)
  step "Uninstall plan$( ((DRY)) && echo ' (DRY-RUN — kuch nahi badlega)')"
  info "Services: gis-store gis-pay gis-backup.timer (stop + disable + unit files)"
  info "Nginx:    ${nginx_files[*]:-koi gis file nahi}"
  info "Code:     $OPT (releases, private Node, git clone), $SBIN/gis-update, $SBIN/gis-backup"
  if ((PURGE)); then info "${C_RED}PURGE:${C_R}    $VAR (database + backups!), $ETC (env, deploy key), user $GIS_USER, certs gis-$domain gis-pay.$domain, $CRED"
  else info "Rakhenge: $VAR (database/backups), $ETC (settings) — reinstall par wahi data milega. Hatane ke liye --purge-data"; fi
  ((REMOVE_SWAP)) && info "Swap:     $SWAPFILE + fstab line" || info "Swap:     $SWAPFILE rahega (--remove-swap se hatao)"
  info "Nahi chhedenge: doosri sites, nginx.conf, nginx/certbot packages, ufw rules, system Node"

  if ((DRY == 0 && YES == 0)); then
    local ans
    read -r -p "    Aage badhein? 'yes' likho: " ans || true
    [[ $ans == yes ]] || die "Ruk gaye — kuch nahi hataya."
    if ((PURGE)); then
      read -r -p "    DATABASE bhi delete hoga! Pakka? domain '$domain' likho: " ans || true
      [[ -n $domain && $ans == "$domain" ]] || die "Ruk gaye — kuch nahi hataya."
    fi
  fi

  step "Services band"
  for a in gis-store gis-pay gis-backup.timer gis-backup; do
    if [[ -e $SYSTEMD_DIR/$a.service || -e $SYSTEMD_DIR/$a || -e $SYSTEMD_DIR/$a.timer ]]; then
      run systemctl disable --now "$a" >/dev/null 2>&1 || true
    fi
  done
  rm_path "$SYSTEMD_DIR/gis-store.service" "$SYSTEMD_DIR/gis-pay.service" "$SYSTEMD_DIR/gis-backup.service" "$SYSTEMD_DIR/gis-backup.timer"
  run systemctl daemon-reload
  run systemctl reset-failed gis-store gis-pay gis-backup >/dev/null 2>&1 || true

  step "Nginx (sirf gis-* files)"
  if ((${#nginx_files[@]})); then
    for f in "${nginx_files[@]}"; do
      if is_our_file "$f"; then rm_path "$f"; else warn "$f mein hamara marker nahi — chhod diya"; fi
    done
    if have nginx && ((DRY == 0)); then
      if nginx -t >/dev/null 2>&1; then
        systemctl is-active --quiet nginx && systemctl reload nginx
        ok "nginx -t ok, reload"
      else warn "nginx -t fail (hamari files ke bina bhi) — reload NAHI kiya; 'sudo nginx -t' dekho"; fi
    else drymsg "nginx -t && systemctl reload nginx"; fi
  else info "koi gis nginx file nahi"; fi

  step "Code + commands"
  rm_path "$SBIN/gis-update" "$SBIN/gis-backup" "$OPT"

  if ((PURGE)); then
    step "Purge data"
    if have certbot; then
      for a in "gis-$domain" "gis-pay.$domain"; do
        [[ -n $domain && -d $LE_DIR/live/$a ]] && { run certbot delete --non-interactive --cert-name "$a" >/dev/null 2>&1 || warn "cert $a delete nahi hua"; }
      done
    fi
    rm_path "$VAR" "$CRED"
    if id "$GIS_USER" >/dev/null 2>&1 && grep -q '^created_user=1' "$MARKER" 2>/dev/null; then run userdel "$GIS_USER" || warn "userdel $GIS_USER fail"; fi
    rm_path "$ETC"
  else
    info "$VAR aur $ETC rakhe (marker bhi) — reinstall: sudo bash install.sh ..."
  fi

  if ((REMOVE_SWAP)) && [[ -f $SWAPFILE ]]; then
    step "Swap"
    run swapoff "$SWAPFILE" || true
    run sed -i '/# gis-swap$/d' "$FSTAB"
    rm_path "$SWAPFILE"
  fi

  echo
  ok "Uninstall poora$( ((DRY)) && echo ' (dry-run: kuch nahi badla)')."
  info "ufw rules (80/443) jo humne add kiye the, chhod diye — doosri sites unpe chal sakti hain. Hatana ho: sudo ufw delete allow 80/tcp ; sudo ufw delete allow 443/tcp"
  [[ -n $pk ]] && info "Ye packages humne install kiye the, chhod diye (doosre bhi use kar sakte hain): $pk"
  return 0
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
