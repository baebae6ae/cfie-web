/* js/scan.js  —  CFIE v4.0 (수정본) */

// ── 상태 ────────────────────────────────────────────────
let _scanType    = "fis";
let _market      = "kospi";
let _scanning        = false;
let _stopScan        = false;
let _universe        = {};
let _results         = [];
let _scanLastBarDate = null;  // 현재 스캔에 사용된 데이터의 마지막 종가 날짜

// 필터 기준: 기계적 진입 조건은 indicators.js의 MECH 상수로 일원화
// (스캔 필터 = 백테스트 시뮬 = 분석 페이지 체크리스트 모두 동일 기준)
const KUMO_BELOW_MIN    = 10;
const KUMO_BRK_LOOKBACK = 18;
const KUMO_TWIST_RANGE  = 8;
const KUMO_VOL_MULT     = 1.8;
const KUMO_BODY_RATIO   = 0.25;

// MAX_RESULTS 제한을 사실상 제거 (혹은 충분히 크게 설정)
const BATCH_SIZE  = 4; 
const _btFisBarsCache = {};  // 종목별 fisBars 캐시 (백테스트용)
const SCAN_CACHE_KEY = "cfie_scan_cache_map";
const SCAN_LAST_KEY  = "cfie_scan_last_tab";

function _scanCacheId(type = _scanType, market = _market) {
  return `${type}|${market}`;
}

function _loadScanCacheMap() {
  try {
    const raw = sessionStorage.getItem(SCAN_CACHE_KEY);
    if (raw) return JSON.parse(raw) || {};

    // Legacy single-cache migration (one-time)
    const legacyRaw = sessionStorage.getItem("cfie_scan_cache");
    if (!legacyRaw) return {};
    const legacy = JSON.parse(legacyRaw);
    if (!legacy?.type || !legacy?.market) return {};
    const id = _scanCacheId(legacy.type, legacy.market);
    return {
      [id]: {
        type: legacy.type,
        market: legacy.market,
        results: legacy.results || [],
        lastBarDate: legacy.lastBarDate || null,
        updatedAt: Date.now(),
      }
    };
  } catch (_) {
    return {};
  }
}

function _saveScanCacheMap(cacheMap) {
  try {
    sessionStorage.setItem(SCAN_CACHE_KEY, JSON.stringify(cacheMap || {}));
  } catch (_) {}
}

// ── UI 제어 ──────────────────────────────────────────────
function selectScanType(type) {
  _scanType = type;
  document.querySelectorAll(".stab").forEach(t =>
    t.classList.toggle("active", t.dataset.type === type));
  const kd = document.getElementById("kumoDesc");
  if (kd) kd.style.display = type === "kumo" ? "block" : "none";
  // 스캔 중이 아닐 때: 해당 탭의 캐시된 결과 복원 (없으면 숨김)
  if (!_scanning) _restoreScanCache();
}

function selectMarket(market) {
  _market = market;
  document.querySelectorAll(".mtab").forEach(t =>
    t.classList.toggle("active", t.dataset.market === market));
  if (!_scanning) _restoreScanCache();
}

// ── 스캔 로직 (전체 종목 순회 및 비차단 상호작용) ──────────────
// 시장별 왕복 거래비용 % (백테스트 기대값에 반영)
function _mechCostPct(market = _market) {
  return market === "us" ? MECH.COST_PCT_US : MECH.COST_PCT_KR;
}
// 시장별 유동성 게이트 (20봉 평균 거래대금 최소)
function _minTurnover(market = _market) {
  return market === "us" ? MECH.MIN_TURNOVER_USD : MECH.MIN_TURNOVER_KRW;
}

// 시장 레짐 캐시 (마켓별 — 지수 종가 > EMA60 게이트)
const _regimeCache = {};
async function _prefetchRegime(market = _market) {
  if (_regimeCache[market]) return _regimeCache[market];
  try {
    const idxTicker = MECH.REGIME_INDEX[market];
    if (!idxTicker) return null;
    const { bars } = await fetchOHLCV(idxTicker, "2y", "1d");
    const regime = buildRegime(bars);
    if (regime) _regimeCache[market] = regime;
    return regime;
  } catch (e) {
    console.warn("[scan] regime fetch 실패 — 게이트 없이 진행:", e.message);
    return null;
  }
}

// 섹터 ETF FIS 캐시 (스캔 시작 시 1회 조회)
const _sectorFISCache = {};

async function _prefetchSectorETFs() {
  if (typeof SECTOR_ETFS === "undefined" || typeof calcFIS === "undefined") return;
  const entries = Object.entries(SECTOR_ETFS);
  await Promise.allSettled(entries.map(async ([sectorName, etfTicker]) => {
    try {
      const { bars } = await fetchOHLCV(etfTicker, "3mo", "1d");
      if (bars?.length > 20) {
        const e = calcFIS(calcIndicators(bars));
        _sectorFISCache[sectorName] = e[e.length - 1].FIS;
      }
    } catch {}
  }));
  console.log("[scan] sector ETF cache:", Object.keys(_sectorFISCache).map(k => k + "=" + (_sectorFISCache[k]?.toFixed(0) ?? "?")).join(", "));
}

async function doScan() {
  if (_scanning) return;
  _scanning = true;
  _stopScan = false;
  _results  = [];
  _scanLastBarDate = null;

  // 시장 레짐 게이트 — 지수 < EMA60 이면 기계적 진입 신호를 생성하지 않음
  const _regime = await _prefetchRegime(_market);
  const regimeBanner = document.getElementById("regimeBanner");
  if (_scanType === "fis" && _regime && !_regime.ok) {
    if (regimeBanner) {
      regimeBanner.style.display = "block";
      regimeBanner.innerHTML = `<b>⛔ 시장 레짐 OFF</b> — ${ {kospi:"코스피",kosdaq:"코스닥",us:"S&P500"}[_market] } 지수가 60일 EMA 아래입니다 (${_regime.lastDate} 기준).
        약세 국면에서는 기계적 진입 기대값이 크게 악화되어(실데이터 검증: 거래당 −1.3%) <b>신규 진입 신호를 생성하지 않습니다</b>.
        지수가 EMA60을 회복하면 스캔이 재개됩니다.`;
    }
    showToast("시장 레짐 OFF — 기계적 진입 비활성", "info");
    _scanning = false;
    return;
  }
  if (regimeBanner) regimeBanner.style.display = "none";

  // 섹터 ETF 사전 조회 (FIS context용)
  await _prefetchSectorETFs();

  const scanBtn = document.getElementById("scanBtn");
  const stopBtn = document.getElementById("stopScanBtn");
  const progressEl = document.getElementById("scanProgress");
  const progressBar = document.getElementById("scanProgressBar");
  const progressText = document.getElementById("scanProgressText");
  const grid = document.getElementById("candidatesGrid");
  const countEl = document.getElementById("resultCount");
  const rs = document.getElementById("resultsSection");

  // UI 초기 설정: 로딩 오버레이는 표시하지 않음 (사용자 상호작용 허용)
  scanBtn.style.display = "none";
  if (stopBtn) stopBtn.style.display = "inline-flex";
  
  if (grid) grid.innerHTML = "";
  if (rs) rs.style.display = "block";
  if (progressEl) progressEl.style.display = "flex";

  try {
    if (!_universe[_market]) {
      const res = await fetch(`data/universe_${_market}.json`);
      if (!res.ok) throw new Error("유니버스 데이터 없음");
      _universe[_market] = await res.json();
    }
    const universe = _universe[_market];
    const total = universe.length;

    let scanned = 0;

    // 루프에서 _results.length >= MAX_RESULTS 조건을 삭제하여 전체 스캔
    for (let i = 0; i < total && !_stopScan; i += BATCH_SIZE) {
      const batch = universe.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(({ ticker, name }) => _analyzeOne(ticker, name))
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled" && r.value) {
          const candidate = r.value;
          _results.push(candidate);
          
          // 발견 즉시 화면에 렌더링 (실시간성 확보)
          if (grid) {
            const idx = _results.length - 1;
            const card = _scanType === "kumo"
              ? renderKumoCard(candidate)
              : renderFisCard(candidate, idx);
            grid.insertAdjacentHTML("beforeend", card);
          }
          if (countEl) countEl.textContent = `${_results.length}개 발견`;
        }
      }

      scanned += batch.length;
      const pct = Math.round((scanned / total) * 100);
      if (progressBar) progressBar.style.width = pct + "%";
      if (progressText) {
        progressText.textContent = `${scanned.toLocaleString()} / ${total.toLocaleString()} 종목 분석 중...`;
      }
      
      // UI 스레드 점유 방지를 위한 미세한 지연 (선택 사항)
      // await new Promise(resolve => setTimeout(resolve, 0));
    }

    // 모든 스캔 완료 후 정렬 재배치
    if (_results.length > 0 && !_stopScan) {
      if (_scanType === "fis") {
        // 1순위: 종목별 백테스트 진단 (유효 → 중립 → 부적합), 2순위: 진입점수
        const _btRank = c => c.btDiag === "bt-ok" ? 0 : c.btDiag === "bt-bad" ? 2 : 1;
        _results.sort((a, b) =>
          _btRank(a) - _btRank(b) || (b.entry_score || 0) - (a.entry_score || 0));
        if (grid) grid.innerHTML = _results.map((c, i) => renderFisCard(c, i)).join("");
      } else if (_scanType === "kumo") {
        _results.sort((a, b) => (b.below_weeks || 0) - (a.below_weeks || 0));
        if (grid) grid.innerHTML = _results.map(c => renderKumoCard(c)).join("");
      }
    }

    const label = { kospi: "코스피", kosdaq: "코스닥", us: "미국" }[_market];
    const resultLabel = document.getElementById("resultLabel");
    if (resultLabel) {
      const _dateNote = _scanLastBarDate ? ` — ${_scanLastBarDate} 종가 기준` : "";
      resultLabel.textContent = _scanType === "kumo"
        ? `${label} 전체 분석 완료 (체류기간 순)${_dateNote}`
        : `${label} 전체 분석 완료 (백테스트 유효 우선 · 점수 순)${_dateNote}`;
    }
    // 코스닥 경고 표시/숨김 (백테스트 근거)
    const kosdaqWarnEl = document.getElementById("kosdaqWarn");
    if (kosdaqWarnEl) kosdaqWarnEl.style.display = (_market === "kosdaq" && _scanType === "fis") ? "block" : "none";
    // 스캔 결과를 (스캔타입|시장)별로 저장 (페이지 이동 후 복귀 시 유지)
    if (!_stopScan && _results.length > 0) {
      try {
        const cacheMap = _loadScanCacheMap();
        const id = _scanCacheId(_scanType, _market);
        cacheMap[id] = {
          type: _scanType,
          market: _market,
          results: _results,
          lastBarDate: _scanLastBarDate,
          updatedAt: Date.now(),
        };
        _saveScanCacheMap(cacheMap);
        sessionStorage.setItem(SCAN_LAST_KEY, id);
      } catch(e) { /* 용량 초과 등 무시 */ }
    }

  } catch(e) {
    showToast("스캔 중 오류 발생: " + e.message, "error");
  } finally {
    // 오버레이 제거 코드는 삭제됨
    if (stopBtn) stopBtn.style.display = "none";
    scanBtn.style.display = "inline-flex";
    _scanning = false;
    if (progressText) progressText.textContent = "분석 완료";
    // 스캔 완료 후에도 진행 바를 잠시 보여주거나, 원할 경우 숨김 처리
    // if (progressEl) progressEl.style.display = "none";
  }
}

function stopScan() {
  _stopScan = true;
  showToast("사용자에 의해 스캔이 중단되었습니다.", "info");
}

// ── 단일 종목 분석 ────────────────────────────────────────
async function _analyzeOne(ticker, name) {
  try {
    if (_scanType === "fis") {
      // 기계적 전략 검증 안정성을 위해 2년 표본 사용
      const ohlcv = await fetchOHLCV(ticker, "2y", "1d");
      const { bars } = ohlcv;
      if (!bars || bars.length < 60) return null;
      if (!_scanLastBarDate && ohlcv._lastBarDate) _scanLastBarDate = ohlcv._lastBarDate;
      return _analyzeFis(ticker, name, bars);
    } else {
      // Python: fetch(ticker, "2y")
      const ohlcv = await fetchOHLCV(ticker, "2y", "1d");
      const { bars } = ohlcv;
      if (!bars || bars.length < 60) return null;
      if (!_scanLastBarDate && ohlcv._lastBarDate) _scanLastBarDate = ohlcv._lastBarDate;
      return _analyzeKumo(ticker, name, bars);
    }
  } catch(e) { return null; }
}

// ── FIS 분석 ─────────────────────────────────────────────
// 기계적 진입 조건 (indicators.js MECH 기준 — 백테스트 시뮬과 100% 동일):
//   ① FIS ≥ 60  ② EMA20 이격 ≥ 0.3 ATR  ③ RSI 눌림(8봉 내 ≤62) 후 회복(현재 ≥50)
//   ④ 추세 신선도 1~35봉  ⑤ 유동성(20봉 평균 거래대금)  ⑥ 통합 진입점수 ≥ 65
//   ⑦ R:R ≥ 1.2 (손절 EMA20−1.5ATR 기준)   ※ 시장 레짐 게이트는 doScan에서 선행 적용
function _analyzeFis(ticker, name, bars) {
  const df = calcIndicators(bars);
  if (!df || df.length < 30) return null;
  const fisBars = calcFIS(df);
  if (!fisBars || fisBars.length === 0) return null;

  const lastIdx = fisBars.length - 1;
  const last    = fisBars[lastIdx];

  // cheap 필터 먼저 (FIS·이격·RSI눌림·신선도·유동성) — calcEntryScore 이전에 탈락 처리
  const cheap = mechCheapFilterAt(fisBars, lastIdx, { minTurnover: _minTurnover() });
  if (!cheap.pass) return null;

  const judgment = makeJudgment(fisBars);
  if (!judgment) return null;

  const trend       = last.TrendScore       ?? 0;
  const momentum    = last.MomentumScore    ?? 0;
  const structure   = last.StructureScore   ?? 0;
  const compression = last.CompressionScore ?? 0;
  const volume      = last.VolumeScore      ?? 0;
  const risk        = last.RiskPenalty      ?? 0;   // 감점값 (음수)
  const fis         = judgment.fis ?? 0;
  const close_v     = last.close ?? 0;
  const ema20_v     = last.EMA20 ?? close_v;
  const atr_v       = last.ATR14 ?? 0;

  // 섹터 context
  const _scanSectorName = (typeof STOCK_SECTOR_MAP !== "undefined") ? STOCK_SECTOR_MAP[ticker] : null;
  const _scanSectorFIS  = _scanSectorName != null ? (_sectorFISCache[_scanSectorName] ?? null) : null;
  const _scanContext    = { sectorName: _scanSectorName, sectorFIS: _scanSectorFIS };

  const entryData = calcEntryScore(fisBars, _scanContext);
  if (!entryData) return null;
  const entry = entryData.score ?? 0;
  if (entry < MECH.ENTRY_MIN) return null;

  // 매매 계획: 손절 EMA20−1.5ATR / TP1 +ATR×2 / TP2 +ATR×3 (현재 종가 기준)
  const plan = mechTradePlan(fisBars, lastIdx, close_v);
  if (!plan || plan.rr < MECH.RR_MIN) return null;
  const rr_val = Math.round(plan.rr * 100) / 100;

  const biu = entryData.metrics?.freshness_bars ?? cheap.freshBars;
  const high20_v = fisBars.slice(-20).reduce((m, b) =>
    Math.max(m, b.high ?? 0), -Infinity);
  const ema20_gap = ema20_v > 0
    ? Math.round(((close_v - ema20_v) / ema20_v * 100) * 10) / 10
    : 0;

  const entry_components   = entryData.components    || {};
  const entry_setup_scores = entryData.setup_scores  || {};
  const entry_metrics      = entryData.metrics       || {};
  const entry_setup_name   = entryData.setup_name    || "";
  const entry_setup_name2  = entryData.setup_name2   || "";

  // fisBars 캐싱 (백테스트 버튼 클릭 시 재활용)
  _btFisBarsCache[ticker] = fisBars;
  // 종목별 과거 백테스트 (실전 조건·레짐·유동성·거래비용 동일 적용) — 카드 즉시 강조용
  const btSim = runMechBacktest(fisBars, {
    costPct: _mechCostPct(),
    regimeMap: _regimeCache[_market]?.map ?? null,
    minTurnover: _minTurnover(),
  });

  return {
    ticker,
    name,
    fis:          Math.round(fis * 100) / 100,
    label:        judgment.label,
    label_color:  judgment.label_color,
    close:        close_v,
    trend:        Math.round(trend * 100) / 100,
    momentum:     Math.round(momentum * 100) / 100,
    structure:    Math.round(structure * 100) / 100,
    compression:  Math.round(compression * 100) / 100,
    volume:       Math.round(volume * 100) / 100,
    risk:         Math.round(risk * 100) / 100,
    entry_score:  Math.round(entry),
    rr:           rr_val,
    freshness_bars: biu,
    // 매매 계획 가격 (카드에 표시 — 주문 즉시 입력 가능)
    plan_stop:    plan.stop,
    plan_tp1:     plan.tp1,
    plan_tp2:     plan.tp2,
    entry_setup_name,
    entry_setup_name2,
    entry_components,
    entry_setup_scores,
    entry_metrics,
    ema20_gap,
    atr:          atr_v,
    high20:       high20_v,
    summary_l1:   judgment.summary_l1    || "",
    ichimoku:     judgment.ichimoku_status || "—",
    btDiag:       btSim?.diag ?? "",
    btPF:         btSim?.mech?.pf ?? null,
    btWinRate:    btSim?.mech?.winRate ?? null,
    btTotal:      btSim?.mech?.total ?? 0,
    btExpectancy: btSim?.mech?.expectancy ?? null,
  };
}

// ── 쿠모 브레이크아웃 분석 ──────────────────────────────────
// Python _kumo_check_one 동일:
//   1) 일봉(2y) → 주봉 변환 + 일목균형표 계산
//   2) 조건1: 현재 구름 위 (above[-1] == 1)
//   3) 조건2: 최근 36주 내 below→above 전환 시점(brk_idx) 존재
//   4) 조건3: 돌파 전 50주 중 구름 아래 10주 이상
//   5) 조건4: 돌파 ±8주 내 Kumo Twist 또는 현재 bull 구름
//   6) 조건5: 돌파 전 구름 두께 (min_thick)
//   7) 조건6: 최근 25일 일봉에서 거래량 폭발 + 장대양봉
function _analyzeKumo(ticker, name, bars) {
  // 주봉 변환
  const weekly = _toWeekly(bars);
  if (!weekly || weekly.length < 60) return null;

  // 일목균형표 계산 (Python _calc_ichimoku_raw 동일)
  const ich = _calcIchimoku(weekly);
  if (!ich || ich.length < 40) return null;

  const n = ich.length;

  // above_c, below_c, bull_cloud, c_thick 배열
  const above = ich.map(b => b.close > Math.max(b.cloudA, b.cloudB) ? 1 : 0);
  const below = ich.map(b => b.close < Math.min(b.cloudA, b.cloudB) ? 1 : 0);
  const bull  = ich.map(b => b.cloudA >= b.cloudB ? 1 : 0);
  const thick = ich.map(b =>
    b.close > 0 ? Math.abs(b.cloudA - b.cloudB) / b.close : 0);

  // 조건1: 현재 구름 위
  if (above[n - 1] !== 1) return null;

  // 조건2: 최근 KUMO_BRK_LOOKBACK(36)주 내에 below→above 전환 시점 탐색
  // Python: for i in range(n-36, n): if above[i]==1 and above[i-1]!=1: brk_idx=i
  // 마지막으로 전환한 시점을 사용
  let brkIdx = null;
  for (let i = Math.max(1, n - KUMO_BRK_LOOKBACK); i < n; i++) {
    if (above[i] === 1 && above[i - 1] !== 1) {
      brkIdx = i;
    }
  }
  if (brkIdx === null) return null;

  // 조건3: 돌파 전 50주 중 구름 아래 10주 이상
  const lookStart = Math.max(0, brkIdx - 50);
  let belowCnt = 0;
  for (let i = lookStart; i < brkIdx; i++) belowCnt += below[i];
  if (belowCnt < KUMO_BELOW_MIN) return null;

  // 조건4: Kumo Twist — 돌파 ±KUMO_TWIST_RANGE(8)주 내 cloud_a가 cloud_b 이상으로 전환
  const twistStart = Math.max(0,     brkIdx - KUMO_TWIST_RANGE);
  const twistEnd   = Math.min(n - 1, brkIdx + KUMO_TWIST_RANGE);
  let hadTwist = false;
  for (let i = twistStart; i <= twistEnd; i++) {
    if (bull[i] === 1 && (i === 0 || bull[i - 1] === 0)) {
      hadTwist = true;
      break;
    }
  }

  const closeV = ich[n - 1].close;

  // 돌파 이후에도 추세가 실제로 이어진 경우만 남김
  const brkClose = ich[brkIdx]?.close ?? 0;
  const maxSinceBrk = ich.slice(brkIdx).reduce((m, b) => Math.max(m, b.close ?? 0), 0);
  const runPct = brkClose > 0 ? ((maxSinceBrk / brkClose) - 1) * 100 : 0;
  const currentFromBrkPct = brkClose > 0 ? ((closeV / brkClose) - 1) * 100 : 0;
  if (runPct < 20 || currentFromBrkPct < 0 || closeV < maxSinceBrk * 0.85) return null;

  // 조건5: 돌파 전 구름 두께 최솟값
  const thinStart = Math.max(0, brkIdx - 6);
  const thinEnd   = Math.min(n - 1, brkIdx + 2);
  let minThick = Infinity;
  for (let i = thinStart; i <= thinEnd; i++) {
    if (thick[i] < minThick) minThick = thick[i];
  }
  const minThickPct = isFinite(minThick) ? Math.round(minThick * 1000) / 10 : 99.0;

  // 조건6: 일봉 거래량 폭발 + 장대양봉 (최근 25일)
  // Python: vol20 = Volume.rolling(20).mean(), 최근 25봉에서 volume >= vol20*1.8
  //          AND body/range > 0.25 AND body > 0 (양봉)
  const recent25 = bars.slice(-25);
  // vol20은 일봉 전체에서 rolling(20) — 최근 25일 각각에 대해 해당 시점의 20일 평균
  // 근사: 각 봉의 vol20을 bars 전체에서 rolling 계산
  const vols = bars.map(b => b.volume ?? 0);
  const vol20arr = vols.map((_, i) => {
    if (i < 19) return null;
    let sum = 0;
    for (let k = i - 19; k <= i; k++) sum += vols[k];
    return sum / 20;
  });

  let bigCandle = false;
  const r25Start = bars.length - 25;
  for (let i = r25Start; i < bars.length; i++) {
    const bar  = bars[i];
    const v20  = vol20arr[i];
    if (!v20 || (bar.volume ?? 0) < v20 * KUMO_VOL_MULT) continue;
    const body = (bar.close ?? 0) - (bar.open ?? 0);
    const rng  = (bar.high  ?? 0) - (bar.low  ?? 0);
    if (body > 0 && (rng === 0 || body / rng > KUMO_BODY_RATIO)) {
      bigCandle = true;
      break;
    }
  }

  return {
    ticker,
    name,
    close:       closeV,
    below_weeks: belowCnt,
    cloud_thin:  minThickPct,
    bull_cloud:  bull[n - 1] === 1,
    daily_vol:   bigCandle,
    had_twist:   hadTwist,
    breakout_run: Math.round(runPct * 10) / 10,
    breakout_gap: Math.round(currentFromBrkPct * 10) / 10,
  };
}

// ── 일목균형표 계산 (Python _calc_ichimoku_raw 동일) ────────
// shift 없이 현재 가격 기준, 주봉 배열에 적용
// cloud_a = (tenkan + kijun) / 2
// cloud_b = (hi52 + lo52) / 2
function _calcIchimoku(weekly) {
  const n = weekly.length;
  if (n < 52) return null;

  function maxHigh(i, period) {
    let m = -Infinity;
    for (let j = Math.max(0, i - period + 1); j <= i; j++)
      m = Math.max(m, weekly[j].high);
    return m;
  }
  function minLow(i, period) {
    let m = Infinity;
    for (let j = Math.max(0, i - period + 1); j <= i; j++)
      m = Math.min(m, weekly[j].low);
    return m;
  }

  const result = [];
  for (let i = 0; i < n; i++) {
    // min_periods 만족 여부 확인 (Python dropna 대응)
    if (i < 51) continue;   // cloud_b는 52봉 필요
    const hi9  = maxHigh(i,  9);  const lo9  = minLow(i,  9);
    const hi26 = maxHigh(i, 26);  const lo26 = minLow(i, 26);
    const hi52 = maxHigh(i, 52);  const lo52 = minLow(i, 52);
    const tenkan = (hi9  + lo9)  / 2;
    const kijun  = (hi26 + lo26) / 2;
    const cloudA = (tenkan + kijun) / 2;
    const cloudB = (hi52 + lo52)  / 2;
    result.push({
      time:   weekly[i].time,
      close:  weekly[i].close,
      cloudA,
      cloudB,
    });
  }
  return result;
}

// ── 일봉 → 주봉 변환 (월요일 기준) ──────────────────────────
function _toWeekly(bars) {
  if (!bars || !bars.length) return [];
  const weeks = {};
  for (const b of bars) {
    const d    = new Date((b.ts ?? b.time) * 1000);
    const day  = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon  = new Date(d);
    mon.setDate(d.getDate() + diff);
    const key = mon.toISOString().slice(0, 10);
    if (!weeks[key]) {
      weeks[key] = {
        time:   Math.floor(mon.getTime() / 1000),
        open:   b.open,
        high:   b.high,
        low:    b.low,
        close:  b.close,
        volume: b.volume ?? 0,
      };
    } else {
      weeks[key].high    = Math.max(weeks[key].high,  b.high);
      weeks[key].low     = Math.min(weeks[key].low,   b.low);
      weeks[key].close   = b.close;
      weeks[key].volume += b.volume ?? 0;
    }
  }
  return Object.values(weeks).sort((a, b) => a.time - b.time);
}

// ── FIS 카드 ──────────────────────────────────────────────
function renderFisCard(c, idx) {
  const col    = fisColor(c.fis);
  const eScore = c.entry_score ?? 0;
  const eCol   = eScore >= 70 ? "#2ea043" : eScore >= 60 ? "#56d364" : eScore >= 50 ? "#d29922" : "#6e7681";
  const tCls   = c.trend >= 10 ? "pos" : "neg";
  const mCls   = c.momentum >= 5 ? "pos" : c.momentum < 0 ? "neg" : "";
  const pf     = _market === "us" ? "" : "₩";
  const dec    = _market === "us" ? 2 : 0;

  const btDiag   = c.btDiag ?? "";
  // 백테스트 진단별 카드 강조 (좌측 컬러바)
  const cardStyle = btDiag === "bt-ok"
    ? 'style="border-left:3px solid #2ea043;box-shadow:inset 3px 0 0 rgba(46,160,67,0.15);position:relative"'
    : btDiag === "bt-bad"
    ? 'style="border-left:3px solid #e53935;box-shadow:inset 3px 0 0 rgba(229,57,53,0.12);position:relative"'
    : btDiag === "bt-warn"
    ? 'style="border-left:3px solid #d29922;box-shadow:inset 3px 0 0 rgba(210,153,34,0.12);position:relative"'
    : "";

  // ── 매매 계획 (즉시 주문 입력 가능한 가격) ──
  const _pl = (v) => pf + fmt(_market === "us" ? v : Math.round(v), dec);
  const _pct = (v) => (v >= c.close ? "+" : "") + ((v - c.close) / c.close * 100).toFixed(1) + "%";
  const planHTML = (c.plan_stop > 0 && c.plan_tp1 > 0) ? `
    <div class="cc-plan">
      <div class="cc-plan-title">⚡ 매매 계획 <span class="cc-plan-sub">(종가 ${_pl(c.close)} 진입 기준)</span></div>
      <div class="cc-plan-grid">
        <div class="cc-plan-cell stop"><span class="cc-plan-k">손절</span><b>${_pl(c.plan_stop)}</b><span class="cc-plan-p">${_pct(c.plan_stop)}</span></div>
        <div class="cc-plan-cell tp1"><span class="cc-plan-k">1차 익절 50%</span><b>${_pl(c.plan_tp1)}</b><span class="cc-plan-p">${_pct(c.plan_tp1)}</span></div>
        <div class="cc-plan-cell tp2"><span class="cc-plan-k">2차 익절</span><b>${_pl(c.plan_tp2)}</b><span class="cc-plan-p">${_pct(c.plan_tp2)}</span></div>
      </div>
      <div class="cc-plan-note">1차 도달 시 손절선을 진입가로 올림 · 25봉(약 5주) 내 미도달 시 전량 청산</div>
    </div>` : "";

  // ── 종목별 백테스트 요약 칩 ──
  const btChip = (c.btTotal >= 5 && c.btPF != null)
    ? `<span class="cs-chip" style="background:rgba(46,160,67,0.10)" title="이 종목 과거 동일조건 백테스트">과거 ${c.btTotal}회 · 승률 ${(c.btWinRate*100).toFixed(0)}% · PF ${c.btPF === Infinity ? "∞" : c.btPF.toFixed(1)}</span>`
    : c.btTotal > 0
    ? `<span class="cs-chip" title="신호 5건 미만 — 통계 신뢰 낮음">과거 신호 ${c.btTotal}회 (표본 부족)</span>`
    : `<span class="cs-chip" title="과거 2년간 동일조건 신호 없음">첫 신호 (과거 사례 없음)</span>`;

  return `
  <div class="candidate-card" ${cardStyle}>
    <div class="cc-top">
      <div>
        <div class="cc-name">${c.name}</div>
        <div class="cc-ticker">${c.ticker} · ${pf}${fmt(c.close)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <div class="cc-fis-badge" style="background:${eCol}">진입 점수 ${eScore.toFixed(0)}</div>
        <div class="cc-fis-badge" style="background:#1565C0;font-size:11px">R:R ${(c.rr??0).toFixed(1)}</div>
      </div>
    </div>
    <div class="cc-label" style="color:${col}">${c.label}</div>
    <div class="cc-summary">${c.summary_l1}</div>
    ${planHTML}
    <div class="cc-scores">
      <span class="cs-chip ${tCls}" title="추세점수">추세 ${c.trend>=0?"+":""}${c.trend.toFixed(0)}</span>
      <span class="cs-chip ${mCls}" title="모멘텀">모멘텀 ${c.momentum>=0?"+":""}${c.momentum.toFixed(0)}</span>
      <span class="cs-chip" style="background:rgba(21,101,192,0.12)" title="골든크로스 후 경과 봉 수 (1~35봉이 신선)">신선도 ${c.freshness_bars ?? "—"}봉</span>
      <span class="cs-chip" title="일목균형표">${(c.ichimoku||"—").split("—")[0].trim()}</span>
      ${btChip}
    </div>
    ${btDiag === "bt-ok" ? '<div class="bt-ok-badge">✓ 백테스트 유효</div>' : ""}
    ${btDiag === "bt-bad" ? '<div class="bt-ok-badge" style="background:rgba(229,57,53,0.12);color:#e53935;border-color:rgba(229,57,53,0.4)">⚠ 이 종목 과거 성과 부진 — 진입 주의</div>' : ""}
    <div class="cc-actions">
      <button class="cc-btn cc-btn-analyze" onclick="location.href='analyze.html?t=${encodeURIComponent(c.ticker)}'">📈 차트 분석</button>
      <button class="cc-btn cc-btn-bt" id="bt-btn-${idx}" onclick="_showScanBt('${c.ticker}',${idx})">📊 백테스트</button>
    </div>
    <div class="cc-bt-panel" id="bt-panel-${idx}" style="display:none"></div>
    <button class="det-toggle" id="det-btn-${idx}" onclick="toggleDetail(${idx})">▶ 상세 설명</button>
    <div class="det-body" id="det-${idx}">
      ${entryDetailHTML(c)}
    </div>
  </div>`;
}

// ── 상세 설명 HTML ────────────────────────────────────────
function entryDetailHTML(c) {
  const comp   = c.entry_components    || {};
  const setups = c.entry_setup_scores  || {};
  const met    = c.entry_metrics       || {};
  const sName  = c.entry_setup_name    || "—";
  const sName2 = c.entry_setup_name2   || "";

  const ctx      = comp["추세문맥"]   ?? 0;
  const setup    = comp["진입구조"]   ?? 0;
  const trigger  = comp["확인신호"]   ?? 0;
  const space    = comp["저항여유"]   ?? 0;
  const riskCtrl = comp["리스크관리"] ?? 0;

  function sc(v, max) {
    const r = max > 0 ? v / max : 0;
    return r >= 0.7 ? "#2ea043" : r >= 0.4 ? "#d29922" : "#6e7681";
  }

  const ctxDesc =
    ctx >= 24 ? "FIS 강세·추세·ADX 모두 우세. 매수 환경이 충분히 갖춰진 상태."
  : ctx >= 16 ? "추세 환경 양호. 방향성 우위 확인됨."
  : ctx >= 8  ? "추세 환경 중립 이상. 조건부 진입 가능."
  :             "추세 뒷받침 부족. 신중한 접근 필요.";

  const setupDescs = {
    "추세 눌림":   "상승 흐름 속 조정 후 재진입 시도. EMA 근접 눌림 + RSI 과열 해소가 핵심.",
    "압축 돌파":   "좁은 횡보에 에너지 압축 후 거래량 동반 상단 돌파 시도.",
    "모멘텀 지속": "정배열(EMA10>20>60) 상승 중인 추세에서 지속 진입. 강한 ROC·거래량 확인.",
    "반전 초기":   "과매도 후 바닥 반전 초기 신호. MACD 반전·RSI 저점 반등 확인."
  };

  const trigDesc =
    trigger >= 18 ? "EMA 배열·MACD·거래량 신호 모두 동반. 진입 타이밍 강."
  : trigger >= 12 ? "핵심 진입 신호 대부분 확인됨."
  : trigger >= 6  ? "일부 신호만 충족. 추가 봉 확인 권장."
  :                 "명확한 진입 신호 아직 부족.";

  const spaceDesc =
    space >= 12 ? "52주 위치·BB 모두 상승 여유 충분. 상단 저항 부담 낮음."
  : space >= 6  ? "적정한 상승 공간 확인됨."
  : space >= 0  ? "일부 저항 부담 있음. 상단 확인 필요."
  :               "상단 저항 과부담. 추격 매수 불리.";

  const riskDesc =
    riskCtrl >= 12 ? "과열 없고 손절가 거리 적정. 위험 관리 조건 양호."
  : riskCtrl >= 8  ? "리스크 통제 가능 수준."
  : riskCtrl >= 4  ? "일부 위험 요소 있음. 손절선 명확히 설정 권장."
  :                  "ATR 대비 이격 크거나 위험 감점 높음. 주의 필요.";

  const setupChips = Object.entries(setups).map(([k, v]) =>
    `<span class="det-setup-chip${k === sName ? " best" : ""}">${k} ${v.toFixed(0)}점${k === sName ? " ★" : ""}</span>`
  ).join("");

  const rows = [
    { label: "① 추세문맥",                                           v: ctx,      max: 30, desc: ctxDesc },
    { label: `② 진입구조 — ${sName}${sName2 ? ` + ${sName2}` : ""}`, v: setup,    max: 30, desc: setupDescs[sName] || "—", extra: setupChips },
    { label: "③ 확인신호",                                           v: trigger,  max: 28, desc: trigDesc },
    { label: "④ 저항여유",                                           v: space,    max: 18, desc: spaceDesc },
    { label: "⑤ 리스크관리",                                         v: riskCtrl, max: 16, desc: riskDesc },
  ];

  const compsHTML = rows.map(r => `
    <div class="det-comp">
      <div class="det-comp-hd">
        <span class="det-comp-label">${r.label}</span>
        <span class="det-comp-score" style="color:${sc(r.v, r.max)}">${r.v.toFixed(0)} / ${r.max}</span>
      </div>
      <div class="det-comp-desc">${r.desc}</div>
      ${r.extra ? `<div class="det-setup-chips">${r.extra}</div>` : ""}
    </div>`).join("");

  // Python: ema20_gap은 _analyze_one에서 직접 계산해 반환
  // met.ema20_gap_pct → c.ema20_gap 로도 폴백
  const gapVal = met.ema20_gap_pct != null ? met.ema20_gap_pct : (c.ema20_gap ?? null);
  const gapPct = gapVal != null
    ? (gapVal >= 0 ? "+" : "") + gapVal.toFixed(1) + "%" : "—";

  return compsHTML + `
    <div class="det-metrics">
      <span>EMA20 이격 ${gapPct}</span>
      <span>RSI ${met.rsi_reset != null ? met.rsi_reset.toFixed(1) : "—"}</span>
      <span>52주 ${met.range_pos != null ? met.range_pos.toFixed(0) + "%" : "—"}</span>
      <span>BB ${met.bb_pos != null ? met.bb_pos.toFixed(0) + "%" : "—"}</span>
      <span>ADX ${met.adx != null ? met.adx.toFixed(1) : "—"}</span>
    </div>`;
}

function toggleDetail(idx) {
  const body = document.getElementById(`det-${idx}`);
  const btn  = document.getElementById(`det-btn-${idx}`);
  if (!body) return;
  const open = body.classList.contains("open");
  body.classList.toggle("open", !open);
  btn.classList.toggle("open", !open);
  btn.textContent = open ? "▶ 상세 설명" : "▼ 상세 설명 닫기";
}

// ── 쿠모 카드 ──────────────────────────────────────────────
function renderKumoCard(c) {
  const pf     = _market === "us" ? "" : "₩";
  const dir    = c.bull_cloud ? "bull" : "bear";
  const dirTxt = c.bull_cloud ? "양전환" : "음전환";
  return `
  <div class="candidate-card">
    <div class="cc-top">
      <div>
        <div class="cc-name">${c.name}</div>
        <div class="cc-ticker">${c.ticker}</div>
      </div>
      <div class="cc-price">${pf}${fmt(c.close)}</div>
      <div class="kumo-badge ${dir}">☁ ${dirTxt}</div>
    </div>
    <div class="cc-label ${dir}">구름 아래 ${c.below_weeks}주 체류 후 상향 돌파</div>
    <div class="cc-scores">
      ${c.cloud_thin < 3
          ? '<span class="cs-chip pos">얇은 구름</span>'
          : '<span class="cs-chip neg">두꺼운 구름</span>'}
      ${c.daily_vol  ? '<span class="cs-chip pos">거래량 폭발 + 장대양봉</span>' : ""}
      ${c.had_twist  ? '<span class="cs-chip pos">Kumo Twist</span>' : ""}
    </div>
    <div class="cc-actions">
      <button class="cc-btn cc-btn-analyze" onclick="goAnalyze('${c.ticker}', '1wk', '5y')">차트 분석</button>
    </div>
  </div>`;
}
// \u2500\u2500 \ubc31\ud14c\uc2a4\ud2b8 \ud328\ub110 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// \uc2dc\ubbac \ucf54\uc5b4\ub294 indicators.js::runMechBacktest (\uc2a4\uce94 \uc2e4\uc804 \uc870\uac74\uacfc \ub3d9\uc77c)
function _showScanBt(ticker, idx) {
  const panel = document.getElementById("bt-panel-" + idx);
  const btn   = document.getElementById("bt-btn-" + idx);
  if (!panel || !btn) return;

  if (panel.style.display !== "none") {
    panel.style.display = "none";
    btn.textContent = "\uD83D\uDCCA \ubc31\ud14c\uc2a4\ud2b8";
    return;
  }

  btn.textContent = "\u23F3 \uACC4\uC0B0 \uC911\u2026";
  btn.disabled = true;
  panel.style.display = "block";
  panel.innerHTML = "<div class='scan-bt-loading'>\uACC4\uC0B0 \uC911\u2026</div>";

  setTimeout(() => {
    const fisBars = _btFisBarsCache[ticker];
    if (!fisBars || typeof runMechBacktest !== "function") {
      panel.innerHTML = "<div class='scan-bt-empty'>\ub370\uc774\ud130 \uc5c6\uc74c</div>";
      btn.textContent = "\uD83D\uDCCA \uBC31\uD14C\uC2A4\uD2B8"; btn.disabled = false; return;
    }

    const sim = runMechBacktest(fisBars, {
      costPct: _mechCostPct(),
      regimeMap: _regimeCache[_market]?.map ?? null,
      minTurnover: _minTurnover(),
    });
    if (!sim) {
      panel.innerHTML = "<div class='scan-bt-empty'>\uc2e0\ud638 \uc5c6\uc74c (\ub370\uc774\ud130 \ubd80\uc871)</div>";
      btn.textContent = "\uD83D\uDCCA \uBC31\uD14C\uC2A4\uD2B8"; btn.disabled = false; return;
    }

    const { buckets, mech, diag, costPct } = sim;

    // \u2500\u2500 \uc139\uc158 1: \uc9c4\uc785\uc810\uc218 \ubc31\ud14c\uc2a4\ud2b8 (\uad6c\uac04\ubcc4 \uc2b9\ub960 \ubc0f MFE) \u2500\u2500
    const fisKeys  = ["90+", "80-90", "65-80", "50-65"];
    const fisColors = {"90+":"#1a7a34","80-90":"#2ea043","65-80":"#56a0d3","50-65":"#d29922"};
    const pctSpan = (wins, total) => {
      if (!total) return `<span style="color:#888">\u2014</span>`;
      const v = wins / total * 100;
      const col = v >= 55 ? "#2ea043" : v >= 45 ? "#d29922" : "#e53935";
      return `<span style="color:${col};font-weight:800">${v.toFixed(0)}%</span>`;
    };

    let h = `<div class="scan-bt-note" style="border-bottom:1px solid #444;padding-bottom:5px;margin-bottom:6px">\uD83D\uDCC8 \uc9c4\uc785\uc810\uc218 \ubc31\ud14c\uc2a4\ud2b8 \u2014 \uad6c\uac04\ubcc4 +5\ubd09 \uc2b9\ub960 \ubc0f MFE(+2%)</div>`;
    h += `<div class="scan-bt-hd"><span>\uad6c\uac04</span><span>N</span><span>+1\ubd09</span><span>+5\ubd09</span><span>MFE</span></div>`;
    for (const k of fisKeys) {
      const b = buckets[k];
      if (!b.counts[1]) {
        h += `<div class="scan-bt-row"><span style="color:${fisColors[k]};font-weight:700">${k}</span><span style="color:#888">0</span><span style="color:#888">\u2014</span><span style="color:#888">\u2014</span><span style="color:#888">\u2014</span></div>`;
        continue;
      }
      const mfeV = b.counts.mfe ? b.wins.mfe / b.counts.mfe * 100 : 0;
      const mfeC = mfeV >= 65 ? "#2ea043" : mfeV >= 50 ? "#d29922" : "#e53935";
      h += `<div class="scan-bt-row">
        <span style="color:${fisColors[k]};font-weight:700">${k}</span>
        <span>${b.counts[1]}</span>
        ${pctSpan(b.wins[1], b.counts[1])}
        ${pctSpan(b.wins[5], b.counts[5])}
        <span style="color:${mfeC};font-weight:800">${mfeV.toFixed(0)}%</span>
      </div>`;
    }

    // \u2500\u2500 \uc139\uc158 2: \uae30\uacc4\uc801 \uc804\ub7b5 \uc2dc\ubbac \u2500\u2500
    const { total: mN, wins2nd, wins1st, bes, losses, timeouts,
            winRate, pf, expectancy, avgWin, avgLoss, avgTp1Bar, medTp1Bar, tp1ReachedN, diag: mechDiag } = mech;
    const pfStr = pf === Infinity ? "\u221e" : pf.toFixed(2);
    const pfCol = pf >= 1.5 ? "#2ea043" : pf >= 1.0 ? "#d29922" : "#e53935";
    const wrCol = winRate >= 0.50 ? "#2ea043" : winRate >= 0.40 ? "#d29922" : "#e53935";
    const exCol = expectancy > 0 ? "#2ea043" : "#e53935";

    let verdict, verdictClass;
    if (mN < 5) {
      verdict = `\u26a0 \uc2e0\ud638 ${mN}\uac74 \u2014 5\uac74 \ubbf8\ub9cc, \ud1b5\uacc4 \uc2e0\ub8b0 \ub0ae\uc74c`; verdictClass = "bt-neutral";
    } else if (mechDiag === "bt-ok") {
      verdict = `\u2713 \uc190\uc775\ube44\u00b7\uc2b9\ub960 \uc591\ud638 \u2014 \uae30\uacc4\uc801 \uc804\ub7b5 \uc801\uc6a9 \uac00\ub2a5`; verdictClass = "bt-ok";
    } else if (mechDiag === "bt-neutral") {
      verdict = `\u25b3 \uae30\ub300\uac12 \ud50c\ub7ec\uc2a4, \uc190\uc775\ube44 \uc57d\ud568 \u2014 \ud3ec\uc9c0\uc158 \uaddc\ubaa8 \uc870\uc808 \ud544\uc694`; verdictClass = "bt-neutral";
    } else {
      verdict = `\u26a0 \uae30\ub300\uac12 \ub9c8\uc774\ub108\uc2a4 \u2014 \uc774 \uc885\ubaa9 \uae30\uacc4\uc801 \uc804\ub7b5 \ubd80\uc801\ud569`; verdictClass = "bt-warn";
    }

    h += `<div class="scan-bt-note" style="margin-top:10px;border-bottom:1px solid #444;padding-bottom:5px;margin-bottom:6px">⚡ 기계적 전략 시뮬 — 스캔과 동일 조건 (FIS·이격·RSI눌림·신선도·유동성·점수·R:R + 시장 레짐)</div>`;
    h += `<div class="scan-bt-note" style="margin-bottom:5px;opacity:0.75">다음봉 시가 진입 · 손절=EMA20−1.5ATR · 1차(ATR×2): 50%+손절↑진입가 · 2차(ATR×3): 잔여 50% · 25봉 기간제 · 중복 포지션 없음</div>`;
    if (mN === 0) {
      h += `<div class="scan-bt-empty">과거 신호 없음</div>`;
    } else {
      h += `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin-bottom:6px">
        <div style="border:1px solid var(--border);padding:6px 8px">
          <div style="font-size:10px;color:var(--text3)">신호 / 2차 / 1차 / BE / 손절 / 만료</div>
          <div style="font-size:11px;font-weight:700">${mN}건 | ${wins2nd} / ${wins1st} / ${bes} / ${losses} / ${timeouts}</div>
        </div>
        <div style="border:1px solid var(--border);padding:6px 8px">
          <div style="font-size:10px;color:var(--text3)">승률 (비용 차감 후 순수익 기준)</div>
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
      </div>`;
      h += `<div class="scan-bt-diag ${verdictClass}">${verdict}</div>`;
      if (avgTp1Bar !== null) {
        h += `<div style="font-size:11px;color:var(--text3);margin-top:5px">1차 익절 평균 도달: <b style="color:#56a0d3">${avgTp1Bar.toFixed(1)}봉</b> · 중위수: <b style="color:#56a0d3">${medTp1Bar.toFixed(1)}봉</b> <span style="color:#666">(TP1 도달 ${tp1ReachedN}건 기준)</span></div>`;
      }
      h += `<div style="font-size:10px;color:#888;margin-top:4px">※ 왕복 거래비용 ${costPct.toFixed(2)}% 차감 반영. 과거 성과가 미래를 보장하지 않음</div>`;
    }

    panel.innerHTML = h;
    btn.textContent = "\uD83D\uDCCA \uc811\uae30"; btn.disabled = false;

    // \ucee4\ub4dc \uac15\uc870 \ubc0f \ubc30\uc9c0 \uc704\uce58 \uc218\uc815 (\uc778\ub77c\uc778 \uc0bd\uc785)
    const card = panel.closest(".candidate-card");
    if (card) {
      if (diag === "bt-ok") {
        card.style.borderLeft = "3px solid #2ea043";
        card.style.boxShadow  = "inset 3px 0 0 rgba(46,160,67,0.15)";
        if (!card.querySelector(".bt-ok-badge")) {
          const badge = document.createElement("div");
          badge.className = "bt-ok-badge";
          badge.textContent = "\u2713 \ubc31\ud14c\uc2a4\ud2b8 \uc720\ud6a8";
          const actionsEl = card.querySelector(".cc-actions");
          if (actionsEl) card.insertBefore(badge, actionsEl);
          else card.appendChild(badge);
        }
      } else if (diag === "bt-bad") {
        card.style.borderLeft = "3px solid #e53935";
        card.style.boxShadow  = "inset 3px 0 0 rgba(229,57,53,0.12)";
      } else {
        card.style.borderLeft = "3px solid #d29922";
        card.style.boxShadow  = "inset 3px 0 0 rgba(210,153,34,0.12)";
      }
    }
  }, 20);
}


function _restoreScanCache() {
  const rs       = document.getElementById("resultsSection");
  const grid     = document.getElementById("candidatesGrid");
  const countEl  = document.getElementById("resultCount");
  const labelEl  = document.getElementById("resultLabel");
  try {
    const cacheMap = _loadScanCacheMap();
    const cache = cacheMap[_scanCacheId(_scanType, _market)];
    if (!cache) {
      _results = [];
      if (rs) rs.style.display = "none";
      const _kwEl = document.getElementById("kosdaqWarn");
      if (_kwEl) _kwEl.style.display = "none";
      return;
    }
    _results = cache.results || [];
    if (_results.length === 0) {
      if (rs) rs.style.display = "none";
      const _kwEl = document.getElementById("kosdaqWarn");
      if (_kwEl) _kwEl.style.display = "none";
      return;
    }
    if (rs)      rs.style.display     = "block";
    if (countEl) countEl.textContent  = `${_results.length}개 발견`;
    const label = { kospi: "코스피", kosdaq: "코스닥", us: "미국" }[_market] || _market;
    if (labelEl) {
      const _dn = cache.lastBarDate ? ` — ${cache.lastBarDate} 종가 기준` : "";
      labelEl.textContent = cache.type === "kumo"
        ? `${label} 전체 분석 완료 (체류기간 순)${_dn} (이전 결과)`
        : `${label} 전체 분석 완료 (백테스트 유효 우선 · 점수 순)${_dn} (이전 결과)`;
    }
    if (grid) {
      grid.innerHTML = cache.type === "kumo"
        ? _results.map(c => renderKumoCard(c)).join("")
        : _results.map((c, i) => renderFisCard(c, i)).join("");
    }
    // 코스닥 경고 복원
    const _kwEl = document.getElementById("kosdaqWarn");
    if (_kwEl) _kwEl.style.display = (cache.market === "kosdaq" && cache.type === "fis") ? "block" : "none";
  } catch(e) {
    _results = [];
    if (rs) rs.style.display = "none";
  }
}

// 페이지 로드 시 이전 결과 자동 복원
document.addEventListener("DOMContentLoaded", () => {
  try {
    const cacheMap = _loadScanCacheMap();
    const lastId = sessionStorage.getItem(SCAN_LAST_KEY);
    const fallbackId = Object.keys(cacheMap)[0] || null;
    const id = lastId || fallbackId;
    if (!id) {
      _restoreScanCache();
      return;
    }
    const [type, market] = id.split("|");
    // 저장된 탭/마켓으로 UI 복원 → 내부에서 _restoreScanCache 호출됨
    if (type) selectScanType(type);
    if (market) selectMarket(market);
  } catch(e) {}
});