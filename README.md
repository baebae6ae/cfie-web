# CFIE — 차트 첫인상 엔진 v4.0

> 뉴스프린트 감성 | FIS 지표 | GitHub Pages 정적 앱

## 기능 개요

| 페이지 | 기능 |
|--------|------|
| 대시보드 | 한국/미국 시장 지수, 52주 신고가 종목 |
| 종목 찾기 | 기계적 진입 스캔 (조건 충족 종목 + 손절/익절가 + 종목별 백테스트), 쿠모 돌파 스캔 |
| 차트 분석 | 일봉/주봉/월봉 캔들차트 + 일목균형표 + FIS 점수 + 기계적 진입 체크리스트 |
| 마이 페이지 | 포트폴리오 관리 (수량·단가·수익률 + 손절/익절 매매 신호) |

## 기계적 매매 전략 (핵심 로직)

스캔 필터 · 백테스트 시뮬 · 차트 분석 체크리스트가 모두 `js/indicators.js`의
`MECH` 상수 하나를 공유합니다 (기준 불일치 방지).

**진입 조건 (6가지 동시 충족)**
1. FIS ≥ 60 — 강한 상승 추세
2. EMA20 이격 ≥ 0.3 ATR — 손절 여유 확보
3. RSI 눌림 후 회복 — 최근 8봉 내 RSI ≤ 62 경험 + 현재 RSI ≥ 50 (추격 매수 차단)
4. 추세 신선도 1~35봉 — EMA20>EMA60 골든크로스 후 경과 봉 수 (추세 후반 제외)
5. 통합 진입점수 ≥ 65
6. R:R ≥ 1.5 — 목표 +ATR×3 / 손절 (EMA20−ATR)

**청산 규칙**
- 손절: EMA20−ATR (진입 시점 고정)
- 1차 익절: 진입가+ATR×2 → 50% 매도 + 손절선을 진입가로 상향 (브레이크이븐)
- 2차 익절: 진입가+ATR×3 → 잔여 전량 매도
- 기간 손절: 25봉(약 5주) 초과 시 전량 청산

**백테스트 (종목별 자동 실행)**
- 신호 다음 봉 시가 진입, 포지션 중복 없음 (실거래와 동일)
- 왕복 거래비용 차감: 한국 0.25%, 미국 0.10%
- 승률·PF·기대값으로 종목별 전략 적합성 진단 → 스캔 결과 정렬에 반영

## 로그인 방법 (GitHub PAT)

GitHub 계정만 있으면 됩니다. 서버 없이 100% 브라우저에서 동작합니다.

### 1단계 — Personal Access Token 발급

1. https://github.com/settings/tokens/new 접속  
2. **Expiration** 설정 (90일 권장)  
3. **Select scopes** → **gist** 에만 체크  
4. **Generate token** 클릭  
5. `ghp_xxxx...` 토큰 복사 (한 번만 표시됨)

### 2단계 — CFIE 로그인

1. 사이트 접속 → 자동으로 `login.html` 이동  
2. 토큰 붙여넣기 → **GitHub로 로그인** 클릭  
3. 토큰이 로컬 스토리지에 저장됩니다 (외부 서버 전송 없음)

### 포트폴리오 저장 위치

- 비공개 GitHub Gist에 `cfie_portfolio.json` 파일로 자동 저장됩니다  
- Gist ID는 localStorage에 캐시됩니다  
- GitHub 계정으로 https://gist.github.com 에서도 확인 가능

## GitHub Pages 배포

```bash
git init
git add .
git commit -m "init: cfie-web"
git remote add origin https://github.com/YOUR_USER/cfie-web.git
git push -u origin main
```

**Repository Settings → Pages → Source: Deploy from a branch (main / root)**

접속 URL: `https://YOUR_USER.github.io/cfie-web/`

## 데이터 자동화 (선택)

52주 신고가, FIS 스캔 데이터를 GitHub Actions로 자동 생성합니다.

**Settings → Actions → General → Workflow permissions: Read and write permissions**

매일 KST 07:00 (UTC 22:00, 월~금)에 `data/*.json` 파일이 자동 생성됩니다.

### 필요한 Repository Secrets

| Secret 이름 | 값 |
|-------------|-----|
| `GH_PAT` | 데이터 push용 PAT (`repo` 스코프) |

## 기술 스택

- **Frontend**: 순수 HTML/CSS/ES Modules (빌드 도구 없음)
- **인증**: GitHub Personal Access Token
- **포트폴리오 저장**: GitHub Gist API (비공개)
- **시세 데이터**: Yahoo Finance API
- **차트**: TradingView Lightweight Charts v4.2
- **배포**: GitHub Pages
- **데이터 자동화**: GitHub Actions + Python

## 파일 구조

```
├── index.html          # 인증 기반 리다이렉터
├── login.html          # PAT 로그인 페이지
├── dashboard.html      # 시장 개요
├── scan.html           # 종목 스캔
├── analyze.html        # 차트 분석
├── mypage.html         # 포트폴리오
├── css/
│   ├── common.css      # 공통 변수·레이아웃
│   ├── auth.css        # 로그인 페이지 스타일
│   └── ...
├── js/
│   ├── auth.js         # GitHub PAT 인증
│   ├── gist-store.js   # GitHub Gist 포트폴리오 저장
│   ├── common.js       # 공통 유틸·검색·토스트
│   ├── indicators.js   # FIS·일목균형표 계산
│   ├── yahoo.js        # Yahoo Finance API
│   ├── dashboard.js
│   ├── scan.js
│   ├── analyze.js
│   └── mypage.js
├── data/               # GitHub Actions로 자동 생성
│   ├── high52_kospi.json
│   ├── high52_kosdaq.json
│   ├── high52_us.json
│   └── scan_fis_*.json
└── .github/workflows/update_data.yml
```
