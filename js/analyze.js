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
    document.getElementById("stockName").textContent = "종목을 검색하여 분석을 시작하세요";
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
    if (!bars.length) { showToast("데이터 없음", "error"); overlay.style.display="none"; main.style.display="block"; return; }
    _currentData = bars;

    // FIS 계산
    const dataForFIS = bars.map(b => ({
      Date: new Date(b.time * 1000).toISOString().slice(0, 10),
      Open: b.open, High: b.high, Low: b.low, Close: b.close, Volume: b.volume
    }));
    _currentFIS = (typeof computeFIS === "function") ? computeFIS(dataForFIS) : null;

    // 헤더 렌더
    renderStockHeader(_currentTicker, meta, bars);
    // 차트 렌더
    renderChart(_currentTicker, bars, tf);
    // 사이드바 렌더
    if (_currentFIS) renderSidebar(_currentFIS, bars);
    // 테이블 렌더
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
  const chgPct = ((last.close - prev) / prev) * 100;
  const chgAbs = last.close - prev;
  const dir    = chgPct >= 0 ? "bull" : "bear";
  const sign   = chgPct >= 0 ? "+" : "";

  document.getElementById("stockName").textContent    = meta?.shortName || meta?.longName || ticker;
  document.getElementById("stockTicker").textContent  = ticker;
  document.getElementById("stockExchange").textContent= meta?.exchangeName || meta?.fullExchangeName || "";
  document.getElementById("stockCurrency").textContent= meta?.currency || "";
  document.getElementById("stockPrice").textContent   = fmt(last.close, meta?.currency === "USD" ? 2 : 0);
  const dayChgEl = document.getElementById("stockDayChg");
  dayChgEl.textContent = `${sign}${chgAbs.toFixed(meta?.currency==="USD"?2:0)} (${sign}${chgPct.toFixed(2)}%)`;
  dayChgEl.className   = `sh-daychg ${dir}`;

  // 포트폴리오 보유 여부
  const portfolio = portfolioLoad();
  const holding   = portfolio[ticker];
  const holdBadge = document.getElementById("holdingBadge");
  if (holdBadge) holdBadge.style.display = holding ? "inline-flex" : "none";

  // FIS 배지
  if (_currentFIS) {
    const fis  = _currentFIS.total ?? 0;
    const col  = fisColor(fis);
    const lbl  = fisLabelText(fis);
    const fisBadge = document.getElementById("fisBadge");
    const labelChip = document.getElementById("labelChip");
    if (fisBadge)  { fisBadge.textContent  = `FIS ${fis>=0?"+":""}${fis.toFixed(0)}`; fisBadge.style.background = col; fisBadge.style.color = "#fff"; }
    if (labelChip) { labelChip.textContent = lbl; labelChip.style.borderColor = col; labelChip.style.color = col; }
  }
}

// ── 차트 렌더 ─────────────────────────────────────────
function renderChart(ticker, bars, tf) {
  const mainEl = document.getElementById("mainChartEl");
  const volEl  = document.getElementById("volChartEl");
  if (!mainEl || !volEl) return;
  mainEl.innerHTML = "";
  volEl.innerHTML  = "";

  const bg  = "#F9F9F7";
  const txt = "#111111";

  _chart = LightweightCharts.createChart(mainEl, {
    width:  mainEl.clientWidth,
    height: 400,
    layout: { background: { color: bg }, textColor: txt },
    grid:   { vertLines: { color: "#e8e8e5" }, horzLines: { color: "#e8e8e5" } },
    rightPriceScale: { borderColor: "#ccc" },
    timeScale: { borderColor: "#ccc", timeVisible: true },
  });

  const candleSeries = _chart.addCandlestickSeries({
    upColor:        "#CC0000", downColor:        "#0047AB",
    borderUpColor:  "#CC0000", borderDownColor:  "#0047AB",
    wickUpColor:    "#CC0000", wickDownColor:    "#0047AB",
  });
  candleSeries.setData(bars.map(b => ({
    time: b.time, open: b.open, high: b.high, low: b.low, close: b.close
  })));

  // EMA 라인 (있는 경우)
  if (typeof computeEMA === "function") {
    const ema20 = computeEMA(bars.map(b=>b.close), 20);
    const ema60 = computeEMA(bars.map(b=>b.close), 60);
    const ema20Data = bars.map((b,i)=>ema20[i] != null ? {time:b.time, value:ema20[i]} : null).filter(Boolean);
    const ema60Data = bars.map((b,i)=>ema60[i] != null ? {time:b.time, value:ema60[i]} : null).filter(Boolean);
    _chart.addLineSeries({ color: "#E57373", lineWidth: 1, title: "EMA20" }).setData(ema20Data);
    _chart.addLineSeries({ color: "#1565C0", lineWidth: 1, title: "EMA60" }).setData(ema60Data);
  }

  // 일목균형표 전환선/기준선
  if (typeof computeIchimoku === "function") {
    const ichi = computeIchimoku(bars);
    const tenkanData = ichi.tenkan.filter(d => d.value != null);
    const kijunData  = ichi.kijun.filter(d => d.value != null);
    _chart.addLineSeries({ color: "#0047AB", lineWidth: 1, title: "전환선" }).setData(tenkanData);
    _chart.addLineSeries({ color: "#CC0000", lineWidth: 1, title: "기준선" }).setData(kijunData);
  }

  _volChart = LightweightCharts.createChart(volEl, {
    width:  volEl.clientWidth,
    height: 100,
    layout: { background: { color: bg }, textColor: txt },
    grid:   { vertLines: { color: "#e8e8e5" }, horzLines: { color: "#e8e8e5" } },
    rightPriceScale: { borderColor: "#ccc", scaleMargins: { top: 0, bottom: 0 } },
    timeScale: { borderColor: "#ccc", timeVisible: true },
  });
  _volChart.addHistogramSeries({ color: "#bbb", priceFormat: { type: "volume" } })
           .setData(bars.map(b => ({
             time: b.time, value: b.volume,
             color: b.close >= b.open ? "#CC000055" : "#0047AB55"
           })));

  _chart.timeScale().subscribeVisibleLogicalRangeChange(r => {
    _volChart.timeScale().setVisibleLogicalRange(r);
  });

  window.addEventListener("resize", () => {
    if (_chart)    _chart.applyOptions({ width: mainEl.clientWidth });
    if (_volChart) _volChart.applyOptions({ width: volEl.clientWidth });
  });
}

// ── 사이드바 렌더 ─────────────────────────────────────
function renderSidebar(fis, bars) {
  const total = fis.total ?? 0;
  const col   = fisColor(total);
  const lbl   = fisLabelText(total);

  // 종합 판단
  const l1El = document.getElementById("judgeL1");
  const l2El = document.getElementById("judgeL2");
  if (l1El) l1El.textContent = `FIS ${total>=0?"+":""}${total.toFixed(1)} · ${lbl}`;
  if (l2El) l2El.textContent = total >= 40
    ? "상승 우위 추세. 진입 타이밍 점검 권장."
    : total >= 10
    ? "중립 구간. 방향성 확인 후 접근."
    : "하락 압력 구간. 신중한 접근 필요.";

  // 점수 바
  const barDefs = [
    { label: "추세",   key: "trend",    max: 30 },
    { label: "모멘텀", key: "momentum", max: 25 },
    { label: "변동성", key: "vol",      max: 20 },
    { label: "볼륨",   key: "volume",   max: 15 },
    { label: "패턴",   key: "pattern",  max: 10 },
  ];
  const scoreBarsEl = document.getElementById("scoreBars");
  if (scoreBarsEl) {
    scoreBarsEl.innerHTML = barDefs.map(b => {
      const v   = fis[b.key] ?? 0;
      const pct = Math.max(0, Math.min(100, (v / b.max) * 100));
      const dir = v >= 0 ? "bull" : "bear";
      return `<div class="score-bar-row">
        <span class="score-bar-label">${b.label}</span>
        <div class="score-bar-track">
          <div class="score-bar-fill ${dir}" style="width:${pct}%"></div>
        </div>
        <span class="score-bar-val ${dir}">${v.toFixed(1)}</span>
      </div>`;
    }).join("");
  }

  // 진입 점수
  const entryScore = fis.entryScore ?? total;
  const esBadge = document.getElementById("entryScoreBadge");
  if (esBadge) {
    esBadge.textContent = entryScore.toFixed(0);
    esBadge.style.background = entryScore >= 70 ? "#2ea043" : entryScore >= 50 ? "#d29922" : "#6e7681";
  }
  const entryStatusEl = document.getElementById("entryStatus");
  if (entryStatusEl) {
    entryStatusEl.textContent = entryScore >= 80 ? "✅ 진입 우선 후보"
      : entryScore >= 65 ? "🟡 조건부 진입 검토"
      : entryScore >= 50 ? "⚠ 관망 권장"
      : "❌ 진입 부적합";
  }

  // 주요 지표 칩
  const last   = bars[bars.length - 1];
  const chips  = [];
  if (fis.rsi14 != null)  chips.push({ label: "RSI(14)",  val: fis.rsi14.toFixed(1),  cls: fis.rsi14 >= 70 ? "bear" : fis.rsi14 <= 30 ? "bull" : "" });
  if (fis.ema20 != null)  chips.push({ label: "EMA20",    val: fmt(fis.ema20, 0),       cls: last.close > fis.ema20 ? "bull" : "bear" });
  if (fis.ema60 != null)  chips.push({ label: "EMA60",    val: fmt(fis.ema60, 0),       cls: last.close > fis.ema60 ? "bull" : "bear" });
  if (fis.atr14 != null)  chips.push({ label: "ATR(14)",  val: fmt(fis.atr14, 2),       cls: "" });
  if (fis.macd  != null)  chips.push({ label: "MACD",     val: (fis.macd>=0?"+":"") + fis.macd.toFixed(2), cls: fis.macd >= 0 ? "bull" : "bear" });
  if (fis.rvol  != null)  chips.push({ label: "상대거래량", val: fis.rvol.toFixed(2) + "x", cls: fis.rvol >= 1.5 ? "bull" : "" });

  const chipGrid = document.getElementById("indicatorChips");
  if (chipGrid) {
    chipGrid.innerHTML = chips.map(c =>
      `<div class="ind-chip ${c.cls}"><span class="ind-chip-label">${c.label}</span><span class="ind-chip-val">${c.val}</span></div>`
    ).join("");
  }
}

// ── 데이터 테이블 ─────────────────────────────────────
function renderTable(bars) {
  const recent = bars.slice(-30).reverse();
  const headEl = document.getElementById("tableHead");
  const bodyEl = document.getElementById("tableBody");
  if (!headEl || !bodyEl) return;
  headEl.innerHTML = `<tr>
    <th>날짜</th><th>시가</th><th>고가</th><th>저가</th><th>종가</th><th>거래량</th>
  </tr>`;
  bodyEl.innerHTML = recent.map(b => {
    const date = new Date(b.time * 1000).toISOString().slice(0, 10);
    const dir  = b.close >= b.open ? "bull" : "bear";
    return `<tr>
      <td>${date}</td>
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
  const buyNewBtn = document.querySelector(".btn-buy-new");
  const buyAddBtn = document.querySelector(".btn-buy-add");
  const sellPartBtn = document.querySelector(".btn-sell-part");
  const sellFullBtn = document.querySelector(".btn-sell-full");
  if (buyNewBtn)   buyNewBtn.style.display   = holding ? "none" : "inline-flex";
  if (buyAddBtn)   buyAddBtn.style.display   = holding ? "inline-flex" : "none";
  if (sellPartBtn) sellPartBtn.style.display = holding ? "inline-flex" : "none";
  if (sellFullBtn) sellFullBtn.style.display = holding ? "inline-flex" : "none";
}

// ── 매수/매도 모달 ────────────────────────────────────
let _isSellFull = false;

function openBuyModal() {
  const last = _currentData[_currentData.length - 1];
  document.getElementById("modalBuySection").style.display = "block";
  document.getElementById("modalSellSection").style.display = "none";
  document.getElementById("modalTitle").textContent    = portfolioLoad()[_currentTicker] ? "추가 매수" : "신규 진입";
  document.getElementById("modalSubTicker").textContent = _currentTicker;
  document.getElementById("modalQty").value   = "1";
  document.getElementById("modalPrice").value = last ? String(Math.round(last.close)) : "";
  onModalQtyChange();
  document.getElementById("tradeModal").style.display = "flex";
}

function openSellModal(full) {
  _isSellFull = full;
  const portfolio = portfolioLoad();
  const holding   = portfolio[_currentTicker];
  document.getElementById("modalBuySection").style.display  = "none";
  document.getElementById("modalSellSection").style.display = "block";
  document.getElementById("modalSellSub").textContent       = _currentTicker;
  document.getElementById("modalSellModeNote").textContent  = full ? "전량 매도" : "부분 매도";
  document.getElementById("modalSellQty").value = holding ? String(holding.qty) : "1";
  document.getElementById("tradeModal").style.display = "flex";
}

function closeTradeModal() {
  document.getElementById("tradeModal").style.display = "none";
}

function onModalQtyChange() {
  const qty   = parseInt(document.getElementById("modalQty")?.value || "0", 10);
  const price = parseFloat(document.getElementById("modalPrice")?.value || "0");
  const investEl = document.getElementById("modalInvest");
  if (investEl) investEl.textContent = qty && price ? fmt(qty * price, 0) + "원" : "—";
}

function onModalPriceChange() { onModalQtyChange(); }

function confirmBuy() {
  const qty   = parseInt(document.getElementById("modalQty")?.value || "0", 10);
  const price = parseFloat(document.getElementById("modalPrice")?.value || "0");
  if (!qty || qty < 1) { showToast("유효한 수량을 입력하세요.", "error"); return; }
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
  const qty = _isSellFull ? (holding?.qty || 0) : parseInt(document.getElementById("modalSellQty")?.value || "0", 10);
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
