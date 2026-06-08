#!/usr/bin/env bash
# Send a Telegram message via the bot in ../.env.
# Usage:  tg-send.sh "text"   |   tg-send.sh --file /path/to/file
# Prints HTTP status to stdout; exits 0 ONLY on HTTP 200.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SELF_DIR/../.env"
[ -r "$ENV_FILE" ] || { echo "tg-send: .env not readable ($ENV_FILE)" >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a
{ [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; } || { echo "tg-send: TG_BOT_TOKEN/TG_CHAT_ID missing" >&2; exit 2; }

mode="${1:-}"
if [ "$mode" = "--file" ]; then
  { [ -n "${2:-}" ] && [ -r "$2" ]; } || { echo "tg-send: --file needs a readable path" >&2; exit 2; }
  TEXT="$(cat "$2")"
else
  TEXT="$mode"
fi
[ -z "$TEXT" ] && { echo "tg-send: empty text" >&2; exit 2; }

# char-safe truncate to <4096 (Telegram hard limit)
TEXT="$(printf '%s' "$TEXT" | /usr/bin/node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=[...s];process.stdout.write(a.length>4000?a.slice(0,3980).join("")+"\n…(truncated)":s)})')"

code=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 10 --max-time 30 --retry 2 --retry-delay 3 \
  -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TG_CHAT_ID}" \
  --data-urlencode "text=${TEXT}")
echo "$code"
[ "$code" = "200" ]
