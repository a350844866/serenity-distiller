# Serenity Distiller

[中文文档](README.zh-CN.md)

**From tweet scraping to financial intelligence distillation.**

An autonomous pipeline that distills a financial KOL's X (Twitter) stream into a living accountability ledger — tracking positions with 6-level stance classification, verifying predictions against live broker data, mapping industry chain positions, and pushing Telegram briefings. Powered by Claude Code agents running on cron.

Built for [@aleabitoreddit](https://x.com/aleabitoreddit) (Serenity), the AI/semiconductor supply chain analyst with a self-reported 4500%+ YTD return. But the framework is KOL-agnostic — swap `users.json` and the agent prompts to track anyone.

## Why this exists

There's [another Serenity project](https://github.com/haskaomni/serenity) that counts `$TICKER` mentions and plots Yahoo Finance prices. That's a tweet scraper. This is a signal intelligence system.

| Capability | Tweet scraper | This project |
|---|---|---|
| Data collection | Manual curl paste from DevTools | Automated daily cron + headless browser |
| Signal extraction | Regex `$TICKER` mention count → 0-100 score | 6-level stance tracking (new/adding/holding/trimming/reversing/silent) |
| Prediction tracking | - | Live verification via broker API with verdicts (confirmed/missed/pending/unfalsifiable) |
| Credibility audit | - | LEAPs leverage decomposition, attribution stability analysis, self-reported vs auditable separation |
| Industry chain mapping | - | Position mapped to supply chain segment (upstream chokepoint → foundry → packaging → endpoint) |
| Intraday alerts | - | 30-min flash polling: cheap keyword pre-filter (0 LLM tokens) → LLM precision gate (only on hit) |
| Portfolio cross-reference | - | Broker MCP live positions + R2 entry quality scoring (buy dips not euphoria) |
| Autonomous agents | - | Claude Code workers with cooperative vault write-lock + prompt injection guards |
| Delivery | Static web dashboard | Telegram push + Obsidian wiki + JSON dashboard feed |
| Safety controls | None | No-trade tool stripping, flock single-flight, atomic writes, stale-lock cleanup |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CRON SCHEDULE                            │
│  20:30 daily ──────────────────── */30 21:00-06:00 intraday     │
└──────┬──────────────────────────────────────┬───────────────────┘
       │                                      │
       ▼                                      ▼
┌──────────────┐                    ┌──────────────────┐
│ serenity-    │                    │ serenity-        │
│ daily.sh     │                    │ flash.sh         │
│              │                    │                  │
│ 1. run.sh    │                    │ 1. sync tweets   │
│    (sync)    │                    │ 2. detect-new-   │
│ 2. count-new │                    │    position.mjs  │
│    (gate)    │                    │    (keyword+     │
│ 3. launch    │                    │     $TICKER,     │
│    worker    │                    │     0 LLM cost)  │
│ 4. poll      │                    │ 3. launch worker │
│ 5. TG push   │                    │    (only on hit) │
└──────┬───────┘                    └────────┬─────────┘
       │                                     │
       ▼                                     ▼
┌──────────────────────┐          ┌────────────────────┐
│ Claude Code Worker   │          │ Claude Code Worker  │
│ (daily-agent.md)     │          │ (flash-agent.md)    │
│                      │          │                     │
│ • Parse new tweets   │          │ • Read candidates   │
│ • Signal/noise filter│          │ • Precision gate:   │
│ • Update positions   │          │   real buy vs old   │
│ • Update predictions │          │   narration?        │
│ • Update catalysts   │          │ • Pull live prices  │
│ • Weekly snapshot    │          │ • Fire TG alert     │
│ • Pull live prices   │          │ • Write result JSON │
│ • Position opinions  │          │                     │
│ • Candidate ideas    │          │ READ-ONLY: never    │
│ • git commit + push  │          │ writes vault        │
│ • Write brief → TG   │          └────────────────────┘
└──────────────────────┘

Both workers run with --disallowedTools to strip broker order APIs.
Prompt injection in tweets is treated as hostile input, not instructions.
```

## The Living Ledger

The core output is a **living ledger** — a structured Obsidian page that evolves with each distillation:

**Position tracking** with stance history:
```
| ticker | chain segment | stance | thesis | instrument | last mention |
|--------|--------------|--------|--------|------------|-------------|
| $SIVE  | CPO laser upstream | 🔥adding | sole-source; GFS reference design | shares | 2026-06-07 |
| $VPG   | sensor | 📉trimming | ASP model was wrong; reducing | shares | 2026-05-31 |
```

**Prediction accountability** — every claim gets a verdict:
```
| claim | live verification | verdict |
|-------|------------------|---------|
| $TICKER $50→$150 (3x) | $148.50 (broker API) | ✅ confirmed |
| YTD 4502% | not auditable (LEAPs leverage) | 🚫 unfalsifiable |
| EU Chips Act names $X | official publication confirmed | ✅ event confirmed |
```

**Catalyst calendar** with expiration tracking and cross-references.

## Flash Alert System

Most financial KOL trackers run once a day. Markets don't wait.

The flash pipeline polls every 30 minutes during US market hours:
1. **Cheap detector** (`detect-new-position.mjs`): regex for buy-action verbs + `$TICKER` + 12h recency window + dedup. Zero LLM tokens. Over-matches by design — recall over precision.
2. **LLM precision gate** (only spawned when detector fires): Claude reads the candidate tweets, determines if the KOL is genuinely opening/adding a position *right now* vs narrating history. Pulls live prices for entry quality assessment.
3. **Telegram push**: immediate alert with the KOL's action, live price vs 52wk range, and whether you already own it.

Cost: ~$0/day on quiet days (no worker spawned). A few dollars when the KOL actually trades.

## Setup

### Prerequisites
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) with a Max subscription (workers run as interactive tmux sessions)
- Node.js 20+
- `xactions` npm package (provides headless X scraping via Playwright)
- tmux
- An Obsidian vault (or any markdown directory)
- Optional: IBKR account + Claude.ai IBKR MCP connector (for live portfolio/prices)
- Optional: Telegram bot (for push notifications)

### Install

```bash
git clone https://github.com/a350844866/serenity-distiller.git
cd serenity-distiller
cp .env.example .env
# Edit .env with your paths, X cookie, and optional TG/broker config
```

### Configure

**`.env`** — paths and secrets:
```bash
XACTIONS_SESSION_COOKIE=your_x_auth_token    # F12 → Cookies → x.com → auth_token
VAULT_DIR=/path/to/your/obsidian/vault
DATA_DIR=/path/to/x-exports                  # tweet corpus + ledger.json
TG_BOT_TOKEN=optional                        # Telegram push
TG_CHAT_ID=optional
```

**`users.json`** — who to track:
```json
{
  "users": [
    { "handle": "aleabitoreddit", "enabled": true }
  ]
}
```

**Templates** — copy `templates/living-ledger.md` and `templates/entity.md` into your vault's wiki directory and customize.

### Cron

```bash
# Daily full distillation (after US market close, adjust timezone)
30 20 * * * cd /path/to/serenity-distiller && bash serenity-daily.sh >> serenity-daily.log 2>&1

# Intraday flash alerts (US session hours, every 30 min)
*/30 21-23,0-5 * * * cd /path/to/serenity-distiller && bash serenity-flash.sh >> serenity-flash.log 2>&1
```

### Dry run

```bash
bash serenity-daily.sh --dry-run   # syncs tweets + counts, doesn't launch worker
bash serenity-flash.sh --dry-run   # syncs + detects, doesn't launch worker
```

## Safety

- **No-trade by design**: workers run with `--disallowedTools` stripping broker order/cancel APIs. Even with `--dangerously-skip-permissions`, the tools are removed from the worker process
- **Prompt injection defense**: tweet content is read as data. The agent definitions explicitly instruct workers to ignore instruction-like patterns in tweet text
- **Cooperative vault lock**: file-based `.vault-writing-lock` with 10-minute stale timeout prevents concurrent wiki writes across multiple agents
- **Atomic writes**: all JSON persistence uses tmp→rename to prevent torn reads
- **Single-flight flash**: `flock` prevents overlapping 30-min polls from double-spawning workers
- **Idempotent dedup**: tweet sync deduplicates by ID; flash detector remembers alerted tweet IDs

**What this does NOT do**: physical process isolation. A determined prompt injection could theoretically shell out to an unrestricted Claude. The no-trade controls block the realistic failure mode (confused worker directly calling order API), not adversarial exploitation. For hard guarantees, restrict broker API token scope.

## Adapting to other KOLs

1. Add entries to `users.json`
2. Create a living ledger page per KOL in your vault
3. Customize the agent prompts (`serenity-daily-agent.md`, `serenity-flash-agent.md`) with the KOL's domain, thesis patterns, and your portfolio context
4. The keyword detector (`lib/detect-new-position.mjs`) works for English-language stock KOLs out of the box; adjust `POS_RE` for other languages or asset classes

## File structure

```
serenity-distiller/
├── .env.example              # Configuration template
├── users.json                # KOL handles to track
├── run.sh                    # Sync wrapper (cron entry)
├── daily-sync.mjs            # Incremental tweet sync (headless browser)
├── download-images.mjs       # Image archive (idempotent)
├── serenity-daily.sh         # Daily orchestrator (sync → gate → worker → TG)
├── serenity-flash.sh         # Flash orchestrator (sync → detect → worker → TG)
├── serenity-daily-agent.md   # Claude worker task definition (full distillation)
├── serenity-flash-agent.md   # Claude worker task definition (flash precision gate)
├── lib/
│   ├── detect-new-position.mjs  # Cheap keyword pre-filter (0 LLM cost)
│   ├── count-new-tweets.mjs     # Cursor-based new tweet counter
│   └── tg-send.sh               # Telegram delivery with truncation
├── templates/
│   ├── living-ledger.md         # Obsidian living ledger template
│   └── entity.md                # KOL entity profile template
└── schemas/
    └── ledger-example.json      # Dashboard JSON schema + example
```

## How it's used in production

This system has been running daily since June 2026, tracking @aleabitoreddit across 2700+ tweets and 11 weekly distillation cycles. The living ledger tracks 20+ positions with stance history, 25+ forward predictions with live-verified verdicts, and a rolling catalyst calendar. 13 out of 13 verifiable single-stock claims were confirmed against broker API live data — separating real alpha (individual stock direction) from unauditable aggregate returns (LEAPs leverage amplification).

The daily briefing + flash alerts are consumed via Telegram; the structured `ledger.json` feeds a Next.js dashboard for visual position monitoring.

## License

MIT
