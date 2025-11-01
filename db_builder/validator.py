import sqlite3
from pathlib import Path
import json

# storage/*.db 파일 일체를 검증하는 간단한 QA 스크립트
BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "storage"


def _json_loads_or_none(s: str):
    if s is None:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


def validate_db(db_path: Path):
    print(f"\n검증 대상: {db_path.name}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 테이블 확인
    cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [r["name"] for r in cur.fetchall()]
    if "questions" not in tables:
        raise ValueError(f"'questions' 테이블이 없습니다: {db_path.name}")

    # 개수 / ID 고유성
    cur.execute("SELECT COUNT(*) AS cnt, COUNT(DISTINCT id) AS dcnt FROM questions;")
    r0 = cur.fetchone()
    count = int(r0["cnt"])
    dcnt = int(r0["dcnt"])
    print(f"   - 총 {count}문항 (고유 id {dcnt})")
    if count != dcnt:
        raise ValueError("id 중복이 발견되었습니다 (COUNT != COUNT(DISTINCT id))")

    # UTF-8 깨짐 문자 샘플 검사
    cur.execute("SELECT id, question_text, model_answer FROM questions LIMIT 200;")
    for row in cur.fetchall():
        for col in ("question_text", "model_answer"):
            if row[col] and "�" in row[col]:
                raise ValueError(f"깨진 문자 발견 (id={row['id']}, col={col})")

    # JSON 필드 파싱 검사 + 유형별 제약
    cur.execute(
        "SELECT id, question_type, options, model_answer, keywords_full_credit, keywords_partial_credit FROM questions LIMIT 1000;"
    )
    rows = cur.fetchall()
    for row in rows:
        qid = row["id"]
        qtype = (row["question_type"] or "").lower()
        opts = _json_loads_or_none(row["options"]) if row["options"] is not None else []
        kfc = _json_loads_or_none(row["keywords_full_credit"]) if row["keywords_full_credit"] else []
        kpc = _json_loads_or_none(row["keywords_partial_credit"]) if row["keywords_partial_credit"] else []

        # options JSON 파싱 실패
        if row["options"] not in (None, "") and opts is None:
            raise ValueError(f"JSON 파싱 실패 (id={qid}, field=options)")

        # 유형별 검사
        if qtype == "multiple_choice":
            if not isinstance(opts, list) or len(opts) == 0:
                raise ValueError(f"객관식 문제의 options 비어있음/형식 오류 (id={qid})")
            if row["model_answer"] not in opts:
                raise ValueError(f"객관식 정답이 options에 없음 (id={qid})")
        elif qtype in ("short_answer", "descriptive"):
            # 기본 배열 존재 여부 (비어 있어도 허용)
            if not isinstance(kfc, list) or not isinstance(kpc, list):
                raise ValueError(f"서술/단답의 keywords_*가 배열 JSON이 아님 (id={qid})")

    print(f"-> {db_path.name} 검증 완료")
    conn.close()


def main():
    if not STORAGE_DIR.exists():
        print(f"storage 폴더가 없습니다: {STORAGE_DIR}")
        return

    db_files = list(STORAGE_DIR.glob("*.db"))
    if not db_files:
        print("검증할 DB가 없습니다.")
        return

    for db_path in db_files:
        validate_db(db_path)

    print("\n모든 DB 검증 완료!")


if __name__ == "__main__":
    main()

