// ═══════════════════════════════════════════════
// Yahoo Finance API wrapper (browser-side)
// ═══════════════════════════════════════════════

const BASE = "https://query1.finance.yahoo.com";
const PROXY = "https://api.allorigins.win/raw?url=";

async function _fetch(url) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    // CORS 우회: allorigins 프록시 사용
    const r2 = await fetch(PROXY + encodeURIComponent(url));
    if (!r2.ok) throw new Error("proxy failed");
    return await r2.json();
  }
}

// ── OHLCV 데이터 (캔들 데이터) ────────────────────
// range: 1d 5d 1mo 3mo 6mo 1y 2y 5y 10y ytd max
// interval: 1m 5m 15m 30m 1h 1d 1wk 1mo
async function fetchOHLCV(ticker, range = "2y", interval = "1d") {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&events=div%2Csplit`;
  const json = await _fetch(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${ticker}`);

  const timestamps = result.timestamp || [];
  const q = result.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({
      time:   Math.floor(timestamps[i]),
      date:   new Date(timestamps[i] * 1000),
      open:   o, high: h, low: l, close: c, volume: v || 0
    });
  }
  return { bars, meta: result.meta };
}

// ── 현재가 / 당일 등락 ────────────────────────────
async function fetchQuote(ticker) {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  const json = await _fetch(url);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  return {
    ticker,
    price:      meta.regularMarketPrice,
    prev:       meta.previousClose || meta.chartPreviousClose,
    change:     meta.regularMarketPrice - (meta.previousClose || meta.chartPreviousClose),
    changePct:  ((meta.regularMarketPrice - (meta.previousClose || meta.chartPreviousClose)) / (meta.previousClose || meta.chartPreviousClose)) * 100,
    currency:   meta.currency,
    name:       meta.shortName || meta.longName || ticker,
  };
}

// ── 종목 검색 ────────────────────────────────────
async function searchTicker(query) {
  if (!query || query.length < 1) return [];
  const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=0&enableFuzzyQuery=true&quotesCount=8`;
  try {
    const json = await _fetch(url);
    return (json?.quotes || []).filter(q => q.quoteType === "EQUITY" || q.quoteType === "ETF").map(q => ({
      ticker:   q.symbol,
      name:     q.shortname || q.longname || q.symbol,
      exchange: q.exchange,
      type:     q.quoteType,
    }));
  } catch { return []; }
}

// ── 여러 종목 현재가 일괄 ─────────────────────────
async function fetchMultiQuote(tickers) {
  const results = {};
  await Promise.allSettled(tickers.map(async t => {
    try { results[t] = await fetchQuote(t); } catch { results[t] = null; }
  }));
  return results;
}
