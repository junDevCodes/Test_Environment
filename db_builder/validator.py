import sqlite3
from pathlib import Path
import json

# storage/*.db 파일 전체를 검증하는 간단한 QA 스크립트
BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "storage"

def validate_db(db_path: Path):
    print(f"\n검증 중: {db_path.name}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 테이블 확인
    cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [r["name"] for r in cur.fetchall()]
    if "questions" not in tables:
        raise ValueError(f"'questions' 테이블이 없습니다: {db_path.name}")

    # 샘플 데이터 확인
    cur.execute("SELECT COUNT(*) AS cnt FROM questions;")
    count = cur.fetchone()["cnt"]
    print(f"   - 총 {count}문항")

    # UTF-8 깨짐 문자 검사
    cur.execute("SELECT id, question_text FROM questions LIMIT 50;")
    for row in cur.fetchall():
        if "�" in row["question_text"]:
            raise ValueError(f"깨진 텍스트 발견 (id={row['id']})")

    # JSON 필드 파싱 검사
    json_fields = ["options", "keywords_full_credit", "keywords_partial_credit"]
    cur.execute("SELECT id, " + ", ".join(json_fields) + " FROM questions LIMIT 50;")
    for row in cur.fetchall():
        for f in json_fields:
            try:
                if row[f]:
                    json.loads(row[f])
            except json.JSONDecodeError:
                raise ValueError(f"JSON 파싱 실패 (id={row['id']}, field={f})")

    print(f"✅ {db_path.name} 검증 완료")
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
