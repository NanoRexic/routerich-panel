#!/bin/sh
# RouteRich panel — Zapret2 helpers (UCI, circular slots, blockcheckw, games)

Z2_CONF="/etc/config/zapret2"
Z2_INIT="/etc/init.d/zapret2"
Z2_STATE_DIR="/etc/routerich-panel"
Z2_STATE="$Z2_STATE_DIR/zapret2-state.json"
Z2_BACKUP="$Z2_STATE_DIR/zapret2-backup"
Z2_BCW_DIR="$Z2_STATE_DIR/bcw"
Z2_TMP="/tmp/routerich-panel"
Z2_JOB="$Z2_TMP/bcw-job.json"
Z2_JOB_LOG="$Z2_TMP/bcw.log"
Z2_JOB_PID="$Z2_TMP/bcw.pid"
Z2_CMD_PID="$Z2_TMP/bcw-cmd.pid"
Z2_WORK="$Z2_TMP/bcw-work"
Z2_ST_JOB="$Z2_TMP/slottest-job.json"
Z2_ST_LOG="$Z2_TMP/slottest.log"
Z2_ST_PID="$Z2_TMP/slottest.pid"

# Same port sets as Zapret v1 Gv (no v1 modifiers)
Z2_PORTS_UDP="88,1024-2407,2409-4499,4502-19293,19345-49999,50101-65535"
Z2_PORTS_TCP="2802,2302,2502,3478-3480,3724,6000-8000,8085,8090,8100,8903,8904,25565,27015-27030,27036-27037,50001,60442"
Z2_XTREME_PORTS="80,88,444-65535"
Z2_XTREME_NFQ="80,88,443-65535"

z2_installed() {
	[ -f "$Z2_INIT" ] || [ -f "$Z2_CONF" ] || [ -d /opt/zapret2 ]
}

z2_running() {
	if [ -x "$Z2_INIT" ]; then
		st=$("$Z2_INIT" status 2>/dev/null | head -n1 | tr -d '\r\n\t ')
		case "$st" in running|started|active) return 0 ;; esac
	fi
	pgrep nfqws2 >/dev/null 2>&1
}

z1_installed() { [ -x /etc/init.d/zapret ]; }

z1_running() {
	if [ -x /etc/init.d/zapret ]; then
		st=$(/etc/init.d/zapret status 2>/dev/null | head -n1 | tr -d '\r\n\t ')
		case "$st" in running|started|active) return 0 ;; esac
	fi
	pgrep -x nfqws >/dev/null 2>&1
}

z2_autostart() {
	[ -x "$Z2_INIT" ] && "$Z2_INIT" enabled >/dev/null 2>&1
}

z1_autostart() {
	[ -x /etc/init.d/zapret ] && /etc/init.d/zapret enabled >/dev/null 2>&1
}

z2_hash() {
	printf '%s' "$1" | md5sum 2>/dev/null | awk '{print $1}'
}

z2_mkdirs() {
	mkdir -p "$Z2_STATE_DIR" "$Z2_BCW_DIR" "$Z2_TMP" "$Z2_WORK"
}

z2_state_init() {
	z2_mkdirs
	if [ ! -s "$Z2_STATE" ]; then
		printf '%s\n' '{"profiles":{},"denylist":[],"games":{},"bcw":{"workers":128,"proto":"tls12","domains":"rutracker.org","timeout":600,"dns":"auto"}}' > "$Z2_STATE"
	fi
}

z2_default_workers() {
	mem=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null)
	mem=${mem:-0}
	if [ "$mem" -gt 0 ] && [ "$mem" -lt 280000 ]; then
		printf '64'
	else
		printf '128'
	fi
}

z2_uci_get() { uci -q get "$1" 2>/dev/null; }

z2_strategy_names() {
	uci show zapret2 2>/dev/null | sed -n 's/^zapret2\.\([^=]*\)=strategy$/\1/p'
}

z2_stop_v1() {
	if [ -x /etc/init.d/zapret ]; then
		/etc/init.d/zapret stop >/dev/null 2>&1 || true
		/etc/init.d/zapret disable >/dev/null 2>&1 || true
	fi
	if pgrep -x nfqws >/dev/null 2>&1; then
		kill $(pgrep -x nfqws) >/dev/null 2>&1 || true
		sleep 1
	fi
}

z2_pkg_remove() {
	pkg="$1"
	if command -v opkg >/dev/null 2>&1; then
		opkg remove "$pkg" >/dev/null 2>&1 || true
	elif command -v apk >/dev/null 2>&1; then
		apk del "$pkg" >/dev/null 2>&1 || true
	fi
}

z2_uninstall_v1() {
	z2_stop_v1
	z2_pkg_remove luci-app-zapret
	z2_pkg_remove zapret
	rm -rf /opt/zapret /etc/config/zapret /etc/firewall.zapret /etc/init.d/zapret
	rm -f /tmp/*zapret* /var/run/*zapret* 2>/dev/null || true
	crontab -l 2>/dev/null | grep -v -i zapret | crontab - 2>/dev/null || true
	nft list tables 2>/dev/null | while read -r _ fam tname; do
		case "$tname" in
			*zapret*|*ZAPRET*) nft delete table "$fam" "$tname" >/dev/null 2>&1 || true ;;
		esac
	done
}

z2_install() {
	z2_installed && return 0
	z2_uninstall_v1
	if command -v opkg >/dev/null 2>&1; then
		opkg update >/dev/null 2>&1 || true
		opkg install zapret2 luci-app-zapret2 >/dev/null 2>&1 || return 1
	elif command -v apk >/dev/null 2>&1; then
		apk update >/dev/null 2>&1 || true
		apk add zapret2 luci-app-zapret2 >/dev/null 2>&1 || return 1
	else
		return 1
	fi
	z2_installed || return 1
	if [ -x "$Z2_INIT" ]; then
		uci -q set zapret2.main.enabled='1' 2>/dev/null || true
		uci -q commit zapret2 2>/dev/null || true
		"$Z2_INIT" enable >/dev/null 2>&1 || true
		"$Z2_INIT" start >/dev/null 2>&1 || "$Z2_INIT" restart >/dev/null 2>&1 || true
	fi
	z2_bcw_install || true
	z2_ensure_nohup || true
	return 0
}

z2_stop_v2() {
	if [ -x "$Z2_INIT" ]; then
		"$Z2_INIT" stop >/dev/null 2>&1 || true
		"$Z2_INIT" disable >/dev/null 2>&1 || true
	fi
	if pgrep nfqws2 >/dev/null 2>&1; then
		killall nfqws2 >/dev/null 2>&1 || true
		sleep 1
	fi
}

z2_start_v2() {
	z2_stop_v1
	[ -x "$Z2_INIT" ] || return 1
	uci -q set zapret2.main.enabled='1'
	uci -q commit zapret2
	"$Z2_INIT" enable >/dev/null 2>&1 || true
	"$Z2_INIT" start >/dev/null 2>&1 || "$Z2_INIT" restart >/dev/null 2>&1
}

z2_restart_v2() {
	z2_stop_v1
	[ -x "$Z2_INIT" ] || return 1
	uci -q set zapret2.main.enabled='1'
	uci -q commit zapret2
	"$Z2_INIT" enable >/dev/null 2>&1 || true
	"$Z2_INIT" restart >/dev/null 2>&1
}

# Quiet stop of zapret2 used by Zapret v1 API (exclusive engine)
stop_zapret2_exclusive() {
	z2_stop_v2
}

z2_get_script() {
	uci -q get "zapret2.$1.script" 2>/dev/null
}

z2_set_script() {
	name="$1"
	script="$2"
	uci -q set "zapret2.$name.script=$script"
	uci -q commit zapret2
}

z2_parse_script() {
	script="$1"
	printf '%s\n' "$script" | awk '
		function trim(s) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); return s }
		function esc(s) {
			gsub(/\\/, "\\\\", s)
			gsub(/"/, "\\\"", s)
			gsub(/\t/, "\\t", s)
			gsub(/\r/, "", s)
			return s
		}
		function label_of(tok, fn, extra) {
			fn = tok
			sub(/^--lua-desync=/, "", fn)
			sub(/:.*$/, "", fn)
			extra = ""
			if (match(tok, /pos=[^:]+/)) extra = substr(tok, RSTART, RLENGTH)
			else if (match(tok, /blob=[^:]+/)) extra = substr(tok, RSTART, RLENGTH)
			else if (match(tok, /host=[^:]+/)) extra = substr(tok, RSTART, RLENGTH)
			if (length(extra) > 36) extra = substr(extra, 1, 36) "…"
			if (extra != "") return fn " " extra
			return fn
		}
		{
			n = split($0, parts, /[[:space:]]+--/)
			for (i = 1; i <= n; i++) {
				tok = trim(parts[i])
				if (tok == "") continue
				if (tok !~ /^--/) tok = "--" tok
				tokens[++nt] = tok
			}
		}
		END {
			print "{"
			printf "\"prefix\":["
			pc = 0
			for (i = 1; i <= nt; i++) {
				tok = tokens[i]
				sid = 0
				if (tok ~ /^--lua-desync=/ && match(tok, /:strategy=[0-9]+/)) {
					sid = substr(tok, RSTART + 10, RLENGTH - 10) + 0
				}
				if (sid > 0) {
					ninst[sid]++
					inst[sid, ninst[sid]] = tok
					if (tok ~ /:final/) fin[sid] = 1
					if (sid > maxid) maxid = sid
					if (!(sid in seen)) { seen[sid] = 1; ids[++nid] = sid }
				} else if (maxid == 0) {
					if (pc++) printf ","
					printf "\"%s\"", esc(tok)
				}
			}
			print "],"
			printf "\"slots\":["
			sc = 0
			for (j = 1; j <= nid; j++) {
				sid = ids[j]
				if (sc++) printf ","
				printf "{\"id\":%d,\"final\":%s,\"label\":\"%s\",\"instances\":[", sid, (fin[sid] ? "true" : "false"), esc(label_of(inst[sid, 1]))
				for (k = 1; k <= ninst[sid]; k++) {
					if (k > 1) printf ","
					printf "\"%s\"", esc(inst[sid, k])
				}
				printf "]}"
			}
			print "]}"
		}
	'
}

z2_ensure_profile_state() {
	name="$1"
	script=$(z2_get_script "$name")
	hash=$(z2_hash "$script")
	z2_state_init
	exists=$(jq -r --arg n "$name" '.profiles[$n] // empty' "$Z2_STATE")
	if [ -z "$exists" ]; then
		tmp="$Z2_TMP/z2-state.$$"
		jq --arg n "$name" --arg s "$script" --arg h "$hash" \
			'.profiles[$n] = {canon:$s, canon_hash:$h, written_hash:$h, disabled:[], no_cycle:true}' \
			"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
		return
	fi
	canon_hash=$(jq -r --arg n "$name" '.profiles[$n].canon_hash // ""' "$Z2_STATE")
	written=$(jq -r --arg n "$name" '.profiles[$n].written_hash // ""' "$Z2_STATE")
	if [ "$hash" != "$written" ] && [ "$hash" != "$canon_hash" ]; then
		tmp="$Z2_TMP/z2-state.$$"
		jq --arg n "$name" --arg s "$script" --arg h "$hash" \
			'.profiles[$n].stale = true | .profiles[$n].live_hash = $h' \
			"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
	fi
}

z2_resync_canon() {
	name="$1"
	script=$(z2_get_script "$name")
	hash=$(z2_hash "$script")
	z2_state_init
	tmp="$Z2_TMP/z2-state.$$"
	jq --arg n "$name" --arg s "$script" --arg h "$hash" \
		'.profiles[$n] = ((.profiles[$n] // {}) + {canon:$s, canon_hash:$h, written_hash:$h, disabled:[], no_cycle:true, stale:false})' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
}

z2_parsed_to_canon_numbered() {
	parsed="$1"
	prefix=$(printf '%s' "$parsed" | jq -r '.prefix | join("\n")')
	slotn=$(printf '%s' "$parsed" | jq '.slots | length')
	body=""
	si=0
	while [ "$si" -lt "$slotn" ]; do
		inst=$(printf '%s' "$parsed" | jq -r --argjson i "$si" '.slots[$i].instances[]')
		stamped=$(printf '%s\n' "$inst" | z2_stamp_instances $((si + 1)))
		if [ -n "$body" ]; then
			body=$(printf '%s\n%s' "$body" "$stamped")
		else
			body="$stamped"
		fi
		si=$((si + 1))
	done
	if [ -n "$prefix" ] && [ -n "$body" ]; then
		printf '%s\n%s' "$prefix" "$body"
	elif [ -n "$body" ]; then
		printf '%s' "$body"
	else
		printf '%s' "$prefix"
	fi
}

# Slot numbers follow visual order 1..M (circular-front insert becomes #1).
z2_slots_normalize_ids() {
	name="$1"
	z2_state_init
	canon=$(jq -r --arg n "$name" '.profiles[$n].canon // empty' "$Z2_STATE")
	[ -n "$canon" ] || return 0
	parsed=$(z2_parse_script "$canon")
	slotn=$(printf '%s' "$parsed" | jq '.slots | length')
	[ "$slotn" -gt 0 ] || return 0
	ordered=$(printf '%s' "$parsed" | jq '[.slots[].id] == [range(1; (.slots|length)+1)]')
	[ "$ordered" = "true" ] && return 0
	disabled=$(jq -c --arg n "$name" '.profiles[$n].disabled // []' "$Z2_STATE")
	new_dis=$(printf '%s' "$parsed" | jq -c --argjson dis "$disabled" '
		[range(0; .slots|length) as $i | {old:.slots[$i].id, new:($i+1)}] as $map
		| [$dis[] as $d | ($map[] | select(.old==$d) | .new)]
	')
	new_canon=$(z2_parsed_to_canon_numbered "$parsed")
	hash=$(z2_hash "$new_canon")
	tmp="$Z2_TMP/z2-state.$$"
	jq --arg n "$name" --arg s "$new_canon" --arg h "$hash" --argjson dis "$new_dis" \
		'.profiles[$n].canon=$s | .profiles[$n].canon_hash=$h | .profiles[$n].disabled=$dis' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
}

z2_apply_circular() {
	name="$1"
	z2_ensure_profile_state "$name"
	z2_slots_normalize_ids "$name"
	z2_restyle_profile "$name" || return 1
	canon=$(jq -r --arg n "$name" '.profiles[$n].canon // empty' "$Z2_STATE")
	[ -n "$canon" ] || canon=$(z2_get_script "$name")
	parsed=$(z2_parse_script "$canon")
	disabled=$(jq -c --arg n "$name" '.profiles[$n].disabled // []' "$Z2_STATE")
	no_cycle=$(jq -r --arg n "$name" '.profiles[$n].no_cycle // true' "$Z2_STATE")
	keep_n=$(printf '%s' "$parsed" | jq --argjson dis "$disabled" '[.slots[] | select(.id as $id | (($dis | index($id)) == null))] | length')
	slot_total=$(printf '%s' "$parsed" | jq '.slots | length')
	if [ "$slot_total" -gt 0 ] && [ "$keep_n" -eq 0 ]; then
		return 1
	fi
	stream=$(printf '%s' "$parsed" | jq -r --argjson dis "$disabled" '
		.prefix[],
		"---",
		(.slots[] | select(.id as $id | (($dis | index($id)) == null)) | .instances[], "---")
	')
	nocycle_flag=0
	[ "$no_cycle" = "true" ] && nocycle_flag=1
	new=$(printf '%s\n' "$stream" | awk -v nocycle="$nocycle_flag" '
		function strip_final(s) { gsub(/:final/, "", s); return s }
		function set_strat(s, n) {
			if (match(s, /:strategy=[0-9]+/))
				return substr(s, 1, RSTART - 1) ":strategy=" n substr(s, RSTART + RLENGTH)
			return s ":strategy=" n
		}
		$0 == "---" {
			inslots = 1
			if (cur != "") { slots[++ns] = cur; cur = "" }
			next
		}
		!inslots { if (prefix != "") prefix = prefix "\n"; prefix = prefix $0; next }
		{ if (cur != "") cur = cur "\n"; cur = cur $0 }
		END {
			if (cur != "") slots[++ns] = cur
			if (prefix != "") print prefix
			for (i = 1; i <= ns; i++) {
				n = split(slots[i], L, "\n")
				lastj = 0
				for (j = 1; j <= n; j++) if (L[j] != "") lastj = j
				for (j = 1; j <= n; j++) {
					if (L[j] == "") continue
					line = set_strat(strip_final(L[j]), i)
					if (nocycle && i == ns && j == lastj && line !~ /:final/) line = line ":final"
					print line
				}
			}
		}
	')
	[ -n "$new" ] || return 1
	z2_set_script "$name" "$new"
	hash=$(z2_hash "$new")
	tmp="$Z2_TMP/z2-state.$$"
	jq --arg n "$name" --arg h "$hash" \
		'.profiles[$n].written_hash = $h | .profiles[$n].stale = false' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
}

z2_set_disabled() {
	name="$1"
	ids_json="$2"
	no_cycle="$3"
	z2_state_init
	z2_ensure_profile_state "$name"
	tmp="$Z2_TMP/z2-state.$$"
	jq --arg n "$name" --argjson ids "$ids_json" --argjson nocycle "$no_cycle" \
		'.profiles[$n].disabled = $ids | .profiles[$n].no_cycle = $nocycle' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
	z2_apply_circular "$name"
}

z2_reorder_slots() {
	name="$1"
	order="$2"
	z2_state_init
	z2_ensure_profile_state "$name"
	canon=$(jq -r --arg n "$name" '.profiles[$n].canon // empty' "$Z2_STATE")
	[ -n "$canon" ] || canon=$(z2_get_script "$name")
	parsed=$(z2_parse_script "$canon")
	ok=$(printf '%s' "$parsed" | jq --argjson order "$order" '
		($order | type == "array")
		and (($order | length) > 0)
		and (($order | length) == (.slots | length))
		and (([.slots[].id] | sort) == ($order | sort))
	')
	[ "$ok" = "true" ] || return 1
	same=$(printf '%s' "$parsed" | jq --argjson order "$order" '[.slots[].id] == $order')
	[ "$same" = "true" ] && return 0
	parsed=$(printf '%s' "$parsed" | jq --argjson order "$order" '
		.slots = [$order[] as $id | (.slots[] | select(.id == $id))]
	')
	disabled=$(jq -c --arg n "$name" '.profiles[$n].disabled // []' "$Z2_STATE")
	new_dis=$(jq -nc --argjson order "$order" --argjson dis "$disabled" '
		[range(0; $order|length) as $i
			| select(($dis | index($order[$i])) != null)
			| ($i + 1)]
	')
	new_canon=$(z2_parsed_to_canon_numbered "$parsed")
	hash=$(z2_hash "$new_canon")
	tmp="$Z2_TMP/z2-state.$$"
	jq --arg n "$name" --arg s "$new_canon" --arg h "$hash" --argjson dis "$new_dis" \
		'.profiles[$n].canon=$s | .profiles[$n].canon_hash=$h | .profiles[$n].disabled=$dis' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
	z2_apply_circular "$name"
}

z2_set_enabled() {
	name="$1"
	on="$2"
	uci -q set "zapret2.$name.enabled=$on"
	uci -q commit zapret2
}

z2_enable_blob() {
	blob="$1"
	[ -n "$(uci -q get "zapret2.$blob")" ] || return 0
	uci -q set "zapret2.$blob.enabled=1"
	uci -q commit zapret2
}

z2_csv_has() {
	csv="$1"
	item="$2"
	printf '%s' ",$csv," | grep -q ",$item,"
}

z2_csv_add() {
	csv="$1"
	add="$2"
	out="$csv"
	IFS=,
	for p in $add; do
		[ -n "$p" ] || continue
		z2_csv_has "$out" "$p" || out="${out:+$out,}$p"
	done
	printf '%s' "$out"
}

z2_csv_remove_list() {
	csv="$1"
	rmlist="$2"
	out=""
	IFS=,
	for p in $csv; do
		[ -n "$p" ] || continue
		skip=0
		for r in $rmlist; do
			[ "$p" = "$r" ] && skip=1 && break
		done
		[ "$skip" -eq 1 ] && continue
		out="${out:+$out,}$p"
	done
	printf '%s' "$out"
}

z2_ports_save_if_needed() {
	tcp=$(z2_uci_get zapret2.main.nfqws_ports_tcp)
	udp=$(z2_uci_get zapret2.main.nfqws_ports_udp)
	z2_state_init
	saved=$(jq -r '.games.saved_tcp // empty' "$Z2_STATE")
	if [ -z "$saved" ]; then
		tmp="$Z2_TMP/z2-state.$$"
		jq --arg t "$tcp" --arg u "$udp" '.games.saved_tcp=$t | .games.saved_udp=$u' \
			"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
	fi
}

z2_ports_restore() {
	z2_state_init
	tcp=$(jq -r '.games.saved_tcp // "80,443"' "$Z2_STATE")
	udp=$(jq -r '.games.saved_udp // "443"' "$Z2_STATE")
	uci -q set zapret2.main.nfqws_ports_tcp="$tcp"
	uci -q set zapret2.main.nfqws_ports_udp="$udp"
	uci -q commit zapret2
	tmp="$Z2_TMP/z2-state.$$"
	jq '.games.saved_tcp=null | .games.saved_udp=null | .games.xtreme=false' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
}

z2_ensure_game_sections() {
	if [ -z "$(uci -q get zapret2.games_udp)" ]; then
		uci -q set zapret2.games_udp=strategy
	fi
	uci -q set zapret2.games_udp.protocol='udp'
	uci -q delete zapret2.games_udp.filter_l3 2>/dev/null || true
	uci -q add_list zapret2.games_udp.filter_l3='ipv4'
	if [ -z "$(uci -q get zapret2.games_tcp)" ]; then
		uci -q set zapret2.games_tcp=strategy
	fi
	uci -q set zapret2.games_tcp.protocol='tcp'
	uci -q delete zapret2.games_tcp.filter_l3 2>/dev/null || true
	uci -q add_list zapret2.games_tcp.filter_l3='ipv4'
	z2_enable_blob blob_stun
}

z2_games_script_udp() {
	n="$1"
	if [ "$n" = "1" ]; then
		printf '%s\n' '--out-range=-d2' '--payload=unknown' '--lua-desync=fake:blob=blob_stun'
	else
		printf '%s\n' "--out-range=-n$n" '--payload=unknown' '--lua-desync=fake:blob=blob_stun:repeats=10'
	fi
}

z2_games_script_tcp() {
	printf '%s\n' '--out-range=-n5' '--payload=all' '--lua-desync=multisplit:pos=1:seqovl=582:seqovl_pattern=blob_stun'
}

z2_games_apply() {
	n="$1"
	xtreme="$2"
	z2_ports_save_if_needed
	z2_ensure_game_sections
	if [ "$xtreme" = "1" ]; then
		udp_ports="$Z2_XTREME_PORTS"
		tcp_ports="$Z2_XTREME_PORTS"
		nfq="$Z2_XTREME_NFQ"
		uci -q set zapret2.main.nfqws_ports_tcp="$nfq"
		uci -q set zapret2.main.nfqws_ports_udp="$nfq"
	else
		udp_ports="$Z2_PORTS_UDP"
		tcp_ports="$Z2_PORTS_TCP"
		cur_t=$(z2_uci_get zapret2.main.nfqws_ports_tcp)
		cur_u=$(z2_uci_get zapret2.main.nfqws_ports_udp)
		uci -q set zapret2.main.nfqws_ports_tcp="$(z2_csv_add "$cur_t" "$Z2_PORTS_TCP")"
		uci -q set zapret2.main.nfqws_ports_udp="$(z2_csv_add "$cur_u" "$Z2_PORTS_UDP")"
	fi
	uci -q set zapret2.games_udp.enabled='1'
	uci -q set zapret2.games_udp.port="$udp_ports"
	uci -q set zapret2.games_udp.protocol='udp'
	uci -q set zapret2.games_tcp.enabled='1'
	uci -q set zapret2.games_tcp.port="$tcp_ports"
	uci -q set zapret2.games_tcp.protocol='tcp'
	uci -q commit zapret2
	z2_set_script games_udp "$(z2_games_script_udp "$n")"
	z2_set_script games_tcp "$(z2_games_script_tcp)"
	z2_state_init
	tmp="$Z2_TMP/z2-state.$$"
	jq --argjson n "$n" --argjson x "$xtreme" '.games.active=$n | .games.xtreme=($x==1)' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
}

z2_games_clear() {
	uci -q set zapret2.games_udp.enabled='0' 2>/dev/null || true
	uci -q set zapret2.games_tcp.enabled='0' 2>/dev/null || true
	uci -q delete zapret2.games_udp 2>/dev/null || true
	uci -q delete zapret2.games_tcp 2>/dev/null || true
	uci -q commit zapret2
	z2_ports_restore
	tmp="$Z2_TMP/z2-state.$$"
	jq '.games.active=null | .games.xtreme=false' "$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
}

z2_detect_games() {
	script=$(z2_get_script games_udp)
	n=""
	case "$script" in
		*out-range=-d2*) n=1 ;;
		*out-range=-n2*) n=2 ;;
		*out-range=-n3*) n=3 ;;
		*out-range=-n4*) n=4 ;;
	esac
	xtreme=0
	port=$(z2_uci_get zapret2.games_udp.port)
	case "$port" in
		*"444-65535"*) xtreme=1 ;;
	esac
	en=$(z2_uci_get zapret2.games_udp.enabled)
	[ "$en" = "1" ] || n=""
	printf '%s %s' "$n" "$xtreme"
}

z2_strip_filters() {
	printf '%s\n' "$1" | awk '
		function trim(s){gsub(/^[[:space:]]+|[[:space:]]+$/,"",s);return s}
		{
			n=split($0, parts, /[[:space:]]+--/)
			for(i=1;i<=n;i++){
				tok=trim(parts[i])
				if(tok=="") continue
				if(tok !~ /^--/) tok="--" tok
				if(tok ~ /^--filter-/) continue
				if(tok ~ /^--hostlist/) continue
				if(tok ~ /^--qnum=/) continue
				if(tok ~ /^--fwmark=/) continue
				if(tok ~ /^--daemon/) continue
				if(tok ~ /^--new$/) continue
				if(tok ~ /^--name=/) continue
				print tok
			}
		}
	'
}

z2_circ_style_norm() {
	case "$1" in
		pkts|d20) printf 'pkts' ;;
		*) printf 'seq' ;;
	esac
}

z2_circ_style_get() {
	st=$(jq -r --arg n "$1" '.profiles[$n].circ_style // empty' "$Z2_STATE" 2>/dev/null)
	case "$st" in
		pkts|seq) printf '%s' "$st" ;;
		*) printf '' ;;
	esac
}

z2_circ_style_detect() {
	printf '%s' "$1" | jq -r '
		if ([.prefix[]? | select(contains("-d20") or contains("nld=2"))] | length) > 0
		then "pkts" else "seq" end
	'
}

z2_circ_has_wssize() {
	printf '%s' "$1" | jq '[.prefix[]?, .slots[].instances[]?] | map(select(contains("lua-desync=wssize"))) | length > 0'
}

z2_circ_prefix_lines() {
	style=$(z2_circ_style_norm "$1")
	wss="$2"
	if [ "$style" = "pkts" ]; then
		printf '%s\n' '--out-range=-d20' '--payload=tls_client_hello' '--in-range=-d10'
		[ "$wss" = "1" ] && printf '%s\n' '--lua-desync=wssize:wsize=1:scale=6:forced_cutoff=tls_server_hello'
		printf '%s\n' '--lua-desync=circular:fails=2:maxtime=60:retrans=3:nld=2:reset' '--in-range=x'
	else
		printf '%s\n' '--out-range=-s34228' '--payload=tls_client_hello' '--in-range=-s5556'
		[ "$wss" = "1" ] && printf '%s\n' '--lua-desync=wssize:wsize=1:scale=6:forced_cutoff=tls_server_hello'
		printf '%s\n' '--lua-desync=circular:fails=3:maxtime=60' '--in-range=x'
	fi
}

z2_circular_prefix() {
	z2_circ_prefix_lines "${1:-seq}" "${2:-0}"
}

z2_restyle_parsed() {
	parsed="$1"
	style=$(z2_circ_style_norm "$2")
	wss="$3"
	pre=$(z2_circ_prefix_lines "$style" "$wss" | jq -R -s 'split("\n") | map(select(length>0))')
	printf '%s' "$parsed" | jq --argjson pre "$pre" '
		.prefix = $pre
		| .slots = [
			.slots[]
			| .instances = [.instances[] | select(contains("lua-desync=wssize") | not)]
			| select((.instances | length) > 0)
		]
	'
}

z2_restyle_profile() {
	name="$1"
	force="$2"
	canon=$(jq -r --arg n "$name" '.profiles[$n].canon // empty' "$Z2_STATE")
	[ -n "$canon" ] || canon=$(z2_get_script "$name")
	parsed=$(z2_parse_script "$canon")
	parsed=$(z2_promote_slots "$parsed")
	style=$(z2_circ_style_get "$name")
	if [ -z "$style" ]; then
		style=$(z2_circ_style_detect "$parsed")
	fi
	[ -n "$force" ] && style=$(z2_circ_style_norm "$force")
	wss=0
	[ "$(z2_circ_has_wssize "$parsed")" = "true" ] && wss=1
	disabled=$(jq -c --arg n "$name" '.profiles[$n].disabled // []' "$Z2_STATE")
	parsed=$(z2_restyle_parsed "$parsed" "$style" "$wss")
	new_dis=$(printf '%s' "$parsed" | jq -c --argjson dis "$disabled" '
		[range(0; .slots|length) as $si | {old:.slots[$si].id, new:($si+1)}] as $map
		| [$dis[] as $d | ($map[] | select(.old==$d) | .new)]
	')
	new_canon=$(z2_parsed_to_canon_numbered "$parsed")
	[ -n "$new_canon" ] || return 1
	hash=$(z2_hash "$new_canon")
	tmp="$Z2_TMP/z2-state.$$"
	jq --arg n "$name" --arg s "$new_canon" --arg h "$hash" --arg st "$style" --argjson dis "$new_dis" \
		'.profiles[$n].canon=$s | .profiles[$n].canon_hash=$h | .profiles[$n].circ_style=$st | .profiles[$n].disabled=$dis' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
}

z2_set_circ_style() {
	name="$1"
	style=$(z2_circ_style_norm "$2")
	z2_ensure_profile_state "$name"
	tmp="$Z2_TMP/z2-state.$$"
	jq --arg n "$name" --arg st "$style" '.profiles[$n].circ_style=$st' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
	z2_apply_circular "$name"
}

z2_embed_drop_wssize() {
	awk 'index($0, "lua-desync=wssize")==0'
}

z2_embed_instances() {
	z2_strip_filters "$1" | awk '
		/^--lua-desync=/ {
			if (index($0, "lua-desync=circular")) next
			print
			next
		}
		/^--lua-init/ { print; next }
		/^--payload=/ && $0 != "--payload=tls_client_hello" { print; next }
		/^--out-range=/ { next }
		/^--in-range=/ { next }
	'
}

z2_stamp_instances() {
	id="$1"
	awk -v id="$id" '
		/^--lua-desync=/ {
			t=$0
			gsub(/:strategy=[0-9]+/, "", t)
			gsub(/:final/, "", t)
			print t ":strategy=" id
			next
		}
		{ print }
	'
}

z2_lua_label() {
	printf '%s\n' "$1" | awk '/^--lua-desync=/ {
		s=$0
		sub(/^--lua-desync=/, "", s)
		sub(/:.*/, "", s)
		print s
		exit
	}'
}

z2_promote_slots() {
	printf '%s' "$1" | jq '
		def is_circ: contains("lua-desync=circular");
		def is_inst: ((startswith("--lua-desync=") or startswith("--lua-init")) and (is_circ | not));
		if (.slots | length) > 0 then .
		else
			(.prefix | map(select(is_inst))) as $inst
			| .prefix = [.prefix[] | select(is_inst | not)]
			| if ($inst | length) > 0 then
				.slots = [{
					id:1, final:false, label:"1",
					instances: ($inst | map(
						if startswith("--lua-desync=") and (contains(":strategy=") | not)
						then . + ":strategy=1"
						else . end
					))
				}]
			else . end
		end
	'
}

z2_ensure_circ_prefix() {
	parsed="$1"
	style=$(z2_circ_style_norm "$2")
	wss="$3"
	has=$(printf '%s' "$parsed" | jq '[.prefix[]? | select(contains("lua-desync=circular"))] | length')
	if [ "$has" -gt 0 ] 2>/dev/null; then
		printf '%s' "$parsed"
		return 0
	fi
	z2_restyle_parsed "$parsed" "$style" "$wss"
}

z2_inst_fingerprint() {
	awk '
		/^--lua-desync=/ {
			t=$0
			gsub(/:strategy=[0-9]+/, "", t)
			gsub(/:final/, "", t)
			print t
			next
		}
		/^--lua-init/ { print; next }
	' | tr '\n' '|'
}

z2_slot_has_fingerprint() {
	parsed="$1"
	want="$2"
	[ -n "$want" ] || return 1
	slotn=$(printf '%s' "$parsed" | jq '.slots | length')
	si=0
	while [ "$si" -lt "$slotn" ]; do
		inst=$(printf '%s' "$parsed" | jq -r --argjson i "$si" '.slots[$i].instances[]')
		fp=$(printf '%s\n' "$inst" | z2_inst_fingerprint)
		[ "$fp" = "$want" ] && return 0
		si=$((si + 1))
	done
	return 1
}

z2_pkg_version() {
	opkg list-installed zapret2 2>/dev/null | awk '{print $3; exit}'
}

z2_embed_into() {
	target="$1"
	mode="$2"
	raw_args="$3"
	new_name="$4"
	domains="$5"
	args_json=$(jq -n --arg a "$raw_args" '[$a]')
	z2_embed_list "$target" "$mode" "$args_json" "$new_name" 0
}

z2_embed_list() {
	target="$1"
	mode="$2"
	args_json="$3"
	new_name="$4"
	replace="$5"
	count=$(printf '%s' "$args_json" | jq 'if type=="array" then length else 0 end')
	case "$count" in ''|*[!0-9]*) return 1 ;; esac
	[ "$count" -ge 1 ] || return 1
	style=seq
	if [ "$mode" = "new" ]; then
		[ -n "$new_name" ] || new_name="panel_$(date +%H%M%S)"
		new_name=$(printf '%s' "$new_name" | tr -c 'A-Za-z0-9_' '_' | sed 's/^_//;s/_$//')
		[ -n "$new_name" ] || return 1
		uci -q set "zapret2.$new_name=strategy"
		uci -q set "zapret2.$new_name.enabled=1"
		uci -q set "zapret2.$new_name.port=443"
		uci -q set "zapret2.$new_name.protocol=tcp"
		uci -q delete "zapret2.$new_name.filter_l3" 2>/dev/null || true
		uci -q add_list "zapret2.$new_name.filter_l3=ipv4"
		uci -q delete "zapret2.$new_name.filter_l7" 2>/dev/null || true
		uci -q add_list "zapret2.$new_name.filter_l7=tls"
		uci -q delete "zapret2.$new_name.hostlist" 2>/dev/null || true
		uci -q commit zapret2
		target="$new_name"
		pre=$(z2_circ_prefix_lines seq 0 | jq -R -s 'split("\n") | map(select(length>0))')
		parsed=$(jq -n --argjson pre "$pre" '{prefix:$pre, slots:[]}')
		z2_state_init
	else
		[ -n "$target" ] || return 1
		z2_ensure_profile_state "$target"
		style=$(z2_circ_style_get "$target")
		[ -n "$style" ] || style=seq
		canon=$(jq -r --arg n "$target" '.profiles[$n].canon // empty' "$Z2_STATE")
		[ -n "$canon" ] || canon=$(z2_get_script "$target")
		parsed=$(z2_parse_script "$canon")
		parsed=$(z2_promote_slots "$parsed")
		if [ "$replace" = "1" ]; then
			parsed=$(printf '%s' "$parsed" | jq '.slots = []')
		fi
	fi
	wss_any=0
	[ "$(z2_circ_has_wssize "$parsed")" = "true" ] && wss_any=1
	new_slots='[]'
	added=0
	next_id=$(printf '%s' "$parsed" | jq '[.slots[].id] | max // 0')
	ei=0
	while [ "$ei" -lt "$count" ]; do
		raw_one=$(printf '%s' "$args_json" | jq -r --argjson ei "$ei" '.[$ei] // empty')
		ei=$((ei + 1))
		[ -n "$raw_one" ] || continue
		inst_one=$(z2_embed_instances "$raw_one")
		printf '%s\n' "$inst_one" | grep -q 'lua-desync=wssize' && wss_any=1
		inst_one=$(printf '%s\n' "$inst_one" | z2_embed_drop_wssize)
		printf '%s\n' "$inst_one" | grep -q '^--lua-desync=' || continue
		fp_one=$(printf '%s\n' "$inst_one" | z2_inst_fingerprint)
		[ -n "$fp_one" ] || continue
		check=$(printf '%s' "$parsed" | jq --argjson ns "$new_slots" '.slots = $ns + .slots')
		if z2_slot_has_fingerprint "$check" "$fp_one"; then
			continue
		fi
		next_id=$((next_id + 1))
		lab=$(z2_lua_label "$inst_one")
		[ -n "$lab" ] || lab="desync"
		new_inst=$(printf '%s\n' "$inst_one" | z2_stamp_instances "$next_id" | jq -R -s 'split("\n") | map(select(length>0))')
		new_slots=$(printf '%s' "$new_slots" | jq --argjson inst "$new_inst" --argjson id "$next_id" --arg label "$lab" \
			'. + [{id:$id, final:false, label:$label, instances:$inst}]')
		added=$((added + 1))
	done
	[ "$added" -ge 1 ] || return 2
	parsed=$(z2_restyle_parsed "$parsed" "$style" "$wss_any")
	parsed=$(printf '%s' "$parsed" | jq --argjson ns "$new_slots" '.slots = $ns + .slots')
	new_canon=$(printf '%s' "$parsed" | jq -r '((.prefix | join("\n")) + "\n" + ([.slots[] | .instances[]] | join("\n")))')
	hash=$(z2_hash "$new_canon")
	z2_set_script "$target" "$new_canon"
	z2_mkdirs
	tmp="$Z2_TMP/z2-state.$$"
	if [ "$mode" = "new" ]; then
		jq --arg n "$target" --arg s "$new_canon" --arg h "$hash" --arg st seq \
			'.profiles[$n] = ((.profiles[$n] // {}) + {canon:$s, canon_hash:$h, written_hash:$h, disabled:[], no_cycle:true, stale:false, circ_style:$st})' \
			"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
	else
		if [ "$replace" = "1" ]; then
			jq --arg n "$target" --arg s "$new_canon" --arg h "$hash" --arg st "$style" \
				'.profiles[$n].canon=$s | .profiles[$n].canon_hash=$h | .profiles[$n].circ_style=$st | .profiles[$n].disabled=[]' \
				"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
		else
			jq --arg n "$target" --arg s "$new_canon" --arg h "$hash" --arg st "$style" \
				'.profiles[$n].canon=$s | .profiles[$n].canon_hash=$h | .profiles[$n].circ_style=$st' \
				"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
		fi
	fi
	z2_apply_circular "$target"
	printf '%s' "$target"
}

z2_bcw_settings() {
	z2_state_init
	w=$(z2_default_workers)
	jq --argjson dw "$w" '
		.bcw.workers = (.bcw.workers // $dw)
		| .bcw.proto = (.bcw.proto // "tls12")
		| .bcw.domains = (.bcw.domains // "rutracker.org")
		| .bcw.timeout = (.bcw.timeout // 600)
		| .bcw.dns = (.bcw.dns // "auto")
		| .bcw
	' "$Z2_STATE"
}

z2_bcw_save_settings() {
	z2_state_init
	tmp="$Z2_TMP/z2-state.$$"
	jq --argjson w "$1" --arg p "$2" --arg d "$3" --argjson t "$4" --arg dns "$5" \
		'.bcw.workers=$w | .bcw.proto=$p | .bcw.domains=$d | .bcw.timeout=$t | .bcw.dns=$dns' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
}

z2_job_write() {
	z2_mkdirs
	printf '%s' "$1" > "$Z2_JOB"
}

z2_bcw_available() {
	[ -x /usr/bin/blockcheckw ] && return 0
	command -v blockcheckw >/dev/null 2>&1
}

z2_bcw_arch() {
	machine=$(uname -m)
	case "$machine" in
		x86_64|amd64) printf 'x86_64' ;;
		i?86|i586|i686) printf 'x86' ;;
		aarch64|arm64) printf 'arm64' ;;
		armv7*|armv6*|arm*) printf 'arm' ;;
		mips64*) printf 'mips64' ;;
		mipsel*|mipsle*) printf 'mipsel' ;;
		mips*) printf 'mips' ;;
		ppc|powerpc) printf 'ppc' ;;
		riscv64*) printf 'riscv64' ;;
		*) return 1 ;;
	esac
}

z2_bcw_dl() {
	url="$1"
	out="$2"
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --connect-timeout 15 --max-time 90 --retry 2 -A 'Mozilla/5.0' -o "$out" "$url" && return 0
	fi
	if command -v wget >/dev/null 2>&1; then
		wget -q --no-cache --timeout=90 -U 'Mozilla/5.0' -O "$out" "$url" && return 0
	fi
	return 1
}

z2_bcw_install() {
	z2_mkdirs
	z2_bcw_install_run >/dev/null 2>>"$Z2_TMP/bcw-install.log"
}

z2_bcw_install_run() {
	z2_mkdirs
	if [ -x /usr/bin/blockcheckw ]; then
		return 0
	fi
	if command -v blockcheckw >/dev/null 2>&1; then
		return 0
	fi
	arch=$(z2_bcw_arch) || return 1
	if [ -f /etc/routerich-panel/network-fallback.sh ]; then
		# shellcheck disable=SC1091
		. /etc/routerich-panel/network-fallback.sh
		apply_github_access_fallback >/dev/null 2>&1 || true
	fi
	workdir="$Z2_TMP/bcw-install"
	rm -rf "$workdir"
	mkdir -p "$workdir" || return 1
	base="https://github.com/rcd27/blockcheckw/releases/latest/download"
	tarball="blockcheckw-linux-${arch}.tar.gz"
	if ! z2_bcw_dl "$base/$tarball" "$workdir/$tarball"; then
		rm -rf "$workdir"
		return 1
	fi
	z2_bcw_dl "$base/SHA256SUMS.txt" "$workdir/SHA256SUMS.txt" || true
	if [ -s "$workdir/SHA256SUMS.txt" ] && command -v sha256sum >/dev/null 2>&1; then
		if ! (cd "$workdir" && grep "$tarball" SHA256SUMS.txt | sha256sum -c >/dev/null 2>&1); then
			rm -rf "$workdir"
			return 1
		fi
	fi
	if ! tar -xzf "$workdir/$tarball" -C "$workdir" >/dev/null 2>&1; then
		rm -rf "$workdir"
		return 1
	fi
	bin=""
	[ -f "$workdir/blockcheckw" ] && bin="$workdir/blockcheckw"
	[ -z "$bin" ] && bin=$(find "$workdir" -type f -name blockcheckw 2>/dev/null | head -n1)
	[ -n "$bin" ] && [ -f "$bin" ] || { rm -rf "$workdir"; return 1; }
	mkdir -p /usr/bin
	cp "$bin" /usr/bin/blockcheckw || { rm -rf "$workdir"; return 1; }
	chmod 755 /usr/bin/blockcheckw
	rm -rf "$workdir"
	[ -x /usr/bin/blockcheckw ]
}

z2_bcw_running() {
	[ -f "$Z2_JOB_PID" ] || return 1
	pid=$(cat "$Z2_JOB_PID" 2>/dev/null)
	[ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

z2_bcw_elapsed() {
	st=$(jq -r '.started_at // 0' "$Z2_JOB" 2>/dev/null)
	case "$st" in ''|*[!0-9]*) st=0 ;; esac
	now=$(date +%s)
	if [ "$st" -gt 0 ] && [ "$now" -ge "$st" ]; then
		printf '%s' $((now - st))
	else
		printf '0'
	fi
}

# blockcheckw keeps a TTY progress bar; redirected logs stay silent between [START] and [DONE].
z2_bcw_wait() {
	"$@" >>"$Z2_JOB_LOG" 2>&1 &
	cmdpid=$!
	echo "$cmdpid" > "$Z2_CMD_PID"
	tick=0
	while kill -0 "$cmdpid" 2>/dev/null; do
		sleep 1
		tick=$((tick + 1))
		[ $((tick % 15)) -eq 0 ] || continue
		el=$(z2_bcw_elapsed)
		mm=$((el / 60))
		ss=$((el % 60))
		printf '[%d:%02d] поиск идёт\n' "$mm" "$ss" >>"$Z2_JOB_LOG"
		if [ -f "$Z2_JOB" ]; then
			nxt=$(jq --argjson el "$el" '.elapsed=$el' "$Z2_JOB" 2>/dev/null) && z2_job_write "$nxt"
		fi
	done
	wait "$cmdpid"
	rc=$?
	rm -f "$Z2_CMD_PID"
	return $rc
}

z2_take_n() {
	n="$1"
	case "$n" in
		''|*[!0-9]*) n=20 ;;
	esac
	[ "$n" -lt 1 ] && n=20
	[ "$n" -gt 50 ] && n=50
	printf '%s' "$n"
}

# Strip nfqws2 prefix; keep rank order. No jq regex (OpenWrt jq may lack oniguruma).
z2_strip_nfqws2() {
	awk '{
		s=$0
		if (index(s, "nfqws2 ")==1) s=substr(s, 8)
		if (length(s)) print s
	}'
}

z2_extract_args_from_file() {
	file="$1"
	limit=$(z2_take_n "$2")
	[ -f "$file" ] || return 0
	if jq -e 'type=="object" or type=="array"' "$file" >/dev/null 2>&1; then
		jq -r --argjson n "$limit" '
			if type=="array" then
				.[0:$n][] | (if type=="string" then . else (.args // empty) end)
			elif (.strategies | type)=="array" and ((.strategies|length) > 0) then
				.strategies[0:$n][] | (if type=="string" then . else (.args // empty) end)
			elif (.protocols | type)=="array" then
				[.protocols[] | ((.strategies // [])[0:$n][]) | (if type=="string" then . else (.args // empty) end)][0:$n][]
			else
				[ .. | objects | .args? // empty ]
				| flatten
				| map(select(type=="string" and length>0))
				| .[0:$n][]
			end
		' "$file" 2>/dev/null | z2_strip_nfqws2
		return 0
	fi
	awk -v lim="$limit" '
		/nfqws2|--lua-desync=/ {
			s=$0
			sub(/^[^:]*: /, "", s)
			if (index(s, "nfqws2 ")==1) s=substr(s, 8)
			if (length(s) && !seen[s]++) {
				print s
				n++
				if (n>=lim) exit
			}
		}
	' "$file"
}

z2_bcw_find_report() {
	found_txt=""
	for f in "$Z2_WORK"/check.json "$Z2_WORK"/*_check.json \
		"$Z2_WORK"/scan.json "$Z2_WORK"/*_scan.json \
		"$Z2_WORK"/universal.json "$Z2_WORK"/*_universal.json \
		"$Z2_WORK"/*report* "$Z2_WORK"/*.json "$Z2_WORK"/*.txt; do
		[ -f "$f" ] && [ -s "$f" ] || continue
		case "$f" in
			*/args.txt|*/domains.txt) continue ;;
		esac
		if jq -e '((type=="object") and ((.strategies|type)=="array" or (.protocols|type)=="array")) or (type=="array")' "$f" >/dev/null 2>&1; then
			printf '%s' "$f"
			return 0
		fi
		[ -z "$found_txt" ] && found_txt="$f"
	done
	[ -n "$found_txt" ] && printf '%s' "$found_txt"
}

z2_bcw_write_report() {
	mode="$1"
	domains="$2"
	proto="$3"
	stamp="$4"
	verified="$5"
	args_file="$6"
	results="$7"
	[ -f "$args_file" ] || : > "$args_file"
	tmp="$results.tmp"
	if jq -n --arg mode "$mode" --arg domains "$domains" --arg proto "$proto" --arg stamp "$stamp" \
		--argjson verified "$verified" \
		--rawfile args "$args_file" \
		'{
			mode:$mode, domains:$domains, proto:$proto, stamp:$stamp, verified:($verified==1),
			strategies: (($args | split("\n")) | map(select(length>0)))
		}' > "$tmp"; then
		mv "$tmp" "$results"
		return 0
	fi
	rm -f "$tmp"
	return 1
}

z2_bcw_execute() {
	z2_mkdirs
	rm -rf "$Z2_WORK"
	mkdir -p "$Z2_WORK" "$Z2_BCW_DIR"
	cd "$Z2_WORK" || exit 1
	mode=$(jq -r '.mode' "$Z2_JOB")
	workers=$(jq -r '.workers' "$Z2_JOB")
	proto=$(jq -r '.proto' "$Z2_JOB")
	domains=$(jq -r '.domains' "$Z2_JOB")
	timeout=$(jq -r '.timeout' "$Z2_JOB")
	dns=$(jq -r '.dns' "$Z2_JOB")
	take=$(z2_take_n "$(jq -r '.take // 20' "$Z2_JOB")")
	restore=$(jq -r '.restore_zapret2 // false' "$Z2_JOB")

	z2_job_write "$(jq --arg p "running" --arg m "$mode" '.phase=$p | .mode=$m | .error=null' "$Z2_JOB")"

	z2_stop_v2
	z2_stop_v1

	ok=0
	err=""
	stamp=$(date +%Y-%m-%d_%H-%M-%S)
	safe=$(printf '%s' "$domains" | tr ' ,/' '___')
	case "$mode" in
		quick)
			if z2_bcw_wait blockcheckw -w "$workers" --auto --no-conflict-cleanup scan \
				-d "$domains" -p "$proto" --timeout "$timeout" --dns "$dns" --top 20 \
				-o "$Z2_WORK/scan.json"; then
				ok=1
			fi
			;;
		full)
			if z2_bcw_wait blockcheckw -w "$workers" --auto --no-conflict-cleanup scan \
				-d "$domains" -p "$proto" --timeout "$timeout" --dns "$dns" \
				-o "$Z2_WORK/scan.json"; then
				ok=1
			fi
			rep=""
			[ -f "$Z2_WORK/scan.json" ] && rep="$Z2_WORK/scan.json"
			[ -z "$rep" ] && rep=$(ls -t "$Z2_WORK"/*report* "$Z2_WORK"/*.txt 2>/dev/null | head -1)
			if [ -n "$rep" ]; then
				z2_bcw_wait blockcheckw -w "$workers" --auto --no-conflict-cleanup check \
					--from-file "$rep" -d "$domains" --dns "$dns" --take "$take" \
					-o "$Z2_WORK/check.json" || true
			fi
			;;
		universal)
			printf '%s\n' "$domains" | tr ' ,' '\n' | sed '/^$/d' > "$Z2_WORK/domains.txt"
			if z2_bcw_wait blockcheckw -w "$workers" --auto --no-conflict-cleanup universal \
				--domain-list "$Z2_WORK/domains.txt" -p "$proto" --dns "$dns" \
				-o "$Z2_WORK/universal.json"; then
				ok=1
			fi
			if [ -f "$Z2_WORK/universal.json" ]; then
				z2_bcw_wait blockcheckw -w "$workers" --auto --no-conflict-cleanup check \
					--from-file "$Z2_WORK/universal.json" -d "$(awk 'NR==1{print;exit}' "$Z2_WORK/domains.txt")" \
					--dns "$dns" --take "$take" \
					-o "$Z2_WORK/check.json" || true
			fi
			;;
		*)
			err="unknown mode"
			;;
	esac

	results="$Z2_BCW_DIR/${stamp}_${safe}_${mode}.json"
	args_file="$Z2_WORK/args.txt"
	: > "$args_file"
	rep=$(z2_bcw_find_report)
	if [ -n "$rep" ]; then
		z2_extract_args_from_file "$rep" "$take" >> "$args_file"
	fi
	verified=0
	case "$rep" in *check*) verified=1 ;; esac
	if ! z2_bcw_write_report "$mode" "$domains" "$proto" "$stamp" "$verified" "$args_file" "$results"; then
		[ -n "$err" ] || err="Не удалось сохранить отчёт"
		results=""
	fi

	if [ "$restore" = "true" ]; then
		z2_start_v2 >/dev/null 2>&1 || true
	fi

	phase="done"
	[ -n "$err" ] && phase="error"
	restore_json=false
	[ "$restore" = "true" ] && restore_json=true
	z2_job_write "$(jq -n --arg p "$phase" --arg e "$err" --arg r "$results" --arg mode "$mode" --argjson restore "$restore_json" \
		'{phase:$p, error:(if $e=="" then null else $e end), results:(if $r=="" then null else $r end), mode:$mode, running:false, restore_zapret2:$restore}')"
	rm -f "$Z2_JOB_PID" "$Z2_CMD_PID"
}

z2_ensure_nohup() {
	command -v nohup >/dev/null 2>&1 && return 0
	if command -v opkg >/dev/null 2>&1; then
		opkg update >/dev/null 2>&1 || true
		opkg install coreutils-nohup >/dev/null 2>&1 || true
	elif command -v apk >/dev/null 2>&1; then
		apk add --no-cache coreutils-nohup >/dev/null 2>&1 || true
	fi
	command -v nohup >/dev/null 2>&1
}

z2_bcw_spawn() {
	runner="$Z2_TMP/bcw-run.sh"
	cat > "$runner" <<'EOF'
#!/bin/sh
trap '' HUP INT QUIT
. /etc/routerich-panel/zapret2-headless.sh
z2_bcw_execute
EOF
	chmod 755 "$runner"
	rm -f "$Z2_JOB_PID"
	z2_ensure_nohup || true
	if command -v nohup >/dev/null 2>&1; then
		nohup /bin/sh "$runner" >>"$Z2_JOB_LOG" 2>&1 </dev/null &
		echo $! > "$Z2_JOB_PID"
	elif command -v start-stop-daemon >/dev/null 2>&1; then
		start-stop-daemon -S -b -m -p "$Z2_JOB_PID" -x /bin/sh -- "$runner" \
			>>"$Z2_JOB_LOG" 2>&1 </dev/null
	else
		/bin/sh "$runner" >>"$Z2_JOB_LOG" 2>&1 </dev/null &
		echo $! > "$Z2_JOB_PID"
	fi
}

z2_bcw_start() {
	mode="$1"
	workers="$2"
	proto="$3"
	domains="$4"
	timeout="$5"
	dns="$6"
	z2_bcw_available || return 1
	z2_bcw_running && return 2
	z2_slottest_running && return 2
	z2_mkdirs
	: > "$Z2_JOB_LOG"
	was=0
	z2_running && was=1
	z2_bcw_save_settings "$workers" "$proto" "$domains" "$timeout" "$dns"
	started=$(date +%s)
	jq -n --arg m "$mode" --argjson w "$workers" --arg p "$proto" --arg d "$domains" \
		--argjson t "$timeout" --arg dns "$dns" --argjson restore "$was" --argjson take 20 \
		--argjson started "$started" \
		'{mode:$m, workers:$w, proto:$p, domains:$d, timeout:$t, dns:$dns, take:$take, restore_zapret2:($restore==1), phase:"starting", running:true, error:null, started_at:$started, elapsed:0}' \
		> "$Z2_JOB"
	z2_bcw_spawn
	sleep 1
	if z2_bcw_running; then
		return 0
	fi
	err=$(tail -n 5 "$Z2_JOB_LOG" 2>/dev/null | tr '\n' ' ')
	[ -n "$err" ] || err="Не удалось запустить поиск"
	z2_job_write "$(jq --arg e "$err" '.phase="error" | .running=false | .error=$e' "$Z2_JOB")"
	return 1
}

z2_bcw_stop() {
	restore=false
	phase=""
	if [ -f "$Z2_JOB" ]; then
		restore=$(jq -r '.restore_zapret2 // false' "$Z2_JOB")
		phase=$(jq -r '.phase // empty' "$Z2_JOB")
	fi
	if [ -f "$Z2_CMD_PID" ]; then
		cpid=$(cat "$Z2_CMD_PID")
		if [ -n "$cpid" ]; then
			kill -TERM "$cpid" 2>/dev/null || true
		fi
	fi
	if [ -f "$Z2_JOB_PID" ]; then
		pid=$(cat "$Z2_JOB_PID")
		if [ -n "$pid" ]; then
			kill -TERM "$pid" 2>/dev/null || true
			sleep 1
			kill -KILL "$pid" 2>/dev/null || true
		fi
	fi
	killall blockcheckw >/dev/null 2>&1 || true
	rm -f "$Z2_JOB_PID" "$Z2_CMD_PID"
	# Already finished — execute() restored zapret2. Don't stop it again.
	case "$phase" in
		done|error|stopped)
			return 0
			;;
	esac
	# workers spawn nfqws2 — zapret2 restart/start will recreate service ones
	if [ "$restore" = "true" ]; then
		z2_start_v2 >/dev/null 2>&1 || true
	else
		z2_stop_v2
	fi
	[ -f "$Z2_JOB" ] && z2_job_write "$(jq '.phase="stopped" | .running=false' "$Z2_JOB")"
}

z2_slottest_running() {
	[ -f "$Z2_ST_PID" ] || return 1
	pid=$(cat "$Z2_ST_PID" 2>/dev/null)
	[ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

z2_slottest_write() {
	z2_mkdirs
	printf '%s' "$1" > "$Z2_ST_JOB"
}

z2_slottest_urls() {
	name="$1"
	out="$Z2_TMP/slottest-urls.txt"
	: > "$out"
	listid=$(z2_uci_get "zapret2.$name.hostlist")
	if [ -n "$listid" ]; then
		path=$(z2_uci_get "zapret2.$listid.path")
		if [ -z "$path" ] || [ ! -s "$path" ]; then
			return 1
		fi
		awk 'NF && $1 !~ /^#/ && $1 !~ /[*\/]/ {
			d=$1
			gsub(/\r/, "", d)
			if (d != "" && !seen[d]++) print d
		}' "$path" | head -n 50 | while read -r d; do
			printf '%s|https://%s/\n' "$d" "$d" >> "$out"
		done
		[ -s "$out" ] || return 1
		printf '%s\n' "домены: список хостов $listid" >> "$Z2_ST_LOG"
		printf '%s' "$out"
		return 0
	fi
	printf '%s\n' \
		"gosuslugi.ru|https://www.gosuslugi.ru" \
		"esia.gosuslugi.ru|https://esia.gosuslugi.ru" \
		"nalog.ru|https://nalog.ru" \
		"lkfl2.nalog.ru|https://lkfl2.nalog.ru" \
		"rutube.ru|https://rutube.ru" \
		"ntc.party|https://ntc.party/" \
		"instagram.com|https://instagram.com" \
		"facebook.com|https://facebook.com" \
		"rutor.info|https://rutor.info" \
		"rutracker.org|https://rutracker.org" \
		"epidemz.net.co|https://epidemz.net.co" \
		"nnmclub.to|https://nnmclub.to" \
		"openwrt.org|https://openwrt.org" \
		"discord.com|https://discord.com" \
		"x.com|https://x.com" \
		"filmix.my|https://filmix.my" \
		"flightradar24.com|https://flightradar24.com" \
		"play.google.com|https://play.google.com" \
		"kinozal.tv|https://kinozal.tv" \
		"cub.red|https://cub.red" >> "$out"
	printf '%s\n' "домены: набор v1" >> "$Z2_ST_LOG"
	printf '%s' "$out"
}

z2_slottest_probe() {
	urlsfile="$1"
	logfile="$2"
	okfile="$Z2_TMP/slottest-ok.$$"
	: > "$okfile"
	run=0
	while IFS= read -r row; do
		[ -n "$row" ] || continue
		name=$(printf '%s' "$row" | cut -d'|' -f1)
		link=$(printf '%s' "$row" | cut -d'|' -f2)
		(
			if curl -sL --connect-timeout 4 --max-time 6 --speed-time 3 --speed-limit 1 \
				--range 0-65535 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) curl/8.0" \
				-o /dev/null "$link" >/dev/null 2>&1; then
				echo "OK|$name" >> "$logfile"
				echo 1 >> "$okfile"
			else
				echo "FAIL|$name" >> "$logfile"
			fi
		) &
		run=$((run + 1))
		if [ "$run" -ge 8 ]; then
			wait
			run=0
		fi
	done < "$urlsfile"
	wait
	ok=$(wc -l < "$okfile" 2>/dev/null | tr -d ' ')
	rm -f "$okfile"
	printf '%s' "${ok:-0}"
}

z2_slottest_abort() {
	name=$(jq -r '.name // empty' "$Z2_ST_JOB" 2>/dev/null)
	dis=$(jq -c '.restore_disabled // []' "$Z2_ST_JOB" 2>/dev/null)
	restore=$(jq -r '.restore_zapret2 // false' "$Z2_ST_JOB" 2>/dev/null)
	if [ -n "$name" ] && [ -n "$dis" ]; then
		z2_set_disabled "$name" "$dis" true >/dev/null 2>&1 || true
	fi
	if [ "$restore" = "true" ]; then
		z2_restart_v2 >/dev/null 2>&1 || true
	else
		z2_stop_v2
	fi
}

z2_compact_profile_slots() {
	name="$1"
	keepers="$2"
	z2_state_init
	z2_ensure_profile_state "$name"
	canon=$(jq -r --arg n "$name" '.profiles[$n].canon // empty' "$Z2_STATE")
	[ -n "$canon" ] || canon=$(z2_get_script "$name")
	parsed=$(z2_parse_script "$canon")
	want=$(printf '%s' "$keepers" | jq 'length')
	[ "$want" -ge 1 ] || return 1
	parsed=$(printf '%s' "$parsed" | jq --argjson keep "$keepers" '
		.slots = [$keep[] as $id | (.slots[] | select(.id == $id))]
	')
	got=$(printf '%s' "$parsed" | jq '.slots | length')
	[ "$got" -eq "$want" ] || return 1
	new_canon=$(z2_parsed_to_canon_numbered "$parsed")
	[ -n "$new_canon" ] || return 1
	hash=$(z2_hash "$new_canon")
	tmp="$Z2_TMP/z2-state.$$"
	jq --arg n "$name" --arg s "$new_canon" --arg h "$hash" \
		'.profiles[$n].canon=$s | .profiles[$n].canon_hash=$h | .profiles[$n].disabled=[]' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
	z2_apply_circular "$name"
}

z2_slottest_execute() {
	z2_mkdirs
	name=$(jq -r '.name' "$Z2_ST_JOB")
	keep=$(jq -r '.keep // 5' "$Z2_ST_JOB")
	case "$keep" in ''|*[!0-9]*) keep=5 ;; esac
	[ "$keep" -lt 1 ] && keep=1
	[ "$keep" -gt 10 ] && keep=10
	restore=$(jq -r '.restore_zapret2 // false' "$Z2_ST_JOB")
	: > "$Z2_ST_LOG"
	z2_slottest_write "$(jq --arg p running '.phase=$p | .error=null' "$Z2_ST_JOB")"
	z2_stop_v1
	z2_ensure_profile_state "$name"
	z2_slots_normalize_ids "$name"
	canon=$(jq -r --arg n "$name" '.profiles[$n].canon // empty' "$Z2_STATE")
	[ -n "$canon" ] || canon=$(z2_get_script "$name")
	parsed=$(z2_parse_script "$canon")
	was_dis=$(jq -c '.restore_disabled // []' "$Z2_ST_JOB")
	[ -n "$was_dis" ] || was_dis='[]'
	enabled_ids=$(printf '%s' "$parsed" | jq -c --argjson dis "$was_dis" \
		'[.slots[].id | select(. as $id | ($dis | index($id)) == null)]')
	en=$(printf '%s' "$enabled_ids" | jq 'length')
	if [ "$en" -lt 1 ]; then
		z2_slottest_write "$(jq -n --arg e "Нет включённых слотов" '{phase:"error", running:false, error:$e}')"
		rm -f "$Z2_ST_PID"
		return 1
	fi
	if ! urls=$(z2_slottest_urls "$name"); then
		z2_slottest_write "$(jq -n --arg e "Нет доменов для теста (пустой список хостов)" '{phase:"error", running:false, error:$e}')"
		rm -f "$Z2_ST_PID"
		return 1
	fi
	total_dom=$(grep -c "|" "$urls" 2>/dev/null)
	total_dom=${total_dom:-0}
	[ "$total_dom" -gt 0 ] || {
		z2_slottest_write "$(jq -n --arg e "Нет доменов для теста" '{phase:"error", running:false, error:$e}')"
		rm -f "$Z2_ST_PID"
		return 1
	}
	printf '%s\n' "доменов: $total_dom, слотов: $en" >> "$Z2_ST_LOG"
	scores="$Z2_TMP/slottest-scores.jsonl"
	: > "$scores"
	ei=0
	while [ "$ei" -lt "$en" ]; do
		sid=$(printf '%s' "$enabled_ids" | jq --argjson i "$ei" '.[$i]')
		label=$(printf '%s' "$parsed" | jq -r --argjson id "$sid" '.slots[] | select(.id==$id) | .label')
		cur=$((ei + 1))
		z2_slottest_write "$(jq --argjson c "$cur" --argjson t "$en" --argjson id "$sid" \
			'.phase="running" | .current=$c | .total_slots=$t | .current_id=$id' "$Z2_ST_JOB")"
		printf '%s\n' "слот #$sid $label ($cur/$en)…" >> "$Z2_ST_LOG"
		others=$(printf '%s' "$parsed" | jq -c --argjson id "$sid" '[.slots[].id | select(. != $id)]')
		if z2_set_disabled "$name" "$others" true; then
			z2_restart_v2 >/dev/null 2>&1 || true
			sleep 2
			ok=$(z2_slottest_probe "$urls" "$Z2_ST_LOG")
		else
			ok=0
		fi
		printf '%s\n' "слот #$sid $label: $ok/$total_dom" >> "$Z2_ST_LOG"
		jq -n --argjson id "$sid" --arg label "$label" --argjson ok "$ok" --argjson total "$total_dom" \
			'{id:$id, label:$label, ok:$ok, total:$total}' >> "$scores"
		ei=$((ei + 1))
	done
	keepers=$(jq -s --argjson k "$keep" '
		sort_by(-.ok, .id)
		| .[0:$k]
		| [.[].id]
	' "$scores")
	klen=$(printf '%s' "$keepers" | jq 'length')
	if [ "$klen" -lt 1 ]; then
		z2_set_disabled "$name" "$was_dis" true || true
	elif ! z2_compact_profile_slots "$name" "$keepers"; then
		printf '%s\n' "не удалось собрать топ-$klen, возвращаю исходные слоты" >> "$Z2_ST_LOG"
		z2_set_disabled "$name" "$was_dis" true || true
	fi
	if [ "$restore" = "true" ]; then
		z2_restart_v2 >/dev/null 2>&1 || true
	else
		z2_stop_v2
	fi
	stamp=$(date +%Y-%m-%d_%H-%M-%S)
	sc_arr=$(jq -s '.' "$scores")
	sc_kept=$(jq -nc --argjson scores "$sc_arr" --argjson keep "$keepers" '
		[range(0; $keep|length) as $i
			| ($scores[] | select(.id == $keep[$i]) | .id = ($i + 1))]
	')
	new_keep=$(jq -nc --argjson k "$klen" '[range(1; $k + 1)]')
	lt=$(jq -n --arg stamp "$stamp" --argjson keep "$new_keep" --argjson scores "$sc_kept" --argjson all "$sc_arr" --argjson domains "$total_dom" \
		'{stamp:$stamp, keep:$keep, scores:$scores, scores_all:$all, domains:$domains}')
	tmp="$Z2_TMP/z2-state.$$"
	jq --arg n "$name" --argjson lt "$lt" '.profiles[$n].last_test=$lt' \
		"$Z2_STATE" > "$tmp" && mv "$tmp" "$Z2_STATE"
	z2_slottest_write "$(jq -n --arg p "done" --arg n "$name" --argjson keep "$new_keep" --argjson scores "$sc_kept" \
		'{phase:$p, running:false, error:null, name:$n, keep:($keep|length), kept:$keep, scores:$scores}')"
	rm -f "$Z2_ST_PID"
}

z2_slottest_spawn() {
	runner="$Z2_TMP/slottest-run.sh"
	cat > "$runner" <<'EOF'
#!/bin/sh
trap '' HUP INT QUIT
. /etc/routerich-panel/zapret2-headless.sh
z2_slottest_execute
EOF
	chmod 755 "$runner"
	rm -f "$Z2_ST_PID"
	z2_ensure_nohup || true
	if command -v nohup >/dev/null 2>&1; then
		nohup /bin/sh "$runner" >>"$Z2_ST_LOG" 2>&1 </dev/null &
		echo $! > "$Z2_ST_PID"
	elif command -v start-stop-daemon >/dev/null 2>&1; then
		start-stop-daemon -S -b -m -p "$Z2_ST_PID" -x /bin/sh -- "$runner" \
			>>"$Z2_ST_LOG" 2>&1 </dev/null
	else
		/bin/sh "$runner" >>"$Z2_ST_LOG" 2>&1 </dev/null &
		echo $! > "$Z2_ST_PID"
	fi
}

z2_slottest_start() {
	name="$1"
	keep="$2"
	[ -n "$name" ] || return 1
	z2_bcw_running && return 2
	z2_slottest_running && return 2
	z2_mkdirs
	: > "$Z2_ST_LOG"
	was=0
	z2_running && was=1
	z2_ensure_profile_state "$name"
	dis=$(jq -c --arg n "$name" '.profiles[$n].disabled // []' "$Z2_STATE")
	jq -n --arg n "$name" --argjson k "$keep" --argjson restore "$was" --argjson dis "$dis" \
		'{name:$n, keep:$k, restore_zapret2:($restore==1), restore_disabled:$dis, phase:"starting", running:true, error:null, current:0, total_slots:0}' \
		> "$Z2_ST_JOB"
	z2_slottest_spawn
	sleep 1
	if z2_slottest_running; then
		return 0
	fi
	exist=$(jq -r '.error // empty' "$Z2_ST_JOB" 2>/dev/null)
	if [ -n "$exist" ]; then
		return 1
	fi
	err=$(tail -n 5 "$Z2_ST_LOG" 2>/dev/null | tr '\n' ' ')
	[ -n "$err" ] || err="Не удалось запустить тест слотов"
	z2_slottest_write "$(jq -n --arg e "$err" '{phase:"error", running:false, error:$e}')"
	return 1
}

z2_slottest_stop() {
	phase=""
	if [ -f "$Z2_ST_JOB" ]; then
		phase=$(jq -r '.phase // empty' "$Z2_ST_JOB")
	fi
	if [ -f "$Z2_ST_PID" ]; then
		pid=$(cat "$Z2_ST_PID")
		if [ -n "$pid" ]; then
			kill -TERM "$pid" 2>/dev/null || true
			sleep 1
			kill -KILL "$pid" 2>/dev/null || true
		fi
	fi
	rm -f "$Z2_ST_PID"
	case "$phase" in
		done|error|stopped)
			return 0
			;;
	esac
	z2_slottest_abort
	[ -f "$Z2_ST_JOB" ] && z2_slottest_write "$(jq '.phase="stopped" | .running=false' "$Z2_ST_JOB")"
}

z2_profile_json() {
	name="$1"
	z2_ensure_profile_state "$name"
	z2_slots_normalize_ids "$name"
	canon=$(jq -r --arg n "$name" '.profiles[$n].canon // empty' "$Z2_STATE")
	[ -n "$canon" ] || canon=$(z2_get_script "$name")
	canon_parsed=$(z2_parse_script "$canon")
	enabled=$(z2_uci_get "zapret2.$name.enabled")
	[ -n "$enabled" ] || enabled=1
	port=$(z2_uci_get "zapret2.$name.port")
	proto=$(z2_uci_get "zapret2.$name.protocol")
	l7=$(z2_uci_get "zapret2.$name.filter_l7")
	host=$(z2_uci_get "zapret2.$name.hostlist")
	disabled=$(jq -c --arg n "$name" '.profiles[$n].disabled // []' "$Z2_STATE")
	no_cycle=$(jq --arg n "$name" '.profiles[$n].no_cycle // true' "$Z2_STATE")
	stale=$(jq --arg n "$name" '.profiles[$n].stale // false' "$Z2_STATE")
	circ_style=$(z2_circ_style_get "$name")
	[ -n "$circ_style" ] || circ_style=$(z2_circ_style_detect "$canon_parsed")
	last_test=$(jq -c --arg n "$name" '.profiles[$n].last_test // null' "$Z2_STATE")
	[ -n "$last_test" ] || last_test=null
	printf '%s' "$canon_parsed" | jq \
		--arg name "$name" \
		--argjson enabled "$enabled" \
		--arg port "$port" \
		--arg protocol "$proto" \
		--arg filter_l7 "$l7" \
		--arg hostlist "$host" \
		--argjson disabled "$disabled" \
		--argjson no_cycle "$no_cycle" \
		--argjson stale "$stale" \
		--arg circ_style "$circ_style" \
		--argjson last_test "$last_test" \
		'{
			name:$name, enabled:($enabled==1), port:$port, protocol:$protocol,
			filter_l7:$filter_l7, hostlist:$hostlist,
			circular: (.slots | length > 0),
			slots: [.slots[] | {id, final, label, hint:(.instances[0] // "")}],
			live_count: ([.slots[].id] | map(. as $id | select(($disabled | index($id)) == null)) | length),
			disabled:$disabled, no_cycle:$no_cycle, stale:$stale,
			circ_style:$circ_style,
			last_test:$last_test
		}'
}

z2_nfq_blocks_json() {
	z2_mkdirs
	raw="$Z2_TMP/nfq-blocks.jsonl"
	: > "$raw"
	for pid in $(pgrep nfqws2 2>/dev/null); do
		cmd="$Z2_TMP/nfqcmd.$pid"
		tr '\0' '\n' < "/proc/$pid/cmdline" > "$cmd" 2>/dev/null || continue
		awk -v pid="$pid" '
			function flush() {
				if (name == "" && payload == "" && qnum == "") return
				gsub(/"/, "", name); gsub(/"/, "", payload); gsub(/"/, "", proto); gsub(/"/, "", port); gsub(/"/, "", l7)
				printf "{\"pid\":%s,\"qnum\":\"%s\",\"name\":\"%s\",\"proto\":\"%s\",\"port\":\"%s\",\"l7\":\"%s\",\"payload\":\"%s\"}\n", pid, qnum, name, proto, port, l7, payload
				name=""; payload=""; proto=""; port=""; l7=""
			}
			$0 ~ /^--qnum=/ { qnum = substr($0, 8); next }
			$0 == "--new" { flush(); next }
			$0 ~ /^--name=/ { name = substr($0, 8); next }
			$0 ~ /^--filter-tcp=/ { proto = "tcp"; port = substr($0, 14); next }
			$0 ~ /^--filter-udp=/ { proto = "udp"; port = substr($0, 14); next }
			$0 ~ /^--filter-l7=/ { l7 = substr($0, 13); next }
			$0 == "--payload" { waitp = 1; next }
			waitp { payload = $0; waitp = 0; next }
			$0 ~ /^--payload=/ { payload = substr($0, 11); next }
			END { flush() }
		' "$cmd" >> "$raw"
		rm -f "$cmd"
	done
	if [ ! -s "$raw" ]; then
		printf '[]'
		return
	fi
	jq -s '
		def script_name:
			if .name != "" then .name
			elif (.payload | contains("discord")) then "discord_media"
			elif .payload == "stun" then "stun4all"
			elif (.payload | contains("quic")) then "quic4all"
			elif .payload != "" then .payload
			else ("q" + .qnum)
			end;
		def kind:
			if .name != "" then "profile"
			else "script"
			end;
		[.[] | {
			name: script_name,
			kind: kind,
			qnum: .qnum,
			pid: .pid,
			filter: (
				[ (if .proto != "" then .proto else empty end),
				  (if .port != "" then .port else empty end),
				  (if .l7 != "" then .l7 else empty end),
				  (if .payload != "" and .name == "" then .payload else empty end)
				] | join(" ")
			)
		}]
	' "$raw" 2>/dev/null || printf '[]'
}

z2_status_json() {
	z2_state_init
	installed=0
	z2_installed && installed=1
	running=0
	z2_running && running=1
	autostart=0
	z2_autostart && autostart=1
	enabled=$(z2_uci_get zapret2.main.enabled)
	[ "$enabled" = "1" ] && enabled=1 || enabled=0
	v1i=0; v1r=0; v1a=0
	z1_installed && v1i=1
	z1_running && v1r=1
	z1_autostart && v1a=1
	bcw=0
	z2_bcw_available && bcw=1
	bcw_ver=""
	[ "$bcw" -eq 1 ] && bcw_ver="blockcheckw"
	nfq=$(pgrep nfqws2 2>/dev/null | wc -l)
	nfq_blocks=$(z2_nfq_blocks_json)
	[ -n "$nfq_blocks" ] || nfq_blocks='[]'
	profiles='[]'
	if [ "$installed" -eq 1 ]; then
		plist="["
		first=1
		for n in $(z2_strategy_names); do
			pj=$(z2_profile_json "$n")
			[ "$first" -eq 1 ] && first=0 || plist="$plist,"
			plist="$plist$pj"
		done
		plist="$plist]"
		profiles="$plist"
	fi
	read -r gv xtreme <<EOF
$(z2_detect_games)
EOF
	gv_json="null"
	[ -n "$gv" ] && [ "$gv" != "0" ] && gv_json="$gv"
	backup=0
	[ -f "$Z2_BACKUP" ] && backup=1
	job='{"running":false}'
	[ -f "$Z2_JOB" ] && job=$(cat "$Z2_JOB")
	bcw_run=0
	z2_bcw_running && bcw_run=1
	stjob='{"running":false}'
	[ -f "$Z2_ST_JOB" ] && stjob=$(cat "$Z2_ST_JOB")
	st_run=0
	z2_slottest_running && st_run=1
	stlogf="$Z2_TMP/slottest-log-tail.txt"
	if [ -f "$Z2_ST_LOG" ]; then
		tail -n 40 "$Z2_ST_LOG" > "$stlogf" 2>/dev/null || : > "$stlogf"
	else
		: > "$stlogf"
	fi
	results='[]'
	res_list=""
	for f in "$Z2_BCW_DIR"/*.json; do
		[ -s "$f" ] || continue
		jq -e 'type=="object"' "$f" >/dev/null 2>&1 || continue
		res_list="$res_list $f"
	done
	if [ -n "$res_list" ]; then
		# shellcheck disable=SC2086
		results=$(jq -s '[.[] | {stamp, mode, domains, proto, verified, count:(.strategies|length)}] | sort_by(.stamp) | reverse' $res_list 2>/dev/null)
		[ -n "$results" ] || results='[]'
	fi
	logf="$Z2_TMP/bcw-log-tail.txt"
	if [ -f "$Z2_JOB_LOG" ]; then
		tail -n 60 "$Z2_JOB_LOG" > "$logf" 2>/dev/null || : > "$logf"
	else
		: > "$logf"
	fi
	jq -n \
		--argjson installed "$installed" \
		--argjson running "$running" \
		--argjson autostart "$autostart" \
		--argjson enabled "$enabled" \
		--argjson v1i "$v1i" --argjson v1r "$v1r" --argjson v1a "$v1a" \
		--argjson bcw "$bcw" --arg bcw_ver "$bcw_ver" \
		--argjson nfq "$nfq" \
		--argjson nfq_blocks "$nfq_blocks" \
		--argjson profiles "$profiles" \
		--argjson gv "$gv_json" \
		--argjson xtreme "${xtreme:-0}" \
		--argjson backup "$backup" \
		--argjson job "$job" \
		--argjson now "$(date +%s)" \
		--argjson bcw_run "$bcw_run" \
		--argjson results "$results" \
		--argjson bcwcfg "$(z2_bcw_settings)" \
		--arg version "$(z2_pkg_version)" \
		--argjson stjob "$stjob" \
		--argjson st_run "$st_run" \
		--rawfile logtxt "$logf" \
		--rawfile stlog "$stlogf" \
		'{
			installed:($installed==1), running:($running==1), autostart:($autostart==1), enabled:($enabled==1),
			version:$version,
			zapret1:{installed:($v1i==1), running:($v1r==1), autostart:($v1a==1)},
			blockcheckw:{installed:($bcw==1), version:$bcw_ver, running:($bcw_run==1)},
			nfqws2:$nfq,
			nfq_blocks:$nfq_blocks,
			profiles:$profiles,
			games:{active:$gv, xtreme:($xtreme==1)},
			backup:{exists:($backup==1)},
			job:($job + {now:$now}),
			bcw:$bcwcfg,
			results:$results,
			log:$logtxt,
			slottest:($stjob + {running:($st_run==1), log:$stlog})
		}'
}

z2_backup_save() {
	z2_mkdirs
	[ -f "$Z2_CONF" ] || return 1
	cp "$Z2_CONF" "$Z2_BACKUP"
}

z2_backup_restore() {
	[ -f "$Z2_BACKUP" ] || return 1
	cp "$Z2_BACKUP" "$Z2_CONF"
	uci -q commit zapret2 >/dev/null 2>&1 || true
	rm -f "$Z2_STATE"
	z2_state_init
}

z2_result_detail() {
	stamp="$1"
	f=$(ls -t "$Z2_BCW_DIR"/"$stamp"*.json 2>/dev/null | head -1)
	[ -z "$f" ] && f="$Z2_BCW_DIR/${stamp}.json"
	[ -f "$f" ] || return 1
	cat "$f"
}
