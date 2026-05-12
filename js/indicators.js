/* ============================================================
   js/indicators.js  —  CFIE v4.0
   engine/data.py::calc_indicators + engine/fis.py 완전 포팅
   (Python 코드와 알고리즘 100% 동일)
   ============================================================ */

// ── 기본 유틸 ─────────────────────────────────────────────
function _clip(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _fnum(v, def = 0.0) {
  if (v === null || v === undefined) return def;
  const n = Number(v); return (isNaN(n) || !isFinite(n)) ? def : n;
}
function _rangePos(close, low, high, def = 0.5) {
  if (high <= low) return def;
  return _clip((close - low) / (high - low), 0.0, 1.0);
}

// ── 롤링 계산 ─────────────────────────────────────────────
// EMA alpha=2/(span+1) [pd.ewm(span=n, adjust=False)]
function _emaArr(values, span) {
  const alpha = 2 / (span + 1);
  const result = new Array(values.length).fill(NaN);
  let e = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || isNaN(v)) { result[i] = e; continue; }
    e = isNaN(e) ? v : alpha * v + (1 - alpha) * e;
    result[i] = e;
  }
  return result;
}
// Wilder smoothing alpha=1/period [pd.ewm(alpha=1/period, adjust=False)]
function _wildersArr(values, period) {
  const alpha = 1 / period;
  const result = new Array(values.length).fill(NaN);
  let e = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || isNaN(v)) { result[i] = e; continue; }
    e = isNaN(e) ? v : alpha * v + (1 - alpha) * e;
    result[i] = e;
  }
  return result;
}
// SMA [pd.rolling(period).mean()]
function _smaArr(values, period) {
  const result = new Array(values.length).fill(NaN);
  const buf = []; let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || isNaN(v)) { result[i] = NaN; continue; }
    buf.push(v); sum += v;
    if (buf.length > period) sum -= buf.shift();
    result[i] = buf.length >= period ? sum / buf.length : NaN;
  }
  return result;
}
// Rolling std [pd.rolling(period).std()]
function _rollingStd(values, period) {
  const result = new Array(values.length).fill(NaN);
  const buf = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || isNaN(v)) { result[i] = NaN; continue; }
    buf.push(v);
    if (buf.length > period) buf.shift();
    if (buf.length < period) { result[i] = NaN; continue; }
    const m = buf.reduce((a, b) => a + b, 0) / buf.length;
    const va = buf.reduce((a, b) => a + (b - m) ** 2, 0) / (buf.length - 1);
    result[i] = Math.sqrt(va);
  }
  return result;
}
function _rollingMax(values, period, minPeriods = 1) {
  const result = new Array(values.length).fill(NaN);
  const buf = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || isNaN(v)) { result[i] = NaN; continue; }
    buf.push(v);
    if (buf.length > period) buf.shift();
    result[i] = buf.length >= minPeriods ? Math.max(...buf) : NaN;
  }
  return result;
}
function _rollingMin(values, period, minPeriods = 1) {
  const result = new Array(values.length).fill(NaN);
  const buf = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || isNaN(v)) { result[i] = NaN; continue; }
    buf.push(v);
    if (buf.length > period) buf.shift();
    result[i] = buf.length >= minPeriods ? Math.min(...buf) : NaN;
  }
  return result;
}

// ── calcIndicators  (engine/data.py::calc_indicators 완전 포팅) ──────────
function calcIndicators(bars) {
  const n = bars.length;
  if (n === 0) return [];
  const opens   = bars.map(b => b.open);
  const highs   = bars.map(b => b.high);
  const lows    = bars.map(b => b.low);
  const closes  = bars.map(b => b.close);
  const volumes = bars.map(b => b.volume);

  // EMA (alpha = 2/(span+1))
  const ema5   = _emaArr(closes, 5);
  const ema10  = _emaArr(closes, 10);
  const ema20  = _emaArr(closes, 20);
  const ema60  = _emaArr(closes, 60);
  const ema120 = _emaArr(closes, 120);
  const ema12  = _emaArr(closes, 12);
  const ema26  = _emaArr(closes, 26);

  // TR (True Range)
  const tr = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const hl = highs[i] - lows[i];
    const hc = i > 0 ? Math.abs(highs[i] - closes[i-1]) : 0;
    const lc = i > 0 ? Math.abs(lows[i] - closes[i-1]) : 0;
    tr[i] = Math.max(hl, hc, lc);
  }
  // ATR14 uses SMA (data.py: tr.rolling(14).mean())
  const atr14 = _smaArr(tr, 14);
  const atr60 = _smaArr(tr, 60);

  // Bollinger Bands
  const bb_mid   = _smaArr(closes, 20);
  const bb_std   = _rollingStd(closes, 20);
  const bb_up    = bb_mid.map((m, i) => isNaN(m)||isNaN(bb_std[i]) ? NaN : m + 2*bb_std[i]);
  const bb_dn    = bb_mid.map((m, i) => isNaN(m)||isNaN(bb_std[i]) ? NaN : m - 2*bb_std[i]);
  const bb_width = bb_mid.map((m, i) => (!m||isNaN(bb_up[i])) ? NaN : (bb_up[i]-bb_dn[i])/m);

  // ADX: Wilder smoothing (alpha=1/14) — data.py: ewm(alpha=1/period, adjust=False)
  const plusDM_raw  = new Array(n).fill(0);
  const minusDM_raw = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i-1];
    const dn = lows[i-1] - lows[i];
    if (up > dn && up > 0) plusDM_raw[i] = up;
    if (dn > up && dn > 0) minusDM_raw[i] = dn;
  }
  const atrW   = _wildersArr(tr, 14);
  const pdiRaw = _wildersArr(plusDM_raw, 14);
  const mdiRaw = _wildersArr(minusDM_raw, 14);
  const plusDI  = pdiRaw.map((v, i) => atrW[i] > 0 ? 100*v/atrW[i] : NaN);
  const minusDI = mdiRaw.map((v, i) => atrW[i] > 0 ? 100*v/atrW[i] : NaN);
  const dx = plusDI.map((p, i) => {
    const m = minusDI[i]; if (isNaN(p)||isNaN(m)) return NaN;
    const s = p + m; return s === 0 ? 0 : 100*Math.abs(p-m)/s;
  });
  const adx14 = _wildersArr(dx, 14);

  // Ichimoku (9/26/52) — 선행스팬A,B를 shift(26) 적용
  const hi9  = _rollingMax(highs, 9,  9);
  const lo9  = _rollingMin(lows,  9,  9);
  const hi26 = _rollingMax(highs, 26, 26);
  const lo26 = _rollingMin(lows,  26, 26);
  const hi52 = _rollingMax(highs, 52, 52);
  const lo52 = _rollingMin(lows,  52, 52);
  const tenkan = hi9.map((h, i) => isNaN(h)||isNaN(lo9[i]) ? NaN : (h+lo9[i])/2);
  const kijun  = hi26.map((h, i) => isNaN(h)||isNaN(lo26[i]) ? NaN : (h+lo26[i])/2);
  const senkouA = new Array(n).fill(NaN);
  const senkouB = new Array(n).fill(NaN);
  for (let i = 26; i < n; i++) {
    if (!isNaN(tenkan[i-26]) && !isNaN(kijun[i-26]))
      senkouA[i] = (tenkan[i-26] + kijun[i-26]) / 2;
    if (!isNaN(hi52[i-26]) && !isNaN(lo52[i-26]))
      senkouB[i] = (hi52[i-26] + lo52[i-26]) / 2;
  }

  // Volume
  const vol20 = _smaArr(volumes, 20);
  const rvol  = volumes.map((v, i) => vol20[i] > 0 ? v/vol20[i] : NaN);

  // 52주 위치 범위 (range_window=252)
  const rw = 252, minP = Math.max(5, Math.floor(rw/4));
  const rangeHigh = _rollingMax(highs, rw, minP);
  const rangeLow  = _rollingMin(lows,  rw, minP);

  // RSI (SMA버전 — data.py: rolling(14).mean())
  const deltas = closes.map((c, i) => i===0 ? NaN : c-closes[i-1]);
  const gains  = deltas.map(d => (isNaN(d)||d<0) ? 0 : d);
  const losses = deltas.map(d => (isNaN(d)||d>0) ? 0 : -d);
  const avgGain = _smaArr(gains, 14);
  const avgLoss = _smaArr(losses, 14);
  const rsi14 = avgGain.map((g, i) => {
    const l = avgLoss[i]; if (isNaN(g)||isNaN(l)) return NaN;
    return l===0 ? 100 : 100-100/(1+g/l);
  });

  // ROC20
  const roc20 = closes.map((c, i) => (i<20||closes[i-20]===0) ? NaN : (c-closes[i-20])/closes[i-20]*100);

  // MACD (12/26/9)
  const macdLine = ema12.map((e12, i) => isNaN(e12)||isNaN(ema26[i]) ? NaN : e12-ema26[i]);
  const macdSig  = _emaArr(macdLine, 9);
  const macdHist = macdLine.map((m, i) => isNaN(m)||isNaN(macdSig[i]) ? NaN : m-macdSig[i]);

  // 캔들 구조 보조
  const spread   = highs.map((h, i) => h-lows[i]);
  const closePos = closes.map((c, i) => spread[i]>0 ? _clip((c-lows[i])/spread[i],0,1) : 0.5);
  const upperWick= highs.map((h, i) => spread[i]>0 ? (h-Math.max(opens[i],closes[i]))/spread[i] : 0);

  // enriched bars 배열 조합
  return bars.map((b, i) => ({
    ...b,
    EMA5:  ema5[i],  EMA10: ema10[i], EMA20: ema20[i],
    EMA60: ema60[i], EMA120: ema120[i],
    ATR14: atr14[i], ATR60: atr60[i],
    BB_MID: bb_mid[i], BB_UP: bb_up[i], BB_DN: bb_dn[i], BB_width: bb_width[i],
    ADX14: adx14[i], PLUS_DI14: plusDI[i], MINUS_DI14: minusDI[i],
    ICH_TENKAN: tenkan[i], ICH_KIJUN: kijun[i],
    ICH_SENKOU_A: senkouA[i], ICH_SENKOU_B: senkouB[i],
    Vol20: vol20[i], RVOL: rvol[i],
    RangeHigh: rangeHigh[i], RangeLow: rangeLow[i],
    RSI14: rsi14[i], ROC20: roc20[i],
    MACD: macdLine[i], MACD_SIG: macdSig[i], MACD_HIST: macdHist[i],
    ClosePos: closePos[i], UpperWickRatio: upperWick[i],
  }));
}

// ── FIS 점수 함수들 (engine/fis.py 완전 포팅) ─────────────

function _cloudStatus(bar) {
  const ca = _fnum(bar.ICH_SENKOU_A, NaN);
  const cb = _fnum(bar.ICH_SENKOU_B, NaN);
  const c  = _fnum(bar.close);
  if (isNaN(ca)||isNaN(cb)) return ["구름 정보 부족", 0];
  const top = Math.max(ca, cb), bot = Math.min(ca, cb);
  if (c > top) return ["구름 위 — 매수 우세", 1];
  if (c < bot) return ["구름 아래 — 매도 우세", -1];
  return ["구름 내부 — 중립", 0];
}

function scoreTrend(enriched, idx) {
  const row   = enriched[idx];
  const close = _fnum(row.close);
  const ema20 = _fnum(row.EMA20, close);
  const ema60 = _fnum(row.EMA60, close);
  const ema120= _fnum(row.EMA120, close);
  let s = 0;
  s += close >= ema20  ? 6 : -6;
  s += close >= ema60  ? 7 : -7;
  s += ema20  >= ema60 ? 6 : -6;
  s += ema60  >= ema120? 5 : -5;
  if (idx >= 8) {
    const prev20 = _fnum(enriched[idx-8].EMA20, ema20);
    s += ema20 >= prev20 ? 3 : -3;
  }
  const adx = _fnum(row.ADX14, 18), pdi = _fnum(row.PLUS_DI14), mdi = _fnum(row.MINUS_DI14);
  const atr  = _fnum(row.ATR14);
  if (adx >= 22) s += pdi >= mdi ? 3 : -3;
  else if (adx < 15)
    s -= Math.abs(close-ema20) < Math.max(atr, close*0.005) ? 1 : 0;
  return _clip(s, -30, 30);
}

function scoreMomentum(enriched, idx) {
  const row      = enriched[idx];
  const close    = _fnum(row.close);
  const atr      = _fnum(row.ATR14);
  const atrPct   = (close>0 && atr>0) ? atr/close*100 : 1.0;
  const roc20    = _fnum(row.ROC20);
  const macdHist = _fnum(row.MACD_HIST);
  const rsi      = _fnum(row.RSI14, 50);
  const impulse  = roc20 / Math.max(atrPct*2.5, 0.5);
  let s = _clip(impulse*6, -8, 8);
  if (atr > 0) s += _clip((macdHist/atr)*120, -4, 4);
  if (55<=rsi&&rsi<=68) s += 4;
  else if (45<=rsi&&rsi<55) s += 1.5;
  else if (rsi>=75) s -= 2.5;
  else if (rsi<=35) s -= 4;
  if (idx >= 3) s += close >= _fnum(enriched[idx-3].close, close) ? 2 : -2;
  return _clip(s, -20, 20);
}

function scoreStructure(enriched, idx) {
  if (idx < 8) return 0.0;
  const row  = enriched[idx];
  const win  = enriched.slice(Math.max(0, idx-20), idx+1);
  const wn   = win.length;
  let s = 0;
  const fh = _fnum(win[0].high), mh = _fnum(win[Math.floor(wn/2)].high, fh), lh = _fnum(win[wn-1].high, mh);
  const fl = _fnum(win[0].low),  ml = _fnum(win[Math.floor(wn/2)].low, fl),  ll = _fnum(win[wn-1].low, ml);
  if (lh>mh&&mh>fh) s+=5; else if (lh<mh&&mh<fh) s-=5;
  if (ll>ml&&ml>fl) s+=5; else if (ll<ml&&ml<fl) s-=5;
  const [, cloudDir] = _cloudStatus(row);
  s += cloudDir * 4;
  const kijun = _fnum(row.ICH_KIJUN, _fnum(row.EMA20, 0));
  const close  = _fnum(row.close);
  s += close >= kijun ? 3 : -3;
  const rh  = _fnum(row.RangeHigh, 0), rl = _fnum(row.RangeLow, 0);
  const rp  = _rangePos(close, rl, rh);
  if (rp>=0.65) s+=3; else if (rp<=0.35) s-=3;
  // bearish bars tail(6) — 마지막 6봉 중 ClosePos<0.4 인 음봉 수
  const tail6  = win.slice(Math.max(0, wn-6));
  const bearN  = tail6.filter(b => b.close < b.open && _fnum(b.ClosePos,0.5) < 0.4).length;
  s -= Math.min(4, bearN);
  return _clip(s, -20, 20);
}

function scoreCompression(enriched, idx) {
  const row  = enriched[idx];
  const atr14 = _fnum(row.ATR14);
  const atr60 = _fnum(row.ATR60, atr14);
  let s = 0;
  if (atr14>0 && atr60>0) {
    const ratio = atr14/atr60;
    if (ratio<=0.85) s+=6; else if (ratio>=1.25) s-=4;
  }
  const bbW   = _fnum(row.BB_width, NaN);
  if (!isNaN(bbW)) {
    const hist60 = enriched.slice(Math.max(0,idx-60), idx+1)
                           .map(b => _fnum(b.BB_width, NaN))
                           .filter(v => !isNaN(v));
    if (hist60.length >= 10) {
      const rank = hist60.filter(v => v <= bbW).length / hist60.length;
      if (rank<=0.25) s+=5; else if (rank>=0.85) s-=3;
    }
  }
  const close = _fnum(row.close);
  const rh = _fnum(row.RangeHigh, 0), rl = _fnum(row.RangeLow, 0);
  const rp = _rangePos(close, rl, rh);
  if (0.55<=rp&&rp<=0.88) s+=5; else if (rp>0.96) s-=4; else if (rp<0.35) s-=5;
  const ema20  = _fnum(row.EMA20, close);
  if (atr14>0) {
    const stretch = Math.abs(close-ema20)/atr14;
    if (stretch<=1.2) s+=4; else if (stretch>=3.0) s-=4;
  }
  return _clip(s, -20, 20);
}

function scoreVolume(enriched, idx) {
  const row   = enriched[idx];
  const rvol  = _fnum(row.RVOL, 1.0);
  const close = _fnum(row.close);
  const open  = _fnum(row.open, close);
  const cp    = _fnum(row.ClosePos, 0.5);
  let s = 0;
  if (rvol>=1.8) s+=4; else if (rvol>=1.2) s+=2; else if (rvol<0.75) s-=2;
  if (close>=open && cp>=0.65) s += rvol>=1.0 ? 3 : 1.5;
  else if (close<open && cp<=0.35 && rvol>=1.2) s-=4;
  const win5   = enriched.slice(Math.max(0,idx-4), idx+1);
  const upVol  = win5.filter(b => b.close>=b.open).reduce((a,b)=>a+_fnum(b.volume),0);
  const dnVol  = win5.filter(b => b.close<b.open).reduce((a,b)=>a+_fnum(b.volume),0);
  if (upVol > dnVol*1.2) s+=3;
  else if (dnVol > upVol*1.2 && dnVol>0) s-=3;
  return _clip(s, -10, 10);
}

function scoreRiskPenalty(enriched, idx) {
  const row   = enriched[idx];
  const close = _fnum(row.close);
  const ema20 = _fnum(row.EMA20, close);
  const ema60 = _fnum(row.EMA60, close);
  const atr   = _fnum(row.ATR14);
  const rvol  = _fnum(row.RVOL, 1.0);
  const cp    = _fnum(row.ClosePos, 0.5);
  const open  = _fnum(row.open, close);
  let p = 0;
  if (atr > 0) {
    const g = (close-ema20)/atr;
    if (g>=3.5) p-=14; else if (g>=2.7) p-=8;
    else if (g<=-3.0) p-=10; else if (g<=-2.2) p-=6;
  }
  const win5 = enriched.slice(Math.max(0,idx-4), idx+1);
  const uwCnt = win5.filter(b => _fnum(b.UpperWickRatio,0) > 0.45).length;
  p -= Math.min(8, uwCnt*2);
  if (rvol>=1.8 && cp<=0.3 && close<open) p-=6;
  const rh = _fnum(row.RangeHigh,0), rl = _fnum(row.RangeLow,0);
  const rp = _rangePos(close, rl, rh);
  if (rp>=0.97 && close<open) p-=4;
  if (atr>0) {
    const adx = _fnum(row.ADX14, 18);
    if (adx<16 &&
        Math.abs(close-ema20)<=Math.max(atr*0.5,close*0.004) &&
        Math.abs(close-ema60)<=Math.max(atr*0.8,close*0.006))
      p-=4;
  }
  return _clip(p, -30, 0);
}

// ── calcFIS (engine/fis.py::calc_fis 완전 포팅) ──────────────────────────
function calcFIS(enriched) {
  return enriched.map((row, i) => {
    const trend    = scoreTrend(enriched, i);
    const momentum = scoreMomentum(enriched, i);
    const structure= scoreStructure(enriched, i);
    const compr    = scoreCompression(enriched, i);
    const volume   = scoreVolume(enriched, i);
    const risk     = scoreRiskPenalty(enriched, i);
    const raw = 1.15*trend + momentum + structure + 0.85*compr + 0.75*volume + risk;
    const fis = _clip(raw*1.05, -100, 100);
    return { ...row, TrendScore:trend, MomentumScore:momentum, StructureScore:structure,
                     CompressionScore:compr, VolumeScore:volume, RiskPenalty:risk, FIS:fis };
  });
}

// ── calcEntryScore (engine/fis.py::calc_entry_score 완전 포팅) ──────────
function calcEntryScore(enriched) {
  const n   = enriched.length;
  const row = enriched[n-1];
  const fis      = _fnum(row.FIS);
  const trend    = _fnum(row.TrendScore);
  const momentum = _fnum(row.MomentumScore);
  const structure= _fnum(row.StructureScore);
  const compr    = _fnum(row.CompressionScore);
  const volume   = _fnum(row.VolumeScore);
  const risk     = _fnum(row.RiskPenalty);
  const close    = _fnum(row.close);
  const open_p   = _fnum(row.open, close);
  const ema10    = _fnum(row.EMA10, close);
  const ema20    = _fnum(row.EMA20, close);
  const ema60    = _fnum(row.EMA60, close);
  const atr      = _fnum(row.ATR14);
  const adx      = _fnum(row.ADX14, 18);
  const rsi      = _fnum(row.RSI14, 50);
  const rvol     = _fnum(row.RVOL, 1.0);
  const bb_up    = _fnum(row.BB_UP, close);
  const bb_dn    = _fnum(row.BB_DN, close);
  const kijun    = _fnum(row.ICH_KIJUN, ema20);
  const rangeLow = _fnum(row.RangeLow);
  const rangeHigh= _fnum(row.RangeHigh);
  const cp       = _fnum(row.ClosePos, 0.5);
  const roc20    = _fnum(row.ROC20);
  const gapAtr   = atr>0 ? (close-ema20)/atr : 0;
  const gapPct   = ema20>0 ? (close-ema20)/ema20*100 : 0;
  const look8    = enriched.slice(Math.max(0,n-8));
  const recHigh  = Math.max(...look8.map(b=>_fnum(b.high,close)));
  const recLow   = Math.min(...look8.map(b=>_fnum(b.low, close)));
  const pbPct    = recHigh>0 ? (recHigh-close)/recHigh*100 : 0;
  const bouncePct= recLow>0  ? (close-recLow)/recLow*100  : 0;
  const rp       = _rangePos(close, rangeLow, rangeHigh);
  const bbPos    = _rangePos(close, bb_dn, bb_up);
  const hNow     = _fnum(row.MACD_HIST);
  const hPrev    = n>=2 ? _fnum(enriched[n-2].MACD_HIST) : hNow;
  const hPrev2   = n>=3 ? _fnum(enriched[n-3].MACD_HIST) : hPrev;
  const histRising = hNow>=hPrev && hPrev>=hPrev2;
  const histFalling= hNow<hPrev  && hPrev<hPrev2;
  const cloudTop   = Math.max(_fnum(row.ICH_SENKOU_A,NaN), _fnum(row.ICH_SENKOU_B,NaN));
  const cloudOk    = !isNaN(cloudTop) && close>=cloudTop;

  // ① 추세 문맥 (0~30)
  let ctx = 0;
  if (fis>=65) ctx+=16; else if (fis>=45) ctx+=12; else if (fis>=25) ctx+=8; else if (fis<0) ctx-=6;
  if (trend>=14) ctx+=8; else if (trend>=7) ctx+=4; else if (trend<0) ctx-=5;
  if (structure>=8) ctx+=5; else if (structure<0) ctx-=4;
  if (adx>=22) ctx+=4; else if (adx<15) ctx-=2;
  if (cloudOk) ctx+=4;
  if (risk>=-6) ctx+=4; else if (risk<=-15) ctx-=6;
  ctx = _clip(ctx, 0, 30);

  // ② 진입 구조 — 4가지 시나리오 중 최적 선택
  let pullback = 0;
  if (gapAtr>=-0.4&&gapAtr<=1.0) pullback+=10; else if (gapAtr>1.0&&gapAtr<=1.8) pullback+=6;
  else if (gapAtr>2.8||gapAtr<-1.2) pullback-=6;
  if (pbPct>=4&&pbPct<=12) pullback+=9; else if (pbPct>=2&&pbPct<4) pullback+=5; else if (pbPct>16) pullback-=5;
  if (rsi>=43&&rsi<=58) pullback+=7; else if (rsi>=38&&rsi<43) pullback+=4; else if (rsi>72) pullback-=4;
  if (rvol<=1.05) pullback+=4;
  pullback = _clip(pullback, 0, 30);

  let breakout = 0;
  if (compr>=8) breakout+=8; else if (compr>=4) breakout+=4;
  if (rp>=0.78&&rp<=0.96) breakout+=8; else if (rp>0.97) breakout-=4;
  if (rvol>=1.4) breakout+=7; else if (rvol>=1.1) breakout+=3;
  if (cp>=0.72&&close>=open_p) breakout+=4;
  if (histRising) breakout+=5;
  breakout = _clip(breakout, 0, 30);

  let continu = 0;
  if (close>=ema10&&ema10>=ema20&&ema20>=ema60) continu+=9;
  else if (close>=ema10&&ema10>=ema20) continu+=5;
  if (momentum>=8) continu+=7; else if (momentum>=3) continu+=4;
  if (roc20>=8) continu+=5; else if (roc20>=4) continu+=3;
  if (histRising) continu+=4;
  if (rvol>=1.2&&cp>=0.65) continu+=5;
  continu = _clip(continu, 0, 30);

  let reversal = 0;
  if (rsi<=35) reversal+=7; else if (rsi<=42) reversal+=4;
  if (bouncePct>=4) reversal+=6; else if (bouncePct>=2) reversal+=3;
  if (close>=ema10) reversal+=5;
  if (histRising&&hNow>0) reversal+=5; else if (histRising) reversal+=3;
  if (cp>=0.65&&rvol>=1.1) reversal+=4;
  reversal = _clip(reversal, 0, 24);

  const setupScores = {"추세 눌림":pullback,"압축 돌파":breakout,"모멘텀 지속":continu,"반전 초기":reversal};
  const sorted = Object.entries(setupScores).sort((a,b)=>b[1]-a[1]);
  const setupName  = sorted[0][0];
  const primary    = sorted[0][1];
  const secondary  = sorted[1][1];
  const setupName2 = secondary>=18 ? sorted[1][0] : "";
  let consensus = 0;
  if (secondary>=20) consensus=(secondary-10)*0.30;
  else if (secondary>=14) consensus=(secondary-10)*0.12;
  const setupQuality = _clip(primary+consensus, 0, 30);

  // ③ 확인 신호 (-6~24)
  let trigger = 0;
  if (close>=ema10) trigger+=5;
  if (close>=ema20) trigger+=4;
  if (close>=kijun) trigger+=4;
  if (cp>=0.62) trigger+=4; else if (cp<=0.35) trigger-=4;
  if (histRising) trigger+=5; else if (histFalling) trigger-=3;
  if (rvol>=1.4&&close>=open_p) trigger+=4; else if (rvol<0.75&&setupName!=="추세 눌림") trigger-=2;
  trigger = _clip(trigger, -6, 24);

  // ④ 저항 여유 (-6~18)
  let space = 0;
  if (rp>=0.55&&rp<=0.9) space+=9; else if (rp>0.9&&rp<=0.96) space+=4;
  else if (rp>0.97) space-=6; else if (rp<0.35) space-=3;
  if (bbPos>=0.35&&bbPos<=0.82) space+=5; else if (bbPos>0.92) space-=4;
  if (risk>=-4) space+=4; else if (risk<=-15) space-=4;
  space = _clip(space, -6, 18);

  // ⑤ 리스크 관리 (0~16)
  let riskCtrl = 0;
  if (risk>=-4) riskCtrl+=10; else if (risk>=-9) riskCtrl+=6; else if (risk>=-14) riskCtrl+=2; else riskCtrl-=4;
  if (atr>0&&Math.abs(close-ema20)/atr<=2.2) riskCtrl+=4;
  if (adx>=18) riskCtrl+=3;
  riskCtrl = _clip(riskCtrl, 0, 16);

  // 합산 → 정규화 /1.18
  const rawTotal = ctx + setupQuality + trigger + space + riskCtrl;
  const total    = _clip(Math.round(rawTotal/1.18), 0, 100);
  let label;
  if (total>=80) label="최적 진입 구간";
  else if (total>=65) label="양호한 진입 구간";
  else if (total>=50) label="조건부 진입 가능";
  else label="진입 대기 구간";

  return {
    score: total, label,
    setup_name: setupName, setup_name2: setupName2,
    setup_scores: Object.fromEntries(Object.entries(setupScores).map(([k,v])=>[k,Math.round(v*10)/10])),
    components: {
      "추세문맥":   Math.round(ctx*10)/10,
      "진입구조":   Math.round(setupQuality*10)/10,
      "확인신호":   Math.round(trigger*10)/10,
      "저항여유":   Math.round(space*10)/10,
      "리스크관리": Math.round(riskCtrl*10)/10,
    },
    metrics: {
      ema20_gap_pct: Math.round(gapPct*100)/100,
      ema20_gap_atr: Math.round(gapAtr*100)/100,
      pullback_pct:  Math.round(pbPct*100)/100,
      bounce_pct:    Math.round(bouncePct*100)/100,
      range_pos:     Math.round(rp*1000)/10,
      bb_pos:        Math.round(bbPos*1000)/10,
      rsi_reset:     Math.round(rsi*10)/10,
      adx:           Math.round(adx*10)/10,
    },
  };
}

// ── makeJudgment (engine/fis.py::make_judgment 완전 포팅) ────────────────
function makeJudgment(enriched) {
  const n   = enriched.length;
  const row = enriched[n-1];
  const fis      = _fnum(row.FIS);
  const trend    = _fnum(row.TrendScore);
  const momentum = _fnum(row.MomentumScore);
  const structure= _fnum(row.StructureScore);
  const compr    = _fnum(row.CompressionScore);
  const volume   = _fnum(row.VolumeScore);
  const risk     = _fnum(row.RiskPenalty);
  const rsi      = _fnum(row.RSI14, 50);
  const rvol     = _fnum(row.RVOL, 1.0);
  const close    = _fnum(row.close);
  let label, label_color;
  if (fis>=65) { label="강한 상승 우위"; label_color="#D32F2F"; }
  else if (fis>=30) { label="상승 우위"; label_color="#E57373"; }
  else if (fis>=5)  { label="중립 이상"; label_color="#F9A825"; }
  else if (fis>=-20){ label="중립 약세"; label_color="#64B5F6"; }
  else if (fis>=-50){ label="하락 우위"; label_color="#1565C0"; }
  else              { label="강한 하락 우위"; label_color="#0D47A1"; }

  const scores = { 추세:trend, 모멘텀:momentum, 구조:structure, 압축:compr, 거래량:volume, 위험감점:risk };
  const posName = Object.entries(scores).reduce((a,b)=>b[1]>a[1]?b:a)[0];
  const negName = Object.entries(scores).reduce((a,b)=>b[1]<a[1]?b:a)[0];

  const clues = [];
  if (trend>=14) clues.push("이평 정렬과 추세 기울기가 견조하다");
  else if (trend<=-8) clues.push("이평 구조가 하방 쪽으로 틀어져 있다");
  if (momentum>=8) clues.push("모멘텀 가속이 붙어 탄력이 살아 있다");
  else if (momentum<=-6) clues.push("모멘텀 둔화가 뚜렷해 추격은 불리하다");
  if (structure>=8) clues.push("고점/저점 구조가 우상향으로 유지된다");
  else if (structure<=-6) clues.push("고점/저점 구조가 무너져 반등 신뢰가 낮다");
  if (compr>=8) clues.push("압축 이후 확장 가능성이 열려 있다");
  else if (compr<=-6) clues.push("위치상 저항 부담이 커 상단 여유가 좁다");
  if (volume>=4) clues.push("거래 참여가 붙어 신호 신뢰도가 보강된다");
  else if (volume<=-3) clues.push("거래 참여가 약해 신호 신뢰가 떨어진다");
  if (!clues.length) {
    if (fis>=20) clues.push("방향성은 우상향이나 확신 강도는 중간 수준이다");
    else if (fis<=-20) clues.push("방향성은 하방 우세이며 복원 신호가 부족하다");
    else clues.push("방향성 우위가 약해 추가 확인이 필요하다");
  }
  const leadText = clues.slice(0,2).join(" · ");
  const riskClues = [];
  if (risk<=-15) riskClues.push("단기 과열/매물 부담이 커 리스크 관리가 우선이다");
  else if (risk<=-8) riskClues.push("리스크 감점이 누적되어 진입 크기 조절이 필요하다");
  else if (risk>=-3) riskClues.push("위험 감점이 낮아 관리 가능한 구간이다");
  if (rsi>=72) riskClues.push(`RSI ${rsi.toFixed(1)}로 과열권이라 눌림 확인 후 접근이 유리하다`);
  else if (rsi<=34) riskClues.push(`RSI ${rsi.toFixed(1)} 저점권으로 반등 신호 확인이 핵심이다`);
  if (rvol>=1.8) riskClues.push("거래량 급증 구간이라 방향 확인 봉의 중요도가 높다");
  else if (rvol<0.8) riskClues.push("거래량이 약해 돌파 신호의 지속성 검증이 필요하다");

  let stance;
  if (fis>=45) stance="보유는 추세선 이탈 전까지 우위가 유지되며 신규 진입은 눌림/재돌파 확인이 유리하다";
  else if (fis>=10) stance="보유는 중립 관리가 적절하고 신규 진입은 타이밍 점수와 저항 여유를 함께 확인해야 한다";
  else if (fis>=-20) stance="보유는 방어 비중을 높이고 신규 진입은 추세 복원 신호가 확인될 때까지 대기하는 편이 낫다";
  else stance="보유는 손절 기준 중심 방어가 우선이며 신규 진입은 공격적으로 보기 어렵다";

  const sl1 = `${leadText}. 핵심 강점은 ${posName}, 취약 지점은 ${negName}이며 FIS는 ${fis.toFixed(1)}이다.`;
  const sl2 = `${stance}. ${riskClues[0]||"진입 전 손익비와 손절 기준을 먼저 고정하는 것이 좋다."} (RSI ${rsi.toFixed(1)}, RVOL ${rvol.toFixed(2)}x)`;

  const [ichimokuStatus] = _cloudStatus(row);
  let rsiStatus;
  if (rsi>=70) rsiStatus=`과매수 (${rsi.toFixed(1)})`;
  else if (rsi<=30) rsiStatus=`과매도 (${rsi.toFixed(1)})`;
  else rsiStatus=`중립 (${rsi.toFixed(1)})`;

  return {
    fis, label, label_color, summary_l1:sl1, summary_l2:sl2,
    ichimoku_status: ichimokuStatus, rsi_status: rsiStatus,
    scores, price: close,
  };
}

// ── 공통 포맷 헬퍼 ──────────────────────────────────────
function fisColor(fis) {
  if (fis>=65) return "#D32F2F"; if (fis>=30) return "#E57373";
  if (fis>=5)  return "#F9A825"; if (fis>=-20) return "#64B5F6";
  if (fis>=-50) return "#1565C0"; return "#0D47A1";
}
function fisLabelText(fis) {
  if (fis>=65) return "강한 상승 우위"; if (fis>=30) return "상승 우위";
  if (fis>=5)  return "중립 이상";      if (fis>=-20) return "중립 약세";
  if (fis>=-50) return "하락 우위";     return "강한 하락 우위";
}

