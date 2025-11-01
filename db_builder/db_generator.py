import json
import os
import sqlite3
from pathlib import Path
import re
from collections import defaultdict

# Project root
BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DB_DIR = BASE_DIR / "storage"

# Supported filename rules (old + new):
#  A) {subject}_questions_{kind}.json                 e.g., AI_questions_theory.json
#  B) {subject}questions{kind}_{qtype}.json           e.g., AIquestionspractice_multiple_choice.json
FILENAME_PAT_A = re.compile(r"(?P<subject>[A-Za-z0-9_-]+)_questions_(?P<kind>[A-Za-z]+)\.json")
FILENAME_PAT_A2 = re.compile(r"(?P<subject>[A-Za-z0-9_-]+)_questions_(?P<kind>[A-Za-z]+)_(?P<qtype>[A-Za-z_]+)\.json")
FILENAME_PAT_B = re.compile(r"(?P<subject>[A-Za-z0-9_-]+)questions(?P<kind>[A-Za-z]+)_(?P<qtype>[A-Za-z_]+)\.json")

ALLOWED_TYPES = {"multiple_choice", "short_answer", "descriptive", "coding"}


def load_questions_from_file(path: Path):
    """
    Load JSON with utf-8-sig to tolerate BOM
    """
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def ensure_json_str(value):
    """
    Serialize Python list/values as JSON string for TEXT columns.
    ensure_ascii=False keeps non-ASCII characters intact.
    """
    return json.dumps(value, ensure_ascii=False)


def validate_question(q, db_subject: str, kind: str, qtype_hint: str | None = None):
    """
    Minimal validation for required fields, types, and basic encoding.
    """

    required_fields = [
        "question_text",
        "model_answer",
    ]
    for field in required_fields:
        if field not in q:
            raise ValueError(f"[{db_subject}/{kind}] id={q.get('id')} missing field: {field}")

    qt = q.get("question_type") or qtype_hint or "multiple_choice"
    if qt not in ALLOWED_TYPES:
        raise ValueError(f"[{db_subject}/{kind}] id={q.get('id')} invalid question_type: {qt}")

    opts = q.get("options", [])
    if qt == "multiple_choice":
        if not isinstance(opts, list) or len(opts) == 0:
            raise ValueError(f"[{db_subject}/{kind}] id={q.get('id')} multiple_choice requires non-empty options")
        if q.get("model_answer", None) not in opts:
            print(f"[warn] id={q.get('id')} model_answer not in options (warning)")
    else:
        if isinstance(opts, list) and len(opts) > 0:
            # Non-blocking: options present on non-MC
            pass

    text_fields = []
    text_fields.append(q.get("question_text", ""))
    text_fields.append(q.get("model_answer", ""))
    if isinstance(opts, list):
        text_fields.extend([o for o in opts if isinstance(o, str)])

    # Rough corruption check: replacement char
    for txt in text_fields:
        if isinstance(txt, str) and "\ufffd" in txt:
            raise ValueError(f"[{db_subject}/{kind}] id={q.get('id')} contains replacement character; fix encoding")

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


def _parse_fname(path: Path) -> tuple[str, str, str | None]:
    """
    Returns (db_subject, kind, qtype_hint) parsed from filename or directory.
    Fallbacks: parent directory as subject, kind='unknown', qtype_hint=None.
    """
    name = path.name
    m = FILENAME_PAT_A2.match(name)
    if m:
        return m.group("subject"), m.group("kind").lower(), m.group("qtype").lower()
    m = FILENAME_PAT_A.match(name)
    if m:
        return m.group("subject"), m.group("kind").lower(), None
    m = FILENAME_PAT_B.match(name)
    if m:
        return m.group("subject"), m.group("kind").lower(), m.group("qtype").lower()
    # Fallbacks
    db_subject = path.parent.name if path.parent and path.parent != DATA_DIR else path.stem.split("_")[0]
    return db_subject, "unknown", None


def build_all_subject_dbs():
    """
    - Scan data/*.json, bucket by subject
    - Build/replace storage/{subject}_prob.db
    """
    DB_DIR.mkdir(parents=True, exist_ok=True)

    subject_bucket: dict[str, list[dict]] = defaultdict(list)
    print(f"Scanning JSON files under {DATA_DIR} ...")

    for file_path in DATA_DIR.rglob("*.json"):
        db_subject, kind, qtype_hint = _parse_fname(file_path)

        try:
            questions_in_file = load_questions_from_file(file_path)
        except Exception as e:
            print(f"[error] failed to load {file_path}: {e}")
            continue

        if not isinstance(questions_in_file, list):
            print(f"[warn] {file_path.name} is not a list; wrapping as single-item list")
            questions_in_file = [questions_in_file]

        for q in questions_in_file:
            try:
                # Fill defaults before validation
                qtype = (q.get("question_type") or (qtype_hint or "multiple_choice")).lower()
                q["question_type"] = qtype
                if qtype in {"short_answer", "descriptive"}:
                    q.setdefault("keywords_full_credit", [])
                    q.setdefault("keywords_partial_credit", [])
                q.setdefault("options", [])
                q.setdefault("model_answer", "")

                validate_question(q, db_subject, kind, qtype_hint=qtype_hint)

                # Prepare normalized row (id assigned later)
                subject_text = q.get("subject") or ""
                subject_bucket[db_subject].append({
                    "id": q.get("id"),
                    "subject": subject_text,
                    "source": kind,
                    "question_text": q.get("question_text", ""),
                    "question_type": qtype,
                    "options": q.get("options", []),
                    "model_answer": q.get("model_answer", ""),
                    "keywords_full_credit": q.get("keywords_full_credit", []),
                    "keywords_partial_credit": q.get("keywords_partial_credit", []),
                })
            except Exception as e:
                print(f"[error] skip invalid item in {file_path.name}: {e}")

        print(f"loaded: {file_path.name} -> db_subject={db_subject}, kind={kind}, {len(questions_in_file)} items")

    for db_subject, q_list in subject_bucket.items():
        # Assign IDs (ensure unique, preserve valid ids when non-colliding)
        used: set[int] = set()
        for item in q_list:
            vid = item.get("id")
            if isinstance(vid, int) and vid > 0 and vid not in used:
                used.add(vid)
        next_id = 1
        for item in q_list:
            vid = item.get("id")
            if not (isinstance(vid, int) and vid > 0 and vid not in used):
                while next_id in used:
                    next_id += 1
                item["id"] = next_id
                used.add(next_id)
                next_id += 1

        db_path = DB_DIR / f"{db_subject}_prob.db"
        if db_path.exists():
            db_path.unlink()

        conn = sqlite3.connect(os.fspath(db_path))
        create_schema(conn)
        insert_questions(conn, q_list)
        conn.close()

        print(f"built: {db_path.name} ({len(q_list)} items) at {db_path}")

    print("\nAll subject DBs built.")


if __name__ == "__main__":
    build_all_subject_dbs()
