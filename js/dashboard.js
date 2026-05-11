import { requireAuth, updateUserUI } from "./auth.js";
import { fetchMultiQuote }           from "./yahoo.js";
import { fmt, fmtPct, startClock, markActiveNav, setTickerItems, initSearch, bullOrBear } from "./common.js";

const user = requireAuth(); if (!user) throw 0;
updateUserUI();
startClock();
markActiveNav();
initSearch(ticker => { window.location.href = `analyze.html?t=${ticker}`; });
Promise.all([loadKrMarket(), loadUsMarket()]);

const KR_INDICES = [
  { ticker: "^KS11", name: "KOSPI" },
  { ticker: "^KQ11", name: "KOSDAQ" },
  { ticker: "KRW=X",  name: "원/달러" },
];
let _high52Data = {}, _h52Market = "kospi", _h52Shown = 0;
const PAGE = 20;

async function loadKrMarket() {
  const quotes = await fetchMultiQuote(KR_INDICES.map(i => i.ticker));
  document.getElementById("krQuotes").innerHTML = KR_INDICES.map(idx => {
    const q = quotes[idx.ticker] || {}, dir = bullOrBear(q.changePct || 0);
    return `<div class="mq-card">
      <div><div class="mq-name">${idx.name}</div></div>
      <div><div class="mq-price ${dir}">${fmt(q.price,2)}</div>
           <div class="mq-chg ${dir}">${fmtPct(q.changePct)}</div></div>
    </div>`;
  }).join("");
  setTickerItems(KR_INDICES.map(idx => {
    const q = quotes[idx.ticker] || {}, dir = bullOrBear(q.changePct || 0);
    return { name: idx.name, price: fmt(q.price,0), pct: fmtPct(q.changePct), dir };
  }));
  await load52h("kospi", document.querySelector(".mtab.active"));
  document.getElementById("krUpdated").textContent =
    "업데이트: " + new Date().toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit" });
}

window.load52h = async function(market, btn) {
  _h52Market = market; _h52Shown = 0;
  document.querySelectorAll(".mtab").forEach(b => b.classList.toggle("active", b === btn));
  const grid = document.getElementById("high52Grid");
  grid.innerHTML = '<div class="h52-skeleton"></div>';
  try {
    if (!_high52Data[market]) {
      const res = await fetch(`data/high52_${market}.json`);
      _high52Data[market] = res.ok ? await res.json() : [];
    }
    render52h();
  } catch { grid.innerHTML = '<p style="color:#999;font-size:.83rem;padding:8px">데이터 없음</p>'; }
};
window.loadMore52h = function() { render52h(); };

function render52h() {
  const data = _high52Data[_h52Market] || [];
  const end  = _h52Shown + PAGE;
  document.getElementById("high52Grid").innerHTML = data.slice(0, end).map(s => {
    const dir = bullOrBear(s.chg || 0);
    return `<div class="h52-card" onclick="window.location.href='analyze.html?t=${s.ticker}'">
      <div class="h52-name" title="${s.name}">${s.name}</div>
      <div class="h52-ticker">${s.ticker}</div>
      <div class="h52-price ${dir}">${fmt(s.price,0)}</div>
      <div class="h52-fis ${(s.fis??0)>=0?'bull':'bear'}">FIS ${s.fis?.toFixed(1)??"—"}</div>
    </div>`;
  }).join("");
  const mw = document.getElementById("high52MoreWrap");
  if (end < data.length) { mw.classList.remove("hidden"); _h52Shown = end; }
  else { mw.classList.add("hidden"); _h52Shown = end; }
}

const US_INDICES = [
  { ticker: "^GSPC", name: "S&P 500" }, { ticker: "^IXIC", name: "NASDAQ" },
  { ticker: "^DJI",  name: "DOW" },     { ticker: "^VIX",  name: "VIX" },
];
let _usHigh52Data = [], _usH52Shown = 0;

async function loadUsMarket() {
  const quotes = await fetchMultiQuote(US_INDICES.map(i => i.ticker));
  document.getElementById("usQuotes").innerHTML = US_INDICES.map(idx => {
    const q = quotes[idx.ticker] || {}, dir = bullOrBear(q.changePct || 0);
    return `<div class="mq-card">
      <div><div class="mq-name">${idx.name}</div></div>
      <div><div class="mq-price ${dir}">${idx.ticker==="^VIX"?(+q.price).toFixed(2):fmt(q.price,2)}</div>
           <div class="mq-chg ${dir}">${fmtPct(q.changePct)}</div></div>
    </div>`;
  }).join("");
  try {
    const res = await fetch("data/high52_us.json");
    _usHigh52Data = res.ok ? await res.json() : [];
    renderUs52h();
  } catch { document.getElementById("usHigh52Grid").innerHTML = '<p style="color:#999;font-size:.83rem;padding:8px">데이터 없음</p>'; }
  document.getElementById("usUpdated").textContent =
    "업데이트: " + new Date().toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit" });
}
window.loadMoreUs52h = function() { renderUs52h(); };

function renderUs52h() {
  const end = _usH52Shown + PAGE;
  document.getElementById("usHigh52Grid").innerHTML = _usHigh52Data.slice(0, end).map(s => {
    const dir = bullOrBear(s.chg || 0);
    return `<div class="h52-card" onclick="window.location.href='analyze.html?t=${s.ticker}'">
      <div class="h52-name" title="${s.name}">${s.name}</div>
      <div class="h52-ticker">${s.ticker}</div>
      <div class="h52-price ${dir}">$${(+s.price).toFixed(2)}</div>
      <div class="h52-fis ${(s.fis??0)>=0?'bull':'bear'}">FIS ${s.fis?.toFixed(1)??"—"}</div>
    </div>`;
  }).join("");
  const mw = document.getElementById("usHigh52MoreWrap");
  if (end < _usHigh52Data.length) { mw.classList.remove("hidden"); _usH52Shown = end; }
  else { mw.classList.add("hidden"); _usH52Shown = end; }
}
