#!/bin/sh
# RouteRich panel — router-side setup (uhttpd, dirs, optional jq)

set -e

PREFERRED_PORT="${1:-2020}"
PANEL_HOME="/www/routerich-panel"
CHOSEN_PORT=""

log() { printf '[setup] %s\n' "$1"; }

pick_port() {
	port="$1"
	if command -v ss >/dev/null 2>&1; then
		ss -tuln 2>/dev/null | grep -q ":${port} " && return 1
	fi
	if command -v netstat >/dev/null 2>&1; then
		netstat -tuln 2>/dev/null | grep -q ":${port} " && return 1
	fi
	return 0
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
	log "jq не найден, пробуем установить..."
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

log "Порт панели: $CHOSEN_PORT"

if ! command -v uci >/dev/null 2>&1; then
	printf 'ERROR: uci not found (not OpenWrt?)\n' >&2
	exit 1
fi

if ! ensure_jq; then
	log "Предупреждение: jq не установлен — Zapret API и генерация AWG могут не работать"
fi

uci -q delete uhttpd.panel 2>/dev/null || true
uci set uhttpd.panel=uhttpd
uci add_list uhttpd.panel.listen_http="0.0.0.0:${CHOSEN_PORT}"
uci set uhttpd.panel.home="$PANEL_HOME"
uci set uhttpd.panel.cgi_prefix='/cgi-bin'
uci set uhttpd.panel.script_timeout='120'
uci set uhttpd.panel.network_timeout='30'
uci set uhttpd.panel.tcp_keepalive='1'
uci set uhttpd.panel.max_requests='5'
uci set uhttpd.panel.max_connections='20'
uci set uhttpd.panel.rfc1918_filter='0'
uci commit uhttpd

if [ -x /etc/init.d/uhttpd ]; then
	/etc/init.d/uhttpd restart >/dev/null 2>&1 || /etc/init.d/uhttpd start >/dev/null 2>&1 || true
fi

printf 'PANEL_PORT=%s\n' "$CHOSEN_PORT"
printf 'PANEL_URL=http://%s:%s/\n' "$(uci -q get network.lan.ipaddr 2>/dev/null | cut -d/ -f1 || hostname -I 2>/dev/null | awk '{print $1}')" "$CHOSEN_PORT"
exit 0