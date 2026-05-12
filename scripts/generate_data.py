import sys, os, json, time
sys.path.insert(0, r'c:\Users\USER\OneDrive - SEMPIO\바탕 화면\바탕화면\py\분석')
from engine.scanner import scan_market, scan_kumo_breakout

OUT = r'c:\Users\USER\OneDrive - SEMPIO\바탕 화면\바탕화면\py\cfie-web\data'
os.makedirs(OUT, exist_ok=True)
MARKETS = ['kospi', 'kosdaq', 'us']

def build_fis_scan(market):
    print(f'\n=== FIS scan: {market} ===', flush=True)
    # scan_market returns (list, cursor) tuple
    results, _ = scan_market(market, offset=0, limit=500)
    out = []
    for r in results:
        entry  = r.get('entry', {}) or {}
        out.append({
            'ticker':     r.get('ticker',''),
            'name':       r.get('name',''),
            'fis':        round(float(r.get('fis', 0)), 2),
            'label':      r.get('label',''),
            'label_color':r.get('label_color',''),
            'close':      round(float(r.get('close',0)),2),
            'trend':      round(float(r.get('trend',0)),2),
            'momentum':   round(float(r.get('momentum',0)),2),
            'structure':  round(float(r.get('structure',0)),2),
            'compression':round(float(r.get('compression',0)),2),
            'volume':     round(float(r.get('volume',0)),2),
            'risk':       round(float(r.get('risk',0)),2),
            'entry_score':int(r.get('entry_score',0)),
            'entry_setup_name':  r.get('entry_setup_name') or entry.get('setup_name',''),
            'entry_setup_name2': r.get('entry_setup_name2') or entry.get('setup_name2',''),
            'summary_l1': r.get('summary_l1',''),
        })
    out.sort(key=lambda x: -x['entry_score'])
    fp = os.path.join(OUT, f'scan_fis_{market}.json')
    with open(fp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f'  -> {len(out)} items => {fp}', flush=True)

def build_kumo_scan(market):
    print(f'\n=== Kumo scan: {market} ===', flush=True)
    results, _ = scan_kumo_breakout(market, offset=0, limit=500)
    out = []
    for r in results:
        out.append({
            'ticker':      r.get('ticker',''),
            'name':        r.get('name',''),
            'close':       round(float(r.get('close',0)),2),
            'below_weeks': int(r.get('below_weeks',0)),
            'cloud_thin':  bool(r.get('cloud_thin', False)),
            'bull_cloud':  bool(r.get('bull_cloud', True)),
            'daily_vol':   bool(r.get('daily_vol', False)),
            'had_twist':   bool(r.get('had_twist', False)),
        })
    fp = os.path.join(OUT, f'scan_kumo_{market}.json')
    with open(fp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f'  -> {len(out)} items => {fp}', flush=True)

for market in MARKETS:
    try:
        build_fis_scan(market)
    except Exception as e:
        print(f'FIS {market} ERROR: {e}', flush=True)
    time.sleep(1)
    try:
        build_kumo_scan(market)
    except Exception as e:
        print(f'Kumo {market} ERROR: {e}', flush=True)
    time.sleep(1)

print('\n=== ALL DONE ===', flush=True)
