/* js/analyze.js  —  CFIE v4.0  (매수/매도 기능 없음) */

let _chart     = null;
let _volChart  = null;
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
    if (!bars.length) { showToast("데이터 없음", "error"); overlay.style.display="none"; main.style.display="block"; return; }

    const enriched = calcIndicators(bars);
    const fisBars  = calcFIS(enriched);
    const entry    = calcEntryScore(fisBars);
    const judgment = makeJudgment(fisBars);

    renderStockHeader(_currentTicker, meta, bars, judgment);
    renderChart(bars, fisBars, tf);
    renderJudgment(judgment);
    renderEntryScore(entry);
    renderChips(judgment, fisBars);
    renderTable(fisBars);

    overlay.style.display = "none";
    main.style.display    = "block";
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
  _set("stockPrice",    fmt(last.close, dec));
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
function renderChart(bars, fisBars, tf) {
  const mainEl = document.getElementById("mainChartEl");
  const volEl  = document.getElementById("volChartEl");
  if (!mainEl || typeof LightweightCharts === "undefined") return;
  mainEl.innerHTML = ""; if(volEl) volEl.innerHTML = "";
  const bg  = getComputedStyle(document.documentElement).getPropertyValue("--newsprint-bg").trim()  || "#F9F9F7";
  const txt = getComputedStyle(document.documentElement).getPropertyValue("--newsprint-ink").trim() || "#111111";
  const baseOpts = { layout:{ background:{color:bg}, textColor:txt }, grid:{ vertLines:{color:"#e8e8e5"}, horzLines:{color:"#e8e8e5"} }, rightPriceScale:{borderColor:"#ccc"} };
  _chart = LightweightCharts.createChart(mainEl, { ...baseOpts, width: mainEl.clientWidth||600, height:400, timeScale:{borderColor:"#ccc",timeVisible:tf!=="1d"} });
  const candles = _chart.addCandlestickSeries({ upColor:"#CC0000", downColor:"#0047AB", borderUpColor:"#CC0000", borderDownColor:"#0047AB", wickUpColor:"#CC0000", wickDownColor:"#0047AB" });
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

  // 볼린저밴드 상단/하단만 표시 (점선)
  const bbUp = fisBars.map(b=>b.BB_UP!=null&&!isNaN(b.BB_UP)?{time:b.time,value:b.BB_UP}:null).filter(Boolean);
  const bbDn = fisBars.map(b=>b.BB_DN!=null&&!isNaN(b.BB_DN)?{time:b.time,value:b.BB_DN}:null).filter(Boolean);
  if (bbUp.length) _chart.addLineSeries({color:"rgba(150,150,150,0.5)",lineWidth:1,lineStyle:2,title:"BB"}).setData(bbUp);
  if (bbDn.length) _chart.addLineSeries({color:"rgba(150,150,150,0.5)",lineWidth:1,lineStyle:2}).setData(bbDn);

  if (volEl) {
    _volChart = LightweightCharts.createChart(volEl, { ...baseOpts, width:volEl.clientWidth||600, height:100, timeScale:{borderColor:"#ccc",timeVisible:tf!=="1d"} });
    _volChart.priceScale("right").applyOptions({ scaleMargins:{top:0.1,bottom:0} });
    _volChart.addHistogramSeries({priceFormat:{type:"volume"}}).setData(bars.map(b=>({time:b.time, value:b.volume, color:b.close>=b.open?"#CC000055":"#0047AB55"})));
    _chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{ if(r&&_volChart) _volChart.timeScale().setVisibleLogicalRange(r); });
  }
  _chart.timeScale().fitContent();
  const ro = new ResizeObserver(()=>{ if(_chart) _chart.applyOptions({width:mainEl.clientWidth}); if(_volChart&&volEl) _volChart.applyOptions({width:volEl.clientWidth}); });
  ro.observe(mainEl);
}

// ── 종합 판단 사이드바 ───────────────────────────────────
function renderJudgment(j) {
  const _set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  _set("judgeL1", j.summary_l1 || "");
  _set("judgeL2", j.summary_l2 || "");
  const bars6 = [
    { label:"추세",    score:j.scores?.["추세"]    ?? 0, max:30 },
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
  const score = entry.score ?? 0;
  const esBadge = document.getElementById("entryScoreBadge");
  if (esBadge) {
    esBadge.textContent   = score;
    esBadge.style.background = score>=80?"#2ea043":score>=65?"#d29922":score>=50?"#E57373":"#888";
    esBadge.style.color   = "#fff";
  }
  const statusEl = document.getElementById("entryStatus");
  if (statusEl) {
    statusEl.innerHTML = `<strong>${entry.label||"—"}</strong>` +
      (entry.setup_name  ? ` · <span class="setup-tag">${entry.setup_name}</span>`  : "") +
      (entry.setup_name2 ? ` + <span class="setup-tag2">${entry.setup_name2}</span>`: "");
  }
  const metricsEl = document.getElementById("entryMetrics");
  if (!metricsEl) return;
  // 5 컴포넌트 breakdown
  const comp = entry.components || {};
  const compLabels = ["추세문맥","진입구조","확인신호","저항여유","리스크관리"];
  const compMax    = [30,30,24,18,16];
  let html = `<div class="entry-comp-grid">`;
  compLabels.forEach((lbl, i) => {
    const v   = comp[lbl] ?? 0;
    const mx  = compMax[i];
    const pct = Math.max(0, Math.min(100, (v/mx)*100));
    html += `<div class="entry-comp-row">
      <span class="ec-label">${lbl}</span>
      <div class="ec-track"><div class="ec-fill" style="width:${pct.toFixed(0)}%"></div></div>
      <span class="ec-val">${v.toFixed(1)}/${mx}</span>
    </div>`;
  });
  html += `</div>`;
  // 진입 구조 점수
  const ss = entry.setup_scores || {};
  if (Object.keys(ss).length) {
    html += `<div class="setup-scores">` +
      Object.entries(ss).map(([k,v])=>`<span class="ss-item">${k}<b>${v.toFixed(0)}</b></span>`).join("")+
    `</div>`;
  }
  // 핵심 메트릭
  const m = entry.metrics || {};
  if (Object.keys(m).length) {
    html += `<div class="entry-metrics-grid">` +
      [ ["EMA괴리%", m.ema20_gap_pct?.toFixed(2)],
        ["EMA괴리ATR",m.ema20_gap_atr?.toFixed(2)],
        ["눌림%",    m.pullback_pct?.toFixed(1)],
        ["반등%",    m.bounce_pct?.toFixed(1)],
        ["범위위치",  m.range_pos?.toFixed(1)+"%"],
        ["BB위치",   m.bb_pos?.toFixed(1)+"%"],
        ["RSI",      m.rsi_reset?.toFixed(1)],
        ["ADX",      m.adx?.toFixed(1)],
      ].filter(([,v])=>v!=null).map(([k,v])=>`<div class="emg-item"><span>${k}</span><b>${v}</b></div>`).join("")+
    `</div>`;
  }
  metricsEl.innerHTML = html;
}

// ── 지표 칩 ─────────────────────────────────────────────
function renderChips(j, fisBars) {
  const row  = fisBars[fisBars.length - 1];
  const rsi  = row.RSI14;
  const rvol = row.RVOL;
  const atr  = row.ATR14;
  const close= row.close;
  const ema20= row.EMA20;
  const ema60= row.EMA60;
  const bb_up= row.BB_UP, bb_dn = row.BB_DN, bb_mid = row.BB_MID;
  const rh   = row.RangeHigh, rl = row.RangeLow;
  const chips = [];
  if (rsi != null && !isNaN(rsi)) chips.push({ label:"RSI(14)", val: rsi.toFixed(1), cls: rsi>=70?"bear":rsi<=30?"bull":"" });
  if (rvol!= null && !isNaN(rvol)) chips.push({ label:"거래량배율", val:rvol.toFixed(2)+"x", cls:rvol>=1.5?"bull":rvol<0.75?"bear":"" });
  if (atr != null && !isNaN(atr))  chips.push({ label:"ATR(14)", val:fmt(atr,2), cls:"" });
  if (ema20!= null && !isNaN(ema20)) chips.push({ label:"EMA20", val:fmt(ema20,0), cls:close>ema20?"bull":"bear" });
  if (ema60!= null && !isNaN(ema60)) chips.push({ label:"EMA60", val:fmt(ema60,0), cls:close>ema60?"bull":"bear" });
  // 일목 구름 상태
  chips.push({ label:"일목", val:j.ichimoku_status?.split("—")[0].trim()||"—", cls: j.ichimoku_status?.includes("위")?"bull":j.ichimoku_status?.includes("아래")?"bear":"" });
  // BB 위치
  if (bb_up!=null&&bb_dn!=null&&!isNaN(bb_up)&&!isNaN(bb_dn)&&(bb_up-bb_dn)>0) {
    const bbPos = Math.round((close-bb_dn)/(bb_up-bb_dn)*100);
    chips.push({ label:"BB위치", val:bbPos+"%", cls: bbPos>=85?"bear":bbPos<=15?"bull":"" });
  }
  // 52주 위치
  if (rh&&rl&&!isNaN(rh)&&!isNaN(rl)&&rh>rl) {
    const pos52 = Math.round((close-rl)/(rh-rl)*100);
    chips.push({ label:"52주위치", val:pos52+"%", cls: pos52>=85?"bull":pos52<=20?"bear":"" });
  }
  const chipGrid = document.getElementById("indicatorChips");
  if (chipGrid) chipGrid.innerHTML = chips.map(c=>
    `<div class="ind-chip ${c.cls}"><span class="ind-chip-label">${c.label}</span><span class="ind-chip-val">${c.val}</span></div>`
  ).join("");
}

// ── 데이터 테이블 ────────────────────────────────────────
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
