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
      const targetUrl = proxy + encodeURIComponent(url);
      const r = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        // allorigins 프록시는 데이터를 문자열로 반환할 때가 있어 파싱 처리
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
    
    bars.push({
      time: dateStr,
      ts: ts,
      open: o, high: h, low: l, close: c, volume: v || 0
    });
  }

  // 중복 제거 및 정렬
  const unique = Array.from(new Map(bars.map(b => [b.time, b])).values());
  unique.sort((a, b) => (a.time > b.time ? 1 : -1));

  return { bars: unique, meta: result.meta };
}

// ── 현재가 / 당일 등락 (수정 핵심 로직) ──────────────
async function fetchQuote(ticker) {
  // v8 chart API는 실시간성 데이터가 meta에 포함되어 있음
  const url = `${_YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`;
  
  try {
    const json = await _fetch(url);
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    
    if (!meta) return null;

    // 1. 기본 값 추출
    let price = meta.regularMarketPrice;
    let prev = meta.previousClose || meta.chartPreviousClose;
    
    // 2. 만약 meta에 가격 정보가 없다면 차트의 마지막 종가를 가져옴
    if (price == null && result.indicators.quote[0].close) {
        const closes = result.indicators.quote[0].close.filter(v => v !== null);
        price = closes[closes.length - 1];
    }

    // 3. 등락 및 등락률 계산 (Yahoo가 값을 안 줄 경우 대비)
    let change = meta.regularMarketChange;
    let changePct = meta.regularMarketChangePercent;

    if (change == null && price != null && prev != null) {
      change = price - prev;
    }
    if (changePct == null && price != null && prev != null && prev !== 0) {
      changePct = (change / prev) * 100;
    }

    return {
      ticker:   ticker.toUpperCase(),
      price:    price,
      prev:     prev,
      change:   change,
      changePct: changePct, // 이제 null 대신 계산된 값이 들어감
      currency: meta.currency,
      name:     meta.shortName || meta.longName || ticker,
      marketState: meta.marketState // REGULAR, CLOSED, PREPRE 등
    };
  } catch (e) {
    console.error(`Fetch error (${ticker}):`, e);
    return null;
  }
}

// ── 여러 종목 현재가 일괄 ─────────────────────────
async function fetchMultiQuote(tickers) {
  const results = {};
  // 순차적이 아닌 병렬 처리를 통해 속도 향상
  const promises = tickers.map(async (t) => {
    try {
      results[t] = await fetchQuote(t);
    } catch {
      results[t] = null;
    }
  });
  await Promise.allSettled(promises);
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
  } catch {
    return [];
  }
}