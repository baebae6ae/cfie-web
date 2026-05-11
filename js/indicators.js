// ═══════════════════════════════════════════════
// CFIE 기술 지표 라이브러리 (JS port of engine/data.py + fis.py)
// bars: [{ open, high, low, close, volume, time, date }]
// ═══════════════════════════════════════════════

// ── 헬퍼 ─────────────────────────────────────────
const clip  = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const fnum  = (v, def = 0) => (v == null || isNaN(v)) ? def : +v;
const rangePos = (c, lo, hi, def = 0.5) => hi <= lo ? def : clip((c - lo) / (hi - lo), 0, 1);

// ── EMA ──────────────────────────────────────────
export function ema(closes, span) {
  const k = 2 / (span + 1), out = new Array(closes.length).fill(null);
  let e = closes[0];
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] == null) { out[i] = null; continue; }
    e = i === 0 ? closes[i] : closes[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

// ── ATR ──────────────────────────────────────────
export function atr(bars, period = 14) {
  const n = bars.length, out = new Array(n).fill(null);
  const tr = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i-1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
  let sum = tr.slice(0, period).reduce((a,b) => a+b, 0);
  for (let i = period; i <= n; i++) {
    if (i === period) { out[i-1] = sum / period; }
    else { out[i-1] = (out[i-2] * (period-1) + tr[i-1]) / period; }
    if (i < n) sum = sum - tr[i-period] + tr[i];
  }
  return out;
}

// ── RSI ──────────────────────────────────────────
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1];
    avgGain += d > 0 ? d : 0;
    avgLoss += d < 0 ? -d : 0;
  }
  avgGain /= period; avgLoss /= period;
  out[period] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    avgGain = (avgGain * (period-1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period-1) + (d < 0 ? -d : 0)) / period;
    out[i] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
  }
  return out;
}

// ── MACD ─────────────────────────────────────────
export function macd(closes, fast=12, slow=26, signal=9) {
  const e12 = ema(closes, fast), e26 = ema(closes, slow);
  const macdLine = closes.map((_, i) => (e12[i] == null || e26[i] == null) ? null : e12[i] - e26[i]);
  const sigLine  = ema(macdLine.map(v => v ?? 0), signal);
  const hist     = macdLine.map((v, i) => (v == null || sigLine[i] == null) ? null : v - sigLine[i]);
  return { macd: macdLine, signal: sigLine, hist };
}

// ── Bollinger Bands ───────────────────────────────
export function bollinger(closes, period=20, mult=2) {
  const mid = [], up = [], dn = [], width = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { mid.push(null); up.push(null); dn.push(null); width.push(null); continue; }
    const sl = closes.slice(i - period + 1, i + 1);
    const m = sl.reduce((a,b) => a+b) / period;
    const s = Math.sqrt(sl.reduce((a,b) => a + (b-m)**2, 0) / period);
    mid.push(m); up.push(m + mult*s); dn.push(m - mult*s);
    width.push(m > 0 ? (mult*2*s) / m : null);
  }
  return { mid, up, dn, width };
}

// ── ADX ──────────────────────────────────────────
export function adx(bars, period=14) {
  const n = bars.length, adxOut = new Array(n).fill(null);
  const plusDI = new Array(n).fill(null), minusDI = new Array(n).fill(null);
  const alpha = 1 / period;
  let atrSmooth = 0, plusSmooth = 0, minusSmooth = 0, dxSmooth = null;
  for (let i = 1; i < n; i++) {
    const b = bars[i], p = bars[i-1];
    const tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
    const upMove = b.high - p.high, downMove = p.low - b.low;
    const pdm = (upMove > downMove && upMove > 0) ? upMove : 0;
    const mdm = (downMove > upMove && downMove > 0) ? downMove : 0;
    atrSmooth   = i === 1 ? tr   : atrSmooth   * (1-alpha) + tr   * alpha;
    plusSmooth  = i === 1 ? pdm  : plusSmooth  * (1-alpha) + pdm  * alpha;
    minusSmooth = i === 1 ? mdm  : minusSmooth * (1-alpha) + mdm  * alpha;
    if (atrSmooth === 0) continue;
    const pDI = 100 * plusSmooth  / atrSmooth;
    const mDI = 100 * minusSmooth / atrSmooth;
    plusDI[i] = pDI; minusDI[i] = mDI;
    const sumDI = pDI + mDI;
    const dx = sumDI > 0 ? 100 * Math.abs(pDI - mDI) / sumDI : 0;
    dxSmooth = dxSmooth == null ? dx : dxSmooth * (1-alpha) + dx * alpha;
    adxOut[i] = dxSmooth;
  }
  return { adx: adxOut, plusDI, minusDI };
}

// ── Ichimoku ──────────────────────────────────────
export function ichimoku(bars, t=9, k=26, s=52) {
  const n = bars.length;
  const tenkan = new Array(n).fill(null);
  const kijun  = new Array(n).fill(null);
  const senkouA = new Array(n).fill(null);
  const senkouB = new Array(n).fill(null);
  const chikou  = new Array(n).fill(null);

  const hlMid = (bars, from, len) => {
    let hi = -Infinity, lo = Infinity;
    for (let i = from - len + 1; i <= from; i++) {
      if (i < 0) continue;
      hi = Math.max(hi, bars[i].high); lo = Math.min(lo, bars[i].low);
    }
    return hi === -Infinity ? null : (hi + lo) / 2;
  };

  for (let i = 0; i < n; i++) {
    tenkan[i] = hlMid(bars, i, t);
    kijun[i]  = hlMid(bars, i, k);
    if (tenkan[i] != null && kijun[i] != null && i + k < n) {
      senkouA[i + k] = (tenkan[i] + kijun[i]) / 2;
    }
    const sb = hlMid(bars, i, s);
    if (sb != null && i + k < n) senkouB[i + k] = sb;
    if (i - k >= 0) chikou[i - k] = bars[i].close;
  }
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

// ── RVOL (상대 거래량) ─────────────────────────────
export function rvol(volumes, period=20) {
  return volumes.map((v, i) => {
    if (i < period) return null;
    const avg = volumes.slice(i - period, i).reduce((a,b) => a+b, 0) / period;
    return avg > 0 ? v / avg : null;
  });
}

// ── ROC ───────────────────────────────────────────
export function roc(closes, period=20) {
  return closes.map((c, i) => {
    if (i < period || closes[i-period] === 0) return null;
    return (c - closes[i-period]) / closes[i-period] * 100;
  });
}

// ── 전체 지표 계산 (bars 배열 기준) ──────────────────
export function calcIndicators(bars) {
  const closes  = bars.map(b => b.close);
  const highs   = bars.map(b => b.high);
  const lows    = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume);
  const n = bars.length;

  const e5   = ema(closes, 5);
  const e10  = ema(closes, 10);
  const e20  = ema(closes, 20);
  const e60  = ema(closes, 60);
  const e120 = ema(closes, 120);
  const atr14 = atr(bars, 14);
  const atr60 = atr(bars, 60);
  const rsi14  = rsi(closes, 14);
  const macdR  = macd(closes);
  const bb     = bollinger(closes, 20, 2);
  const adxR   = adx(bars, 14);
  const ichiR  = ichimoku(bars, 9, 26, 52);
  const rvolArr = rvol(volumes, 20);
  const roc20  = roc(closes, 20);
  const roc5   = roc(closes, 5);

  const rangeW = Math.min(252, n);
  const rHigh = closes.map((_, i) => Math.max(...highs.slice(Math.max(0, i-rangeW+1), i+1)));
  const rLow  = closes.map((_, i) => Math.min(...lows.slice(Math.max(0, i-rangeW+1), i+1)));

  const spread = bars.map(b => Math.max(b.high - b.low, 1e-10));
  const closePos = bars.map((b,i) => clip((b.close - b.low) / spread[i], 0, 1));
  const upperWick = bars.map((b,i) => (b.high - Math.max(b.open, b.close)) / spread[i]);

  return bars.map((b, i) => ({
    ...b,
    EMA5: e5[i], EMA10: e10[i], EMA20: e20[i], EMA60: e60[i], EMA120: e120[i],
    ATR14: atr14[i], ATR60: atr60[i],
    RSI14: rsi14[i],
    MACD: macdR.macd[i], MACD_SIG: macdR.signal[i], MACD_HIST: macdR.hist[i],
    BB_MID: bb.mid[i], BB_UP: bb.up[i], BB_DN: bb.dn[i], BB_width: bb.width[i],
    ADX14: adxR.adx[i], PLUS_DI14: adxR.plusDI[i], MINUS_DI14: adxR.minusDI[i],
    ICH_TENKAN: ichiR.tenkan[i], ICH_KIJUN: ichiR.kijun[i],
    ICH_SENKOU_A: ichiR.senkouA[i], ICH_SENKOU_B: ichiR.senkouB[i],
    ICH_CHIKOU: ichiR.chikou[i],
    RVOL: rvolArr[i], ROC20: roc20[i], ROC5: roc5[i],
    RangeHigh: rHigh[i], RangeLow: rLow[i],
    ClosePos: closePos[i], UpperWickRatio: upperWick[i],
  }));
}

// ══════════════════════════════════════════════════
// FIS 점수 계산 (port of engine/fis.py)
// ══════════════════════════════════════════════════

function scoreTrend(bars, i) {
  const r = bars[i];
  const c = fnum(r.close), e20 = fnum(r.EMA20, c), e60 = fnum(r.EMA60, c), e120 = fnum(r.EMA120, c);
  let s = 0;
  s += c >= e20  ? 6 : -6;
  s += c >= e60  ? 7 : -7;
  s += e20 >= e60  ? 6 : -6;
  s += e60 >= e120 ? 5 : -5;
  if (i >= 8) s += e20 >= fnum(bars[i-8].EMA20, e20) ? 3 : -3;
  const adx = fnum(r.ADX14, 18), pdi = fnum(r.PLUS_DI14, 0), mdi = fnum(r.MINUS_DI14, 0);
  if (adx >= 22) s += pdi >= mdi ? 3 : -3;
  else if (adx < 15) {
    const atr = fnum(r.ATR14, 0);
    if (Math.abs(c - e20) < Math.max(atr, c * 0.005)) s -= 1;
  }
  return clip(s, -30, 30);
}

function scoreMomentum(bars, i) {
  const r = bars[i];
  const c = fnum(r.close), atrV = fnum(r.ATR14), atrPct = c > 0 && atrV > 0 ? atrV / c * 100 : 1;
  const roc20V = fnum(r.ROC20), macdH = fnum(r.MACD_HIST), rsiV = fnum(r.RSI14, 50);
  let s = clip((roc20V / Math.max(atrPct * 2.5, 0.5)) * 6, -8, 8);
  if (atrV > 0) s += clip((macdH / atrV) * 120, -4, 4);
  if (rsiV >= 55 && rsiV <= 68) s += 4;
  else if (rsiV >= 45 && rsiV < 55) s += 1.5;
  else if (rsiV >= 75) s -= 2.5;
  else if (rsiV <= 35) s -= 4;
  if (i >= 3) s += c >= fnum(bars[i-3].close, c) ? 2 : -2;
  return clip(s, -20, 20);
}

function scoreStructure(bars, i) {
  if (i < 8) return 0;
  const r = bars[i], win = bars.slice(Math.max(0, i-20), i+1), m = Math.floor(win.length/2);
  let s = 0;
  const fH = fnum(win[0].high), mH = fnum(win[m].high, fH), lH = fnum(win[win.length-1].high, mH);
  const fL = fnum(win[0].low),  mL = fnum(win[m].low, fL),  lL = fnum(win[win.length-1].low, mL);
  if (lH > mH && mH > fH) s += 5; else if (lH < mH && mH < fH) s -= 5;
  if (lL > mL && mL > fL) s += 5; else if (lL < mL && mL < fL) s -= 5;
  const cA = fnum(r.ICH_SENKOU_A, NaN), cB = fnum(r.ICH_SENKOU_B, NaN);
  if (!isNaN(cA) && !isNaN(cB)) {
    const top = Math.max(cA, cB), bot = Math.min(cA, cB);
    const c = fnum(r.close);
    if (c > top) s += 4; else if (c < bot) s -= 4;
  }
  const c = fnum(r.close), kijun = fnum(r.ICH_KIJUN, fnum(r.EMA20, 0));
  s += c >= kijun ? 3 : -3;
  const rp = rangePos(c, Math.min(...win.map(b=>b.low)), Math.max(...win.map(b=>b.high)));
  if (rp >= 0.65) s += 3; else if (rp <= 0.35) s -= 3;
  const bearBars = win.slice(-6).filter(b => b.close < b.open && fnum(b.ClosePos, 0.5) < 0.4).length;
  s -= Math.min(4, bearBars);
  return clip(s, -20, 20);
}

function scoreCompression(bars, i) {
  const r = bars[i], c = fnum(r.close);
  let s = 0;
  const a14 = fnum(r.ATR14), a60 = fnum(r.ATR60, a14);
  if (a14 > 0 && a60 > 0) {
    const ratio = a14 / a60;
    if (ratio <= 0.85) s += 6; else if (ratio >= 1.25) s -= 4;
  }
  const bbW = fnum(r.BB_width, NaN);
  if (!isNaN(bbW)) {
    const hist = bars.slice(Math.max(0, i-60), i+1).map(b => b.BB_width).filter(v => v != null);
    if (hist.length >= 10) {
      const pctRank = hist.filter(v => v <= bbW).length / hist.length;
      if (pctRank <= 0.25) s += 5; else if (pctRank >= 0.85) s -= 3;
    }
  }
  const rp = rangePos(c, fnum(r.RangeLow), fnum(r.RangeHigh));
  if (rp >= 0.55 && rp <= 0.88) s += 5; else if (rp > 0.96) s -= 4; else if (rp < 0.35) s -= 5;
  const e20 = fnum(r.EMA20, c);
  if (a14 > 0) {
    const stretch = Math.abs(c - e20) / a14;
    if (stretch <= 1.2) s += 4; else if (stretch >= 3.0) s -= 4;
  }
  return clip(s, -20, 20);
}

function scoreVolume(bars, i) {
  const r = bars[i], c = fnum(r.close), o = fnum(r.open, c), cp = fnum(r.ClosePos, 0.5);
  const rvolV = fnum(r.RVOL, 1);
  let s = 0;
  if (rvolV >= 1.8) s += 4; else if (rvolV >= 1.2) s += 2; else if (rvolV < 0.75) s -= 2;
  if (c >= o && cp >= 0.65) s += rvolV >= 1.0 ? 3 : 1.5;
  else if (c < o && cp <= 0.35 && rvolV >= 1.2) s -= 4;
  const rec = bars.slice(Math.max(0, i-4), i+1);
  let upVol = 0, dnVol = 0;
  rec.forEach(b => { if (b.close >= b.open) upVol += b.volume; else dnVol += b.volume; });
  if (upVol > dnVol * 1.2) s += 3; else if (dnVol > upVol * 1.2 && dnVol > 0) s -= 3;
  return clip(s, -10, 10);
}

function scoreRisk(bars, i) {
  const r = bars[i], c = fnum(r.close), e20 = fnum(r.EMA20, c), atrV = fnum(r.ATR14);
  const rvolV = fnum(r.RVOL, 1), cp = fnum(r.ClosePos, 0.5), o = fnum(r.open, c);
  let p = 0;
  if (atrV > 0) {
    const g = (c - e20) / atrV;
    if (g >= 3.5) p -= 14; else if (g >= 2.7) p -= 8;
    else if (g <= -3.0) p -= 10; else if (g <= -2.2) p -= 6;
  }
  const rec = bars.slice(Math.max(0, i-4), i+1);
  const uwCount = rec.filter(b => fnum(b.UpperWickRatio, 0) > 0.45).length;
  p -= Math.min(8, uwCount * 2);
  if (rvolV >= 1.8 && cp <= 0.3 && c < o) p -= 6;
  const rp = rangePos(c, fnum(r.RangeLow), fnum(r.RangeHigh));
  if (rp >= 0.97 && c < o) p -= 4;
  const adxV = fnum(r.ADX14, 18), e60 = fnum(r.EMA60, c);
  if (adxV < 16 && Math.abs(c-e20) <= Math.max(atrV*0.5, c*0.004) && Math.abs(c-e60) <= Math.max(atrV*0.8, c*0.006)) p -= 4;
  return clip(p, -30, 0);
}

// ── 전체 FIS 계산 ──────────────────────────────────
export function calcFIS(bars) {
  return bars.map((b, i) => {
    const trend  = scoreTrend(bars, i);
    const mom    = scoreMomentum(bars, i);
    const struct = scoreStructure(bars, i);
    const comp   = scoreCompression(bars, i);
    const vol    = scoreVolume(bars, i);
    const risk   = scoreRisk(bars, i);
    const raw    = 1.15*trend + mom + struct + 0.85*comp + 0.75*vol + risk;
    const fisV   = clip(raw * 1.05, -100, 100);
    return { ...b, TrendScore:trend, MomentumScore:mom, StructureScore:struct,
             CompressionScore:comp, VolumeScore:vol, RiskPenalty:risk, FIS: fisV };
  });
}

// ── 진입 점수 (마지막 봉 기준) ────────────────────────
export function calcEntryScore(bars) {
  const r = bars[bars.length - 1];
  const c = fnum(r.close), e10 = fnum(r.EMA10, c), e20 = fnum(r.EMA20, c), e60 = fnum(r.EMA60, c);
  const atrV = fnum(r.ATR14), adxV = fnum(r.ADX14, 18);
  const rsiV = fnum(r.RSI14, 50), rvolV = fnum(r.RVOL, 1);
  const fis = fnum(r.FIS), trend = fnum(r.TrendScore);
  const comp = fnum(r.CompressionScore), struct = fnum(r.StructureScore);

  let score = 0;
  // 추세 품질
  if (c > e20 && e20 > e60) score += 15; else if (c > e20) score += 7; else score -= 10;
  // 눌림 품질
  const atrGap = atrV > 0 ? (c - e20) / atrV : 0;
  if (atrGap >= 0.3 && atrGap <= 1.5) score += 12; else if (atrGap > 1.5 && atrGap <= 2.5) score += 5; else score -= 8;
  // 변동성 수축
  if (comp >= 5) score += 12; else if (comp >= 0) score += 5; else score -= 5;
  // 모멘텀
  if (rsiV >= 50 && rsiV <= 68) score += 10; else if (rsiV > 68) score -= 5; else score += 3;
  // 구름 위치
  const cA = fnum(r.ICH_SENKOU_A, NaN), cB = fnum(r.ICH_SENKOU_B, NaN);
  if (!isNaN(cA) && !isNaN(cB)) {
    if (c > Math.max(cA, cB)) score += 10; else if (c < Math.min(cA, cB)) score -= 10;
  }
  // 거래량
  if (rvolV >= 1.2) score += 8; else if (rvolV < 0.7) score -= 3;
  // ADX
  if (adxV >= 22) score += 8; else if (adxV < 15) score -= 5;
  // 구조
  if (struct >= 5) score += 5;
  // FIS 베이스
  score += fnum(r.FIS, 0) * 0.2;

  return { score: clip(score, 0, 100), label: scoreLabel(score) };
}

function scoreLabel(s) {
  if (s >= 75) return { text: "최적 진입", color: "#0D7F3C" };
  if (s >= 60) return { text: "우호적",   color: "#2ea44f" };
  if (s >= 45) return { text: "중립",     color: "#B8860B" };
  if (s >= 30) return { text: "신중",     color: "#e67e22" };
  return          { text: "부적합",      color: "#C41D3A" };
}

export function fisLabel(fis) {
  if (fis >= 50)  return { text: "강한 매수 신호", color: "#0D7F3C" };
  if (fis >= 20)  return { text: "매수 우위",      color: "#2ea44f" };
  if (fis >= -10) return { text: "중립",           color: "#B8860B" };
  if (fis >= -30) return { text: "매도 우위",      color: "#e67e22" };
  return           { text: "강한 매도 신호",       color: "#C41D3A" };
}
