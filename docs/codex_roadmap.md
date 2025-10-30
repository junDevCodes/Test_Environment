**Overview**
- Goal: AI‑assisted quiz platform that ingests study materials (text summaries, .ipynb) to generate mixed theory/practice questions, provides interactive quiz flow, instant feedback, and rich results.
- Stack: FastAPI + SQLAlchemy + SQLite (backend), React + TypeScript + Vite (frontend), Fluent‑style UI, optional Gemini‑based grading for short/descriptive answers.

**Repository Layout**
- `backend` — FastAPI app, DB models, CRUD, schemas
- `frontend` — React app (Vite), UI components and styles
- `test.db` — SQLite database (development)

**Implemented Changes (This Iteration)**
- Grading refactor and single‑question check endpoint
  - Helper consolidating grading logic with LLM fallback: `backend/main.py:34`, `backend/llm.py:6`
  - New endpoint for instant feedback: `POST /api/check-answer` in `backend/main.py:114`
  - `POST /api/submit` reuses the shared grading helper: `backend/main.py:96`
- Gemini API key: in‑memory, ephemeral management
  - Status: `GET /api/config/status` `backend/main.py:129`
  - Set: `POST /api/config/gemini` `backend/main.py:134`
  - Clear: `POST /api/config/gemini/clear` `backend/main.py:142`
  - Schemas added: `GeminiKeyPayload`, `KeyStatus` in `backend/schemas.py:33`
  - LLM wrapper (Gemini 1.5 Flash) with JSON output expectation and safe fallback: `backend/llm.py:6`
  - Optional env boot: read `GEMINI_API_KEY` on startup `backend/main.py:88`
- Frontend UX and accessibility
  - Home page Fluent‑style card and key status banner, key modal trigger: `frontend/src/components/Home.tsx:21`
  - Quiz: ARIA progress bar, radiogroup semantics, inline messages instead of alerts, server‑side submit; check‑answer wired: `frontend/src/components/Quiz.tsx:27`, `frontend/src/components/Quiz.tsx:91`, `frontend/src/components/Quiz.tsx:110`
  - Results: code‑answer rendering via monospace blocks, score formatting: `frontend/src/components/Results.tsx:67`, `frontend/src/components/Results.tsx:86`
  - App‑level Gemini key modal (session‑only), with Korean guidance text: `frontend/src/App.tsx:53`
  - CSS additions: focus visibility, inline messages, code blocks, modal styling: `frontend/src/index.css:579`, `frontend/src/index.css:1414`, `frontend/src/index.css:1450`
  - Page title update to "AI Quiz": `frontend/index.html:7`
- Dependencies
  - Added `google-generativeai` for Gemini SDK: `backend/requirements.txt:4`

**Security & Key Handling**
- Gemini key exists only in process memory (`app.state`) and is never persisted or logged. Managed via dedicated endpoints.
- Production guidance: use HTTPS, restrict CORS origins, disable request‑body logging at reverse proxies, prefer environment or secret manager over UI for key provision.

**Run & Verify**
- Backend
  - `pip install -r backend/requirements.txt`
  - `uvicorn backend.main:app --reload --port 8000`
  - Verify docs: open `http://localhost:8000/docs` and confirm presence of config/check endpoints
- Frontend
  - `cd frontend && npm install && npm run dev`
  - On first load, the key modal appears if no key is set; Saving the key enables Gemini‑based grading for short/descriptive answers. Skipping falls back to keyword grading.

**Known Gaps**
- URLs are hardcoded (`http://localhost:8000`) in frontend axios calls: `frontend/src/App.tsx:15`, `frontend/src/components/Quiz.tsx:58`, `frontend/src/components/Quiz.tsx:100`, `frontend/src/components/Home.tsx:10`.
- CORS is wide‑open with credentials allowed: `backend/main.py:18` → tighten for prod.
- Pydantic mutable defaults for lists in schemas: `backend/schemas.py:10`, `backend/schemas.py:11`.
- SQLAlchemy modern import (`declarative_base`) not yet updated.
- DB migrations (Alembic) not configured; `create_all` on startup only.
- LLM response parsing is best‑effort JSON; resilient parsing and timeouts/rate‑limits not yet implemented.
- Korean UI strings rely on UTF‑8; ensure editor/serving config uses UTF‑8 to avoid mojibake on some terminals.

**Next Steps (Recommended)**
- Config/Networking
  - Introduce `VITE_API_BASE_URL` and axios instance; add Vite dev proxy for `/api`.
  - Restrict CORS origins and review `allow_credentials`.
- Backend robustness
  - Replace mutable defaults with `Field(default_factory=list)`; add `Literal/Enum` for `question_type`.
  - Add Alembic migrations; consider Postgres for JSON/scale.
  - LLM request timeouts, retries, circuit breaker; cache grading results by (question_id, answer hash).
- UX/Accessibility
  - Modal focus trap, ESC to close, scroll lock; manage‑key button in a header.
  - Replace textarea for coding with CodeMirror/Monaco; add syntax highlighting.
  - Toast system for network errors; loading skeletons.
- Testing/Ops
  - Unit tests for grading helper and API; component tests for Quiz/Results.
  - Structured logging and error tracking; Docker/Compose and CI pipeline.
- Content/Authoring
  - Admin endpoints/UI for bulk question upsert from text/.ipynb; per‑subject management.
**Update 2025-10-30**
- Backend
  - 문제 세트 선택: 요청 헤더 `X-DB-SET` 기반 다중 DB 지원 추가. 세트 목록 `GET /api/sets` 구현.
  - 질문 로딩 안정화: `options`, `keywords_full_credit`, `keywords_partial_credit`가 문자열/이스케이프/조각난 JSON이어도 리스트로 복원하도록 정규화. 응답 500(ResponseValidationError) 해소. 파싱 실패 항목은 디버그 로그에 id/subject 출력.
  - Gemini 키 관리: `GET /api/config/status`, `POST /api/config/gemini`, `POST /api/config/gemini/clear` 추가. 키는 프로세스 메모리에만 저장(재시작 시 초기화).
  - 채점 로직: 단답/서술형은 키가 있을 때 Gemini로 채점 및 설명 제공, 그 외는 키워드/정답 비교. `POST /api/check-answer`로 개별 즉시 피드백.
- Frontend
  - 세트 선택 페이지(새 페이지): 목록은 박스 균일 크기/세로 배치, 선택 시 테두리 두껍게 + 색 반전. 하단 ‘시작’ 버튼으로 진행, ‘뒤로가기’로 이전 화면 복귀.
  - 퀴즈 화면: ‘홈으로’, ‘시험 종료’ 모달 추가. 시험 종료 시 미응답은 오답으로 처리하여 채점 후 결과 페이지로 이동. 진행률/피드백/설명 표시.
  - 결과 화면: ‘홈화면으로’ 버튼으로 문구 변경. Gemini 설명 표시.
  - 한글 UI 안내(키 설정 배너/모달 등) 반영.
- DB 생성 스크립트(db_generator.py)
  - JSON 컬럼에 파이썬 리스트를 직접 저장하도록 변경(기존 json.dumps 경유 저장의 부작용 방지). 스크립트 실행으로 `prob_db/AI_prob.db` 재생성(이론 40 + 실습 10 = 총 50문항).
  - 샘플 조회로 검증: `question_text`, `model_answer`는 한글 원문 정상. `options`는 DB상 JSON 문자열(TEXT)로 저장되며 유니코드 이스케이프가 보이지만 파싱 시 한글 배열로 정상 복원.

**현재 상태(확인됨)**
- 세트 선택 → 퀴즈 로딩 → 제출/종료 → 결과까지 기본 플로우 정상.
- Vite 프록시를 통해 프론트 요청에 `X-DB-SET` 헤더가 포함되고, 백엔드에서 해당 세트로 질의됨.
- `AI_prob.db` 포함 일부 셋에서 리스트 필드 파싱 실패로 500이 나던 증상은 정규화 로직으로 해결됨.

**남은 이슈/주의사항**
- 소스 중복/모지바케: 일부 파일에 중복 코드와 깨진 한글 문자열이 포함되어 있어 유지보수성 저하. 안전 범위에서 텍스트 정리 필요(예: `Home.tsx`, `SelectSet.tsx`, `Results.tsx`).
- 헤더 전달 보장: 브라우저/프록시 환경에 따라 `X-DB-SET` 전달이 누락될 수 있으므로, 네트워크 탭에서 항상 확인 권장. 필요 시 Vite proxy에 헤더 고정 전달 옵션 추가 검토.
- DB 데이터 품질: 외부 생성 DB를 추가할 경우 반드시 리스트를 그대로 저장(문자열로 이중 직렬화 금지). `docs/create_db_rule.md` 준수.
- LLM 안정성: 타임아웃/재시도/쿼터 초과 대응, 설명 길이 제한 등 운영 방어 로직 보완 여지.

**다음 작업 제안(우선순위)**
- 데이터·생성
  - db_generator.py에 남아있는 json.dumps 호출을 물리적으로 제거(현재는 리스트 저장 보장됨). 생성 규칙 문서와 일치시키기.
  - 문제 세트별 샘플 레코드 점검(정규화 로그 기반) 후 데이터 정리.
- 코드 정리
  - 중복 파일 정리 및 한글 문자열 복구(UTF-8 저장). 린트/포맷 적용.
  - `schemas.py` 리스트 기본값 `Field(default_factory=list)` 재검토(중복 선언 정리 포함).
- 운영·검증
  - E2E 확인 체크리스트: 키 설정 배너/모달, 세트 선택 → 퀴즈 → 결과, `X-DB-SET` 헤더, `/api/questions/*` 200 응답과 배열 필드 확인.
  - 로깅 레벨/형식 조정, 에러 추적 도입(Sentry 등) 검토.

