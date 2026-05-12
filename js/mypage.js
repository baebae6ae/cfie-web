/* js/mypage.js */

let _mpTicker = "", _mpName = "", _mpQty = 0;

async function loadMyPage() {
  const portfolio  = portfolioLoad();
  const positions  = Object.values(portfolio);
  const tableWrap  = document.getElementById("mpTableWrap");

  // 요약 초기화
  document.getElementById("mpTotalCost").textContent   = "—";
  document.getElementById("mpTotalValue").textContent  = "—";
  document.getElementById("mpTotalProfit").textContent = "—";
  document.getElementById("mpTotalPct").textContent    = "—";

  if (!positions.length) {
    tableWrap.innerHTML = `
      <div class="mp-table-header">
        <span class="mp-table-title">보유 종목</span>
        <button class="mp-refresh-btn" onclick="loadMyPage()">↺ 새로고침</button>
      </div>
      <div class="mp-empty">
        <div class="mp-empty-icon">📭</div>
        <div class="mp-empty-title">보유 종목이 없습니다</div>
        <div class="mp-empty-sub">신규 진입 종목 찾기에서 종목을 추가해보세요</div>
      </div>`;
    return;
  }

  // 현재가 조회
  try {
    const tickers = positions.map(p => p.ticker);
    const quotes  = await fetchMultiQuote(tickers);
    let totalCost = 0, totalValue = 0;

    const rows = positions.map((p, i) => {
      const q      = quotes[p.ticker] || {};
      const cur    = q.price || p.cost;
      const value  = cur * p.qty;
      const cost   = p.cost * p.qty;
      const profit = value - cost;
      const pct    = cost > 0 ? (profit / cost * 100) : 0;
      totalCost  += cost;
      totalValue += value;
      const pCls  = profit >= 0 ? "mp-table-pct bull" : "mp-table-pct bear";
      const sign  = profit >= 0 ? "+" : "";
      const dPct  = q.changePct || 0;
      const dSign = dPct >= 0 ? "+" : "";
      return `<tr>
        <td>
          <div class="mp-table-rank">${i + 1}</div>
        </td>
        <td>
          <div class="mp-table-name">${p.name}</div>
          <div class="mp-table-ticker">${p.ticker}</div>
        </td>
        <td class="mp-table-price">${p.qty.toLocaleString("ko-KR")}주</td>
        <td class="mp-table-price">${fmt(p.cost, 0)}</td>
        <td class="mp-table-price">
          <div>${fmt(cur, 0)}</div>
          <div style="font-size:11px;color:${dPct>=0?"var(--bull)":"var(--bear)"}">${dSign}${dPct.toFixed(2)}%</div>
        </td>
        <td class="mp-table-price">${fmt(value, 0)}</td>
        <td class="${pCls}">${sign}${fmt(profit, 0)}</td>
        <td class="${pCls}">${sign}${pct.toFixed(2)}%</td>
        <td>
          <button class="mp-table-btn" onclick="goAnalyze('${p.ticker}')">분석</button>
          <button class="mp-table-btn" onclick="openMpBuyModal('${p.ticker}','${p.name}',${cur})">추가매수</button>
          <button class="mp-table-btn" onclick="openMpSellModal('${p.ticker}','${p.name}',${p.qty})">매도</button>
        </td>
      </tr>`;
    }).join("");

    const totalProfit = totalValue - totalCost;
    const totalPct    = totalCost > 0 ? (totalProfit / totalCost * 100) : 0;
    const totCls      = totalProfit >= 0 ? "bull" : "bear";

    document.getElementById("mpTotalCost").textContent   = fmt(totalCost, 0) + "원";
    document.getElementById("mpTotalValue").textContent  = fmt(totalValue, 0) + "원";
    const profitEl = document.getElementById("mpTotalProfit");
    profitEl.textContent = (totalProfit >= 0 ? "+" : "") + fmt(totalProfit, 0) + "원";
    profitEl.className = "mp-card-value " + totCls;
    const pctEl = document.getElementById("mpTotalPct");
    pctEl.textContent = (totalProfit >= 0 ? "+" : "") + totalPct.toFixed(2) + "%";
    pctEl.className = "mp-card-value " + totCls;

    tableWrap.innerHTML = `
      <div class="mp-table-header">
        <span class="mp-table-title">보유 종목</span>
        <button class="mp-refresh-btn" onclick="loadMyPage()">↺ 새로고침</button>
      </div>
      <div style="overflow-x:auto">
        <table class="mp-table">
          <thead><tr>
            <th>#</th><th>종목</th><th>수량</th><th>평단가</th><th>현재가</th>
            <th>평가금액</th><th>손익</th><th>수익률</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch(e) {
    showToast("현재가 조회 실패: " + e.message, "error");
  }
}

// ── 추가 매수 모달 ─────────────────────────────────────
function openMpBuyModal(ticker, name, currentPrice) {
  _mpTicker = ticker;
  _mpName   = name;
  document.getElementById("mpBuyModalSub").textContent = `${name} (${ticker})`;
  document.getElementById("mpBuyQty").value   = "1";
  document.getElementById("mpBuyPrice").value = String(Math.round(currentPrice));
  document.getElementById("mpBuyModal").style.display = "flex";
}

function closeMpBuyModal() {
  document.getElementById("mpBuyModal").style.display = "none";
}

function confirmMpBuy() {
  const qty   = parseInt(document.getElementById("mpBuyQty")?.value || "0", 10);
  const price = parseFloat(document.getElementById("mpBuyPrice")?.value || "0");
  if (!qty || qty < 1) { showToast("유효한 수량을 입력하세요.", "error"); return; }
  if (!price || price <= 0) { showToast("유효한 매수가를 입력하세요.", "error"); return; }
  portfolioBuy(_mpTicker, _mpName, qty, price);
  showToast(`${_mpName} ${qty}주 추가매수 완료`);
  closeMpBuyModal();
  loadMyPage();
}

// ── 매도 모달 ─────────────────────────────────────────
function openMpSellModal(ticker, name, qty) {
  _mpTicker = ticker;
  _mpName   = name;
  _mpQty    = qty;
  document.getElementById("mpSellModalSub").textContent = `${name} (${ticker}) · 보유 ${qty}주`;
  document.getElementById("mpSellQty").value = "1";
  document.getElementById("mpSellModal").style.display = "flex";
}

function closeMpSellModal() {
  document.getElementById("mpSellModal").style.display = "none";
}

function confirmMpSell(full) {
  const qty = full ? _mpQty : parseInt(document.getElementById("mpSellQty")?.value || "0", 10);
  if (!qty || qty < 1) { showToast("유효한 수량을 입력하세요.", "error"); return; }
  if (qty > _mpQty) { showToast("보유 수량보다 많은 매도는 불가합니다.", "error"); return; }
  portfolioSell(_mpTicker, qty);
  showToast(`${_mpName} ${qty}주 매도 완료`);
  closeMpSellModal();
  loadMyPage();
}

// ── 초기화 ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadMyPage();
  document.getElementById("mpBuyModal")?.addEventListener("click", e => {
    if (e.target?.id === "mpBuyModal") closeMpBuyModal();
  });
  document.getElementById("mpSellModal")?.addEventListener("click", e => {
    if (e.target?.id === "mpSellModal") closeMpSellModal();
  });
});
