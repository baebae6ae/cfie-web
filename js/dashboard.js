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

// ── 섹터 목록 (engine/market.py 그대로) ─────────────
const KR_SECTORS = [
  ["반도체", [["005930.KS","삼성전자"],["000660.KS","SK하이닉스"],["009150.KS","삼성전기"],["034220.KS","LG디스플레이"]]],
  ["자동차", [["005380.KS","현대차"],["000270.KS","기아"],["012330.KS","현대모비스"],["247540.KQ","에코프로비엠"]]],
  ["화학·배터리", [["051910.KS","LG화학"],["006400.KS","삼성SDI"],["096770.KS","SK이노베이션"],["066970.KQ","엘앤에프"]]],
  ["금융", [["055550.KS","신한지주"],["086790.KS","하나금융지주"],["024110.KS","기업은행"],["316140.KS","우리금융지주"],["032830.KS","삼성생명"],["000810.KS","삼성화재"]]],
  ["IT·플랫폼", [["035420.KS","NAVER"],["035720.KS","카카오"],["018260.KS","삼성SDS"],["017670.KS","SK텔레콤"]]],
  ["에너지", [["010950.KS","S-Oil"],["015760.KS","한국전력"]]],
  ["소재·산업재", [["005490.KS","POSCO홀딩스"],["028260.KS","삼성물산"],["003550.KS","LG"],["011200.KS","HMM"],["003490.KS","대한항공"]]],
  ["바이오·헬스", [["207940.KS","삼성바이오로직스"],["033780.KS","KT&G"],["145020.KQ","휴젤"],["196170.KQ","알테오젠"],["285130.KQ","SK바이오사이언스"]]],
  ["게임·엔터", [["263750.KQ","펄어비스"],["041510.KQ","에스엠"],["293480.KQ","카카오게임즈"],["035900.KQ","JYP Ent."],["112040.KQ","위메이드"],["251270.KQ","넷마블"]]],
  ["소부장", [["357780.KQ","솔브레인"],["394280.KQ","오픈엣지테크놀로지"],["140860.KQ","파크시스템스"],["095340.KQ","ISC"],["211270.KQ","AP시스템"],["039030.KQ","이오테크닉스"]]],
];
const US_SECTORS = [
  ["Tech", [["AAPL","Apple"],["MSFT","Microsoft"],["NVDA","NVIDIA"],["AVGO","Broadcom"],["ORCL","Oracle"],["AMD","AMD"],["INTC","Intel"],["CRM","Salesforce"]]],
  ["Communication", [["GOOGL","Alphabet"],["META","Meta"],["NFLX","Netflix"],["DIS","Disney"]]],
  ["Consumer", [["AMZN","Amazon"],["TSLA","Tesla"],["HD","Home Depot"],["COST","Costco"],["WMT","Walmart"],["KO","Coca-Cola"],["PEP","PepsiCo"]]],
  ["Finance", [["JPM","JPMorgan"],["V","Visa"],["MA","Mastercard"],["BAC","Bank of America"]]],
  ["Healthcare", [["UNH","UnitedHealth"],["LLY","Eli Lilly"],["JNJ","J&J"],["ABBV","AbbVie"],["MRK","Merck"]]],
  ["Energy", [["XOM","Exxon"]]],
];

// ── 이름 단축 (market.py::short_name 로직) ──────────
function _shortName(name) {
  if (!name) return "";
  let s = name.replace(/홀딩스|전자/g, "").replace(/\s?(Inc\.|Corp\.|Ltd\.)/i, "").trim();
  if (s.length > 8) s = s.slice(0, 8);
  return s || name.slice(0, 8);
}

// ── 상태 ───────────────────────────────────────────
const _mapCache = {};
const _mapMode  = { KR: "sector", US: "sector" };
let _h52Market  = "kospi";
const _h52State = { offset: 0, limit: 10, hasMore: false, loading: false, items: [] };
let _h52Universe = {};
let _h52StopFlag = false;

// ── 초기화 ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadMarket();
  setTimeout(() => load52h("kospi", document.querySelector(".h52-tab")), 600);
  setTimeout(() => loadMarketMap("KR"), 800);
  setTimeout(() => loadMarketMap("US"), 900);
});

// ── 시장 지수 ─────────────────────────────────────────
async function loadMarket() {
  try {
    const allTickers = [...KR_INDICES, ...US_INDICES].map(i => i.ticker);
    const quotes = await fetchMultiQuote(allTickers);
    renderQuotes("krQuotes", KR_INDICES, quotes, "krUpdated");
    renderQuotes("usQuotes", US_INDICES, quotes, "usUpdated");
    renderTickerStrip([...KR_INDICES, ...US_INDICES], quotes);
  } catch(e) { console.error("market load error", e); }
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
  body.innerHTML = '<div class="map-loading">히트맵 로딩 중…</div>';
  const sectors = region === "KR" ? KR_SECTORS : US_SECTORS;
  try {
    // 전체 티커 수집
    const allTickers = sectors.flatMap(([, stocks]) => stocks.map(([t]) => t));
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
  } catch(e) {
    body.innerHTML = '<div class="map-loading" style="color:var(--neutral-500);font-size:0.8rem">히트맵 데이터 로딩 실패</div>';
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

async function load52h(market, btn) {
  document.querySelectorAll(".h52-tab").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  _h52Market = market;
  _h52StopFlag = true;
  await new Promise(r => setTimeout(r, 50));
  _h52StopFlag = false;
  const grid = document.getElementById("high52Grid");
  grid.innerHTML = '<div class="high52-loading">실시간 조회 중… (Yahoo Finance)</div>';
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
    const BATCH = 3;
    const results = [];
    let _h52ScanIdx = 0;
    grid.innerHTML = "";
    for (let i = 0; i < universe.length && results.length < 10 && !_h52StopFlag; i += BATCH) {
      const batch = universe.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(({ ticker, name }) => _check52h(ticker, name))
      );
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) {
          results.push(r.value);
          const tmp = document.createElement("div");
          tmp.innerHTML = _render52hCard(r.value);
          grid.appendChild(tmp.firstElementChild);
        }
      }
      _h52ScanIdx = i + BATCH;
    }
    _h52State.items = results;
    _h52State.offset = results.length;
    _h52State._uniOffset = _h52ScanIdx;
    _h52State.hasMore = _h52ScanIdx < universe.length && results.length >= 10;
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
    let startIdx = _h52State._uniOffset || _h52State.items.length * 3;
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
    }
    _h52State.items.push(...newResults);
    _h52State._uniOffset = startIdx;
    _h52State.hasMore = startIdx < universe.length && newResults.length >= 10;
    if (!newResults.length && _h52State.items.length) {
      // 더 이상 종목 없음
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
