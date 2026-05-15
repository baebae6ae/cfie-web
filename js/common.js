/* js/common.js */

// ── 시계 ──────────────────────────────────────────
function updateClock() {
  const el = document.getElementById("clockText");
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString("ko-KR",
    {hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false});
}
setInterval(updateClock, 1000);
updateClock();

// ── 내비 활성 표시 ─────────────────────────────────
(function markActiveNav() {
  const file = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-link").forEach(a => {
    const href = (a.getAttribute("href") || "").split("/").pop() || "index.html";
    if (href === file) a.classList.add("active");
  });
  document.querySelectorAll(".mn-item").forEach(a => {
    const href = (a.getAttribute("href") || "").split("/").pop() || "index.html";
    if (href === file) a.classList.add("active");
  });
})();

// ── 숫자 포맷 ──────────────────────────────────────
function fmt(v, digits) {
  if (digits === undefined) digits = 2;
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}
function fmtVol(v) {
  if (!v) return "—";
  if (v >= 1e12) return (v / 1e12).toFixed(1) + "조";
  if (v >= 1e8)  return (v / 1e8).toFixed(0)  + "억";
  if (v >= 1e4)  return (v / 1e4).toFixed(0)  + "만";
  return v.toLocaleString("ko-KR");
}
function fmtPct(v) {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%";
}

// ── FIS 색상 / 레이블 ────────────────────────────────
function fisColor(fis) {
  if (fis >= 70)  return "#D32F2F";
  if (fis >= 40)  return "#E57373";
  if (fis >= 10)  return "#F9A825";
  if (fis >= -20) return "#64B5F6";
  if (fis >= -50) return "#1565C0";
  return "#0D47A1";
}
function fisLabelText(fis) {
  if (fis >= 70)  return "강한 상승형";
  if (fis >= 40)  return "우호적 추세형";
  if (fis >= 10)  return "중립 관망형";
  if (fis >= -20) return "약세 주의형";
  if (fis >= -50) return "하락 압력형";
  return "강한 하락형";
}

// ── RSI / RVOL 상태 텍스트 ──────────────────────────────
function rsiStatus(rsi) {
  if (rsi >= 70) return "과매수";
  if (rsi >= 60) return "상승 강세";
  if (rsi >= 40) return "중립";
  if (rsi >= 30) return "하락 약세";
  return "과매도";
}
function rsiColor(rsi) {
  if (rsi >= 70) return "var(--bear)";
  if (rsi >= 60) return "var(--bull)";
  if (rsi <= 30) return "var(--bull)";
  return "var(--text2)";
}
function rvolStatus(rvol) {
  if (rvol >= 2.0) return "폭발적 거래량";
  if (rvol >= 1.5) return "강한 거래량";
  if (rvol >= 0.8) return "보통";
  return "거래 부진";
}

// ── 종목 분석 이동 ────────────────────────────────────
function goAnalyze(ticker) {
  window.location.href = "analyze.html?t=" + encodeURIComponent(ticker);
}
function looksLikeTicker(query) {
  return /^[A-Za-z0-9.^=\-]+$/.test((query || "").trim());
}

// ── 검색 ──────────────────────────────────────────────
let _searchTimer = null;
const _searchInput    = () => document.getElementById("searchInput");
const _searchDropdown = () => document.getElementById("searchDropdown");

document.addEventListener("DOMContentLoaded", () => {
  const inp = _searchInput();
  if (!inp) return;
  inp.addEventListener("input", () => {
    clearTimeout(_searchTimer);
    const q = inp.value.trim();
    if (!q) { closeDropdown(); return; }
    _searchTimer = setTimeout(() => _execSearch(q), 350);
  });
  inp.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
  document.addEventListener("click", e => {
    if (!e.target.closest(".topbar-search")) closeDropdown();
  });
});

function isKorean(q) { return /[가-힣]/.test(q); }

async function _execSearch(q) {
  const dd = _searchDropdown();
  if (!dd) return;
  try {
    let results;
    if (isKorean(q)) {
      results = typeof searchKRX === "function" ? searchKRX(q) : [];
    } else {
      results = await searchTicker(q);
    }
    if (!results.length) { closeDropdown(); return; }
    dd.innerHTML = results.slice(0, 7).map(r =>
      `<div class="dd-item" onclick="goAnalyze('${r.ticker}')">
        <div><div class="dd-name">${r.name || r.ticker}</div>
        <div class="dd-sym">${r.ticker}</div></div>
      </div>`
    ).join("");
    dd.classList.remove("hidden");
  } catch (e) { closeDropdown(); }
}

async function doSearch() {
  const v = _searchInput()?.value.trim();
  if (!v) return;
  if (looksLikeTicker(v)) { goAnalyze(v.toUpperCase()); return; }
  if (isKorean(v)) {
    const krxResults = typeof searchKRX === "function" ? searchKRX(v) : [];
    if (krxResults.length) { goAnalyze(krxResults[0].ticker); return; }
    return;
  }
  try {
    const results = await searchTicker(v);
    const first = results?.[0];
    if (first?.ticker) { goAnalyze(first.ticker); return; }
  } catch (e) {}
  goAnalyze(v.toUpperCase());
}

function closeDropdown() {
  _searchDropdown()?.classList.add("hidden");
}

// ── 토스트 ────────────────────────────────────────────
function showToast(msg, type) {
  type = type || "success";
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  setTimeout(() => el.classList.remove("show"), 3200);
}

// ── localStorage 포트폴리오 헬퍼 ───────────────────────
function portfolioLoad() {
  try { return JSON.parse(localStorage.getItem("cfie_portfolio") || "{}"); } catch { return {}; }
}
function portfolioSave(data) {
  localStorage.setItem("cfie_portfolio", JSON.stringify(data));
}
function portfolioBuy(ticker, name, qty, price) {
  const p = portfolioLoad();
  if (!p[ticker]) p[ticker] = { name, ticker, qty: 0, cost: 0 };
  p[ticker].cost = (p[ticker].cost * p[ticker].qty + price * qty) / (p[ticker].qty + qty);
  p[ticker].qty += qty;
  p[ticker].name = name;
  portfolioSave(p);
}
function portfolioSell(ticker, qty) {
  const p = portfolioLoad();
  if (!p[ticker]) return;
  p[ticker].qty -= qty;
  if (p[ticker].qty <= 0) delete p[ticker];
  portfolioSave(p);
}
