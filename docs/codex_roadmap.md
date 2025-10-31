**Overview**
- 목표: 학습 자료(텍스트 요약, .ipynb)를 ingest하여 이론/실습 혼합 문항을 생성하고, 인터랙티브 퀴즈 흐름, 즉시 피드백, 결과 요약을 제공하는 AI‑보조 퀴즈 플랫폼.
- 스택: FastAPI + SQLAlchemy + SQLite(백엔드), React + TypeScript + Vite(프론트엔드), Fluent 스타일 UI, 서술형/단답형 답변에 선택적으로 Gemini 기반 채점.

**Repository Layout (Updated)**
- `app` — FastAPI 앱, ORM 모델, CRUD, 스키마, LLM 래퍼
- `frontend` — React(Vite) 앱, UI 컴포넌트와 스타일
- `db_builder` — JSON → SQLite 생성기 및 검증 유틸
- `data` — 원본 문제 JSON (예: `AI_questions_theory.json`)
- `storage` — 런타임에서 사용하는 생성된 SQLite DB(read‑only)
- `docs` — 개발 문서(이 파일 포함)
- `requirements.txt` — 백엔드 의존성(루트)

**현재까지 진행사항 (요약)**
- 새 파일 구조로 정리(app/db_builder/data/storage/frontend) 및 문서 반영
- 세트 선택 흐름 구축: `/api/sets`, `X-DB-SET` 헤더로 세트 고정, 프론트 연동 완료
- 문제 조회/채점 엔드포인트 정리: `/api/questions/{subject}`, `/api/submit/{subject}`, `/api/check-answer/{subject}`
- JSON 응답 UTF‑8 강제, TEXT(JSON) 리스트 필드 복원 로직 추가로 파싱 안정성 향상
- Gemini 키 관리(status/set/clear) 및 LLM 채점 폴백 경로 정비
- DB 생성기 경로/정규식 복구로 `storage/{subject}_prob.db` 산출 준비 완료

**이후 진행 예정 (요약)**
- `data/*.json` → `storage/*.db` 생성·검증(db_generator, validator 활용) 및 샘플 세트 제공
- 백엔드 하드닝: LLM 타임아웃/재시도/간단 캐시, 에러 응답 일관화, 로깅 수준 정리
- 프론트 UX: 세트 선택/로딩·에러 토스트 보강, 키 모달 접근성(포커스 트랩/ESC/스크롤 락)
- 테스트/운영: 채점 헬퍼·엔드포인트 유닛 테스트, 주요 컴포넌트 테스트, CI 파이프라인
- 문서 정합성: `custom_HowToUse.md`, `create_db_rule.md`의 `backend/prob_db`를 `app/storage` 기준으로 업데이트

**Implemented Changes (This Iteration)**
- 채점 리팩터 및 단일 문항 즉시 확인
  - 공유 채점 헬퍼(LLM 폴백 포함): `app/main.py:72`, `app/llm.py:7`
  - 즉시 확인 엔드포인트: `POST /api/check-answer` at `app/main.py:272`
  - 제출 엔드포인트도 헬퍼 재사용: `POST /api/submit` at `app/main.py:251`
- Gemini API 키: 프로세스 메모리 내(ephemeral) 관리
  - 상태 조회: `GET /api/config/status` at `app/main.py:291`
  - 설정: `POST /api/config/gemini` at `app/main.py:296`
  - 초기화: `POST /api/config/gemini/clear` at `app/main.py:304`
  - 스키마: `GeminiKeyPayload`, `KeyStatus` at `app/schemas.py:38`
  - LLM 래퍼(Gemini 1.5 Flash), JSON 출력 기대 + 안전 폴백: `app/llm.py:7`
- 응답/데이터 정규화 보강
  - JSON 응답에 UTF‑8 charset 강제: `app/main.py:44`
  - TEXT/JSON로 저장된 리스트형 필드(`options`, `keywords_*`) 복원 유틸: `app/main.py:126`
- 세트 선택 및 요청 라우팅(작업 중)
  - 문제 세트 목록: `GET /api/sets` at `app/main.py:196` (경로를 `storage/`로 정렬 필요)
  - 프론트에서 `X-DB-SET` 헤더로 선택된 세트 전달: `frontend/src/lib/api.ts`
- 프론트 UX
  - 키 상태/모달: `frontend/src/components/Home.tsx`
  - 세트 선택 흐름: `frontend/src/components/SelectSet.tsx`
  - 퀴즈/결과: `frontend/src/components/Quiz.tsx`, `frontend/src/components/Results.tsx`
- Dependencies
  - Gemini SDK(`google-generativeai`) 추가: `requirements.txt`

**Security & Key Handling**
- Gemini 키는 `app.state`에만 존재하며, 파일/로그에 저장하지 않음. 전용 엔드포인트로만 관리.
- 운영 권장: HTTPS, CORS 제한, 리버스 프록시의 바디 로깅 비활성화, UI 대신 환경변수/시크릿 매니저로 키 주입.

**Run & Verify**
- Backend
  - `pip install -r requirements.txt`
  - `uvicorn app.main:app --reload --port 8000`
  - 브라우저에서 `http://localhost:8000/docs`로 엔드포인트 확인
- Frontend
  - `cd frontend && npm install && npm run dev`
  - Vite dev proxy가 `/api`를 `http://localhost:8000`로 라우팅(필요 시 `VITE_API_BASE_URL` 설정)
  - 첫 로드시 키 미설정이면 모달 노출, 저장 시 서술형 AI 채점 활성화(미설정 시 키워드 기반)

**Known Gaps (Updated)**
- 백엔드 DB 아키텍처 불일치
  - `app/main.py`가 존재하지 않는 `engine`/`SessionLocal`/`get_session_local_for_set` 참조. 현재 `app/database.py`는 sqlite3 헬퍼만 노출. per‑set SQLAlchemy 세션으로 통일하거나, 읽기용 sqlite3로 일원화 필요.
- 세트 검색 경로 드리프트
  - `GET /api/sets`가 `prob_db/`를 읽음. 새 구조는 `storage/` 사용.
- `storage/` 미생성 및 DB 미빌드
  - `db_builder/db_generator.py` 실행 전까지 런타임 DB 부재.
- 생성기 버그
  - `BASE_DIR` 계산(`parent[1]`)과 파일명 정규식이 깨져 있어 빌드 실패. 수정 필요.
- CORS/자격증명 정책 재검토 필요
  - 현재 로컬 개발 오리진만 허용, `allow_credentials=False`. 운영 환경에 맞춰 강화 필요.
- 마이그레이션 과정 UTF‑8 정리
  - 일부 문서/UI 문자열에 과거 깨진 문자가 섞여 있음. 통일된 UTF‑8 유지 필요.

**Next Steps (Recommended)**
- 백엔드 일관화
  - DB 접근 방식을 하나로 결정: (A) per‑set SQLAlchemy 엔진/세션 팩토리 구현 또는 (B) 읽기 전용 sqlite3로 통일. 혼용 코드 제거.
  - `X-DB-SET`을 요청 경로 전반에 일관되게 반영하고, `/api/sets`는 `storage/`를 기준으로 제공.
- 저장소 DB 빌드/검증
  - `db_builder/db_generator.py`의 경로/정규식 수정 후 `storage/{subject}_prob.db` 생성.
  - `db_builder/validator.py`로 산출물 sanity check.
- 하드닝/UX
  - LLM 타임아웃/재시도/간단 캐시, 모달 접근성(포커스 트랩/ESC/스크롤 락), 에러 토스트.
- 테스트/운영
  - 채점 헬퍼·`/api/check-answer` 유닛 테스트, 세트 선택·퀴즈 흐름 컴포넌트 테스트.
  - CI/컨테이너화, `.env` 문서화(`STORAGE_DIR=./storage`).

**Update 2025-10-30**
- Backend
  - 세트 선택: 요청 헤더 `X-DB-SET` 기반 per‑set DB 선택. 세트 목록 `GET /api/sets` 구현(경로 정렬 필요).
  - 질문 로딩 시 리스트형 TEXT(JSON 문자열) 복원 로직 추가로 500(ResponseValidationError) 감소. 파싱 실패 시 디버그 로그에 id/subject 출력.
  - Gemini 키 관리 엔드포인트 3종(status/set/clear) 추가. 키는 프로세스 메모리에서만 유지, 환경변수 초기화 지원.
  - 채점 로직: 서술형/단답형은 Gemini 폴백 채점, 나머지는 키워드 비교. `POST /api/check-answer`로 문항 단위 즉시 피드백 제공.
- Frontend
  - 세트 선택 페이지: 목록/선택/앞뒤 이동, 키 상태 배너/모달 연동.
  - 퀴즈 화면: 홈으로 이동 시 종료 확인, 미응답은 오답 처리 후 결과로 이동, 진행도 표시.
  - 결과 화면: 홈 이동/다시 시작, Gemini 설명 표시.
- DB 생성 스크립트(db_builder/db_generator.py)
  - JSON 컬럼은 TEXT(JSON 문자열)로 저장하고, 런타임에 리스트로 복원. 산출물은 `storage/{subject}_prob.db`.
  - 샘플 조회에서 `question_text`, `model_answer` 정상, `options`/`keywords_*`는 복원 정상.

**Migration Notes (File‑Structure)**
- Old: `backend/`, `prob_db/`, 루트 `test.db`
- New: `app/`, `storage/`, `db_builder/`, `data/` (생성기 기반 DB 사용)
- Action items
  - 문서·코드의 `backend/*` 경로를 `app/*`로 치환.
  - `prob_db` 사용처를 `storage`로 변경(백엔드 코드/문서 모두).
  - `storage/` 생성 후 `db_builder/db_generator.py`로 DB 빌드.
  - 백엔드에서 DB 접근 방식을 통일하고, 사용하지 않는 경로(시드/DDL)는 제거.
