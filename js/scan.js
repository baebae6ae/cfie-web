/* js/scan.js  —  CFIE v4.0 (수정본) */

// ── 상태 ────────────────────────────────────────────────
let _scanType    = "fis";
let _market      = "kospi";
let _scanning    = false;
let _stopScan    = false;
let _universe    = {};
let _results     = [];

// 필터 기준 및 설정
const FIS_FILTER = { fis: 30, entry: 55, risk: -16, trend: 0 };
const KUMO_BELOW_MIN    = 10;
const KUMO_BRK_LOOKBACK = 18;
const KUMO_TWIST_RANGE  = 8;
const KUMO_VOL_MULT     = 1.8;
const KUMO_BODY_RATIO   = 0.25;

// MAX_RESULTS 제한을 사실상 제거 (혹은 충분히 크게 설정)
const BATCH_SIZE  = 4; 
const _btFisBarsCache = {};  // 종목별 fisBars 캐시 (백테스트용)

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
        _results.sort((a, b) => (b.entry_score || 0) - (a.entry_score || 0));
        if (grid) grid.innerHTML = _results.map((c, i) => renderFisCard(c, i)).join("");
      } else if (_scanType === "kumo") {
        _results.sort((a, b) => (b.below_weeks || 0) - (a.below_weeks || 0));
        if (grid) grid.innerHTML = _results.map(c => renderKumoCard(c)).join("");
      }
    }

    const label = { kospi: "코스피", kosdaq: "코스닥", us: "미국" }[_market];
    const resultLabel = document.getElementById("resultLabel");
    if (resultLabel) {
      resultLabel.textContent = _scanType === "kumo"
        ? `${label} 전체 분석 완료 (체류기간 순)`
        : `${label} 전체 분석 완료 (점수 순)`;
    }
    // 코스닥 경고 표시/숨김 (백테스트 근거)
    const kosdaqWarnEl = document.getElementById("kosdaqWarn");
    if (kosdaqWarnEl) kosdaqWarnEl.style.display = (_market === "kosdaq" && _scanType === "fis") ? "block" : "none";
    // 스캔 결과 sessionStorage에 저장 (페이지 이동 후 복귀 시 유지)
    if (!_stopScan && _results.length > 0) {
      try {
        sessionStorage.setItem("cfie_scan_cache", JSON.stringify({
          type: _scanType, market: _market, results: _results
        }));
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
      // Python: fetch(ticker, "1y")
      const { bars } = await fetchOHLCV(ticker, "1y", "1d");
      if (!bars || bars.length < 60) return null;
      return _analyzeFis(ticker, name, bars);
    } else {
      // Python: fetch(ticker, "2y")
      const { bars } = await fetchOHLCV(ticker, "2y", "1d");
      if (!bars || bars.length < 60) return null;
      return _analyzeKumo(ticker, name, bars);
    }
  } catch(e) { return null; }
}

// ── FIS 분석 ─────────────────────────────────────────────
// Python _analyze_one 동일:
//   df → calc_indicators → calc_fis → make_judgment → calc_entry_score
//   필터: fis>=30, entry_score>=55, risk>-16, trend>0
//   risk는 df_fis["RiskPenalty"] 즉 마지막 봉의 RiskPenalty 값
//   trend는 df_fis["TrendScore"] 즉 마지막 봉의 TrendScore 값
function _analyzeFis(ticker, name, bars) {
  const df = calcIndicators(bars);
  if (!df || df.length < 30) return null;
  const fisBars = calcFIS(df);
  if (!fisBars || fisBars.length === 0) return null;
  const judgment = makeJudgment(fisBars);
  if (!judgment) return null;

  const last = fisBars[fisBars.length - 1];

  // Python: float(last["TrendScore"]), float(last["RiskPenalty"]) 등
  // calcFIS가 각 봉에 TrendScore, MomentumScore, StructureScore,
  // CompressionScore, VolumeScore, RiskPenalty 컬럼을 부여한다고 가정
  const trend       = last.TrendScore       ?? 0;
  const momentum    = last.MomentumScore    ?? 0;
  const structure   = last.StructureScore   ?? 0;
  const compression = last.CompressionScore ?? 0;
  const volume      = last.VolumeScore      ?? 0;
  const risk        = last.RiskPenalty      ?? 0;   // 감점값 (음수)

  const fis = judgment.fis ?? 0;

  // 기계적 진입 조건 1: FIS >= 65 (max raw~99 기준 강한 추세)
  if (fis < 60) return null;   // FIS>=60: ?? ?? ?? (??~20%)

  // 섹터 context
  const _scanSectorName = (typeof STOCK_SECTOR_MAP !== "undefined") ? STOCK_SECTOR_MAP[ticker] : null;
  const _scanSectorFIS  = _scanSectorName != null ? (_sectorFISCache[_scanSectorName] ?? null) : null;
  const _scanContext    = { sectorName: _scanSectorName, sectorFIS: _scanSectorFIS };

  const entryData = calcEntryScore(fisBars, _scanContext);
  if (!entryData) return null;
  const entry = entryData.score ?? 0;

  // 기계적 진입 조건 2: 통합 진입 점수 >= 70 (양호한 진입 구간)
  if (entry < 65) return null;  // Entry>=65: 

  // ???? entry score? ?? ??(-8~+8) ? hard filter ?? (FIS>=60 ??? EMA20>EMA60 ?? ???? biu? ??? ??)
  const biu = entryData.metrics?.freshness_bars ?? 0;
  // (biu > N hard filter ?? ? entry score? ???? biu>55 ?? -8? ??)

  const close_v  = last.close  ?? last.Close  ?? 0;
  const ema20_v  = last.EMA20  ?? close_v;
  const atr_v    = last.ATR14  ?? 0;
  const high20_v = fisBars.slice(-20).reduce((m, b) =>
    Math.max(m, b.high ?? b.High ?? 0), -Infinity);
  const ema20_gap = ema20_v > 0
    ? Math.round(((close_v - ema20_v) / ema20_v * 100) * 10) / 10
    : 0;

  // 기계적 진입 조건 4: 현재가 기준 R:R >= 2.0
  // 진입손절 = EMA20-ATR×1 (추세 지지선 기준), 목표 = ATR×3
  // ???? = EMA20-ATR, ?? = ???+ATR?3
  const gap_atr_v = atr_v > 0 ? (close_v - ema20_v) / atr_v : 0;

  // ???? ??: gap_atr<0.3 = EMA20 ? ?? ??? (?? ?? ?? ??)
  // gap_atr>1.0 = R:R<1.5? ?? ??? ? ?? ?? ??: 0.3~1.0
  if (gap_atr_v < 0.3) return null;

  // RSI ?? ??: ?? 8? ? RSI?52 ?? ?? (???) ? ?? RSI ??
  // ???? ??: ??? ?? ??? ?? ?? ??? ??? ??
  const rsiHistory = fisBars.slice(-9, -1).map(b => b.RSI14 ?? 0).filter(r => r > 0);
  const hadPullback = rsiHistory.some(r => r <= 54);
  const rsi_now = last.RSI14 ?? 0;
  if (!hadPullback || rsi_now < 46) return null;

  const _ema_stop = ema20_v - atr_v;
  const _rr_risk  = close_v - _ema_stop;  // = (close-EMA20)+ATR >= ATR
  const rr_val    = (_rr_risk > 0 && atr_v > 0)
    ? Math.round((atr_v * 3) / _rr_risk * 100) / 100
    : 0;
  if (rr_val < 1.5) return null;

  const entry_components   = entryData.components    || {};
  const entry_setup_scores = entryData.setup_scores  || {};
  const entry_metrics      = entryData.metrics       || {};
  const entry_setup_name   = entryData.setup_name    || "";
  const entry_setup_name2  = entryData.setup_name2   || "";

  // fisBars 캐싱 (백테스트 버튼 클릭 시 재활용)
  _btFisBarsCache[ticker] = fisBars;
  const btSim = _runBtSim(fisBars);  // 카드 렌더링 시 즉시 강조용

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
    btAvgR:       btSim?.avgR ?? null,
    btWinRate:    btSim?.winRate ?? null,
    btTotal:      btSim?.total ?? 0,
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
  if (!hadTwist && bull[n - 1] !== 1) return null;

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

  const closeV = ich[n - 1].close;
  // fisBars 캐싱 (백테스트 버튼 클릭 시 재활용)
  _btFisBarsCache[ticker] = fisBars;

  return {
    ticker,
    name,
    close:       closeV,
    below_weeks: belowCnt,
    cloud_thin:  minThickPct,
    bull_cloud:  bull[n - 1] === 1,
    daily_vol:   bigCandle,
    had_twist:   hadTwist,
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

  const btDiag   = c.btDiag ?? "";
  // bt ?? ?? ???: ?? ?? ?? ?? ?? ?? + ????
  const cardStyle = btDiag === "bt-ok"
    ? 'style="border-left:3px solid #2ea043;box-shadow:inset 3px 0 0 rgba(46,160,67,0.15);position:relative"'
    : btDiag === "bt-bad"
    ? 'style="border-left:3px solid #e53935;box-shadow:inset 3px 0 0 rgba(229,57,53,0.12);position:relative"'
    : btDiag === "bt-warn"
    ? 'style="border-left:3px solid #d29922;box-shadow:inset 3px 0 0 rgba(210,153,34,0.12);position:relative"'
    : "";
  const btBadge = btDiag === "bt-ok"
    ? `<div class="bt-ok-badge" style="position:absolute;top:8px;right:8px;background:rgba(46,160,67,0.15);color:#2ea043;border:1px solid rgba(46,160,67,0.4);font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700">✓ 백테스트 유효</div>`
    : "";

  return `
  <div class="candidate-card" ${cardStyle}>
  ${btBadge}
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
    <div class="cc-scores">
      <span class="cs-chip ${tCls}" title="추세점수">추세 ${c.trend>=0?"+":""}${c.trend.toFixed(0)}</span>
      <span class="cs-chip ${mCls}" title="모멘텀">모멘텀 ${c.momentum>=0?"+":""}${c.momentum.toFixed(0)}</span>
      <span class="cs-chip" style="background:rgba(21,101,192,0.12);color:#90caf9" title="R:R">R:R ${(c.rr??0).toFixed(1)}</span>
      <span class="cs-chip" title="일목균형표">${(c.ichimoku||"—").split("—")[0].trim()}</span>
    </div>
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
    { label: "③ 확인신호",                                           v: trigger,  max: 24, desc: trigDesc },
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
      <button class="cc-btn cc-btn-analyze" onclick="location.href='analyze.html?t=${encodeURIComponent(c.ticker)}'">차트 분석</button>
    </div>
  </div>`;
}
// ── 미니 백테스트 (스캔 카드 버튼 클릭 시 지연 계산) ──────────────
// ── 백테스트 시뮬레이션 공통 헬퍼 ─────────────────────────────────────
// _analyzeFis 스캔 시 + 백테스트 동시 실행, 결과는 카드에 즉시 반영
function _runBtSim(fisBars) {
  if (!fisBars || typeof calcEntryScore !== "function") return null;
  const n = fisBars.length;
  if (n < 100) return null;
  const MIN_LB = 80;
  const trades = [];
  let skipUntil = 0;
  for (let i = MIN_LB; i < n - 26; i++) {
    if (i < skipUntil) continue;
    const row = fisBars[i];
    if ((row.FIS ?? 0) < 60) continue;
    const entryData = calcEntryScore(fisBars.slice(0, i + 1));
    if (!entryData || (entryData.score ?? 0) < 65) continue;
    const close = row.close ?? row.Close ?? 0;
    const atr   = row.ATR14 ?? 0;
    if (!close || !atr) continue;
    const ema20bt = row.EMA20 ?? close;
    const btRisk  = close - (ema20bt - atr);
    if (btRisk <= 0 || (atr * 3) / btRisk < 1.5) continue;
    const stopLoss = ema20bt - atr;
    const tp2      = close + atr * 3;
    let result = "timeout";
    for (let j = i + 1; j <= Math.min(i + 25, n - 1); j++) {
      const bar = fisBars[j];
      const high = bar.high ?? bar.High ?? bar.close;
      const low  = bar.low  ?? bar.Low  ?? bar.close;
      if (low <= stopLoss) { result = "stop"; break; }
      if (high >= tp2)     { result = "tp2";  break; }
      if (j === Math.min(i + 25, n - 1)) result = "timeout";
    }
    trades.push({ result });
    skipUntil = i + 5;
  }
  if (trades.length === 0) return null;
  const total    = trades.length;
  const nTp2     = trades.filter(t => t.result === "tp2").length;
  const nStop    = trades.filter(t => t.result === "stop").length;
  const nTimeout = trades.filter(t => t.result === "timeout").length;
  const avgR     = (nTp2 * 3.0 + nStop * (-1.0)) / total;
  const winRate  = nTp2 / total * 100;
  const diag     = avgR >= 0.5 ? "bt-ok" : avgR >= 0 ? "bt-warn" : "bt-bad";
  return { total, nTp2, nStop, nTimeout, avgR, winRate, diag };
}

﻿﻿function _showScanBt(ticker, idx) {
  const panel = document.getElementById("bt-panel-" + idx);
  const btn   = document.getElementById("bt-btn-" + idx);
  if (!panel || !btn) return;

  if (panel.style.display !== "none") {
    panel.style.display = "none";
    btn.textContent = "\uD83D\uDCCA \uBC31\uD14C\uC2A4\uD2B8";
    return;
  }

  btn.textContent = "\u23F3 \uACC4\uC0B0 \uC911\u2026";
  btn.disabled = true;
  panel.style.display = "block";
  panel.innerHTML = "<div class='scan-bt-loading'>\uACC4\uC0B0 \uC911\u2026</div>";

  setTimeout(() => {
    const fisBars = _btFisBarsCache[ticker];
    if (!fisBars || typeof calcEntryScore !== "function") {
      panel.innerHTML = "<div class='scan-bt-empty'>\uB370\uC774\uD130 \uC5C6\uC74C</div>";
      btn.textContent = "\uD83D\uDCCA \uBC31\uD14C\uC2A4\uD2B8"; btn.disabled = false; return;
    }

    const sim = _runBtSim(fisBars);
    if (!sim) {
      panel.innerHTML = "<div class='scan-bt-empty'>신호 없음 (데이터 부족)</div>";
      btn.textContent = "📊 백테스트"; btn.disabled = false; return;
    }
    const { total, nTp2, nStop, nTimeout, avgR, winRate, diag } = sim;


    const pc   = (cnt) => total ? (cnt / total * 100).toFixed(0) + "%" : "—";
    const rCol = avgR >= 0.5 ? "#2ea043" : avgR >= 0 ? "#d29922" : "#e53935";
    const wCol = winRate >= 40 ? "#2ea043" : winRate >= 30 ? "#d29922" : "#e53935";
    const diagTxt = avgR >= 0.5
      ? "✓ 전략 유효 — 진입 근거 있음"
      : avgR >= 0 ? "⚠ 경계선, 주의 필요"
      : "⛔ 이 종목은 전략 비효";

    let h = `<div class="scan-bt-note">기계적 전략 시민 · ${total}건 신호 · 손절=EMA20−ATR · 목표=ATR×3 · 25봉 보유 (TP1후 BE트레일 없음)</div>`;
    h += `<div class="scan-bt-hd"><span>결과</span><span>건수</span><span>비율</span></div>`;
    h += `<div class="scan-bt-row"><span style="color:#2ea043;font-weight:700">3R 익절 (TP2)</span><span>${nTp2}</span><span>${pc(nTp2)}</span></div>`;
    h += `<div class="scan-bt-row"><span style="color:#e53935">실손절</span><span>${nStop}</span><span>${pc(nStop)}</span></div>`;
    h += `<div class="scan-bt-row"><span style="color:#888">25봉 첩산</span><span>${nTimeout}</span><span>${pc(nTimeout)}</span></div>`;
    h += `<div class="scan-bt-diag ${diag}">승률 <b style="color:${wCol}">${winRate.toFixed(0)}%</b> &nbsp;·&nbsp; 평균 R <b style="color:${rCol}">${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R</b> &nbsp;—&nbsp; ${diagTxt}</div>`;

    panel.innerHTML = h;
    btn.textContent = "\uD83D\uDCCA \uC811\uAE30"; btn.disabled = false;

    // 백테스트 결과가 bt-ok이면 카드 강조 (평균R>=0.5 + 승률>=40%)
    const card = panel.closest('.candidate-card');
    if (card) {
      card.style.position = 'relative';
      if (diag === 'bt-ok') {
        card.style.borderLeft = '3px solid #2ea043';
        card.style.boxShadow  = 'inset 3px 0 0 rgba(46,160,67,0.15)';
        card.style.background = '';
        if (!card.querySelector('.bt-ok-badge')) {
          const badge = document.createElement('div');
          badge.className = 'bt-ok-badge';
          badge.textContent = '✓ 백테스트 유효';
          badge.style.cssText = 'position:absolute;top:8px;right:8px;background:rgba(46,160,67,0.15);color:#2ea043;border:1px solid rgba(46,160,67,0.4);font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700';
          card.appendChild(badge);
        }
      } else if (diag === 'bt-bad') {
        card.style.borderLeft = '3px solid #e53935';
        card.style.boxShadow  = 'inset 3px 0 0 rgba(229,57,53,0.12)';
        card.style.background = '';
      } else {
        card.style.borderLeft = '3px solid #d29922';
        card.style.boxShadow  = 'inset 3px 0 0 rgba(210,153,34,0.12)';
        card.style.background = '';
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
    const raw = sessionStorage.getItem("cfie_scan_cache");
    if (!raw) { if (rs) rs.style.display = "none"; return; }
    const cache = JSON.parse(raw);
    // 현재 선택된 탭/마켓과 다른 캐시면 숨김
    if (cache.type !== _scanType || cache.market !== _market) {
      if (rs) rs.style.display = "none"; return;
    }
    _results = cache.results || [];
    if (_results.length === 0) { if (rs) rs.style.display = "none"; return; }
    if (rs)      rs.style.display     = "block";
    if (countEl) countEl.textContent  = `${_results.length}개 발견`;
    const label = { kospi: "코스피", kosdaq: "코스닥", us: "미국" }[_market] || _market;
    if (labelEl) labelEl.textContent  = cache.type === "kumo"
      ? `${label} 전체 분석 완료 (체류기간 순) — 이전 결과`
      : `${label} 전체 분석 완료 (점수 순) — 이전 결과`;
    if (grid) {
      grid.innerHTML = cache.type === "kumo"
        ? _results.map(c => renderKumoCard(c)).join("")
        : _results.map((c, i) => renderFisCard(c, i)).join("");
    }
    // 코스닥 경고 복원
    const _kwEl = document.getElementById("kosdaqWarn");
    if (_kwEl) _kwEl.style.display = (cache.market === "kosdaq" && cache.type === "fis") ? "block" : "none";
  } catch(e) { if (rs) rs.style.display = "none"; }
}

// 페이지 로드 시 이전 결과 자동 복원
document.addEventListener("DOMContentLoaded", () => {
  try {
    const raw = sessionStorage.getItem("cfie_scan_cache");
    if (!raw) return;
    const { type, market } = JSON.parse(raw);
    // 저장된 탭/마켓으로 UI 복원 → 내부에서 _restoreScanCache 호출됨
    if (type)   selectScanType(type);
    if (market) selectMarket(market);
  } catch(e) {}
});