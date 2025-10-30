# 관리자 운영 가이드 (custom_HowToUse)

본 문서는 AI 기반 맞춤형 퀴즈 학습 웹 애플리케이션의 로컬 개발/운영(개발용) 절차와 관리 포인트를 정리합니다. Windows PowerShell 기준 명령을 우선 표기하고, 필요 시 Unix 계열 대체 명령도 함께 제공합니다.

---

## 개요
- 백엔드: FastAPI + SQLAlchemy + SQLite (`backend` 디렉터리)
- 프런트엔드: React + TypeScript + Vite (`frontend` 디렉터리)
- 개발 기본 포트: 백엔드 `8000`, 프런트엔드 `5173`
- 선택 기능: Gemini API 키 입력 시 단답/서술형 AI 채점 활성화 (미입력 시 키워드 기반 임시 채점)

---

## 사전 준비
- Python 3.10+ (권장 3.11)
- Node.js 18+ (권장 20+), npm
- Windows PowerShell 또는 터미널

선택(권장): Python 가상환경

```powershell
# PowerShell (Windows)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Bash (macOS/Linux)
python3 -m venv .venv
source .venv/bin/activate
```

---

## 백엔드 서버

### 설치
```powershell
pip install -r backend/requirements.txt
```

### 실행 (자동 리로드 포함)
```powershell
uvicorn backend.main:app --reload --port 8000
```

### 종료
- 서버 창에서 `Ctrl + C`

### 확인
- 문서: `http://localhost:8000/docs`
- OpenAPI: `http://localhost:8000/openapi.json`

### 환경변수(선택)
- `GEMINI_API_KEY`를 설정하면 서버 시작 시 자동 적용됩니다.

```powershell
# PowerShell
$env:GEMINI_API_KEY = "YOUR_KEY"
uvicorn backend.main:app --reload --port 8000

# Bash
export GEMINI_API_KEY="YOUR_KEY"
uvicorn backend.main:app --reload --port 8000
```

---

## 프런트엔드 서버

### 설치
```powershell
cd frontend
npm install
```

### 실행 (개발 서버)
```powershell
npm run dev
```

### 종료
- 서버 창에서 `Ctrl + C`

### 접속
- `http://localhost:5173`

---

## Gemini 키 관리 (보안/운영)

### 동작 원리
- 키는 서버 프로세스 메모리(app.state)에만 저장되는 **임시값**입니다.
- 디스크/DB/로그에 저장하지 않습니다. 서버 재시작 시 초기화됩니다.

### 설정 방법
1) 프런트엔드 첫 접속 시 표시되는 “Gemini API 키 입력” 모달에 키 입력 → 저장
2) 또는 백엔드 환경변수 `GEMINI_API_KEY`로 주입 (서버 시작 시 자동 사용)

### 상태/제어 API (관리용)
- 상태 확인: `GET /api/config/status` → `{ gemini_key_set: boolean }`
- 키 설정: `POST /api/config/gemini` 본문 `{ "api_key": "..." }`
- 키 제거: `POST /api/config/gemini/clear`

주의: 운영 환경에서는 관리자 인증/레이트리밋/HTTPS/CORS 화이트리스트 등 보안 장치를 반드시 적용하세요.

---

## 문제 DB 관리(운영)

현재 기본 더미 데이터(EDA)가 초기화 시 자동 삽입됩니다. 실제 운영에서는 아래 중 하나로 관리하세요.

- 배치/수동 삽입: 별도 스크립트에서 `backend/crud.py`의 `create_question`를 호출하여 DB에 일괄 삽입
- 관리용 API(향후): 문제 일괄 업서트/삭제 엔드포인트 추가 후, JSON 업로드
- 데이터 디렉터리
  - `test_set/`: 문제 생성용 원천 자료(텍스트/노트북) 저장 위치(대용량 예상) — Git 무시됨
  - `prob_db/`: 생성된 문제 DB/아티팩트 저장 위치 — Git 무시됨

SQLite 파일(`test.db`)은 개발용 기본 설정입니다. 운영에서는 RDB(PostgreSQL 등) 전환을 권장합니다.

---

## 트러블슈팅

- 404 (예: `/api/config/status`):
  - 백엔드가 최신 코드로 기동되지 않은 상태입니다. 서버를 종료 후 다시 실행하세요.
  - 문서(`http://localhost:8000/docs`)에 해당 엔드포인트가 보이는지 확인하세요.

- CORS 에러:
  - 개발 환경은 모든 Origin 허용으로 설정되어 있으나, 프런트 URL이 다른 포트인지 확인하세요.
  - 운영 시 특정 Origin 화이트리스트로 축소하세요.

- 모달(키 입력)이 보이지 않음:
  - 프런트 새로고침(강력 새로고침) 후 재시도
  - 시작 화면의 “Gemini 키 설정” 버튼으로 강제로 모달 열기

- 포트 충돌:
  - 8000/5173 포트를 점유하는 기존 프로세스를 종료 후 재시작

---

## 보안 권장사항
- HTTPS 사용(운영), 프록시(Nginx)에서 요청 본문 로깅 비활성화
- CORS: 운영에서는 허용 Origin을 서비스 도메인으로 제한
- 키 관리 엔드포인트는 관리자 인증/레이트리밋 적용
- 프런트엔드에 키 저장 금지(localStorage/sessionStorage 사용 금지) — 현재 모달 전송 후 보관하지 않음

---

## 자주 쓰는 명령 모음

### 백엔드
```powershell
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

### 프런트엔드
```powershell
cd frontend
npm install
npm run dev
```

### 키 상태/설정/제거 (예: PowerShell)
```powershell
# 상태
Invoke-RestMethod -Uri http://localhost:8000/api/config/status -Method GET

# 설정
Invoke-RestMethod -Uri http://localhost:8000/api/config/gemini -Method POST -Body '{"api_key":"YOUR_KEY"}' -ContentType 'application/json'

# 제거
Invoke-RestMethod -Uri http://localhost:8000/api/config/gemini/clear -Method POST
```

---

## 향후 개선 체크리스트
- Vite 프록시(`/api` → 8000) 및 `VITE_API_BASE_URL` 도입, axios 인스턴스화
- CORS 운영 모드 축소, 키 관리 엔드포인트 보호(인증·레이트리밋)
- Alembic 마이그레이션, Postgres 전환 검토
- LLM 채점 타임아웃/재시도/서킷브레이커/결과 캐싱
- Code 에디터(코딩형) 도입, 접근성(포커스 트랩/ESC/고대비) 보강

