#!/bin/sh
# RouteRich panel — install on OpenWrt (download from GitHub)
# Usage: wget -O - https://github.com/NanoRexic/routerich-panel/raw/refs/heads/main/install.sh | sh
# Env: REPO_RAW, PANEL_PORT, FETCH_VIA (awg10 — принудительно через VPN)

set -e

# github.com/raw works when /etc/hosts overrides raw.githubusercontent.com (Zapret)
REPO_RAW="${REPO_RAW:-https://github.com/NanoRexic/routerich-panel/raw/refs/heads/main}"
PANEL_PORT="${PANEL_PORT:-2020}"
AWG_IFACE="awg10"
UA='Mozilla/5.0 (compatible; RouteRich-Installer/1.0)'
TMP_DIR="/tmp/routerich-install-$$"
MANIFEST="$TMP_DIR/files.manifest"
FETCH_ROUTE=""

log() { printf '[install] %s\n' "$1" >&2; }
fail() { printf '[install] ERROR: %s\n' "$1" >&2; exit 1; }

cleanup() { rm -rf "$TMP_DIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

bust_url() {
	url="$1"
	case "$url" in
		*\?*) printf '%s' "${url}&t=$(date +%s 2>/dev/null || echo 1)" ;;
		*) printf '%s' "${url}?t=$(date +%s 2>/dev/null || echo 1)" ;;
	esac
}

awg10_is_up() {
	ip link show "$AWG_IFACE" 2>/dev/null | grep -qE 'UP|LOWER_UP'
}

awg10_route_available() {
	awg10_is_up && command -v curl >/dev/null 2>&1
}

is_github_error_page() {
	file="$1"
	[ -s "$file" ] || return 1
	first=$(head -c 32 "$file" 2>/dev/null | tr -d '\r\n')
	case "$first" in
		"<!DOC"* | "<html"* | "<HTML"*)
			grep -qiE '404|not found|rate limit|access denied|bad credentials' "$file" 2>/dev/null
			;;
		*) return 1 ;;
	esac
}

version_probe_ok() {
	file="$1"
	[ -s "$file" ] || return 1
	is_github_error_page "$file" && return 1
	tr -d '\r\n' < "$file" | grep -qE '^[0-9]+(\.[0-9]+){0,2}$'
}

download_file_ok() {
	file="$1"
	[ -s "$file" ] || return 1
	! is_github_error_page "$file"
}

try_fetch() {
	url="$1"
	out="$2"
	iface="$3"
	max_time="${4:-120}"
	bust=$(bust_url "$url")

	if command -v curl >/dev/null 2>&1; then
		if [ -n "$iface" ]; then
			curl -fsSL -A "$UA" -H 'Cache-Control: no-cache' \
				--interface "$iface" --connect-timeout 5 --max-time "$max_time" \
				-o "$out" "$bust" 2>/dev/null && return 0
		else
			curl -fsSL -A "$UA" -H 'Cache-Control: no-cache' \
				--connect-timeout 5 --max-time "$max_time" \
				-o "$out" "$bust" 2>/dev/null && return 0
		fi
	fi

	if [ -z "$iface" ] && command -v wget >/dev/null 2>&1; then
		wget -q -U "$UA" -T "$max_time" -O "$out" "$bust" 2>/dev/null && return 0
	fi

	return 1
}

probe_route() {
	route="$1"
	iface=""
	probe="$TMP_DIR/route-probe"

	case "$route" in
		awg10) iface="$AWG_IFACE" ;;
		default) iface="" ;;
		*) return 1 ;;
	esac

	try_fetch "$REPO_RAW/VERSION" "$probe" "$iface" 15 && version_probe_ok "$probe"
}

resolve_fetch_route() {
	if [ -n "$FETCH_ROUTE" ]; then
		return 0
	fi

	log "Проверка доступа к GitHub..."

	if [ "$FETCH_VIA" = "awg10" ]; then
		if awg10_route_available && probe_route awg10; then
			FETCH_ROUTE="awg10"
			log "Загрузка через $AWG_IFACE (FETCH_VIA)"
			return 0
		fi
		fail "Не удалось скачать через $AWG_IFACE (интерфейс выключен или curl недоступен)"
	fi

	log "Пробуем напрямую..."
	if probe_route default; then
		FETCH_ROUTE="default"
		return 0
	fi

	if awg10_route_available; then
		log "Пробуем через $AWG_IFACE..."
		if probe_route awg10; then
			FETCH_ROUTE="awg10"
			log "GitHub недоступен напрямую — загрузка через $AWG_IFACE"
			return 0
		fi
	elif ! command -v curl >/dev/null 2>&1; then
		fail "GitHub недоступен напрямую. Установите curl: opkg update && opkg install curl"
	fi

	return 1
}

fetch() {
	url="$1"
	out="$2"
	iface=""

	if ! resolve_fetch_route; then
		return 1
	fi

	if [ "$FETCH_ROUTE" = "awg10" ]; then
		iface="$AWG_IFACE"
	fi

	if try_fetch "$url" "$out" "$iface" && download_file_ok "$out"; then
		return 0
	fi
	return 1
}

ensure_jq() {
	if command -v jq >/dev/null 2>&1; then
		return 0
	fi
	log "Installing jq..."
	if command -v opkg >/dev/null 2>&1; then
		opkg update >/dev/null 2>&1 || true
		opkg install jq >/dev/null 2>&1 || true
	elif command -v apk >/dev/null 2>&1; then
		apk add --no-cache jq >/dev/null 2>&1 || true
	fi
	command -v jq >/dev/null 2>&1
}

command -v wget >/dev/null 2>&1 || command -v curl >/dev/null 2>&1 || fail "wget or curl required"
command -v uci >/dev/null 2>&1 || fail "uci not found — is this OpenWrt?"

case "$PANEL_PORT" in
	80|443) fail "ports 80 and 443 are reserved for LuCI" ;;
esac

mkdir -p "$TMP_DIR"

log "RouteRich panel installer"
log "Source: $REPO_RAW"

fetch "$REPO_RAW/files.manifest" "$MANIFEST" || fail "cannot download files.manifest from GitHub (ни напрямую, ни через $AWG_IFACE). Попробуйте: curl -fsSL --interface awg10 $REPO_RAW/install.sh | FETCH_VIA=awg10 sh"

if ensure_jq; then
	file_count=$(jq '.files | length' "$MANIFEST" 2>/dev/null) || file_count=0
else
	log "Warning: jq unavailable — using built-in file list"
	file_count=0
fi

deploy_file() {
	src="$1"
	dst="$2"
	mode="$3"
	url="$REPO_RAW/$src"
	dir=$(dirname "$dst")
	mkdir -p "$dir"
	log "  $dst"
	fetch "$url" "$dst" || fail "download failed: $src"
	chmod "$mode" "$dst" 2>/dev/null || true
}

if [ "$file_count" -gt 0 ] 2>/dev/null; then
	log "Downloading panel files..."
	i=0
	while [ "$i" -lt "$file_count" ]; do
		src=$(jq -r ".files[$i].src" "$MANIFEST")
		dst=$(jq -r ".files[$i].dst" "$MANIFEST")
		mode=$(jq -r ".files[$i].mode" "$MANIFEST")
		deploy_file "$src" "$dst" "$mode"
		i=$((i + 1))
	done
else
	log "Downloading panel files (fallback list)..."
	deploy_file "cgi-bin/reboot" "/www/routerich-panel/cgi-bin/reboot" "755"
	deploy_file "cgi-bin/fix-opera-proxy" "/www/routerich-panel/cgi-bin/fix-opera-proxy" "755"
	deploy_file "cgi-bin/import-awg" "/www/routerich-panel/cgi-bin/import-awg" "755"
	deploy_file "cgi-bin/generate-awg" "/www/routerich-panel/cgi-bin/generate-awg" "755"
	deploy_file "cgi-bin/saved-awg" "/www/routerich-panel/cgi-bin/saved-awg" "755"
	deploy_file "cgi-bin/zapret-api" "/www/routerich-panel/cgi-bin/zapret-api" "755"
	deploy_file "cgi-bin/panel-update" "/www/routerich-panel/cgi-bin/panel-update" "755"
	deploy_file "lib/zapret-headless.sh" "/etc/routerich-panel/zapret-headless.sh" "755"
	deploy_file "index.html" "/www/routerich-panel/index.html" "644"
	deploy_file "app.js" "/www/routerich-panel/app.js" "644"
	deploy_file "shortcut.js" "/www/routerich-panel/shortcut.js" "644"
	deploy_file "zapret.js" "/www/routerich-panel/zapret.js" "644"
	deploy_file "style.css" "/www/routerich-panel/style.css" "644"
	deploy_file "sw.js" "/www/routerich-panel/sw.js" "644"
	deploy_file "icon.svg" "/www/routerich-panel/icon.svg" "644"
	deploy_file "manifest.webmanifest" "/www/routerich-panel/manifest.webmanifest" "644"
	deploy_file "VERSION" "/www/routerich-panel/VERSION" "644"
	deploy_file "VERSION" "/etc/routerich-panel/VERSION" "644"
fi

SETUP="$TMP_DIR/setup-panel.sh"
fetch "$REPO_RAW/setup-panel.sh" "$SETUP" || fail "cannot download setup-panel.sh"
chmod 755 "$SETUP"

log "Configuring uhttpd..."
PREFERRED_PORT="$PANEL_PORT"
# Only eval PANEL_* lines — setup-panel.sh logs go to stderr
eval "$(sh "$SETUP" "$PANEL_PORT" | grep '^PANEL_')"

VERSION=""
fetch "$REPO_RAW/VERSION" "$TMP_DIR/VERSION" 2>/dev/null && VERSION=$(cat "$TMP_DIR/VERSION" 2>/dev/null | tr -d '\r\n')

printf '\n=== Install complete ===\n'
[ -n "$VERSION" ] && printf 'Version: %s\n' "$VERSION"
[ "$FETCH_ROUTE" = "awg10" ] && printf 'Download route: %s\n' "$AWG_IFACE"
printf 'Panel URL: %s\n' "$PANEL_URL"
[ "$PREFERRED_PORT" != "$PANEL_PORT" ] && printf '(port %s was busy, using %s)\n' "$PREFERRED_PORT" "$PANEL_PORT"

exit 0