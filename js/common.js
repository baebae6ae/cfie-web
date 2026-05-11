// ── 공통 유틸리티 ────────────────────────────────────

export const fmt = (v, d=2) => v == null || isNaN(v) ? "—" :
  Number(v).toLocaleString("ko-KR", { minimumFractionDigits:0, maximumFractionDigits:d });

export const fmtPct = v => v == null ? "—" : (v >= 0 ? "+" : "") + (+v).toFixed(2) + "%";

export const fmtVol = v => {
  if (!v) return "—";
  if (v >= 1e12) return (v/1e12).toFixed(1) + "조";
  if (v >= 1e8)  return (v/1e8).toFixed(0) + "억";
  if (v >= 1e4)  return (v/1e4).toFixed(0) + "만";
  return v.toLocaleString("ko-KR");
};

export const fmtPrice = (v, currency="KRW") => {
  if (v == null) return "—";
  return currency === "USD" ? "$" + (+v).toFixed(2) : fmt(v, 0) + "원";
};

// ── 시계 ────────────────────────────────────────────
export function startClock() {
  const el = document.getElementById("clockText");
  if (!el) return;
  const tick = () => el.textContent = new Date().toLocaleTimeString("ko-KR",
    { hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false });
  tick(); setInterval(tick, 1000);
}

// ── 내비 활성 ────────────────────────────────────────
export function markActiveNav() {
  const path = location.pathname.split("?")[0].replace(/\/$/, "").split("/").pop() || "dashboard.html";
  document.querySelectorAll(".nav-link").forEach(a => {
    const href = (a.getAttribute("href") || "").split("/").pop();
    if (href === path) a.classList.add("active");
  });
}

// ── 티커 스트립 ─────────────────────────────────────
let _tickerItems = [];
export function setTickerItems(items) {
  _tickerItems = items;
  const track = document.getElementById("tickerTrack");
  if (!track) return;
  const html = items.map(it => `
    <div class="ticker-item">
      <span class="ti-name">${it.name}</span>
      <span class="ti-price ${it.dir}">${it.price}</span>
      <span class="ti-pct ${it.dir}">${it.pct}</span>
    </div>`).join("");
  track.innerHTML = html + html; // duplicate for seamless loop
}

// ── 검색 드롭다운 ────────────────────────────────────
let _searchCallback = null;
export function initSearch(onSelect) {
  _searchCallback = onSelect;
  const input = document.getElementById("searchInput");
  const drop  = document.getElementById("searchDropdown");
  if (!input || !drop) return;
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { drop.classList.add("hidden"); return; }
    timer = setTimeout(() => _doSearch(q, drop), 300);
  });
  document.addEventListener("click", e => {
    if (!input.contains(e.target) && !drop.contains(e.target)) drop.classList.add("hidden");
  });
}

async function _doSearch(q, drop) {
  const { searchTicker } = await import("./yahoo.js");
  const results = await searchTicker(q);
  if (!results.length) { drop.classList.add("hidden"); return; }
  drop.innerHTML = results.map(r => `
    <div class="sdrop-item" data-ticker="${r.ticker}" data-name="${r.name}">
      <span class="sdrop-ticker">${r.ticker}</span>
      <span class="sdrop-name">${r.name}</span>
    </div>`).join("");
  drop.classList.remove("hidden");
  drop.querySelectorAll(".sdrop-item").forEach(el => {
    el.addEventListener("click", () => {
      drop.classList.add("hidden");
      document.getElementById("searchInput").value = "";
      if (_searchCallback) _searchCallback(el.dataset.ticker, el.dataset.name);
    });
  });
}

// ── 토스트 알림 ──────────────────────────────────────
export function toast(msg, type = "info") {
  let el = document.getElementById("toastEl");
  if (!el) {
    el = document.createElement("div");
    el.id = "toastEl";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  setTimeout(() => el.classList.remove("show"), 3000);
}

// ── 색상 헬퍼 ────────────────────────────────────────
export const bullOrBear = v => v > 0 ? "bull" : v < 0 ? "bear" : "neutral";
