// ═══════════════════════════════════════════════
// Yahoo Finance API wrapper (browser-side, GitHub Pages 호환)
// ═══════════════════════════════════════════════

const _YF_BASE   = "https://query1.finance.yahoo.com";
const _YF_BASE2  = "https://query2.finance.yahoo.com";
// CORS 프록시 목록 (순서대로 시도)
const _YF_PROXIES = [
  "https://corsproxy.io/?url=",
  "https://api.allorigins.win/raw?url=",
];

async function _fetch(url) {
  // 1) 직접 시도
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return await r.json();
  } catch (_) {}

  // 2) 프록시 순서대로 시도
  for (const proxy of _YF_PROXIES) {
    try {
      const r = await fetch(proxy + encodeURIComponent(url), {
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) return await r.json();
    } catch (_) {}
  }
  throw new Error("모든 프록시 실패: " + url.slice(0, 60));
}

// ── OHLCV 데이터 (캔들 데이터) ────────────────────
async function fetchOHLCV(ticker, range = "2y", interval = "1d") {
  const url = `${_YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&events=div%2Csplit`;
  const json = await _fetch(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${ticker}`);

  const timestamps = result.timestamp || [];
  const q = result.indicators.quote[0];
  const meta = result.meta || {};
  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null || c === 0) continue;
    const ts = Math.floor(timestamps[i]);
    // LightweightCharts 일봉: "YYYY-MM-DD" 형식 사용 (UTC 기준)
    const dateStr = new Date(ts * 1000).toISOString().slice(0, 10);
    bars.push({
      time:   dateStr,   // LightweightCharts용 날짜 문자열
      ts:     ts,        // Unix timestamp (FIS 계산 등 내부 사용)
      date:   new Date(ts * 1000),
      open:   o, high: h, low: l, close: c, volume: v || 0
    });
  }

  // 중복 날짜 제거 (같은 날짜는 마지막 항목만 유지)
  const seen = new Set();
  const unique = bars.filter(b => {
    if (seen.has(b.time)) return false;
    seen.add(b.time);
    return true;
  });
  // 날짜 오름차순 정렬 (LightweightCharts 요구사항)
  unique.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

  return { bars: unique, meta };
}

// ── 현재가 / 당일 등락 ────────────────────────────
async function fetchQuote(ticker) {
  const url = `${_YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  try {
    const json = await _fetch(url);
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice;
    if (price == null || price <= 0) return null;
    // Yahoo가 직접 계산한 값만 사용 — 자체 계산 폴백 없음
    // 값이 없으면 null 반환 → UI에서 "—" 표시
    const changePct = meta.regularMarketChangePercent ?? null;
    const change    = meta.regularMarketChange    ?? null;
    const prev      = meta.previousClose ?? meta.chartPreviousClose ?? null;
    return {
      ticker,
      price,
      prev,
      change,
      changePct,
      currency: meta.currency,
      name:     meta.shortName || meta.longName || ticker,
    };
  } catch { return null; }
}

// ── 여러 종목 현재가 일괄 ─────────────────────────
async function fetchMultiQuote(tickers) {
  const results = {};
  await Promise.allSettled(tickers.map(async t => {
    try { results[t] = await fetchQuote(t); } catch { results[t] = null; }
  }));
  return results;
}

// ── 종목 검색 ────────────────────────────────────
async function searchTicker(query) {
  if (!query || query.length < 1) return [];
  const url = `${_YF_BASE}/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=0&enableFuzzyQuery=true&quotesCount=8`;
  try {
    const json = await _fetch(url);
    return (json?.quotes || [])
      .filter(q => q.quoteType === "EQUITY" || q.quoteType === "ETF" || q.quoteType === "INDEX")
      .map(q => ({
        ticker:   q.symbol,
        name:     q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        type:     q.quoteType,
      }));
  } catch { return []; }
}
