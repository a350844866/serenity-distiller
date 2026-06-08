/**
 * Download image URLs from tweets-full.json corpus to local archive.
 * Idempotent: skips files that already exist.
 * Path pattern: <user>/images/<tweet_id>_<index>.<ext>
 */
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const SELF_DIR = path.dirname(new URL(import.meta.url).pathname);
const USER = process.argv[2] || 'aleabitoreddit';
const ROOT = process.env.DATA_DIR || path.join(SELF_DIR, '..', 'x-exports');
const corpusPath = path.join(ROOT, USER, 'tweets-full.json');
const imgDir = path.join(ROOT, USER, 'images');

fs.mkdirSync(imgDir, { recursive: true });

if (!fs.existsSync(corpusPath)) {
  console.error(`No corpus at ${corpusPath}`);
  process.exit(1);
}

const tweets = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

const tasks = [];
for (const t of tweets) {
  const imgs = t?.media?.images || [];
  imgs.forEach((url, idx) => {
    if (!url) return;
    const fullUrl = url.replace(/&name=\w+/, '&name=large');
    const formatMatch = fullUrl.match(/format=(\w+)/);
    const ext = formatMatch ? formatMatch[1] : 'jpg';
    const fname = `${t.id}_${idx}.${ext}`;
    tasks.push({ tweetId: t.id, url: fullUrl, dest: path.join(imgDir, fname) });
  });
}

console.log(`Total image URLs in corpus: ${tasks.length}`);
const remaining = tasks.filter((t) => !fs.existsSync(t.dest));
console.log(`Already downloaded: ${tasks.length - remaining.length}`);
console.log(`To download: ${remaining.length}`);

let ok = 0, fail = 0;
for (const t of remaining) {
  try {
    const res = await fetch(t.url);
    if (!res.ok) {
      console.error(`HTTP ${res.status}: ${t.url}`);
      fail++;
      continue;
    }
    const tmp = t.dest + '.tmp';
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    fs.renameSync(tmp, t.dest);
    ok++;
    if (ok % 20 === 0) console.log(`Progress: ${ok}/${remaining.length}`);
  } catch (e) {
    console.error(`Error ${t.url}: ${e.message}`);
    fail++;
  }
  await new Promise((r) => setTimeout(r, 100));
}

console.log(`Done. ok=${ok} fail=${fail} skipped=${tasks.length - remaining.length}`);
