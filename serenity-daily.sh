#!/usr/bin/env bash
# Daily KOL signal distillation + portfolio opinion + Telegram push.
# Cron example: 30 20 * * *  (adjust to your timezone — run after US market close)
# Usage: serenity-daily.sh [--dry-run]
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a; [ -r "$SELF_DIR/.env" ] && . "$SELF_DIR/.env"; set +a

SYNC_DIR="${SYNC_DIR:-$SELF_DIR}"
VAULT_DIR="${VAULT_DIR:?Set VAULT_DIR in .env}"
DATA_DIR="${DATA_DIR:?Set DATA_DIR in .env}"
USER_HANDLE="${TARGET_USER:-aleabitoreddit}"
BRIEF="$DATA_DIR/$USER_HANDLE/daily-brief.md"
AGENT_MD="$SYNC_DIR/serenity-daily-agent.md"
TG="$SYNC_DIR/lib/tg-send.sh"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
TIMEOUT=1800
POLL=15
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

# 3. Ensure Claude trust dialog is pre-accepted (headless can't click UI)
/usr/bin/node -e "
  const fs=require('fs'),p=require('os').homedir()+'/.claude.json';
  let j; try{j=JSON.parse(fs.readFileSync(p,'utf8'))}catch{j={}}
  j.projects=j.projects||{};
  let changed=false;
  for(const d of [process.env.VAULT_DIR,process.env.DATA_DIR].filter(Boolean)){
    j.projects[d]=j.projects[d]||{};
    if(j.projects[d].hasTrustDialogAccepted!==true){j.projects[d].hasTrustDialogAccepted=true;changed=true}
  }
  if(changed){const t=p+'.tmp';fs.writeFileSync(t,JSON.stringify(j,null,2));fs.renameSync(t,p)}
" || { log "ensure_trust failed"; "$TG" "⚠️ Distiller: trust preset failed." >/dev/null || true; exit 1; }

# 4. Launch Claude worker in tmux
rm -f "$BRIEF" "$BRIEF.tmp"
SESSION="distiller-daily-$(date +%s)"
PROMPT="Read $AGENT_MD and execute it fully and autonomously. It is your complete task definition."
# No-trade control: strip broker order tools from the worker process.
# Blocks the realistic failure mode (confused worker calling order API directly).
# NOT a full sandbox — prompt-level, not physical isolation.
NO_TRADE="mcp__claude_ai_Interactive_Brokers_IBKR__create_order_instruction mcp__claude_ai_Interactive_Brokers_IBKR__delete_order_instruction"
log "launching worker session=$SESSION"
if ! tmux new-session -d -s "$SESSION" -c "$VAULT_DIR" \
  "$CLAUDE_BIN --dangerously-skip-permissions --model opus --add-dir $DATA_DIR --disallowedTools $NO_TRADE -- $(printf '%q' "$PROMPT")"; then
  log "tmux launch failed"; "$TG" "⚠️ Distiller: worker launch failed." >/dev/null || true; exit 1
fi

# 5. Poll for brief; fail fast if worker dies early
waited=0
while [ "$waited" -lt "$TIMEOUT" ]; do
  [ -s "$BRIEF" ] && break
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    log "worker session gone before brief appeared"; break
  fi
  sleep "$POLL"; waited=$((waited+POLL))
done

# 6. Deliver or alert
rc=0
if [ -s "$BRIEF" ]; then
  log "brief ready after ${waited}s, sending TG"
  code=$("$TG" --file "$BRIEF") || true
  log "TG http $code"
  [ "$code" = "200" ] || { log "TG send FAILED (http $code)"; rc=1; }
else
  log "no brief after ${waited}s (timeout or worker death)"
  pane=$(tmux capture-pane -t "$SESSION" -p 2>/dev/null | grep -v '^$' | tail -8)
  "$TG" "⚠️ Distiller: no brief produced (timeout/crash). session=$SESSION
tail:
$pane" >/dev/null || true
  rc=1
fi
tmux kill-session -t "$SESSION" 2>/dev/null || true
log "done (rc=$rc)"
exit $rc
