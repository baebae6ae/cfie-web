import { requireAuth, updateUserUI, logout }    from "./auth.js";
import { loadPortfolio, savePortfolio }         from "./gist-store.js";
import { fetchMultiQuote }                      from "./yahoo.js";
import { computeFIS }                           from "./indicators.js";
import { fetchOHLCV }                           from "./yahoo.js";
import { fmt, fmtPct, startClock, markActiveNav, initSearch, toast, bullOrBear } from "./common.js";

const user = requireAuth(); if (!user) throw 0;
updateUserUI(); startClock(); markActiveNav();
initSearch(ticker => { window.location.href = `analyze.html?t=${ticker}`; });

document.getElementById("logoutBtn")?.addEventListener("click", logout);

let portfolio = {};  // { ticker: { name, qty, avgPrice, memo } }
let _editTicker = null;

async function init() {
  try {
    portfolio = await loadPortfolio();
    await renderPortfolio();
  } catch(e) {
    toast("포트폴리오 로드 실패: " + e.message, "error");
  }
}
init();

async function renderPortfolio() {
  const wrapEl = document.getElementById("portfolioTable");
  const tickers = Object.keys(portfolio);
  if (!tickers.length) {
    wrapEl.innerHTML = '<p class="pt-placeholder">포트폴리오가 비어있습니다. 종목을 추가해보세요.</p>';
    document.getElementById("portfolioSummary").classList.add("hidden");
    return;
  }
  wrapEl.innerHTML = '<p class="pt-placeholder">시세 조회 중…</p>';

  const quotes = await fetchMultiQuote(tickers).catch(() => ({}));
  let totalVal = 0, totalCost = 0, fisSum = 0, count = 0;
  const rows = [];
  for (const [ticker, pos] of Object.entries(portfolio)) {
    const q = quotes[ticker] || {};
    const price = q.price || pos.avgPrice || 0;
    const val   = price * pos.qty;
    const cost  = pos.avgPrice * pos.qty;
    const pnl   = pos.avgPrice ? ((price - pos.avgPrice) / pos.avgPrice) * 100 : 0;
    totalVal  += val; totalCost += cost;
    let fis = null;
    try { const d = await fetchOHLCV(ticker, "1d"); fis = computeFIS(d).total; fisSum += fis; count++; } catch {}
    const dir = bullOrBear(pnl);
    rows.push(`<div class="pt-row">
      <div class="pt-name" onclick="window.location.href='analyze.html?t=${ticker}'">${pos.name || ticker}</div>
      <div class="pt-ticker">${ticker}</div>
      <div class="pt-qty">${pos.qty.toLocaleString()}</div>
      <div class="pt-avg">${fmt(pos.avgPrice,0)}</div>
      <div class="pt-price ${bullOrBear(q.changePct||0)}">${fmt(price,0)}</div>
      <div class="pt-pnl ${dir}">${pnl.toFixed(2)}%</div>
      <div class="pt-val">${fmt(val,0)}</div>
      <div class="pt-fis">${fis != null ? fis.toFixed(1) : "—"}</div>
      <div class="pt-memo">${pos.memo || ""}</div>
      <div class="pt-actions">
        <button class="pt-edit-btn" onclick="openEditModal('${ticker}')">편집</button>
        <button class="pt-del-btn"  onclick="deletePos('${ticker}')">삭제</button>
      </div>
    </div>`);
  }
  wrapEl.innerHTML = `
    <div class="pt-row pt-header">
      <div>종목명</div><div>티커</div><div>수량</div><div>평균단가</div>
      <div>현재가</div><div>수익률</div><div>평가금액</div><div>FIS</div>
      <div>메모</div><div></div>
    </div>${rows.join("")}`;

  const totPnl = totalCost ? ((totalVal - totalCost) / totalCost) * 100 : 0;
  document.getElementById("psTotalVal").textContent  = fmt(totalVal, 0) + "원";
  document.getElementById("psTotalPnl").textContent  = totPnl.toFixed(2) + "%";
  document.getElementById("psTotalPnl").className    = "ps-val " + bullOrBear(totPnl);
  document.getElementById("psAvgFis").textContent    = count ? (fisSum / count).toFixed(1) : "—";
  document.getElementById("portfolioSummary").classList.remove("hidden");
}

window.openAddModal = function() {
  _editTicker = null;
  document.getElementById("modalTitle").textContent = "종목 추가";
  ["mTicker","mQty","mAvgPrice","mMemo","modalSearchInput"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  document.getElementById("addModal").classList.remove("hidden");
  document.getElementById("modalOverlay").classList.remove("hidden");
};
window.openEditModal = function(ticker) {
  _editTicker = ticker;
  const pos = portfolio[ticker];
  document.getElementById("modalTitle").textContent      = "종목 편집";
  document.getElementById("modalSearchInput").value      = pos.name || ticker;
  document.getElementById("mTicker").value               = ticker;
  document.getElementById("mQty").value                  = pos.qty;
  document.getElementById("mAvgPrice").value             = pos.avgPrice;
  document.getElementById("mMemo").value                 = pos.memo || "";
  document.getElementById("addModal").classList.remove("hidden");
  document.getElementById("modalOverlay").classList.remove("hidden");
};
window.closeModal = function() {
  document.getElementById("addModal").classList.add("hidden");
  document.getElementById("modalOverlay").classList.add("hidden");
};

initSearch(ticker => {
  document.getElementById("mTicker").value = ticker;
  document.getElementById("modalSearchInput").value = ticker;
}, "modalSearchInput", "modalSearchDrop");

window.savePosition = async function() {
  const ticker   = document.getElementById("mTicker").value.trim().toUpperCase();
  const qty      = parseFloat(document.getElementById("mQty").value) || 0;
  const avgPrice = parseFloat(document.getElementById("mAvgPrice").value) || 0;
  const memo     = document.getElementById("mMemo").value.trim();
  if (!ticker) { toast("티커를 입력해주세요", "error"); return; }
  portfolio[ticker] = { name: ticker, qty, avgPrice, memo };
  try {
    await savePortfolio(portfolio);
    toast("저장 완료", "ok");
    closeModal();
    await renderPortfolio();
  } catch(e) { toast("저장 실패: " + e.message, "error"); }
};

window.deletePos = async function(ticker) {
  if (!confirm(`${ticker}을(를) 포트폴리오에서 삭제할까요?`)) return;
  delete portfolio[ticker];
  try {
    await savePortfolio(portfolio);
    await renderPortfolio();
  } catch(e) { toast("삭제 실패: " + e.message, "error"); }
};
