#!/bin/sh
# RouteRich panel — uninstall from OpenWrt
# Usage: wget -O - https://github.com/NanoRexic/routerich-panel/raw/refs/heads/main/uninstall.sh | sh

set -e

log() { printf '[uninstall] %s\n' "$1"; }

log "RouteRich panel uninstall"

log "Removing uhttpd.panel..."
uci -q delete uhttpd.panel 2>/dev/null || true
uci commit uhttpd 2>/dev/null || true

log "Removing WAN drop rule..."
for s in panel_deny_wan wan_limit_panel wan_drop_panel; do
	uci -q delete "firewall.$s" 2>/dev/null || true
done
uci commit firewall 2>/dev/null || true
if command -v fw4 >/dev/null 2>&1; then
	fw4 reload >/dev/null 2>&1 || true
elif [ -x /etc/init.d/firewall ]; then
	/etc/init.d/firewall reload >/dev/null 2>&1 || true
fi

log "Removing web files..."
rm -rf /www/routerich-panel

log "Removing panel data..."
rm -rf /etc/routerich-panel

log "Restarting uhttpd..."
if [ -x /etc/init.d/uhttpd ]; then
	/etc/init.d/uhttpd restart >/dev/null 2>&1 || true
fi

printf '\n=== Uninstall complete ===\n'
printf 'RouteRich panel removed.\n'

exit 0