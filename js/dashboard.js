/* js/dashboard.js */

const KR_INDICES = [
  { ticker: "^KS11", name: "KOSPI" },
  { ticker: "^KQ11", name: "KOSDAQ" },
  { ticker: "KRW=X",  name: "원/달러" },
];
const US_INDICES = [
  { ticker: "^GSPC", name: "S&P 500" },
  { ticker: "^IXIC", name: "NASDAQ" },
  { ticker: "^DJI",  name: "DOW" },
  { ticker: "^VIX",  name: "VIX" },
  { ticker: "^TNX",  name: "미 10년물" },
  { ticker: "GC=F",  name: "금" },
];

let _high52Data = {}, _h52Market = "kospi";
const _h52State = { offset: 0, limit: 10, hasMore: false, loading: false, items: [] };

// ── 초기화 ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadMarket();
  loadPortfolioDash();
  setTimeout(() => load52h("kospi", document.querySelector(".h52-tab")), 600);
  setTimeout(() => loadMarketMap("KR"), 800);
  setTimeout(() => loadMarketMap("US"), 900);
});

// ── 시장 지수 ─────────────────────────────────────────
async function loadMarket() {
  try {
    const allTickers = [...KR_INDICES, ...US_INDICES].map(i => i.ticker);
    const quotes = await fetchMultiQuote(allTickers);

    renderQuotes("krQuotes", KR_INDICES, quotes, "krUpdated");
    renderQuotes("usQuotes", US_INDICES, quotes, "usUpdated");
    renderTickerStrip([...KR_INDICES, ...US_INDICES], quotes);
  } catch(e) { console.error("market load error", e); }
}

function renderTickerStrip(indices, quotes) {
  const track = document.getElementById("tickerTrack");
  if (!track) return;
  const html = indices.map(idx => {
    const q = quotes[idx.ticker] || {};
    const pct = q.changePct || 0;
    const cls = pct > 0 ? "bull" : pct < 0 ? "bear" : "flat";
    const sign = pct > 0 ? "+" : "";
    return `<div class="ticker-item">
      <span class="ti-name">${idx.name}</span>
      <span class="ti-price">${q.price != null ? fmt(q.price, 2) : "—"}</span>
      <span class="ti-chg ${cls}">${q.changePct != null ? sign + pct.toFixed(2) + "%" : "—"}</span>
    </div>`;
  }).join("");
  track.innerHTML = html + html;
}

function renderQuotes(containerId, indices, quotes, updatedId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const updEl = document.getElementById(updatedId);
  const now = new Date().toLocaleTimeString("ko-KR", {hour:"2-digit",minute:"2-digit"});
  if (updEl) updEl.textContent = now + " 기준";

  el.innerHTML = indices.map(idx => {
    const q   = quotes[idx.ticker] || {};
    const pct = q.changePct || 0;
    const cls = pct > 0 ? "bull" : pct < 0 ? "bear" : "flat";
    const sign = pct > 0 ? "+" : "";
    const abssign = (q.change || 0) > 0 ? "+" : "";
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
    const barW  = Math.min(Math.abs(pct) / 4 * 100, 100);
    return `
      <div class="mq-row" onclick="goAnalyze('${idx.ticker}')">
        <div class="mq-left">
          <span class="mq-name">${idx.name}</span>
          <span class="mq-arrow ${cls}">${arrow}</span>
        </div>
        <div class="mq-right">
          <div class="mq-price">${q.price != null ? fmt(q.price, 2) : "—"}</div>
          <div class="mq-chg-row">
            <span class="mq-pct ${cls}">${q.changePct != null ? sign + pct.toFixed(2) + "%" : "—"}</span>
            <span class="mq-abs ${cls}">${q.change != null ? abssign + fmt(q.change, 2) : ""}</span>
          </div>
          <div class="mq-bar-wrap"><div class="mq-bar ${cls}" style="width:${barW}%"></div></div>
        </div>
      </div>`;
  }).join("");
}

// ── 마켓맵 (정적 버전: 52주 신고가 종목 히트맵) ───────────
const _mapCache = {};
const _mapMode  = { KR: "sector", US: "sector" };

async function loadMarketMap(region) {
  const bodyId = region === "KR" ? "krMapBody" : "usMapBody";
  const body   = document.getElementById(bodyId);
  if (!body) return;

  if (_mapCache[region]) { _drawMap(region, body, _mapCache[region]); return; }
  body.innerHTML = '<div class="map-loading">히트맵 로딩 중…</div>';

  // 정적 앱: 52주 신고가 데이터로 간이 히트맵 생성
  const market = region === "KR" ? "kospi" : "us";
  try {
    const res = await fetch(`data/high52_${market}.json`);
    if (!res.ok) throw new Error("no data");
    const stocks = await res.json();
    const data = stocks.slice(0, 50).map(s => ({
      name: s.name || s.ticker,
      ticker: s.ticker,
      sector: s.sector || "기타",
      pct: s.chg || 0,
      value: 1,
    }));
    _mapCache[region] = data;
    _drawMap(region, body, data);
  } catch(e) {
    body.innerHTML = '<div class="map-loading" style="color:var(--neutral-500);font-size:0.8rem">히트맵: 데이터 없음<br>GitHub Actions 실행 후 이용 가능</div>';
  }
}

function _drawMap(region, body, data) {
  body.innerHTML = "";
  const canvas = document.createElement("div");
  canvas.className = "hm-canvas";
  body.appendChild(canvas);
  if (typeof renderTreemap === "function") {
    renderTreemap(canvas, data, "stock");
  }
}

// ── 52주 신고가 ───────────────────────────────────────
function _update52hMoreButton() {
  const wrap = document.getElementById("high52MoreWrap");
  const btn  = document.getElementById("high52MoreBtn");
  if (!wrap || !btn) return;
  if (_h52State.hasMore) {
    wrap.style.display = "flex";
    btn.disabled = false;
    btn.textContent = "자세히 보기";
  } else {
    wrap.style.display = "none";
  }
}

async function load52h(market, btn) {
  document.querySelectorAll(".h52-tab").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  _h52Market = market;
  _h52State.offset = 0;
  _h52State.items = [];
  _h52State.hasMore = false;
  const grid = document.getElementById("high52Grid");
  grid.innerHTML = '<div class="high52-loading">조회 중…</div>';
  _update52hMoreButton();
  try {
    if (!_high52Data[market]) {
      const res = await fetch(`data/high52_${market}.json`);
      _high52Data[market] = res.ok ? await res.json() : [];
    }
    const all = _high52Data[market] || [];
    const limit = _h52State.limit;
    _h52State.items = all.slice(0, limit);
    _h52State.offset = limit;
    _h52State.hasMore = all.length > limit;
    if (!_h52State.items.length) {
      grid.innerHTML = '<div class="high52-empty">해당 시장에서 52주 신고가 종목이 없습니다.</div>';
    } else {
      render52hGrid(grid, _h52State.items);
    }
    _update52hMoreButton();
  } catch(e) {
    grid.innerHTML = '<div class="high52-empty">오류가 발생했습니다.</div>';
    _update52hMoreButton();
  }
}

async function loadMore52h() {
  if (_h52State.loading || !_h52State.hasMore) return;
  _h52State.loading = true;
  const btn = document.getElementById("high52MoreBtn");
  if (btn) { btn.disabled = true; btn.textContent = "불러오는 중..."; }
  try {
    const all = _high52Data[_h52Market] || [];
    const end = _h52State.offset + _h52State.limit;
    _h52State.items = all.slice(0, end);
    _h52State.offset = end;
    _h52State.hasMore = all.length > end;
    render52hGrid(document.getElementById("high52Grid"), _h52State.items);
  } finally {
    _h52State.loading = false;
    _update52hMoreButton();
  }
}

function render52hGrid(grid, stocks) {
  grid.innerHTML = stocks.map(s => {
    const dayCls  = (s.chg || 0) >= 0 ? "bull" : "bear";
    const daySign = (s.chg || 0) >= 0 ? "+" : "";
    const gap     = s.gap_pct ?? (s.high52 && s.close ? ((s.close - s.high52) / s.high52 * 100) : 0);
    const gapCls  = gap >= 0 ? "bull" : "bear";
    const gapSign = gap >= 0 ? "+" : "";
    const streak  = s.streak || 0;
    const strColor = streak >= 8 ? "#F59E0B" : streak >= 4 ? "#818CF8" : "#22D3EE";
    const price = s.close || s.price || 0;
    const high52 = s.high52 || s.high || 0;
    return `
      <div class="h52-card" onclick="goAnalyze('${s.ticker}')" role="button" tabindex="0">
        <div class="h52-top">
          <div>
            <div class="h52-name">${s.name}</div>
            <div class="h52-ticker">${s.ticker}</div>
          </div>
          ${streak > 0 ? `<div class="h52-streak" style="background:${strColor}22;color:${strColor};border-color:${strColor}55">${streak}주 연속</div>` : ""}
        </div>
        <div class="h52-price">${fmt(price, 0)}</div>
        <div class="h52-meta">
          <div class="h52-meta-item">
            <span class="h52-meta-label">52주 고점</span>
            <span class="h52-meta-val">${fmt(high52, 0)}</span>
          </div>
          <div class="h52-meta-item">
            <span class="h52-meta-label">고점 대비</span>
            <span class="h52-meta-val ${gapCls}">${gapSign}${gap.toFixed(1)}%</span>
          </div>
          <div class="h52-meta-item">
            <span class="h52-meta-label">당일 등락</span>
            <span class="h52-meta-val ${dayCls}">${daySign}${(s.chg || 0).toFixed(2)}%</span>
          </div>
        </div>
      </div>`;
  }).join("");
}

// ── 포트폴리오 (localStorage) ───────────────────────────
async function loadPortfolioDash() {
  const wrap = document.getElementById("portfolioWrap");
  if (!wrap) return;
  const portfolio = portfolioLoad();
  const positions = Object.values(portfolio);
  if (!positions.length) {
    renderEmptyPortfolio(wrap);
    return;
  }
  // 현재가 조회
  try {
    const tickers = positions.map(p => p.ticker);
    const quotes  = await fetchMultiQuote(tickers);
    let totalCost = 0, totalValue = 0;
    const rows = positions.map(p => {
      const q = quotes[p.ticker] || {};
      const cur = q.price || p.cost;
      const value  = cur * p.qty;
      const cost   = p.cost * p.qty;
      const profit = value - cost;
      const pct    = cost > 0 ? (profit / cost * 100) : 0;
      totalCost  += cost;
      totalValue += value;
      const pCls  = profit >= 0 ? "pt-bull" : "pt-bear";
      const sign  = profit >= 0 ? "+" : "";
      const dPct  = q.changePct || 0;
      const dSign = dPct >= 0 ? "+" : "";
      return `<tr>
        <td><div class="pt-name">${p.name}</div><div class="pt-ticker">${p.ticker}</div></td>
        <td>${p.qty.toLocaleString("ko-KR")}</td>
        <td>${fmt(p.cost, 0)}</td>
        <td><div>${fmt(cur, 0)}</div><div style="font-size:11px;color:${dPct>=0?"var(--bull)":"var(--bear)"}">${dSign}${dPct.toFixed(2)}%</div></td>
        <td>${fmt(value, 0)}</td>
        <td class="${pCls}">${sign}${fmt(profit, 0)}</td>
        <td class="${pCls}">${sign}${pct.toFixed(2)}%</td>
        <td><div class="pt-actions">
          <button class="pt-btn pt-btn-analyze" onclick="goAnalyze('${p.ticker}')">분석</button>
          <button class="pt-btn pt-btn-buy"     onclick="openDashTradeModal('buy','${p.ticker}','${p.name}',${cur},${p.qty})">추가매수</button>
          <button class="pt-btn pt-btn-sell"    onclick="openDashTradeModal('sell','${p.ticker}','${p.name}',${cur},${p.qty})">매도</button>
        </div></td>
      </tr>`;
    }).join("");
    const totalProfit = totalValue - totalCost;
    const totalPct    = totalCost > 0 ? (totalProfit / totalCost * 100) : 0;
    const totCls      = totalProfit >= 0 ? "bull" : "bear";
    wrap.innerHTML = `
      <div class="portfolio-wrap">
        <div class="portfolio-summary">
          <div class="ps-item"><div class="ps-label">총 투자금액</div><div class="ps-value">${fmt(totalCost,0)}</div></div>
          <div class="ps-item"><div class="ps-label">총 평가금액</div><div class="ps-value">${fmt(totalValue,0)}</div></div>
          <div class="ps-item"><div class="ps-label">총 손익</div><div class="ps-value ${totCls}">${totalProfit>=0?"+":""}${fmt(totalProfit,0)}</div></div>
          <div class="ps-item"><div class="ps-label">수익률</div><div class="ps-value ${totCls}">${totalProfit>=0?"+":""}${totalPct.toFixed(2)}%</div></div>
        </div>
        <div class="ptable-wrap">
          <table class="portfolio-table">
            <thead><tr>
              <th style="text-align:left">종목</th><th>수량</th><th>평단가</th>
              <th>현재가</th><th>평가금액</th><th>손익</th><th>수익률</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  } catch(e) { renderEmptyPortfolio(wrap); }
}

function renderEmptyPortfolio(wrap) {
  wrap.innerHTML = `
    <div class="portfolio-wrap">
      <div class="empty-portfolio">
        <div class="ep-icon">📭</div>
        <div class="ep-title">보유 종목이 없습니다</div>
        <div class="ep-sub">신규 진입 종목 찾기에서 종목을 추가해보세요</div>
        <a href="scan.html" class="ep-scan-btn">신규 진입 종목 찾기 →</a>
      </div>
    </div>`;
}

// ── 대시보드 트레이드 모달 ─────────────────────────────
let _dashTrade = { type: "buy", ticker: "", name: "", currentPrice: 0, maxQty: 0 };

function openDashTradeModal(type, ticker, name, currentPrice, maxQty) {
  _dashTrade = { type, ticker, name, currentPrice: Number(currentPrice||0), maxQty: Number(maxQty||0) };
  const modal    = document.getElementById("dashTradeModal");
  const title    = document.getElementById("dashTradeTitle");
  const sub      = document.getElementById("dashTradeSub");
  const qty      = document.getElementById("dashTradeQty");
  const priceRow = document.getElementById("dashTradePriceRow");
  const price    = document.getElementById("dashTradePrice");
  const helper   = document.getElementById("dashTradeHelper");
  const confirm  = document.getElementById("dashTradeConfirm");
  if (!modal) return;
  const isBuy = type === "buy";
  title.textContent   = isBuy ? "추가 매수" : "매도";
  sub.textContent     = `${name} (${ticker})`;
  qty.value           = "1";
  price.value         = String(Math.round(_dashTrade.currentPrice));
  priceRow.style.display = isBuy ? "grid" : "none";
  helper.textContent  = isBuy
    ? `현재가: ${Math.round(_dashTrade.currentPrice).toLocaleString("ko-KR")}원`
    : `보유 수량: ${_dashTrade.maxQty}주`;
  confirm.textContent = isBuy ? "매수 등록" : "매도 실행";
  modal.style.display = "flex";
  qty.focus();
}

function closeDashTradeModal() {
  const modal = document.getElementById("dashTradeModal");
  if (modal) modal.style.display = "none";
}

function confirmDashTrade() {
  const qty = parseInt(document.getElementById("dashTradeQty")?.value || "0", 10);
  if (!qty || qty < 1) { showToast("유효한 수량을 입력하세요.", "error"); return; }
  const isBuy = _dashTrade.type === "buy";
  if (!isBuy && qty > _dashTrade.maxQty) { showToast("보유 수량보다 많은 매도는 불가합니다.", "error"); return; }
  if (isBuy) {
    const price = parseFloat(document.getElementById("dashTradePrice")?.value || "0");
    if (!price || price <= 0) { showToast("유효한 매수가를 입력하세요.", "error"); return; }
    portfolioBuy(_dashTrade.ticker, _dashTrade.name, qty, price);
    showToast(`${_dashTrade.name} ${qty}주 추가매수 완료`);
  } else {
    portfolioSell(_dashTrade.ticker, qty);
    showToast(`${_dashTrade.name} ${qty}주 매도 완료`);
  }
  closeDashTradeModal();
  loadPortfolioDash();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("dashTradeModal")?.addEventListener("click", e => {
    if (e.target?.id === "dashTradeModal") closeDashTradeModal();
  });
});
