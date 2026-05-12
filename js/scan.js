/* js/scan.js */
let _scanType = "fis";
let _market   = "kospi";
let _scanning = false;
let _scanOffset  = 0;
let _scanLimit   = 20;
let _scanHasMore = false;
let _scanMoreLoading = false;
let _scanCandidates  = [];
let _scanBuyTicker = "", _scanBuyName = "", _scanBuyPrice = 0;

function selectScanType(type) {
  _scanType = type;
  document.querySelectorAll(".stab").forEach(t => {
    t.classList.toggle("active", t.dataset.type === type);
  });
  const kumoDesc = document.getElementById("kumoDesc");
  if (kumoDesc) kumoDesc.style.display = type === "kumo" ? "block" : "none";
  document.getElementById("resultsSection").style.display = "none";
}

function selectMarket(market) {
  _market = market;
  document.querySelectorAll(".mtab").forEach(t => {
    t.classList.toggle("active", t.dataset.market === market);
  });
  document.getElementById("resultsSection").style.display = "none";
}

function _scanApiUrl(offset) {
  return `data/scan_${_scanType}_${_market}.json`;
}

function _updateScanMoreButton() {
  const wrap = document.getElementById("scanMoreWrap");
  const btn  = document.getElementById("scanMoreBtn");
  if (!wrap || !btn) return;
  if (_scanHasMore) {
    wrap.style.display = "flex";
    btn.disabled = false;
    btn.textContent = "자세히 보기";
  } else {
    wrap.style.display = "none";
  }
}

async function doScan() {
  if (_scanning) return;
  _scanning = true;
  const btn = document.getElementById("scanBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 분석 중...';
  document.getElementById("resultsSection").style.display = "none";
  const label = {kospi:"코스피", kosdaq:"코스닥", us:"미국"}[_market];
  const scanLabel = _scanType === "kumo" ? "쿠모 브레이크아웃" : "FIS 진입";
  const loadingMsg = document.getElementById("loadingMsg");
  if (loadingMsg) loadingMsg.textContent = `${label} ${scanLabel} 분석 중...`;
  document.getElementById("loadingOverlay").style.display = "flex";
  _scanOffset = 0;
  _scanHasMore = false;
  _scanCandidates = [];
  _updateScanMoreButton();

  try {
    const res = await fetch(_scanApiUrl(0));
    if (!res.ok) throw new Error("데이터 파일 없음 — GitHub Actions 실행 후 이용 가능합니다");
    const all = await res.json();
    document.getElementById("loadingOverlay").style.display = "none";
    const page = all.slice(0, _scanLimit);
    _scanHasMore = all.length > _scanLimit;
    _scanOffset  = _scanLimit;
    // Store full data for pagination
    _scanAllData = all;
    renderResults(page, label, false);
    _updateScanMoreButton();
  } catch(e) {
    document.getElementById("loadingOverlay").style.display = "none";
    showToast("스캔 오류: " + e.message, "error");
  } finally {
    _scanning = false;
    btn.disabled = false;
    btn.innerHTML = "스캔 시작";
  }
}

let _scanAllData = [];

async function loadMoreScan() {
  if (_scanMoreLoading || !_scanHasMore) return;
  _scanMoreLoading = true;
  const btn = document.getElementById("scanMoreBtn");
  if (btn) { btn.disabled = true; btn.textContent = "불러오는 중..."; }
  try {
    const end  = _scanOffset + _scanLimit;
    const page = _scanAllData.slice(_scanOffset, end);
    _scanHasMore = _scanAllData.length > end;
    _scanOffset  = end;
    const label = {kospi:"코스피", kosdaq:"코스닥", us:"미국"}[_market];
    renderResults(page, label, true);
  } catch (e) {
    showToast("추가 로딩 오류: " + e.message, "error");
  } finally {
    _scanMoreLoading = false;
    _updateScanMoreButton();
  }
}

function renderResults(candidates, label, append) {
  if (!append) _scanCandidates = candidates;
  else _scanCandidates = _scanCandidates.concat(candidates);

  const section  = document.getElementById("resultsSection");
  const countEl  = document.getElementById("resultCount");
  const gridEl   = document.getElementById("candidatesGrid");
  countEl.textContent = _scanCandidates.length + "개";
  const resultDesc = _scanType === "kumo"
    ? `${label} 쿠모 브레이크아웃 패턴 종목`
    : `${label} 상승 우위 진입 후보 (진입 점수 높은 순)`;
  document.getElementById("resultLabel").textContent = resultDesc;

  if (!_scanCandidates.length) {
    gridEl.innerHTML = `<div class="no-result" style="grid-column:1/-1">
      <div class="nr-icon">🔍</div>
      <div>현재 신규 진입 조건을 충족하는 종목이 없습니다.</div>
    </div>`;
    section.style.display = "block";
    return;
  }

  const html = _scanCandidates.map((c, idx) => {
    const col    = fisColor(c.fis ?? 0);
    const eScore = c.entry_score ?? 0;
    const eCol   = eScore >= 80 ? "#2ea043" : eScore >= 65 ? "#56d364" : eScore >= 50 ? "#d29922" : "#6e7681";
    const tCls   = (c.trend ?? 0) >= 10 ? "pos" : "neg";
    const mCls   = (c.momentum ?? 0) >= 5 ? "pos" : (c.momentum ?? 0) < 0 ? "neg" : "";
    const fis    = c.fis ?? 0;
    const close  = c.close || c.price || 0;
    return `
      <div class="candidate-card">
        <div class="cc-top">
          <div>
            <div class="cc-name">${c.name}</div>
            <div class="cc-ticker">${c.ticker} · ${fmt(close, 0)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <div class="cc-fis-badge" style="background:${col}">FIS ${fis>=0?"+":""}${fis.toFixed(0)}</div>
            <div class="cc-fis-badge" style="background:${eCol};font-size:11px">진입 점수 ${eScore.toFixed(0)}</div>
          </div>
        </div>
        <div class="cc-label" style="color:${col}">${c.label || fisLabelText(fis)}</div>
        <div class="cc-summary">${c.summary_l1 || ""}</div>
        <div class="cc-scores">
          <span class="cs-chip ${tCls}" title="추세점수">추세 ${(c.trend??0)>=0?"+":""}${(c.trend??0).toFixed(0)}</span>
          <span class="cs-chip ${mCls}" title="모멘텀">모멘텀 ${(c.momentum??0)>=0?"+":""}${(c.momentum??0).toFixed(0)}</span>
          <span class="cs-chip" style="background:rgba(46,160,67,0.12);color:#56d364">진입 ${eScore.toFixed(0)}</span>
        </div>
        <div class="cc-actions">
          <button class="cc-btn cc-btn-analyze" onclick="window.location.href='analyze.html?t=${c.ticker}'">차트 분석</button>
          <button class="cc-btn cc-btn-buy"     onclick="openScanBuyModal('${c.ticker}','${c.name}',${close})">신규 진입</button>
        </div>
      </div>`;
  }).join("");

  if (append) gridEl.innerHTML = html;
  else gridEl.innerHTML = html;
  section.style.display = "block";
  _updateScanMoreButton();
}

// ── 신규 진입 매수 모달 ──────────────────────────────────
function openScanBuyModal(ticker, name, price) {
  _scanBuyTicker = ticker;
  _scanBuyName   = name;
  _scanBuyPrice  = price;
  document.getElementById("scanModalSub").textContent   = `${name} (${ticker})`;
  document.getElementById("scanModalPrice").value = String(Math.round(price));
  document.getElementById("scanModalQty").value   = "1";
  onScanQtyChange();
  document.getElementById("scanBuyModal").style.display = "flex";
}

function closeScanBuyModal() {
  document.getElementById("scanBuyModal").style.display = "none";
}

function onScanQtyChange() {
  const qty   = parseInt(document.getElementById("scanModalQty")?.value || "0", 10);
  const price = parseFloat(document.getElementById("scanModalPrice")?.value || "0");
  const investEl = document.getElementById("scanInvest");
  if (investEl) investEl.textContent = qty && price ? fmt(qty * price, 0) + "원" : "—";
}

function onScanPriceChange() { onScanQtyChange(); }

function confirmScanBuy() {
  const qty   = parseInt(document.getElementById("scanModalQty")?.value || "0", 10);
  const price = parseFloat(document.getElementById("scanModalPrice")?.value || "0");
  if (!qty || qty < 1) { showToast("유효한 수량을 입력하세요.", "error"); return; }
  if (!price || price <= 0) { showToast("유효한 진입가를 입력하세요.", "error"); return; }
  portfolioBuy(_scanBuyTicker, _scanBuyName, qty, price);
  showToast(`${_scanBuyName} ${qty}주 진입 등록 완료`);
  closeScanBuyModal();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("scanBuyModal")?.addEventListener("click", e => {
    if (e.target?.id === "scanBuyModal") closeScanBuyModal();
  });
});
