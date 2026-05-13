// ═══════════════════════════════════════════════
// Yahoo Finance API wrapper (GitHub Pages 호환)
// ═══════════════════════════════════════════════

const _YF_BASE = "https://query1.finance.yahoo.com";
const _YF_PROXIES = [
  "https://corsproxy.io/?url=",
  "https://api.allorigins.win/raw?url=",
];

async function _fetch(url) {
  // 1) 직접 시도
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
        // allorigins는 {contents:"...json..."} 형태로 반환하기도 함
        if (data && typeof data.contents === "string") return JSON.parse(data.contents);
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

  const unique = Array.from(new Map(bars.map(b => [b.time, b])).values());
  unique.sort((a, b) => (a.time > b.time ? 1 : -1));
  return { bars: unique, meta: result.meta };
}

// ── 단일 현재가 (v8 chart, range=5d interval=1d — meta보다 bars로 계산이 정확) ──
async function fetchQuote(ticker) {
  try {
    const url = `${_YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
    const json = await _fetch(url);
    const result = json?.chart?.result?.[0];
    const meta   = result?.meta;
    if (!meta) return null;

    const price = meta.regularMarketPrice;
    if (price == null) return null;

    // closes: null 제거한 완성 바 종가 목록 (오늘 미완성 바는 이미 close=null로 필터됨)
    const closes    = (result.indicators?.quote?.[0]?.close || []).filter(c => c != null);
    const lastClose = closes[closes.length - 1] ?? null;   // 가장 최근 완성 종가
    const prevClose = closes[closes.length - 2] ?? null;   // 그 전날 종가

    // price가 lastClose와 0.1% 이상 차이 → 장중/프리마켓 → prev = lastClose(어제)
    // price ≈ lastClose → 장후/마감 상태 → prev = prevClose(전전일)
    const prev = (lastClose != null && Math.abs(price - lastClose) > lastClose * 0.001)
      ? lastClose
      : prevClose;

    const change    = prev != null ? price - prev : null;
    const changePct = (change != null && prev) ? (change / prev) * 100 : null;

    return {
      ticker:      ticker.toUpperCase(),
      price,
      prev,
      change,
      changePct,
      currency:    meta.currency ?? null,
      name:        meta.shortName || meta.longName || ticker,
      marketState: meta.marketState ?? null,
    };
  } catch { return null; }
}

// ── 다수 현재가 (4개씩 병렬 + 150ms 딜레이 — 429 방지) ──────
async function fetchMultiQuote(tickers) {
  const CONCURRENCY = 4;
  const DELAY_MS    = 150;
  const results     = {};

  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map(t => fetchQuote(t)));
    chunk.forEach((t, idx) => {
      const r = settled[idx];
      results[t] = r.status === "fulfilled" ? r.value : null;
    });
    // 마지막 청크 제외 딜레이
    if (i + CONCURRENCY < tickers.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }
  return results;
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