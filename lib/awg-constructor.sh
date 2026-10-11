#!/bin/sh
# Saved AmneziaWG constructor. Versions 2.0 / 3.0 / 3.1 only (no 1.5).

AWG_CTOR_FILE="${AWG_CTOR_FILE:-/etc/routerich-panel/awg-constructor.json}"
AWG_CTOR_CGI="${AWG_CTOR_CGI:-/www/routerich-panel/cgi-bin/generate-awg}"
AWG_TOOLS_MIN="3.1.20260812-r1"
AWG_KMOD_MIN="6.6.144.3.1.20260812-r1"

awg_ctor_defaults() {
	jq -n '{
		version:"2.0",
		dns:"1.1.1.1, 1.0.0.1",
		mtu:"1280",
		jc:"4", jmin:"40", jmax:"70",
		i1_mode:"cps2",
		i1_custom:"",
		content_padding:"10-100",
		rekey_after:"100-120",
		rekey_timeout:"3-7",
		reject_after:"150-180",
		keepalive_timeout:"5-15",
		max_handshake:"15-20",
		persistent_keepalive:"25",
		disable_cookies:"on"
	}'
}

awg_ctor_load() {
	base=$(awg_ctor_defaults)
	if [ -s "$AWG_CTOR_FILE" ]; then
		saved=$(cat "$AWG_CTOR_FILE" 2>/dev/null)
		printf '%s' "$base" | jq --argjson saved "$saved" '. * $saved' 2>/dev/null && return 0
	fi
	printf '%s' "$base"
}

awg_ctor_get() {
	key="$1"
	awg_ctor_load | jq -r --arg k "$key" '.[$k] // ""'
}

awg_ctor_save() {
	raw=$(cat)
	norm=$(printf '%s' "$raw" | jq -c '
		def s($k; $d): (.[$k] // $d | tostring);
		{
			version: (if (.version=="3.0" or .version=="3.1") then .version else "2.0" end),
			dns: s("dns"; "1.1.1.1, 1.0.0.1"),
			mtu: s("mtu"; "1280"),
			jc: s("jc"; "4"),
			jmin: s("jmin"; "40"),
			jmax: s("jmax"; "70"),
			i1_mode: (if (.i1_mode=="sip" or .i1_mode=="custom") then .i1_mode else "cps2" end),
			i1_custom: s("i1_custom"; ""),
			content_padding: s("content_padding"; "10-100"),
			rekey_after: s("rekey_after"; "100-120"),
			rekey_timeout: s("rekey_timeout"; "3-7"),
			reject_after: s("reject_after"; "150-180"),
			keepalive_timeout: s("keepalive_timeout"; "5-15"),
			max_handshake: s("max_handshake"; "15-20"),
			persistent_keepalive: s("persistent_keepalive"; "25"),
			disable_cookies: (if .disable_cookies=="off" then "off" else "on" end)
		}
	' 2>/dev/null) || return 1
	mkdir -p "$(dirname "$AWG_CTOR_FILE")"
	printf '%s\n' "$norm" > "$AWG_CTOR_FILE"
	printf '%s' "$norm"
}

awg_pkg_ver() {
	name="$1"
	if command -v opkg >/dev/null 2>&1; then
		opkg list-installed "$name" 2>/dev/null | awk '{print $3; exit}'
		return
	fi
	if command -v apk >/dev/null 2>&1; then
		apk info -e -v "$name" 2>/dev/null | head -n1 | awk '{print $1}'
	fi
}

awg_ver_ge() {
	have="$1"
	need="$2"
	[ -n "$have" ] || return 1
	low=$(printf '%s\n%s\n' "$have" "$need" | sort -V 2>/dev/null | head -n1)
	[ "$low" = "$need" ]
}

awg_v3_ready() {
	tools=$(awg_pkg_ver amneziawg-tools)
	kmod=$(awg_pkg_ver kmod-amneziawg)
	ok=1
	awg_ver_ge "$tools" "$AWG_TOOLS_MIN" || ok=0
	awg_ver_ge "$kmod" "$AWG_KMOD_MIN" || ok=0
	jq -n --arg tools "$tools" --arg kmod "$kmod" \
		--arg need_tools "$AWG_TOOLS_MIN" --arg need_kmod "$AWG_KMOD_MIN" \
		--argjson ok "$ok" \
		'{ok:($ok==1), tools:$tools, kmod:$kmod, need_tools:$need_tools, need_kmod:$need_kmod}'
}

awg_ctor_preset_blob() {
	name="$1"
	[ -f "$AWG_CTOR_CGI" ] || return 1
	awk -v name="$name" '
		index($0, name "='\''") == 1 {
			s = substr($0, length(name) + 3)
			if (substr(s, length(s), 1) == "'\''") s = substr(s, 1, length(s) - 1)
			print s
			exit
		}
	' "$AWG_CTOR_CGI"
}

awg_ctor_i1_lines() {
	mode=$(awg_ctor_get i1_mode)
	case "$mode" in
		sip)
			awg_ctor_preset_blob WARPGEN_I1_V3
			;;
		custom)
			custom=$(awg_ctor_get i1_custom)
			custom=$(printf '%s' "$custom" | sed 's/\r$//')
			[ -n "$custom" ] || return 0
			case "$custom" in
				I[1-5]\ =*|I[1-5]=*) printf '%s\n' "$custom" ;;
				*) printf 'I1 = %s\n' "$custom" ;;
			esac
			;;
		*)
			awg_ctor_preset_blob WARPGEN_I1_V2
			;;
	esac
}

awg_ctor_i1_packet() {
	line=$(awg_ctor_i1_lines | awk -F' = ' '/^I1 = / { print substr($0, index($0, " = ") + 3); exit }')
	printf '%s' "$line"
}

awg_ctor_status_json() {
	settings=$(awg_ctor_load)
	gate=$(awg_v3_ready)
	jq -n --argjson settings "$settings" --argjson awg3 "$gate" '{ok:true, settings:$settings, awg3:$awg3}'
}
