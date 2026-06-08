# Serenity Distiller

[English](README.md)

**从推文抓取到金融信号蒸馏。**

一套自主运行的管线，把金融 KOL 的 X (Twitter) 推文流蒸馏成**活账本**——用 6 级仓位态度分类追踪持仓、通过券商 API 实时核验预测、映射产业链定位、推送 Telegram 简报。由 Claude Code agent 以 cron 驱动全自动运行。

目前追踪 [@aleabitoreddit](https://x.com/aleabitoreddit) (Serenity)，自报 YTD 4500%+ 的 AI/半导体供应链分析师。但框架不绑定任何 KOL——改 `users.json` 和 agent prompt 即可切人。

## 为什么做这个

已经有一个 [Serenity 项目](https://github.com/haskaomni/serenity)，做的是正则数 `$TICKER` 出现次数、拼 Yahoo Finance 行情、画个静态页面。那是推文抓取器。这是信号蒸馏系统。

| 能力 | 推文抓取器 | 本项目 |
|---|---|---|
| 数据采集 | 手动从 DevTools 复制 curl | 每日 cron 自动 + headless 浏览器 |
| 信号提取 | 正则数 `$TICKER` 出现次数 → 0-100 分 | 6 级仓位态度（新开/加码/持有/减仓/反手/静默） |
| 预测追踪 | - | 券商 API 实时核验，四档判定（✅兑现/❌落空/⏳待核/🚫不可证伪） |
| 可信度审计 | - | LEAPs 杠杆分解、归因稳定性分析、自报 vs 可审计口径切分 |
| 产业链映射 | - | 每个持仓挂到供应链环节（上游 chokepoint → 晶圆厂 → 封装 → 终端） |
| 盘中提醒 | - | 每 30 分钟 flash 轮询：廉价关键词预筛（0 LLM token）→ 命中才起 LLM 精确判断 |
| 组合交叉 | - | 券商 MCP 实时持仓 + R2 进场质量评分（只买暴跌不追狂热） |
| 自主 agent | - | Claude Code worker + 协作写锁 + prompt injection 防护 |
| 交付方式 | 静态网页 | Telegram 推送 + Obsidian wiki + JSON dashboard feed |
| 安全控制 | 无 | 下单工具剥离、flock 单实例、原子写入、stale 锁清理 |

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          CRON 调度                               │
│  每日 20:30 ─────────────────────── 每 30 分钟 21:00-06:00       │
│  (全量蒸馏)                          (盘中 flash)                 │
└──────┬──────────────────────────────────────┬───────────────────┘
       │                                      │
       ▼                                      ▼
┌──────────────┐                    ┌──────────────────┐
│ serenity-    │                    │ serenity-        │
│ daily.sh     │                    │ flash.sh         │
│              │                    │                  │
│ 1. 同步推文  │                    │ 1. 同步推文       │
│ 2. 数新推    │                    │ 2. 关键词检测     │
│    (门禁)    │                    │    (keyword +    │
│ 3. 启动      │                    │     $TICKER,     │
│    worker    │                    │     0 token)     │
│ 4. 轮询等待  │                    │ 3. 命中才启动     │
│ 5. TG 推送   │                    │    worker        │
└──────┬───────┘                    └────────┬─────────┘
       │                                     │
       ▼                                     ▼
┌──────────────────────┐          ┌────────────────────┐
│ Claude Code Worker   │          │ Claude Code Worker  │
│ (daily-agent.md)     │          │ (flash-agent.md)    │
│                      │          │                     │
│ • 解析新推文          │          │ • 读候选推文        │
│ • 信噪过滤           │          │ • 精确判定:         │
│ • 更新持仓表          │          │   真开仓 vs 复盘?  │
│ • 更新预测对账表      │          │ • 拉实时行情        │
│ • 更新 catalyst 日历  │          │ • 发 TG 提醒        │
│ • 建周快照            │          │ • 写结果标记        │
│ • 拉实时持仓+行情     │          │                     │
│ • 持仓操作意见        │          │ 只读: 不写 vault    │
│ • 候选买入 idea       │          └────────────────────┘
│ • git commit + push  │
│ • 写简报 → TG 推送    │
└──────────────────────┘

两个 worker 均通过 --disallowedTools 剥离券商下单 API。
推文正文当数据读，不当指令（prompt injection 防护）。
```

## 活账本

核心产出是**活账本**——一个随每次蒸馏持续演化的结构化 Obsidian 页面：

**持仓追踪**（带态度历史）：
```
| ticker | 链环节 | 态度 | thesis | 工具 | 最近提及 |
|--------|--------|------|--------|------|---------|
| $SIVE  | CPO 激光上游 | 🔥加码 | sole-source; GFS reference design | 现货 | 2026-06-07 |
| $VPG   | 传感 | 📉减仓 | ASP 模型建错；降集中度 | 现货 | 2026-05-31 |
```

**预测对账**——每个口径都有判定：
```
| 口径 | 实时核验 | 判定 |
|------|---------|------|
| $TICKER $50→$150 (3x) | $148.50（券商 API） | ✅ 兑现 |
| YTD 4502% | 不可独立审计（LEAPs 杠杆放大） | 🚫 不可证伪 |
| EU Chips Act 点名 $X | 官方文件确认 | ✅ 事件兑现 |
```

**前瞻 catalyst 日历**（到期追踪 + 交叉引用）。

## Flash 盘中提醒

多数 KOL 追踪器一天跑一次。市场不等人。

Flash 管线在美股交易时段每 30 分钟轮询：
1. **廉价检测器**（`detect-new-position.mjs`）：正则匹配买入动词 + `$TICKER` + 12 小时时间窗 + 去重。零 LLM token 消耗。召回优先、必然过度命中。
2. **LLM 精确闸门**（仅在检测器命中时启动）：Claude 读候选推文，判断 KOL 是**现在真的在开/加仓**还是在复盘旧仓。拉实时行情评估进场质量。
3. **Telegram 推送**：即时提醒，含 KOL 的动作、实时价格 vs 52 周区间、你是否已持有。

成本：安静日 ~$0（不起 worker）。KOL 实际交易时花几美元。

## 安装

### 前置条件
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) + Max 订阅（worker 以 tmux 交互式会话运行）
- Node.js 20+
- `xactions` npm 包（提供 headless X 抓取，基于 Playwright）
- tmux
- Obsidian vault（或任何 markdown 目录）
- 可选：IBKR 账户 + Claude.ai IBKR MCP 连接器（实时持仓/行情）
- 可选：Telegram bot（推送通知）

### 安装

```bash
git clone https://github.com/a350844866/serenity-distiller.git
cd serenity-distiller
cp .env.example .env
# 编辑 .env，填入路径、X cookie、可选的 TG/券商配置
```

### 配置

**`.env`** — 路径与密钥：
```bash
XACTIONS_SESSION_COOKIE=你的_auth_token    # F12 → Cookies → x.com → auth_token
VAULT_DIR=/path/to/your/obsidian/vault     # Obsidian 库路径
DATA_DIR=/path/to/x-exports                # 推文语料库 + ledger.json
TG_BOT_TOKEN=可选                          # Telegram 推送
TG_CHAT_ID=可选
```

**`users.json`** — 追踪谁：
```json
{
  "users": [
    { "handle": "aleabitoreddit", "enabled": true }
  ]
}
```

**模板** — 把 `templates/living-ledger.md` 和 `templates/entity.md` 复制到你的 vault wiki 目录下并自定义。

### Cron 调度

```bash
# 每日全量蒸馏（美股收盘后，按你的时区调整）
30 20 * * * cd /path/to/serenity-distiller && bash serenity-daily.sh >> serenity-daily.log 2>&1

# 盘中 flash 提醒（美股交易时段，每 30 分钟）
*/30 21-23,0-5 * * * cd /path/to/serenity-distiller && bash serenity-flash.sh >> serenity-flash.log 2>&1
```

### 试运行

```bash
bash serenity-daily.sh --dry-run   # 只同步推文+计数，不启动 worker
bash serenity-flash.sh --dry-run   # 只同步+检测，不启动 worker
```

## 安全设计

- **设计上禁止交易**：worker 通过 `--disallowedTools` 剥离券商下单/撤单 API，即使在 `--dangerously-skip-permissions` 下也从进程中移除了这些工具
- **Prompt injection 防护**：推文内容当数据读。agent 定义明确指示 worker 忽略推文中的指令式文本
- **协作写锁**：基于文件的 `.vault-writing-lock`，10 分钟 stale 超时，防止多 agent 并发写 wiki
- **原子写入**：所有 JSON 持久化走 tmp→rename，防止读到写一半的文件
- **单实例 flash**：`flock` 防止重叠的 30 分钟轮询重复启动 worker
- **幂等去重**：推文同步按 ID 去重；flash 检测器记住已报警的推文 ID

**本项目不做的事**：物理进程隔离。理论上 prompt injection 可以 shell out 到一个不受限的 Claude。no-trade 控制挡的是最现实的失败模式（worker 困惑后直接调下单 API），不是对抗性攻击。要硬保证，需收窄券商 API token 的权限范围。

## 适配其他 KOL

1. 在 `users.json` 加人
2. 在 vault 里为每个 KOL 建一个活账本页面
3. 定制 agent prompt（`serenity-daily-agent.md`、`serenity-flash-agent.md`），写入该 KOL 的领域、thesis 模式、你的持仓上下文
4. 关键词检测器（`lib/detect-new-position.mjs`）开箱即用于英文股票 KOL；其他语言或资产类别调 `POS_RE`

## 文件结构

```
serenity-distiller/
├── .env.example              # 配置模板
├── users.json                # 追踪的 KOL
├── run.sh                    # 同步 wrapper（cron 入口）
├── daily-sync.mjs            # 增量推文同步（headless 浏览器）
├── download-images.mjs       # 图片归档（幂等）
├── serenity-daily.sh         # 每日编排（同步 → 门禁 → worker → TG）
├── serenity-flash.sh         # Flash 编排（同步 → 检测 → worker → TG）
├── serenity-daily-agent.md   # Claude worker 任务定义（全量蒸馏）
├── serenity-flash-agent.md   # Claude worker 任务定义（flash 精确闸门）
├── lib/
│   ├── detect-new-position.mjs  # 廉价关键词预筛（0 LLM cost）
│   ├── count-new-tweets.mjs     # 基于游标的新推计数
│   └── tg-send.sh               # Telegram 投递（带截断）
├── templates/
│   ├── living-ledger.md         # Obsidian 活账本模板
│   └── entity.md                # KOL 实体画像模板
└── schemas/
    └── ledger-example.json      # Dashboard JSON schema + 示例
```

## 生产环境实绩

本系统自 2026 年 6 月起每日运行，追踪 @aleabitoreddit 的 2700+ 条推文，完成 11 轮周蒸馏。活账本追踪 20+ 个持仓的态度历史、25+ 条前瞻预测的实时核验判定、滚动 catalyst 日历。13 个可证伪的单票自报口径经券商 API live 数据核验**全部确认**——将真 alpha（单票方向选股）与不可审计的聚合收益（LEAPs 杠杆放大）明确切开。

每日简报 + 盘中 flash 通过 Telegram 消费；结构化 `ledger.json` 喂给 Next.js dashboard 做可视化持仓监控。

## License

MIT
