# 관리자 운영 가이드 (custom_HowToUse)

이 문서는 AI 기반 맞춤 퀴즈 학습 앱의 현재 마이그레이션 상태(app/, storage/, db_builder/, data/) 기준으로 로컬 개발·운영 방법을 정리합니다. 예시는 Windows PowerShell 기준이나, macOS/Linux 명령도 함께 표기합니다.

---

## 개요
- 백엔드: FastAPI + SQLite(per‑set) + 선택적 SQLAlchemy 헬퍼 (`app/`)
- 프론트엔드: React + TypeScript + Vite (`frontend/`)
- 데이터/스토리지: `data/*.json` → `storage/{subject}_prob.db` (db_builder 스크립트)
- 기본 포트: 백엔드 `8000`, 프론트 `5173`
- 선택 기능: Gemini API 기반 단답/서술형 AI 채점(미설정 시 키워드 기반 점수)

---

## 사전 준비
- Python 3.10+ (권장 3.11)
- Node.js 18+ (권장 20+) 및 npm
- 권장: 가상환경 사용
```powershell
# PowerShell (Windows)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Bash (macOS/Linux)
python3 -m venv .venv
source .venv/bin/activate
```

---

## 백엔드 서버(app)

### 설치
```powershell
pip install -r requirements.txt
```

### 실행(핫리로드)
```powershell
uvicorn app.main:app --reload --port 8000
```

### 확인
- 문서: `http://localhost:8000/docs`
- OpenAPI: `http://localhost:8000/openapi.json`

### 환경변수(선택)
- `GEMINI_API_KEY`: 서버 기동 시 메모리에 등록됩니다.
- `STORAGE_DIR`: 문제 DB 디렉토리 지정(기본값 `./storage`).
```powershell
# PowerShell
$env:GEMINI_API_KEY = "YOUR_KEY"
$env:STORAGE_DIR = ".\storage"
uvicorn app.main:app --reload --port 8000

# Bash
export GEMINI_API_KEY="YOUR_KEY"
export STORAGE_DIR="./storage"
uvicorn app.main:app --reload --port 8000
```

---

## 문제 DB 생성/검증(db_builder)

### 생성: data/*.json → storage/*.db
```powershell
python db_builder/db_generator.py
```
- 파일 규칙: `<Subject>_questions_<source>.json` 예) `AI_questions_theory.json`
- 산출물: `storage/<Subject>_prob.db` (기존 파일은 교체)

### 검증: 간단 QA
```powershell
python db_builder/validator.py
```
- `questions` 테이블 존재, 샘플 로우 수, JSON 필드 파싱 여부, 깨진 문자 여부 등을 확인합니다.

---

## 프론트엔드(frontend)

### 설치/실행
```powershell
cd frontend
npm install
npm run dev
```
- Vite dev 서버가 `/api`를 `http://localhost:8000`으로 프록시합니다.
- 필요 시 `VITE_API_BASE_URL`로 백엔드 주소를 지정할 수 있습니다.

---

## 사용 방법(요약)
- 세트 선택: 앱에서 문제 세트를 선택하면 `X-DB-SET` 헤더가 자동 설정·저장됩니다.
- 세트 목록: `GET /api/sets` → `storage/*.db`를 열거합니다.
- 문제 조회: `GET /api/questions/{subject}`
  - 헤더 `X-DB-SET: <예: AI_prob.db>` 필수
  - `subject=all|*`이면 전체, 아니면 해당 과목만 반환
- 제출/채점: `POST /api/submit/{subject}` 또는 단일 문항 `POST /api/check-answer`

---

## Gemini 키 관리
- 상태: `GET /api/config/status` → `{ gemini_key_set: boolean }`
- 설정: `POST /api/config/gemini` 바디 `{ "api_key": "..." }`
- 초기화: `POST /api/config/gemini/clear`
주의: 운영 환경에서는 HTTPS, 제한된 CORS/자격증명, 관리자 인증/감사를 적용하세요.

---

## 트러블슈팅
- 404(`/api/config/status`): 백엔드 기동/포트 확인, `/docs`로 라우트 노출 여부 확인
- CORS: 개발은 localhost만 허용. 운영은 허용 Origin을 축소하고 credentials 필요 시 allow_credentials 조정
- 세트 미표시: `storage/*.db` 빌드 여부 확인, 권한·경로 확인

---

## 자주 쓰는 명령
```powershell
# 백엔드
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 프론트엔드
cd frontend
npm install
npm run dev

# Gemini 상태/설정/초기화 (PowerShell)
Invoke-RestMethod -Uri http://localhost:8000/api/config/status -Method GET
Invoke-RestMethod -Uri http://localhost:8000/api/config/gemini -Method POST -Body '{"api_key":"YOUR_KEY"}' -ContentType 'application/json'
Invoke-RestMethod -Uri http://localhost:8000/api/config/gemini/clear -Method POST
```

---

## 비고
- 마이그레이션 핵심 변경: `backend/`→`app/`, `prob_db/`→`storage/`, DB 빌드 스크립트 도입(`db_builder/`).
- 기본 동작은 per‑set SQLite 파일 접근이며, 향후 필요 시 SQLAlchemy 세션팩토리를 사용할 수 있습니다.

