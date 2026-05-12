/* js/scan.js  —  CFIE v4.0
 * 브라우저에서 직접 Yahoo Finance → indicators.js 계산 → 실시간 표시
 * 유니버스(종목 리스트)만 정적 번들, 모든 계산은 클라이언트 실시간
 */

// ── 상태 ────────────────────────────────────────────────
let _scanType    = "fis";
let _market      = "kospi";
let _scanning    = false;
let _stopScan    = false;
let _universe    = [];
let _results     = [];

// FIS 필터 기준 (원본 Python scan_market 동일)
const FIS_FILTER = { fis: 30, entry: 55, risk: -16, trend: 0 };
// 쿠모 필터 (원본 Python scan_kumo_breakout 동일 — below_weeks: 주봉기준 구름아래 기간)
const KUMO_MIN_BELOW_WEEKS = 4;
const MAX_RESULTS = 30;       // 후보 충분하면 조기종료
const BATCH_SIZE  = 4;        // 동시 요청 수 (CORS 프록시 과부하 방지)

// ── UI 탭 ────────────────────────────────────────────────
function selectScanType(type) {
  _scanType = type;
  document.querySelectorAll(".stab").forEach(t =>
    t.classList.toggle("active", t.dataset.type === type));
  const kd = document.getElementById("kumoDesc");
  if (kd) kd.style.display = type === "kumo" ? "block" : "none";
  document.getElementById("resultsSection").style.display = "none";
}

function selectMarket(market) {
  _market = market;
  document.querySelectorAll(".mtab").forEach(t =>
    t.classList.toggle("active", t.dataset.market === market));
  document.getElementById("resultsSection").style.display = "none";
}

// ── 스캔 시작 ────────────────────────────────────────────
async function doScan() {
  if (_scanning) return;
  _scanning = true;
  _stopScan = false;
  _results  = [];

  const scanBtn = document.getElementById("scanBtn");
  const stopBtn = document.getElementById("stopScanBtn");
  const progressEl = document.getElementById("scanProgress");
  const progressBar = document.getElementById("scanProgressBar");
  const progressText = document.getElementById("scanProgressText");

  scanBtn.style.display = "none";
  if (stopBtn) stopBtn.style.display = "inline-flex";
  document.getElementById("resultsSection").style.display = "none";
  document.getElementById("loadingOverlay").style.display = "flex";

  const label = { kospi: "코스피", kosdaq: "코스닥", us: "미국" }[_market];
  const typeLabel = _scanType === "kumo" ? "쿠모 브레이크아웃" : "FIS 진입";
  const lm = document.getElementById("loadingMsg");
  if (lm) lm.textContent = `${label} ${typeLabel} 실시간 분석 중…`;

  try {
    // 유니버스 로드 (종목 리스트)
    if (!_universe[_market]) {
      const res = await fetch(`data/universe_${_market}.json`);
      if (!res.ok) throw new Error("유니버스 데이터 없음");
      _universe[_market] = await res.json();
    }
    const universe = _universe[_market];
    const total = universe.length;

    // 결과 컨테이너 준비
    const grid = document.getElementById("resultsGrid");
    if (grid) grid.innerHTML = "";
    const rs = document.getElementById("resultsSection");
    rs.style.display = "block";
    const countEl = document.getElementById("resultCount");

    // 진행률 표시
    if (progressEl) progressEl.style.display = "flex";

    let scanned = 0;
    // 배치 스캔
    for (let i = 0; i < total && !_stopScan; i += BATCH_SIZE) {
      if (_results.length >= MAX_RESULTS) break;
      const batch = universe.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(({ ticker, name }) => _analyzeOne(ticker, name))
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled" && r.value) {
          const candidate = r.value;
          _results.push(candidate);
          // 실시간으로 카드 추가
          if (grid) {
            const card = _scanType === "kumo"
              ? renderKumoCard(candidate)
              : renderFisCard(candidate);
            grid.insertAdjacentHTML("beforeend", card);
          }
          if (countEl) countEl.textContent = `${_results.length}개 발견`;
        }
      }

      scanned += batch.length;
      const pct = Math.round((scanned / total) * 100);
      if (progressBar) progressBar.style.width = pct + "%";
      if (progressText) progressText.textContent =
        `${scanned.toLocaleString()} / ${total.toLocaleString()} 종목 분석 완료`;
    }

  } catch(e) {
    showToast("스캔 오류: " + e.message, "error");
  } finally {
    document.getElementById("loadingOverlay").style.display = "none";
    if (stopBtn) stopBtn.style.display = "none";
    scanBtn.style.display = "inline-flex";
    _scanning = false;

    const rs = document.getElementById("resultsSection");
    rs.style.display = "block";
    const countEl = document.getElementById("resultCount");
    if (countEl && _results.length === 0) countEl.textContent = "조건을 만족하는 종목이 없습니다";

    const progressEl2 = document.getElementById("scanProgress");
    if (progressEl2) progressEl2.style.display = "none";
  }
}

function stopScan() {
  _stopScan = true;
  showToast("스캔을 중지했습니다", "info");
}

// ── 단일 종목 분석 ────────────────────────────────────────
async function _analyzeOne(ticker, name) {
  try {
    const period = _market === "us" ? "2y" : "1y";
    const { bars } = await fetchOHLCV(ticker, period, "1d");
    if (!bars || bars.length < 60) return null;

    if (_scanType === "fis") {
      return _analyzeFis(ticker, name, bars);
    } else {
      return _analyzeKumo(ticker, name, bars);
    }
  } catch(e) {
    return null;
  }
}

// FIS 분석 (원본 scan_market 필터 동일)
function _analyzeFis(ticker, name, bars) {
  const df = calcIndicators(bars);
  if (!df || df.length < 30) return null;
  const fisBars = calcFIS(df);
  if (!fisBars || fisBars.length === 0) return null;
  const judgment = makeJudgment(fisBars);
  if (!judgment) return null;

  const { fis, trend, risk } = judgment;
  const entryData = calcEntryScore(fisBars);
  const entry = entryData ? entryData.score : 0;

  // 원본 필터
  if (fis < FIS_FILTER.fis)    return null;
  if (entry < FIS_FILTER.entry) return null;
  if (risk <= FIS_FILTER.risk)  return null;
  if (trend <= FIS_FILTER.trend) return null;

  const last = fisBars[fisBars.length - 1];
  return {
    ticker,
    name,
    fis:          Math.round(fis * 100) / 100,
    label:        judgment.label,
    label_color:  judgment.label_color,
    close:        last.close,
    trend:        Math.round(judgment.trend * 100) / 100,
    momentum:     Math.round(judgment.momentum * 100) / 100,
    structure:    Math.round(judgment.structure * 100) / 100,
    compression:  Math.round(judgment.compression * 100) / 100,
    volume:       Math.round(judgment.volume * 100) / 100,
    risk:         Math.round(risk * 100) / 100,
    entry_score:  Math.round(entry),
    entry_setup_name:  entryData ? (entryData.setup_name || "") : "",
    entry_setup_name2: entryData ? (entryData.setup_name2 || "") : "",
    summary_l1:   judgment.summary_l1 || "",
  };
}

// 쿠모 브레이크아웃 분석
function _analyzeKumo(ticker, name, bars) {
  if (bars.length < 52) return null;

  // 주봉 변환 (일봉→주봉)
  const weekly = _toWeekly(bars);
  if (!weekly || weekly.length < 30) return null;

  // 일목균형표 계산 (주봉)
  const ich = _calcIchimoku(weekly);
  if (!ich) return null;

  const last = ich[ich.length - 1];
  const close = last.close;
  const spanA = last.spanA;
  const spanB = last.spanB;
  const cloudTop    = Math.max(spanA, spanB);
  const cloudBottom = Math.min(spanA, spanB);

  // 현재 구름 위 돌파 확인
  if (close <= cloudTop) return null;

  // 구름 아래 있던 기간 (주봉 개수)
  let belowWeeks = 0;
  for (let i = ich.length - 2; i >= 0; i--) {
    const bar = ich[i];
    const ct = Math.max(bar.spanA, bar.spanB);
    if (bar.close < ct) belowWeeks++;
    else break;
  }
  if (belowWeeks < KUMO_MIN_BELOW_WEEKS) return null;

  // 구름 두께 (얇은 구름 = 브레이크아웃 용이)
  const cloudThin = Math.abs(spanA - spanB) / close < 0.03;
  // 황소 구름 (spanA > spanB)
  const bullCloud = spanA > spanB;

  // 일봉 거래량 확인 (20일 평균 대비)
  const vols = bars.map(b => b.volume).filter(v => v > 0);
  const avgVol = vols.slice(-21, -1).reduce((a,b)=>a+b,0) / 20;
  const dailyVol = vols[vols.length-1] > avgVol * 1.3;

  return {
    ticker,
    name,
    close,
    below_weeks: belowWeeks,
    cloud_thin:  cloudThin,
    bull_cloud:  bullCloud,
    daily_vol:   dailyVol,
  };
}

// ── 일목균형표 계산 ─────────────────────────────────────────
function _calcIchimoku(weekly) {
  const n = weekly.length;
  if (n < 52) return null;
  const result = [];
  for (let i = 0; i < n; i++) {
    const hi9  = _maxHigh(weekly, i, 9);
    const lo9  = _minLow(weekly, i, 9);
    const hi26 = _maxHigh(weekly, i, 26);
    const lo26 = _minLow(weekly, i, 26);
    const hi52 = _maxHigh(weekly, i, 52);
    const lo52 = _minLow(weekly, i, 52);
    const spanA = (((hi9 + lo9) / 2) + ((hi26 + lo26) / 2)) / 2;
    const spanB = (hi52 + lo52) / 2;
    result.push({
      time:  weekly[i].time,
      close: weekly[i].close,
      spanA,
      spanB,
    });
  }
  return result;
}

function _maxHigh(bars, i, period) {
  const start = Math.max(0, i - period + 1);
  let max = -Infinity;
  for (let j = start; j <= i; j++) max = Math.max(max, bars[j].high);
  return max;
}

function _minLow(bars, i, period) {
  const start = Math.max(0, i - period + 1);
  let min = Infinity;
  for (let j = start; j <= i; j++) min = Math.min(min, bars[j].low);
  return min;
}

// ── 일봉 → 주봉 변환 ────────────────────────────────────────
function _toWeekly(bars) {
  if (!bars || bars.length === 0) return [];
  const weeks = {};
  for (const b of bars) {
    const d = new Date(b.ts * 1000);
    const day = d.getDay();
    const diff = (day === 0) ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    const key = monday.toISOString().slice(0, 10);
    if (!weeks[key]) {
      weeks[key] = { time: Math.floor(monday.getTime()/1000), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      weeks[key].high   = Math.max(weeks[key].high, b.high);
      weeks[key].low    = Math.min(weeks[key].low,  b.low);
      weeks[key].close  = b.close;
      weeks[key].volume += b.volume;
    }
  }
  return Object.values(weeks).sort((a,b) => a.time - b.time);
}

// ── 카드 렌더링 (FIS) ────────────────────────────────────────
function renderFisCard(c) {
  const fc = fisColor(c.fis);
  const fl = fisLabelText(c.fis);
  const pf = _market === "us" ? "" : "₩";
  const closeStr = c.close ? (pf + c.close.toLocaleString()) : "—";
  const scores = [
    { lbl:"추세", val: c.trend },
    { lbl:"모멘텀", val: c.momentum },
    { lbl:"구조", val: c.structure },
    { lbl:"압축", val: c.compression },
    { lbl:"거래량", val: c.volume },
    { lbl:"위험감점", val: c.risk },
  ];
  const chips = scores.map(s =>
    `<span class="chip ${s.val >= 0 ? "chip-up" : "chip-dn"}">${s.lbl} ${s.val >= 0 ? "+" : ""}${s.val.toFixed(1)}</span>`
  ).join("");
  const sn1 = c.entry_setup_name  ? `<span class="setup-tag">${c.entry_setup_name}</span>` : "";
  const sn2 = c.entry_setup_name2 ? `<span class="setup-tag2">${c.entry_setup_name2}</span>` : "";
  return `
<div class="cand-card">
  <div class="cc-top">
    <div class="cc-name">${c.name}</div>
    <div class="cc-ticker">${c.ticker}</div>
    <div class="cc-price">${closeStr}</div>
    <div class="cc-fis" style="background:${fc}">${fl} ${c.fis > 0 ? "+" : ""}${c.fis.toFixed(1)}</div>
    <div class="cc-entry">진입점수 <strong>${c.entry_score}</strong></div>
  </div>
  <div class="cc-label">${c.label}</div>
  <div class="cc-setup">${sn1}${sn2}</div>
  <div class="cc-summary">${c.summary_l1 || ""}</div>
  <div class="cc-chips">${chips}</div>
  <div class="cc-actions">
    <button class="action-btn" onclick="location.href='analyze.html?ticker=${encodeURIComponent(c.ticker)}'">차트 분석 →</button>
  </div>
</div>`;
}

// ── 카드 렌더링 (쿠모) ───────────────────────────────────────
function renderKumoCard(c) {
  const pf = _market === "us" ? "" : "₩";
  const closeStr = c.close ? (pf + c.close.toLocaleString()) : "—";
  const dir = c.bull_cloud ? "bull" : "bear";
  const dirTxt = c.bull_cloud ? "양전환" : "음전환";
  return `
<div class="cand-card kumo-card">
  <div class="cc-top">
    <div class="cc-name">${c.name}</div>
    <div class="cc-ticker">${c.ticker}</div>
    <div class="cc-price">${closeStr}</div>
    <div class="kumo-badge ${dir}">☁ ${dirTxt}</div>
  </div>
  <div class="cc-label ${dir}">구름 아래 ${c.below_weeks}주 → 상향 돌파</div>
  <div class="cc-chips">
    ${c.cloud_thin ? '<span class="chip chip-up">얇은 구름</span>' : '<span class="chip chip-dn">두꺼운 구름</span>'}
    ${c.daily_vol  ? '<span class="chip chip-up">거래량 급증</span>' : ""}
  </div>
  <div class="cc-actions">
    <button class="action-btn" onclick="location.href='analyze.html?ticker=${encodeURIComponent(c.ticker)}'">차트 분석 →</button>
  </div>
</div>`;
}

// ── 결과 표시 (일괄 - 더보기 버튼용으로 유지) ─────────────────
function renderResults(items, label, append) {
  const grid = document.getElementById("resultsGrid");
  if (!grid) return;
  const html = items.map(c =>
    _scanType === "kumo" ? renderKumoCard(c) : renderFisCard(c)
  ).join("");
  if (append) grid.insertAdjacentHTML("beforeend", html);
  else        grid.innerHTML = html;

  const rs = document.getElementById("resultsSection");
  rs.style.display = "block";
  const hdr = document.getElementById("resultsHeader");
  if (hdr) hdr.textContent = `${label} ${_scanType === "kumo" ? "쿠모" : "FIS"} 분석 결과 (${items.length}개)`;
}
