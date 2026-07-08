#!/bin/sh
# Обход недоступности GitHub при маршрутизации через Zeroblock (CDN GitHub).

zeroblock_installed() {
	[ -f /etc/config/zeroblock ] || return 1
	[ -x /etc/init.d/zeroblock ] && return 0
	return 1
}

zeroblock_running() {
	zeroblock_installed || return 1
	if /etc/init.d/zeroblock status >/dev/null 2>&1; then
		return 0
	fi
	pgrep -f '[z]eroblock' >/dev/null 2>&1
}

zeroblock_stop() {
	zeroblock_running || return 1
	/etc/init.d/zeroblock stop >/dev/null 2>&1
	sleep 2
	! zeroblock_running
}

github_hosts_present() {
	grep -q 'raw\.githubusercontent\.com' /etc/hosts 2>/dev/null
}

ensure_github_hosts() {
	github_hosts_present && return 0
	git="githubusercontent.com"
	printf "#%s\n185.199.109.133 raw.%s release-assets.%s\n185.199.108.133 private-user-images.%s gist.%s avatars.%s\n" \
		"$git" "$git" "$git" "$git" "$git" "$git" >> /etc/hosts
	/etc/init.d/dnsmasq restart >/dev/null 2>&1
	return 0
}

# Остановить Zeroblock и добавить зеркала GitHub в hosts (как в Zapret Manager).
apply_zeroblock_github_fallback() {
	zeroblock_running || return 1
	zeroblock_stop || return 1
	ensure_github_hosts
	return 0
}