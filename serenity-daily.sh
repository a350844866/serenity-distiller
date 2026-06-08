#!/usr/bin/env bash
# Daily KOL signal distillation + portfolio opinion + Telegram push.
# Cron example: 30 20 * * *  (adjust to your timezone — run after US market close)
#
# Worker modes (WORKER_MODE env var):
#   api    — (default) direct LLM API call via worker-daily.mjs. No CLI needed.
#   tmux   — launch Claude Code CLI in a tmux session (legacy, requires Max sub + CLI).
#
# Usage: serenity-daily.sh [--dry-run]
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a; [ -r "$SELF_DIR/.env" ] && . "$SELF_DIR/.env"; set +a

SYNC_DIR="${SYNC_DIR:-$SELF_DIR}"
DATA_DIR="${DATA_DIR:?Set DATA_DIR in .env}"
USER_HANDLE="${TARGET_USER:-aleabitoreddit}"
BRIEF="$DATA_DIR/$USER_HANDLE/daily-brief.md"
TG="$SYNC_DIR/lib/tg-send.sh"
WORKER_MODE="${WORKER_MODE:-api}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log(){ echo "[$(date -Iseconds)] $*"; }

# 1. Refresh tweets
log "sync start"
if ! bash "$SYNC_DIR/run.sh"; then
  log "sync failed"; "$TG" "⚠️ Distiller: tweet sync failed, skipping." >/dev/null || true; exit 1
fi

# 2. Gate — skip if no new tweets since last distillation cursor
NEW=$(/usr/bin/node "$SYNC_DIR/lib/count-new-tweets.mjs") || {
  log "count failed"; "$TG" "⚠️ Distiller: count failed (corpus corrupt?)." >/dev/null || true; exit 1; }
log "new tweets since cursor: $NEW"
if [ "$NEW" -eq 0 ]; then
  log "no new tweets, skip"; "$TG" "🔭 Distiller $(date +%m-%d): no new tweets, skipped." >/dev/null || true; exit 0
fi
if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY-RUN: would launch worker for $NEW new tweets"; echo "DRY-RUN ok: $NEW new tweets"; exit 0
fi

rm -f "$BRIEF" "$BRIEF.tmp"

# ---- Worker dispatch (mode switch) ----

if [ "$WORKER_MODE" = "tmux" ]; then
  # Legacy: Claude Code CLI in tmux (requires Max sub + CLI + tmux)
  VAULT_DIR="${VAULT_DIR:?VAULT_DIR required for tmux mode}"
  AGENT_MD="$SYNC_DIR/serenity-daily-agent.md"
  CLAUDE_BIN="${CLAUDE_BIN:-claude}"
  TIMEOUT=1800; POLL=15

  /usr/bin/node -e "
    const fs=require('fs'),p=require('os').homedir()+'/.claude.json';
    let j; try{j=JSON.parse(fs.readFileSync(p,'utf8'))}catch{j={}}
    j.projects=j.projects||{};let ch=false;
    for(const d of [process.env.VAULT_DIR,process.env.DATA_DIR].filter(Boolean)){
      j.projects[d]=j.projects[d]||{};
      if(j.projects[d].hasTrustDialogAccepted!==true){j.projects[d].hasTrustDialogAccepted=true;ch=true}}
    if(ch){const t=p+'.tmp';fs.writeFileSync(t,JSON.stringify(j,null,2));fs.renameSync(t,p)}
  " || { log "ensure_trust failed"; exit 1; }

  SESSION="distiller-daily-$(date +%s)"
  PROMPT="Read $AGENT_MD and execute it fully and autonomously. It is your complete task definition."
  NO_TRADE="mcp__claude_ai_Interactive_Brokers_IBKR__create_order_instruction mcp__claude_ai_Interactive_Brokers_IBKR__delete_order_instruction"
  log "launching tmux worker session=$SESSION"
  if ! tmux new-session -d -s "$SESSION" -c "$VAULT_DIR" \
    "$CLAUDE_BIN --dangerously-skip-permissions --model opus --add-dir $DATA_DIR --disallowedTools $NO_TRADE -- $(printf '%q' "$PROMPT")"; then
    log "tmux launch failed"; "$TG" "⚠️ Distiller: worker launch failed." >/dev/null || true; exit 1
  fi

  waited=0
  while [ "$waited" -lt "$TIMEOUT" ]; do
    [ -s "$BRIEF" ] && break
    tmux has-session -t "$SESSION" 2>/dev/null || { log "worker session gone"; break; }
    sleep "$POLL"; waited=$((waited+POLL))
  done
  tmux kill-session -t "$SESSION" 2>/dev/null || true

else
  # Default: direct API call (no CLI, no tmux needed)
  log "launching API worker (provider=${LLM_PROVIDER:-anthropic})"
  /usr/bin/node "$SYNC_DIR/worker-daily.mjs"
fi

# ---- Deliver ----

rc=0
if [ -s "$BRIEF" ]; then
  log "brief ready, sending TG"
  code=$("$TG" --file "$BRIEF") || true
  log "TG http $code"
  [ "$code" = "200" ] || { log "TG send FAILED (http $code)"; rc=1; }
else
  log "no brief produced"
  "$TG" "⚠️ Distiller: no brief produced (worker failed)." >/dev/null || true
  rc=1
fi
log "done (rc=$rc)"
exit $rc
