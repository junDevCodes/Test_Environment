
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from typing import Dict, Optional
import os

SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_engine_cache: Dict[str, any] = {}

def get_engine_for_set(db_set: Optional[str]):
    if not db_set:
        return engine
    # Build path under prob_db relative to project root (parent of this file's directory)
    project_root = os.path.normpath(os.path.join(os.path.dirname(__file__), os.pardir))
    base_dir = os.path.normpath(os.path.join(project_root, "prob_db"))
    db_name = db_set
    if not os.path.splitext(db_name)[1]:
        db_name = db_name + ".db"
    db_path = os.path.normpath(os.path.join(base_dir, db_name))
    # Ensure resolved path is inside prob_db
    if not os.path.commonpath([base_dir, db_path]) == base_dir:
        return engine
    # Build a SQLite URL safe for Windows (use forward slashes)
    url = "sqlite:///" + db_path.replace("\\", "/")
    if url in _engine_cache:
        return _engine_cache[url]
    eng = create_engine(url, connect_args={"check_same_thread": False})
    _engine_cache[url] = eng
    return eng

def get_session_local_for_set(db_set: Optional[str]):
    eng = get_engine_for_set(db_set)
    return sessionmaker(autocommit=False, autoflush=False, bind=eng)

Base = declarative_base()
