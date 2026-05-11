import { requireAuth, updateUserUI }             from "./auth.js";
import { fetchOHLCV }                            from "./yahoo.js";
import { computeFIS, computeIchimoku, fisLabel } from "./indicators.js";
import { fmt, fmtPct, startClock, markActiveNav, initSearch, toast, bullOrBear } from "./common.js";

const user = requireAuth(); if (!user) throw 0;
updateUserUI(); startClock(); markActiveNav();
initSearch(ticker => { window.location.href = `analyze.html?t=${ticker}`; });

let _chart = null, _volChart = null, _currentTicker = null, _tf = "1d";

window.setTF = function(tf, btn) {
  _tf = tf;
  document.querySelectorAll(".tftab").forEach(b => b.classList.toggle("active", b === btn));
  if (_currentTicker) loadChart(_currentTicker);
};

window.searchAndAnalyze = function() {
  const val = document.getElementById("analyzeSearchInput").value.trim();
  if (val) loadChart(val.toUpperCase());
};

initSearch(ticker => loadChart(ticker), "analyzeSearchInput", "analyzeDropdown");

async function loadChart(ticker) {
  _currentTicker = ticker;
  try {
    const data = await fetchOHLCV(ticker, _tf);
    if (!data.length) { toast("데이터 없음", "error"); return; }
    renderChart(ticker, data);
    const fis = computeFIS(data);
    renderFIS(fis, data);
  } catch(e) { toast("차트 로드 실패: " + e.message, "error"); }
}

function renderChart(ticker, data) {
  document.getElementById("chartPlaceholder").classList.add("hidden");
  const mainEl = document.getElementById("mainChart");
  const volEl  = document.getElementById("volChart");
  mainEl.classList.remove("hidden"); volEl.classList.remove("hidden");
  mainEl.innerHTML = ""; volEl.innerHTML = "";

  const { createChart } = LightweightCharts;
  const bg = "#F9F9F7", txt = "#111111";

  _chart = createChart(mainEl, {
    width: mainEl.clientWidth, height: 380,
    layout: { background: { color: bg }, textColor: txt },
    grid: { vertLines: { color: "#eee" }, horzLines: { color: "#eee" } },
    rightPriceScale: { borderColor: "#ddd" },
    timeScale: { borderColor: "#ddd", timeVisible: true },
  });
  const candleSeries = _chart.addCandlestickSeries({
    upColor: "#CC0000", downColor: "#0047AB",
    borderUpColor: "#CC0000", borderDownColor: "#0047AB",
    wickUpColor: "#CC0000", wickDownColor: "#0047AB",
  });
  candleSeries.setData(data.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })));

  const ichi = computeIchimoku(data);
  const tenEl = _chart.addLineSeries({ color: "#0047AB", lineWidth: 1, title: "전환선" });
  const kijEl = _chart.addLineSeries({ color: "#CC0000",  lineWidth: 1, title: "기준선" });
  tenEl.setData(ichi.tenkan.filter(d => d.value != null));
  kijEl.setData(ichi.kijun.filter(d => d.value != null));

  _volChart = createChart(volEl, {
    width: volEl.clientWidth, height: 100,
    layout: { background: { color: bg }, textColor: txt },
    grid: { vertLines: { color: "#eee" }, horzLines: { color: "#eee" } },
    rightPriceScale: { borderColor: "#ddd", scaleMargins: { top: 0, bottom: 0 } },
    timeScale: { borderColor: "#ddd", timeVisible: true },
  });
  const volSeries = _volChart.addHistogramSeries({ color: "#bbb", priceFormat: { type: "volume" } });
  volSeries.setData(data.map(d => ({ time: d.time, value: d.volume, color: d.close >= d.open ? "#CC0000" : "#0047AB" })));
  _chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    _volChart.timeScale().setVisibleLogicalRange(range);
  });

  const last = data[data.length - 1];
  document.getElementById("stockInfo").classList.remove("hidden");
  document.getElementById("stockName").textContent   = ticker;
  document.getElementById("stockTicker").textContent = ticker;
  document.getElementById("stockPrice").textContent  = fmt(last.close, 2);
  const chgEl = document.getElementById("stockChg");
  const chgPct = ((last.close - last.open) / last.open) * 100;
  chgEl.textContent = fmtPct(chgPct); chgEl.className = "s-chg " + bullOrBear(chgPct);
}

function renderFIS(fis, data) {
  const panel  = document.getElementById("fisPanel");
  const lbl    = fisLabel(fis.total);
  panel.classList.remove("hidden");
  document.getElementById("fpFisScore").textContent = fis.total.toFixed(1);
  document.getElementById("fpLabel").textContent    = lbl.label;
  document.getElementById("fpLabel").style.color    = lbl.color;

  const bars = [
    { label: "추세",   key: "trend",   max: 30 },
    { label: "모멘텀", key: "momentum",max: 25 },
    { label: "변동성", key: "vol",     max: 20 },
    { label: "볼륨",   key: "volume",  max: 15 },
    { label: "패턴",   key: "pattern", max: 10 },
  ];
  document.getElementById("fpBars").innerHTML = bars.map(b => {
    const v = fis[b.key] ?? 0, pct = Math.max(0, Math.min(100, (v / b.max) * 100));
    const dir = v >= 0 ? "bull" : "bear";
    return `<div class="fp-bar-row">
      <span class="fp-bar-label">${b.label}</span>
      <div class="fp-bar-track"><div class="fp-bar-fill ${dir}" style="width:${pct}%"></div></div>
      <span class="fp-bar-val ${dir}">${v.toFixed(1)}</span>
    </div>`;
  }).join("");

  const es = fis.entryScore ?? fis.total, el = fisLabel(es);
  document.getElementById("fpEntryScore").textContent   = es.toFixed(1);
  document.getElementById("fpEntryScore").style.color   = el.color;
  document.getElementById("fpEntryLabel-txt") && (document.getElementById("fpEntryLabel-txt").textContent = el.label);

  const last = data[data.length - 1];
  const ichi = computeIchimoku(data);
  const ten  = ichi.tenkan.findLast(d => d.value != null)?.value;
  const kij  = ichi.kijun.findLast(d => d.value != null)?.value;
  if (ten != null && kij != null) {
    document.getElementById("fpIchi").innerHTML =
      `<span>전환선 <strong>${fmt(ten,0)}</strong></span>
       <span>기준선 <strong>${fmt(kij,0)}</strong></span>
       <span class="${last.close > ten ? 'bull' : 'bear'}">전환선 ${last.close > ten ? "위" : "아래"}</span>`;
  }
}

window.addEventListener("resize", () => {
  if (_chart)    _chart.applyOptions({ width: document.getElementById("mainChart").clientWidth });
  if (_volChart) _volChart.applyOptions({ width: document.getElementById("volChart").clientWidth });
});

const url = new URLSearchParams(location.search);
if (url.get("t")) loadChart(url.get("t"));
