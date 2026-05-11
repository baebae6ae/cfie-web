# CFIE — 차트 첫인상 엔진 v4.0

> 뉴스프린트 감성 | FIS 지표 | GitHub Pages 정적 앱

## 기능 개요

| 페이지 | 기능 |
|--------|------|
| 대시보드 | 한국/미국 시장 지수, 52주 신고가 종목 |
| 종목 찾기 | FIS 진입 스캔, 쿠모 돌파 스캔 |
| 차트 분석 | 일봉/주봉/월봉 캔들차트 + 일목균형표 + FIS 점수 |
| 마이 페이지 | 포트폴리오 관리 (수량·단가·수익률·FIS) |

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
