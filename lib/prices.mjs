/**
 * Free price fetcher via Yahoo Finance v8 API.
 * No auth needed. Falls back gracefully on failure.
 *
 * Returns { price, currency, change_pct, week52_high, week52_low } or null.
 */

export async function fetchPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "serenity-distiller/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      ticker,
      price: meta.regularMarketPrice,
      currency: meta.currency,
      change_pct: meta.regularMarketPrice && meta.previousClose
        ? +(((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100).toFixed(2)
        : null,
      week52_high: meta.fiftyTwoWeekHigh,
      week52_low: meta.fiftyTwoWeekLow,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch prices for multiple tickers. Returns Map<ticker, priceObj|null>.
 */
export async function fetchPrices(tickers) {
  const results = new Map();
  // sequential with small delay to be polite
  for (const t of tickers) {
    results.set(t, await fetchPrice(t));
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

/**
 * Format price for display.
 */
export function formatPrice(p) {
  if (!p) return "price unavailable";
  const dist52h = p.week52_high
    ? (((p.price - p.week52_high) / p.week52_high) * 100).toFixed(1)
    : "?";
  return `$${p.price} ${p.currency || ""} | ${p.change_pct >= 0 ? "+" : ""}${p.change_pct}% today | ${dist52h}% from 52wk high`;
}
