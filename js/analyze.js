/* js/analyze.js */

let _chart    = null;
let _volChart = null;
let _currentTicker = null;
let _currentData   = [];
let _currentFIS    = null;

// ── 초기화 ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const url = new URLSearchParams(location.search);
  const t   = url.get("t");
  if (t) {
    loadChart(t);
  } else {
    document.getElementById("loadingOverlay").style.display = "none";
    document.getElementById("analyzeMain").style.display    = "block";
    const nameEl = document.getElementById("stockName");
    if (nameEl) nameEl.textContent = "종목을 검색하여 분석을 시작하세요";
  }
  document.getElementById("tradeModal")?.addEventListener("click", e => {
    if (e.target?.id === "tradeModal") closeTradeModal();
  });
});

// ── 차트 로드 ─────────────────────────────────────────
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
      overlay.style.display = "none"; main.style.display = "block"; return;
    }
    _currentData = bars;

    // 지표 계산 (indicators.js 함수 사용)
    if (typeof calcIndicators === "function") {
      try {
        const enriched = calcIndicators(bars);
        const fissBars = calcFIS(enriched);
        const entry    = calcEntryScore(fissBars);
        const last     = fissBars[fissBars.length - 1];
        _currentFIS = {
          total:      last.FIS          ?? 0,
          trend:      last.TrendScore   ?? 0,
          momentum:   last.MomentumScore ?? 0,
          vol:        last.CompressionScore ?? 0,
          volume:     last.VolumeScore  ?? 0,
          pattern:    last.StructureScore ?? 0,
          entryScore: entry.score       ?? 0,
          rsi14:      last.RSI14,
          ema20:      last.EMA20,
          ema60:      last.EMA60,
          atr14:      last.ATR14,
          macd:       last.MACD,
          rvol:       last.RVOL,
          _enriched:  enriched,
        };
      } catch(e) {
        console.warn("FIS 계산 오류:", e);
        _currentFIS = null;
      }
    }

    renderStockHeader(_currentTicker, meta, bars);
    renderChart(_currentTicker, bars, tf);
    if (_currentFIS) renderSidebar(_currentFIS, bars);
    renderTable(bars);

    overlay.style.display = "none";
    main.style.display    = "block";
    updateActionButtons();
  } catch(e) {
    showToast("차트 로드 실패: " + e.message, "error");
    overlay.style.display = "none";
    main.style.display    = "block";
  }
}

function reloadChart() {
  if (_currentTicker) loadChart(_currentTicker);
}

// ── 종목 헤더 ─────────────────────────────────────────
function renderStockHeader(ticker, meta, bars) {
  const last   = bars[bars.length - 1];
  const prev   = bars.length > 1 ? bars[bars.length - 2].close : last.open;
  const chgPct = prev > 0 ? ((last.close - prev) / prev) * 100 : 0;
  const chgAbs = last.close - prev;
  const dir    = chgPct >= 0 ? "bull" : "bear";
  const sign   = chgPct >= 0 ? "+" : "";
  const isKRW  = (meta?.currency || "") !== "USD";

  const _set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  _set("stockName",     meta?.shortName || meta?.longName || ticker);
  _set("stockTicker",   ticker);
  _set("stockExchange", meta?.exchangeName || meta?.fullExchangeName || "");
  _set("stockCurrency", meta?.currency || "");
  _set("stockPrice",    fmt(last.close, isKRW ? 0 : 2));
  const dayChgEl = document.getElementById("stockDayChg");
  if (dayChgEl) {
    dayChgEl.textContent = `${sign}${chgAbs.toFixed(isKRW?0:2)} (${sign}${chgPct.toFixed(2)}%)`;
    dayChgEl.className   = `sh-daychg ${dir}`;
  }

  const portfolio = portfolioLoad();
  const holding   = portfolio[ticker];
  const holdBadge = document.getElementById("holdingBadge");
  if (holdBadge) holdBadge.style.display = holding ? "inline-flex" : "none";

  if (_currentFIS) {
    const fis = _currentFIS.total ?? 0;
    const col = fisColor(fis);
    const lbl = fisLabelText(fis);
    const fisBadge  = document.getElementById("fisBadge");
    const labelChip = document.getElementById("labelChip");
    if (fisBadge)  { fisBadge.textContent  = `FIS ${fis>=0?"+":""}${fis.toFixed(0)}`; fisBadge.style.background = col; fisBadge.style.color = "#fff"; }
    if (labelChip) { labelChip.textContent = lbl; labelChip.style.borderColor = col; labelChip.style.color = col; }
  }
}

// ── 차트 렌더 (LightweightCharts) ─────────────────────
function renderChart(ticker, bars, tf) {
  const mainEl = document.getElementById("mainChartEl");
  const volEl  = document.getElementById("volChartEl");
  if (!mainEl || !volEl || typeof LightweightCharts === "undefined") return;
  mainEl.innerHTML = "";
  volEl.innerHTML  = "";

  const bg  = getComputedStyle(document.documentElement).getPropertyValue("--newsprint-bg").trim() || "#F9F9F7";
  const txt = getComputedStyle(document.documentElement).getPropertyValue("--newsprint-ink").trim() || "#111111";

  _chart = LightweightCharts.createChart(mainEl, {
    width:  mainEl.clientWidth || 600,
    height: 400,
    layout: { background: { color: bg }, textColor: txt },
    grid:   { vertLines: { color: "#e8e8e5" }, horzLines: { color: "#e8e8e5" } },
    rightPriceScale: { borderColor: "#ccc" },
    timeScale:       { borderColor: "#ccc", timeVisible: tf !== "1d" },
  });

  // 캔들스틱 (한국식: 상승=빨강, 하락=파랑)
  const candleSeries = _chart.addCandlestickSeries({
    upColor:        "#CC0000", downColor:        "#0047AB",
    borderUpColor:  "#CC0000", borderDownColor:  "#0047AB",
    wickUpColor:    "#CC0000", wickDownColor:    "#0047AB",
  });
  candleSeries.setData(bars.map(b => ({
    time: b.time, open: b.open, high: b.high, low: b.low, close: b.close
  })));

  // EMA 이동평균선
  if (typeof ema === "function") {
    const closes  = bars.map(b => b.close);
    const ema20 = ema(closes, 20);
    const ema60 = ema(closes, 60);
    const ema20Data = bars.map((b,i) => ema20[i] != null ? {time: b.time, value: ema20[i]} : null).filter(Boolean);
    const ema60Data = bars.map((b,i) => ema60[i] != null ? {time: b.time, value: ema60[i]} : null).filter(Boolean);
    if (ema20Data.length) _chart.addLineSeries({ color: "#E57373", lineWidth: 1, title: "EMA20" }).setData(ema20Data);
    if (ema60Data.length) _chart.addLineSeries({ color: "#1565C0", lineWidth: 1, title: "EMA60" }).setData(ema60Data);
  }

  // 일목균형표 전환선 / 기준선
  if (typeof ichimoku === "function" && bars.length >= 26) {
    const ichi = ichimoku(bars, 9, 26, 52);
    const tenkanData = bars.map((b,i) => ichi.tenkan[i] != null ? {time: b.time, value: ichi.tenkan[i]} : null).filter(Boolean);
    const kijunData  = bars.map((b,i) => ichi.kijun[i]  != null ? {time: b.time, value: ichi.kijun[i]}  : null).filter(Boolean);
    if (tenkanData.length) _chart.addLineSeries({ color: "#0047AB", lineWidth: 1, title: "전환선" }).setData(tenkanData);
    if (kijunData.length)  _chart.addLineSeries({ color: "#CC0000", lineWidth: 1, title: "기준선" }).setData(kijunData);
  }

  // 거래량 차트
  _volChart = LightweightCharts.createChart(volEl, {
    width:  volEl.clientWidth || 600,
    height: 100,
    layout: { background: { color: bg }, textColor: txt },
    grid:   { vertLines: { color: "#e8e8e5" }, horzLines: { color: "#e8e8e5" } },
    rightPriceScale: { borderColor: "#ccc", scaleMargins: { top: 0.1, bottom: 0 } },
    timeScale: { borderColor: "#ccc", timeVisible: tf !== "1d" },
  });
  _volChart.addHistogramSeries({ color: "#bbb", priceFormat: { type: "volume" } })
           .setData(bars.map(b => ({
             time:  b.time,
             value: b.volume,
             color: b.close >= b.open ? "#CC000055" : "#0047AB55",
           })));

  // 차트 동기화
  _chart.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (_volChart) _volChart.timeScale().setVisibleLogicalRange(r);
  });
  _chart.timeScale().fitContent();

  // 리사이즈 대응
  const ro = new ResizeObserver(() => {
    if (_chart)    _chart.applyOptions({ width: mainEl.clientWidth });
    if (_volChart) _volChart.applyOptions({ width: volEl.clientWidth });
  });
  ro.observe(mainEl);
}

// ── 사이드바 렌더 ─────────────────────────────────────
function renderSidebar(fis, bars) {
  const total = fis.total ?? 0;
  const col   = fisColor(total);
  const lbl   = fisLabelText(total);

  const _set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  _set("judgeL1", `FIS ${total>=0?"+":""}${total.toFixed(1)} · ${lbl}`);
  _set("judgeL2", total >= 40
    ? "상승 우위 추세. 진입 타이밍 점검 권장."
    : total >= 10
    ? "중립 구간. 방향성 확인 후 접근."
    : "하락 압력 구간. 신중한 접근 필요.");

  // 점수 바
  const barDefs = [
    { label: "추세",   key: "trend",    max: 30 },
    { label: "모멘텀", key: "momentum", max: 20 },
    { label: "변동성", key: "vol",      max: 20 },
    { label: "볼륨",   key: "volume",   max: 10 },
    { label: "구조",   key: "pattern",  max: 20 },
  ];
  const scoreBarsEl = document.getElementById("scoreBars");
  if (scoreBarsEl) {
    scoreBarsEl.innerHTML = barDefs.map(b => {
      const v   = fis[b.key] ?? 0;
      const pct = Math.max(0, Math.min(100, ((v + b.max) / (b.max * 2)) * 100));
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

  // 진입 점수
  const entryScore = fis.entryScore ?? 0;
  const esBadge    = document.getElementById("entryScoreBadge");
  if (esBadge) {
    esBadge.textContent = entryScore.toFixed(0);
    esBadge.style.background = entryScore >= 70 ? "#2ea043" : entryScore >= 50 ? "#d29922" : "#6e7681";
  }
  const entryStatusEl = document.getElementById("entryStatus");
  if (entryStatusEl) {
    entryStatusEl.textContent = entryScore >= 75 ? "✅ 최적 진입 후보"
      : entryScore >= 60 ? "🟡 우호적 진입 검토"
      : entryScore >= 45 ? "⚠ 중립 관망"
      : "❌ 진입 부적합";
  }

  // 주요 지표 칩
  const last  = bars[bars.length - 1];
  const chips = [];
  if (fis.rsi14 != null) chips.push({ label: "RSI(14)", val: fis.rsi14.toFixed(1), cls: fis.rsi14 >= 70 ? "bear" : fis.rsi14 <= 30 ? "bull" : "" });
  if (fis.ema20 != null) chips.push({ label: "EMA20",   val: fmt(fis.ema20, 0),    cls: last.close > fis.ema20 ? "bull" : "bear" });
  if (fis.ema60 != null) chips.push({ label: "EMA60",   val: fmt(fis.ema60, 0),    cls: last.close > fis.ema60 ? "bull" : "bear" });
  if (fis.atr14 != null) chips.push({ label: "ATR(14)", val: fmt(fis.atr14, 2),    cls: "" });
  if (fis.macd  != null) chips.push({ label: "MACD",    val: (fis.macd>=0?"+":"") + fis.macd.toFixed(2), cls: fis.macd >= 0 ? "bull" : "bear" });
  if (fis.rvol  != null) chips.push({ label: "거래량배율", val: fis.rvol.toFixed(2) + "x", cls: fis.rvol >= 1.5 ? "bull" : "" });

  const chipGrid = document.getElementById("indicatorChips");
  if (chipGrid) {
    chipGrid.innerHTML = chips.map(c =>
      `<div class="ind-chip ${c.cls}">
        <span class="ind-chip-label">${c.label}</span>
        <span class="ind-chip-val">${c.val}</span>
      </div>`
    ).join("");
  }
}

// ── 데이터 테이블 ─────────────────────────────────────
function renderTable(bars) {
  const recent  = bars.slice(-30).reverse();
  const headEl  = document.getElementById("tableHead");
  const bodyEl  = document.getElementById("tableBody");
  if (!headEl || !bodyEl) return;
  headEl.innerHTML = `<tr>
    <th>날짜</th><th>시가</th><th>고가</th><th>저가</th><th>종가</th><th>거래량</th>
  </tr>`;
  bodyEl.innerHTML = recent.map(b => {
    const dir = b.close >= b.open ? "bull" : "bear";
    return `<tr>
      <td>${b.time}</td>
      <td>${fmt(b.open, 0)}</td>
      <td class="bull">${fmt(b.high, 0)}</td>
      <td class="bear">${fmt(b.low, 0)}</td>
      <td class="${dir}" style="font-weight:700">${fmt(b.close, 0)}</td>
      <td>${fmtVol(b.volume)}</td>
    </tr>`;
  }).join("");
}

// ── 액션 버튼 상태 ────────────────────────────────────
function updateActionButtons() {
  const portfolio = portfolioLoad();
  const holding   = portfolio[_currentTicker];
  const qs = s => document.querySelector(s);
  const show = (sel, flag) => { const el = qs(sel); if (el) el.style.display = flag ? "inline-flex" : "none"; };
  show(".btn-buy-new",   !holding);
  show(".btn-buy-add",    holding);
  show(".btn-sell-part",  holding);
  show(".btn-sell-full",  holding);
}

// ── 매수/매도 모달 ────────────────────────────────────
let _isSellFull = false;

function openBuyModal() {
  const last = _currentData[_currentData.length - 1];
  const _set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const _setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  document.getElementById("modalBuySection").style.display  = "block";
  document.getElementById("modalSellSection").style.display = "none";
  _setT("modalTitle",    portfolioLoad()[_currentTicker] ? "추가 매수" : "신규 진입");
  _setT("modalSubTicker", _currentTicker);
  _set("modalQty",   "1");
  _set("modalPrice", last ? String(Math.round(last.close)) : "");
  onModalQtyChange();
  document.getElementById("tradeModal").style.display = "flex";
}

function openSellModal(full) {
  _isSellFull = full;
  const portfolio = portfolioLoad();
  const holding   = portfolio[_currentTicker];
  const _setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  document.getElementById("modalBuySection").style.display  = "none";
  document.getElementById("modalSellSection").style.display = "block";
  _setT("modalSellSub",      _currentTicker);
  _setT("modalSellModeNote", full ? "전량 매도" : "부분 매도");
  const qtyEl = document.getElementById("modalSellQty");
  if (qtyEl) qtyEl.value = holding ? String(holding.qty) : "1";
  document.getElementById("tradeModal").style.display = "flex";
}

function closeTradeModal() {
  document.getElementById("tradeModal").style.display = "none";
}

function onModalQtyChange() {
  const qty   = parseInt(document.getElementById("modalQty")?.value  || "0", 10);
  const price = parseFloat(document.getElementById("modalPrice")?.value || "0");
  const investEl = document.getElementById("modalInvest");
  if (investEl) investEl.textContent = qty && price ? fmt(qty * price, 0) + "원" : "—";
}

function onModalPriceChange() { onModalQtyChange(); }

function confirmBuy() {
  const qty   = parseInt(document.getElementById("modalQty")?.value  || "0", 10);
  const price = parseFloat(document.getElementById("modalPrice")?.value || "0");
  if (!qty || qty < 1)    { showToast("유효한 수량을 입력하세요.", "error"); return; }
  if (!price || price <= 0) { showToast("유효한 진입가를 입력하세요.", "error"); return; }
  const name = document.getElementById("stockName")?.textContent || _currentTicker;
  portfolioBuy(_currentTicker, name, qty, price);
  showToast(`${name} ${qty}주 진입 등록 완료`);
  closeTradeModal();
  updateActionButtons();
  const holdBadge = document.getElementById("holdingBadge");
  if (holdBadge) holdBadge.style.display = "inline-flex";
}

function confirmSell() {
  const portfolio = portfolioLoad();
  const holding   = portfolio[_currentTicker];
  const qty = _isSellFull
    ? (holding?.qty || 0)
    : parseInt(document.getElementById("modalSellQty")?.value || "0", 10);
  if (!qty || qty < 1) { showToast("유효한 수량을 입력하세요.", "error"); return; }
  if (holding && qty > holding.qty) { showToast("보유 수량보다 많은 매도는 불가합니다.", "error"); return; }
  const name = document.getElementById("stockName")?.textContent || _currentTicker;
  portfolioSell(_currentTicker, qty);
  showToast(`${name} ${qty}주 매도 완료`);
  closeTradeModal();
  updateActionButtons();
  const holdBadge = document.getElementById("holdingBadge");
  if (holdBadge) holdBadge.style.display = portfolioLoad()[_currentTicker] ? "inline-flex" : "none";
}
