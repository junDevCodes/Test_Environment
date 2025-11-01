import os
import json
import logging
import sqlite3
from pathlib import Path
from typing import List, Tuple, Optional, Union

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from db_builder.db_generator import build_all_subject_dbs
from db_builder.validator import validate_db
import glob
from app.database import STORAGE_DIR
from app.llm import grade_with_gemini
from app import schemas


# -------------------------------------------------
# Logger 설정
# -------------------------------------------------
logger = logging.getLogger("app")
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter('[%(levelname)s] %(message)s'))
    logger.addHandler(_h)
logger.setLevel(logging.INFO)


# -------------------------------------------------
# FastAPI 앱 / CORS / UTF-8 미들웨어
# -------------------------------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://test-environment-eight.vercel.app/",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def ensure_utf8_json(request: Request, call_next):
    """
    모든 JSON 응답에 charset=utf-8을 붙여서 브라우저가 Latin-1로 잘못 디코딩하지 않게 방지
    """
    response = await call_next(request)
    try:
        ct = response.headers.get("content-type", "")
        if ct.startswith("application/json") and "charset" not in ct.lower():
            response.headers["content-type"] = "application/json; charset=utf-8"
    except Exception:
        pass
    return response


# -------------------------------------------------
# 파싱/채점 유틸
# -------------------------------------------------
def _normalize_list_field(value) -> list[str]:
    """
    DB TEXT(JSON) 필드 → Python list 복원 (한글 깨짐 방지용 단순화 버전)
    """
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        # 기본: JSON 배열이면 그대로 반환
        try:
            v = json.loads(s)
            if isinstance(v, list):
                return [x if isinstance(x, str) else str(x) for x in v]
        except json.JSONDecodeError:
            pass
        # 대체: 쉼표 분리
        if s.startswith('[') and s.endswith(']'):
            s = s[1:-1]
        parts = [p.strip().strip('"').strip("'") for p in s.split(',') if p.strip()]
        return parts
    return []



def _grade_answer(
    question_row: dict,
    user_answer_raw: str,
    gemini_api_key: Optional[str] = None,
) -> Tuple[bool, float, Optional[str]]:
    """
    채점 로직:
    - 객관식: model_answer 문자열과 일치 여부
    - 서술형: keywords_full_credit / partial 기반 스코어
    - (옵션) Gemini 사용 가능 시 LLM 채점
    """
    q_type = question_row.get("question_type", "multiple_choice")
    model_answer = question_row.get("model_answer") or ""
    full_kw = question_row.get("keywords_full_credit", [])
    part_kw = question_row.get("keywords_partial_credit", [])

    # LLM 채점(서술형 계열만)
    if gemini_api_key and q_type in {"short_answer", "descriptive"}:
        result = grade_with_gemini(
            question_text=question_row.get("question_text", ""),
            model_answer=model_answer,
            user_answer=user_answer_raw,
            api_key=gemini_api_key,
        )
        if result is not None:
            is_correct, score, reason = result
            return is_correct, score, reason

    # 기본 채점
    is_correct = False
    score = 0.0
    explanation = None

    if q_type == "multiple_choice":
        if user_answer_raw == model_answer:
            is_correct = True
            score = 1.0
    else:
        user_ans_tokens = set(
            user_answer_raw.lower()
            .replace("(", "")
            .replace(")", "")
            .replace("[", "")
            .replace("]", "")
            .split()
        )

        full_set = set(full_kw or [])
        part_set = set(part_kw or [])

        matched_full = len(full_set.intersection(user_ans_tokens))
        matched_part = len(part_set.intersection(user_ans_tokens))

        if full_set and matched_full == len(full_set):
            is_correct = True
            score = 1.0
        elif matched_full > 0 or matched_part > 0:
            score = min(0.9, (matched_full * 0.5) + (matched_part * 0.2))

        if score > 0.8:
            is_correct = True

    return is_correct, score, explanation


def _row_to_question_schema(row) -> schemas.Question:
    """
    sqlite3.Row -> schemas.Question
    (options, keywords_* 는 TEXT(JSON) 필드를 리스트로 복원)
    """
    m = dict(row)
    norm_opt = _normalize_list_field(m.get("options"))
    norm_kf = _normalize_list_field(m.get("keywords_full_credit"))
    norm_kp = _normalize_list_field(m.get("keywords_partial_credit"))

    return schemas.Question(
        id=m.get("id"),
        subject=m.get("subject") or "",
        question_text=m.get("question_text") or "",
        question_type=m.get("question_type") or "multiple_choice",
        options=norm_opt,
        model_answer=m.get("model_answer") or "",
        keywords_full_credit=norm_kf,
        keywords_partial_credit=norm_kp,
    )

def _open_conn_by_set(db_set: str) -> sqlite3.Connection:
    db_path = STORAGE_DIR / db_set
    if not db_path.exists():
        raise FileNotFoundError(f"DB set '{db_set}' not found")
    conn = sqlite3.connect(os.fspath(db_path))
    conn.row_factory = sqlite3.Row
    conn.text_factory = str
    return conn

def _fetch_question_by_id(db_set: str, q_id: int) -> Optional[dict]:
    """
    storage/<db_set> 안의 questions 테이블에서 특정 id의 문제 한 개 가져와서
    dict로 리턴. 리스트 필드(options, keywords_*)는 파싱해서 넣어줌.
    못 찾으면 None.
    """
    conn = _open_conn_by_set(db_set)
    cur = conn.cursor()
    cur.execute("SELECT * FROM questions WHERE id = ?", (q_id,))
    row = cur.fetchone()
    conn.close()

    if not row:
        return None

    m = dict(row)
    m["options"] = _normalize_list_field(m.get("options"))
    m["keywords_full_credit"] = _normalize_list_field(m.get("keywords_full_credit"))
    m["keywords_partial_credit"] = _normalize_list_field(m.get("keywords_partial_credit"))
    return m

def _prepare_db_on_startup():
    """
    1. storage/*.db 없으면 data 기반으로 DB 새로 생성
    2. 모든 생성된 DB를 validator로 검증
    3. 하나라도 유효하지 않으면 예외를 던져서 서버 기동을 중단
    """
    project_root = Path(__file__).resolve().parents[1]
    storage_dir = project_root / "storage"
    data_dir = project_root / "data"

    storage_dir.mkdir(parents=True, exist_ok=True)

    # 1) DB 없으면 자동 생성
    has_db = list(storage_dir.glob("*.db"))
    if not has_db:
        logging.info("[startup] no DB found under storage/. building now ...")
        build_all_subject_dbs()
    else:
        logging.info("[startup] DB already exists under storage/. skipping build")

    # 2) 생성/존재하는 DB 전체 검증
    problems = []
    for db_path in storage_dir.glob("*.db"):
        try:
            validate_db(db_path)
            logging.info(f"[startup] validated OK: {db_path.name}")
        except Exception as e:
            logging.error(f"[startup] DB validation failed for {db_path.name}: {e}")
            problems.append((db_path.name, str(e)))

    # 3) 문제가 있으면 서버 띄우지 말고 중단
    if problems:
        details = "\n".join([f"- {name}: {msg}" for name, msg in problems])
        raise RuntimeError("DB validation failed on startup:\n" + details)


# -------------------------------------------------
# 기동 시 처리
# -------------------------------------------------
@app.on_event("startup")
def on_startup():
    # 메모리에 Gemini 키(있으면) 저장
    app.state.gemini_api_key = os.environ.get("GEMINI_API_KEY")
    _prepare_db_on_startup()



# -------------------------------------------------
# API 라우팅
# -------------------------------------------------

@app.get("/api/sets", response_model=List[schemas.ProblemSet])
def list_sets():
    """
    storage 폴더의 DB 파일 목록을 세트 이름으로 반환.
    예) AI_prob.db, Python_prob.db
    """
    sets: List[schemas.ProblemSet] = []
    if STORAGE_DIR.exists():
        for path in STORAGE_DIR.iterdir():
            if path.is_file() and path.suffix.lower() == ".db":
                sets.append(schemas.ProblemSet(name=path.name))
    return sets


@app.get("/api/questions/{subject}", response_model=List[schemas.Question])
def read_questions(subject: str, request: Request):
    """
    선택된 세트(DB 파일)에서 문제 목록을 반환.
    - 헤더 `X-DB-SET: <파일명>` 필수
    - 경로 파라미터 `subject`가 'all'/* 이면 전체, 아니면 subject 컬럼으로 필터
    """
    db_set = request.headers.get("X-DB-SET")
    if not db_set:
        raise HTTPException(
            status_code=400,
            detail="X-DB-SET 헤더가 필요합니다. 예) X-DB-SET: AI_prob.db",
        )

    try:
        conn = _open_conn_by_set(db_set)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"DB set '{db_set}' not found")

    cur = conn.cursor()
    if subject.lower() in {"all", "*"}:
        cur.execute("SELECT * FROM questions")
    else:
        cur.execute("SELECT * FROM questions WHERE subject = ?", (subject,))
    rows_raw = cur.fetchall()
    conn.close()

    rows = [_row_to_question_schema(r) for r in rows_raw]
    return rows


@app.post("/api/submit/{subject}", response_model=List[schemas.AnswerResult])
def submit_answers(subject: str, answers: Union[List[schemas.UserAnswer], schemas.UserAnswer], request: Request):
    """
    여러 문제에 대한 답안을 한 번에 제출 → 채점 결과 리스트 반환.
    """
    db_set = request.headers.get("X-DB-SET")
    if not db_set:
        raise HTTPException(status_code=400, detail="X-DB-SET 헤더가 필요합니다. 예) X-DB-SET: AI_prob.db")

    # 단일 객체(JSON)도 자동으로 리스트로 처리
    payloads: List[schemas.UserAnswer] = answers if isinstance(answers, list) else [answers]

    results = []
    for user_answer in payloads:
        q = _fetch_question_by_id(db_set, user_answer.question_id)
        if not q:
            raise HTTPException(status_code=404, detail=f"Question {user_answer.question_id} not found in set '{db_set}'")

        is_correct, score, explanation = _grade_answer(
            q,
            user_answer.answer,
            getattr(app.state, "gemini_api_key", None),
        )

        results.append(schemas.AnswerResult(
            question_id=user_answer.question_id,
            is_correct=is_correct,
            score=score,
            model_answer=q.get("model_answer", ""),
            explanation=explanation,
        ))

    return results


@app.post("/api/check-answer/{subject}", response_model=schemas.AnswerResult)
def check_answer(subject: str, payload: schemas.UserAnswer, request: Request):
    """
    단일 문항 즉시 채점.
    """
    db_set = request.headers.get("X-DB-SET")
    if not db_set:
        raise HTTPException(status_code=400, detail="X-DB-SET 헤더가 필요합니다. 예) X-DB-SET: AI_prob.db")

    q = _fetch_question_by_id(db_set, payload.question_id)
    if not q:
        raise HTTPException(status_code=404, detail=f"Question {payload.question_id} not found in set '{db_set}'")

    is_correct, score, explanation = _grade_answer(
        q,
        payload.answer,
        getattr(app.state, "gemini_api_key", None),
    )

    return schemas.AnswerResult(
        question_id=payload.question_id,
        is_correct=is_correct,
        score=score,
        model_answer=q.get("model_answer", ""),
        explanation=explanation,
    )

# ---- Docstrings (runtime override for examples) ----
submit_answers.__doc__ = (
    """
    여러 문제에 대한 사용자의 답안을 한 번에 제출 후 채점 결과 리스트 반환.

    사용 예시
    - PowerShell (다건/배열):
      Invoke-RestMethod -Uri http://localhost:8000/api/submit/all -Method POST -Headers @{ 'X-DB-SET'='AI_prob.db' } -Body '[{"question_id":31,"answer":"오답"}]' -ContentType 'application/json'
    - PowerShell (단건/객체 허용):
      Invoke-RestMethod -Uri http://localhost:8000/api/submit/all -Method POST -Headers @{ 'X-DB-SET'='AI_prob.db' } -Body '{"question_id":31,"answer":"오답"}' -ContentType 'application/json'
    - curl (배열 권장):
      curl -H "X-DB-SET: AI_prob.db" -H "Content-Type: application/json" \
           -d '[{"question_id":31,"answer":"오답"}]' \
           http://localhost:8000/api/submit/all
    """
)

check_answer.__doc__ = (
    """
    단일 문항 즉시 채점.

    사용 예시
    - PowerShell:
      Invoke-RestMethod -Uri http://localhost:8000/api/check-answer/all -Method POST -Headers @{ 'X-DB-SET'='AI_prob.db' } -Body '{"question_id":31,"answer":"정답"}' -ContentType 'application/json'
    - curl:
      curl -H "X-DB-SET: AI_prob.db" -H "Content-Type: application/json" \
           -d '{"question_id":31,"answer":"정답"}' \
           http://localhost:8000/api/check-answer/all
    """
)


# --- Gemini key mgmt (in-memory only) ---
@app.get("/api/config/status", response_model=schemas.KeyStatus)
def get_config_status():
    return schemas.KeyStatus(gemini_key_set=bool(getattr(app.state, "gemini_api_key", None)))


@app.post("/api/config/gemini", response_model=schemas.KeyStatus)
def set_gemini_key(payload: schemas.GeminiKeyPayload):
    app.state.gemini_api_key = payload.api_key.strip()
    return schemas.KeyStatus(gemini_key_set=True)


@app.post("/api/config/gemini/clear", response_model=schemas.KeyStatus)
def clear_gemini_key():
    app.state.gemini_api_key = None
    return schemas.KeyStatus(gemini_key_set=False)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)