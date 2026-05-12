/* js/analyze.js  —  CFIE v4.0  (차트 크기 및 로딩 순서 개선 버전) */

let _chart     = null;
let _volChart  = null;
let _macdChart = null;
let _currentTicker = null;

// ── 초기화 ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const url = new URLSearchParams(location.search);
  const t   = url.get("t");
  if (t) loadChart(t);
  else {
    document.getElementById("loadingOverlay").style.display = "none";
    document.getElementById("analyzeMain").style.display    = "block";
    const el = document.getElementById("stockName");
    if (el) el.textContent = "종목을 검색하여 분석을 시작하세요";
  }
});

// ── 차트 로드 ────────────────────────────────────────────
async function loadChart(ticker) {
  _currentTicker = ticker.toUpperCase();
  const overlay = document.getElementById("loadingOverlay");
  const main    = document.getElementById("analyzeMain");
  
  overlay.style.display = "flex";
  main.style.display    = "none";

  try {
    const tf     = document.getElementById("timeframeSelect")?.value || "1d";
    const period = document.getElementById("periodSelect")?.value    || "2y";
    const { bars, meta } = await fetchOHLCV(_currentTicker, period, tf);
    
    if (!bars.length) { 
      showToast("데이터 없음", "error"); 
      overlay.style.display="none"; 
      main.style.display="block"; 
      return; 
    }

    const enriched = calcIndicators(bars);
    const fisBars  = calcFIS(enriched);
    const entry    = calcEntryScore(fisBars);
    const judgment = makeJudgment(fisBars);

    // [중요 수정] 차트를 그리기 전에 화면에 먼저 표시해야 정확한 너비 계산이 가능함
    overlay.style.display = "none";
    main.style.display    = "block";

    renderStockHeader(_currentTicker, meta, bars, judgment);
    renderChart(bars, fisBars, tf, meta); // 이제 main이 보이고 있으므로 너비가 정확함
    renderJudgment(judgment);
    renderEntryScore(entry);
    renderChips(judgment, fisBars);
    renderTable(fisBars);

  } catch(e) {
    console.error(e);
    showToast("차트 로드 실패: " + e.message, "error");
    overlay.style.display = "none";
    main.style.display    = "block";
  }
}

function reloadChart() { if (_currentTicker) loadChart(_currentTicker); }

// ── 종목 헤더 ────────────────────────────────────────────
function renderStockHeader(ticker, meta, bars, judgment) {
  const last   = bars[bars.length - 1];
  const prev   = bars.length > 1 ? bars[bars.length - 2].close : last.open;
  const chgPct = prev > 0 ? (last.close - prev) / prev * 100 : 0;
  const chgAbs = last.close - prev;
  const sign   = chgPct >= 0 ? "+" : "";
  const isKRW  = (meta?.currency || "") !== "USD";
  const dec    = isKRW ? 0 : 2;
  const _set   = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  _set("stockName",     meta?.shortName || meta?.longName || ticker);
  _set("stockTicker",   ticker);
  _set("stockExchange", meta?.exchangeName || meta?.fullExchangeName || "");
  _set("stockCurrency", meta?.currency || "");
  _set("stockPrice",     fmt(last.close, dec));
  const dayChgEl = document.getElementById("stockDayChg");
  if (dayChgEl) {
    dayChgEl.textContent = `${sign}${chgAbs.toFixed(dec)} (${sign}${chgPct.toFixed(2)}%)`;
    dayChgEl.className   = "sh-daychg " + (chgPct >= 0 ? "bull" : "bear");
  }
  const fis = judgment.fis ?? 0;
  const col = judgment.label_color || fisColor(fis);
  const fisBadge  = document.getElementById("fisBadge");
  const labelChip = document.getElementById("labelChip");
  if (fisBadge)  { fisBadge.textContent = `FIS ${fis>=0?"+":""}${fis.toFixed(0)}`; fisBadge.style.background=col; fisBadge.style.color="#fff"; }
  if (labelChip) { labelChip.textContent = judgment.label||""; labelChip.style.borderColor=col; labelChip.style.color=col; }
}

// ── 차트 렌더 ────────────────────────────────────────────
function renderChart(bars, fisBars, tf, meta) {
  const mainEl = document.getElementById("mainChartEl");
  const volEl  = document.getElementById("volChartEl");
  const macdEl = document.getElementById("macdChartEl");

  if (!mainEl || typeof LightweightCharts === "undefined") return;

  // 기존 차트 제거
  mainEl.innerHTML = ""; if(volEl) volEl.innerHTML = ""; if(macdEl) macdEl.innerHTML = "";

  const bg  = getComputedStyle(document.documentElement).getPropertyValue("--newsprint-bg").trim()  || "#F9F9F7";
  const txt = getComputedStyle(document.documentElement).getPropertyValue("--newsprint-ink").trim() || "#111111";
  
  // 부모 컨테이너 너비 가져오기 (없으면 800px 기본)
  const containerWidth = mainEl.clientWidth || 800;

  const baseOpts = { 
    layout:{ background:{color:bg}, textColor:txt }, 
    grid:{ vertLines:{color:"#e8e8e5"}, horzLines:{color:"#e8e8e5"} }, 
    rightPriceScale:{borderColor:"#ccc"} 
  };

  // [수정] 메인 차트 높이를 400 -> 500으로 상향
  _chart = LightweightCharts.createChart(mainEl, { 
    ...baseOpts, 
    width: containerWidth, 
    height: 500, 
    timeScale:{borderColor:"#ccc", timeVisible:tf!=="1d"} 
  });

  const candles = _chart.addCandlestickSeries({ 
    upColor:"#CC0000", downColor:"#0047AB", borderUpColor:"#CC0000", 
    borderDownColor:"#0047AB", wickUpColor:"#CC0000", wickDownColor:"#0047AB" 
  });
  candles.setData(bars.map(b => ({time:b.time, open:b.open, high:b.high, low:b.low, close:b.close})));

  const toSeries = (arr, key, col, width, title) => {
    const data = arr.map((b,i)=>{ const v=b[key]; return (v!=null&&!isNaN(v))?{time:b.time,value:v}:null; }).filter(Boolean);
    if (data.length) _chart.addLineSeries({color:col,lineWidth:width,title}).setData(data);
  };
  toSeries(fisBars,"EMA20","#E57373",1,"EMA20");
  toSeries(fisBars,"EMA60","#1565C0",1,"EMA60");
  toSeries(fisBars,"EMA120","#888888",1,"EMA120");
  toSeries(fisBars,"ICH_TENKAN","#0047AB",1,"전환");
  toSeries(fisBars,"ICH_KIJUN","#CC0000",1,"기준");

  // 볼린저밴드 상단/하단
  const bbUp = fisBars.map(b=>b.BB_UP!=null&&!isNaN(b.BB_UP)?{time:b.time,value:b.BB_UP}:null).filter(Boolean);
  const bbDn = fisBars.map(b=>b.BB_DN!=null&&!isNaN(b.BB_DN)?{time:b.time,value:b.BB_DN}:null).filter(Boolean);
  if (bbUp.length) _chart.addLineSeries({color:"rgba(150,150,150,0.5)",lineWidth:1,lineStyle:2,title:"BB"}).setData(bbUp);
  if (bbDn.length) _chart.addLineSeries({color:"rgba(150,150,150,0.5)",lineWidth:1,lineStyle:2}).setData(bbDn);

  if (volEl) {
    _volChart = LightweightCharts.createChart(volEl, { 
      ...baseOpts, 
      width: containerWidth, 
      height: 120, // 높이 소폭 상향
      timeScale:{borderColor:"#ccc", timeVisible:tf!=="1d"} 
    });
    _volChart.priceScale("right").applyOptions({ scaleMargins:{top:0.1,bottom:0} });
    _volChart.addHistogramSeries({priceFormat:{type:"volume"}}).setData(bars.map(b=>({time:b.time, value:b.volume, color:b.close>=b.open?"#CC000055":"#0047AB55"})));
    
    // 시간축 동기화
    _chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{ if(r&&_volChart) _volChart.timeScale().setVisibleLogicalRange(r); });
  }

  if (macdEl) {
    _macdChart = LightweightCharts.createChart(macdEl, { 
      ...baseOpts, 
      width: containerWidth, 
      height: 100, // 높이 소폭 상향
      timeScale:{borderColor:"#ccc", timeVisible:tf!=="1d"} 
    });
    _macdChart.priceScale("right").applyOptions({ scaleMargins:{top:0.1,bottom:0.1} });
    const macdData = fisBars.map(b=>b.MACD!=null&&!isNaN(b.MACD)?{time:b.time,value:b.MACD}:null).filter(Boolean);
    const signalData = fisBars.map(b=>b.MACD_SIGNAL!=null&&!isNaN(b.MACD_SIGNAL)?{time:b.time,value:b.MACD_SIGNAL}:null).filter(Boolean);
    const histData = fisBars.map(b=>{
      if (b.MACD==null||b.MACD_SIGNAL==null||isNaN(b.MACD)||isNaN(b.MACD_SIGNAL)) return null;
      const hist = b.MACD - b.MACD_SIGNAL;
      return {time:b.time, value:hist, color:hist>=0?"#CC000088":"#0047AB88"};
    }).filter(Boolean);
    if (histData.length) _macdChart.addHistogramSeries({priceFormat:{type:"price"},title:"MACD Hist"}).setData(histData);
    if (macdData.length) _macdChart.addLineSeries({color:"#CC0000",lineWidth:1,title:"MACD"}).setData(macdData);
    if (signalData.length) _macdChart.addLineSeries({color:"#1565C0",lineWidth:1,title:"Signal"}).setData(signalData);
    
    // 시간축 동기화
    _chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{ if(r&&_macdChart) _macdChart.timeScale().setVisibleLogicalRange(r); });
  }

  _chart.timeScale().fitContent();

  // ── 크로스헤어 범례 (마우스 hover 시 OHLCV 표시) ────────────────
  const chartStage = document.getElementById("chartStage");
  const existLegend = document.getElementById("chartLegend");
  if (existLegend) existLegend.remove();
  const legendEl = document.createElement("div");
  legendEl.id = "chartLegend";
  legendEl.style.cssText = "position:absolute;top:6px;left:8px;z-index:10;font-size:11.5px;color:var(--newsprint-ink,#111);display:flex;gap:10px;flex-wrap:wrap;pointer-events:none;background:rgba(249,249,247,0.9);padding:3px 8px;border:1px solid rgba(0,0,0,0.08);";
  if (chartStage) chartStage.appendChild(legendEl);

  const _isKRW = (meta?.currency || "") !== "USD";
  const _dec   = _isKRW ? 0 : 2;

  _chart.subscribeCrosshairMove(param => {
    if (!param.time || !param.point) { legendEl.innerHTML = ""; return; }
    const cd = param.seriesData.get(candles);
    if (!cd) return;
    const bull = cd.close >= cd.open;
    const t = typeof param.time === "object"
      ? `${param.time.year}-${String(param.time.month).padStart(2,"0")}-${String(param.time.day).padStart(2,"0")}`
      : param.time;
    legendEl.innerHTML =
      `<span style="color:#888">${t}</span>` +
      `<span>시 <b>${fmt(cd.open,_dec)}</b></span>` +
      `<span style="color:#CC0000">고 <b>${fmt(cd.high,_dec)}</b></span>` +
      `<span style="color:#0047AB">저 <b>${fmt(cd.low,_dec)}</b></span>` +
      `<span style="color:${bull?"#CC0000":"#0047AB"};font-weight:700">종 <b>${fmt(cd.close,_dec)}</b></span>`;
  });

  // ── 차트 이벤트 마커 ────────────────────────────────────────────────
  const markers = [];
  for (let mi = 1; mi < fisBars.length; mi++) {
    const b = fisBars[mi], pb = fisBars[mi - 1];
    // EMA20 골든크로스 (EMA20이 EMA60을 하향→상향)
    if (pb.EMA20 != null && pb.EMA60 != null && b.EMA20 != null && b.EMA60 != null) {
      if (pb.EMA20 <= pb.EMA60 && b.EMA20 > b.EMA60)
        markers.push({ time: b.time, position: "belowBar", color: "#CC0000", shape: "arrowUp", text: "GC" });
      if (pb.EMA20 >= pb.EMA60 && b.EMA20 < b.EMA60)
        markers.push({ time: b.time, position: "aboveBar", color: "#0047AB", shape: "arrowDown", text: "DC" });
    }
    // MACD 골든크로스
    if (pb.MACD != null && pb.MACD_SIGNAL != null && b.MACD != null && b.MACD_SIGNAL != null) {
      if (pb.MACD <= pb.MACD_SIGNAL && b.MACD > b.MACD_SIGNAL)
        markers.push({ time: b.time, position: "belowBar", color: "#2ea043", shape: "circle", text: "M↑" });
      if (pb.MACD >= pb.MACD_SIGNAL && b.MACD < b.MACD_SIGNAL)
        markers.push({ time: b.time, position: "aboveBar", color: "#e53935", shape: "circle", text: "M↓" });
    }
    // RSI 과매도 회복 (30 돌파)
    if (pb.RSI14 != null && b.RSI14 != null && pb.RSI14 < 30 && b.RSI14 >= 30)
      markers.push({ time: b.time, position: "belowBar", color: "#d29922", shape: "arrowUp", text: "RSI↑" });
  }
  if (markers.length)
    candles.setMarkers(markers.sort((a, b) => (a.time < b.time ? -1 : 1)));

  // 리사이즈 대응
  const ro = new ResizeObserver(() => {
    const newWidth = mainEl.clientWidth;
    if (newWidth === 0) return;
    if(_chart) _chart.applyOptions({ width: newWidth });
    if(_volChart) _volChart.applyOptions({ width: newWidth });
    if(_macdChart) _macdChart.applyOptions({ width: newWidth });
  });
  ro.observe(mainEl);
}

// ── 종합 판단 사이드바 ───────────────────────────────────
function renderJudgment(j) {
  const _set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  _set("judgeL1", j.summary_l1 || "");
  _set("judgeL2", j.summary_l2 || "");
  const bars6 = [
    { label:"추세",     score:j.scores?.["추세"]    ?? 0, max:30 },
    { label:"모멘텀",  score:j.scores?.["모멘텀"]  ?? 0, max:20 },
    { label:"구조",    score:j.scores?.["구조"]    ?? 0, max:20 },
    { label:"압축",    score:j.scores?.["압축"]    ?? 0, max:20 },
    { label:"거래량",  score:j.scores?.["거래량"]  ?? 0, max:10 },
    { label:"위험감점",score:j.scores?.["위험감점"]?? 0, max:30, negOnly:true },
  ];
  const scoreBarsEl = document.getElementById("scoreBars");
  if (scoreBarsEl) {
    scoreBarsEl.innerHTML = bars6.map(b => {
      const v   = b.score;
      const pct = Math.max(0, Math.min(100, ((v + b.max) / (b.max*2)) * 100));
      const dir = v >= 0 ? "bull" : "bear";
      return `<div class="score-bar-row">
        <span class="score-bar-label">${b.label}</span>
        <div class="score-bar-track">
          <div class="score-bar-fill ${dir}" style="width:${pct.toFixed(0)}%"></div>
        </div>
        <span class="score-bar-val ${dir}">${v>=0?"+":""}${v.toFixed(1)}</span>
      </div>`;
    }).join("");
  }
}

// ── 진입 점수 ────────────────────────────────────────────
function renderEntryScore(entry) {
  const score      = entry?.score ?? 0;
  const comp       = entry?.components || {};
  const setupName  = entry?.setup_name  || "일반";
  const setupName2 = entry?.setup_name2 || "";
  const setupScores= entry?.setup_scores || {};
  const m          = entry?.metrics || {};

  const ctx      = comp["추세문맥"]   ?? 0;
  const structure= comp["진입구조"]   ?? 0;
  const confirm  = comp["확인신호"]   ?? 0;
  const space    = comp["저항여유"]   ?? 0;
  const riskCtrl = comp["리스크관리"] ?? 0;

  // 배지 + 상태 텍스트
  const eCol = score >= 80 ? "#2ea043" : score >= 65 ? "#56d364" : score >= 50 ? "#d29922" : "#6e7681";
  const esBadge = document.getElementById("entryScoreBadge");
  if (esBadge) { esBadge.textContent = score.toFixed(0); esBadge.style.background = eCol; esBadge.style.color = "#fff"; }
  const statusEl = document.getElementById("entryStatus");
  if (statusEl) statusEl.textContent =
    score >= 80 ? "최적 진입 구간" : score >= 65 ? "양호한 진입 구간" : score >= 50 ? "조건부 진입 가능" : "진입 대기 구간";

  const metricsEl = document.getElementById("entryMetrics");
  if (!metricsEl) return;

  function compColor(v, good, danger) {
    return v >= good ? "#2ea043" : v < danger ? "#e53935" : "#d29922";
  }
  function valColor(v, lo, hi, revHi) {
    if (v >= lo && v <= hi) return "#2ea043";
    if (revHi != null && v > revHi) return "#e53935";
    return "#d29922";
  }

  // 시나리오 설명
  const setupDesc = {
    "추세 눌림":   "상승 추세 중 EMA 근처로 눌렸다가 재반등하는 구조. RSI 과열 해소 + 거래량 감소 후 반등이 핵심.",
    "압축 돌파":   "좁은 횡보로 에너지 압축 후 거래량 동반 상단 돌파. ATR·BB 수축 후 확장 시도.",
    "모멘텀 지속": "정배열(EMA10>20>60) 강세 추세에서 지속 상승. ROC·거래량 강세 유지가 핵심.",
    "반전 초기":   "과매도 후 바닥 반전 초기 신호. MACD 반전 + RSI 저점 반등 + 거래량 증가 확인.",
  };
  const setupChips = Object.entries(setupScores)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const cls = k === setupName ? " em-chip-best" : k === setupName2 ? " em-chip-2nd" : "";
      return `<span class="em-chip${cls}">${k} <b>${v.toFixed(0)}</b></span>`;
    }).join("");

  // 5개 구성요소 카드
  const compRows = [
    { num:"①", name:"추세 문맥", v:ctx, max:30, ideal:"24 이상 최적",
      desc: ctx>=24?"FIS·추세·ADX·구름 모두 매수 환경 충족":ctx>=16?"추세 방향 우세 — 일부 조건 미충족":ctx>=8?"중립 이상 — 추세 약세 주의":"추세 환경 부족 — 신중 접근" },
    { num:"②", name:`진입 구조 — ${setupName}${setupName2?" + "+setupName2:""}`, v:structure, max:30, ideal:"20 이상 최적",
      desc: setupDesc[setupName] || "—",
      extra: `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${setupChips}</div>` },
    { num:"③", name:"확인 신호", v:confirm, max:24, ideal:"16 이상 최적",
      desc: confirm>=18?"EMA·MACD·거래량·기준선 신호 모두 동반":confirm>=12?"핵심 신호 대부분 확인":confirm>=6?"일부 신호만 충족 — 추가 봉 확인 권장":"명확한 진입 신호 부족" },
    { num:"④", name:"저항 여유", v:space, max:18, ideal:"10 이상 최적",
      desc: space>=12?"52주·BB 상단 여유 충분 — 저항 부담 낮음":space>=6?"적정 상승 공간 확인":space>=0?"일부 저항 부담 있음":"상단 저항 과부담 — 추격 불리" },
    { num:"⑤", name:"리스크 관리", v:riskCtrl, max:16, ideal:"10 이상 최적",
      desc: riskCtrl>=12?"과열 없고 손절 거리 적정 — 위험 관리 양호":riskCtrl>=8?"리스크 통제 가능 수준":riskCtrl>=4?"일부 위험 요소 — 손절 기준 명확히 설정":"ATR 이격 크거나 위험 감점 높음" },
  ];

  const compHTML = compRows.map(r => {
    const pct = r.max > 0 ? Math.min(100, Math.max(0, r.v / r.max * 100)) : 0;
    const col = compColor(r.v, r.max * 0.7, r.max * 0.3);
    return `<div class="es-comp">
      <div class="es-comp-hd">
        <span class="es-comp-num">${r.num}</span>
        <span class="es-comp-name">${r.name}</span>
        <span class="es-comp-score" style="color:${col}">${r.v.toFixed(0)} <span class="es-comp-max">/ ${r.max}</span></span>
      </div>
      <div class="es-comp-bar"><div style="width:${pct.toFixed(0)}%;background:${col}"></div></div>
      <div class="es-comp-desc">${r.desc}</div>
      ${r.extra || ""}
    </div>`;
  }).join("");

  // 세부 수치 요약
  const ema20GapPct = m.ema20_gap_pct ?? 0;
  const ema20GapAtr = m.ema20_gap_atr ?? 0;
  const bbPos       = m.bb_pos        ?? 50;
  const pos52       = m.range_pos     ?? 50;
  const pbPct       = m.pullback_pct  ?? 0;
  const rsiVal      = m.rsi_reset     ?? 50;
  const adx         = m.adx           ?? 0;
  const emaSign     = ema20GapPct >= 0 ? "+" : "";
  const adxTip      = adx < 15 ? " ⚠" : "";

  const metricRows = [
    { label:"EMA20 이격", value:`${emaSign}${ema20GapPct.toFixed(1)}%`,              col:valColor(ema20GapPct,-1,4,12),    ideal:"-1~+4% 이상적" },
    { label:"ATR 이격",   value:`${ema20GapAtr>=0?"+":""}${ema20GapAtr.toFixed(2)} ATR`, col:valColor(ema20GapAtr,-0.5,1.2,3), ideal:"-0.5~+1.2 이상적" },
    { label:"RSI",        value:rsiVal.toFixed(1),                                   col:valColor(rsiVal,42,60,73),        ideal:"42~60 이상적" },
    { label:"BB 위치",    value:`${bbPos.toFixed(0)}%`,                              col:valColor(bbPos,35,75,90),         ideal:"35~75% 이상적" },
    { label:"52주 위치",  value:`${pos52.toFixed(0)}%`,                              col:valColor(pos52,55,90,97),         ideal:"55~90% 이상적" },
    { label:"최근 조정",  value:`-${pbPct.toFixed(1)}%`,                             col:valColor(pbPct,4,12,20),          ideal:"4~12% 이상적" },
    { label:"ADX",        value:`${adx.toFixed(1)}${adxTip}`,                        col:adx>=20?"#2ea043":adx>=15?"#d29922":"#e53935", ideal:"20+ 추세 지속력" },
  ].map(r => `<div class="es-metric-row">
    <span class="es-metric-label">${r.label}</span>
    <span class="es-metric-value" style="color:${r.col}">${r.value}</span>
    <span class="es-metric-ideal">${r.ideal}</span>
  </div>`).join("");

  metricsEl.innerHTML = compHTML +
    `<div class="es-metric-block"><div class="es-metric-title">📐 세부 수치</div>${metricRows}</div>`;
}
// ── 지표 칩 ─────────────────────────────────────────────
function renderChips(j, fisBars) {
  const row = fisBars[fisBars.length - 1];
  if (!row) return;
  const rsi   = row.RSI14, rvol = row.RVOL, atr = row.ATR14, close = row.close;
  const bb_up = row.BB_UP, bb_dn = row.BB_DN;
  const rh = row.RangeHigh, rl = row.RangeLow;

  function rsiStatus(v)  { return v >= 70 ? "과매수" : v <= 30 ? "과매도" : "중립"; }
  function rsiColor(v)   { return v >= 70 ? "var(--bear,#e53935)" : v <= 30 ? "var(--bull,#2ea043)" : "var(--text2,#666)"; }
  function rvolStatus(v) { return v >= 1.5 ? "거래 급증" : v >= 1.0 ? "보통" : "거래 감소"; }

  const ichParts = (j.ichimoku_status || "").split("—");
  const ichVal = ichParts[0]?.trim() || "—";
  const ichSub = (ichParts[1] || "").trim();

  const bbPosPct = (bb_up != null && bb_dn != null && bb_up > bb_dn)
    ? Math.round((close - bb_dn) / (bb_up - bb_dn) * 100) : null;
  const pos52Pct = (rh && rl && rh > rl)
    ? Math.round((close - rl) / (rh - rl) * 100) : null;

  const chips = [
    { label:"RSI(14)",  value: rsi  != null ? rsi.toFixed(1)    : "—", sub: rsi  != null ? rsiStatus(rsi)   : "", color: rsi  != null ? rsiColor(rsi)                                  : "var(--text2)" },
    { label:"RVOL",     value: rvol != null ? rvol.toFixed(2)+"x": "—", sub: rvol != null ? rvolStatus(rvol) : "", color: rvol != null ? (rvol >= 1.5 ? "var(--bull,#2ea043)" : "var(--text2,#666)") : "var(--text2)" },
    { label:"ATR(14)",  value: atr  != null ? fmt(atr, 2)        : "—", sub: "변동폭",                             color: "var(--text2,#666)" },
    { label:"일목",     value: ichVal,                                   sub: ichSub,                              color: "var(--accent,#1565C0)" },
    ...(bbPosPct != null ? [{ label:"BB 위치",   value: bbPosPct+"%",  sub: bbPosPct>=80?"상단 과열":bbPosPct<=20?"하단 저평":"중립", color: bbPosPct>=80?"var(--bear,#e53935)":bbPosPct<=20?"var(--bull,#2ea043)":"var(--text2,#666)" }] : []),
    ...(pos52Pct != null ? [{ label:"52주 위치", value: pos52Pct+"%",  sub: pos52Pct>=95?"고점 저항권":pos52Pct>=65?"추세 상위권":"하위권", color: pos52Pct>=95?"var(--bear,#e53935)":pos52Pct>=65?"var(--bull,#2ea043)":"var(--text2,#666)" }] : []),
  ];

  const chipGrid = document.getElementById("indicatorChips");
  if (chipGrid) chipGrid.innerHTML = chips.map(c =>
    `<div class="chip">
      <span class="chip-label">${c.label}</span>
      <span class="chip-value" style="color:${c.color}">${c.value}</span>
      <span class="chip-sub">${c.sub}</span>
    </div>`
  ).join("");
}
function renderTable(fisBars) {
  const recent = fisBars.slice(-30).reverse();
  const headEl = document.getElementById("tableHead");
  const bodyEl = document.getElementById("tableBody");
  if (!headEl || !bodyEl) return;
  headEl.innerHTML = `<tr><th>날짜</th><th>시가</th><th>고가</th><th>저가</th><th>종가</th><th>거래량</th><th>FIS</th><th>RSI</th><th>RVOL</th></tr>`;
  bodyEl.innerHTML = recent.map(b => {
    const dir = b.close >= b.open ? "bull" : "bear";
    const fis = b.FIS; const rsi = b.RSI14; const rvol = b.RVOL;
    return `<tr>
      <td>${b.time}</td>
      <td>${fmt(b.open,0)}</td>
      <td class="bull">${fmt(b.high,0)}</td>
      <td class="bear">${fmt(b.low,0)}</td>
      <td class="${dir}" style="font-weight:700">${fmt(b.close,0)}</td>
      <td>${fmtVol(b.volume)}</td>
      <td class="${fis>=30?"bull":fis<=-30?"bear":""}">${fis!=null&&!isNaN(fis)?(fis>=0?"+":"")+fis.toFixed(1):"—"}</td>
      <td class="${rsi>=70?"bear":rsi<=30?"bull":""}">${rsi!=null&&!isNaN(rsi)?rsi.toFixed(1):"—"}</td>
      <td class="${rvol>=1.5?"bull":""}">${rvol!=null&&!isNaN(rvol)?rvol.toFixed(2)+"x":"—"}</td>
    </tr>`;
  }).join("");
}

function fmt(v, dec=0) {
  if (v==null||isNaN(v)) return "—";
  return Number(v).toLocaleString("ko-KR", {minimumFractionDigits:dec,maximumFractionDigits:dec});
}
function fmtVol(v) {
  if (!v||isNaN(v)) return "—";
  if (v>=1e8) return (v/1e8).toFixed(1)+"억";
  if (v>=1e4) return (v/1e4).toFixed(0)+"만";
  return String(v);
}