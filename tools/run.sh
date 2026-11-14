#!/bin/bash
# Kullanım: bash tools/run.sh realtime|capture
# Yerel http sunucusu + headless Chrome açar, CDP betiğini koşar, sonra ikisini de kapatır (hata olsa da).
set -u
B="$(cd "$(dirname "$0")/.." && pwd)"   # bu klasörün kökü
SCR="${TMPDIR:-/tmp}/threejs-wasd"; mkdir -p "$SCR" "$B/logs"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HTTP_PORT=8765; export CDP_PORT=9333
MODE=$1

python3 -m http.server $HTTP_PORT --bind 127.0.0.1 --directory "$B/web" > "$B/logs/http_server_$MODE.log" 2>&1 &
HTTP_PID=$!
rm -rf "$SCR/chrome-prof"
nice -n 10 "$CHROME" --headless=new --remote-debugging-port=$CDP_PORT --user-data-dir="$SCR/chrome-prof" \
  --window-size=1080,1080 --force-device-scale-factor=1 --hide-scrollbars --no-first-run --no-default-browser-check \
  --disable-background-timer-throttling --disable-renderer-backgrounding --mute-audio about:blank \
  > "$B/logs/chrome_stderr_$MODE.log" 2>&1 &
CHROME_PID=$!
cleanup() { kill $CHROME_PID $HTTP_PID 2>/dev/null; wait $CHROME_PID $HTTP_PID 2>/dev/null; }
trap cleanup EXIT
for i in $(seq 1 100); do curl -s "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null && break; sleep 0.1; done
curl -s "http://127.0.0.1:$CDP_PORT/json/version" > "$B/logs/chrome_version.json"

if [ "$MODE" = realtime ]; then
  nice -n 10 node "$B/tools/cdp_run.mjs" realtime "http://127.0.0.1:$HTTP_PORT/index.html?auto=1" 20 "$B/logs/web_realtime_console.log"
else
  rm -rf "$SCR/frames_raw"
  nice -n 10 node "$B/tools/cdp_run.mjs" capture "http://127.0.0.1:$HTTP_PORT/index.html?auto=1&capture=1" \
    "$SCR/frames_raw" 240 "$B/logs/web_capture_console.log"
fi
