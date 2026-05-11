"""
GitHub Actions에서 실행되는 데이터 생성 스크립트
output: data/high52_kospi.json, data/high52_kosdaq.json, data/high52_us.json
        data/scan_fis_kospi.json, data/scan_fis_kosdaq.json, data/scan_fis_us.json
        data/scan_kumo_kospi.json, data/scan_kumo_kosdaq.json
"""
import json, os, sys, time
import numpy as np
import pandas as pd
import yfinance as yf

# ── 경로 ─
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
os.makedirs(DATA, exist_ok=True)

BATCH = 50

# ─────────────────────────────────────────────
# KRX 유니버스 (FinanceDataReader, 선택적)
# ─────────────────────────────────────────────
def load_krx():
    try:
        import FinanceDataReader as fdr
        kospi  = fdr.StockListing("KOSPI")[["Code","Name"]].dropna()
        kosdaq = fdr.StockListing("KOSDAQ")[["Code","Name"]].dropna()
        kospi["ticker"]  = kospi["Code"].str.strip() + ".KS"
        kosdaq["ticker"] = kosdaq["Code"].str.strip() + ".KQ"
        return (
            kospi[["ticker","Name"]].rename(columns={"Name":"name"}).to_dict("records"),
            kosdaq[["ticker","Name"]].rename(columns={"Name":"name"}).to_dict("records"),
        )
    except Exception as e:
        print(f"FDR 오류: {e} — 빌트인 목록 사용")
        # 상위 대형주만 (GitHub Actions에서 FDR 실패 시 fallback)
        return [], []

# ─────────────────────────────────────────────
# 지표 계산
# ─────────────────────────────────────────────
def ema(closes, span):
    s = pd.Series(closes)
    return s.ewm(span=span, adjust=False).mean().tolist()

def rsi(closes, period=14):
    s = pd.Series(closes)
    delta = s.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50).tolist()

def atr(bars, period=14):
    h = pd.Series([b["high"]  for b in bars])
    l = pd.Series([b["low"]   for b in bars])
    c = pd.Series([b["close"] for b in bars])
    tr = pd.concat([h-l, (h-c.shift()).abs(), (l-c.shift()).abs()], axis=1).max(axis=1)
    return tr.rolling(period).mean().fillna(method="bfill").tolist()

def macd(closes, fast=12, slow=26, signal=9):
    s = pd.Series(closes)
    fast_e = s.ewm(span=fast, adjust=False).mean()
    slow_e = s.ewm(span=slow, adjust=False).mean()
    m = fast_e - slow_e
    sig = m.ewm(span=signal, adjust=False).mean()
    return m.tolist(), sig.tolist(), (m - sig).tolist()

def bollinger(closes, period=20, mult=2):
    s = pd.Series(closes)
    mid = s.rolling(period).mean()
    std = s.rolling(period).std()
    up = mid + mult * std
    dn = mid - mult * std
    w  = ((up - dn) / mid.replace(0, np.nan)).fillna(0)
    return mid.tolist(), up.tolist(), dn.tolist(), w.tolist()

def ichimoku(bars, t=9, k=26, s=52):
    h = pd.Series([b["high"]  for b in bars])
    l = pd.Series([b["low"]   for b in bars])
    c = pd.Series([b["close"] for b in bars])
    tenkan = (h.rolling(t).max() + l.rolling(t).min()) / 2
    kijun  = (h.rolling(k).max() + l.rolling(k).min()) / 2
    sa = ((tenkan + kijun) / 2).shift(k)
    sb = ((h.rolling(s).max() + l.rolling(s).min()) / 2).shift(k)
    chikou = c.shift(-k)
    return tenkan.tolist(), kijun.tolist(), sa.tolist(), sb.tolist(), chikou.tolist()

def adx(bars, period=14):
    h = pd.Series([b["high"]  for b in bars])
    l = pd.Series([b["low"]   for b in bars])
    c = pd.Series([b["close"] for b in bars])
    up   = h.diff(); dn = -l.diff()
    plus  = (up.where((up > dn) & (up > 0), 0)).rolling(period).mean()
    minus = (dn.where((dn > up) & (dn > 0), 0)).rolling(period).mean()
    tr = pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1).rolling(period).mean()
    pdi = 100 * plus  / tr.replace(0, np.nan)
    mdi = 100 * minus / tr.replace(0, np.nan)
    dx  = (100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)).rolling(period).mean()
    return dx.fillna(0).tolist(), pdi.fillna(0).tolist(), mdi.fillna(0).tolist()

def calc_fis(df):
    c = df["Close"].tolist()
    n = len(c)
    if n < 130:
        return None

    ema20  = ema(c, 20); ema60  = ema(c, 60); ema120 = ema(c, 120)
    rsi14  = rsi(c, 14)
    m, sig, hist = macd(c)
    mid, up, dn, w = bollinger(c)
    adx14, pdi14, mdi14 = adx([{"high":h,"low":l,"close":cl} for h,l,cl in zip(df["High"],df["Low"],df["Close"])])
    atr14  = atr([{"high":h,"low":l,"close":cl} for h,l,cl in zip(df["High"],df["Low"],df["Close"])])
    vol    = df["Volume"].tolist()
    avg_vol20 = pd.Series(vol).rolling(20).mean().tolist()
    ten, kij, sa, sb, chi = ichimoku([{"high":h,"low":l,"close":cl} for h,l,cl in zip(df["High"],df["Low"],df["Close"])])

    i = n - 1
    def g(lst): return lst[i] if lst[i] is not None and not (isinstance(lst[i], float) and np.isnan(lst[i])) else 0

    price = c[i]
    e20=g(ema20); e60=g(ema60); e120=g(ema120)
    trend = 0
    if price > e20 > e60 > e120: trend += 25
    elif price > e60: trend += 10
    elif price < e20 < e60: trend -= 25

    adx_v = g(adx14); pdi_v = g(pdi14); mdi_v = g(mdi14)
    if adx_v > 25 and pdi_v > mdi_v: trend += 15
    elif adx_v > 25 and mdi_v > pdi_v: trend -= 15
    trend = max(-40, min(40, trend))

    rsi_v = g(rsi14); macd_v = g(m); hist_v = g(hist)
    mom = 0
    if rsi_v > 60: mom += 15
    elif rsi_v > 50: mom += 8
    elif rsi_v < 40: mom -= 15
    elif rsi_v < 50: mom -= 8
    if macd_v > 0 and hist_v > 0: mom += 10
    elif macd_v < 0 and hist_v < 0: mom -= 10
    mom = max(-30, min(30, mom))

    sa_v=g(sa); sb_v=g(sb); kij_v=g(kij)
    struct = 0
    if sa_v and sb_v:
        if price > max(sa_v, sb_v): struct += 15
        elif price < min(sa_v, sb_v): struct -= 15
    if kij_v and price > kij_v: struct += 10
    elif kij_v and price < kij_v: struct -= 10
    struct = max(-25, min(25, struct))

    w_v = g(w)
    comp = 0
    if w_v < 0.05: comp += 20
    elif w_v < 0.1: comp += 10
    elif w_v > 0.3: comp -= 10
    comp = max(-20, min(20, comp))

    vol_v = vol[i]; avg_v = g(avg_vol20)
    rv = vol_v / avg_v if avg_v > 0 else 1
    vol_s = 0
    if rv > 2: vol_s += 20
    elif rv > 1.5: vol_s += 12
    elif rv < 0.5: vol_s -= 10

    atr_v = g(atr14)
    risk = 0
    if atr_v > 0:
        atr_pct = atr_v / price
        if atr_pct > 0.06: risk = -30
        elif atr_pct > 0.04: risk = -15

    raw = 1.15*trend + mom + struct + 0.85*comp + 0.75*vol_s + risk
    fis = max(-100, min(100, raw * 1.05))
    return round(fis, 2)

# ─────────────────────────────────────────────
# 52주 신고가 계산
# ─────────────────────────────────────────────
def is_52week_high(df):
    if len(df) < 5: return False
    high52 = df["High"].rolling(252).max().iloc[-1]
    if pd.isna(high52): high52 = df["High"].max()
    return df["Close"].iloc[-1] >= high52 * 0.98

def process_batch(stocks):
    results_52h = []
    results_fis = []
    results_kumo = []
    tickers = [s["ticker"] for s in stocks]
    try:
        data = yf.download(tickers, period="2y", interval="1d", group_by="ticker",
                           auto_adjust=True, progress=False, threads=True)
    except Exception as e:
        print(f"  yf 오류: {e}"); return [], [], []
    for s in stocks:
        t = s["ticker"]
        try:
            df = data[t] if len(tickers) > 1 else data
            df = df.dropna(how="all")
            if len(df) < 60: continue
            price = float(df["Close"].iloc[-1])
            prev  = float(df["Close"].iloc[-2]) if len(df) > 1 else price
            chg_pct = (price - prev) / prev * 100 if prev else 0
            fis   = calc_fis(df)
            # 52주 신고가
            if is_52week_high(df):
                results_52h.append({ "ticker": t, "name": s["name"], "price": round(price,2), "chg": round(chg_pct,2), "fis": fis })
            # FIS 스캔 (양수 종목)
            if fis is not None and fis > 0:
                results_fis.append({ "ticker": t, "name": s["name"], "price": round(price,2), "chg": round(chg_pct,2), "fis": fis })
            # 쿠모 돌파
            bars = [{"high":h,"low":l,"close":cl} for h,l,cl in zip(df["High"],df["Low"],df["Close"])]
            ten_l, kij_l, sa_l, sb_l, _ = ichimoku(bars)
            sa_v = sa_l[-1]; sb_v = sb_l[-1]
            if sa_v and sb_v and not np.isnan(sa_v) and not np.isnan(sb_v):
                cloud_top = max(sa_v, sb_v)
                prev_close = float(df["Close"].iloc[-2]) if len(df) > 1 else 0
                if price > cloud_top and prev_close < cloud_top:
                    results_kumo.append({ "ticker": t, "name": s["name"], "price": round(price,2), "chg": round(chg_pct,2), "fis": fis })
        except Exception as e:
            print(f"  {t} 오류: {e}")
    return results_52h, results_fis, results_kumo

def save(fname, data):
    path = os.path.join(DATA, fname)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"  저장: {fname} ({len(data)}건)")

def run_market(label, stocks, suffix):
    print(f"\n▶ {label} ({len(stocks)}종목)")
    all_52h = []; all_fis = []; all_kumo = []
    for i in range(0, len(stocks), BATCH):
        batch = stocks[i:i+BATCH]
        print(f"  [{i+1}~{i+len(batch)}]")
        h52, fis_r, kumo_r = process_batch(batch)
        all_52h  += h52; all_fis  += fis_r; all_kumo += kumo_r
        time.sleep(1)
    all_52h.sort(key=lambda x: -(x["fis"] or -999))
    all_fis.sort(key=lambda x: -(x["fis"] or -999))
    all_kumo.sort(key=lambda x: -(x["fis"] or -999))
    save(f"high52_{suffix}.json",  all_52h[:200])
    save(f"scan_fis_{suffix}.json", all_fis[:200])
    if suffix in ("kospi","kosdaq"):
        save(f"scan_kumo_{suffix}.json", all_kumo[:200])

if __name__ == "__main__":
    print("=== CFIE 데이터 생성 ===")
    kospi_stocks, kosdaq_stocks = load_krx()
    if kospi_stocks:
        run_market("KOSPI",  kospi_stocks,  "kospi")
        run_market("KOSDAQ", kosdaq_stocks, "kosdaq")
    else:
        print("KRX 유니버스 로드 실패 — KOSPI/KOSDAQ 건너뜀")
    # 미국 S&P500 구성종목 (Wikipedia)
    try:
        us_df = pd.read_html("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")[0]
        us_stocks = [{"ticker": r["Symbol"], "name": r["Security"]} for _, r in us_df.iterrows()]
        run_market("S&P 500", us_stocks, "us")
    except Exception as e:
        print(f"S&P500 목록 오류: {e}")
    print("\n완료!")
