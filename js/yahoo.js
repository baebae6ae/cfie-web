
// ── 미국 주요 종목 로컬 검색 DB (ticker, 검색어들...) ──────────────────────
// API 없이 이름으로 즉시 검색 가능
const _US_STOCKS = [
  // Mega-cap Tech
  ["AAPL",  "Apple"],
  ["MSFT",  "Microsoft"],
  ["GOOGL", "Alphabet", "Google"],
  ["GOOG",  "Alphabet C", "Google C"],
  ["META",  "Meta", "Facebook"],
  ["AMZN",  "Amazon"],
  ["TSLA",  "Tesla"],
  ["NVDA",  "NVIDIA", "Nvidia"],
  ["AVGO",  "Broadcom"],
  ["ORCL",  "Oracle"],
  ["AMD",   "Advanced Micro Devices", "AMD"],
  ["INTC",  "Intel"],
  ["CRM",   "Salesforce"],
  ["TSM",   "TSMC", "Taiwan Semiconductor"],
  ["QCOM",  "Qualcomm"],
  ["MU",    "Micron", "Micron Technology"],
  ["AMAT",  "Applied Materials"],
  ["KLAC",  "KLA Corporation"],
  ["LRCX",  "Lam Research"],
  ["ASML",  "ASML"],
  ["ARM",   "ARM Holdings"],
  ["ADBE",  "Adobe"],
  ["INTU",  "Intuit"],
  ["NOW",   "ServiceNow"],
  ["SNOW",  "Snowflake"],
  ["DDOG",  "Datadog"],
  ["NET",   "Cloudflare"],
  ["MDB",   "MongoDB"],
  ["PANW",  "Palo Alto Networks"],
  ["CRWD",  "CrowdStrike"],
  ["ZS",    "Zscaler"],
  ["OKTA",  "Okta"],
  ["TEAM",  "Atlassian"],
  ["SAP",   "SAP"],
  ["IBM",   "IBM"],
  ["HPQ",   "HP Inc"],
  ["DELL",  "Dell"],
  // Communication
  ["NFLX",  "Netflix"],
  ["DIS",   "Disney"],
  ["T",     "AT&T"],
  ["VZ",    "Verizon"],
  ["CMCSA", "Comcast"],
  ["WBD",   "Warner Bros Discovery"],
  ["PARA",  "Paramount"],
  ["SPOT",  "Spotify"],
  ["SNAP",  "Snap", "Snapchat"],
  ["PINS",  "Pinterest"],
  ["TTWO",  "Take-Two Interactive", "2K"],
  ["EA",    "Electronic Arts"],
  ["RBLX",  "Roblox"],
  ["U",     "Unity"],
  // Consumer
  ["AMZN",  "Amazon Prime"],
  ["HD",    "Home Depot"],
  ["COST",  "Costco"],
  ["WMT",   "Walmart"],
  ["TGT",   "Target"],
  ["KO",    "Coca-Cola", "Coke"],
  ["PEP",   "PepsiCo", "Pepsi"],
  ["NKE",   "Nike"],
  ["SBUX",  "Starbucks"],
  ["MCD",   "McDonald"],
  ["CMG",   "Chipotle"],
  ["LULU",  "Lululemon"],
  ["UBER",  "Uber"],
  ["LYFT",  "Lyft"],
  ["ABNB",  "Airbnb"],
  ["DASH",  "DoorDash"],
  ["SHOP",  "Shopify"],
  ["ETSY",  "Etsy"],
  ["EBAY",  "eBay"],
  // Finance
  ["JPM",   "JPMorgan", "JP Morgan"],
  ["BAC",   "Bank of America"],
  ["WFC",   "Wells Fargo"],
  ["C",     "Citigroup", "Citi"],
  ["GS",    "Goldman Sachs"],
  ["MS",    "Morgan Stanley"],
  ["V",     "Visa"],
  ["MA",    "Mastercard"],
  ["AXP",   "American Express", "Amex"],
  ["BLK",   "BlackRock"],
  ["SCHW",  "Charles Schwab"],
  ["PYPL",  "PayPal"],
  ["SQ",    "Block", "Square"],
  ["COIN",  "Coinbase"],
  ["HOOD",  "Robinhood"],
  ["BRK-B", "Berkshire Hathaway"],
  // Healthcare
  ["UNH",   "UnitedHealth"],
  ["LLY",   "Eli Lilly"],
  ["JNJ",   "Johnson Johnson", "J&J"],
  ["ABBV",  "AbbVie"],
  ["MRK",   "Merck"],
  ["PFE",   "Pfizer"],
  ["AMGN",  "Amgen"],
  ["GILD",  "Gilead"],
  ["VRTX",  "Vertex Pharmaceuticals"],
  ["REGN",  "Regeneron"],
  ["ISRG",  "Intuitive Surgical"],
  ["BMY",   "Bristol-Myers Squibb"],
  ["CVS",   "CVS Health"],
  ["ELV",   "Elevance Health"],
  ["CI",    "Cigna"],
  // Energy
  ["XOM",   "Exxon", "ExxonMobil"],
  ["CVX",   "Chevron"],
  ["COP",   "ConocoPhillips"],
  ["SLB",   "SLB", "Schlumberger"],
  ["EOG",   "EOG Resources"],
  ["PSX",   "Phillips 66"],
  ["MPC",   "Marathon Petroleum"],
  ["OXY",   "Occidental Petroleum"],
  // Industrial
  ["CAT",   "Caterpillar"],
  ["BA",    "Boeing"],
  ["HON",   "Honeywell"],
  ["LMT",   "Lockheed Martin"],
  ["RTX",   "RTX", "Raytheon"],
  ["GE",    "GE Aerospace", "General Electric"],
  ["DE",    "Deere", "John Deere"],
  ["MMM",   "3M"],
  ["GD",    "General Dynamics"],
  ["NOC",   "Northrop Grumman"],
  ["UPS",   "UPS", "United Parcel Service"],
  ["FDX",   "FedEx"],
  ["CSX",   "CSX"],
  ["UNP",   "Union Pacific"],
  // Materials / Real Estate / Utilities
  ["LIN",   "Linde"],
  ["APD",   "Air Products"],
  ["AMT",   "American Tower"],
  ["PLD",   "Prologis"],
  ["EQIX",  "Equinix"],
  ["NEE",   "NextEra Energy"],
  ["DUK",   "Duke Energy"],
  // ETFs
  ["SPY",   "S&P 500 ETF", "SPDR SPY"],
  ["QQQ",   "Nasdaq ETF", "Invesco QQQ"],
  ["IWM",   "Russell 2000 ETF"],
  ["VTI",   "Vanguard Total Market"],
  ["VOO",   "Vanguard S&P 500"],
  ["ARKK",  "ARK Innovation"],
  ["XLK",   "Tech ETF", "SPDR XLK"],
  ["XLF",   "Finance ETF"],
  ["XLV",   "Healthcare ETF"],
  ["XLE",   "Energy ETF"],
  // Asian ADRs
  ["BABA",  "Alibaba"],
  ["BIDU",  "Baidu"],
  ["JD",    "JD.com"],
  ["PDD",   "PDD Holdings", "Temu", "Pinduoduo"],
  ["NIO",   "NIO"],
  ["XPEV",  "Xpeng"],
  ["LI",    "Li Auto"],
  ["RIVN",  "Rivian"],
  ["LCID",  "Lucid Motors"],
  ["PLTR",  "Palantir"],
  ["COIN",  "Coinbase"],
  ["SONY",  "Sony"],
  ["TM",    "Toyota"],
  ["HMC",   "Honda"],
];

function _searchUSLocal(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  const seen = new Set();
  for (const [ticker, ...names] of _US_STOCKS) {
    if (seen.has(ticker)) continue;
    const match =
      ticker.toLowerCase() === q ||
      ticker.toLowerCase().startsWith(q) ||
      names.some(n => n.toLowerCase().includes(q));
    if (match) {
      seen.add(ticker);
      results.push({ ticker, name: names[0] || ticker, exchange: "US", type: "EQUITY" });
    }
    if (results.length >= 8) break;
  }
  return results;
}

// ═══════════════════════════════════════════════
// Yahoo Finance API wrapper (GitHub Pages 호환)
// ═══════════════════════════════════════════════

// ?? ?? ?? (sessionStorage 10? / localStorage 24??) ?????
const _CACHE_PFX = "cfie_yf_";
function _ssGet(key) {
  try {
    const raw = sessionStorage.getItem(_CACHE_PFX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > 600_000) { sessionStorage.removeItem(_CACHE_PFX + key); return null; }
    return data;
  } catch { return null; }
}
function _ssSet(key, data) {
  try { sessionStorage.setItem(_CACHE_PFX + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}
function _lsGet(key, ttl = 21_600_000) {  // 6?? ?? TTL
  try {
    const raw = localStorage.getItem(_CACHE_PFX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { localStorage.removeItem(_CACHE_PFX + key); return null; }
    return data;
  } catch { return null; }
}
function _lsSet(key, data) {
  try { localStorage.setItem(_CACHE_PFX + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

const _YF_BASE = "https://query1.finance.yahoo.com";
const _YF_PROXIES = [
  "https://spring-block-72b2.eowns0606.workers.dev/?url=",  // 전용 Cloudflare Worker (속도제한 없음)
  "https://corsproxy.io/?url=",                              // 백업
];

async function _fetch(url) {
  // 프록시를 순차 시도 (병렬 → 순차: 동시 요청 절반으로 감소 → 429 방지)
  const _parse = async (r) => {
    if (r.status === 429) throw Object.assign(new Error("Rate limited (429)"), { is429: true });
    if (r.status === 401) throw Object.assign(new Error("Unauthorized (401)"), { is401: true });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data && typeof data.contents === "string") return JSON.parse(data.contents);
    return typeof data === "string" ? JSON.parse(data) : data;
  };
  for (let _attempt = 0; _attempt < 3; _attempt++) {
    let _got429 = false;
    for (const p of _YF_PROXIES) {
      try {
        const r = await fetch(p + encodeURIComponent(url), {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        return await _parse(r);
      } catch (e) {
        if (e.is429) { _got429 = true; continue; }
        if (e.is401) {
          // 401: Yahoo 세션 초기화 이슈 — 300ms 후 동일 프록시 즉시 재시도
          // (첫 401로 Yahoo가 해당 IP를 인식하면 이후 요청은 200 반환)
          try {
            await new Promise(r => setTimeout(r, 300));
            const r2 = await fetch(p + encodeURIComponent(url), { cache: "no-store", signal: AbortSignal.timeout(10000) });
            return await _parse(r2);
          } catch (_) {}
          continue;
        }
        // 기타 네트워크 오류 → 다음 프록시로
      }
    }
    // 모든 프록시 실패: 429면 5초, 그 외 2초 대기 후 재시도
    if (_attempt < 2) await new Promise(r => setTimeout(r, _got429 ? 5000 : 2000));
  }
  throw new Error("All proxies failed");
}

// ── OHLCV 데이터 (차트 데이터) ────────────────────
async function fetchOHLCV(ticker, range = "2y", interval = "1d") {
  const _ck = `ohlcv_${ticker}_${range}_${interval}`;
  const _cached = _lsGet(_ck);
  if (_cached) return _cached;
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
  const _res = { bars: unique, meta: result.meta };
  _lsSet(_ck, _res);
  return _res;
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

// ── 배치 현재가 조회 (청크 병렬 처리 — 빠름) ────────────────────
async function fetchBatchQuote(tickers) {
  const MAX = 25;  // Yahoo Finance 배치 한계 — 25개씩 분할
  const dict = {};
  const chunks = [];
  for (let i = 0; i < tickers.length; i += MAX) chunks.push(tickers.slice(i, i + MAX));
  await Promise.allSettled(chunks.map(async (chunk) => {
    try {
      const url  = `${_YF_BASE}/v7/finance/quote?symbols=${chunk.join(',')}`;
      const json = await _fetch(url);
      for (const r of (json?.quoteResponse?.result ?? [])) {
        dict[r.symbol] = {
          ticker:      r.symbol,
          price:       r.regularMarketPrice ?? null,
          prev:        r.regularMarketPreviousClose ?? null,
          change:      r.regularMarketChange ?? null,
          changePct:   r.regularMarketChangePercent ?? null,
          currency:    r.currency ?? null,
          name:        r.shortName || r.longName || r.symbol,
          marketState: r.marketState ?? null,
        };
      }
    } catch (_) { /* 개별 청크 실패 → 해당 티커는 null로 처리됨 */ }
  }));
  for (const t of tickers) { if (!(t in dict)) dict[t] = null; }
  return dict;
}

// ── 다수 현재가 (배치 → null 종목 개별 보완) ────────────────────────
async function fetchMultiQuote(tickers) {
  // 1) 배치 API (25개씩 병렬 조회)
  let result = {};
  try { result = await fetchBatchQuote(tickers); } catch (_) {}

  // 2) 배치에서 누락된 종목만 개별 재시도 (6개씩 병렬)
  const missing = tickers.filter(t => !result[t]);
  for (let i = 0; i < missing.length; i += 6) {
    const chunk = missing.slice(i, i + 6);
    const settled = await Promise.allSettled(chunk.map(t => fetchQuote(t)));
    chunk.forEach((t, idx) => {
      const r = settled[idx];
      result[t] = r.status === "fulfilled" ? r.value : null;
    });
  }
  return result;
}

// ── 종목 검색 ────────────────────────────────────
async function searchTicker(query) {
  if (!query || query.length < 1) return [];
  // 1. 로컬 US 종목 DB 우선 검색 (API 불필요, 즉시 응답)
  const local = _searchUSLocal(query);
  if (local.length >= 4) return local;

  // 2. Yahoo Finance API 시도 (CORS 프록시 경유)
  const url = `${_YF_BASE}/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=0&enableFuzzyQuery=true&quotesCount=8`;
  try {
    const json = await _fetch(url);
    const api = (json?.quotes || [])
      .filter(q => ["EQUITY", "ETF", "INDEX"].includes(q.quoteType))
      .map(q => ({
        ticker:   q.symbol,
        name:     q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        type:     q.quoteType,
      }));
    // 로컬 결과 우선, API 결과로 보완
    const localTickers = new Set(local.map(r => r.ticker));
    return [...local, ...api.filter(r => !localTickers.has(r.ticker))].slice(0, 8);
  } catch { return local; }
}