#!/bin/sh
# Named zapret2 profiles from Zapret-Manager (TCP 443 and games).

z2_preset_script() {
	case "$1" in
		V_circular)
			cat <<'EOF'
--out-range=-s34228
--payload=tls_client_hello
--in-range=-s5556 --lua-desync=circular:fails=3:maxtime=20
--in-range=x
--lua-desync=multisplit:pos=2:seqovl=681:seqovl_pattern=blob_stun:strategy=1
--lua-desync=fake:blob=blob_tls_clienthello_www_google_com:optional:tcp_ts=-600000:repeats=8:tls_mod=rnd,dupsid,sni=www.google.com:strategy=2
--lua-desync=multisplit:pos=1:seqovl=681:seqovl_pattern=blob_stun:strategy=2
--lua-desync=hostfakesplit:host=ozon.ru:tcp_ts=-600000:tcp_md5:repeats=4:strategy=3
--lua-desync=multisplit:pos=1:seqovl=582:seqovl_pattern=blob_stun:strategy=4
--lua-desync=fake:blob=blob_stun:tcp_seq=0:tcp_ack=-66000:badsum:strategy=5
--lua-desync=fakeddisorder:pos=1:pattern=blob_tls_clienthello_www_google_com:tcp_seq=0:tcp_ack=-66000:badsum:strategy=5
--lua-desync=hostfakesplit:midhost=host-2:host=i2.photo.2gis.com:tcp_seq=0:tcp_ack=-66000:badsum:strategy=6
--lua-desync=fake:blob=blob_stun:tcp_seq=-10000:tcp_ack=-66000:badsum:repeats=8:strategy=7
--lua-desync=multisplit:pos=1:seqovl=654:seqovl_pattern=blob_stun:strategy=7
--lua-desync=fake:blob=blob_tls_clienthello_www_4pda_to:optional:tcp_ts=-600000:strategy=8
--lua-desync=hostfakesplit:host=ozon.ru:tcp_seq=0:tcp_ack=-66000:badsum:strategy=9
--lua-desync=fake:blob=blob_tls_clienthello_www_google_com:optional:tcp_ts=-600000:tls_mod=rnd,sni=maxcdn.bootstrapcdn.com:strategy=10
--lua-desync=multisplit:pos=2:strategy=10:final
EOF
			;;
		v1) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=multisplit:pos=2:seqovl=681:seqovl_pattern=blob_stun' ;;
		v2) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=fake:blob=blob_tls_clienthello_www_google_com:optional:tcp_ts=-600000:repeats=8:tls_mod=rnd,dupsid,sni=www.google.com' '--lua-desync=multisplit:pos=1:seqovl=681:seqovl_pattern=blob_stun' ;;
		v3) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=hostfakesplit:host=ozon.ru:tcp_ts=-600000:tcp_md5:repeats=4' ;;
		v4) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=multisplit:pos=1:seqovl=582:seqovl_pattern=blob_stun' ;;
		v5) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=fake:blob=blob_stun:tcp_seq=0:tcp_ack=-66000:badsum' '--lua-desync=fakeddisorder:pos=1:pattern=blob_tls_clienthello_www_google_com:tcp_seq=0:tcp_ack=-66000:badsum' ;;
		v6) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=hostfakesplit:midhost=host-2:host=i2.photo.2gis.com:tcp_seq=0:tcp_ack=-66000:badsum' ;;
		v7) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=fake:blob=blob_stun:tcp_seq=-10000:tcp_ack=-66000:badsum:repeats=8' '--lua-desync=multisplit:pos=1:seqovl=654:seqovl_pattern=blob_stun' ;;
		v8) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=fake:blob=blob_tls_clienthello_www_4pda_to:optional:tcp_ts=-600000' ;;
		v9) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=hostfakesplit:host=ozon.ru:tcp_seq=0:tcp_ack=-66000:badsum' ;;
		v10) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=fake:blob=blob_tls_clienthello_www_google_com:optional:tcp_ts=-600000:tls_mod=rnd,sni=maxcdn.bootstrapcdn.com' '--lua-desync=multisplit:pos=2' ;;
		Yv01) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=multidisorder:pos=7,sld+1:ip_autottl=2,2-12' ;;
		Yv02) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=multidisorder:pos=1,midsld,endhost-1:tcp_md5' ;;
		Yv03) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=fake:blob=0x00000000:tcp_seq=-10000:tcp_ack=-66000:repeats=2:tls_mod=rnd,dupsid,sni=www.google.com' '--lua-desync=multisplit:pos=1,midsld' ;;
		Yv04) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=multidisorder:pos=1,midsld' ;;
		Yv05) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=multidisorder:pos=2,5,105,host+5,sld-1,endsld-5,endsld' ;;
		Yv06) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=multidisorder:pos=1,midsld' ;;
		Yv07) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=fake:blob=0x00000000:tcp_seq=-10000:tcp_ack=-66000' '--lua-desync=fake:blob=0x0F0F0F0F:tcp_seq=-10000:tcp_ack=-66000' '--lua-desync=fake:blob=blob_tls_clienthello_www_google_com:optional:tcp_seq=-10000:tcp_ack=-66000:tls_mod=rnd,dupsid,sni=fonts.google.com' '--lua-desync=multidisorder:pos=10,midsld:seqovl=336:seqovl_pattern=blob_tls_clienthello_www_google_com' ;;
		Yv08) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=hostfakesplit:host=google.com:tcp_ts=-600000' ;;
		Yv09) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=multidisorder:pos=1,sniext+1,host+1,midsld-2,midsld,midsld+2,endhost-1' ;;
		Yv10) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=multidisorder:pos=1,2,3,5,105,host+5,sld-1,endsld-5,endsld' ;;
		Yv11) printf '%s\n' '--payload=tls_client_hello' '--lua-desync=fake:blob=0x00000000:tcp_seq=-10000:tcp_ack=-66000:repeats=2:tls_mod=rnd,dupsid,sni=www.google.com' '--lua-desync=multisplit:pos=1,sniext+1,host+1,midsld-2,midsld,midsld+2,endhost-1' ;;
		Discord_circular)
			cat <<'EOF'
--payload=tls_client_hello
--in-range=-s5556
--lua-desync=circular:fails=3:maxtime=20:nld=2
--in-range=x
--lua-desync=fake:blob=fake_default_tls:tcp_flags_set=SYN:strategy=1
--lua-desync=multidisorder:pos=2,midsld:seqovl=1:seqovl_pattern=fake_default_tls:strategy=1
--lua-desync=fake:blob=fake_default_tls:badsum:tcp_seq=10000000:repeats=1:strategy=2
--lua-desync=multisplit:blob=fake_default_tls:badsum:tcp_ack=-66000:pos=2:nodrop:strategy=2:final
EOF
			;;
		games_udp)
			printf '%s\n' '--out-range=<n4' '--payload=known,unknown' '--lua-desync=fake:blob=blob_stun:repeats=10:payload=known,unknown'
			;;
		games_tcp)
			printf '%s\n' '--out-range=<n4' '--payload=known,unknown' '--lua-desync=fake:blob=blob_stun:repeats=8:tcp_ts=-600000:payload=known,unknown' '--lua-desync=fake:blob=blob_tls_clienthello_www_onetrust_com:repeats=8:tcp_ts=-600000:payload=known,unknown' '--lua-desync=multisplit:pos=1:seqovl=664:seqovl_pattern=blob_stun:repeats=8:payload=known,unknown'
			;;
		*) return 1 ;;
	esac
}
