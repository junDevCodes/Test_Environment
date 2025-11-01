**Overview**
- 목표: 학습 자료(요약·노트북)로부터 이론/실습 문제를 생성하고, 인터랙티브 퀴즈·즉시 채점·결과 요약을 제공하는 AI 학습 플랫폼
- 스택: FastAPI + SQLite(백엔드), React + TypeScript + Vite(프론트), Fluent 스타일 UI, 선택적 Gemini 기반 채점

**Repository Layout (Updated)**
- `app` — FastAPI, 경로/채점/유틸
- `frontend` — React(Vite) UI
- `db_builder` — JSON→SQLite 생성기/검증기
- `data` — 원본 문제 JSON
- `storage` — 배포용 SQLite DB(읽기 전용)
- `docs` — 문서
- `requirements.txt` — 백엔드 의존성(루트)

**현재까지 진행사항 (요약)**
- 구조/경로 정리: `app/db_builder/data/storage/frontend`로 일원화, 문서 반영
- 세트 선택·헤더 규약: `/api/sets`, `X-DB-SET` 고정(프론트 axios 기본 헤더)
- API 구현(완료):
  - `/api/questions/{subject}` — 문제 조회(all|*)/과목 필터
  - `/api/submit/{subject}` — 배열 JSON 제출(단일 객체도 허용됨)
  - `/api/check-answer/{subject}` — 단건 즉시 채점
- 응답 인코딩: 모든 JSON에 `charset=utf-8` 강제
- LLM/Gemini: 상태·설정·초기화 엔드포인트, in‑memory 키 보관, 실패 시 키워드 기반 채점
- DB 빌드 파이프라인(갱신):
  - `data/**.json` 재귀 스캔, 파일명 패턴 다중 지원
  - subject별로 병합, `storage/{subject}_prob.db` 생성(기존 교체)
  - `id` 누락 시 자동 부여, `short_answer/descriptive`는 `keywords_*` 기본 배열 추가
- 검증기(강화): ID 고유성·UTF‑8 깨짐·JSON 파싱·유형별 제약 검사
- 프론트(퀴즈 화면):
  - 문제 순서 랜덤 셔플, 상단에 “문항번호. subject” 표기
  - 채점/제출 경로를 `{subject}` 포함 형태로 정정
- 문서: `docs/custom_HowToUse.md`를 현 구조(app/storage/db_builder/data) 기준으로 전면 갱신
- E2E 확인: 세트 로딩→문제 로딩→check/submit 정상 동작 확인

**이번 Iteration 반영 상세**
- db_generator
  - rglob 스캔, 파일명 패턴(A/B) 지원, `id` 자동 부여, `keywords_*` 기본값
  - `AI_prob.db`(240문항) 생성·검증 완료
- validator
  - ID 고유성, JSON 파싱, 유형별 제약 강화
- app/main.py
  - submit 단일 객체 허용, `X-DB-SET` 누락 시 명확한 에러 메시지
  - check/submit Docstring에 PowerShell/curl 예시 추가
  - 리스트 필드 복원 단순화로 한글 ‘보기’ 깨짐 이슈 해소(정책 반영)
- frontend
  - Quiz 화면 랜덤 셔플·subject 표기, check/submit 경로 정합화

**Security & Key Handling**
- Gemini 키는 프로세스 메모리에만 저장(파일/로그 미기록)
- 운영 권장: HTTPS, CORS 제한, 리버스 프록시 바디 로깅 비활성화, 환경변수 주입

**Run & Verify**
- Backend
  - `pip install -r requirements.txt`
  - `uvicorn app.main:app --reload --port 8000`
  - `http://localhost:8000/docs`에서 확인
- Frontend
  - `cd frontend && npm install && npm run dev`
  - 기본 프록시(`/api`→`http://localhost:8000`), 필요 시 `VITE_API_BASE_URL` 설정

**Known Gaps (Updated)**
- 운영 보안/설정 강화 필요
  - 현재 개발 오리진 위주 CORS, `allow_credentials=False` — 운영 환경에 맞게 강화 필요
- OpenAPI 예시
  - Docstring 예시는 반영했으나, 스키마 `Body(examples=...)` 수준으로 노출 개선 여지
- 레거시 파일 혼입
  - `storage/test.db`는 구스키마(옵션 JSON 아님) — `/api/sets` 노출 제외 또는 삭제 권장

**Next Steps (Recommended)**
- 백엔드
  - `/api/sets`에서 레거시 DB(test.db) 필터링 또는 `STORAGE_EXCLUDE` 옵션 도입
  - OpenAPI에 요청 바디 examples 추가(배열/단건 모두 표기)
  - LLM 채점 캐시/타임아웃 로깅·관찰성(요약 로그, 실패 사유)
- 데이터 파이프라인
  - 병합 전 정적 검사: “이중 직렬화(options가 문자열 JSON)” 자동 경고 추가(validator)
  - 대과목 디렉터리별 빌드 리포트(유형/과목 분포)
- 프론트
  - 문제 재셔플 옵션, 셔플 seed(재현성) 지원 고려
  - 결과 화면에 과목/유형별 통계 요약
- 운영/문서
  - `.env` 샘플(`STORAGE_DIR=./storage`)·배포 가이드 보강
  - 불필요 문서/폴더 정리(legacy): `docs/create_db_rule.md`, `docs/gemini_roadmap.md`, `docs/migration_roadmap.md`, `migration_context.md`, `storage/test.db`, `test_set/`

**Update 2025-11-01**
- E2E 확인 완료: `/api/sets`→문제 로딩→check/submit OK
- 퀴즈 화면 개선: subject 표기·랜덤 셔플 적용
- submit 단건 허용 및 헤더 누락 메시지 개선
- 보기 한글 깨짐: 리스트 필드 복원 로직 단순화로 해결

**Migration Notes (File/Structure)**
- Old: `backend/`, `prob_db/`, 루트 `test.db`
- New: `app/`, `storage/`, `db_builder/`, `data/` (생성기 기반 DB 사용)
- Action items
  - 코드/문서의 `backend/*` 경로를 `app/*`로 치환
  - `prob_db` 사용처를 `storage`로 변경(백엔드·문서 모두)
  - `db_builder/db_generator.py`로 DB 빌드
  - DB 접근 방식을 per‑set SQLite로 일원화, 구 코드 제거

