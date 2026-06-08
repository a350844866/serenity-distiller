#!/bin/bash
# Wrapper for cron — loads .env and runs daily-sync.mjs.
set -e
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SELF_DIR"
set -a; . ./.env; set +a

/usr/bin/node "$SELF_DIR/daily-sync.mjs"

# Download any newly captured image URLs (idempotent, skips existing files).
for u in $(/usr/bin/node -e "console.log(JSON.parse(require('fs').readFileSync('$SELF_DIR/users.json')).users.filter(u=>u.enabled).map(u=>u.handle).join(' '))"); do
  /usr/bin/node "$SELF_DIR/download-images.mjs" "$u" 2>&1 | tail -3
done
