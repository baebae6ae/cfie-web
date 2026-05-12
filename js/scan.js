/* js/scan.js  —  CFIE v4.0 (매수 기능 없음) */
let _scanType = "fis";
let _market   = "kospi";
let _scanning = false;
let _scanOffset  = 0;
let _scanLimit   = 20;
let _scanHasMore = false;
let _scanMoreLoading = false;
let _scanCandidates  = [];
let _scanAllData     = [];

function selectScanType(type) {
  _scanType = type;
  document.querySelectorAll(".stab").forEach(t => t.classList.toggle("active", t.dataset.type === type));
  const kumoDesc = document.getElementById("kumoDesc");
  if (kumoDesc) kumoDesc.style.display = type === "kumo" ? "block" : "none";
  document.getElementById("resultsSection").style.display = "none";
}

function selectMarket(market) {
  _market = market;
  document.querySelectorAll(".mtab").forEach(t => t.classList.toggle("active", t.dataset.market === market));
  document.getElementById("resultsSection").style.display = "none";
}

function _updateScanMoreButton() {
  const wrap = document.getElementById("scanMoreWrap");
  const btn  = document.getElementById("scanMoreBtn");
  if (!wrap || !btn) return;
  wrap.style.display = _scanHasMore ? "flex" : "none";
  if (btn) btn.disabled = false;
}

async function doScan() {
  if (_scanning) return;
  _scanning = true;
  const btn = document.getElementById("scanBtn");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 분석 중...';
  document.getElementById("resultsSection").style.display = "none";
  const label = {kospi:"코스피", kosdaq:"코스닥", us:"미국"}[_market];
  const loadingMsg = document.getElementById("loadingMsg");
  if (loadingMsg) loadingMsg.textContent = `${label} ${ _scanType==="kumo"?"쿠모":"FIS" } 분석 중...`;
  document.getElementById("loadingOverlay").style.display = "flex";
  _scanOffset = 0; _scanHasMore = false; _scanCandidates = []; _scanAllData = [];
  _updateScanMoreButton();
  try {
    const res = await fetch(`data/scan_${_scanType}_${_market}.json`);
    if (!res.ok) throw new Error("데이터 파일 없음 — 데이터 생성 후 이용 가능합니다");
    _scanAllData = await res.json();
    document.getElementById("loadingOverlay").style.display = "none";
    const page = _scanAllData.slice(0, _scanLimit);
    _scanHasMore = _scanAllData.length > _scanLimit;
    _scanOffset  = _scanLimit;
    renderResults(page, label, false);
    _updateScanMoreButton();
  } catch(e) {
    document.getElementById("loadingOverlay").style.display = "none";
    showToast("스캔 오류: " + e.message, "error");
  } finally {
    _scanning = false;
    btn.disabled = false; btn.innerHTML = "스캔 시작";
  }
}

async function loadMoreScan() {
  if (_scanMoreLoading || !_scanHasMore) return;
  _scanMoreLoading = true;
  const btn = document.getElementById("scanMoreBtn");
  if (btn) { btn.disabled=true; btn.textContent="불러오는 중..."; }
  try {
    const end  = _scanOffset + _scanLimit;
    const page = _scanAllData.slice(_scanOffset, end);
    _scanHasMore = _scanAllData.length > end;
    _scanOffset  = end;
    const label = {kospi:"코스피", kosdaq:"코스닥", us:"미국"}[_market];
    renderResults(page, label, true);
  } catch(e) {
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
  const desc = _scanType==="kumo"
    ? `${label} 쿠모 브레이크아웃 패턴 종목`
    : `${label} 상승 우위 진입 후보 (진입 점수 높은 순)`;
  document.getElementById("resultLabel").textContent = desc;
  if (!_scanCandidates.length) {
    gridEl.innerHTML = `<div class="no-result" style="grid-column:1/-1"><div class="nr-icon">🔍</div><div>현재 조건을 충족하는 종목이 없습니다.</div></div>`;
    section.style.display = "block"; return;
  }
  const html = _scanType==="kumo"
    ? _scanCandidates.map(renderKumoCard).join("")
    : _scanCandidates.map(renderFisCard).join("");
  gridEl.innerHTML = html;
  section.style.display = "block";
  _updateScanMoreButton();
}

function renderFisCard(c) {
  const fis    = c.fis    ?? 0;
  const eScore = c.entry_score ?? 0;
  const close  = c.close  ?? 0;
  const col    = c.label_color || fisColor(fis);
  const eCol   = eScore>=80?"#2ea043":eScore>=65?"#56d364":eScore>=50?"#d29922":"#888";
  const tCls   = (c.trend??0)>=10?"pos":"neg";
  const mCls   = (c.momentum??0)>=5?"pos":(c.momentum??0)<0?"neg":"";
  const setupName = c.entry_setup_name || (c.entry && c.entry.setup_name) || "";
  return `<div class="candidate-card">
    <div class="cc-top">
      <div>
        <div class="cc-name">${c.name}</div>
        <div class="cc-ticker">${c.ticker} · ${fmt(close,0)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <div class="cc-fis-badge" style="background:${col}">FIS ${fis>=0?"+":""}${fis.toFixed(0)}</div>
        <div class="cc-fis-badge" style="background:${eCol};font-size:11px">진입 ${eScore}</div>
      </div>
    </div>
    <div class="cc-label" style="color:${col}">${c.label||""}</div>
    ${setupName?`<div style="font-size:11px;color:#888;margin:2px 0">📐 ${setupName}</div>`:""}
    <div class="cc-summary">${c.summary_l1||""}</div>
    <div class="cc-scores">
      <span class="cs-chip ${tCls}">추세 ${(c.trend??0)>=0?"+":""}${(c.trend??0).toFixed(0)}</span>
      <span class="cs-chip ${mCls}">모멘텀 ${(c.momentum??0)>=0?"+":""}${(c.momentum??0).toFixed(0)}</span>
      <span class="cs-chip">구조 ${(c.structure??0)>=0?"+":""}${(c.structure??0).toFixed(0)}</span>
    </div>
    <div class="cc-actions">
      <button class="cc-btn cc-btn-analyze" onclick="window.location.href='analyze.html?t=${c.ticker}'">차트 분석</button>
    </div>
  </div>`;
}

function renderKumoCard(c) {
  const close     = c.close ?? 0;
  const bullCloud = c.bull_cloud;
  const dailyVol  = c.daily_vol ?? false;
  const belowWeeks= c.below_weeks ?? 0;
  const cloudThin = c.cloud_thin ?? false;
  const cloudDir  = bullCloud ? "상승 구름 (Bullish)" : "하락 구름 (Bearish)";
  const cloudCls  = bullCloud ? "bull" : "bear";
  return `<div class="candidate-card kumo-card">
    <div class="cc-top">
      <div>
        <div class="cc-name">${c.name}</div>
        <div class="cc-ticker">${c.ticker} · ${fmt(close,0)}</div>
      </div>
      <div class="cc-fis-badge kumo-badge">쿠모 돌파</div>
    </div>
    <div class="cc-label ${cloudCls}">${cloudDir}</div>
    <div class="cc-scores" style="margin-top:6px">
      <span class="cs-chip" title="구름대 하방 체류 기간">📉 구름 아래 ${belowWeeks}주</span>
      ${cloudThin?`<span class="cs-chip bull">구름 얇음</span>`:""}
      ${dailyVol?`<span class="cs-chip bull">거래량 급증</span>`:""}
    </div>
    <div class="cc-actions">
      <button class="cc-btn cc-btn-analyze" onclick="window.location.href='analyze.html?t=${c.ticker}'">차트 분석</button>
    </div>
  </div>`;
}

function fmt(v, dec=0) {
  if (v==null||isNaN(v)) return "—";
  return Number(v).toLocaleString("ko-KR", {minimumFractionDigits:dec,maximumFractionDigits:dec});
}
