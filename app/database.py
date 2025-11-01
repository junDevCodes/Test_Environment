import os
import sqlite3
from pathlib import Path
from typing import Optional, Dict
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy import create_engine

Base = declarative_base()

# 프로젝트 루트에서 storage 디렉토리 찾기
# (app/database.py 기준으로 ../storage)
BASE_DIR  = Path(__file__).resolve().parents[1]
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", BASE_DIR  / "storage"))

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

# --- SQLAlchemy per-set session factory (for storage/*.db) ---
_ENGINE_CACHE: Dict[str, any] = {}
_SESSION_CACHE: Dict[str, sessionmaker] = {}

def _engine_for_path(db_path: Path):
    key = str(db_path.resolve())
    eng = _ENGINE_CACHE.get(key)
    if eng is None:
        eng = create_engine(
            f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
        )
        _ENGINE_CACHE[key] = eng
    return eng

def get_session_local_for_set(db_set: Optional[str]) -> sessionmaker:
    """
    Returns a sessionmaker bound to the selected DB set file under storage/.
    If db_set is None or not found, returns a fallback in-memory sessionmaker.
    """
    if db_set:
        path = STORAGE_DIR / db_set
        if not path.exists():
            raise FileNotFoundError(f"DB set not found: {path}")
        key = str(path.resolve())
        sess = _SESSION_CACHE.get(key)
        if sess is None:
            sess = sessionmaker(autocommit=False, autoflush=False, bind=_engine_for_path(path))
            _SESSION_CACHE[key] = sess
        return sess
    # Fallback: ephemeral in-memory engine
    fallback_engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    return sessionmaker(autocommit=False, autoflush=False, bind=fallback_engine)
