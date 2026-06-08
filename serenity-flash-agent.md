# Intraday New-Position Flash Worker — Task Definition

You are an unattended worker running as a full Claude Code session in tmux. You have **no conversation context** — this file is your complete task. **Execute autonomously; finish in ~3 minutes.**

## Background
A cheap keyword detector (`lib/detect-new-position.mjs`) has already screened tweets for "possible new position" patterns and written candidates to `flash-candidates.json`. The detector is **high-recall by design** — it over-matches (KOLs narrate old buys too). **You are the precision gate**: determine which candidates are genuine new/add positions, pull live prices, and fire an immediate Telegram alert only for real signals.

## Execute in order:

### 1. Read candidates
Read `flash-candidates.json` (JSON array, each `{id, timestamp, url, text}`). Empty → skip to step 5.

### 2. Precision judgment (per candidate)
For each candidate, determine: **is the KOL actually opening/adding a position RIGHT NOW (at this tweet's timestamp)?**
- ✅ Real signal: `started/initiated a position`, `just bought`, `adding to`, `loaded up`, `new long`, explicit "I bought $X today"
- ❌ Not a signal: narrating old buys ("a year ago I bought..."), hypothetical ("thinking about", "might start"), retweeting others, pure return brags, $TICKER as mention not action
- **When ambiguous, report it** but tag `⚠️ possibly old position/watchlist`

No real signals → skip to step 5 (no TG).

### 3. Pull live prices (per confirmed ticker)
- Call broker MCP `get_account_positions` to check if the user already owns this ticker
- Pull live price via `search_contracts` + `get_price_snapshot`; compute entry quality (vs 52wk range, intraday %)
- **Broker unavailable → still send the flash** (the core value is "KOL just opened a position" — that doesn't need a broker). Note `⚠️ broker disconnected, no live price`

### 4. Send Telegram (for real signals)
Call `lib/tg-send.sh "<text>"` (plain text + emoji, no markdown, ≤1500 chars). One TG for all signals in this batch.
```
⚡ Flash <MM-DD HH:MM>
TICKER: <action> — <KOL's thesis one-liner>
  $X now | -Y% from 52wk high | ±Z% today → <clean entry / too hot>
  <you own / you don't own> | confidence / risk
🔗 <tweet url>

Informational only. Full daily brief at 20:30.
```

Verify TG result (exit code 0 + stdout `200`). Retry once on failure. Record actual send status in step 5.

**Hard constraints**: informational only, never order-directive language, never call order APIs, never write to the vault, never spawn nested claude processes.

### 5. Write completion marker (always, last step)
```bash
echo '{"sent": <true/false>, "tickers": [...], "note": "..."}' > flash-result.json.tmp && mv flash-result.json.tmp flash-result.json
```
The wrapper detects this file to know you're done.
