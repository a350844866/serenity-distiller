#!/usr/bin/env bash
# Intraday NEW-POSITION flash alert.
# Cron example: */30 21-23,0-5 * * *  (cover US pre-market through after-hours)
# Pipeline: sync → cheap keyword detector → (only on hit) LLM worker confirms + TG
# Most polls do NOT spawn a worker (no new-position tweet) → ~0 LLM cost.
#
# Worker modes (WORKER_MODE env var):
#   api    — (default) direct LLM API call via worker-flash.mjs
#   tmux   — Claude Code CLI in tmux (legacy)
#
# Usage: serenity-flash.sh [--dry-run]
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a; [ -r "$SELF_DIR/.env" ] && . "$SELF_DIR/.env"; set +a

SYNC_DIR="${SYNC_DIR:-$SELF_DIR}"
DATA_DIR="${DATA_DIR:?Set DATA_DIR in .env}"
RESULT="$SYNC_DIR/flash-result.json"
CANDIDATES="$SYNC_DIR/flash-candidates.json"
TG="$SYNC_DIR/lib/tg-send.sh"
WORKER_MODE="${WORKER_MODE:-api}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log(){ echo "[$(date -Iseconds)] flash: $*"; }

# 0. Single-flight
exec 9>"$SYNC_DIR/.flash.lock"
if ! flock -n 9; then log "previous flash poll still running, skip"; exit 0; fi

# 1. Refresh tweets (bounded timeout)
log "sync start"
if ! timeout 180 /usr/bin/node "$SYNC_DIR/daily-sync.mjs" >/dev/null 2>&1; then
  log "sync failed/timed out, detecting against existing corpus"
fi

# 2. Cheap detect
FAILSTAMP="$SYNC_DIR/.flash-detector-fail.stamp"
if ! N=$(/usr/bin/node "$SYNC_DIR/lib/detect-new-position.mjs"); then
  log "detector failed"
  if [ ! -f "$FAILSTAMP" ] || [ "$(( $(date +%s) - $(stat -c %Y "$FAILSTAMP" 2>/dev/null || echo 0) ))" -gt 21600 ]; then
    if "$TG" "⚠️ Flash: detector failure." >/dev/null; then touch "$FAILSTAMP"; fi
  fi
  exit 0
fi
rm -f "$FAILSTAMP"
log "new-position candidates: $N"
[ "$N" -eq 0 ] && { log "no candidates, done"; exit 0; }

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY-RUN: $N candidate(s)"; echo "DRY-RUN ok: $N candidate(s)"; exit 0
fi

rm -f "$RESULT" "$RESULT.tmp"

# ---- Worker dispatch ----

if [ "$WORKER_MODE" = "tmux" ]; then
  AGENT_MD="$SYNC_DIR/serenity-flash-agent.md"
  CLAUDE_BIN="${CLAUDE_BIN:-claude}"
  TIMEOUT=600; POLL=10

  /usr/bin/node -e "
    const fs=require('fs'),p=require('os').homedir()+'/.claude.json';
    let j;try{j=JSON.parse(fs.readFileSync(p,'utf8'))}catch{j={}}
    j.projects=j.projects||{};let ch=false;
    for(const d of [process.env.DATA_DIR].filter(Boolean)){
      j.projects[d]=j.projects[d]||{};
      if(j.projects[d].hasTrustDialogAccepted!==true){j.projects[d].hasTrustDialogAccepted=true;ch=true}}
    if(ch){const t=p+'.tmp';fs.writeFileSync(t,JSON.stringify(j,null,2));fs.renameSync(t,p)}
  " || { log "ensure_trust failed"; exit 1; }

  SESSION="distiller-flash-$(date +%s)"
  PROMPT="Read $AGENT_MD and execute it fully and autonomously. It is your complete task definition."
  NO_TRADE="mcp__claude_ai_Interactive_Brokers_IBKR__create_order_instruction mcp__claude_ai_Interactive_Brokers_IBKR__delete_order_instruction"
  log "launching tmux flash worker"
  if ! tmux new-session -d -s "$SESSION" -c "$DATA_DIR" \
    "$CLAUDE_BIN --dangerously-skip-permissions --model opus --disallowedTools $NO_TRADE -- $(printf '%q' "$PROMPT")"; then
    log "tmux launch failed"; "$TG" "⚠️ Flash: worker launch failed." >/dev/null || true; exit 1
  fi

  waited=0
  while [ "$waited" -lt "$TIMEOUT" ]; do
    [ -s "$RESULT" ] && break
    tmux has-session -t "$SESSION" 2>/dev/null || { log "worker gone"; break; }
    sleep "$POLL"; waited=$((waited+POLL))
  done
  tmux kill-session -t "$SESSION" 2>/dev/null || true

else
  # Default: direct API call
  log "launching API flash worker (provider=${LLM_PROVIDER:-anthropic})"
  /usr/bin/node "$SYNC_DIR/worker-flash.mjs"
fi

# ---- Report ----

rc=0
if [ -s "$RESULT" ]; then
  log "done: $(cat "$RESULT")"
else
  log "no result (worker failed)"
  "$TG" "⚠️ Flash: no result (worker failed). candidates=$N" >/dev/null || true
  rc=1
fi
log "done (rc=$rc)"
exit $rc
