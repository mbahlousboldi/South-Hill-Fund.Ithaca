/**
 * South Hill Fund — server
 *
 * Serves the static site and proxies live quotes from Yahoo Finance.
 *
 * IMPORTANT: Yahoo Finance has no official, supported public API. This uses
 * the same unauthenticated endpoints Yahoo's own website calls in the
 * browser. That means:
 *   - It can change or break without notice.
 *   - It must be called from a SERVER (this file), not the browser, because
 *     Yahoo does not send CORS headers that allow direct browser requests.
 *   - Requests are cached for CACHE_MS to stay well under any rate limits.
 *   - If Yahoo is unreachable, the API falls back to the last successful
 *     quotes (or null values), and the frontend falls back to showing
 *     the static statement data with a "live price unavailable" note.
 *
 * If this ever needs to be swapped for a licensed/paid market data feed
 * (recommended for a permanent production deployment), only fetchQuotes()
 * below needs to change — the rest of the app just calls GET /api/quotes.
 */

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const holdings = require("./data/holdings.json");

app.use((req, res, next) => {
  // Disable caching entirely — this app changes often during development,
  // and stale cached CSS/JS is a common source of "my change isn't showing up."
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

app.use(express.static(path.join(__dirname, "public"), { etag: false, lastModified: false }));

// ---- Collect every unique ticker across all three funds ----
function allSymbols() {
  const symbols = new Set();
  for (const fund of Object.values(holdings.funds)) {
    (fund.holdings || []).forEach((h) => symbols.add(h.symbol));
  }
  return [...symbols];
}

const CACHE_MS = 30 * 1000; // refresh at most every 30s
let cache = { data: {}, ts: 0 };

const FETCH_TIMEOUT_MS = 6000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Try the batch quote endpoint first (fastest — one request for all symbols).
async function fetchQuotesBatch(symbols) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols
    .map(encodeURIComponent)
    .join(",")}`;
  const json = await fetchJson(url);
  const results = json?.quoteResponse?.result || [];
  if (results.length === 0) throw new Error("Empty batch quote response");

  const out = {};
  for (const q of results) {
    out[q.symbol] = {
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePercent: q.regularMarketChangePercent ?? null,
      currency: q.currency || "USD",
    };
  }
  return out;
}

// Fallback: one request per symbol against the chart endpoint, which tends
// to be more permissive than the quote endpoint if that one is blocked.
async function fetchQuotesPerSymbol(symbols) {
  const out = {};
  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          sym
        )}`;
        const json = await fetchJson(url);
        const meta = json?.chart?.result?.[0]?.meta;
        if (!meta) throw new Error("No meta");
        const price = meta.regularMarketPrice;
        const prevClose = meta.previousClose ?? meta.chartPreviousClose;
        out[sym] = {
          price: price ?? null,
          change: price != null && prevClose != null ? price - prevClose : null,
          changePercent:
            price != null && prevClose ? ((price - prevClose) / prevClose) * 100 : null,
          currency: meta.currency || "USD",
        };
      } catch (e) {
        out[sym] = null;
      }
    })
  );
  return out;
}

async function fetchQuotes(symbols) {
  try {
    return await fetchQuotesBatch(symbols);
  } catch (e) {
    console.warn("Batch quote endpoint failed, falling back per-symbol:", e.message);
    return await fetchQuotesPerSymbol(symbols);
  }
}

app.get("/api/quotes", async (req, res) => {
  const now = Date.now();
  if (now - cache.ts < CACHE_MS && Object.keys(cache.data).length) {
    return res.json({ quotes: cache.data, asOf: cache.ts, source: "cache" });
  }

  const symbols = allSymbols();
  try {
    const quotes = await fetchQuotes(symbols);
    // Merge onto previous cache so a partial failure doesn't blank out
    // symbols that succeeded on a prior request.
    cache = { data: { ...cache.data, ...quotes }, ts: now };
    res.json({ quotes: cache.data, asOf: cache.ts, source: "live" });
  } catch (e) {
    console.error("Quote fetch failed entirely:", e.message);
    res.json({ quotes: cache.data, asOf: cache.ts, source: "stale" });
  }
});

app.get("/api/holdings", (req, res) => {
  res.json(holdings);
});

app.listen(PORT, () => {
  console.log(`South Hill Fund site running at http://localhost:${PORT}`);
});
