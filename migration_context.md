# 프로젝트 리팩토링 컨텍스트 (migration_context)

## 0. 목적

이 프로젝트는 "AI 시험/문제은행 웹 서비스"이다.  
백엔드는 FastAPI, DB는 SQLite, 프론트는 React/Vite 기반이다.  
문제 데이터는 JSON으로 관리하고, 서비스 런타임에서는 SQLite에서 읽어서 내려준다.

우리는 지금 디렉토리 구조를 프로덕션(배포) 친화적으로 정리하려고 한다:
- app/ (백엔드)
- data/ (문제 원본 JSON)
- db_builder/ (JSON → SQLite 변환 스크립트)
- storage/ (생성된 SQLite DB, 런타임 read-only)
- frontend/ (클라이언트)
- docs/ (개발 문서)
- 그 외 루트 설정 파일들

이 문서 기반으로 마이그레이션 플랜과 코드 수정 가이드를 생성해 달라.


## 1. 현재 구조 요약

이전에 파악했던 디렉토리 구조로 인지하면 된다.

- 잔존/부재 확인:
  - 현재 `backend/` 디렉토리는 없음 (과거 구조에서 app/로 옮김)
  - 현재 `prob_db/` 디렉토리는 없음 (지금은 `storage/`가 그 역할)
  - 현재 루트에는 validate_db.py, validate_db_strict.py 두 개의 검증용 스크립트가 존재하나, 이는 중복 기능을 수행하고 있으므로 db_builder/validator.py로 통합할 예정이다.

## 2. 목표 구조 (우리가 고정하려는 이상형)

우리는 최종적으로 다음과 같은 구조를 표준으로 삼으려고 한다:

```text
Test_Environment/
  app/
    main.py
    api/            # 라우터들
    core/           # 설정, 미들웨어, 공통 유틸
    services/       # DB 접근/비즈니스 로직
    models/         # (ORM 모델 등)
    tests/          # 백엔드 테스트
    __init__.py
  data/
    <subject>_questions_<source>.json  # 예: AI_questions_theory.json
  db_builder/
    db_generator.py                    # JSON → SQLite 변환
    validator.py                       # 데이터 검사 스크립트
    README.md                          # 데이터 빌드/재생성 가이드
  storage/
    AI_prob.db
    ...                                # 과목별 SQLite. 런타임 read-only
  frontend/
    src/
    public/
    package.json
    vite.config.ts
  docs/
    ...                                # 개발용 문서. 런타임 비필수
  scripts/
    build_all.sh
    deploy_prod.sh
  .env
  requirements.txt
  Dockerfile
  docker-compose.yml
  README.md
```

핵심 철학:
- `data/` 는 "원본"
- `db_builder/` 는 "data → storage" 변환 툴
- `storage/` 는 "배포/런타임에서 읽을 실제 DB"
- `app/` 은 "API (읽기 전용 SQLite를 서빙)"
- `frontend/` 는 "UI"

참고: 기존 루트에 있던 validate_db.py 및 validate_db_strict.py 스크립트는 validator.py로 통합된다.
Codex는 해당 파일들을 삭제 대상으로 포함하고, db_builder/validator.py 기반의 검증 체계를 기준으로 안내하면 된다.

## 3. 런타임 동작 모델

- `data/*.json`
  - UTF-8 (BOM 허용) 한글 문제 세트.
  - 파일명 규칙: `{과목}_questions_{source}.json`
    - 예: `AI_questions_theory.json`, `AI_questions_practice.json`, `Python_questions_theory.json`
  - 각 문제 객체는 id, question_text, question_type, model_answer, options[], keywords_full_credit[], keywords_partial_credit[] 등 필드를 가진다.

- `db_builder/db_generator.py`
  - `data/*.json`을 읽는다.
  - 과목(subject) 단위로 레코드를 모아 SQLite DB를 만든다.
    - 예: subject="AI" → `storage/AI_prob.db`
  - 기존 DB가 있으면 지우고 새로 만든다. (즉 "전체 재생성" 정책)
  - UTF-8 텍스트 깨짐(�) 검출 등 간단한 validate_question() 수행.
  - 결과적으로 storage 안의 각 `{subject}_prob.db`가 싱글 소스 오브 트루스(DB 레벨)로 사용된다.
    → 앱 런타임은 여기만 본다.

- `app/` (FastAPI)
  - 클라이언트에서 특정 과목(subject)을 요청하면,
    해당 과목의 DB `storage/{subject}_prob.db`를 읽어서 문제들을 서빙한다.
  - DB는 읽기 전용으로 취급(= runtime에서 insert/update 없음).
  - 응답은 UTF-8 JSON으로 내려가야 한다.
    - 즉 `application/json; charset=utf-8` 헤더를 보장하는 미들웨어가 필요하다.

- `frontend/`
  - `/api/...` 엔드포인트를 호출해서 문제 목록 / 퀴즈 / 채점 등을 처리한다.
  - 프론트는 storage에 직접 접근하지 않는다.


## 4. 우리가 Codex에게 원하는 최종 산출물

Codex가 아래 항목을 모두 채워서 답변해주길 원한다.  
(즉, Codex의 출력은 사실상 리팩토링 가이드/README 초안이다.)

### (A) 마이그레이션 플랜 (파일/폴더 이동, 삭제, 리네임)
- 현재 구조에서 목표 구조로 가기 위해 어떤 구체적인 작업이 필요한지,
  `mv`, `rm`, `rename` 형태로 순서 있는 리스트로 작성한다.
- 예:
  - `mv db_builder/db_generator.py db_builder/db_generator.py` (위치는 같지만 BASE_DIR 수정 필요 등도 명시 가능)
  - `rm test.db`
  - `rm storage/test.db`
- 특히 아래 항목에 대해 명시:
  - 루트 `test.db`와 `storage/test.db`는 삭제 가능한가?
  - `validate_db.py`, `validate_db_strict.py`, `show_types.py`는 유지해야 하는가? / 어느 폴더로 이동할 건가?
  - docs/ 폴더는 "운영에는 불필요하지만 개발참고용으로 유지" 상태로 두는 게 맞는지, 삭제 후보인지.

### (B) 코드 경로/임포트 수정 가이드
1. `db_builder/db_generator.py`에서 사용할 경로 상수 예시를 Python 코드 블록으로 제시한다.  
   가정:
   - 실제 경로: `db_builder/db_generator.py`
   - 루트: `Test_Environment/`
   - 원본 JSON: `Test_Environment/data/`
   - 산출 DB: `Test_Environment/storage/`

   기대 형태:
   ```python
   from pathlib import Path

   BASE_DIR = Path(__file__).resolve().parent.parent  # <- 루트(Test_Environment)
   DATA_DIR = BASE_DIR / "data"
   DB_DIR = BASE_DIR / "storage"
   ```

2. FastAPI에서 SQLite 열기:
   - 제안: `.env` 파일에 `STORAGE_DIR=./storage` 같은 식으로 넣고,
     `app/database.py`에서 `os.getenv("STORAGE_DIR")`를 읽은 후
     요청으로 들어온 subject를 이용해서 `f"{STORAGE_DIR}/{subject}_prob.db"`를 붙이는 방식.
   - Codex는 이 패턴을 추천/보완해주고, `.env`에 선언할 키 이름을 제안해줘
     (예: `STORAGE_DIR`, `DEFAULT_SUBJECT`, 등).
   - Codex는 간단한 예시 코드를 작성해줘야 한다:
     - FastAPI 라우터 예시 (GET `/api/questions/{subject}`)
     - 내부에서 sqlite3.connect로 DB 열고
     - `SELECT * FROM questions LIMIT 10` 같은 쿼리를 실행해서
     - 그 결과를 JSON으로 리턴하는 코드
     - (Pydantic 응답 모델은 간단 버전이면 충분)

3. 응답 인코딩:
   - Codex는 `application/json; charset=utf-8` 헤더를 보장하는 미들웨어 또는 FastAPI Response 설정 위치를 언급해줘야 한다.

### (C) 삭제 가능한 레거시 / 정리 대상
- 현재 루트에 있는 `validate_db.py`, `validate_db_strict.py`, `show_types.py` 등 유틸 스크립트,
  그리고 루트 `test.db`, `storage/test.db` 같은 파일을 다음 카테고리로 분류해달라:
  1. "완전히 삭제 가능"
  2. "db_builder/로 이동해서 개발용 유틸로 보관"
  3. "운영에 필요"
- 분류 근거도 간단하게 적어달라.

### (D) 최종 동작 확인 체크리스트
- 로컬 개발자가 새로 프로젝트 클론했다고 가정했을 때,
  어떤 순서로 명령을 실행하면 되는지 단계별로 알려달라.
- 기대 흐름 예시:

  1. (가상환경 활성화 후) `python db_builder/db_generator.py`
  2. FastAPI 백엔드 실행: `uvicorn app.main:app --reload`
  3. 프론트엔드 개발 서버 실행:
     ```bash
     cd frontend
     npm install
     npm run dev
     ```
  4. 브라우저에서 API와 한글 인코딩 정상 확인.

- Codex는 `.env` 설정(예: `STORAGE_DIR=./storage`)이 필요하다면 그것도 명시해줘야 한다.

---

## 5. Codex에게 바라는 답변 형식

Codex는 위의 (A)(B)(C)(D)를 순서대로, 명확하게 구분해서 답변해 달라.  
특히 (B) 파트에서 제시하는 코드 샘플은,
- 그대로 복사해서 코드에 넣을 수 있을 정도로 구체적일 것
- Python 문법 맞을 것
- FastAPI 예시는 최소한으로 동작 가능한 수준일 것
- sqlite3 사용 시, `row_factory` 등을 써서 dict로 변환하기 쉽게 해 줄 것 (권장)

이 문서를 모두 이해했으면, 위 (A)(B)(C)(D) 4개 파트에 대해 답변을 생성해줘.
