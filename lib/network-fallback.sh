#!/bin/sh

reload_dnsmasq_for_hosts() {
	if /etc/init.d/dnsmasq reload >/dev/null 2>&1; then
		return 0
	fi
	/etc/init.d/dnsmasq restart >/dev/null 2>&1
}

# github.com must not share Fastly IPs of githubusercontent.com
fix_github_com_fastly_hosts() {
	grep -qE 'github\.com' /etc/hosts 2>/dev/null || return 0
	if ! grep -qE '^185\.199\.[0-9.]+[[:space:]].*github\.com([[:space:]]|$)' /etc/hosts 2>/dev/null; then
		return 0
	fi
	sed -i '/^185\.199\./s/[[:space:]]github\.com//g' /etc/hosts
	reload_dnsmasq_for_hosts
}

ensure_github_hosts() {
	fix_github_com_fastly_hosts
	return 0
}

apply_github_access_fallback() {
	ensure_github_hosts
	return 0
}