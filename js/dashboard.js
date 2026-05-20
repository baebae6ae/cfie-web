/* js/dashboard.js */

// ── 지수 목록 ─────────────────────────────────────────
const KR_INDICES = [
  { ticker: "^KS11", name: "KOSPI" },
  { ticker: "^KQ11", name: "KOSDAQ" },
  { ticker: "KRW=X",  name: "원/달러" },
];
const US_INDICES = [
  { ticker: "^GSPC", name: "S&P 500" },
  { ticker: "^IXIC", name: "NASDAQ" },
  { ticker: "^DJI",  name: "DOW" },
  { ticker: "^VIX",  name: "VIX" },
  { ticker: "^TNX",  name: "미 10년물" },
  { ticker: "GC=F",  name: "금" },
];

// ── 섹터 목록 (시총 상위 기준, 섹터당 3~5개) ─────────────
const KR_SECTORS = [
  ["반도체", [
    ["005930.KS","삼성전자"],["000660.KS","SK하이닉스"],["042700.KQ","한미반도체"],
    ["009150.KS","삼성전기"],["058470.KQ","리노공업"],
  ]],
  ["자동차", [
    ["005380.KS","현대차"],["000270.KS","기아"],
    ["012330.KS","현대모비스"],["204320.KS","만도"],
  ]],
  ["화학·배터리", [
    ["051910.KS","LG화학"],["006400.KS","삼성SDI"],
    ["247540.KQ","에코프로비엠"],["096770.KS","SK이노베이션"],
  ]],
  ["금융", [
    ["105560.KS","KB금융"],["055550.KS","신한지주"],
    ["086790.KS","하나금융지주"],["032830.KS","삼성생명"],
  ]],
  ["IT·플랫폼", [
    ["035420.KS","NAVER"],["035720.KS","카카오"],
    ["017670.KS","SK텔레콤"],["030200.KS","KT"],
  ]],
  ["에너지·소재", [
    ["015760.KS","한국전력"],["034020.KS","두산에너빌리티"],
    ["005490.KS","POSCO홀딩스"],["078930.KS","GS"],
  ]],
  ["산업재", [
    ["028260.KS","삼성물산"],["012450.KS","한화에어로스페이스"],
    ["267270.KS","HD현대"],["003490.KS","대한항공"],
  ]],
  ["바이오·헬스", [
    ["207940.KS","삼성바이오로직스"],["068270.KS","셀트리온"],
    ["196170.KQ","알테오젠"],["128940.KS","한미약품"],
  ]],
  ["게임·엔터", [
    ["259960.KS","크래프톤"],["352820.KS","하이브"],
    ["036570.KS","엔씨소프트"],["041510.KQ","에스엠"],
  ]],
  ["소부장", [
    ["357780.KQ","솔브레인"],["140860.KQ","파크시스템스"],["039030.KQ","이오테크닉스"],
  ]],
];
const US_SECTORS = [
  ["Tech", [
    ["AAPL","Apple"],["MSFT","Microsoft"],["NVDA","NVIDIA"],["AVGO","Broadcom"],
    ["ORCL","Oracle"],["AMD","AMD"],["INTC","Intel"],["CRM","Salesforce"],
    ["TSM","TSMC"],["QCOM","Qualcomm"],["MU","Micron"],["AMAT","Applied Materials"],
  ]],
  ["Communication", [
    ["GOOGL","Alphabet"],["META","Meta"],["NFLX","Netflix"],["DIS","Disney"],
    ["T","AT&T"],["VZ","Verizon"],["CMCSA","Comcast"],
  ]],
  ["Consumer", [
    ["AMZN","Amazon"],["TSLA","Tesla"],["HD","Home Depot"],["COST","Costco"],
    ["WMT","Walmart"],["KO","Coca-Cola"],["PEP","PepsiCo"],["NKE","Nike"],
    ["SBUX","Starbucks"],
  ]],
  ["Finance", [
    ["JPM","JPMorgan"],["V","Visa"],["MA","Mastercard"],["BAC","Bank of America"],
    ["GS","Goldman Sachs"],["MS","Morgan Stanley"],["AXP","Amex"],
  ]],
  ["Healthcare", [
    ["UNH","UnitedHealth"],["LLY","Eli Lilly"],["JNJ","J&J"],["ABBV","AbbVie"],
    ["MRK","Merck"],["PFE","Pfizer"],["AMGN","Amgen"],["GILD","Gilead"],
  ]],
  ["Energy", [
    ["XOM","Exxon"],["CVX","Chevron"],["COP","ConocoPhillips"],["SLB","SLB"],
  ]],
  ["Industrial", [
    ["CAT","Caterpillar"],["BA","Boeing"],["HON","Honeywell"],
    ["LMT","Lockheed Martin"],["RTX","RTX"],["GE","GE Aerospace"],
  ]],
];

// ── 이름 단축 (market.py::short_name 로직) ──────────
function _shortName(name) {
  if (!name) return "";
  let s = name.replace(/홀딩스|전자/g, "").replace(/\s?(Inc\.|Corp\.|Ltd\.)/i, "").trim();
  if (s.length > 8) s = s.slice(0, 8);
  return s || name.slice(0, 8);
}

// ── 상태 ───────────────────────────────────────────
const _mapCache  = {};
const _mapMode   = { KR: "sector", US: "sector" };
const _allQuotes = {};  // KR+US 지수 누적 (ticker strip 점진 갱신용)
let _h52Market  = "kospi";
const _h52State = { offset: 0, limit: 10, hasMore: false, loading: false, items: [] };
let _h52Universe = {};
let _h52StopFlag = false;

// ── 초기화 (순차 로딩 — 프록시 429 방지) ─────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await _loadMarketGroup(KR_INDICES, "krQuotes", "krUpdated");  // ① KR 지수
  await loadMarketMap("KR");                                     // ② KR 히트맵
  await _loadMarketGroup(US_INDICES, "usQuotes", "usUpdated");  // ③ US 지수
  await loadMarketMap("US");                                     // ④ US 히트맵
  load52h("kospi", document.querySelector(".h52-tab"));         // ⑤ 52주 신고가 (백그라운드)
});

// ── 시장 지수 (그룹별 순차 로딩) ──────────────────────────────────────
async function _loadMarketGroup(indices, quotesId, updatedId) {
  for (let _attempt = 0; _attempt < 3; _attempt++) {
    try {
      const quotes = await fetchMultiQuote(indices.map(i => i.ticker));
      renderQuotes(quotesId, indices, quotes, updatedId);
      Object.assign(_allQuotes, quotes);
      renderTickerStrip([...KR_INDICES, ...US_INDICES], _allQuotes);
      return;
    } catch(e) {
      console.warn("loadMarket 시도", _attempt + 1, "실패:", e.message);
      if (_attempt < 2) await new Promise(r => setTimeout(r, 3000 * (_attempt + 1)));
    }
  }
}

function renderTickerStrip(indices, quotes) {
  const track = document.getElementById("tickerTrack");
  if (!track) return;
  const html = indices.map(idx => {
    const q = quotes[idx.ticker] || {};
    const pct = q.changePct ?? null;
    const cls = pct == null ? "flat" : pct > 0 ? "bull" : pct < 0 ? "bear" : "flat";
    const sign = pct != null && pct > 0 ? "+" : "";
    return `<div class="ticker-item">
      <span class="ti-name">${idx.name}</span>
      <span class="ti-price">${q.price != null ? fmt(q.price, 2) : "—"}</span>
      <span class="ti-chg ${cls}">${pct != null ? sign + pct.toFixed(2) + "%" : "—"}</span>
    </div>`;
  }).join("");
  track.innerHTML = html + html;
}

function renderQuotes(containerId, indices, quotes, updatedId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const updEl = document.getElementById(updatedId);
  const now = new Date().toLocaleTimeString("ko-KR", {hour:"2-digit",minute:"2-digit"});
  if (updEl) updEl.textContent = now + " 기준";
  el.innerHTML = indices.map(idx => {
    const q   = quotes[idx.ticker] || {};
    const pct = q.changePct ?? null;
    const cls = pct == null ? "flat" : pct > 0 ? "bull" : pct < 0 ? "bear" : "flat";
    const sign = pct != null && pct > 0 ? "+" : "";
    const abssign = (q.change ?? 0) > 0 ? "+" : "";
    const arrow = pct == null ? "—" : pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
    const barW  = pct != null ? Math.min(Math.abs(pct) / 4 * 100, 100) : 0;
    return `
      <div class="mq-row" onclick="goAnalyze('${idx.ticker}')">
        <div class="mq-left">
          <span class="mq-name">${idx.name}</span>
          <span class="mq-arrow ${cls}">${arrow}</span>
        </div>
        <div class="mq-right">
          <div class="mq-price">${q.price != null ? fmt(q.price, 2) : "—"}</div>
          <div class="mq-chg-row">
            <span class="mq-pct ${cls}">${q.changePct != null ? sign + pct.toFixed(2) + "%" : "—"}</span>
            <span class="mq-abs ${cls}">${q.change != null ? abssign + fmt(q.change, 2) : ""}</span>
          </div>
          <div class="mq-bar-wrap"><div class="mq-bar ${cls}" style="width:${barW}%"></div></div>
        </div>
      </div>`;
  }).join("");
}

// ── 마켓맵 ────────────────────────────────────────────
async function loadMarketMap(region) {
  const bodyId = region === "KR" ? "krMapBody" : "usMapBody";
  const body   = document.getElementById(bodyId);
  if (!body) return;
  if (_mapCache[region]) { _drawMap(region, body, _mapCache[region]); return; }
  const sectors = region === "KR" ? KR_SECTORS : US_SECTORS;
  const allTickers = sectors.flatMap(([, stocks]) => stocks.map(([t]) => t));
  for (let _attempt = 0; _attempt < 3; _attempt++) {
    body.innerHTML = _attempt === 0
      ? '<div class="map-loading">히트맵 로딩 중…</div>'
      : `<div class="map-loading">히트맵 로딩 중… (재시도 ${_attempt}/2)</div>`;
    try {
      const quotes = await fetchMultiQuote(allTickers);
      // stocks 배열 생성
      const stocks = [];
      const sectorAggMap = {};
      for (const [sectorName, stockList] of sectors) {
        const changePcts = [];
        for (const [ticker, name] of stockList) {
          const q = quotes[ticker] || {};
          const changePct = q.changePct ?? null;  // null 유지, 0으로 채우지 않음
          const short = _shortName(name);
          stocks.push({ ticker, name, short, change_pct: changePct != null ? Math.round(changePct * 100) / 100 : null, sector: sectorName });
          if (changePct != null) changePcts.push(changePct);  // null 제외하고 평균
        }
        const avg = changePcts.length ? changePcts.reduce((a,b)=>a+b,0)/changePcts.length : null;
        sectorAggMap[sectorName] = { name: sectorName, change_pct: avg != null ? Math.round(avg * 100) / 100 : null, count: stockList.length };
      }
      const sectorList = sectors.map(([name]) => sectorAggMap[name]);
      const data = { stocks, sectors: sectorList };
      _mapCache[region] = data;
      _drawMap(region, body, data);
      return;
    } catch(e) {
      if (_attempt < 2) await new Promise(r => setTimeout(r, 3000 * (_attempt + 1)));
      else body.innerHTML = '<div class="map-loading" style="color:var(--neutral-500);font-size:0.8rem">히트맵 로딩 실패 — 페이지를 새로고침 해주세요</div>';
    }
  }
}

function _hmDescText(mode) {
  return mode === "sector"
    ? "섹터 평균 등락률 | 블록 크기 = 섹터 내 종목 수 | 색상: 초록(상승) / 빨강(하락)"
    : "개별 종목 당일 등락률 | 섹터별로 그룹화 | 블록 크기 균등 | 색상: 초록(상승) / 빨강(하락)";
}

function _drawMap(region, body, data) {
  const mode = _mapMode[region] || "sector";
  body.innerHTML = "";
  // 섹터/종목 탭 바
  const tabBar = document.createElement("div");
  tabBar.className = "hm-tabs";
  tabBar.innerHTML = `
    <button class="hm-tab ${mode==="sector"?"active":""}" onclick="_switchMapMode('${region}','sector',this)">섹터</button>
    <button class="hm-tab ${mode==="stock"?"active":""}" onclick="_switchMapMode('${region}','stock',this)">종목</button>`;
  body.appendChild(tabBar);
  // 설명 텍스트
  const hmDesc = document.createElement("div");
  hmDesc.className = "hm-desc";
  hmDesc.id = region + "HmDesc";
  hmDesc.textContent = _hmDescText(mode);
  body.appendChild(hmDesc);
  // 캔버스
  const canvas = document.createElement("div");
  canvas.className = "hm-canvas";
  body.appendChild(canvas);
  if (typeof renderTreemap === "function") renderTreemap(canvas, data, mode);
}

function _switchMapMode(region, mode, btn) {
  _mapMode[region] = mode;
  const bodyId = region === "KR" ? "krMapBody" : "usMapBody";
  const body = document.getElementById(bodyId);
  if (!body) return;
  body.querySelectorAll(".hm-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  if (_mapCache[region]) {
    const canvas = body.querySelector(".hm-canvas");
    if (canvas) { canvas.innerHTML = ""; renderTreemap(canvas, _mapCache[region], mode); }
    const descEl = body.querySelector(".hm-desc");
    if (descEl) descEl.textContent = _hmDescText(mode);
  }
}

// ── 52주 신고가 ───────────────────────────────────────
function _update52hMoreButton() {
  const wrap = document.getElementById("high52MoreWrap");
  const btn  = document.getElementById("high52MoreBtn");
  if (!wrap || !btn) return;
  if (_h52State.hasMore) {
    wrap.style.display = "flex";
    btn.disabled = false;
    btn.textContent = "자세히 보기";
  } else {
    wrap.style.display = "none";
  }
}

// 일봉 → 주봉 리샘플 (W-FRI: 주 마지막 금요일 기준)
function _toWeekly(bars) {
  const weekBars = {};
  for (const b of bars) {
    const d = new Date(b.ts * 1000);
    // 이번 주 금요일 날짜 구하기 (dayOfWeek: 0=일~6=토)
    const day = d.getDay(); // 0=일 1=월 ... 5=금 6=토
    const daysToFri = (5 - day + 7) % 7;
    const fri = new Date(d.getTime() + daysToFri * 86400000);
    const key = fri.toISOString().slice(0, 10);
    if (!weekBars[key]) weekBars[key] = { time: key, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    else {
      weekBars[key].high   = Math.max(weekBars[key].high,   b.high);
      weekBars[key].low    = Math.min(weekBars[key].low,    b.low);
      weekBars[key].close  = b.close;
      weekBars[key].volume += b.volume;
    }
  }
  return Object.keys(weekBars).sort().map(k => weekBars[k]);
}

async function _check52h(ticker, name) {
  try {
    const { bars } = await fetchOHLCV(ticker, "2y", "1d");
    if (!bars || bars.length < 30) return null;

    // ── 거래중지 종목 제외 ──
    // 최근 5봉 거래량이 모두 0이면 거래중지로 판단
    const recentVol = bars.slice(-5).reduce((s, b) => s + (b.volume || 0), 0);
    if (recentVol === 0) return null;
    // 최근 3봉 종가가 모두 동일하고 거래량이 0이면 상장폐지/거래정지
    const last3 = bars.slice(-3);
    if (last3.every(b => b.close === last3[0].close) && last3.every(b => (b.volume || 0) === 0)) return null;
    // 당일 거래량 0 또는 이상값 제외
    if ((bars[bars.length - 1].volume || 0) === 0) return null;
    // 주봉 리샘플
    const weekly = _toWeekly(bars);
    if (weekly.length < 10) return null;
    const wCloses = weekly.map(b => b.close);
    // 52주 고점 rolling max (52봉, min_periods=10)
    const high52Arr = [];
    for (let i = 0; i < wCloses.length; i++) {
      const start = Math.max(0, i - 51);
      const window = wCloses.slice(start, i + 1);
      if (window.length < 10) { high52Arr.push(NaN); continue; }
      high52Arr.push(Math.max(...window));
    }
    const lastIdx = wCloses.length - 1;
    const close_w = wCloses[lastIdx];
    const high52  = high52Arr[lastIdx];
    if (!high52 || isNaN(high52)) return null;
    // at_high: 현재 주봉 종가가 52주 고점의 98.5% 이상
    if (close_w < high52 * 0.985) return null;
    // streak: 끝에서부터 at_high 연속 횟수
    let streak = 0;
    for (let i = lastIdx; i >= 0; i--) {
      const h = high52Arr[i];
      if (!h || isNaN(h)) break;
      if (wCloses[i] >= h * 0.985) streak++;
      else break;
    }
    // gap_pct: 현재가 vs 52주 고점
    const gap_pct = (close_w - high52) / high52 * 100;
    // day_pct: 마지막 2개 일봉 기준
    const dClose = bars[bars.length - 1].close;
    const dPrev  = bars.length >= 2 ? bars[bars.length - 2].close : dClose;
    const day_pct = dPrev > 0 ? (dClose - dPrev) / dPrev * 100 : 0;
    return { ticker, name, close: dClose, high52, gap_pct, streak, day_pct };
  } catch { return null; }
}

// ── 52주 신고가 일별 캐시 (하루 첫 진입만 스캔, 중단 시 재개) ──────────
function _h52GetCache(market) {
  try {
    const raw = localStorage.getItem("cfie_h52_" + market);
    if (!raw) return null;
    const c = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    return c.date === today ? c : null;  // 날짜 다르면 무효
  } catch { return null; }
}
function _h52SetCache(market, items, uniOffset, complete) {
  try {
    localStorage.setItem("cfie_h52_" + market, JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      items, uniOffset, complete
    }));
  } catch {}
}

async function load52h(market, btn) {
  document.querySelectorAll(".h52-tab").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  _h52Market = market;
  _h52StopFlag = true;
  await new Promise(r => setTimeout(r, 50));
  _h52StopFlag = false;
  const grid = document.getElementById("high52Grid");
  _h52State.items = [];
  _h52State.offset = 0;
  _h52State.hasMore = false;
  _update52hMoreButton();

  try {
    if (!_h52Universe[market]) {
      const res = await fetch(`data/universe_${market}.json`);
      if (!res.ok) throw new Error("유니버스 없음");
      _h52Universe[market] = await res.json();
    }
    const universe = _h52Universe[market];

    // ① 오늘 완료된 캐시 → 즉시 표시 (네트워크 0건)
    const cached = _h52GetCache(market);
    if (cached?.complete) {
      _h52State.items      = cached.items;
      _h52State.offset     = cached.items.length;
      _h52State._uniOffset = cached.uniOffset;
      _h52State.hasMore    = false;
      grid.innerHTML = cached.items.length
        ? cached.items.map(s => _render52hCard(s)).join("")
        : '<div class="high52-empty">해당 시장에서 52주 신고가 종목을 찾지 못했습니다.</div>';
      _update52hMoreButton();
      return;
    }

    // ② 중단된 캐시 → 기존 결과 표시 후 중단점부터 재개
    const resumeItems = cached?.items    || [];
    const startOffset = cached?.uniOffset ?? 0;
    const results     = [...resumeItems];
    const hasResume   = resumeItems.length > 0;
    grid.innerHTML = hasResume
      ? resumeItems.map(s => _render52hCard(s)).join("")
      : '<div class="high52-loading">실시간 조회 중… (Yahoo Finance)</div>';
    let loadingCleared = hasResume;

    const BATCH = 3;
    let scanIdx = startOffset;

    for (let i = startOffset; i < universe.length && results.length < 10 && !_h52StopFlag; i += BATCH) {
      const batch = universe.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(({ ticker, name }) => _check52h(ticker, name))
      );
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) {
          if (!loadingCleared) { grid.innerHTML = ""; loadingCleared = true; }
          results.push(r.value);
          const tmp = document.createElement("div");
          tmp.innerHTML = _render52hCard(r.value);
          grid.appendChild(tmp.firstElementChild);
        }
      }
      scanIdx = i + BATCH;
      _h52SetCache(market, results, scanIdx, false);  // 배치마다 진행상황 저장
      await new Promise(r => setTimeout(r, 200));
    }

    const complete = results.length >= 10 || scanIdx >= universe.length;
    _h52SetCache(market, results, scanIdx, complete);

    _h52State.items      = results;
    _h52State.offset     = results.length;
    _h52State._uniOffset = scanIdx;
    _h52State.hasMore    = !complete && scanIdx < universe.length;

    if (!results.length) {
      grid.innerHTML = '<div class="high52-empty">해당 시장에서 52주 신고가 종목을 찾지 못했습니다.</div>';
    }
    _update52hMoreButton();
  } catch(e) {
    grid.innerHTML = '<div class="high52-empty">조회 오류: ' + e.message + '</div>';
  }
}

async function loadMore52h() {
  if (_h52State.loading) return;
  _h52State.loading = true;
  const btn = document.getElementById("high52MoreBtn");
  if (btn) { btn.disabled = true; btn.textContent = "로딩 중…"; }
  const grid = document.getElementById("high52Grid");
  const market = _h52Market;
  try {
    if (!_h52Universe[market]) {
      const res = await fetch(`data/universe_${market}.json`);
      if (!res.ok) throw new Error("유니버스 없음");
      _h52Universe[market] = await res.json();
    }
    const universe = _h52Universe[market];
    const BATCH = 3;
    const newResults = [];
    let startIdx = _h52State._uniOffset ?? universe.length;

    for (let i = startIdx; i < universe.length && newResults.length < 10 && !_h52StopFlag; i += BATCH) {
      const batch = universe.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(({ ticker, name }) => _check52h(ticker, name))
      );
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) {
          newResults.push(r.value);
          const tmp = document.createElement("div");
          tmp.innerHTML = _render52hCard(r.value);
          grid.appendChild(tmp.firstElementChild);
        }
      }
      startIdx = i + BATCH;
      _h52SetCache(market, [..._h52State.items, ...newResults], startIdx, false);
    }

    _h52State.items.push(...newResults);
    _h52State._uniOffset = startIdx;
    const complete = startIdx >= universe.length;
    _h52SetCache(market, _h52State.items, startIdx, complete);
    _h52State.hasMore = !complete && newResults.length >= 10;

    if (!newResults.length) {
      const note = document.createElement("div");
      note.className = "high52-empty";
      note.style.marginTop = "8px";
      note.textContent = "더 이상 신고가 종목이 없습니다.";
      grid.appendChild(note);
    }
  } catch(e) {}
  _h52State.loading = false;
  _update52hMoreButton();
}

function _render52hCard(s) {
  const dayCls  = (s.day_pct || 0) >= 0 ? "bull" : "bear";
  const daySign = (s.day_pct || 0) >= 0 ? "+" : "";
  const gap_pct = s.gap_pct ?? 0;
  const gapCls  = gap_pct >= 0 ? "bull" : "bear";
  const gapSign = gap_pct >= 0 ? "+" : "";
  const streak  = s.streak || 0;
  const strColor = streak >= 8 ? "#F59E0B" : streak >= 4 ? "#818CF8" : "#22D3EE";
  return `
    <div class="h52-card" onclick="goAnalyze('${s.ticker}')" role="button" tabindex="0">
      <div class="h52-top">
        <div>
          <div class="h52-name">${s.name}</div>
          <div class="h52-ticker">${s.ticker}</div>
        </div>
        <div class="h52-streak" style="background:${strColor}22;color:${strColor};border-color:${strColor}55">${streak}주 연속</div>
      </div>
      <div class="h52-price">${fmt(s.close)}</div>
      <div class="h52-meta">
        <div class="h52-meta-item"><span class="h52-meta-label">52주 고점</span><span class="h52-meta-val">${fmt(s.high52)}</span></div>
        <div class="h52-meta-item"><span class="h52-meta-label">고점 대비</span><span class="h52-meta-val ${gapCls}">${gapSign}${gap_pct.toFixed(1)}%</span></div>
        <div class="h52-meta-item"><span class="h52-meta-label">당일 등락</span><span class="h52-meta-val ${dayCls}">${daySign}${(s.day_pct||0).toFixed(2)}%</span></div>
      </div>
    </div>`;
}

function render52hGrid(grid, stocks) {
  grid.innerHTML = stocks.map(_render52hCard).join("");
}
