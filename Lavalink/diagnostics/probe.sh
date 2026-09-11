#!/usr/bin/env bash
# Per-client YouTube playback probe against a running lava-rig node.
#
# Uses youtube-source's own REST route, which runs the FULL playback path
# (loadFormats -> InnerTube /player -> cipher -> PersistentHttpStream) and
# streams real audio bytes back. No Discord, no voice connection needed.
#
#   OK        gate 1-4 clear, stream ungated
#   THROTTLED HTTP 200 but ~realtime speed -> the `n` param transform is wrong
#   FAIL      gate failure; the error body is printed

set -uo pipefail

BASE="${BASE:-http://localhost:2333}"
PW="${PW:-youshallnotpass}"
AUTH=(-H "Authorization: ${PW}")
CAP=$((1500 * 1024))   # stop after 1.5 MB
TMO="${TMO:-7}"        # seconds per attempt

# These are the InnerTube *identifiers* the node logs at boot, NOT the config
# names: WEBEMBEDDED->WEB_EMBEDDED_PLAYER, MUSIC->WEB_REMIX, TV->TVHTML5.
# withClient matches the identifier.
CLIENTS=(${CLIENTS:-TVHTML5_SIMPLY ANDROID_VR WEB WEB_EMBEDDED_PLAYER WEB_REMIX MWEB IOS TVHTML5 ANDROID_MUSIC})
# Deliberately NOT relying on dQw4w9WgXcQ alone - it is known to bypass some
# checks. It is kept last purely as a control.
VIDS=(${VIDS:-kJQP7kiw5Fk 9bZkp7q19f0 fJ9rUzIMcZQ dQw4w9WgXcQ})

hr() { printf '%s\n' "----------------------------------------------------------------------"; }

echo "### node"
curl -fsS "${AUTH[@]}" "$BASE/version" 2>/dev/null && echo || { echo "node not reachable at $BASE"; exit 1; }
echo -n "plugin: "
curl -fsS "${AUTH[@]}" "$BASE/v4/info" 2>/dev/null \
  | grep -oE '"name":"youtube-plugin","version":"[^"]*"' || echo "(youtube-plugin NOT loaded)"
echo
echo "### registered client identifiers (from the node)"
docker logs lava-rig-lavalink 2>&1 | grep -oiE 'clients: \[[^]]*\]|Initialised [0-9]+ clients?[^.]*' | tail -3
hr

declare -A RESULT
printf '%-16s %-14s %8s %10s   %s\n' CLIENT VIDEO BYTES KB/S VERDICT
hr
for c in "${CLIENTS[@]}"; do
  for v in "${VIDS[@]}"; do
    url="$BASE/youtube/stream/$v?withClient=$c"
    s=$(date +%s%N)
    bytes=$( { timeout "$TMO" curl -sS -N "${AUTH[@]}" "$url" 2>/dev/null || true; } | head -c "$CAP" | wc -c )
    e=$(date +%s%N)
    ms=$(( (e - s) / 1000000 )); [ "$ms" -lt 1 ] && ms=1
    kbs=$(( bytes / ms ))            # bytes/ms == KB/s

    # A few hundred bytes is a JSON error body, not audio. Real audio is MB.
    if [ "$bytes" -lt 4096 ]; then
      verdict="FAIL"
      body=$(timeout 20 curl -sS "${AUTH[@]}" "$url" 2>&1 \
             | grep -oE '"message":"[^"]*"' | cut -c12- | head -c 300)
      RESULT["$c/$v"]="FAIL"
    elif [ "$kbs" -lt 60 ]; then
      verdict="THROTTLED"; body=""
      RESULT["$c/$v"]="THROTTLED"
    else
      verdict="OK"; body=""
      RESULT["$c/$v"]="OK"
    fi

    printf '%-16s %-14s %8d %10d   %s\n' "$c" "$v" "$bytes" "$kbs" "$verdict"
    [ -n "$body" ] && printf '%18s%s\n' "" "${body}"
  done
done
hr

echo "### summary per client"
for c in "${CLIENTS[@]}"; do
  ok=0; th=0; fa=0
  for v in "${VIDS[@]}"; do
    case "${RESULT[$c/$v]:-FAIL}" in
      OK) ok=$((ok+1));; THROTTLED) th=$((th+1));; *) fa=$((fa+1));;
    esac
  done
  printf '%-16s ok=%d throttled=%d fail=%d\n' "$c" "$ok" "$th" "$fa"
done
hr

echo "### search path (gate 1 only, no cipher)"
curl -fsS "${AUTH[@]}" "$BASE/v4/loadtracks?identifier=ytsearch:architects%20animals" 2>/dev/null \
  | head -c 260; echo
