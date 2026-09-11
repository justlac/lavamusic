#!/usr/bin/env bash
# Natural-chain test: NO withClient override, so youtube-source walks the
# configured client list exactly as it will in production. Then exercises the
# two paths the bot actually calls: loadtracks (search + direct URL).
set -uo pipefail
BASE="${BASE:-http://localhost:2333}"
AUTH=(-H "Authorization: youshallnotpass")
CAP=$((1200 * 1024))

VIDS=(kJQP7kiw5Fk 9bZkp7q19f0 fJ9rUzIMcZQ JGwWNGJdvx8 OPf0YbXqDm0 CevxZvSJLk8 YQHsXMglC9A jdWhJcrrjQs)

echo "### playback via the natural client chain (no override)"
printf '%-14s %9s %8s   %s\n' VIDEO BYTES KB/S VERDICT
ok=0; fail=0
for v in "${VIDS[@]}"; do
  s=$(date +%s%N)
  b=$( { timeout 9 curl -sS -N "${AUTH[@]}" "$BASE/youtube/stream/$v" 2>/dev/null || true; } | head -c "$CAP" | wc -c )
  e=$(date +%s%N); ms=$(( (e-s)/1000000 )); [ "$ms" -lt 1 ] && ms=1
  if [ "$b" -lt 4096 ]; then
    msg=$(timeout 20 curl -sS "${AUTH[@]}" "$BASE/youtube/stream/$v" 2>&1 | grep -oE '"message":"[^"]*"' | cut -c12- | head -c 200)
    printf '%-14s %9d %8d   FAIL  %s\n' "$v" "$b" 0 "$msg"; fail=$((fail+1))
  else
    printf '%-14s %9d %8d   OK\n' "$v" "$b" $(( b/ms )); ok=$((ok+1))
  fi
done
echo "-> chain: ok=$ok fail=$fail  of ${#VIDS[@]}"
echo

echo "### which client the chain actually selected (from node logs)"
docker logs --since 3m lava-rig-lavalink 2>&1 \
  | grep -oE 'Selected format [0-9]+ for [A-Za-z0-9_-]+|REST streaming [A-Za-z0-9_-]+ attempting to use client [A-Z0-9_]+' \
  | tail -20
echo

echo "### loadtracks - search"
curl -fsS "${AUTH[@]}" "$BASE/v4/loadtracks?identifier=ytsearch:daft%20punk%20around%20the%20world" 2>/dev/null \
  | grep -oE '"loadType":"[a-z]+"|"title":"[^"]{0,40}"' | head -4
echo
echo "### loadtracks - direct URL"
curl -fsS "${AUTH[@]}" "$BASE/v4/loadtracks?identifier=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DkJQP7kiw5Fk" 2>/dev/null \
  | grep -oE '"loadType":"[a-z]+"|"title":"[^"]{0,40}"|"exception".*' | head -4
echo
echo "### loadtracks - playlist"
curl -fsS "${AUTH[@]}" "$BASE/v4/loadtracks?identifier=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DPLBCF2DAC6FFB574DE" 2>/dev/null \
  | grep -oE '"loadType":"[a-z]+"|"name":"[^"]{0,40}"' | head -3
