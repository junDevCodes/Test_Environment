# 문제 세트 DB 생성 규칙 (SQLite)

아래 규칙을 따르면 prob_db/ 하위의 DB 파일을 백엔드가 안정적으로 읽어옵니다. 준수하지 않을 경우 500 오류(Internal Server Error)나 보기(options) 누락이 발생할 수 있습니다.

## 위치/파일명
- 위치: 프로젝트 루트의 `prob_db/` 폴더 안에 DB 파일을 배치합니다.
- 확장자: 반드시 `.db` 확장자 사용 (예: `AI_prob.db`).
- 표시명: 화면에는 `_prob.db` 또는 `.db` 접미사를 제거해 표시되지만, 실제 선택/요청에는 파일명 전체를 사용합니다.

## 필수 테이블/컬럼
- 테이블명: 반드시 `questions`
- 스키마(권장 DDL):
  ```sql
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY,
    subject TEXT NOT NULL,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL, -- 'multiple_choice' | 'short_answer' | 'descriptive' | 'coding'
    options TEXT,                -- JSON 배열 문자열(객관식 보기). 예: "[\"A\",\"B\",\"C\",\"D\"]"
    model_answer TEXT NOT NULL,  -- 정답 문자열(객관식은 options 중 하나)
    keywords_full_credit TEXT,   -- JSON 배열 문자열(서술/단답 키워드)
    keywords_partial_credit TEXT -- JSON 배열 문자열(부분 점수 키워드)
  );
  CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject);
  ```

## 컬럼 데이터 규칙
- `id`: 정수(PK). AUTOINCREMENT는 선택.
- `subject`: 과목/주제 문자열. 빈 문자열 금지.
- `question_text`: 문제 본문 문자열. 빈 문자열 금지.
- `question_type`: 다음 중 하나를 정확히 사용
  - `multiple_choice` | `short_answer` | `descriptive` | `coding`
- `model_answer`: 정답 문자열
  - 객관식(`multiple_choice`): `options`의 항목 중 하나와 정확히 일치해야 합니다.
  - 그 외: 자유 형식(서술/코드 등)
- `options`(객관식 보기):
  - 반드시 “JSON 배열 문자열”로 저장합니다. (중요)
  - 예시(정상):
    ```
    "[\"보기1\", \"보기2\", \"보기3\", \"보기4\"]"
    ```
  - 다음은 지양(문제 유발):
    - 작은따옴표 JSON: `'["보기1","보기2"]'` (파서가 실패할 수 있음)
    - 파이썬 리스트 표기: `['보기1','보기2']`
    - 그냥 콤마 구분 텍스트: `보기1,보기2,보기3`
- `keywords_full_credit`, `keywords_partial_credit`:
  - JSON 배열 문자열 권장(예: `"[\"키워드1\", \"키워드2\"]"`)
  - 비워둘 수 있음(빈 배열 또는 NULL)

## 예시 데이터 삽입
```sql
INSERT INTO questions
(id, subject, question_text, question_type, options, model_answer, keywords_full_credit, keywords_partial_credit)
VALUES
(1,
 'AI',
 '지도학습(supervised learning)에 대해 옳은 설명은?',
 'multiple_choice',
 '["정답지가 없는 데이터를 사용하여 모델을 학습시킨다.", "보상과 벌을 통해 최적의 행동을 학습한다.", "연속적인 숫자 값을 예측하는 회귀와 특정 카테고리를 분류하는 문제에 사용된다.", "데이터의 숨겨진 구조나 패턴을 찾는 데 중점을 둔다."]',
 '연속적인 숫자 값을 예측하는 회귀와 특정 카테고리를 분류하는 문제에 사용된다.',
 '[]',
 '[]'
);
```

## 인코딩/형식
- 모든 텍스트는 UTF-8 권장(한글 포함).
- JSON 문자열 내부는 반드시 “큰따옴표”를 사용(RFC 7159). 작은따옴표 금지.
- 줄바꿈/특수문자는 JSON 이스케이프를 준수합니다.

## 동작/조회 규칙
- 프런트는 세트 선택 시 `X-DB-SET: <파일명>` 헤더를 붙입니다.
- 백엔드는 다음 경로로 질문을 읽습니다.
  - `GET /api/questions/all` (전체)
  - `GET /api/questions/<subject>` (특정 과목)
- DB 파일은 `prob_db/<파일명>`에 존재해야 하며, 테이블명은 `questions`여야 합니다.

## 권장 사항
- `multiple_choice` 문제는 `options` 배열이 비어있지 않도록 합니다.
- `model_answer`는 `options`의 항목 중 하나와 정확히 일치하도록 관리(공백 포함 일치).
- `subject` 값 표준화(대소문자 일관): 예를 들어 ‘AI’, ‘EDA’ 등.
- 스키마 변경 시(컬럼 추가), 기본 컬럼은 유지하고 새 컬럼을 추가하세요. 백엔드는 기본 컬럼만 사용합니다.

## 셀프 체크리스트
- [ ] 파일이 `prob_db/` 하위에 있고 확장자가 `.db`인가?
- [ ] `questions` 테이블이 존재하는가?
- [ ] `question_type` 값이 네 가지 중 하나인가?
- [ ] `options`/키워드가 “JSON 배열 문자열”인가? (큰따옴표 JSON 확인)
- [ ] 객관식의 `model_answer`가 `options` 중 하나와 정확히 일치하는가?

## 문제 발생 시 점검
- 500 에러가 발생하면:
  - DB 경로/파일명이 정확한지(`prob_db/<파일명>`) 확인
  - `questions` 테이블과 필수 컬럼이 존재하는지 확인
  - `options`/키워드가 JSON 배열 문자열인지 확인
  - 백엔드 로그/응답 detail 메시지로 구체 원인을 확인
- 여전히 해결되지 않으면 DB 파일(민감정보 제거)과 DDL/샘플 데이터를 공유해 주세요. 백엔드 파서 보강 또는 마이그레이션 스크립트를 제공할 수 있습니다.

## Python으로 생성/삽입 예시
```python
import sqlite3, json

conn = sqlite3.connect('prob_db/AI_prob.db')
c = conn.cursor()
c.execute('''CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL,
  options TEXT,
  model_answer TEXT NOT NULL,
  keywords_full_credit TEXT,
  keywords_partial_credit TEXT
)''')

options = [
  "정답지가 없는 데이터를 사용하여 모델을 학습시킨다.",
  "보상과 벌을 통해 최적의 행동을 학습한다.",
  "연속적인 숫자 값을 예측하는 회귀와 특정 카테고리를 분류하는 문제에 사용된다.",
  "데이터의 숨겨진 구조나 패턴을 찾는 데 중점을 둔다."
]

c.execute(
  'INSERT INTO questions (subject, question_text, question_type, options, model_answer, keywords_full_credit, keywords_partial_credit) VALUES (?,?,?,?,?,?,?)',
  (
    'AI',
    '지도학습(supervised learning)에 대해 옳은 설명은?',
    'multiple_choice',
    json.dumps(options, ensure_ascii=False),
    options[2],
    json.dumps([], ensure_ascii=False),
    json.dumps([], ensure_ascii=False),
  )
)
conn.commit()
conn.close()
```

---
이 문서의 규칙을 따르면 prob_db의 새로운 세트 DB가 프런트의 세트 선택 → 문제 로딩 → 보기 표시까지 원활히 동작합니다.
