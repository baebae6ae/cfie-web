/* js/scan.js  —  CFIE v4.0 (Logic Synchronized with Python Engine)
 * 브라우저에서 직접 Yahoo Finance → indicators.js 계산 → 실시간 표시
 */

// ── 상태 ────────────────────────────────────────────────
let _scanType    = "fis";
let _market      = "kospi";
let _scanning    = false;
let _stopScan    = false;
let _universe    = {};
let _results     = [];

// FIS 필터 기준 (Python scan_market과 동일하게 수정)
const FIS_FILTER = { fis: 30, entry: 55, risk: -16, trend: 0 };
const MAX_RESULTS = 30;
const BATCH_SIZE  = 4;

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
    if (!_universe[_market]) {
      const res = await fetch(`data/universe_${_market}.json`);
      if (!res.ok) throw new Error("유니버스 데이터 없음");
      _universe[_market] = await res.json();
    }
    const universe = _universe[_market];
    const total = universe.length;

    const grid = document.getElementById("candidatesGrid");
    if (grid) grid.innerHTML = "";
    const rs = document.getElementById("resultsSection");
    rs.style.display = "block";
    const countEl = document.getElementById("resultCount");

    if (progressEl) progressEl.style.display = "flex";

    let scanned = 0;
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
          const idx = _results.length - 1;
          if (grid) {
            const card = _scanType === "kumo"
              ? renderKumoCard(candidate)
              : renderFisCard(candidate, idx);
            grid.insertAdjacentHTML("beforeend", card);
          }
          if (countEl) countEl.textContent = `${_results.length}개`;
        }
      }

      scanned += batch.length;
      const pct = Math.round((scanned / total) * 100);
      if (progressBar) progressBar.style.width = pct + "%";
      if (progressText) progressText.textContent =
        `${scanned.toLocaleString()} / ${total.toLocaleString()} 종목 분석 완료`;
    }

    // 정렬 (FIS: 진입점수순, KUMO: 구름아래 체류주수순)
    if (_results.length > 0 && !_stopScan) {
      if (_scanType === "fis") {
        _results.sort((a, b) => (b.entry_score || 0) - (a.entry_score || 0));
        if (grid) grid.innerHTML = _results.map((c, i) => renderFisCard(c, i)).join("");
      } else {
        _results.sort((a, b) => (b.below_weeks || 0) - (a.below_weeks || 0));
        if (grid) grid.innerHTML = _results.map(c => renderKumoCard(c)).join("");
      }
    }
    if (countEl) countEl.textContent = `${_results.length}개`;

    const resultLabel = document.getElementById("resultLabel");
    if (resultLabel) {
      resultLabel.textContent = _scanType === "kumo"
        ? `${label} 쿠모 브레이크아웃 패턴 종목 (구름 아래 체류기간 긴 순)`
        : `${label} 상승 우위 진입 후보 (진입 점수 높은 순)`;
    }

  } catch(e) {
    showToast("스캔 오류: " + e.message, "error");
  } finally {
    document.getElementById("loadingOverlay").style.display = "none";
    if (stopBtn) stopBtn.style.display = "none";
    scanBtn.style.display = "inline-flex";
    _scanning = false;
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
    // Python은 FIS는 1y, KUMO는 2y를 사용함
    const period = _scanType === "kumo" ? "2y" : "1y";
    const { bars } = await fetchOHLCV(ticker, period, "1d");
    if (!bars || bars.length < 60) return null;
    if (_scanType === "fis") return _analyzeFis(ticker, name, bars);
    else                      return _analyzeKumo(ticker, name, bars);
  } catch(e) { return null; }
}

// ── FIS 분석 (Python _analyze_one 로직 동일화) ───────────────
function _analyzeFis(ticker, name, bars) {
  const df = calcIndicators(bars);
  if (!df || df.length < 30) return null;
  const fisBars = calcFIS(df);
  if (!fisBars || fisBars.length === 0) return null;
  const judgment = makeJudgment(fisBars);
  if (!judgment) return null;

  const { fis, scores } = judgment;
  const trend     = scores?.["추세"]     ?? 0;
  const momentum  = scores?.["모멘텀"]   ?? 0;
  const risk      = scores?.["위험감점"] ?? 0;

  const entryData = calcEntryScore(fisBars);
  const entryScore = entryData ? entryData.score : 0;

  // Python 필터: FIS ≥ 30 AND entry_score ≥ 55 AND risk > -16 AND trend > 0
  if (fis < FIS_FILTER.fis) return null;
  if (entryScore < FIS_FILTER.entry) return null;
  if (risk <= FIS_FILTER.risk) return null; // Python: risk > -16
  if (trend <= FIS_FILTER.trend) return null;

  const last = fisBars[fisBars.length - 1];
  const ema20 = last.EMA20 || last.close;
  const ema20_gap = Math.round((last.close - ema20) / ema20 * 100 * 10) / 10;

  return {
    ticker,
    name,
    fis:          Math.round(fis * 100) / 100,
    label:        judgment.label,
    label_color:  judgment.label_color,
    close:        last.close,
    trend:        Math.round(trend * 100) / 100,
    momentum:     Math.round(momentum * 100) / 100,
    structure:    Math.round((scores?.["구조"] ?? 0) * 100) / 100,
    compression:  Math.round((scores?.["압축"] ?? 0) * 100) / 100,
    volume:       Math.round((scores?.["거래량"] ?? 0) * 100) / 100,
    risk:         Math.round(risk * 100) / 100,
    entry_score:  Math.round(entryScore),
    entry_setup_name: entryData?.setup_name || "",
    entry_setup_name2: entryData?.setup_name2 || "",
    entry_components: entryData?.components || {},
    entry_setup_scores: entryData?.setup_scores || {},
    entry_metrics: entryData?.metrics || {},
    ema20_gap:    ema20_gap,
    summary_l1:   judgment.summary_l1 || "",
    ichimoku:     judgment.ichimoku_status || "—",
    atr:          last.ATR14 || 0,
    high20:       fisBars.slice(-20).reduce((m, b) => Math.max(m, b.high), -Infinity),
  };
}

// ── 쿠모 브레이크아웃 분석 (Python _kumo_check_one 로직 완전 이식) ──
function _analyzeKumo(ticker, name, dailyBars) {
  if (dailyBars.length < 60) return null;

  // 1. 주봉 변환
  const weekly = _toWeekly(dailyBars);
  if (weekly.length < 52) return null;

  // 2. 일목균형표 계산 (Python _calc_ichimoku_raw 방식)
  const ich = _calcIchimoku(weekly);
  if (!ich || ich.length < 40) return null;

  const n = ich.length;
  const last = ich[n - 1];

  // 조건 1: 현재 구름 위 (above_c == 1)
  const isAbove = (c, a, b) => c > Math.max(a, b);
  if (!isAbove(last.close, last.spanA, last.spanB)) return null;

  // 조건 2: 최근 36주 내에 구름 돌파 시점 찾기 (brk_idx)
  let brk_idx = null;
  for (let i = Math.max(1, n - 36); i < n; i++) {
    const curr = ich[i];
    const prev = ich[i - 1];
    const currAbove = isAbove(curr.close, curr.spanA, curr.spanB);
    const prevAbove = isAbove(prev.close, prev.spanA, prev.spanB);
    if (currAbove && !prevAbove) {
      brk_idx = i;
      // 가장 최근 돌파점을 찾기 위해 계속 진행하거나, Python처럼 루프 돌림
    }
  }
  if (brk_idx === null) return null;

  // 조건 3: 돌파 전 50주 중 누적 구름 아래 10주 이상 (below_cnt)
  let below_cnt = 0;
  const startIdx = Math.max(0, brk_idx - 50);
  for (let i = startIdx; i < brk_idx; i++) {
    const b = ich[i];
    if (b.close < Math.min(b.spanA, b.spanB)) below_cnt++;
  }
  if (below_cnt < 10) return null;

  // 조건 4: 구름 반전(Kumo Twist) - 돌파 ±8주 내 존재 여부 또는 현재 양운
  let had_twist = false;
  const twistStart = Math.max(0, brk_idx - 8);
  const twistEnd = Math.min(n - 1, brk_idx + 8);
  for (let i = twistStart; i <= twistEnd; i++) {
    if (ich[i].spanA >= ich[i].spanB && (i === 0 || ich[i - 1].spanA < ich[i - 1].spanB)) {
      had_twist = true;
      break;
    }
  }
  if (!(had_twist || last.spanA >= last.spanB)) return null;

  // 조건 5: 돌파 전후 구름 두께 (thin_slice min)
  let min_thick = 99.0;
  const thinStart = Math.max(0, brk_idx - 6);
  const thinEnd = Math.min(n - 1, brk_idx + 2);
  for (let i = thinStart; i <= thinEnd; i++) {
    const thickness = (Math.abs(ich[i].spanA - ich[i].spanB) / ich[i].close) * 100;
    if (thickness < min_thick) min_thick = thickness;
  }

  // 조건 6: 일봉 거래량 폭발 + 장대양봉 (최근 25일 이내)
  let big_candle = false;
  const recentDays = dailyBars.slice(-25);
  // 일봉 20일 평균 거래량 계산을 위해 넉넉한 데이터 필요
  for (let i = 0; i < recentDays.length; i++) {
    const dayIdxInFull = dailyBars.length - recentDays.length + i;
    if (dayIdxInFull < 20) continue;
    
    const slice20 = dailyBars.slice(dayIdxInFull - 20, dayIdxInFull);
    const vol20 = slice20.reduce((a, b) => a + b.volume, 0) / 20;
    const curr = dailyBars[dayIdxInFull];
    
    if (vol20 > 0 && curr.volume >= vol20 * 1.8) {
      const body = curr.close - curr.open;
      const range = curr.high - curr.low;
      if (body > 0 && (range === 0 || body / range > 0.25)) {
        big_candle = true;
        break;
      }
    }
  }

  return {
    ticker, name, 
    close: last.close, 
    below_weeks: below_cnt, 
    cloud_thin: Math.round(min_thick * 10) / 10, 
    bull_cloud: last.spanA >= last.spanB, 
    daily_vol: big_candle,
    had_twist: had_twist
  };
}

// ── 일목균형표 계산 (Python 방식: No Shift) ───────────────────
function _calcIchimoku(weekly) {
  const n = weekly.length;
  if (n < 52) return null;
  
  return weekly.map((b, i) => {
    const hi9  = _maxHigh(weekly, i, 9);
    const lo9  = _minLow(weekly, i, 9);
    const hi26 = _maxHigh(weekly, i, 26);
    const lo26 = _minLow(weekly, i, 26);
    const hi52 = _maxHigh(weekly, i, 52);
    const lo52 = _minLow(weekly, i, 52);

    const tenkan = (hi9 + lo9) / 2;
    const kijun  = (hi26 + lo26) / 2;

    return {
      time: b.time, 
      close: b.close,
      spanA: (tenkan + kijun) / 2,
      spanB: (hi52 + lo52) / 2
    };
  });
}

function _maxHigh(bars, i, period) {
  if (i < period - 1) return bars[i].high;
  let m = -Infinity;
  for (let j = i - period + 1; j <= i; j++) m = Math.max(m, bars[j].high);
  return m;
}
function _minLow(bars, i, period) {
  if (i < period - 1) return bars[i].low;
  let m = Infinity;
  for (let j = i - period + 1; j <= i; j++) m = Math.min(m, bars[j].low);
  return m;
}

// ── 일봉 → 주봉 변환 ─────────────────────────────────────────
function _toWeekly(bars) {
  if (!bars || !bars.length) return [];
  const weeks = {};
  for (const b of bars) {
    const d = new Date(b.ts * 1000);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
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

// ── FIS 카드 렌더링 ──────────────────────────────────────────
function renderFisCard(c, idx) {
  const col   = fisColor(c.fis);
  const eScore = c.entry_score ?? 0;
  const eCol   = eScore >= 80 ? "#2ea043" : eScore >= 65 ? "#56d364" : eScore >= 50 ? "#d29922" : "#6e7681";
  const tCls   = c.trend >= 10 ? "pos" : "neg";
  const mCls   = c.momentum >= 5 ? "pos" : c.momentum < 0 ? "neg" : "";
  const pf     = _market === "us" ? "" : "₩";

  return `
  <div class="candidate-card">
    <div class="cc-top">
      <div>
        <div class="cc-name">${c.name}</div>
        <div class="cc-ticker">${c.ticker} · ${pf}${fmt(c.close)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <div class="cc-fis-badge" style="background:${col}">FIS ${c.fis>=0?"+":""}${c.fis.toFixed(0)}</div>
        <div class="cc-fis-badge" style="background:${eCol};font-size:11px">진입 점수 ${eScore.toFixed(0)}</div>
      </div>
    </div>
    <div class="cc-label" style="color:${col}">${c.label}</div>
    <div class="cc-summary">${c.summary_l1}</div>
    <div class="cc-scores">
      <span class="cs-chip ${tCls}" title="추세점수">추세 ${c.trend>=0?"+":""}${c.trend.toFixed(0)}</span>
      <span class="cs-chip ${mCls}" title="모멘텀">모멘텀 ${c.momentum>=0?"+":""}${c.momentum.toFixed(0)}</span>
      <span class="cs-chip" style="background:rgba(46,160,67,0.12);color:#56d364" title="진입 점수">진입 ${eScore.toFixed(0)}</span>
      <span class="cs-chip" title="일목균형표">${(c.ichimoku||"—").split("—")[0].trim()}</span>
    </div>
    <div class="cc-actions">
      <button class="cc-btn cc-btn-analyze" onclick="location.href='analyze.html?t=${encodeURIComponent(c.ticker)}'">차트 분석</button>
    </div>
    <button class="det-toggle" id="det-btn-${idx}" onclick="toggleDetail(${idx})">▶ 상세 설명</button>
    <div class="det-body" id="det-${idx}">
      ${entryDetailHTML(c)}
    </div>
  </div>`;
}

// ── 상세 설명 HTML ───────────────────────────────────────────
function entryDetailHTML(c) {
  const comp   = c.entry_components    || {};
  const setups = c.entry_setup_scores  || {};
  const met    = c.entry_metrics       || {};
  const sName  = c.entry_setup_name    || "—";
  const sName2 = c.entry_setup_name2   || "";

  const ctx      = comp["추세문맥"]   ?? 0;
  const setup    = comp["진입구조"]   ?? 0;
  const trigger  = comp["확인신호"]   ?? 0;
  const space    = comp["저항여유"]   ?? 0;
  const riskCtrl = comp["리스크관리"] ?? 0;

  function sc(v, max) {
    const r = max > 0 ? v / max : 0;
    return r >= 0.7 ? "#2ea043" : r >= 0.4 ? "#d29922" : "#6e7681";
  }

  const ctxDesc =
    ctx >= 24 ? "FIS 강세·추세·ADX 모두 우세. 매수 환경이 충분히 갖춰진 상태."
  : ctx >= 16 ? "추세 환경 양호. 방향성 우위 확인됨."
  : ctx >= 8  ? "추세 환경 중립 이상. 조건부 진입 가능."
  :             "추세 뒷받침 부족. 신중한 접근 필요.";

  const setupDescs = {
    "추세 눌림":  "상승 흐름 속 조정 후 재진입 시도. EMA 근접 눌림 + RSI 과열 해소가 핵심.",
    "압축 돌파":  "좁은 횡보에 에너지 압축 후 거래량 동반 상단 돌파 시도.",
    "모멘텀 지속": "정배열(EMA10>20>60) 상승 중인 추세에서 지속 진입. 강한 ROC·거래량 확인.",
    "반전 초기":  "과매도 후 바닥 반전 초기 신호. MACD 반전·RSI 저점 반등 확인."
  };

  const trigDesc =
    trigger >= 18 ? "EMA 배열·MACD·거래량 신호 모두 동반. 진입 타이밍 강."
  : trigger >= 12 ? "핵심 진입 신호 대부분 확인됨."
  : trigger >= 6  ? "일부 신호만 충족. 추가 봉 확인 권장."
  :                 "명확한 진입 신호 아직 부족.";

  const spaceDesc =
    space >= 12 ? "52주 위치·BB 모두 상승 여유 충분. 상단 저항 부담 낮음."
  : space >= 6  ? "적정한 상승 공간 확인됨."
  : space >= 0  ? "일부 저항 부담 있음. 상단 확인 필요."
  :                "상단 저항 과부담. 추격 매수 불리.";

  const riskDesc =
    riskCtrl >= 12 ? "과열 없고 손절가 거리 적정. 위험 관리 조건 양호."
  : riskCtrl >= 8  ? "리스크 통제 가능 수준."
  : riskCtrl >= 4  ? "일부 위험 요소 있음. 손절선 명확히 설정 권장."
  :                   "ATR 대비 이격 크거나 위험 감점 높음. 주의 필요.";

  const setupChips = Object.entries(setups).map(([k, v]) =>
    `<span class="det-setup-chip${k === sName ? " best" : ""}">${k} ${v.toFixed(0)}점${k === sName ? " ★" : ""}</span>`
  ).join("");

  const rows = [
    { label: "① 추세문맥",             v: ctx,      max: 30, desc: ctxDesc },
    { label: `② 진입구조 — ${sName}${sName2 ? ` + ${sName2}` : ""}`, v: setup, max: 30, desc: setupDescs[sName] || "—", extra: setupChips },
    { label: "③ 확인신호",             v: trigger,  max: 24, desc: trigDesc },
    { label: "④ 저항여유",             v: space,    max: 18, desc: spaceDesc },
    { label: "⑤ 리스크관리",           v: riskCtrl, max: 16, desc: riskDesc },
  ];

  const compsHTML = rows.map(r => `
    <div class="det-comp">
      <div class="det-comp-hd">
        <span class="det-comp-label">${r.label}</span>
        <span class="det-comp-score" style="color:${sc(r.v, r.max)}">${r.v.toFixed(0)} / ${r.max}</span>
      </div>
      <div class="det-comp-desc">${r.desc}</div>
      ${r.extra ? `<div class="det-setup-chips">${r.extra}</div>` : ""}
    </div>`).join("");

  const gapStr = c.ema20_gap != null ? (c.ema20_gap >= 0 ? "+" : "") + c.ema20_gap.toFixed(1) + "%" : "—";

  return compsHTML + `
    <div class="det-metrics">
      <span>EMA20 이격 ${gapStr}</span>
      <span>RSI ${met.rsi_reset != null ? met.rsi_reset.toFixed(1) : "—"}</span>
      <span>52주 ${met.range_pos != null ? met.range_pos.toFixed(0) + "%" : "—"}</span>
      <span>BB ${met.bb_pos != null ? met.bb_pos.toFixed(0) + "%" : "—"}</span>
      <span>ADX ${met.adx != null ? met.adx.toFixed(1) : "—"}</span>
    </div>`;
}

function toggleDetail(idx) {
  const body = document.getElementById(`det-${idx}`);
  const btn  = document.getElementById(`det-btn-${idx}`);
  if (!body) return;
  const open = body.classList.contains("open");
  body.classList.toggle("open", !open);
  btn.classList.toggle("open", !open);
  btn.textContent = open ? "▶ 상세 설명" : "▼ 상세 설명 닫기";
}

// ── 쿠모 카드 렌더링 ──────────────────────────────────────────
function renderKumoCard(c) {
  const pf = _market === "us" ? "" : "₩";
  const dir = c.bull_cloud ? "bull" : "bear";
  const dirTxt = c.bull_cloud ? "양전환" : "음전환";
  return `
  <div class="candidate-card">
    <div class="cc-top">
      <div>
        <div class="cc-name">${c.name}</div>
        <div class="cc-ticker">${c.ticker}</div>
      </div>
      <div class="cc-price">${pf}${fmt(c.close)}</div>
      <div class="kumo-badge ${dir}">☁ ${dirTxt}</div>
    </div>
    <div class="cc-label ${dir}">구름 아래 ${c.below_weeks}주 체류 후 돌파</div>
    <div class="cc-scores">
      <span class="cs-chip" title="구름 두께">두께 ${c.cloud_thin}%</span>
      ${c.daily_vol  ? '<span class="cs-chip pos">거래량/장대양봉</span>' : ""}
      ${c.had_twist  ? '<span class="cs-chip pos">Kumo Twist</span>' : ""}
    </div>
    <div class="cc-actions">
      <button class="cc-btn cc-btn-analyze" onclick="location.href='analyze.html?t=${encodeURIComponent(c.ticker)}'">차트 분석</button>
    </div>
  </div>`;
}