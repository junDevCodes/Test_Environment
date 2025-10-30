import os
import sqlite3
from pathlib import Path
from typing import Optional
from sqlalchemy.orm import declarative_base

Base = declarative_base()

# 프로젝트 루트에서 storage 디렉토리 찾기
# (app/database.py 기준으로 ../storage)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", PROJECT_ROOT / "storage"))

def get_db_path_for_subject(subject: str) -> Path:
    """
    subject -> storage/{subject}_prob.db
    예: subject='AI' -> storage/AI_prob.db
    """
    db_filename = f"{subject}_prob.db"
    return STORAGE_DIR / db_filename

def open_sqlite_connection(subject: str) -> sqlite3.Connection:
    """
    sqlite3 커넥션을 열어주고 row를 dict 스타일로 다룰 수 있게 row_factory를 세팅한다.
    FastAPI 라우트 안에서 사용하면 됨.
    """
    db_path = get_db_path_for_subject(subject)

    if not db_path.exists():
        # FastAPI 라우트에서 이걸 그대로 사용하면
        # HTTP 404로 변환해주는 쪽에서 처리 가능
        raise FileNotFoundError(f"DB for subject '{subject}' not found: {db_path}")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn