# 마이그레이션 로드맵 (Migration Roadmap)

본 문서는 기존 혼재된 구조(backend/prob_db 가이드, 세트/과목 개념 혼용)를 새 파일 구조(app/storage/db_builder/data)와 동작 모델에 맞추어 정리/적용한 변경 내용을 기록합니다.

## 목표
- 파일 구조 정렬: `app/`, `db_builder/`, `data/`, `storage/`, `frontend/`
- 런타임 DB는 `storage/*.db`(read‑only)를 사용, 생성은 `db_builder/db_generator.py`가 담당
- 백엔드는 “요청 헤더 `X-DB-SET` = 사용할 DB 파일명”을 기준으로 세트를 선택해 읽기 전용 질의를 수행

## 적용 변경 요약
- docs/codex_roadmap.md
  - 레이아웃/엔드포인트/실행 방법을 새 구조에 맞게 전면 업데이트
  - Known Gaps/Next Steps를 현재 설계와 충돌 지점 기준으로 갱신
- app/main.py (전면 재작성)
  - 세트 선택을 헤더(`X-DB-SET`) 기반으로 통일
  - `/api/sets`는 `storage/*.db` 파일명을 그대로 반환(예: `AI_prob.db`)
  - `/api/questions/{subject}`는 헤더로 선택된 세트에서 문제를 로드하고, `subject`가 `all|*`이면 전체 반환
  - `/api/submit/{subject}`, `/api/check-answer/{subject}`도 동일한 세트 기준으로 채점 수행
  - JSON 응답 UTF‑8 강제 및 리스트형 필드 복원 로직 유지/정리
- db_builder/db_generator.py
  - `BASE_DIR` 계산 오류 수정: `parents[1]`
  - 파일명 정규식 정상화: `(?P<subject>[A-Za-z0-9가-힣_]+)_questions_(?P<source>[A-Za-z]+)\.json`
  - 주석/검증 메시지 정리(기능 동일)

## 코드 변경 상세
- app/main.py
  - `list_sets()`
    - Before: 과목명만 반환(`AI`) → Frontend가 기대하는 세트 파일명(`AI_prob.db`)과 불일치
    - After: `storage` 내 `.db` 파일명을 그대로 반환 → 프론트의 `displayName()`로 표시명만 가공
  - `read_questions(subject, request)`
    - 헤더 `X-DB-SET` 필수. `subject in {'all','*'}`이면 전체, 그 외엔 `subject` 컬럼 필터
    - sqlite3 직결, `row_factory=sqlite3.Row`, 리스트형 필드 복원
  - `submit_answers(..., request)` / `check_answer(..., request)`
    - 헤더 `X-DB-SET`로 세트 선택, 단건 조회는 `_fetch_question_by_id(db_set, qid)` 사용
  - `startup`
    - 환경변수 `GEMINI_API_KEY` 존재 시 메모리에 보관(비영속)

- db_builder/db_generator.py
  - 경로/정규식 수정 외 동작 동일: `data/*.json` → subject별 bucket → `storage/{subject}_prob.db` 재생성

## 실행/검증 절차
1) 저장소 DB 생성/갱신
   - `python db_builder/db_generator.py`
   - 산출물: `storage/<Subject>_prob.db`
2) 백엔드 실행
   - `pip install -r requirements.txt`
   - `uvicorn app.main:app --reload --port 8000`
3) 프론트엔드 실행
   - `cd frontend && npm install && npm run dev`
   - 세트 선택 화면에서 DB 파일을 선택하면, 헤더 `X-DB-SET`에 파일명이 설정됨
4) E2E 확인 포인트
   - `/api/sets`가 `.db` 파일명을 반환하는지
   - 문제 로딩/채점 요청 시 `X-DB-SET` 헤더가 포함되는지
   - `/api/questions/{subject}`: `subject=all`에서 전체 문제 로드, 특정 subject 값에서도 동작

## 주의/리스크
- 프런트엔드와 계약(Contract)
  - 이번 변경으로 `/api/sets`가 파일명을 반환합니다. 프런트는 현 구현(`displayName()`로 `_prob.db` 제거, `setDbSet()`로 헤더 설정)에 부합합니다.
  - 퀴즈 라우트는 `/quiz/:subject`이나, 실제 DB 선택은 헤더로 처리합니다. 라우트의 `subject`는 `all|*` 또는 뷰 필터 용도로만 사용됩니다.
- 저장소 DB 스키마
  - TEXT(JSON 문자열)로 저장된 리스트형 필드는 런타임 복원합니다. 입력 JSON이 손상/이중 인코딩일 경우 복원 실패 가능 → 생성기/데이터 규칙 준수 필요
- 운영 하드닝
  - CORS, 타임아웃/재시도, LLM 요청 한도 초과 방어, 로깅/모니터링은 추후 강화 항목입니다.

## 다음 단계(제안)
- 프런트: 세트 선택 → 퀴즈 진입 시 로딩/에러 토스트 보강, 키 모달 접근성 개선
- 백엔드: LLM 타임아웃/재시도 및 간단 캐시(문항/답 조합 키), 에러 응답 메시지 일관화
- 데이터: `data/*.json` 저작 규칙 엄격화, CI에 생성기/검증기 연동

