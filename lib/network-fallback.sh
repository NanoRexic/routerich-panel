#!/bin/sh
# Обход недоступности GitHub при маршрутизации через Zeroblock (cdn_github в AWG).
# Важно: не останавливаем Zeroblock — stop ломает демон и DNS на роутере.

github_hosts_present() {
	grep -q 'raw\.githubusercontent\.com' /etc/hosts 2>/dev/null
}

reload_dnsmasq_for_hosts() {
	if /etc/init.d/dnsmasq reload >/dev/null 2>&1; then
		return 0
	fi
	/etc/init.d/dnsmasq restart >/dev/null 2>&1
}

ensure_github_hosts() {
	github_hosts_present && return 0
	git="githubusercontent.com"
	printf "#%s\n185.199.109.133 raw.%s release-assets.%s github.com\n185.199.108.133 private-user-images.%s gist.%s avatars.%s\n" \
		"$git" "$git" "$git" "$git" "$git" "$git" >> /etc/hosts
	reload_dnsmasq_for_hosts
	return 0
}

# Добавить зеркала GitHub в /etc/hosts (как в Zapret Manager) и повторить загрузку.
apply_github_access_fallback() {
	ensure_github_hosts
	return 0
}