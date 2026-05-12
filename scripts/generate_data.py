"""
scripts/generate_data.py
유니버스(종목 코드+이름) JSON 파일 갱신 스크립트

이 파일은 주기적으로 실행하여 종목 목록을 최신 상태로 유지합니다.
실제 FIS 계산, 진입점수 계산 등 모든 분석은 브라우저(클라이언트)에서
Yahoo Finance 실시간 데이터를 불러와 직접 수행합니다.
"""
import sys, json, os
sys.path.insert(0, r'c:\Users\USER\OneDrive - SEMPIO\바탕 화면\바탕화면\py\분析')

try:
    from engine.universe import get_market_stocks
except ImportError as e:
    print("ERROR: 분析 엔진 경로를 확인하세요:", e)
    sys.exit(1)

OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
os.makedirs(OUT, exist_ok=True)

for market in ['kospi', 'kosdaq', 'us']:
    stocks = get_market_stocks(market, offset=0, limit=9999)
    data = [{'ticker': t, 'name': n} for t, n in stocks]
    fp = os.path.join(OUT, f'universe_{market}.json')
    with open(fp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(f'{market}: {len(data)} 종목 -> {fp}')

print('\n완료 — 모든 FIS 분석은 브라우저에서 실시간으로 처리됩니다.')
