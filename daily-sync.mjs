/**
 * Daily incremental tweet sync for monitored X users.
 *
 * For each enabled user in users.json:
 *  1. Validate session cookie (ct0 presence after login)
 *  2. Find last tweet timestamp from tweets-full.json
 *  3. Search `from:user since:<last_date>` to get new tweets
 *  4. Dedupe by id, atomic append to tweets-full.json, write daily snapshot
 *  5. On any auth/network failure, send TG alert
 *
 * Requires: xactions npm package (provides headless X scraping)
 * Manual run:  node daily-sync.mjs
 * Cron usage:  via run.sh wrapper (sets cwd + env)
 */
import {
  createBrowser,
  createPage,
  loginWithCookie,
  searchTweets,
  scrapeProfile,
} from 'xactions/src/scrapers/twitter/index.js';
import fs from 'fs';
import path from 'path';

const SELF_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.DATA_DIR || path.join(SELF_DIR, '..', 'x-exports');
const SYNC_DIR = process.env.SYNC_DIR || SELF_DIR;
const COOKIE = process.env.XACTIONS_SESSION_COOKIE;
const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT = process.env.TG_CHAT_ID;

if (!COOKIE) { console.error('XACTIONS_SESSION_COOKIE missing'); process.exit(2); }

const LOCK_FILE = path.join(SYNC_DIR, '.sync.lock');
const STATUS_FILE = path.join(SYNC_DIR, 'last-status.json');

// ---- helpers ----

const today = () => new Date().toISOString().slice(0, 10);

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(SYNC_DIR, 'sync.log'), line + '\n');
};

async function tgAlert(text) {
  if (!TG_TOKEN || !TG_CHAT) {
    log('TG creds missing, alert skipped: ' + text);
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const body = JSON.stringify({ chat_id: TG_CHAT, text: `[x-sync] ${text}` });
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!r.ok) log(`TG alert HTTP ${r.status}`);
  } catch (e) {
    log(`TG alert failed: ${e.message}`);
  }
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const ageMin = (Date.now() - fs.statSync(LOCK_FILE).mtimeMs) / 60000;
    if (ageMin < 30) {
      log(`Lock held (${ageMin.toFixed(1)} min old), exiting`);
      process.exit(0);
    }
    log(`Stale lock (${ageMin.toFixed(1)} min), clearing`);
  }
  fs.writeFileSync(LOCK_FILE, `${process.pid}\n${new Date().toISOString()}\n`);
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function dateBack(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function lastTweetDate(corpusPath) {
  if (!fs.existsSync(corpusPath)) return null;
  try {
    const tweets = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
    if (!Array.isArray(tweets) || tweets.length === 0) return null;
    const ts = tweets.map((t) => t?.timestamp).filter(Boolean).sort();
    return ts[ts.length - 1]?.slice(0, 10) || null;
  } catch (e) {
    log(`Failed to parse ${corpusPath}: ${e.message}`);
    return null;
  }
}

function existingIds(corpusPath) {
  if (!fs.existsSync(corpusPath)) return new Set();
  try {
    const tweets = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
    return new Set(tweets.map((t) => t?.id).filter(Boolean));
  } catch {
    return new Set();
  }
}

// ---- main ----

const config = JSON.parse(fs.readFileSync(path.join(SYNC_DIR, 'users.json'), 'utf8'));
const users = (config.users || []).filter((u) => u.enabled);
if (users.length === 0) {
  log('No enabled users, exiting');
  process.exit(0);
}

acquireLock();

let browser;
const result = { date: today(), users: {} };

try {
  log(`Sync start; users=${users.map((u) => u.handle).join(',')}`);
  browser = await createBrowser();
  const page = await createPage(browser);
  await loginWithCookie(page, COOKIE);
  log('Logged in');

  for (const u of users) {
    const handle = u.handle;
    const userDir = path.join(ROOT, handle);
    const corpusPath = path.join(userDir, 'tweets-full.json');
    const dailyDir = path.join(userDir, 'daily');
    fs.mkdirSync(dailyDir, { recursive: true });

    // validate session via ct0 cookie presence
    let cookies = [];
    try {
      cookies = await page.cookies('https://x.com');
    } catch (e) {
      log(`${handle}: cookies() error: ${e.message}`);
    }
    const ct0 = cookies.find((c) => c.name === 'ct0');
    if (!ct0) {
      const msg = `cookie likely dead — no ct0 set by X after login attempt`;
      log(`${handle}: ${msg}`);
      await tgAlert(`COOKIE EXPIRED. Refresh auth_token in .env`);
      result.users[handle] = { ok: false, reason: 'no-ct0' };
      continue;
    }
    log(`${handle}: ct0 present, session OK`);

    // find since date — last_date - 1 to avoid edge truncation; floor at 14 days back
    const last = lastTweetDate(corpusPath);
    const sinceCandidate = last ? new Date(last) : new Date(dateBack(14));
    sinceCandidate.setUTCDate(sinceCandidate.getUTCDate() - 1);
    const sinceDate = sinceCandidate.toISOString().slice(0, 10);
    const untilDate = dateBack(-1);
    const query = `from:${handle} since:${sinceDate} until:${untilDate}`;
    log(`${handle}: query="${query}" (last in corpus: ${last || '∅'})`);

    // search
    let tweets = [];
    try {
      tweets = await searchTweets(page, query, { limit: 200, filter: 'latest' });
    } catch (e) {
      const msg = `${handle}: search error: ${e.message}`;
      log(msg);
      await tgAlert(msg);
      result.users[handle] = { ok: false, reason: 'search-error', error: e.message };
      continue;
    }
    log(`${handle}: search returned ${tweets.length} candidates`);

    // dedupe + atomic append
    const existing = existingIds(corpusPath);
    const newOnes = tweets.filter((t) => t?.id && !existing.has(t.id));
    log(`${handle}: ${newOnes.length} new after dedupe`);

    if (newOnes.length > 0) {
      let corpus = [];
      if (fs.existsSync(corpusPath)) {
        try {
          corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
          if (!Array.isArray(corpus)) throw new Error('corpus not array');
        } catch (e) {
          const msg = `${handle}: corpus corrupted (${e.message}); aborting write to avoid wiping data`;
          log(msg);
          await tgAlert(msg);
          result.users[handle] = { ok: false, reason: 'corpus-corrupted', error: e.message };
          continue;
        }
      }
      const merged = [...corpus, ...newOnes];
      merged.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

      const tmpPath = `${corpusPath}.tmp.${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2));
      fs.renameSync(tmpPath, corpusPath);

      // daily snapshot (overwrite OK — idempotent against corpus)
      fs.writeFileSync(
        path.join(dailyDir, `${today()}.json`),
        JSON.stringify(newOnes, null, 2),
      );
    }

    result.users[handle] = {
      ok: true,
      candidates: tweets.length,
      new: newOnes.length,
      corpus_total: existing.size + newOnes.length,
      since: sinceDate,
    };
  }

  log(`Sync done: ${JSON.stringify(result.users)}`);
} catch (e) {
  log(`FATAL: ${e.stack || e.message}`);
  await tgAlert(`daily-sync fatal: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  fs.writeFileSync(STATUS_FILE, JSON.stringify(result, null, 2));
  releaseLock();
}
