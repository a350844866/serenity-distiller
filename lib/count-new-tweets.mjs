// Count tweets in tweets-full.json newer than the living-ledger cursor (last_distilled_ts).
// Prints a single integer to stdout. Exit 3 on any unrecoverable error.
import fs from "fs";
import path from "path";

const VAULT_DIR = process.env.VAULT_DIR;
const DATA_DIR = process.env.DATA_DIR;
const USER = process.env.TARGET_USER || "aleabitoreddit";

if (!VAULT_DIR) { console.error("count-new-tweets: VAULT_DIR not set"); process.exit(3); }
if (!DATA_DIR) { console.error("count-new-tweets: DATA_DIR not set"); process.exit(3); }

const NOTE = path.join(VAULT_DIR, "wiki/notes/living-ledger.md");
const TWEETS = path.join(DATA_DIR, USER, "tweets-full.json");

let note;
try { note = fs.readFileSync(NOTE, "utf8"); }
catch (e) { console.error("count-new-tweets: cannot read note: " + e.message); process.exit(3); }

const m = note.match(/^last_distilled_ts:\s*["']?(\S+?)["']?\s*$/m);
if (!m) { console.error("count-new-tweets: cursor (last_distilled_ts) not found"); process.exit(3); }
const cursor = Date.parse(m[1]);
if (Number.isNaN(cursor)) { console.error("count-new-tweets: unparseable cursor " + m[1]); process.exit(3); }

let arr;
try { arr = JSON.parse(fs.readFileSync(TWEETS, "utf8")); }
catch (e) { console.error("count-new-tweets: cannot parse tweets JSON: " + e.message); process.exit(3); }
if (!Array.isArray(arr)) { console.error("count-new-tweets: tweets JSON is not an array"); process.exit(3); }

let bad = 0;
const n = arr.filter(t => {
  const ms = Date.parse(t && t.timestamp);
  if (Number.isNaN(ms)) { bad++; return false; }
  return ms > cursor;
}).length;
if (bad > 0) console.error("count-new-tweets: warning, " + bad + " tweet(s) with unparseable timestamp");
console.log(n);
