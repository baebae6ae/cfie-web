/* js/scan.js  —  CFIE v4.0
 * 브라우저에서 직접 Yahoo Finance → indicators.js 계산 → 실시간 표시
 * 유니버스(종목 리스트)만 정적 번들, 모든 계산은 클라이언트 실시간
 */

// ── 상태 ────────────────────────────────────────────────
let _scanType    = "fis";
let _market      = "kospi";
let _scanning    = false;
let _stopScan    = false;
let _universe    = {};
let _results     = [];

// FIS 필터 기준 (원본 Python scan_market 동일)
const FIS_FILTER = { fis: 30, entry: 55, risk: -16, trend: 0 };
// 쿠모 필터
const KUMO_MIN_BELOW_WEEKS = 4;
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

    // 진입점수 기준 정렬 후 재렌더
    if (_results.length > 0 && !_stopScan && _scanType === "fis") {
      _results.sort((a, b) => (b.entry_score || 0) - (a.entry_score || 0));
      if (grid) {
        grid.innerHTML = _results.map((c, i) => renderFisCard(c, i)).join("");
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
    const period = _market === "us" ? "2y" : "1y";
    const { bars } = await fetchOHLCV(ticker, period, "1d");
    if (!bars || bars.length < 60) return null;
    if (_scanType === "fis") return _analyzeFis(ticker, name, bars);
    else                      return _analyzeKumo(ticker, name, bars);
  } catch(e) { return null; }
}

// ── FIS 분석 (원본 scan_market 필터 동일) ─────────────────
function _analyzeFis(ticker, name, bars) {
  const df = calcIndicators(bars);
  if (!df || df.length < 30) return null;
  const fisBars = calcFIS(df);
  if (!fisBars || fisBars.length === 0) return null;
  const judgment = makeJudgment(fisBars);
  if (!judgment) return null;

  const { fis, scores } = judgment;
  const trend    = scores?.["추세"]    ?? 0;
  const momentum = scores?.["모멘텀"]  ?? 0;
  const structure= scores?.["구조"]    ?? 0;
  const compression = scores?.["압축"] ?? 0;
  const volume   = scores?.["거래량"]  ?? 0;
  const risk     = scores?.["위험감점"]?? 0;

  const entryData = calcEntryScore(fisBars);
  const entry = entryData ? entryData.score : 0;

  if (fis   < FIS_FILTER.fis)    return null;
  if (entry < FIS_FILTER.entry)  return null;
  if (risk  <= FIS_FILTER.risk)  return null;
  if (trend <= FIS_FILTER.trend) return null;

  const last = fisBars[fisBars.length - 1];

  // 진입 구성요소 (entryDetailHTML에서 사용)
  const entry_components   = entryData?.components    || {};
  const entry_setup_scores = entryData?.setup_scores  || {};
  const entry_metrics      = entryData?.metrics       || {};
  const entry_setup_name   = entryData?.setup_name    || "";
  const entry_setup_name2  = entryData?.setup_name2   || "";

  return {
    ticker,
    name,
    fis:          Math.round(fis * 100) / 100,
    label:        judgment.label,
    label_color:  judgment.label_color,
    close:        last.close,
    trend:        Math.round(trend * 100) / 100,
    momentum:     Math.round(momentum * 100) / 100,
    structure:    Math.round(structure * 100) / 100,
    compression:  Math.round(compression * 100) / 100,
    volume:       Math.round(volume * 100) / 100,
    risk:         Math.round(risk * 100) / 100,
    entry_score:  Math.round(entry),
    entry_setup_name,
    entry_setup_name2,
    entry_components,
    entry_setup_scores,
    entry_metrics,
    summary_l1:   judgment.summary_l1 || "",
    ichimoku:     judgment.ichimoku_status || "—",
    atr:          last.ATR14 || 0,
    high20:       fisBars.slice(-20).reduce((m,b)=>Math.max(m,b.high),-Infinity),
  };
}

// ── 쿠모 브레이크아웃 분석 ──────────────────────────────────
function _analyzeKumo(ticker, name, bars) {
  if (bars.length < 52) return null;
  const weekly = _toWeekly(bars);
  if (!weekly || weekly.length < 30) return null;
  const ich = _calcIchimoku(weekly);
  if (!ich) return null;
  const last = ich[ich.length - 1];
  const { close, spanA, spanB } = last;
  const cloudTop    = Math.max(spanA, spanB);
  if (close <= cloudTop) return null;
  let belowWeeks = 0;
  for (let i = ich.length - 2; i >= 0; i--) {
    const b = ich[i];
    if (b.close < Math.max(b.spanA, b.spanB)) belowWeeks++;
    else break;
  }
  if (belowWeeks < KUMO_MIN_BELOW_WEEKS) return null;
  const cloudThin = Math.abs(spanA - spanB) / close < 0.03;
  const bullCloud = spanA > spanB;
  const vols = bars.map(b => b.volume).filter(v => v > 0);
  const avgVol = vols.slice(-21, -1).reduce((a,b)=>a+b,0) / 20;
  const dailyVol = vols[vols.length-1] > avgVol * 1.3;
  return { ticker, name, close, below_weeks: belowWeeks, cloud_thin: cloudThin, bull_cloud: bullCloud, daily_vol: dailyVol };
}

// ── 일목균형표 계산 ──────────────────────────────────────────
function _calcIchimoku(weekly) {
  const n = weekly.length;
  if (n < 52) return null;
  return weekly.map((b, i) => ({
    time: b.time, close: b.close,
    spanA: ((_maxHigh(weekly,i,9)+_minLow(weekly,i,9))/2 + (_maxHigh(weekly,i,26)+_minLow(weekly,i,26))/2) / 2,
    spanB: (_maxHigh(weekly,i,52)+_minLow(weekly,i,52)) / 2,
  }));
}

function _maxHigh(bars, i, period) {
  const start = Math.max(0, i - period + 1);
  let m = -Infinity;
  for (let j = start; j <= i; j++) m = Math.max(m, bars[j].high);
  return m;
}
function _minLow(bars, i, period) {
  const start = Math.max(0, i - period + 1);
  let m = Infinity;
  for (let j = start; j <= i; j++) m = Math.min(m, bars[j].low);
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
    if (!weeks[key]) weeks[key] = { time: Math.floor(monday.getTime()/1000), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    else {
      weeks[key].high   = Math.max(weeks[key].high, b.high);
      weeks[key].low    = Math.min(weeks[key].low,  b.low);
      weeks[key].close  = b.close;
      weeks[key].volume += b.volume;
    }
  }
  return Object.values(weeks).sort((a,b) => a.time - b.time);
}

// ── FIS 카드 (원본 renderResults + entryDetailHTML 동일 구조) ─
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

// ── 상세 설명 HTML (원본 entryDetailHTML 동일) ────────────────
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
  :               "상단 저항 과부담. 추격 매수 불리.";

  const riskDesc =
    riskCtrl >= 12 ? "과열 없고 손절가 거리 적정. 위험 관리 조건 양호."
  : riskCtrl >= 8  ? "리스크 통제 가능 수준."
  : riskCtrl >= 4  ? "일부 위험 요소 있음. 손절선 명확히 설정 권장."
  :                  "ATR 대비 이격 크거나 위험 감점 높음. 주의 필요.";

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

  const gapPct = met.ema20_gap_pct != null
    ? (met.ema20_gap_pct >= 0 ? "+" : "") + met.ema20_gap_pct.toFixed(1) + "%" : "—";

  return compsHTML + `
    <div class="det-metrics">
      <span>EMA20 이격 ${gapPct}</span>
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

// ── 쿠모 카드 ──────────────────────────────────────────────
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
    <div class="cc-label ${dir}">구름 아래 ${c.below_weeks}주 → 상향 돌파</div>
    <div class="cc-scores">
      ${c.cloud_thin ? '<span class="cs-chip pos">얇은 구름</span>' : '<span class="cs-chip neg">두꺼운 구름</span>'}
      ${c.daily_vol  ? '<span class="cs-chip pos">거래량 급증</span>' : ""}
    </div>
    <div class="cc-actions">
      <button class="cc-btn cc-btn-analyze" onclick="location.href='analyze.html?t=${encodeURIComponent(c.ticker)}'">차트 분석</button>
    </div>
  </div>`;
}
