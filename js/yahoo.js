// ═══════════════════════════════════════════════
// Yahoo Finance API wrapper (GitHub Pages 호환)
// ═══════════════════════════════════════════════

const _YF_BASE = "https://query1.finance.yahoo.com";
const _YF_PROXIES = [
  "https://corsproxy.io/?url=",
  "https://api.allorigins.win/raw?url=",
];

async function _fetch(url) {
  // 1) 직접 시도 (대부분의 브라우저에서 CORS로 인해 실패할 수 있음)
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) return await r.json();
  } catch (_) {}

  // 2) 프록시 순서대로 시도
  for (const proxy of _YF_PROXIES) {
    try {
      const r = await fetch(proxy + encodeURIComponent(url), {
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const data = await r.json();
        return typeof data === "string" ? JSON.parse(data) : data;
      }
    } catch (_) {}
  }
  throw new Error("데이터를 불러오는데 실패했습니다.");
}

// ── OHLCV 데이터 (차트 데이터) ────────────────────
async function fetchOHLCV(ticker, range = "2y", interval = "1d") {
  const url = `${_YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&events=div%2Csplit`;
  const json = await _fetch(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${ticker}`);

  const timestamps = result.timestamp || [];
  const q = result.indicators.quote[0];
  const bars = [];

  for (let i = 0; i < timestamps.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || c == null || c === 0) continue;

    const ts = Math.floor(timestamps[i]);
    const dateStr = new Date(ts * 1000).toISOString().slice(0, 10);

    bars.push({ time: dateStr, ts, open: o, high: h, low: l, close: c, volume: v || 0 });
  }

  // 중복 제거 및 정렬
  const unique = Array.from(new Map(bars.map(b => [b.time, b])).values());
  unique.sort((a, b) => (a.time > b.time ? 1 : -1));

  return { bars: unique, meta: result.meta };
}

// ── 배치 현재가 (v7/finance/quote — 최대 50종목 한 번에) ─
// heatmap 45개 개별요청 → 1번 배치요청으로 429 근본 해결
async function _fetchBatchQuote(tickers) {
  if (!tickers.length) return {};
  const fields = "regularMarketPrice,regularMarketChange,regularMarketChangePercent,previousClose,shortName,longName,currency";
  const url = `${_YF_BASE}/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(","))}&fields=${fields}`;
  const json = await _fetch(url);
  const list = json?.quoteResponse?.result || [];
  const result = {};
  for (const q of list) {
    const price = q.regularMarketPrice;
    result[q.symbol] = price != null ? {
      ticker:      q.symbol,
      price,
      prev:        q.previousClose ?? null,
      change:      q.regularMarketChange ?? null,
      changePct:   q.regularMarketChangePercent ?? null,
      currency:    q.currency ?? null,
      name:        q.shortName || q.longName || q.symbol,
      marketState: q.marketState ?? null,
    } : null;
  }
  return result;
}

// ── 단일 현재가 ────────────────────────────────────────
async function fetchQuote(ticker) {
  // v7 배치 엔드포인트 사용 (더 효율적)
  try {
    const map = await _fetchBatchQuote([ticker.toUpperCase()]);
    const q   = map[ticker.toUpperCase()];
    if (q) return q;
  } catch (_) {}

  // fallback: v8 chart API meta
  try {
    const url  = `${_YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
    const json = await _fetch(url);
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice;
    const prev  = meta.previousClose || meta.chartPreviousClose;
    const change    = (price != null && prev != null) ? price - prev : null;
    const changePct = (change != null && prev) ? (change / prev) * 100 : null;
    return {
      ticker:      ticker.toUpperCase(),
      price, prev, change, changePct,
      currency:    meta.currency,
      name:        meta.shortName || meta.longName || ticker,
      marketState: meta.marketState,
    };
  } catch { return null; }
}

// ── 다수 현재가 (50개씩 배치 — 429 근본 해결) ──────────────
async function fetchMultiQuote(tickers) {
  const BATCH = 50;
  const result = {};
  for (let i = 0; i < tickers.length; i += BATCH) {
    const chunk = tickers.slice(i, i + BATCH);
    try {
      Object.assign(result, await _fetchBatchQuote(chunk));
    } catch (e) {
      console.warn("batch quote 실패:", e);
      chunk.forEach(t => { result[t] = null; });
    }
  }
  return result;
}

// ── 종목 검색 ────────────────────────────────────
async function searchTicker(query) {
  if (!query || query.length < 1) return [];
  const url = `${_YF_BASE}/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=0&enableFuzzyQuery=true&quotesCount=8`;
  try {
    const json = await _fetch(url);
    return (json?.quotes || [])
      .filter(q => ["EQUITY", "ETF", "INDEX"].includes(q.quoteType))
      .map(q => ({
        ticker:   q.symbol,
        name:     q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        type:     q.quoteType,
      }));
  } catch { return []; }
}