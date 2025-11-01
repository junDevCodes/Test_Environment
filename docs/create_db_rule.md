# 문제 세트 DB 생성 규칙 (SQLite)

이 문서는 Gemini 등 LLM이 문제 세트용 SQLite DB를 만들 때 반드시 따라야 할 규칙을 정리합니다. 규칙을 지키지 않으면 백엔드 파싱 실패로 500 오류가 발생할 수 있습니다.

## 위치/파일명
- 위치: 프로젝트 루트의 `prob_db/` 폴더.
- 확장자: 반드시 `.db` 사용. 예: `AI_prob.db`
- 세트 선택 규칙: 파일명이 그대로 세트 이름이 됩니다. 예: `X-DB-SET: AI_prob.db`

## 필수 스키마(엄격 모드 권장)
- 테이블명: `questions`
- 컬럼 정의(TEXT에 JSON 문자열 저장 권장)
  ```sql
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY,
    subject TEXT NOT NULL,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL, -- 'multiple_choice' | 'short_answer' | 'descriptive' | 'coding'
    options TEXT,                -- JSON 배열 문자열(객관식 보기). 예: "[\"A\",\"B\",\"C\",\"D\"]"
    model_answer TEXT NOT NULL,  -- 정답 문자열(객관식은 options 중 하나와 완전 일치)
    keywords_full_credit TEXT,   -- JSON 배열 문자열(서술/단답/코딩 가산점 키워드)
    keywords_partial_credit TEXT -- JSON 배열 문자열(부분 점수 키워드)
  );
  CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject);
  ```

### 대안 스키마(수용됨)
- `options`/`keywords_*` 컬럼에 SQLAlchemy `JSON` 타입을 사용할 수도 있습니다. 이 경우 값은 “파이썬 리스트 그대로” 저장하고, 문자열로 이중 인코딩하지 않습니다. 백엔드는 TEXT(JSON 문자열)와 JSON 컬럼 모두 정상 파싱합니다.

## 컬럼 값 규칙
- `id`: 정수 PK. AUTOINCREMENT 선택 가능.
- `subject`: 과목/주제 문자열(UTF-8).
- `question_text`: 문제 본문(UTF-8). 줄바꿈 가능.
- `question_type`: 반드시 아래 중 하나
  - `multiple_choice` | `short_answer` | `descriptive` | `coding`
- `model_answer`:
  - 객관식은 `options` 중 하나와 완전히 같아야 함(공백/대소문자 포함 동일).
  - 서술/단답/코딩은 자유 형식 문자열. 코드 블록도 허용(그대로 텍스트 저장).
- `options`(객관식 전용):
  - 엄격 모드: JSON 배열 “문자열”을 TEXT에 저장. 예: `"[\"보기1\",\"보기2\"]"`
  - 대안 모드(JSON 컬럼): 리스트 그대로 저장. 예: `['보기1','보기2']`
  - 비객관식 문제는 `NULL` 또는 빈 배열(`"[]"`) 권장.
- `keywords_full_credit`, `keywords_partial_credit`:
  - 엄격 모드: JSON 배열 “문자열”(`"[]"`) 저장. 비어 있으면 `NULL` 또는 `"[]"` 허용.
  - 대안 모드(JSON 컬럼): 리스트 그대로 저장.

## 인코딩/JSON 규칙(중요)
- 텍스트는 모두 UTF-8(파일/DB) 사용.
- JSON은 반드시 큰따옴표만 사용(RFC 7159). 작은따옴표 금지.
- 줄바꿈/따옴표는 JSON 표준 이스케이프 사용. 예: `\n`, `\"`.
- Python에서 JSON 문자열 생성 시 `json.dumps(value, ensure_ascii=False)` 사용해 한글을 이스케이프하지 않음.

## 작성/조회 규칙
- 프론트는 세트 선택 시 요청 헤더에 `X-DB-SET: <파일명>`을 보냄.
- 백엔드 조회 경로
  - `GET /api/questions/all` 전체
  - `GET /api/questions/<subject>` 과목별
- 백엔드는 TEXT(JSON 문자열)와 JSON 컬럼 모두 허용하나, 엄격 모드(TEXT+JSON 문자열)가 LLM 산출물과의 호환성 측면에서 안전합니다.

## 검증 체크리스트
- [ ] DB가 `prob_db/` 아래에 있고 확장자가 `.db`인가?
- [ ] `questions` 테이블 존재 여부 확인.
- [ ] `question_type` 값이 4종 중 하나인가?
- [ ] 객관식에서 `options`가 비어 있지 않고 JSON 배열 형식을 준수하는가?
- [ ] 객관식에서 `model_answer`가 `options` 항목과 완전 일치하는가?
- [ ] 비객관식에서 `options`가 `NULL` 또는 빈 배열로 처리되었는가?
- [ ] `keywords_*`가 JSON 배열(문자열 또는 JSON)로 저장되었는가?

## 문제 발생 시 점검
- 경로/파일명: `prob_db/<파일명>` 인지 확인.
- 스키마: `questions` 테이블과 필수 컬럼 존재 여부.
- 데이터: `options`/`keywords_*`가 JSON 배열인지(작은따옴표·콤마 문자열 금지).
- 백엔드 에러 메시지(`detail`)와 로그로 파싱 실패 지점 확인.

## Python 예시(엄격 모드: TEXT에 JSON 문자열 저장)
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
  "정답지가 있는 데이터를 이용하여 모델을 학습한다.",
  "보상과 벌을 통해 최적 행동을 학습한다.",
  "연속적인 숫자 값을 예측하거나 정해진 카테고리로 분류한다.",
  "데이터의 숨겨진 구조나 패턴을 찾는다."
]

c.execute(
  'INSERT INTO questions (subject, question_text, question_type, options, model_answer, keywords_full_credit, keywords_partial_credit) VALUES (?,?,?,?,?,?,?)',
  (
    'AI',
    '지도학습(supervised learning)의 특징은?',
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

## Python 예시(대안: JSON 컬럼 사용 시)
- SQLAlchemy 등에서 `JSON` 컬럼을 사용한다면 리스트를 그대로 저장합니다.
- 문자열로 한 번 더 `json.dumps()`하여 이중 인코딩하지 마세요.

## Gemini 프롬프트 템플릿(요약)
- “SQLite DB를 생성하고 `prob_db/AI_prob.db`에 저장. `questions` 테이블을 만들고 아래 규칙을 지켜 INSERT를 생성한다.
  - UTF-8 사용, 작은따옴표 금지, JSON은 큰따옴표만 사용.
  - 객관식은 `options`를 JSON 배열 문자열로(TEXT) 저장하고, `model_answer`는 그중 하나와 완전 일치.
  - 비객관식은 `options`를 NULL 또는 빈 배열로 처리.
  - `keywords_*`는 JSON 배열 문자열(`[]`)로 저장.”

---
이 규칙을 따르면 LLM이 생성한 DB도 세트 선택부터 문제 로딩/채점까지 안전하게 동작합니다.

