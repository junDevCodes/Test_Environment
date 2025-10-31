import json
import sqlite3
from pathlib import Path
import re
from collections import defaultdict

# 프로젝트 루트: .../Test_Environment/
BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DB_DIR = BASE_DIR / "storage"

# 파일명 규칙: {subject}_questions_{source}.json
#   AI_questions_theory.json        -> subject="AI",     source="theory"
#   Python_questions_practice.json  -> subject="Python", source="practice"
FILENAME_PATTERN = re.compile(
    r"(?P<subject>[A-Za-z0-9가-힣_]+)_questions_(?P<source>[A-Za-z]+)\.json"
)

ALLOWED_TYPES = {"multiple_choice", "short_answer", "descriptive", "coding"}


def load_questions_from_file(path: Path):
    """
    JSON 파일을 로드해서 list[dict] 반환.
    - utf-8-sig 로딩으로 BOM 안전 처리
    """
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def ensure_json_str(value):
    """
    리스트/객체를 TEXT 컬럼에 저장할 수 있게 직렬화
    ensure_ascii=False -> 한글 그대로 저장
    """
    return json.dumps(value, ensure_ascii=False)


def validate_question(q, subject, source):
    """
    최소 유효성 검증:
    - 필수 필드 존재
    - question_type 검증
    - multiple_choice에서는 options 구조 확인
    - 간단한 텍스트 깨짐 탐지
    """

    required_fields = [
        "id",
        "question_text",
        "question_type",
        "model_answer",
    ]
    for field in required_fields:
        if field not in q:
            raise ValueError(f"[{subject}/{source}] id?={q.get('id')} 필드 누락: {field}")

    qt = q["question_type"]
    if qt not in ALLOWED_TYPES:
        raise ValueError(
            f"[{subject}/{source}] id={q['id']} invalid question_type: {qt}"
        )

    opts = q.get("options", [])
    if qt == "multiple_choice":
        if not isinstance(opts, list) or len(opts) == 0:
            raise ValueError(
                f"[{subject}/{source}] id={q['id']} 객관식인데 options 비어있음"
            )
        if q.get("model_answer", None) not in opts:
            print(
                f"[warn] id={q['id']} 객관식인데 model_answer가 options 내에 없음(경고)"
            )
    else:
        if isinstance(opts, list) and len(opts) > 0:
            print(
                f"[warn] id={q['id']} type={qt}인데 options가 존재(확인 필요)"
            )

    text_fields = []
    text_fields.append(q.get("question_text", ""))
    text_fields.append(q.get("model_answer", ""))
    if isinstance(opts, list):
        text_fields.extend([o for o in opts if isinstance(o, str)])

    for txt in text_fields:
        if isinstance(txt, str) and "�" in txt:
            raise ValueError(
                f"[{subject}/{source}] id={q['id']} 텍스트에 깨진 글자 감지: 원본 인코딩 확인 필요"
            )

    return True


def create_schema(conn: sqlite3.Connection):
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS questions;")
    cur.execute(
        """
        CREATE TABLE questions (
            id INTEGER PRIMARY KEY,
            subject TEXT NOT NULL,
            source TEXT NOT NULL,
            question_text TEXT NOT NULL,
            question_type TEXT NOT NULL,
            options TEXT NOT NULL,
            model_answer TEXT NOT NULL,
            keywords_full_credit TEXT,
            keywords_partial_credit TEXT
        );
        """
    )
    conn.commit()


def insert_questions(conn: sqlite3.Connection, rows: list[dict]):
    cur = conn.cursor()
    for q in rows:
        cur.execute(
            """
            INSERT INTO questions (
                id,
                subject,
                source,
                question_text,
                question_type,
                options,
                model_answer,
                keywords_full_credit,
                keywords_partial_credit
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (
                q["id"],
                q["subject"],
                q["source"],
                q["question_text"],
                q["question_type"],
                ensure_json_str(q.get("options", [])),
                q.get("model_answer", ""),
                ensure_json_str(q.get("keywords_full_credit", [])),
                ensure_json_str(q.get("keywords_partial_credit", [])),
            ),
        )
    conn.commit()


def build_all_subject_dbs():
    """
    1) data/*.json 스캔
    2) 파일명에서 subject/source 추출
    3) subject별로 문제를 모아 버킷 구성
    4) 각 subject마다 storage/{subject}_prob.db 생성(기존 것은 삭제 후 재생성)
    """
    DB_DIR.mkdir(parents=True, exist_ok=True)

    subject_bucket = defaultdict(list)

    for file_path in DATA_DIR.glob("*_questions_*.json"):
        m = FILENAME_PATTERN.match(file_path.name)
        if not m:
            print(f"패턴 불일치(스킵): {file_path.name}")
            continue

        subject = m.group("subject")
        source = m.group("source")

        questions_in_file = load_questions_from_file(file_path)
        for q in questions_in_file:
            validate_question(q, subject, source)
            subject_bucket[subject].append({
                "id": q["id"],
                "subject": subject,
                "source": source,
                "question_text": q["question_text"],
                "question_type": q["question_type"],
                "options": q.get("options", []),
                "model_answer": q.get("model_answer", ""),
                "keywords_full_credit": q.get("keywords_full_credit", []),
                "keywords_partial_credit": q.get("keywords_partial_credit", []),
            })

        print(f"{file_path.name} 로드 완료: subject={subject}, source={source}, {len(questions_in_file)}문항")

    for subject, q_list in subject_bucket.items():
        db_path = DB_DIR / f"{subject}_prob.db"
        if db_path.exists():
            db_path.unlink()

        conn = sqlite3.connect(os.fspath(db_path))
        create_schema(conn)
        insert_questions(conn, q_list)
        conn.close()

        print(f"{subject}_prob.db 생성 완료 ({len(q_list)}문항) → {db_path}")

    print("\n모든 과목 DB 생성 완료")


if __name__ == "__main__":
    build_all_subject_dbs()

