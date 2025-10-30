import json
import sqlite3
from pathlib import Path
import re
from collections import defaultdict

BASE_DIR = Path(__file__).resolve().parent[1]
DATA_DIR = BASE_DIR / "data"
DB_DIR = BASE_DIR / "storage"

# 파일명 규칙: {subject}_questions_{source}.json
#   AI_questions_theory.json  -> subject="AI",     source="theory"
#   Python_questions_practice.json -> subject="Python", source="practice"
FILENAME_PATTERN = re.compile(
    r"(?P<subject>[A-Za-z0-9가-힣]+)_questions_(?P<source>[A-Za-z]+)\.json"
)

ALLOWED_TYPES = {"multiple_choice", "short_answer", "descriptive", "coding"}

def load_questions_from_file(path: Path):
    """
    JSON 하나 로드해서 리스트 반환
    - NEW: utf-8-sig로 읽어서 BOM 있어도 안전
    """
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)

def ensure_json_str(value):
    """
    리스트(보기, 키워드 등)를 TEXT 컬럼에 안전하게 넣기 위한 직렬화
    ensure_ascii=False -> 한글 그대로 저장
    """
    return json.dumps(value, ensure_ascii=False)

def validate_question(q, subject, source):
    """
    Codex 피드백 기반 최소 유효성 검증
    - question_type 값 검증
    - 텍스트에 모지바케(�) 있는지 체크
    - multiple_choice일 때 options 구조 확인
    """

    # 1) 필수 필드 존재 여부
    required_fields = [
        "id",
        "question_text",
        "question_type",
        "model_answer",
    ]
    for field in required_fields:
        if field not in q:
            raise ValueError(f"[{subject}/{source}] id?={q.get('id')} 필드 누락: {field}")

    # 2) question_type 유효성
    qt = q["question_type"]
    if qt not in ALLOWED_TYPES:
        raise ValueError(
            f"[{subject}/{source}] id={q['id']} invalid question_type: {qt}"
        )

    # 3) multiple_choice일 때 options 유효성
    opts = q.get("options", [])
    if qt == "multiple_choice":
        if not isinstance(opts, list) or len(opts) == 0:
            raise ValueError(
                f"[{subject}/{source}] id={q['id']} 객관식인데 options 비었음"
            )
        # Codex는 model_answer ∈ options를 권장했는데
        # 우리는 해설형 model_answer도 쓰니까 강제는 안 하고 경고만 찍자.
        if q.get("model_answer", None) not in opts:
            # 경고만 (막지는 않음)
            print(
                f"[warn] id={q['id']} 객관식인데 model_answer가 options 안에 없음 (해설형이면 무시 가능)"
            )
    else:
        # 객관식이 아닌데 options가 쓸데없이 찼으면 경고만
        if isinstance(opts, list) and len(opts) > 0:
            print(
                f"[warn] id={q['id']} type={qt}인데 options가 존재함 (필요한 케이스인지 확인)"
            )

    # 4) 한글 깨짐(�) 탐지
    text_fields = []
    text_fields.append(q.get("question_text", ""))
    text_fields.append(q.get("model_answer", ""))
    # options 안도 문자열들이라면 다 확인
    if isinstance(opts, list):
        text_fields.extend([o for o in opts if isinstance(o, str)])

    for txt in text_fields:
        if isinstance(txt, str) and "�" in txt:
            raise ValueError(
                f"[{subject}/{source}] id={q['id']} 텍스트에 깨진 글자(�) 감지됨. JSON 원본 인코딩 확인 필요."
            )

    # 통과하면 True
    return True

def create_schema(conn: sqlite3.Connection):
    """
    과목별 DB 안에 questions 테이블 생성
    Codex가 권장한 컬럼: subject, source 포함
    """
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
    """
    rows: 이미 subject/source 필드가 주입된 문제 목록
    """
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
    전체 빌드 플로우:
    1. data 디렉토리 스캔
    2. 파일명으로 subject/source 추출
    3. subject별로 문제 모으기
    4. subject마다 {subject}_prob.db 새로 생성 (전체 재빌드)
    """
    DB_DIR.mkdir(parents=True, exist_ok=True)

    # 1) data 디렉토리를 스캔해서
    #    subject별로 문제를 모아서 버킷에 쌓는다.
    #    bucket["AI"] = [모든 AI 문제들...]
    #    bucket["Python"] = [모든 Python 문제들...]
    subject_bucket = defaultdict(list)

    for file_path in DATA_DIR.glob("*_questions_*.json"):
        m = FILENAME_PATTERN.match(file_path.name)
        if not m:
            print(f"패턴 불일치 (스킵): {file_path.name}")
            continue

        subject = m.group("subject")      # 예: "AI"
        source = m.group("source")        # 예: "theory" / "practice"

        questions_in_file = load_questions_from_file(file_path)

        # 이 파일 안의 문제들 각각에 subject/source 정보를 주입해서 버킷에 넣는다
        for q in questions_in_file:
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

    # 2) subject별로 각각 DB 생성
    for subject, q_list in subject_bucket.items():
        db_path = DB_DIR / f"{subject}_prob.db"

        # 기존 DB 있으면 삭제 후 재생성
        if db_path.exists():
            db_path.unlink()

        conn = sqlite3.connect(db_path)
        create_schema(conn)
        insert_questions(conn, q_list)
        conn.close()

        print(f"{subject}_prob.db 생성 완료 ({len(q_list)}문항) → {db_path}")

    print("\n 모든 과목 DB 생성 완료")

if __name__ == "__main__":
    build_all_subject_dbs()
