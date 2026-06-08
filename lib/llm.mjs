/**
 * Dual-provider LLM adapter (Anthropic Claude / OpenAI-compatible).
 *
 * Uses raw fetch — zero npm dependencies. Node 20+ required.
 *
 * Config via env:
 *   LLM_PROVIDER=anthropic|openai   (default: anthropic)
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   OPENAI_API_KEY=sk-...
 *   LLM_MODEL=claude-sonnet-4-20250514 | gpt-4o | etc.
 *   LLM_BASE_URL=https://...  (override for OpenAI-compatible endpoints)
 */

const PROVIDER = process.env.LLM_PROVIDER || "anthropic";
const MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || "8192", 10);

const DEFAULTS = {
  anthropic: {
    model: "claude-sonnet-4-20250514",
    url: "https://api.anthropic.com/v1/messages",
  },
  openai: {
    model: "gpt-4o",
    url: "https://api.openai.com/v1/chat/completions",
  },
};

function getConfig() {
  const d = DEFAULTS[PROVIDER] || DEFAULTS.openai;
  return {
    provider: PROVIDER,
    model: process.env.LLM_MODEL || d.model,
    url: process.env.LLM_BASE_URL || d.url,
    apiKey:
      PROVIDER === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY,
  };
}

/**
 * Call LLM and return text response.
 * @param {object} opts
 * @param {string} opts.system  - system prompt
 * @param {string} opts.user    - user message
 * @returns {Promise<string>}   - assistant text
 */
export async function chat({ system, user }) {
  const cfg = getConfig();
  if (!cfg.apiKey) throw new Error(`${cfg.provider}: API key not set`);

  if (cfg.provider === "anthropic") return callAnthropic(cfg, system, user);
  return callOpenAI(cfg, system, user);
}

/**
 * Call LLM and parse JSON from response.
 * Strips markdown fences if present.
 */
export async function chatJSON({ system, user }) {
  const raw = await chat({ system: system + "\n\nRespond with valid JSON only. No markdown fences, no commentary.", user });
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  return JSON.parse(cleaned);
}

// ---- Anthropic Messages API ----

async function callAnthropic(cfg, system, user) {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.content.map((b) => b.text).join("");
}

// ---- OpenAI Chat Completions API (also works with compatible endpoints) ----

async function callOpenAI(cfg, system, user) {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}
