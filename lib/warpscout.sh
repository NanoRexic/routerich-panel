#!/bin/sh

WS_BIN="${WS_BIN:-/usr/bin/warpscout}"
WS_ACCT="/etc/routerich-panel/warpscout-account.json"
WS_DIR="/tmp/routerich-warpscout"
WS_JOB="$WS_DIR/job.json"
WS_LOG="$WS_DIR/scan.log"
WS_CONF="$WS_DIR/best.conf"
WS_REPORT="$WS_DIR/report.txt"
WS_RESULTS="$WS_DIR/results.json"
WS_PID="$WS_DIR/scan.pid"
WS_LOCK="$WS_DIR/run.lock"
WS_REPO="vernette/warpscout"
WS_TIMEOUT=240

ws_now() { date +%s; }

ws_job_write() {
	mkdir -p "$WS_DIR"
	tmp="$WS_JOB.$$"
	printf '%s' "$1" > "$tmp" && mv "$tmp" "$WS_JOB"
}

ws_log_tail() {
	[ -f "$WS_LOG" ] || { printf ''; return 0; }
	tail -n 12 "$WS_LOG" 2>/dev/null | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | tr -d '\r'
}

ws_pid_alive() {
	pid=$(cat "$WS_PID" 2>/dev/null)
	[ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

ws_arch() {
	case "$(uname -m)" in
		x86_64|amd64) printf 'amd64' ;;
		aarch64|arm64) printf 'arm64' ;;
		*) return 1 ;;
	esac
}

ws_dl() {
	url="$1"
	out="$2"
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --connect-timeout 15 --max-time 90 --retry 2 -A 'Mozilla/5.0' -o "$out" "$url" && return 0
	fi
	if command -v wget >/dev/null 2>&1; then
		wget -q --no-cache -T 90 -U 'Mozilla/5.0' -O "$out" "$url" && return 0
	fi
	return 1
}

ws_resolve_ver() {
	eff=$(curl -Ls -o /dev/null -w '%{url_effective}' --connect-timeout 10 --max-time 20 \
		"https://github.com/${WS_REPO}/releases/latest" 2>/dev/null)
	ver="${eff##*/}"
	ver="${ver#v}"
	case "$ver" in
		*[!0-9.]*|'') printf '0.16.0' ;;
		*) printf '%s' "$ver" ;;
	esac
}

ws_available() {
	[ -x "$WS_BIN" ] || command -v warpscout >/dev/null 2>&1
}

ws_install() {
	ws_available && return 0
	arch=$(ws_arch) || return 1
	ver=$(ws_resolve_ver)
	workdir="$WS_DIR/install"
	rm -rf "$workdir"
	mkdir -p "$workdir" || return 1
	tarball="warpscout_${ver}_linux_${arch}.tar.gz"
	url="https://github.com/${WS_REPO}/releases/download/v${ver}/${tarball}"
	ws_dl "$url" "$workdir/$tarball" || { rm -rf "$workdir"; return 1; }
	tar -xzf "$workdir/$tarball" -C "$workdir" >/dev/null 2>&1 || { rm -rf "$workdir"; return 1; }
	bin=""
	[ -f "$workdir/warpscout" ] && bin="$workdir/warpscout"
	[ -z "$bin" ] && bin=$(find "$workdir" -type f -name warpscout 2>/dev/null | head -n1)
	[ -n "$bin" ] && [ -f "$bin" ] || { rm -rf "$workdir"; return 1; }
	cp "$bin" "$WS_BIN" || { rm -rf "$workdir"; return 1; }
	chmod 755 "$WS_BIN"
	rm -rf "$workdir"
	[ -x "$WS_BIN" ]
}

ws_register() {
	[ -s "$WS_ACCT" ] && jq -e '.private_key and .peer_public_key' "$WS_ACCT" >/dev/null 2>&1 && return 0
	mkdir -p /etc/routerich-panel "$WS_DIR"
	GOMEMLIMIT=32MiB "$WS_BIN" register -plain -a "$WS_ACCT" >/dev/null 2>>"$WS_LOG"
	[ -s "$WS_ACCT" ] && jq -e '.private_key and .peer_public_key' "$WS_ACCT" >/dev/null 2>&1
}

ws_job_status_json() {
	if [ -f "$WS_JOB" ]; then
		cat "$WS_JOB"
		return 0
	fi
	jq -n '{ok:true, running:false, phase:"idle"}'
}

ws_urldecode() {
	printf '%s' "$1" | sed 's/+/ /g; s/%3[Aa]/:/g; s/%2[Ee]/./g'
}

ws_parse_results() {
	log="$WS_LOG"
	[ -f "$log" ] || return 1
	plain=$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log" | tr -d '\r')
	proto=$(printf '%s\n' "$plain" | sed -n 's/^Proto:[[:space:]]*//p' | head -n1)
	junk=$(printf '%s\n' "$plain" | sed -n 's/^Junk:[[:space:]]*//p' | head -n1)
	nodes=$(printf '%s\n' "$plain" | sed -n 's/^Nodes:[[:space:]]*//p' | head -n1)
	seen=$(printf '%s\n' "$plain" | sed -n 's/^Seen as:[[:space:]]*//p' | head -n1)
	working_line=$(printf '%s\n' "$plain" | sed -n 's/^Working:[[:space:]]*//p' | head -n1)
	working=$(printf '%s' "$working_line" | awk '{print $1+0}')
	probed=$(printf '%s' "$working_line" | awk '{print $3+0}')
	rows=$(printf '%s\n' "$plain" | sed 's/│/|/g' | awk -F '|' '
		$0 ~ /ENDPOINT PING/ { next }
		$0 ~ /[─╭╰├┬┤]/ { next }
		NF < 8 { next }
		{
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", $3)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", $5)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", $6)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", $7)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", $8)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", $9)
			if ($3 !~ /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+/) next
			printf "{\"subnet\":%s,\"endpoint\":%s,\"ep_ping\":%s,\"tun_ping\":%s,\"loss\":%s,\"seen_as\":%s,\"node\":%s,\"location\":%s}\n",
				jqstr($2), jqstr($3), jqstr($4), jqstr($5), jqstr($6), jqstr($7), jqstr($8), jqstr($9)
		}
		function jqstr(s) {
			gsub(/\\/, "\\\\", s)
			gsub(/"/, "\\\"", s)
			return "\"" s "\""
		}
	')
	[ -n "$rows" ] || return 1
	rows_json=$(printf '%s\n' "$rows" | jq -s '.')
	now=$(date +%s)
	stamp=$(date '+%d.%m.%Y %H:%M')
	jq -n \
		--arg proto "${proto:-AWG}" \
		--arg junk "$junk" \
		--arg nodes "$nodes" \
		--arg seen "$seen" \
		--arg stamp "$stamp" \
		--argjson working "${working:-0}" \
		--argjson probed "${probed:-0}" \
		--argjson scanned "$now" \
		--argjson rows "$rows_json" \
		'{proto:$proto, junk:$junk, nodes:$nodes, seen_as:$seen, working:$working, probed:$probed, scanned_at:$scanned, scanned_at_text:$stamp, rows:$rows}' \
		> "$WS_RESULTS"
	[ -s "$WS_RESULTS" ]
}

ws_pick_config() {
	WS_PICKED_EP="$1"
	[ -n "$WS_PICKED_EP" ] || return 1
	priv=$(jq -r '.private_key // empty' "$WS_ACCT" 2>/dev/null)
	peer=$(jq -r '.peer_public_key // empty' "$WS_ACCT" 2>/dev/null)
	ipv4=$(jq -r '.ipv4 // empty' "$WS_ACCT" 2>/dev/null)
	ipv4="${ipv4%%/*}"
	if [ -z "$priv" ] || [ -z "$peer" ] || [ -z "$ipv4" ]; then
		json_body=$(warp_cf_register 2>/dev/null) || return 1
	else
		json_body=$(jq -n --arg privKey "$priv" --arg peer_pub "$peer" --arg client_ipv4 "$ipv4" \
			'{privKey:$privKey,peer_pub:$peer_pub,client_ipv4:$client_ipv4}')
	fi
	generate_random_endpoint() { printf '%s' "$WS_PICKED_EP"; }
	config=$(build_warpgen_config "$json_body" 2 2>/dev/null) || return 1
	validate_config "$config" || return 1
	jq -n --arg config "$config" --arg endpoint "$WS_PICKED_EP" \
		'{ok:true, config:$config, endpoint:$endpoint}'
}

ws_run_job() {
	mkdir -p "$WS_DIR"
	: > "$WS_LOG"
	rm -f "$WS_CONF" "$WS_REPORT" "$WS_RESULTS"
	now=$(ws_now)
	if ! ws_available; then
		ws_job_write "$(jq -n --argjson started "$now" '{ok:true,running:true,phase:"installing",started_at:$started,error:""}')"
		if ! ws_install; then
			ws_job_write "$(jq -n --argjson started "$now" --arg error "Не удалось установить warpscout (нужны linux-arm64 или linux-amd64)." '{ok:false,running:false,phase:"error",started_at:$started,error:$error}')"
			rmdir "$WS_LOCK" 2>/dev/null
			return 1
		fi
	fi
	if ! [ -s "$WS_ACCT" ] || ! jq -e '.private_key and .peer_public_key' "$WS_ACCT" >/dev/null 2>&1; then
		ws_job_write "$(jq -n --argjson started "$now" '{ok:true,running:true,phase:"registering",started_at:$started,error:""}')"
		if ! ws_register; then
			ws_job_write "$(jq -n --argjson started "$now" --arg error "Не удалось зарегистрировать аккаунт WARP." '{ok:false,running:false,phase:"error",started_at:$started,error:$error}')"
			rmdir "$WS_LOCK" 2>/dev/null
			return 1
		fi
	fi
	ws_job_write "$(jq -n --argjson started "$now" '{ok:true,running:true,phase:"scanning",started_at:$started,error:""}')"
	GOMEMLIMIT=32MiB
	export GOMEMLIMIT
	"$WS_BIN" scan -p awg -P -plain \
		-a "$WS_ACCT" \
		-jt 4 -n 3 -t 2 \
		-o "$WS_REPORT" \
		>>"$WS_LOG" 2>&1 &
	spid=$!
	elapsed=0
	rc=0
	while kill -0 "$spid" 2>/dev/null; do
		if [ "$elapsed" -ge "$WS_TIMEOUT" ]; then
			kill "$spid" 2>/dev/null
			wait "$spid" 2>/dev/null
			rc=124
			break
		fi
		sleep 5
		elapsed=$((elapsed + 5))
	done
	if [ "$rc" -eq 0 ]; then
		wait "$spid"
		rc=$?
	fi
	if [ "$rc" -ne 0 ]; then
		err="Сканирование не нашло рабочий эндпоинт. Попробуйте ещё раз."
		ws_job_write "$(jq -n --argjson started "$now" --arg error "$err" '{ok:false,running:false,phase:"error",started_at:$started,error:$error}')"
		rmdir "$WS_LOCK" 2>/dev/null
		return 1
	fi
	if ! ws_parse_results; then
		err="Сканирование завершилось, но таблица эндпоинтов пуста."
		ws_job_write "$(jq -n --argjson started "$now" --arg error "$err" '{ok:false,running:false,phase:"error",started_at:$started,error:$error}')"
		rmdir "$WS_LOCK" 2>/dev/null
		return 1
	fi
	endpoint=$(jq -r '.rows[0].endpoint // empty' "$WS_RESULTS" 2>/dev/null)
	ws_job_write "$(jq -n --argjson started "$now" --arg endpoint "$endpoint" '{ok:true,running:false,phase:"done",started_at:$started,error:"",endpoint:$endpoint}')"
	rmdir "$WS_LOCK" 2>/dev/null
	return 0
}

ws_running() {
	pid=$(cat "$WS_PID" 2>/dev/null)
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
		return 0
	fi
	return 1
}

ws_spawn() {
	runner="$WS_DIR/run.sh"
	mkdir -p "$WS_DIR"
	cat > "$runner" <<'EOF'
#!/bin/sh
trap '' HUP INT QUIT TERM
exec </dev/null >/dev/null 2>&1
. /etc/routerich-panel/warpscout.sh
ws_run_job
EOF
	chmod 755 "$runner"
	rm -f "$WS_PID"
	# Detach from the CGI pipe. start-stop-daemon -b from uhttpd leaves
	# an empty chunked body on the first poll after another generate-awg.
	if command -v setsid >/dev/null 2>&1; then
		setsid /bin/sh "$runner" </dev/null >/dev/null 2>&1 &
		echo $! > "$WS_PID"
	elif command -v nohup >/dev/null 2>&1; then
		nohup /bin/sh "$runner" </dev/null >/dev/null 2>&1 &
		echo $! > "$WS_PID"
	else
		/bin/sh "$runner" </dev/null >/dev/null 2>&1 &
		echo $! > "$WS_PID"
	fi
}

ws_start() {
	trap '' HUP INT QUIT
	ws_running && return 0
	mkdir -p "$WS_DIR"
	if ! mkdir "$WS_LOCK" 2>/dev/null; then
		ws_running && return 0
		rmdir "$WS_LOCK" 2>/dev/null
		mkdir "$WS_LOCK" 2>/dev/null || return 0
	fi
	now=$(ws_now)
	ws_job_write "$(jq -n --argjson started "$now" '{ok:true,running:true,phase:"starting",started_at:$started,error:""}')"
	ws_spawn
}

ws_status_payload() {
	log=$(ws_log_tail)
	scout='{}'
	if [ -s "$WS_RESULTS" ]; then
		scout=$(cat "$WS_RESULTS")
		if ! printf '%s' "$scout" | jq -e '.scanned_at' >/dev/null 2>&1; then
			mtime=$(stat -c %Y "$WS_RESULTS" 2>/dev/null || date +%s)
			stamp=$(date -d "@$mtime" '+%d.%m.%Y %H:%M' 2>/dev/null || date '+%d.%m.%Y %H:%M')
			scout=$(printf '%s' "$scout" | jq --argjson ts "$mtime" --arg stamp "$stamp" \
				'.scanned_at=$ts | .scanned_at_text=$stamp')
		fi
	fi
	if [ -f "$WS_JOB" ]; then
		jq -n --slurpfile job "$WS_JOB" --arg log "$log" --argjson scout "$scout" \
			'{ok:true, running:($job[0].running // false), phase:($job[0].phase // "idle"),
			  error:($job[0].error // ""), endpoint:($job[0].endpoint // ""),
			  started_at:($job[0].started_at // 0), log:$log, scout:$scout}'
	else
		jq -n --arg log "$log" --argjson scout "$scout" \
			'{ok:true, running:false, phase:"idle", error:"", endpoint:"", started_at:0, log:$log, scout:$scout}'
	fi
}

ws_cgi() {
	trap '' HUP INT QUIT
	pick=$(ws_urldecode "$(get_query_param pick "")")
	if [ -n "$pick" ]; then
		case "$pick" in
			*[!0-9.:]*) json_error "Некорректный эндпоинт"; return 0 ;;
		esac
		if ! ws_pick_config "$pick"; then
			json_error "Не удалось собрать конфиг для $pick"
			return 0
		fi
		return 0
	fi

	want_start=$(get_query_param start "")
	running=$(jq -r '.running // false' "$WS_JOB" 2>/dev/null)
	if [ "$want_start" = "1" ]; then
		if ! ws_running && [ "$running" != "true" ]; then
			ws_start </dev/null
		fi
	fi
	ws_status_payload
}
