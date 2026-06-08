// Cheap pre-filter for NEW-POSITION tweets.
// Scans tweets-full.json for RECENT tweets whose text matches a new-position
// pattern AND contains a $TICKER, excluding ones already alerted on.
//
// This is a high-RECALL keyword gate — it WILL over-match (KOLs narrate old
// buys too). Precision is delegated to the LLM worker (flash-agent.md), which
// confirms genuineness before any Telegram send. The detector's job is to
// decide "is it worth spending a worker on this poll?" cheaply (0 LLM tokens).
//
// Side effects: candidates → flash-candidates.json, seen ids → flash-state.json
// (so each tweet triggers a worker at most once). Marking-seen happens HERE
// (not in the worker): if the worker crashes we'd rather miss one flash
// (backstopped by the nightly full brief) than re-spawn for the same tweet
// every 30 min.
//
// Prints the candidate count (integer) to stdout. Exit 3 on unrecoverable error.
import fs from "fs";
import path from "path";

const SELF_DIR = path.dirname(new URL(import.meta.url).pathname);
const SYNC_DIR = process.env.SYNC_DIR || path.join(SELF_DIR, "..");
const DATA_DIR = process.env.DATA_DIR || path.join(SYNC_DIR, "..", "x-exports");
const USER = process.env.TARGET_USER || "aleabitoreddit";

const TWEETS = path.join(DATA_DIR, USER, "tweets-full.json");
const STATE = path.join(SYNC_DIR, "flash-state.json");
const CANDIDATES = path.join(SYNC_DIR, "flash-candidates.json");
const WINDOW_HOURS = 12;
const MAX_ALERTED = 300;
const MAX_PER_POLL = 6;

// New-position verbs; require a $TICKER too. Case-insensitive. High recall by design.
const POS_RE = /\b(?:start(?:ed|ing)?\s+(?:a\s+)?position|initiat(?:ed|ing|e)|new\s+position|open(?:ed|ing)?\s+(?:a\s+)?position|just\s+bought|bought\s+(?:more|\$?\d|back)|adding\s+(?:to|more)?|added\s+(?:to|more)?|load(?:ed|ing)?\s+up|starter\s+(?:position|long)|took\s+a\s+(?:starter|position|long)|scal(?:ed|ing)\s+in(?:to)?|buying\s+more|grab(?:bed|bing)\s+shares|building\s+a\s+position|ended\s+up\s+(?:buying|bought|rotating)|(?:bought|buying|picked\s+up)\b[^.!?\n]{0,40}\btoday)\b/i;
const TICKER_RE = /\$[A-Za-z]{1,6}\b/;

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function writeJsonAtomic(p, obj) {
  const t = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(t, JSON.stringify(obj, null, 2));
  fs.renameSync(t, p);
}

let arr;
try { arr = JSON.parse(fs.readFileSync(TWEETS, "utf8")); }
catch (e) { console.error("detect: cannot parse tweets JSON: " + e.message); process.exit(3); }
if (!Array.isArray(arr)) { console.error("detect: tweets JSON not an array"); process.exit(3); }

const state = readJson(STATE, {});
const alerted = new Set(Array.isArray(state.alerted_ids) ? state.alerted_ids : []);

const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;

const candidates = arr
  .filter(t => {
    if (!t || !t.id || alerted.has(t.id)) return false;
    const ms = Date.parse(t.timestamp);
    if (Number.isNaN(ms) || ms < cutoff) return false;
    const text = t.text || "";
    return POS_RE.test(text) && TICKER_RE.test(text);
  })
  .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
  .slice(0, MAX_PER_POLL)
  .map(t => ({ id: t.id, timestamp: t.timestamp, url: t.url, text: t.text }));

writeJsonAtomic(CANDIDATES, candidates);

if (candidates.length > 0) {
  for (const c of candidates) alerted.add(c.id);
  const ids = [...alerted].slice(-MAX_ALERTED);
  writeJsonAtomic(STATE, { alerted_ids: ids, last_hit: new Date().toISOString() });
}

console.log(candidates.length);
