/* js/analyze.js  —  CFIE v4.0  (차트 크기 및 로딩 순서 개선 버전) */

let _chart     = null;
let _volChart  = null;
let _macdChart = null;
let _currentTicker    = null;
let _currentATR       = 0;
let _currentHigh22    = 0;  // 22봉 고점 (Chandelier Exit 기준)
let _currentSwingLow5 = 0;  // 최근 5봉 저점 (스윙 저점 손절 참고)
let _currentEMA20     = 0;
let _currentBBUP      = 0;  // BB 상단 (저항 기반 익절 참고)
let _currentClose     = 0;  // 현재 종가
let _currentEntryScore= 0;
let _currentFIS       = 0;
let _currentFreshness = 0;
let _currentRR        = 0;
let _currentIsKRW     = true;

// ── 초기화 ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const url = new URLSearchParams(location.search);
  const t   = url.get("t");
  if (t) loadChart(t);
  else {
    document.getElementById("loadingOverlay").style.display = "none";
    document.getElementById("analyzeMain").style.display    = "block";
    const el = document.getElementById("stockName");
    if (el) el.textContent = "종목을 검색하여 분석을 시작하세요";
  }
});

// ── 차트 로드 ────────────────────────────────────────────
async function loadChart(ticker) {
  _currentTicker = ticker.toUpperCase();
  const overlay = document.getElementById("loadingOverlay");
  const main    = document.getElementById("analyzeMain");
  
  overlay.style.display = "flex";
  overlay.innerHTML = '<div class="spinner"></div><p style="margin-top:16px;color:var(--text2)">차트 데이터 분석 중…</p>';
  main.style.display    = "none";

  try {
    const tf     = document.getElementById("timeframeSelect")?.value || "1d";
    const period = document.getElementById("periodSelect")?.value    || "2y";
    // 섹터·그룹 컨텍스트 감지
    const _sn = (typeof STOCK_SECTOR_MAP !== "undefined") ? STOCK_SECTOR_MAP[_currentTicker] : null;
    const _gn = (typeof STOCK_GROUP_MAP  !== "undefined") ? STOCK_GROUP_MAP[_currentTicker]  : null;
    const _sectorEtf  = (_sn && typeof SECTOR_ETFS      !== "undefined") ? SECTOR_ETFS[_sn]      : null;
    const _groupReps  = (_gn && typeof GROUP_REP_STOCKS  !== "undefined")
      ? (GROUP_REP_STOCKS[_gn] || []).filter(t => t !== _currentTicker).slice(0, 2) : [];

    // 메인 + 섹터 ETF + 그룹 대표주 병렬 fetch
    const _allFetches = [
      fetchOHLCV(_currentTicker, period, tf),
      _sectorEtf ? fetchOHLCV(_sectorEtf, "6mo", "1d").catch(() => null) : Promise.resolve(null),
      ..._groupReps.map(t => fetchOHLCV(t, "6mo", "1d").catch(() => null)),
    ];
    const [_mainRes, _sectorRes, ..._groupRes] = await Promise.all(_allFetches);
    const { bars, meta } = _mainRes;

    // 섹터·그룹 FIS 계산
    const _entryContext = { sectorName: _sn, groupName: _gn };
    if (_sectorRes?.bars?.length > 30) {
      const _se = calcFIS(calcIndicators(_sectorRes.bars));
      _entryContext.sectorFIS = _se[_se.length - 1].FIS;
    }
    const _gFISArr = _groupRes
      .filter(r => r?.bars?.length > 30)
      .map(r => { const _e = calcFIS(calcIndicators(r.bars)); return _e[_e.length - 1].FIS; });
    if (_gFISArr.length) _entryContext.groupFIS = _gFISArr.reduce((a, b) => a + b, 0) / _gFISArr.length;

    if (!bars.length) { 
      showToast("데이터 없음", "error"); 
      overlay.style.display="none"; 
      main.style.display="block"; 
      return; 
    }

    const enriched = calcIndicators(bars);
    const fisBars  = calcFIS(enriched);

    // 손절 분석용 전역 상태 업데이트
    const _sl         = fisBars[fisBars.length - 1];
    _currentATR       = _sl?.ATR14 || 0;
    _currentEMA20     = _sl?.EMA20 || 0;
    // 22봉 고점 (Chandelier Exit 표준 22일 기준)
    _currentHigh22    = fisBars.slice(-22).reduce((m, b) => Math.max(m, b.high || 0), 0);
    // 최근 5봉 저점 (스윙 저점 손절 참고)
    _currentSwingLow5 = fisBars.slice(-5).reduce((m, b) => Math.min(m, b.low ?? Infinity), Infinity);
    if (!isFinite(_currentSwingLow5)) _currentSwingLow5 = 0;
    _currentBBUP      = _sl?.BB_UP  || 0;
    _currentClose     = _sl?.close  || 0;
    _currentIsKRW     = (meta?.currency || "") !== "USD";
    onAvgCostChange();

    const entry    = calcEntryScore(fisBars, _entryContext);
    const judgment = makeJudgment(fisBars);

    // [중요 수정] 차트를 그리기 전에 화면에 먼저 표시해야 정확한 너비 계산이 가능함
    overlay.style.display = "none";
    main.style.display    = "block";

    renderStockHeader(_currentTicker, meta, bars, judgment);
    renderChart(bars, fisBars, tf, meta); // 이제 main이 보이고 있으므로 너비가 정확함
    renderJudgment(judgment);
    renderEntryScore(entry);
    renderChips(judgment, fisBars);
    renderTable(fisBars);
    renderBacktest(fisBars); // 진입 점수 백테스트 결과

  } catch(e) {
    console.error(e);
    overlay.innerHTML = `
      <div style="text-align:center">
        <div style="color:var(--danger,#e53935);margin-bottom:16px;font-size:0.9rem">⚠️ 차트 로드 실패<br><small style="opacity:.7">${e.message}</small></div>
        <button onclick="reloadChart()" style="padding:8px 24px;background:var(--primary,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9rem">다시 시도</button>
      </div>`;
    overlay.style.display = "flex";
    main.style.display = "none";
  }
}

function reloadChart() { if (_currentTicker) loadChart(_currentTicker); }

// ── 평단가 기반 손절 분석 ────────────────────────────────
function onAvgCostChange() {
  const input     = document.getElementById("avgCostInput");
  const slPriceEl = document.getElementById("slPrice");
  const slPctEl   = document.getElementById("slPct");
  const slEMA20El = document.getElementById("slEMA20");
  const slSigEl   = document.getElementById("slEMASignal");
  if (!input) return;

  const avgCost = parseFloat(input.value) || 0;
  const dec     = _currentIsKRW ? 0 : 2;

  // ── 손절선 계산 ──
  // ① Chandelier Exit (표준): 22봉 최고가 − ATR(14)×3
  //    기존 ×2 는 노이즈에 조기청산 위험 → 업계 표준 ×3 채택
  const ceRaw = (_currentHigh22 > 0 && _currentATR > 0)
    ? _currentHigh22 - _currentATR * 3 : 0;
  const ce = (_currentIsKRW && ceRaw > 0) ? Math.round(ceRaw) : +ceRaw.toFixed(dec);

  // ② 스윙 저점 기준: 최근 5봉 저점 − ATR×0.5 (단기 스윙 참고)
  const swRaw = (_currentSwingLow5 > 0 && _currentATR > 0)
    ? _currentSwingLow5 - _currentATR * 0.5 : 0;
  const sw = (_currentIsKRW && swRaw > 0) ? Math.round(swRaw) : +swRaw.toFixed(dec);

  if (slPriceEl) slPriceEl.textContent = ce > 0 ? fmt(ce, dec) : "—";
  if (slPctEl) {
    if (ce > 0 && avgCost > 0) {
      const pct = (ce - avgCost) / avgCost * 100;
      slPctEl.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
      slPctEl.style.color = pct >= 0 ? "var(--bull,#2ea043)" : "var(--bear,#e53935)";
    } else {
      slPctEl.textContent = "";
    }
  }
  const slSwEl  = document.getElementById("slSwingLow");
  const slSwPct = document.getElementById("slSwingLowPct");
  if (slSwEl)  slSwEl.textContent = sw > 0 ? fmt(sw, dec) : "—";
  if (slSwPct) {
    if (sw > 0 && avgCost > 0) {
      const pct = (sw - avgCost) / avgCost * 100;
      slSwPct.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
      slSwPct.style.color = pct >= 0 ? "var(--bull,#2ea043)" : "var(--bear,#e53935)";
    } else {
      if (slSwPct) slSwPct.textContent = "";
    }
  }
  if (slEMA20El) slEMA20El.textContent = _currentEMA20 > 0 ? fmt(_currentEMA20, dec) : "—";
  if (slSigEl) {
    if (_currentEMA20 > 0 && avgCost > 0) {
      const above = avgCost >= _currentEMA20;
      slSigEl.textContent = above ? "✓ 상회" : "⬇ 하회";
      slSigEl.style.color = above ? "var(--bull,#2ea043)" : "var(--bear,#e53935)";
    } else {
      slSigEl.textContent = "";
    }
  }

  // ── 익절선 및 손익비 계산 ──
  // TP1: 진입가 + ATR×2 (기계적 1차 익절 기준)
  // TP2: ATR×4 또는 BB 상단 중 가까운 값 (중기 목표)
  const tp1Raw = (avgCost > 0 && _currentATR > 0) ? avgCost + _currentATR * 2 : 0;
  const _bbTarget = (_currentBBUP > 0 && _currentBBUP > avgCost + _currentATR) ? _currentBBUP : 0;
  const tp2Raw = (avgCost > 0 && _currentATR > 0)
    ? (_bbTarget > 0 ? Math.min(_bbTarget, avgCost + _currentATR * 4) : avgCost + _currentATR * 4)
    : 0;
  const tp1 = (_currentIsKRW && tp1Raw > 0) ? Math.round(tp1Raw) : +tp1Raw.toFixed(dec);
  const tp2 = (_currentIsKRW && tp2Raw > 0) ? Math.round(tp2Raw) : +tp2Raw.toFixed(dec);
  const tp1El    = document.getElementById("tpPrice1");
  const tp1PctEl = document.getElementById("tpPct1");
  const tp2El    = document.getElementById("tpPrice2");
  const tp2PctEl = document.getElementById("tpPct2");
  const rrEl     = document.getElementById("rrValue");
  const rrSigEl  = document.getElementById("rrSignal");
  if (tp1El) tp1El.textContent = tp1 > 0 ? fmt(tp1, dec) : "—";
  if (tp1PctEl) {
    if (tp1 > 0 && avgCost > 0) {
      const pct = (tp1 - avgCost) / avgCost * 100;
      tp1PctEl.textContent = "+" + pct.toFixed(1) + "%";
      tp1PctEl.style.color = "var(--bull,#2ea043)";
    } else tp1PctEl.textContent = "";
  }
  if (tp2El) tp2El.textContent = tp2 > 0 ? fmt(tp2, dec) : "—";
  if (tp2PctEl) {
    if (tp2 > 0 && avgCost > 0) {
      const pct = (tp2 - avgCost) / avgCost * 100;
      tp2PctEl.textContent = "+" + pct.toFixed(1) + "%";
      tp2PctEl.style.color = "var(--bull,#2ea043)";
    } else tp2PctEl.textContent = "";
  }
  // 손익비(R:R) = 기계적 스캔과 동일 공식: ATR×3 목표 / (현재가 − EMA20−ATR) 손절
  const _ema20Stop = (_currentEMA20 > 0 && _currentATR > 0) ? _currentEMA20 - _currentATR : 0;
  const _rrRisk   = avgCost > 0 && _ema20Stop > 0 && avgCost > _ema20Stop ? avgCost - _ema20Stop : 0;
  const _rrReward = _currentATR > 0 ? _currentATR * 3 : 0;
  const rr = _rrRisk > 0 && _rrReward > 0 ? _rrReward / _rrRisk : 0;

  // ── R:R 기준 손절선 표시 (EMA20 − ATR) ──
  const _ema20StopDisp = (_currentIsKRW && _ema20Stop > 0) ? Math.round(_ema20Stop) : +_ema20Stop.toFixed(dec);
  const slEMA20ATREl  = document.getElementById("slEMA20ATR");
  const slEMA20ATRPctEl = document.getElementById("slEMA20ATRPct");
  if (slEMA20ATREl) slEMA20ATREl.textContent = _ema20StopDisp > 0 ? fmt(_ema20StopDisp, dec) : "—";
  if (slEMA20ATRPctEl) {
    if (_ema20StopDisp > 0 && avgCost > 0) {
      const _sp = (_ema20StopDisp - avgCost) / avgCost * 100;
      slEMA20ATRPctEl.textContent = ((_sp >= 0) ? "+" : "") + _sp.toFixed(1) + "%";
      slEMA20ATRPctEl.style.color = _sp >= 0 ? "var(--bull,#2ea043)" : "var(--bear,#e53935)";
    } else slEMA20ATRPctEl.textContent = "";
  }

  // ── R:R 기준 목표가 표시 (ATR×3) ──
  const _tp3Raw = (avgCost > 0 && _currentATR > 0) ? avgCost + _currentATR * 3 : 0;
  const _tp3    = (_currentIsKRW && _tp3Raw > 0) ? Math.round(_tp3Raw) : +_tp3Raw.toFixed(dec);
  const tp3El    = document.getElementById("tpPrice3");
  const tp3PctEl = document.getElementById("tpPct3");
  if (tp3El) tp3El.textContent = _tp3 > 0 ? fmt(_tp3, dec) : "—";
  if (tp3PctEl) {
    if (_tp3 > 0 && avgCost > 0) {
      const _tp = (_tp3 - avgCost) / avgCost * 100;
      tp3PctEl.textContent = "+" + _tp.toFixed(1) + "%";
      tp3PctEl.style.color = "var(--bull,#2ea043)";
    } else tp3PctEl.textContent = "";
  }

  if (rrEl)    rrEl.textContent = rr > 0 ? rr.toFixed(2) + " : 1" : "—";
  if (rrSigEl) {
    if (rr > 0) {
      rrSigEl.textContent = rr >= 2.0 ? "✓ 양호" : rr >= 1.5 ? "△ 보통" : "⚠ 불리";
      rrSigEl.style.color = rr >= 2.0 ? "var(--bull,#2ea043)" : rr >= 1.5 ? "#d29922" : "var(--bear,#e53935)";
    } else rrSigEl.textContent = "";
  }
  _currentRR = rr;
  renderChecklist();
  const beNote = document.getElementById("breakEvenNote");
  if (beNote) {
    if (avgCost > 0 && tp1 > 0) {
      beNote.textContent = "1차 익절 도달 시 → 손절을 " + fmt(avgCost, dec) + "(진입가)으로 상향";
      beNote.style.display = "block";
    } else { beNote.style.display = "none"; }
  }
  const rrRowEl = document.getElementById("rrRow");
  if (rrRowEl) rrRowEl.classList.toggle("rr-warn", rr > 0 && rr < 2.0);

  // 포지션 사이징 업데이트 (avgCost·ema20Stop 기반)
  _updateSizing(avgCost, _ema20Stop);
}
// ── 포지션 사이징 ─────────────────────────────────────────────
let _sizingRiskPct = 1;  // 기본 리스크 1%

function _updateSizing(avgCost, ema20Stop) {
  const box = document.getElementById("sizingBox");
  if (!box) return;
  const stopPct = (avgCost > 0 && ema20Stop > 0 && avgCost > ema20Stop)
    ? Math.abs((ema20Stop - avgCost) / avgCost) : 0;
  if (!avgCost || stopPct <= 0) { box.style.display = "none"; return; }
  box.style.display = "block";

  // 단위 라벨 갱신
  const unitEl = document.getElementById("sizingUnitLabel");
  if (unitEl) unitEl.textContent = _currentIsKRW ? "만원" : "$";
  const inp = document.getElementById("totalAssetInput");
  if (inp) inp.placeholder = _currentIsKRW ? "3000" : "30000";

  _calcSizing(avgCost, stopPct);
}

function _calcSizing(avgCost, stopPct) {
  const inp = document.getElementById("totalAssetInput");
  const amtEl = document.getElementById("sizingAmount");
  const qtyEl = document.getElementById("sizingQty");
  const noteEl = document.getElementById("sizingRiskNote");
  const raw = parseFloat(inp?.value) || 0;
  if (!raw) {
    if (amtEl) amtEl.textContent = "총자산 입력 시 표시";
    if (qtyEl) qtyEl.textContent = "";
    if (noteEl) noteEl.textContent = "";
    return;
  }
  // KRW는 만원 단위 입력 → 원으로 환산
  const totalAsset = _currentIsKRW ? raw * 10000 : raw;
  const riskAmount = totalAsset * (_sizingRiskPct / 100);
  const buyAmount  = riskAmount / stopPct;
  const qty        = avgCost > 0 ? Math.floor(buyAmount / avgCost) : 0;
  const dec        = _currentIsKRW ? 0 : 2;

  if (amtEl) {
    if (_currentIsKRW) {
      const buyMal = Math.round(buyAmount / 10000);
      const col = buyMal > raw ? "var(--bear,#e53935)" : "var(--bull,#2ea043)";
      amtEl.textContent = buyMal.toLocaleString() + " 만원";
      amtEl.style.color = col;
      if (buyMal > raw) amtEl.textContent += "  ※총자산 초과";
    } else {
      amtEl.textContent = "$" + Math.round(buyAmount).toLocaleString();
      amtEl.style.color = buyAmount > totalAsset ? "var(--bear,#e53935)" : "var(--bull,#2ea043)";
    }
  }
  if (qtyEl) qtyEl.textContent = qty > 0 ? `≈ ${qty.toLocaleString()}주` : "";
  if (noteEl) {
    const riskStr = _currentIsKRW
      ? `리스크 ${_sizingRiskPct}% = 손절 시 최대 ${Math.round(riskAmount/10000).toLocaleString()}만원 손실 (손절 ${(stopPct*100).toFixed(1)}%)`
      : `Risk ${_sizingRiskPct}% = max $${Math.round(riskAmount).toLocaleString()} loss (stop ${(stopPct*100).toFixed(1)}%)`;
    noteEl.textContent = riskStr;
  }
}

function onSizingChange() {
  const inp = document.getElementById("avgCostInput");
  const avgCost = parseFloat(inp?.value) || 0;
  const ema20Stop = (_currentEMA20 > 0 && _currentATR > 0) ? _currentEMA20 - _currentATR : 0;
  const stopPct = avgCost > 0 && ema20Stop > 0 && avgCost > ema20Stop
    ? Math.abs((ema20Stop - avgCost) / avgCost) : 0;
  _calcSizing(avgCost, stopPct);
}

function onRiskBtn(btn) {
  document.querySelectorAll(".sl-risk-btn").forEach(b => b.classList.remove("sl-risk-active"));
  btn.classList.add("sl-risk-active");
  _sizingRiskPct = parseFloat(btn.dataset.risk);
  onSizingChange();
}

// ── 기계적 진입 체크리스트 업데이트 ───────────────────────────
function renderChecklist() {
  function _upd(iconId, valId, pass, val) {
    const ic = document.getElementById(iconId);
    const vl = document.getElementById(valId);
    if (ic) { ic.textContent = pass ? "☑" : "☐"; ic.style.color = pass ? "var(--bull,#2ea043)" : "var(--bear,#e53935)"; }
    if (vl) { vl.textContent = val; vl.style.color = pass ? "var(--bull,#2ea043)" : "var(--bear,#e53935)"; }
  }
  // 스캔과 동일한 기준 (entry>=65, FIS>=60, fresh>=0, R:R>=1.5)
  const scorePass = _currentEntryScore >= 65;
  const scoreOpt  = _currentEntryScore >= 80;   // 최적 진입 구간
  const fisPass   = _currentFIS >= 60;
  const fisOpt    = _currentFIS >= 80;           // 강한 추세
  const freshPass = _currentFreshness >= 0;
  const rrEntered = _currentRR > 0;
  const rrPass    = _currentRR >= 1.5;

  const scoreLabel = _currentEntryScore > 0
    ? _currentEntryScore.toFixed(0) + "점" + (scoreOpt ? " ★" : "")
    : "—";
  _upd("mch-score-icon","mch-score-val", scorePass, scoreLabel);

  const fisStr = _currentFIS !== 0
    ? (_currentFIS >= 0 ? "+" : "") + _currentFIS.toFixed(0) + (fisOpt ? " ★" : "")
    : "—";
  _upd("mch-fis-icon","mch-fis-val", fisPass, fisStr);

  const freshStr = _currentFreshness > 0 ? "+"+_currentFreshness.toFixed(1)+"pt"
    : _currentFreshness < 0 ? _currentFreshness.toFixed(1)+"pt" : "0pt";
  _upd("mch-fresh-icon","mch-fresh-val", freshPass, _currentEntryScore > 0 ? freshStr : "—");

  if (!rrEntered) {
    const ic2 = document.getElementById("mch-rr-icon");
    const vl2 = document.getElementById("mch-rr-val");
    if (ic2) { ic2.textContent = "☐"; ic2.style.color = "var(--text2,#888)"; }
    if (vl2) { vl2.textContent = "평단가 입력 후"; vl2.style.color = "var(--text2,#888)"; }
  } else {
    _upd("mch-rr-icon","mch-rr-val", rrPass, _currentRR.toFixed(2)+" : 1");
  }

  const vEl = document.getElementById("mechVerdict");
  if (!vEl) return;
  if (_currentEntryScore === 0) { vEl.textContent = "차트 로드 후 계산"; vEl.className = "mech-verdict mech-wait"; return; }
  const basePass = scorePass && fisPass && freshPass;
  if (!basePass) {
    const failed = [!scorePass&&"진입점수(65미만)",!fisPass&&"FIS(60미만)",!freshPass&&"신선도"].filter(Boolean);
    vEl.textContent = "⛔ "+failed.join("·")+" — 관망";
    vEl.className = "mech-verdict mech-no";
  } else if (!rrEntered) {
    const optNote = (scoreOpt && fisOpt) ? " (최적 구간 ★)" : "";
    vEl.textContent = "⚡ 기본 3조건 충족"+optNote+" — 평단가 입력 후 R:R 확인";
    vEl.className = "mech-verdict mech-wait";
  } else if (!rrPass) {
    vEl.textContent = "⛔ R:R "+_currentRR.toFixed(2)+" 불리 — 진입 포기";
    vEl.className = "mech-verdict mech-no";
  } else {
    const grade = (scoreOpt && fisOpt) ? "✅ 최적 조건 충족 ★ — 기계적 진입 적극 고려"
                                       : "✅ 조건 충족 — 기계적 진입 가능";
    vEl.textContent = grade;
    vEl.className = "mech-verdict mech-ok";
  }
}

// ── 종목 헤더 ────────────────────────────────────────────
function renderStockHeader(ticker, meta, bars, judgment) {
  const n      = bars.length;
  const last   = bars[n - 1];
  const isKRW  = (meta?.currency || "") !== "USD";
  const dec    = isKRW ? 0 : 2;

  // meta.regularMarketPrice = 가장 최신 현재가 (장중/프리마켓 포함)
  // bars[-1].close = 마지막 완성 봉 종가 (오늘 미완성 봉은 close=null로 이미 필터됨)
  const price     = (meta?.regularMarketPrice != null) ? meta.regularMarketPrice : last.close;
  const lastClose = last.close;

  // prev 결정: price와 lastClose가 유의미하게 다르면 장중/프리마켓 → prev = lastClose(어제)
  //            거의 같으면 장후/마감 상태 → prev = 전전일 종가
  const prevClose = n >= 2 ? bars[n - 2].close : null;
  const prev = (lastClose != null && Math.abs(price - lastClose) > lastClose * 0.001)
    ? lastClose
    : prevClose;

  const chgAbs = prev != null ? price - prev : 0;
  const chgPct = (prev != null && prev > 0) ? (chgAbs / prev) * 100 : 0;
  const sign   = chgPct >= 0 ? "+" : "";

  const _set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  _set("stockName",     meta?.shortName || meta?.longName || ticker);
  _set("stockTicker",   ticker);
  _set("stockExchange", meta?.exchangeName || meta?.fullExchangeName || "");
  _set("stockCurrency", meta?.currency || "");
  _set("stockPrice",     fmt(price, dec));
  const dayChgEl = document.getElementById("stockDayChg");
  if (dayChgEl) {
    dayChgEl.textContent = `${sign}${fmt(Math.abs(chgAbs), dec)} (${sign}${chgPct.toFixed(2)}%)`;
    dayChgEl.className   = "sh-daychg " + (chgPct >= 0 ? "bull" : "bear");
  }
  const fis = judgment.fis ?? 0;
  const col = judgment.label_color || fisColor(fis);
  const fisBadge  = document.getElementById("fisBadge");
  const labelChip = document.getElementById("labelChip");
  if (fisBadge)  { fisBadge.textContent = `FIS ${fis>=0?"+":""}${fis.toFixed(0)}`; fisBadge.style.background=col; fisBadge.style.color="#fff"; }
  if (labelChip) { labelChip.textContent = judgment.label||""; labelChip.style.borderColor=col; labelChip.style.color=col; }
}

// ── 차트 렌더 ────────────────────────────────────────────
function renderChart(bars, fisBars, tf, meta) {
  const mainEl = document.getElementById("mainChartEl");
  const volEl  = document.getElementById("volChartEl");
  const macdEl = document.getElementById("macdChartEl");

  if (!mainEl || typeof LightweightCharts === "undefined") return;

  mainEl.innerHTML = ""; if(volEl) volEl.innerHTML = ""; if(macdEl) macdEl.innerHTML = "";
  // 구름대 캔버스 정리
  const oldCanvas = document.getElementById("cloudCanvas");
  if (oldCanvas) oldCanvas.remove();

  const bg  = getComputedStyle(document.documentElement).getPropertyValue("--newsprint-bg").trim()  || "#F9F9F7";
  const txt = getComputedStyle(document.documentElement).getPropertyValue("--newsprint-ink").trim() || "#111111";
  const containerWidth = mainEl.clientWidth || 800;

  const baseOpts = {
    layout:{ background:{color:bg}, textColor:txt },
    grid:{ vertLines:{color:"#e8e8e5"}, horzLines:{color:"#e8e8e5"} },
    rightPriceScale:{borderColor:"#ccc"}
  };

  _chart = LightweightCharts.createChart(mainEl, {
    ...baseOpts,
    width: containerWidth,
    height: 500,
    timeScale:{borderColor:"#ccc", timeVisible:tf!=="1d"},
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      horzLine: { labelVisible: true },
      vertLine: { labelVisible: true },
    },
  });

  // Y축 상하 여백: 기본 10% → 6%로 축소 (차트 공간 극대화)
  _chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } });

  const candles = _chart.addCandlestickSeries({
    upColor:"#CC0000", downColor:"#0047AB", borderUpColor:"#CC0000",
    borderDownColor:"#0047AB", wickUpColor:"#CC0000", wickDownColor:"#0047AB",
    crosshairMarkerVisible: true,
  });
  candles.setData(bars.map(b => ({time:b.time, open:b.open, high:b.high, low:b.low, close:b.close})));

  // 보조선: crosshairMarkerVisible:false 로 커서점 제거 → Y축엔 캔들 가격만 표시됨
  const toSeries = (arr, key, col, width) => {
    const data = arr.map(b=>{ const v=b[key]; return (v!=null&&!isNaN(v))?{time:b.time,value:v}:null; }).filter(Boolean);
    if (data.length) _chart.addLineSeries({color:col,lineWidth:width,lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false}).setData(data);
  };
  toSeries(fisBars,"EMA20","#E57373",1);
  toSeries(fisBars,"EMA60","#1565C0",1);
  toSeries(fisBars,"EMA120","#888888",1);
  toSeries(fisBars,"ICH_TENKAN","#0047AB",1);
  toSeries(fisBars,"ICH_KIJUN","#CC0000",1);

  // 볼린저밴드
  const bbUp = fisBars.map(b=>b.BB_UP!=null&&!isNaN(b.BB_UP)?{time:b.time,value:b.BB_UP}:null).filter(Boolean);
  const bbDn = fisBars.map(b=>b.BB_DN!=null&&!isNaN(b.BB_DN)?{time:b.time,value:b.BB_DN}:null).filter(Boolean);
  if (bbUp.length) _chart.addLineSeries({color:"rgba(150,150,150,0.5)",lineWidth:1,lineStyle:2,lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false}).setData(bbUp);
  if (bbDn.length) _chart.addLineSeries({color:"rgba(150,150,150,0.5)",lineWidth:1,lineStyle:2,lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false}).setData(bbDn);

  if (volEl) {
    _volChart = LightweightCharts.createChart(volEl, {
      ...baseOpts, width: containerWidth, height: 120,
      timeScale:{borderColor:"#ccc", timeVisible:tf!=="1d"}
    });
    _volChart.priceScale("right").applyOptions({ scaleMargins:{top:0.1,bottom:0} });
    _volChart.addHistogramSeries({priceFormat:{type:"volume"}}).setData(bars.map(b=>({time:b.time, value:b.volume, color:b.close>=b.open?"#CC000055":"#0047AB55"})));
    _chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{ if(r&&_volChart) _volChart.timeScale().setVisibleLogicalRange(r); });
    // volChart 역방향 동기화는 아래 통합 시점에서 등록
  }

  if (macdEl) {
    _macdChart = LightweightCharts.createChart(macdEl, {
      ...baseOpts, width: containerWidth, height: 100,
      timeScale:{borderColor:"#ccc", timeVisible:tf!=="1d"}
    });
    _macdChart.priceScale("right").applyOptions({ scaleMargins:{top:0.1,bottom:0.1} });
    const macdData   = fisBars.map(b=>b.MACD!=null&&!isNaN(b.MACD)?{time:b.time,value:b.MACD}:null).filter(Boolean);
    const signalData = fisBars.map(b=>b.MACD_SIGNAL!=null&&!isNaN(b.MACD_SIGNAL)?{time:b.time,value:b.MACD_SIGNAL}:null).filter(Boolean);
    const histData   = fisBars.map(b=>{
      if (b.MACD==null||b.MACD_SIGNAL==null||isNaN(b.MACD)||isNaN(b.MACD_SIGNAL)) return null;
      const hist = b.MACD - b.MACD_SIGNAL;
      return {time:b.time, value:hist, color:hist>=0?"#CC000088":"#0047AB88"};
    }).filter(Boolean);
    if (histData.length)   _macdChart.addHistogramSeries({priceFormat:{type:"price"},title:"MACD Hist"}).setData(histData);
    if (macdData.length)   _macdChart.addLineSeries({color:"#CC0000",lineWidth:1,title:"MACD"}).setData(macdData);
    if (signalData.length) _macdChart.addLineSeries({color:"#1565C0",lineWidth:1,title:"Signal"}).setData(signalData);
    _chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{ if(r&&_macdChart) _macdChart.timeScale().setVisibleLogicalRange(r); });
    // macdChart 역방향 동기화는 아래 통합 시점에서 등록
  }

  _chart.timeScale().fitContent();

  // ── 구름대 (Ichimoku Cloud) — canvas overlay ────────────────────
  const cloudCanvas = document.createElement("canvas");
  cloudCanvas.id = "cloudCanvas";
  cloudCanvas.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:1;";
  mainEl.style.position = "relative";
  mainEl.appendChild(cloudCanvas);

  // Senkou_A / Senkou_B 데이터 맵 (time → value)
  const senkouA_map = {};
  const senkouB_map = {};
  for (const b of fisBars) {
    if (b.ICH_SENKOU_A != null && !isNaN(b.ICH_SENKOU_A)) senkouA_map[b.time] = b.ICH_SENKOU_A;
    if (b.ICH_SENKOU_B != null && !isNaN(b.ICH_SENKOU_B)) senkouB_map[b.time] = b.ICH_SENKOU_B;
  }

  function drawCloud() {
    const w = mainEl.clientWidth;
    const h = mainEl.clientHeight || 500;
    cloudCanvas.width  = w;
    cloudCanvas.height = h;
    const ctx2 = cloudCanvas.getContext("2d");
    ctx2.clearRect(0, 0, w, h);

    const times = Object.keys(senkouA_map).sort();
    if (!times.length) return;

    // 연속된 구간을 색상별로 그리기
    let segment = [];
    let lastColor = null;

    const flush = (color) => {
      if (segment.length < 2) { segment = []; return; }
      ctx2.beginPath();
      // 위쪽 라인 (A side)
      const first = segment[0];
      ctx2.moveTo(first.x, first.yA);
      for (const pt of segment) ctx2.lineTo(pt.x, pt.yA);
      // 아래쪽 라인 (B side), 역방향
      for (let i = segment.length - 1; i >= 0; i--) ctx2.lineTo(segment[i].x, segment[i].yB);
      ctx2.closePath();
      ctx2.fillStyle = color;
      ctx2.fill();
      segment = [];
    };

    for (const t of times) {
      const a = senkouA_map[t];
      const b2 = senkouB_map[t];
      if (a == null || b2 == null) { flush(lastColor); continue; }

      // LightweightCharts v4: priceToCoordinate는 series 메서드 (priceScale에서 제거됨)
      let xCoord;
      try { xCoord = _chart.timeScale().timeToCoordinate(t); } catch(e) { continue; }
      let yA, yB;
      try { yA = candles.priceToCoordinate(a); } catch(e) { continue; }
      try { yB = candles.priceToCoordinate(b2); } catch(e) { continue; }

      if (xCoord == null || yA == null || yB == null) { flush(lastColor); continue; }
      if (xCoord < 0 || xCoord > w) { flush(lastColor); continue; }

      const color = a >= b2 ? "rgba(204,0,0,0.12)" : "rgba(0,71,171,0.12)";
      if (color !== lastColor && segment.length) flush(lastColor);
      lastColor = color;
      segment.push({ x: xCoord, yA, yB });
    }
    flush(lastColor);
  }

  // 초기 드로우 + 범위 변경 시 재드로우
  setTimeout(drawCloud, 100);
  // ── 모든 패널 시간축 양방향 동기화 (어떤 패널에서 휠을 돌려도 전체 확대/축소) ──
  let _syncingRange = false;
  function _syncTimeRange(src, r) {
    if (_syncingRange || !r) return;
    _syncingRange = true;
    if (src !== _chart    && _chart)     _chart.timeScale().setVisibleLogicalRange(r);
    if (src !== _volChart  && _volChart)  _volChart.timeScale().setVisibleLogicalRange(r);
    if (src !== _macdChart && _macdChart) _macdChart.timeScale().setVisibleLogicalRange(r);
    setTimeout(drawCloud, 30);
    _syncingRange = false;
  }
  _chart.timeScale().subscribeVisibleLogicalRangeChange(r => _syncTimeRange(_chart, r));
  if (_volChart)  _volChart.timeScale().subscribeVisibleLogicalRangeChange(r => _syncTimeRange(_volChart, r));
  if (_macdChart) _macdChart.timeScale().subscribeVisibleLogicalRangeChange(r => _syncTimeRange(_macdChart, r));

  // ── 크로스헤어 범례 ────────────────────────────────────────────
  const chartStage = document.getElementById("chartStage");
  const existLegend = document.getElementById("chartLegend");
  if (existLegend) existLegend.remove();
  const legendEl = document.createElement("div");
  legendEl.id = "chartLegend";
  legendEl.style.cssText = "position:absolute;top:6px;left:8px;z-index:10;font-size:11.5px;color:var(--newsprint-ink,#111);display:flex;gap:10px;flex-wrap:wrap;pointer-events:none;background:rgba(249,249,247,0.9);padding:3px 8px;border:1px solid rgba(0,0,0,0.08);";
  if (chartStage) chartStage.appendChild(legendEl);

  const _isKRW = (meta?.currency || "") !== "USD";
  const _dec   = _isKRW ? 0 : 2;

  _chart.subscribeCrosshairMove(param => {
    if (!param.time || !param.point) { legendEl.innerHTML = ""; return; }
    const cd = param.seriesData.get(candles);
    if (!cd) return;
    const bull = cd.close >= cd.open;
    const t = typeof param.time === "object"
      ? `${param.time.year}-${String(param.time.month).padStart(2,"0")}-${String(param.time.day).padStart(2,"0")}`
      : param.time;
    legendEl.innerHTML =
      `<span style="color:#888">${t}</span>` +
      `<span>시 <b>${fmt(cd.open,_dec)}</b></span>` +
      `<span style="color:#CC0000">고 <b>${fmt(cd.high,_dec)}</b></span>` +
      `<span style="color:#0047AB">저 <b>${fmt(cd.low,_dec)}</b></span>` +
      `<span style="color:${bull?"#CC0000":"#0047AB"};font-weight:700">종 <b>${fmt(cd.close,_dec)}</b></span>`;
  });

  // ── 이벤트 마커 (작은 표식) + 클릭 팝업 ────────────────────────
  const markerDefs = [];
  for (let mi = 1; mi < fisBars.length; mi++) {
    const b = fisBars[mi], pb = fisBars[mi - 1];
    if (pb.EMA20 != null && pb.EMA60 != null && b.EMA20 != null && b.EMA60 != null) {
      if (pb.EMA20 <= pb.EMA60 && b.EMA20 > b.EMA60)
        markerDefs.push({ time: b.time, position: "belowBar", color: "#CC0000", shape: "arrowUp",   text: "GC",
          title: "EMA 골든크로스", desc: `EMA20(${fmt(b.EMA20,_dec)})이 EMA60(${fmt(b.EMA60,_dec)})을 상향 돌파. 중기 추세 전환 신호.` });
      if (pb.EMA20 >= pb.EMA60 && b.EMA20 < b.EMA60)
        markerDefs.push({ time: b.time, position: "aboveBar", color: "#0047AB", shape: "arrowDown", text: "DC",
          title: "EMA 데드크로스", desc: `EMA20(${fmt(b.EMA20,_dec)})이 EMA60(${fmt(b.EMA60,_dec)})을 하향 돌파. 중기 추세 약화 신호.` });
    }
    if (pb.MACD != null && pb.MACD_SIGNAL != null && b.MACD != null && b.MACD_SIGNAL != null) {
      if (pb.MACD <= pb.MACD_SIGNAL && b.MACD > b.MACD_SIGNAL)
        markerDefs.push({ time: b.time, position: "belowBar", color: "#2ea043", shape: "circle", text: "M↑",
          title: "MACD 골든크로스", desc: `MACD(${b.MACD.toFixed(2)})가 Signal(${b.MACD_SIGNAL.toFixed(2)})을 상향 돌파. 단기 모멘텀 전환.` });
      if (pb.MACD >= pb.MACD_SIGNAL && b.MACD < b.MACD_SIGNAL)
        markerDefs.push({ time: b.time, position: "aboveBar", color: "#e53935", shape: "circle", text: "M↓",
          title: "MACD 데드크로스", desc: `MACD(${b.MACD.toFixed(2)})가 Signal(${b.MACD_SIGNAL.toFixed(2)})을 하향 돌파. 단기 모멘텀 둔화.` });
    }
    if (pb.RSI14 != null && b.RSI14 != null && pb.RSI14 < 30 && b.RSI14 >= 30)
      markerDefs.push({ time: b.time, position: "belowBar", color: "#d29922", shape: "arrowUp", text: "R↑",
        title: "RSI 과매도 탈출", desc: `RSI가 ${pb.RSI14.toFixed(1)} → ${b.RSI14.toFixed(1)}으로 30 돌파. 과매도 해소, 반등 시도 신호.` });
    if (pb.RSI14 != null && b.RSI14 != null && pb.RSI14 < 70 && b.RSI14 >= 70)
      markerDefs.push({ time: b.time, position: "aboveBar", color: "#e53935", shape: "circle", text: "R↑",
        title: "RSI 과매수 진입", desc: `RSI가 ${pb.RSI14.toFixed(1)} → ${b.RSI14.toFixed(1)}으로 70 돌파. 단기 과열 구간 진입.` });
  }

  // 마커 표시 (text 짧게 유지해 차트 가림 최소화)
  const markersForChart = markerDefs.map(m => ({
    time: m.time, position: m.position, color: m.color, shape: m.shape, text: m.text
  })).sort((a, b) => (a.time < b.time ? -1 : 1));
  if (markersForChart.length) candles.setMarkers(markersForChart);

  // 마커 클릭 팝업 — 클릭 위치에 해당하는 마커 찾아 툴팁 표시
  const markerMap = {};
  for (const m of markerDefs) {
    markerMap[m.time] = markerMap[m.time] || [];
    markerMap[m.time].push(m);
  }

  // 툴팁 요소 생성
  const existTip = document.getElementById("signalTooltip");
  if (existTip) existTip.remove();
  const tipEl = document.createElement("div");
  tipEl.id = "signalTooltip";
  tipEl.style.cssText = "display:none;position:absolute;z-index:20;background:rgba(249,249,247,0.98);border:1px solid var(--newsprint-ink,#111);padding:10px 12px;max-width:240px;font-size:11.5px;line-height:1.6;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.12);";
  if (chartStage) chartStage.appendChild(tipEl);

  _chart.subscribeClick(param => {
    if (!param.time) { tipEl.style.display = "none"; return; }
    const timeKey = typeof param.time === "object"
      ? `${param.time.year}-${String(param.time.month).padStart(2,"0")}-${String(param.time.day).padStart(2,"0")}`
      : param.time;
    const signals = markerMap[timeKey];
    if (!signals || !signals.length) { tipEl.style.display = "none"; return; }
    const html = signals.map(s =>
      `<div style="margin-bottom:4px"><b style="color:${s.color}">${s.title}</b><br><span style="color:#555">${s.desc}</span></div>`
    ).join("");
    tipEl.innerHTML = html;
    // 위치: 클릭 좌표 기준
    const x = (param.point?.x || 0);
    const y = (param.point?.y || 0);
    const tipW = 240, tipH = 80;
    const stageW = mainEl.clientWidth;
    tipEl.style.left = (x + tipW > stageW ? x - tipW - 4 : x + 8) + "px";
    tipEl.style.top  = Math.max(0, y - 10) + "px";
    tipEl.style.display = "block";
    // 3초 후 자동 닫기
    clearTimeout(tipEl._timer);
    tipEl._timer = setTimeout(() => { tipEl.style.display = "none"; }, 4000);
  });

  // 리사이즈 대응
  const ro = new ResizeObserver(() => {
    const newWidth = mainEl.clientWidth;
    if (newWidth === 0) return;
    if(_chart)    _chart.applyOptions({ width: newWidth });
    if(_volChart) _volChart.applyOptions({ width: newWidth });
    if(_macdChart)_macdChart.applyOptions({ width: newWidth });
    setTimeout(drawCloud, 50);
  });
  ro.observe(mainEl);
}

// ── 종합 판단 사이드바 ───────────────────────────────────
function renderJudgment(j) {
  _currentFIS = j?.fis ?? 0;
  const _set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  _set("judgeL1", j.summary_l1 || "");
  _set("judgeL2", j.summary_l2 || "");
  const bars6 = [
    { label:"추세",     score:j.scores?.["추세"]    ?? 0, max:30 },
    { label:"모멘텀",  score:j.scores?.["모멘텀"]  ?? 0, max:20 },
    { label:"구조",    score:j.scores?.["구조"]    ?? 0, max:20 },
    { label:"압축",    score:j.scores?.["압축"]    ?? 0, max:20 },
    { label:"거래량",  score:j.scores?.["거래량"]  ?? 0, max:10 },
    { label:"위험감점",score:j.scores?.["위험감점"]?? 0, max:30, negOnly:true },
  ];
  const scoreBarsEl = document.getElementById("scoreBars");
  if (scoreBarsEl) {
    scoreBarsEl.innerHTML = bars6.map(b => {
      const v    = b.score;
      // 중립(0)을 50%로, 최대값을 100%로, 최소값(-max)을 0%로 매핑
      const pct  = Math.max(0, Math.min(100, ((v + b.max) / (b.max * 2)) * 100));
      const col  = v >= b.max * 0.5 ? "#2ea043" : v >= 0 ? "#56a0d3" : "#e53935";
      const sign = v >= 0 ? "+" : "";
      return `<div class="sb-row">
        <span class="sb-label">${b.label}</span>
        <div class="sb-track">
          <div class="sb-fill" style="width:${pct.toFixed(0)}%;background:${col}"></div>
        </div>
        <span class="sb-val" style="color:${col}">${sign}${v.toFixed(1)}</span>
      </div>`;
    }).join("");
  }
}

// ── 진입 점수 ────────────────────────────────────────────
// ── 진입 분석 요약 (종목별 실수치 기반 자연어 생성) ──────────────────────
function _buildAnalysisSummary(score, comp, m, setupName, setupName2) {
  const ctx      = comp["추세문맥"]   ?? 0;
  const structure= comp["진입구조"]   ?? 0;
  const confirm  = comp["확인신호"]   ?? 0;
  const space    = comp["저항여유"]   ?? 0;
  const riskCtrl = comp["리스크관리"] ?? 0;

  const gapPct = m.ema20_gap_pct ?? 0;
  const gapAtr = m.ema20_gap_atr ?? 0;
  const bbPos  = m.bb_pos        ?? 50;
  const pos52  = m.range_pos     ?? 50;
  const pbPct  = m.pullback_pct  ?? 0;
  const bncPct = m.bounce_pct    ?? 0;
  const rsi    = m.rsi_reset     ?? 50;
  const adx    = m.adx           ?? 0;
  const gapSign= gapPct >= 0 ? "+" : "";

  const parts = [];

  // ① 패턴 + 추세 상황
  const trendOk = ctx >= 16;
  if (setupName === "추세 눌림") {
    if (trendOk && pbPct >= 4 && pbPct <= 15) {
      parts.push(`상승 추세 중 ${pbPct.toFixed(1)}% 눌림 후 EMA20 근처(${gapSign}${gapPct.toFixed(1)}%)에서 지지 테스트 중 — 눌림목 진입 구조 확인`);
    } else if (!trendOk) {
      parts.push(`눌림목 형태이나 추세 환경(추세문맥 ${ctx}pt)이 약해 단순 하락일 가능성 병존`);
    } else {
      parts.push(`추세 눌림 구조이나 EMA20 이격(${gapSign}${gapPct.toFixed(1)}%) 또는 조정 깊이(${pbPct.toFixed(1)}%)가 기준 범위 벗어남`);
    }
  } else if (setupName === "압축 돌파") {
    if (trendOk) {
      parts.push(`BB 밴드 ${bbPos.toFixed(0)}% 위치에서 에너지 압축 후 상단 돌파 시도 중 — 거래량 동반 여부가 관건`);
    } else {
      parts.push(`BB 압축 돌파 패턴이나 추세 배경(추세문맥 ${ctx}pt) 부족 — 돌파 실패 시 되돌림 위험 주의`);
    }
  } else if (setupName === "모멘텀 지속") {
    parts.push(`정배열 상승 추세에서 모멘텀 지속 중 — EMA20 위 ${gapPct.toFixed(1)}% 이격, ADX ${adx.toFixed(0)}으로 추세 강도 ${adx >= 22 ? "강함" : adx >= 15 ? "중간" : "약함"}`);
  } else if (setupName === "반전 초기") {
    parts.push(`과매도 구간(RSI ${rsi.toFixed(0)})에서 최근 저점 대비 ${bncPct.toFixed(1)}% 대반등 — 반전 초기 신호, 추세 전환 확인 단계`);
  } else {
    parts.push(`${setupName} 패턴 — EMA20 이격 ${gapSign}${gapPct.toFixed(1)}%, 추세문맥 ${ctx}pt`);
  }

  // ② RSI 상태
  if (rsi >= 70) {
    parts.push(`RSI ${rsi.toFixed(0)}으로 단기 과매수 — 급등 추격보다 눌림 재진입 대기가 유리`);
  } else if (rsi >= 60) {
    parts.push(`RSI ${rsi.toFixed(0)}으로 강세권 진입, 과열은 아직 아님`);
  } else if (rsi >= 42) {
    parts.push(`RSI ${rsi.toFixed(0)} — 과열 없이 에너지 축적 중인 건강한 구간`);
  } else if (rsi >= 30) {
    parts.push(`RSI ${rsi.toFixed(0)}으로 약세권 — 반등 시도는 있으나 추세 회복 확인 필요`);
  } else {
    parts.push(`RSI ${rsi.toFixed(0)}까지 과매도 — 기술적 반등 가능하나 추세 훼손 여부 점검 필수`);
  }

  // ③ 저항 / BB 상단 여유
  if (bbPos <= 75 && space >= 10) {
    parts.push(`BB 상단까지 여유(${bbPos.toFixed(0)}%), 52주 고점 ${pos52.toFixed(0)}% 위치로 추가 상승 공간 충분`);
  } else if (bbPos > 85 || space < 4) {
    parts.push(`BB 상단(${bbPos.toFixed(0)}%) · 52주 고점(${pos52.toFixed(0)}%)에 근접해 저항 부담 — 무리한 추격 자제`);
  } else {
    parts.push(`BB ${bbPos.toFixed(0)}% · 52주 ${pos52.toFixed(0)}% 위치, 저항까지 제한적 공간`);
  }

  // ④ 종합 액션
  let action;
  if (score >= 80) {
    const atrNote = gapAtr > 2.5 ? `, ATR 이격(${gapAtr.toFixed(1)}) 과대한 점 감안` : "";
    const _fw = (comp['추세신선도']??0) <= -4 ? ' ⚠ 추세 후반(' + (m.freshness_bars??'?') + '봉 경과) — 기계적 백테스트 확인 필수' : '';
    action = '→ 조건 충족' + atrNote + '. Chandelier 손절 + ATR×2 익절 설정 후 집행' + _fw;
  } else if (score >= 65) {
    const weak = [
      { name: "확인신호",   v: confirm,   thr: 16 },
      { name: "저항여유",   v: space,     thr: 10 },
      { name: "리스크관리", v: riskCtrl,  thr: 10 },
      { name: "진입구조",   v: structure, thr: 20 },
    ].filter(x => x.v < x.thr).map(x => x.name).slice(0, 2);
    const ws = weak.length ? `${weak.join("·")} 보완 필요` : "추가 확인 권장";
    action = `→ 분할 진입 검토. ${ws}. 1차 소량 진입 후 다음 봉 확인 시 비중 추가`;
  } else if (score >= 50) {
    const weak = [
      { name: "추세문맥", v: ctx,       thr: 16 },
      { name: "진입구조", v: structure, thr: 20 },
      { name: "확인신호", v: confirm,   thr: 12 },
    ].filter(x => x.v < x.thr).map(x => x.name).slice(0, 2);
    action = `→ ${weak.join("·")} 조건 미충족. 한 봉 이상 더 지켜본 후 진입 여부 결정`;
  } else {
    const worst = [
      { name: "추세문맥", v: ctx },
      { name: "진입구조", v: structure },
      { name: "확인신호", v: confirm },
    ].sort((a, b) => a.v - b.v)[0];
    action = `→ ${worst.name}(${worst.v}pt) 등 핵심 조건 미달. 관망 후 조건 갖춰질 때 재평가`;
  }

  return parts.join(". ") + ". " + action;
}

function renderEntryScore(entry) {
  const score      = entry?.score ?? 0;
  const comp       = entry?.components || {};
  const setupName  = entry?.setup_name  || "일반";
  const setupName2 = entry?.setup_name2 || "";
  const setupScores= entry?.setup_scores || {};
  const m          = entry?.metrics || {};

  const ctx      = comp["추세문맥"]   ?? 0;
  const structure= comp["진입구조"]   ?? 0;
  const confirm  = comp["확인신호"]   ?? 0;
  const space    = comp["저항여유"]   ?? 0;
  const riskCtrl       = comp["리스크관리"] ?? 0;
  const freshnessScore = comp["추세신선도"] ?? 0;
  const freshnessBars  = m.freshness_bars ?? 99;
  _currentEntryScore = score;
  _currentFreshness  = freshnessScore;
  renderChecklist();

  // 배지 + 상태 텍스트
  const eCol = score >= 80 ? "#2ea043" : score >= 65 ? "#56d364" : score >= 50 ? "#d29922" : "#6e7681";
  const esBadge = document.getElementById("entryScoreBadge");
  if (esBadge) { esBadge.textContent = score.toFixed(0); esBadge.style.background = eCol; esBadge.style.color = "#fff"; }
  const statusEl = document.getElementById("entryStatus");
  const actionEl = document.getElementById("entryAction");
  if (statusEl) {
    statusEl.textContent =
      score >= 80 ? "최적 진입 구간" :
      score >= 65 ? "양호한 진입 구간" :
      score >= 50 ? "조건부 진입 가능" : "진입 대기 구간";
  }
  if (actionEl) {
    actionEl.textContent = _buildAnalysisSummary(score, comp, m, setupName, setupName2);
  }

  const metricsEl = document.getElementById("entryMetrics");
  if (!metricsEl) return;

  function compColor(v, good, danger) {
    return v >= good ? "#2ea043" : v < danger ? "#e53935" : "#d29922";
  }
  function valColor(v, lo, hi, revHi) {
    if (v >= lo && v <= hi) return "#2ea043";
    if (revHi != null && v > revHi) return "#e53935";
    return "#d29922";
  }

  // 시나리오 설명
  const setupDesc = {
    "추세 눌림":   "상승 추세 중 EMA 근처로 눌렸다가 재반등하는 구조. RSI 과열 해소 + 거래량 감소 후 반등이 핵심.",
    "압축 돌파":   "좁은 횡보로 에너지 압축 후 거래량 동반 상단 돌파. ATR·BB 수축 후 확장 시도.",
    "모멘텀 지속": "정배열(EMA10>20>60) 강세 추세에서 지속 상승. ROC·거래량 강세 유지가 핵심.",
    "반전 초기":   "과매도 후 바닥 반전 초기 신호. MACD 반전 + RSI 저점 반등 + 거래량 증가 확인.",
  };
  // 섹터·그룹 컨텍스트 표시
  const ctx_obj    = entry?.context || {};
  const extScore   = comp["섹터·그룹"] ?? null;
  const sectorTag  = ctx_obj.sectorName ? `<span class="es-ctx-tag">${ctx_obj.sectorName}</span>` : "";
  const groupTag   = ctx_obj.groupName  ? `<span class="es-ctx-tag">${ctx_obj.groupName}그룹</span>` : '<span class="es-ctx-tag es-ctx-none">독립/해당없음</span>';
  const extStr     = extScore != null ? (extScore >= 0 ? "+" : "") + extScore.toFixed(0) : "—";
  const extCol     = extScore == null ? "#888" : extScore > 0 ? "#56d364" : extScore < 0 ? "#e53935" : "#888";

  const setupChips = Object.entries(setupScores)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const cls = k === setupName ? " em-chip-best" : k === setupName2 ? " em-chip-2nd" : "";
      return `<span class="em-chip${cls}">${k} <b>${v.toFixed(0)}</b></span>`;
    }).join("");

  // 5개 구성요소 카드
  const compRows = [
    { num:"①", name:"추세 문맥", v:ctx, max:30, ideal:"24 이상 최적",
      desc: ctx>=24?"FIS·추세·ADX·구름 모두 매수 환경 충족":ctx>=16?"추세 방향 우세 — 일부 조건 미충족":ctx>=8?"중립 이상 — 추세 약세 주의":"추세 환경 부족 — 신중 접근" },
    { num:"②", name:`진입 구조 — ${setupName}${setupName2?" + "+setupName2:""}`, v:structure, max:30, ideal:"20 이상 최적",
      desc: setupDesc[setupName] || "—",
      extra: `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${setupChips}</div>` },
    { num:"③", name:"확인 신호", v:confirm, max:24, ideal:"16 이상 최적",
      desc: confirm>=18?"EMA·MACD·거래량·기준선 신호 모두 동반":confirm>=12?"핵심 신호 대부분 확인":confirm>=6?"일부 신호만 충족 — 추가 봉 확인 권장":"명확한 진입 신호 부족" },
    { num:"④", name:"저항 여유", v:space, max:18, ideal:"10 이상 최적",
      desc: space>=12?"52주·BB 상단 여유 충분 — 저항 부담 낮음":space>=6?"적정 상승 공간 확인":space>=0?"일부 저항 부담 있음":"상단 저항 과부담 — 추격 불리" },
    { num:"⑤", name:"리스크 관리", v:riskCtrl, max:16, ideal:"10 이상 최적",
      desc: riskCtrl>=12?"과열 없고 손절 거리 적정 — 위험 관리 양호":riskCtrl>=8?"리스크 통제 가능 수준":riskCtrl>=4?"일부 위험 요소 — 손절 기준 명확히 설정":"ATR 이격 크거나 위험 감점 높음" },
    { num:"⑦", name:"섹터·그룹 추세", v: extScore ?? 0, max:12,
      ideal:"섹터 ETF FIS 기반",
      desc: extScore == null ? "섹터/그룹 정보 없음 (메핑에 없는 종목)" :
            extScore >= 8 ? "섹터·그룹 모두 강세 — 추세력 듹반 효과" :
            extScore >= 3 ? "섹터 또는 그룹 업종 추세 양호" :
            extScore >= 0 ? "섹터·그룹 중립 — 종목 자체 모멘텀 집중" :
                            "섹터 또는 그룹 앝세 — 추가 주의",
      extra: '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' + sectorTag + groupTag + '<span style="color:' + extCol + ';font-weight:700">' + extStr + 'pt</span></div>' },
    { num:"⑨", name:"추세 신선도 (독립지표)", v: freshnessScore, max:8, ideal:"20봉 이내 최적",
      desc: freshnessBars === 0 ? "EMA20 < EMA60 — 하락/회bo 구간, 기계적 진입 비권장" :
            freshnessBars <= 10 ? `골든크로스 후 ${freshnessBars}봉 — 추세 초반 최적 진입 구간` :
            freshnessBars <= 20 ? `추세 진입 ${freshnessBars}봉 경과 — 상승 초중반, 기계적 진입 유효` :
            freshnessBars <= 35 ? `추세 진입 ${freshnessBars}봉 경과 — 중반, 상승 여력 점검 권장` :
            freshnessBars <= 55 ? `추세 진입 ${freshnessBars}봉 경과 — 후반 경고, 추격 매수 부담 증가` :
                                  `추세 진입 ${freshnessBars}봉+ 경과 — 매우 노후, 기계적 진입 자제 권장`,
      extra: `<div style="color:#888;font-size:10.5px;margin-top:4px">⚡ FIS·진입점수와 독립적 — 가격·지표 레벨이 아닌 추세 시간 경과 기반</div>` },
  ];

  const compHTML = compRows.map(r => {
    const pct = r.max > 0 ? Math.min(100, Math.max(0, r.v / r.max * 100)) : 0;
    const col = compColor(r.v, r.max * 0.7, r.max * 0.3);
    return `<div class="es-comp">
      <div class="es-comp-hd">
        <span class="es-comp-num">${r.num}</span>
        <span class="es-comp-name">${r.name}</span>
        <span class="es-comp-score" style="color:${col}">${r.v.toFixed(0)} <span class="es-comp-max">/ ${r.max}</span></span>
      </div>
      <div class="es-comp-bar"><div style="width:${pct.toFixed(0)}%;background:${col}"></div></div>
      <div class="es-comp-desc">${r.desc}</div>
      ${r.extra || ""}
    </div>`;
  }).join("");

  // 세부 수치 요약
  const ema20GapPct = m.ema20_gap_pct ?? 0;
  const ema20GapAtr = m.ema20_gap_atr ?? 0;
  const bbPos       = m.bb_pos        ?? 50;
  const pos52       = m.range_pos     ?? 50;
  const pbPct       = m.pullback_pct  ?? 0;
  const rsiVal      = m.rsi_reset     ?? 50;
  const adx         = m.adx           ?? 0;
  const emaSign     = ema20GapPct >= 0 ? "+" : "";
  const adxTip      = adx < 15 ? " ⚠" : "";

  const metricRows = [
    { label:"EMA20 이격", value:`${emaSign}${ema20GapPct.toFixed(1)}%`,              col:valColor(ema20GapPct,-1,4,12),    ideal:"-1~+4% 이상적" },
    { label:"ATR 이격",   value:`${ema20GapAtr>=0?"+":""}${ema20GapAtr.toFixed(2)} ATR`, col:valColor(ema20GapAtr,-0.5,1.2,3), ideal:"-0.5~+1.2 이상적" },
    { label:"RSI",        value:rsiVal.toFixed(1),                                   col:valColor(rsiVal,42,60,73),        ideal:"42~60 이상적" },
    { label:"BB 위치",    value:`${bbPos.toFixed(0)}%`,                              col:valColor(bbPos,35,75,90),         ideal:"35~75% 이상적" },
    { label:"52주 위치",  value:`${pos52.toFixed(0)}%`,                              col:valColor(pos52,55,90,97),         ideal:"55~90% 이상적" },
    { label:"최근 조정",  value:`-${pbPct.toFixed(1)}%`,                             col:valColor(pbPct,4,12,20),          ideal:"4~12% 이상적" },
    { label:"ADX",        value:`${adx.toFixed(1)}${adxTip}`,                        col:adx>=20?"#2ea043":adx>=15?"#d29922":"#e53935", ideal:"20+ 추세 지속력" },
  ].map(r => `<div class="es-metric-row">
    <span class="es-metric-label">${r.label}</span>
    <span class="es-metric-value" style="color:${r.col}">${r.value}</span>
    <span class="es-metric-ideal">${r.ideal}</span>
  </div>`).join("");

  metricsEl.innerHTML = compHTML +
    `<div class="es-metric-block"><div class="es-metric-title">📐 세부 수치</div>${metricRows}</div>`;
}
// ── 지표 칩 ─────────────────────────────────────────────
function renderChips(j, fisBars) {
  const row = fisBars[fisBars.length - 1];
  if (!row) return;
  const rsi   = row.RSI14, rvol = row.RVOL, atr = row.ATR14, close = row.close;
  const bb_up = row.BB_UP, bb_dn = row.BB_DN;
  const rh = row.RangeHigh, rl = row.RangeLow;

  function rsiStatus(v)  { return v >= 70 ? "과매수" : v <= 30 ? "과매도" : "중립"; }
  function rsiColor(v)   { return v >= 70 ? "var(--bear,#e53935)" : v <= 30 ? "var(--bull,#2ea043)" : "var(--text2,#666)"; }
  function rvolStatus(v) { return v >= 1.5 ? "거래 급증" : v >= 1.0 ? "보통" : "거래 감소"; }

  const ichParts = (j.ichimoku_status || "").split("—");
  const ichVal = ichParts[0]?.trim() || "—";
  const ichSub = (ichParts[1] || "").trim();

  const bbPosPct = (bb_up != null && bb_dn != null && bb_up > bb_dn)
    ? Math.round((close - bb_dn) / (bb_up - bb_dn) * 100) : null;
  const pos52Pct = (rh && rl && rh > rl)
    ? Math.round((close - rl) / (rh - rl) * 100) : null;

  const chips = [
    { label:"RSI(14)",  value: rsi  != null ? rsi.toFixed(1)    : "—", sub: rsi  != null ? rsiStatus(rsi)   : "", color: rsi  != null ? rsiColor(rsi)                                  : "var(--text2)" },
    { label:"RVOL",     value: rvol != null ? rvol.toFixed(2)+"x": "—", sub: rvol != null ? rvolStatus(rvol) : "", color: rvol != null ? (rvol >= 1.5 ? "var(--bull,#2ea043)" : "var(--text2,#666)") : "var(--text2)" },
    { label:"ATR(14)",  value: atr  != null ? fmt(atr, 2)        : "—", sub: "변동폭",                             color: "var(--text2,#666)" },
    { label:"일목",     value: ichVal,                                   sub: ichSub,                              color: "var(--accent,#1565C0)" },
    ...(bbPosPct != null ? [{ label:"BB 위치",   value: bbPosPct+"%",  sub: bbPosPct>=80?"상단 과열":bbPosPct<=20?"하단 저평":"중립", color: bbPosPct>=80?"var(--bear,#e53935)":bbPosPct<=20?"var(--bull,#2ea043)":"var(--text2,#666)" }] : []),
    ...(pos52Pct != null ? [{ label:"52주 위치", value: pos52Pct+"%",  sub: pos52Pct>=95?"고점 저항권":pos52Pct>=65?"추세 상위권":"하위권", color: pos52Pct>=95?"var(--bear,#e53935)":pos52Pct>=65?"var(--bull,#2ea043)":"var(--text2,#666)" }] : []),
  ];

  const chipGrid = document.getElementById("indicatorChips");
  if (chipGrid) chipGrid.innerHTML = chips.map(c =>
    `<div class="chip">
      <span class="chip-label">${c.label}</span>
      <span class="chip-value" style="color:${c.color}">${c.value}</span>
      <span class="chip-sub">${c.sub}</span>
    </div>`
  ).join("");
}
function renderTable(fisBars) {
  const recent = fisBars.slice(-30).reverse();
  const headEl = document.getElementById("tableHead");
  const bodyEl = document.getElementById("tableBody");
  if (!headEl || !bodyEl) return;
  headEl.innerHTML = `<tr><th>날짜</th><th>시가</th><th>고가</th><th>저가</th><th>종가</th><th>거래량</th><th>FIS</th><th>RSI</th><th>RVOL</th></tr>`;
  bodyEl.innerHTML = recent.map(b => {
    const dir = b.close >= b.open ? "bull" : "bear";
    const fis = b.FIS; const rsi = b.RSI14; const rvol = b.RVOL;
    return `<tr>
      <td>${b.time}</td>
      <td>${fmt(b.open,0)}</td>
      <td class="bull">${fmt(b.high,0)}</td>
      <td class="bear">${fmt(b.low,0)}</td>
      <td class="${dir}" style="font-weight:700">${fmt(b.close,0)}</td>
      <td>${fmtVol(b.volume)}</td>
      <td class="${fis>=30?"bull":fis<=-30?"bear":""}">${fis!=null&&!isNaN(fis)?(fis>=0?"+":"")+fis.toFixed(1):"—"}</td>
      <td class="${rsi>=70?"bear":rsi<=30?"bull":""}">${rsi!=null&&!isNaN(rsi)?rsi.toFixed(1):"—"}</td>
      <td class="${rvol>=1.5?"bull":""}">${rvol!=null&&!isNaN(rvol)?rvol.toFixed(2)+"x":"—"}</td>
    </tr>`;
  }).join("");
}

// ── 진입 점수 백테스트 (현재 종목 기준) ─────────────────────────────────
function runBacktest(fisBars) {
  // 다중 기간 백테스트: +1봉, +3봉, +5봉 종가 상승률 + MFE(5봉내 +1% 도달률)
  // 진입점수는 1봉 예측이 아닌 스윙 세팅 품질 지표 → 5봉 기준이 의미 있음
  const MIN_LOOKBACK = 80;
  const n = fisBars.length;
  if (n < MIN_LOOKBACK + 6) return null;

  const PERIODS = [1, 3, 5];
  const keys = ["90+", "80-90", "65-80", "50-65", "50미만"];
  const COLORS = {"90+":"#1a7a34","80-90":"#2ea043","65-80":"#56a0d3","50-65":"#d29922","50미만":"#888"};
  const buckets = {};
  for (const k of keys) {
    buckets[k] = { color: COLORS[k], counts:{1:0,3:0,5:0,mfe:0}, wins:{1:0,3:0,5:0,mfe:0} };
  }
  const mechTrades = [];

  for (let i = MIN_LOOKBACK; i < n - 5; i++) {
    const slice = fisBars.slice(0, i + 1);
    const score = calcEntryScore(slice).score;
    if (score < 0) continue;  // 음수 제외 (100점 클램프 범위 밖)
    const curClose = fisBars[i].close;
    if (!curClose || curClose <= 0) continue;

    const key = score >= 90 ? "90+" : score >= 80 ? "80-90" : score >= 65 ? "65-80" : score >= 50 ? "50-65" : "50미만";

    for (const p of PERIODS) {
      if (i + p >= n) continue;
      const fwdClose = fisBars[i + p]?.close;
      if (!fwdClose) continue;
      buckets[key].counts[p]++;
      if (fwdClose > curClose) buckets[key].wins[p]++;
    }
    // MFE: 5봉 내 현재가 대비 +1% 이상 고점 도달 여부 (수익 기회율)
    const endIdx = Math.min(i + 5, n - 1);
    let hadMFE = false;
    for (let j = i + 1; j <= endIdx; j++) {
      if ((fisBars[j]?.high || 0) > curClose * 1.02) { hadMFE = true; break; }
    }
    buckets[key].counts.mfe++;
    if (hadMFE) buckets[key].wins.mfe++;


    // 기계적 전략 시뮬: FIS>=60 AND 진입점수>=65 (신호 조건 일치) 시
    if (score >= 65 && (fisBars[i].FIS || 0) >= 60 && i + 1 < n && i <= n - 26) {
      const atr = fisBars[i].ATR14 || 0;
      const ema20 = fisBars[i].EMA20 || 0;
      if (atr > 0 && ema20 > 0) {
        const stopPrice = ema20 - atr;          // EMA20-ATR (기본 손절)
        const nextBar = fisBars[i + 1];
        const entryPrice = nextBar ? (nextBar.open || nextBar.close || 0) : 0;
        const rr_risk = entryPrice - stopPrice;
        if (entryPrice > 0 && stopPrice > 0 && stopPrice < entryPrice && (atr * 3) / rr_risk >= 1.5) {
          const tp1Price = entryPrice + atr * 2;  // 1차익절: ATR×2
          const tp2Price = entryPrice + atr * 3;  // 2차익절: ATR×3
          let exitPrice = (fisBars[Math.min(i + 25, n - 1)]?.close || entryPrice);
          let exitType = "기간만료";
          let tp1Hit = false;
          for (let j = i + 1; j <= Math.min(i + 25, n - 1); j++) {
            const bj = fisBars[j];
            if (!bj) continue;
            const stopLine = tp1Hit ? entryPrice : stopPrice;
            if ((bj.low || Infinity) <= stopLine) {
              exitPrice = stopLine;
              exitType = tp1Hit ? "브레이크이븐" : "손절";
              break;
            }
            if (!tp1Hit && (bj.high || 0) >= tp1Price) { tp1Hit = true; }
            if (tp1Hit && (bj.high || 0) >= tp2Price)  { exitPrice = tp2Price; exitType = "2차익절"; break; }
          }
          // TP1 달성했지만 TP2 미달 후 기간 만료 → "1차익절" 분류
          // (exitPrice = 25봉 종가 = 나머지 50% 실제 청산가, tp1Price로 덧어쓰지 않음)
          if (exitType === "기간만료" && tp1Hit) {
            exitType = "1차익절";
          }
          // 50/50 부분 익절: TP1 도달 시 50% → tp1Price, 나머지 50% → exitPrice
          const pnlPct = tp1Hit
            ? 0.5 * (tp1Price - entryPrice) / entryPrice * 100
              + 0.5 * (exitPrice - entryPrice) / entryPrice * 100
            : (exitPrice - entryPrice) / entryPrice * 100;
          mechTrades.push({ pnlPct, exitType });
        }
      }
    }
  }
  return { buckets, mechTrades };
}



function _renderMechBt(mechTrades) {
  if (!mechTrades || mechTrades.length === 0) {
    return `<div class="bt-diag bt-neutral" style="margin-top:10px">⚡ 기계적 전략 (FIS≥60 + 진입점수≥65) 과거 신호 없음</div>`;
  }
  const n        = mechTrades.length;
  const wins2nd  = mechTrades.filter(t => t.exitType === "2차익절");
  const wins1st  = mechTrades.filter(t => t.exitType === "1차익절");
  const breakevens = mechTrades.filter(t => t.exitType === "브레이크이븐");
  const losses   = mechTrades.filter(t => t.exitType === "손절");
  const timeouts = mechTrades.filter(t => t.exitType === "기간만료");
  // wins = TP1 도달 케이스 모두 (2차+1차+BE, 이제는 모두 부분 수익이므로 플러스)
  const wins     = [...wins2nd, ...wins1st, ...breakevens];
  const winRate   = wins.length / n;
  const avgWin    = wins.length   ? wins.reduce((s,t)=>s+t.pnlPct,0)/wins.length   : 0;
  const avgLoss   = losses.length ? losses.reduce((s,t)=>s+t.pnlPct,0)/losses.length : 0;
  const totalProfit = wins.reduce((s,t)=>s+t.pnlPct,0);
  const totalLoss   = Math.abs(losses.reduce((s,t)=>s+t.pnlPct,0));
  const pf          = totalLoss > 0 ? totalProfit/totalLoss : (totalProfit>0 ? Infinity : 0);
  const expectancy  = mechTrades.reduce((s,t)=>s+t.pnlPct,0)/n;
  const pfCol = pf >= 1.5 ? "#2ea043" : pf >= 1.0 ? "#d29922" : "#e53935";
  const wrCol = winRate >= 0.50 ? "#2ea043" : winRate >= 0.40 ? "#d29922" : "#e53935";
  const exCol = expectancy > 0 ? "#2ea043" : "#e53935";
  let verdict, verdictClass;
  if (n < 5) {
    verdict = `⚠ 신호 ${n}건 — 5건 미만, 통계 신뢰 낙음`; verdictClass = "bt-neutral";
  } else if (pf >= 1.5 && winRate >= 0.45) {
    verdict = `✓ 손익비·승률 양호 — 이 종목 기계적 전략 적용 가능`; verdictClass = "bt-ok";
  } else if (pf >= 1.0 && expectancy > 0) {
    verdict = `△ 기대값 플러스·손익비 약함 — 포지션 규모 조절 필요`; verdictClass = "bt-neutral";
  } else {
    verdict = `⚠ 기대값 마이너스 — 이 종목 기계적 전략 부적합`; verdictClass = "bt-warn";
  }
  const pfStr = pf === Infinity ? "∞" : pf.toFixed(2);
  return `<div style="margin-top:12px;border-top:1px solid var(--border2);padding-top:10px">
    <div style="font-size:11px;font-weight:700;color:var(--text1);margin-bottom:6px">⚡ 기계적 전략 시뮬 (FIS≥60 · 진입점수≥65 · R:R≥1.5)</div>
    <div style="font-size:10px;color:var(--text3);margin-bottom:6px">진입: 다음봉 시가 | 손절: EMA20−ATR | 1차(ATR×2): 50%+손절↑진입가 | 2차(ATR×3): 잔여 50% | 25봉 기간제</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin-bottom:6px">
      <div style="border:1px solid var(--border);padding:6px 8px">
        <div style="font-size:10px;color:var(--text3)">신호 / 2차 / 1차 / BE / 손절 / 만료</div>
        <div style="font-size:11px;font-weight:700">${n}건 | ${wins2nd.length} / ${wins1st.length} / ${breakevens.length} / ${losses.length} / ${timeouts.length}</div>
      </div>
      <div style="border:1px solid var(--border);padding:6px 8px">
        <div style="font-size:10px;color:var(--text3)">승률 (TP1 도달 기준)</div>
        <div style="font-size:14px;font-weight:800;color:${wrCol}">${(winRate*100).toFixed(0)}%</div>
      </div>
      <div style="border:1px solid var(--border);padding:6px 8px">
        <div style="font-size:10px;color:var(--text3)">평균수익 / 손실</div>
        <div style="font-size:12px;font-weight:700"><span style="color:#2ea043">+${avgWin.toFixed(1)}%</span> / <span style="color:#e53935">${avgLoss.toFixed(1)}%</span></div>
      </div>
      <div style="border:1px solid var(--border);padding:6px 8px">
        <div style="font-size:10px;color:var(--text3)">손익비(PF) / 기대값</div>
        <div style="font-size:12px;font-weight:700"><span style="color:${pfCol}">${pfStr}</span> / <span style="color:${exCol}">${expectancy.toFixed(1)}%</span></div>
      </div>
    </div>
    <div class="bt-diag ${verdictClass}">${verdict}</div>
    <div style="font-size:10px;color:var(--text3);margin-top:4px">※ 거래비용·슬리피지 미포함. 과거 성과가 미래를 보장하지 않음</div>
  </div>`;
}


function renderBacktest(fisBars) {
  const el = document.getElementById("backtestResult");
  if (!el) return;
  el.innerHTML = "<div class='bt-empty'>백테스트 계산 중…</div>";

  // 비동기 실행 — UI 블로킹 방지
  setTimeout(() => {
    const btResult = runBacktest(fisBars);
    if (!btResult) { el.innerHTML = "<div class='bt-empty'>데이터 부족 (최소 86봉 필요)</div>"; return; }
    const { buckets, mechTrades } = btResult;

    const keys = ["90+", "80-90", "65-80", "50-65", "50미만"];

    // ── 헤더 ──
    let html = `
      <div class="bt-note">현재 종목 과거 데이터 기준 (50미만 포함 전 구간) | MFE = 5봉 내 +2% 도달률 (스윙 첫 익절 기준)</div>
      <div class="bt-grid-hd">
        <span>구간</span><span>N</span><span>+1봉</span><span>+3봉</span><span>+5봉</span><span>MFE</span>
      </div>`;

    const pctSpan = (wins, total, col) => {
      if (!total) return `<span class="bt-na">—</span>`;
      const v = wins / total * 100;
      const c = v >= 55 ? "#2ea043" : v >= 45 ? "#d29922" : "#e53935";
      return `<span style="color:${c};font-weight:800">${v.toFixed(0)}%</span>`;
    };

    for (const k of keys) {
      const b = buckets[k];
      const n1 = b.counts[1];
      if (!n1) {
        html += `<div class="bt-grid-row">
          <span style="color:${b.color};font-weight:700">${k}</span>
          <span class="bt-na">0</span>
          <span class="bt-na">—</span><span class="bt-na">—</span><span class="bt-na">—</span><span class="bt-na">—</span>
        </div>`;
        continue;
      }
      const mfeV = b.counts.mfe ? b.wins.mfe / b.counts.mfe * 100 : 0;
      const mfeC = mfeV >= 65 ? "#2ea043" : mfeV >= 50 ? "#d29922" : "#e53935";
      html += `<div class="bt-grid-row">
        <span style="color:${b.color};font-weight:700">${k}</span>
        <span class="bt-count">${n1}</span>
        ${pctSpan(b.wins[1], b.counts[1])}
        ${pctSpan(b.wins[3], b.counts[3])}
        ${pctSpan(b.wins[5], b.counts[5])}
        <span style="color:${mfeC};font-weight:800">${mfeV.toFixed(0)}%</span>
      </div>`;
    }

    // ── 90+ 구간 진단 ──
    const b90 = buckets["90+"];
    const t1 = b90.counts[1], t5 = b90.counts[5], tm = b90.counts.mfe;
    const p1  = t1 ? b90.wins[1] / t1 * 100 : 0;
    const p5  = t5 ? b90.wins[5] / t5 * 100 : 0;
    const mfe = tm ? b90.wins.mfe / tm * 100 : 0;
    let diag = "";
    if (!t1) {
      diag = `<div class="bt-diag bt-warn">90점 이상 신호가 이 종목에서 없었습니다.</div>`;
    } else if (p5 >= 58 || mfe >= 65) {
      diag = `<div class="bt-diag bt-ok">✓ 90+: +5봉 ${p5.toFixed(0)}% · MFE ${mfe.toFixed(0)}%. 1봉 노이즈는 있어도 5봉 내 수익 기회 양호.</div>`;
    } else if (p5 >= 48 || mfe >= 55) {
      diag = `<div class="bt-diag bt-neutral">△ 90+: +5봉 ${p5.toFixed(0)}% · MFE ${mfe.toFixed(0)}%. 확인봉 대기 후 진입, 손절선 엄격 준수.</div>`;
    } else {
      diag = `<div class="bt-diag bt-warn">⚠ 90+: +1봉 ${p1.toFixed(0)}% · +5봉 ${p5.toFixed(0)}% · MFE ${mfe.toFixed(0)}%. 이 종목은 세팅 후 추가 하락 경향 → 다음봉 확인 후 분할 진입 권장.</div>`;
    }
    html += diag;

    // ── 범례 안내 ──
    // ── 지표 유효성 진단: 점수↑ → MFE↑ 여부 (50미만 제외: 구간 너무 넓어 시장 기저율 혼재) ──
    const keys2 = ["90+", "80-90", "65-80", "50-65"];
    const mfeVals = keys2.map(k => buckets[k].counts.mfe ? buckets[k].wins.mfe / buckets[k].counts.mfe * 100 : null);
    // 데이터 있는 구간만 추출해 단조감소 체크
    const validMfe = mfeVals.filter(v => v !== null);
    let isMonotone = true;
    for (let _i = 1; _i < validMfe.length; _i++) {
      if (validMfe[_i] > validMfe[_i-1] + 3) { isMonotone = false; break; } // 3% 허용 오차
    }
    const hasEnough = validMfe.length >= 2;
    let validHtml = "";
    if (!hasEnough) {
      validHtml = `<div class="bt-diag bt-neutral">△ 점수 구간 데이터 부족 — 유효성 판단 불가</div>`;
    } else if (isMonotone) {
      const labels = keys2.filter((k,i) => mfeVals[i] !== null).map((k,i) => `${k}: ${validMfe[i].toFixed(0)}%`).join(" > ");
      validHtml = `<div class="bt-diag bt-ok">✓ 점수↑ = MFE↑ 확인 (${labels}) — 지표 변별력 유효</div>`;
    } else {
      const labels = keys2.filter((k,i) => mfeVals[i] !== null).map((k,i) => `${k}: ${validMfe[i].toFixed(0)}%`).join(" / ");
      validHtml = `<div class="bt-diag bt-warn">⚠ 점수와 MFE 상관 낮음 (${labels}) — 이 종목은 기술적 점수 신뢰도 낮을 수 있음</div>`;
    }
    html += validHtml;

    html += `<div class="bt-legend">
      진입점수는 <b>1봉 상승 예측</b>이 아닌 <b>스윙 세팅 품질(5봉 기준)</b> 지표입니다.
      MFE(+2%) = 진입가 기준 5봉 내 장중 +2% 도달 비율 (스윙 첫 익절 기준).
      <b>점수↑=MFE↑</b>가 확인되면 이 종목에서 지표 변별력이 유효합니다.
    </div>`

    html += _renderMechBt(mechTrades);
    el.innerHTML = html;
  }, 10);
}

function fmt(v, dec=0) {
  if (v==null||isNaN(v)) return "—";
  return Number(v).toLocaleString("ko-KR", {minimumFractionDigits:dec,maximumFractionDigits:dec});
}
function fmtVol(v) {
  if (!v||isNaN(v)) return "—";
  if (v>=1e8) return (v/1e8).toFixed(1)+"억";
  if (v>=1e4) return (v/1e4).toFixed(0)+"만";
  return String(v);
}