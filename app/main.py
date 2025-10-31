import os
import json
import logging
import sqlite3
from typing import List, Tuple, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app.database import get_db_path_for_subject, STORAGE_DIR
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
def _normalize_list_field(value) -> List[str]:
    """
    DB의 TEXT(으로 저장된 JSON 배열 문자열)를 Python list[str] 형태로 복원.
    관측된 변형들을 유연하게 파싱해 깨짐 방지.
    """
    def _unesc(s: str) -> str:
        t = s.strip()
        # 양끝 따옴표 제거
        if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
            t = t[1:-1]
        t = t.replace('\\"', '"').replace("\\'", "'")
        try:
            return t.encode('utf-8').decode('unicode_escape')
        except Exception:
            return t

    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        # 1) 우선 엄격한 JSON 시도
        try:
            v = json.loads(s)
            if isinstance(v, list):
                # ["[\"a\",\"b\"]"] 방어
                if len(v) == 1 and isinstance(v[0], str) and v[0].strip().startswith('['):
                    try:
                        inner_v = json.loads(v[0].strip())
                        if isinstance(inner_v, list):
                            return [_unesc(x) if isinstance(x, str) else x for x in inner_v]
                    except Exception:
                        pass
                return [_unesc(x) if isinstance(x, str) else x for x in v]
        except Exception:
            pass

        # 2) 바깥 따옴표 벗기고 JSON 시도
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            inner = s[1:-1]
            try:
                v3 = json.loads(inner)
                if isinstance(v3, list):
                    return [_unesc(x) if isinstance(x, str) else x for x in v3]
            except Exception:
                pass

        # 3) single-quote → double-quote 변환 시도
        try:
            s2 = s.replace("'", '"')
            v2 = json.loads(s2)
            if isinstance(v2, list):
                return [_unesc(x) if isinstance(x, str) else x for x in v2]
        except Exception:
            pass

        # 4) 마지막: 콤마 분리
        if s.startswith('[') and s.endswith(']'):
            s = s[1:-1]
        parts = [p.strip().strip('"').strip("'") for p in s.split(',') if p.strip()]
        return [_unesc(x) for x in parts]

    # 알 수 없는 타입은 빈 리스트
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
    return conn


# -------------------------------------------------
# 기동 시 처리
# -------------------------------------------------
@app.on_event("startup")
def on_startup():
    # 메모리에 Gemini 키(있으면) 저장
    app.state.gemini_api_key = os.environ.get("GEMINI_API_KEY")


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
        raise HTTPException(status_code=400, detail="X-DB-SET header required")

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
def submit_answers(subject: str, answers: List[schemas.UserAnswer], request: Request):
    """
    여러 문제에 대한 답안을 한 번에 제출 → 채점 결과 리스트 반환.
    """
    db_set = request.headers.get("X-DB-SET")
    if not db_set:
        raise HTTPException(status_code=400, detail="X-DB-SET header required")

    results = []
    for user_answer in answers:
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
        raise HTTPException(status_code=400, detail="X-DB-SET header required")

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

