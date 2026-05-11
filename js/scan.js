import { fisLabel }  from "./indicators.js";
import { fmt, fmtPct, startClock, markActiveNav, initSearch, toast, bullOrBear } from "./common.js";

startClock(); markActiveNav();
initSearch(ticker => { window.location.href = `analyze.html?t=${ticker}`; });

let _market = "kospi", _type = "fis", _results = [], _shown = 0;
const PAGE = 30;

window.setMarket   = (m, btn) => { _market = m; document.querySelectorAll(".stab").forEach(b => b.classList.toggle("active", b === btn)); };
window.setScanType = (t, btn) => { _type   = t; document.querySelectorAll(".styp").forEach(b => b.classList.toggle("active", b === btn)); };

window.doScan = async function() {
  const statusEl  = document.getElementById("scanStatus");
  const resultsEl = document.getElementById("scanResults");
  const moreWrap  = document.getElementById("scanMoreWrap");
  _results = []; _shown = 0;
  resultsEl.innerHTML = ""; moreWrap.classList.add("hidden");
  statusEl.textContent = "데이터 로딩 중…";
  try {
    const res = await fetch(`data/scan_${_type}_${_market}.json`);
    if (!res.ok) throw new Error("데이터 파일 없음 — GitHub Actions 실행 후 가능합니다");
    _results = await res.json();
    statusEl.textContent = `총 ${_results.length}개 종목`;
    renderScanRows();
  } catch(e) { statusEl.textContent = "⚠ " + e.message; toast(e.message, "error"); }
};
window.loadMoreScan = function() { renderScanRows(); };

function renderScanRows() {
  const el = document.getElementById("scanResults");
  const mw = document.getElementById("scanMoreWrap");
  if (!_shown) {
    el.innerHTML = `<div class="scan-row scan-row-header">
      <div>순위</div><div>종목</div><div>티커</div><div>현재가</div><div>등락률</div><div>FIS</div><div>진입점수</div>
    </div>`;
  }
  const end = _shown + PAGE;
  _results.slice(_shown, end).forEach((s, i) => {
    const lbl = fisLabel(s.fis), dir = bullOrBear(s.chg || 0);
    const row = document.createElement("div");
    row.className = "scan-row";
    row.innerHTML = `
      <div class="sr-rank">${_shown + i + 1}</div>
      <div><div class="sr-name" onclick="window.location.href='analyze.html?t=${s.ticker}'">${s.name}</div></div>
      <div class="sr-ticker">${s.ticker}</div>
      <div class="sr-price ${dir}">${fmt(s.price,0)}</div>
      <div class="sr-chg ${dir}">${fmtPct(s.chg)}</div>
      <div class="sr-fis" style="color:${lbl.color}">${s.fis?.toFixed(1)??"—"}</div>
      <div class="sr-entry" style="color:${s.entryColor||'#666'}">${s.entryScore??"—"}</div>`;
    el.appendChild(row);
  });
  _shown = end;
  if (_shown < _results.length) mw.classList.remove("hidden");
  else mw.classList.add("hidden");
}
