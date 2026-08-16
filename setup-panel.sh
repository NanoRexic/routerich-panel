#!/bin/sh
# RouteRich panel — router-side setup (uhttpd, dirs, optional jq)

set -e

PREFERRED_PORT="${1:-2020}"
PANEL_HOME="/www/routerich-panel"
CHOSEN_PORT=""

log() { printf '[setup] %s\n' "$1" >&2; }

port_listening() {
	port="$1"
	if command -v ss >/dev/null 2>&1; then
		ss -tuln 2>/dev/null | grep -q ":${port} " && return 0
	fi
	if command -v netstat >/dev/null 2>&1; then
		netstat -tuln 2>/dev/null | grep -q ":${port} " && return 0
	fi
	return 1
}

panel_owns_port() {
	port="$1"
	home=$(uci -q get uhttpd.panel.home 2>/dev/null)
	[ "$home" = "$PANEL_HOME" ] || return 1
	uci -q show uhttpd.panel 2>/dev/null | grep -qE "listen_http='[^']*:${port}'"
}

pick_port() {
	port="$1"
	if ! port_listening "$port"; then
		return 0
	fi
	if panel_owns_port "$port"; then
		log "Port $port already used by panel — reusing"
		return 0
	fi
	return 1
}

select_port() {
	for port in "$PREFERRED_PORT" 2021 8080 8888; do
		if pick_port "$port"; then
			CHOSEN_PORT="$port"
			return 0
		fi
	done
	return 1
}

ensure_jq() {
	if command -v jq >/dev/null 2>&1; then
		return 0
	fi
	log "jq not found, trying to install..."
	if command -v opkg >/dev/null 2>&1; then
		opkg update >/dev/null 2>&1 || true
		opkg install jq >/dev/null 2>&1 || true
	elif command -v apk >/dev/null 2>&1; then
		apk add --no-cache jq >/dev/null 2>&1 || true
	fi
	command -v jq >/dev/null 2>&1
}

mkdir -p "$PANEL_HOME/cgi-bin" /etc/routerich-panel/generated

if ! select_port; then
	printf 'ERROR: no free port for panel\n' >&2
	exit 1
fi

log "Panel port: $CHOSEN_PORT"

if ! command -v uci >/dev/null 2>&1; then
	printf 'ERROR: uci not found (not OpenWrt?)\n' >&2
	exit 1
fi

if ! ensure_jq; then
	log "Warning: jq not installed — Zapret API and AWG generation may not work"
fi

# LAN IPv4 only (+ localhost for installer/health checks). Never 0.0.0.0 / ::
collect_lan_listen_ips() {
	printf '%s\n' '127.0.0.1'
	uci -q get network.lan.ipaddr 2>/dev/null | while read -r item; do
		[ -n "$item" ] || continue
		printf '%s\n' "${item%%/*}"
	done
	dev=$(uci -q get network.lan.device 2>/dev/null)
	[ -z "$dev" ] && dev=$(uci -q get network.lan.ifname 2>/dev/null)
	if [ -n "$dev" ] && command -v ip >/dev/null 2>&1; then
		ip -4 -o addr show dev "$dev" 2>/dev/null | awk '{print $4}' | cut -d/ -f1
	fi
}

# Drop WAN → panel even if zone wan input=ACCEPT (fw4 traffic rule)
restrict_panel_from_wan() {
	port="$1"
	command -v uci >/dev/null 2>&1 || return 0
	if ! uci show firewall 2>/dev/null | grep -q "name='wan'"; then
		log "No firewall wan zone — skip WAN drop rule"
		return 0
	fi
	for s in panel_deny_wan wan_limit_panel wan_drop_panel; do
		uci -q delete "firewall.$s" 2>/dev/null || true
	done
	uci set firewall.panel_deny_wan=rule
	uci set firewall.panel_deny_wan.name='Deny-WAN-Panel'
	uci set firewall.panel_deny_wan.src='wan'
	uci set firewall.panel_deny_wan.proto='tcp'
	uci set firewall.panel_deny_wan.dest_port="$port"
	uci set firewall.panel_deny_wan.target='DROP'
	uci set firewall.panel_deny_wan.family='any'
	uci commit firewall
	if command -v fw4 >/dev/null 2>&1; then
		fw4 reload >/dev/null 2>&1 || true
	elif [ -x /etc/init.d/firewall ]; then
		/etc/init.d/firewall reload >/dev/null 2>&1 || true
	fi
	log "WAN drop rule for TCP $port"
}

uci -q delete uhttpd.panel 2>/dev/null || true
uci set uhttpd.panel=uhttpd
LAN_IPS=$(collect_lan_listen_ips | awk 'NF && !seen[$0]++')
bound=0
for ip in $LAN_IPS; do
	case "$ip" in
		0.0.0.0|::|::1) continue ;;
	esac
	uci add_list uhttpd.panel.listen_http="${ip}:${CHOSEN_PORT}"
	bound=1
done
if [ "$bound" -eq 0 ]; then
	log "No LAN IPv4 found — bind 127.0.0.1 only"
	uci add_list uhttpd.panel.listen_http="127.0.0.1:${CHOSEN_PORT}"
fi
uci set uhttpd.panel.home="$PANEL_HOME"
uci set uhttpd.panel.cgi_prefix='/cgi-bin'
uci set uhttpd.panel.script_timeout='120'
uci set uhttpd.panel.network_timeout='30'
uci set uhttpd.panel.tcp_keepalive='1'
uci set uhttpd.panel.max_requests='5'
uci set uhttpd.panel.max_connections='20'
uci set uhttpd.panel.rfc1918_filter='0'
uci commit uhttpd

restrict_panel_from_wan "$CHOSEN_PORT"

if [ -x /etc/init.d/uhttpd ]; then
	/etc/init.d/uhttpd restart >/dev/null 2>&1 || /etc/init.d/uhttpd start >/dev/null 2>&1 || true
fi

printf 'PANEL_PORT=%s\n' "$CHOSEN_PORT"
printf 'PANEL_URL=http://%s:%s/\n' "$(uci -q get network.lan.ipaddr 2>/dev/null | cut -d/ -f1 || hostname -I 2>/dev/null | awk '{print $1}')" "$CHOSEN_PORT"
exit 0