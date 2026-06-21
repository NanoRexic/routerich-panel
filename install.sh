#!/bin/sh
# RouteRich panel — install on OpenWrt (download from GitHub)
# Usage: wget -O - https://raw.githubusercontent.com/NanoRexic/routerich-panel/main/install.sh | sh
# Env: REPO_RAW, PANEL_PORT

set -e

REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/NanoRexic/routerich-panel/main}"
PANEL_PORT="${PANEL_PORT:-2020}"
UA='Mozilla/5.0 (compatible; RouteRich-Installer/1.0)'
TMP_DIR="/tmp/routerich-install-$$"
MANIFEST="$TMP_DIR/files.manifest"

log() { printf '[install] %s\n' "$1"; }
fail() { printf '[install] ERROR: %s\n' "$1" >&2; exit 1; }

cleanup() { rm -rf "$TMP_DIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

fetch() {
	url="$1"
	out="$2"
	if command -v wget >/dev/null 2>&1; then
		wget -q -U "$UA" -O "$out" "$url" 2>/dev/null && return 0
	fi
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL -A "$UA" -o "$out" "$url" 2>/dev/null && return 0
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

fetch "$REPO_RAW/files.manifest" "$MANIFEST" || fail "cannot download files.manifest from GitHub"

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
	deploy_file "lib/zapret-headless.sh" "/etc/routerich-panel/zapret-headless.sh" "755"
	deploy_file "index.html" "/www/routerich-panel/index.html" "644"
	deploy_file "app.js" "/www/routerich-panel/app.js" "644"
	deploy_file "shortcut.js" "/www/routerich-panel/shortcut.js" "644"
	deploy_file "zapret.js" "/www/routerich-panel/zapret.js" "644"
	deploy_file "style.css" "/www/routerich-panel/style.css" "644"
	deploy_file "sw.js" "/www/routerich-panel/sw.js" "644"
	deploy_file "icon.svg" "/www/routerich-panel/icon.svg" "644"
	deploy_file "manifest.webmanifest" "/www/routerich-panel/manifest.webmanifest" "644"
fi

SETUP="$TMP_DIR/setup-panel.sh"
fetch "$REPO_RAW/setup-panel.sh" "$SETUP" || fail "cannot download setup-panel.sh"
chmod 755 "$SETUP"

log "Configuring uhttpd..."
PREFERRED_PORT="$PANEL_PORT"
eval "$(sh "$SETUP" "$PANEL_PORT")"

VERSION=""
fetch "$REPO_RAW/VERSION" "$TMP_DIR/VERSION" 2>/dev/null && VERSION=$(cat "$TMP_DIR/VERSION" 2>/dev/null | tr -d '\r\n')

printf '\n=== Install complete ===\n'
[ -n "$VERSION" ] && printf 'Version: %s\n' "$VERSION"
printf 'Panel URL: %s\n' "$PANEL_URL"
[ "$PREFERRED_PORT" != "$PANEL_PORT" ] && printf '(port %s was busy, using %s)\n' "$PREFERRED_PORT" "$PANEL_PORT"

exit 0