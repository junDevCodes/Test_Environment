import os
import json
import logging
from typing import List

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text

from backend import crud, models, schemas
from backend.database import SessionLocal, engine, get_session_local_for_set
from backend.llm import grade_with_gemini


# Create all tables for default engine
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Basic debug logger (stdout). Quiet by default.
logger = logging.getLogger("backend")
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter('[%(levelname)s] %(message)s'))
    logger.addHandler(_h)
logger.setLevel(logging.INFO)

# CORS Middleware
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


# Dependency to get DB session (supports per-request DB set via header)
def get_db(request: Request):
    db_set = request.headers.get("X-DB-SET")
    SessionMaker = get_session_local_for_set(db_set)
    db = SessionMaker()
    # Ensure tables exist for selected set to avoid 'no such table'
    try:
        if db_set:
            models.Base.metadata.create_all(bind=db.get_bind())
    except Exception:
        pass
    try:
        yield db
    finally:
        db.close()


def _grade_answer(
    question: models.Question,
    user_answer_raw: str,
    gemini_api_key: str | None = None,
) -> tuple[bool, float, str | None]:
    is_correct = False
    score = 0.0
    explanation: str | None = None
    # Prefer Gemini for short/descriptive if key provided
    if gemini_api_key and question.question_type in {"short_answer", "descriptive"}:
        result = grade_with_gemini(
            question_text=question.question_text,
            model_answer=question.model_answer or "",
            user_answer=user_answer_raw,
            api_key=gemini_api_key,
        )
        if result is not None:
            is_correct, score, reason = result
            explanation = reason
            return is_correct, score, explanation
    # Simple tokenization: lowercase and split, remove common brackets
    user_ans_tokens = set(
        user_answer_raw.lower()
        .replace("(", "")
        .replace(")", "")
        .replace("[", "")
        .replace("]", "")
        .split()
    )

    if question.question_type == 'multiple_choice':
        if user_answer_raw == question.model_answer:
            is_correct = True
            score = 1.0
    else:
        full_credit_keywords = set(question.keywords_full_credit or [])
        partial_credit_keywords = set(question.keywords_partial_credit or [])

        matched_full = len(full_credit_keywords.intersection(user_ans_tokens))
        matched_partial = len(partial_credit_keywords.intersection(user_ans_tokens))

        if full_credit_keywords and matched_full == len(full_credit_keywords):
            is_correct = True
            score = 1.0
        elif matched_full > 0 or matched_partial > 0:
            # Simple scoring logic: 50% for any partial match, more for more matches
            score = min(0.9, (matched_full * 0.5) + (matched_partial * 0.2))

        if score > 0.8:  # Consider it correct if score is high
            is_correct = True

    return is_correct, score, explanation


def _to_list(value):
    def _unesc(s: str) -> str:
        t = s.strip()
        # strip surrounding quotes if present
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
        # 1) strict JSON
        try:
            v = json.loads(s)
            if isinstance(v, list):
                # unwrap pattern: ["[\"a\",\"b\"]"]
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
        # 2) strip surrounding quotes then JSON
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            inner = s[1:-1]
            try:
                v3 = json.loads(inner)
                if isinstance(v3, list):
                    return [_unesc(x) if isinstance(x, str) else x for x in v3]
            except Exception:
                pass
        # 3) single-quote JSON to double-quote
        try:
            s2 = s.replace("'", '"')
            v2 = json.loads(s2)
            if isinstance(v2, list):
                return [_unesc(x) if isinstance(x, str) else x for x in v2]
        except Exception:
            pass
        # 4) fallback: comma-separated string
        if s.startswith('[') and s.endswith(']'):
            s = s[1:-1]
        parts = [p.strip().strip('"').strip("'") for p in s.split(',') if p.strip()]
        return [_unesc(x) for x in parts]
    return []


@app.on_event("startup")
def on_startup():
    # Create a new DB session
    db = SessionLocal()
    # Initialize DB with dummy data
    crud.init_db(db)
    db.close()
    # Set ephemeral Gemini key from environment if present
    app.state.gemini_api_key = os.environ.get("GEMINI_API_KEY")


@app.get("/api/sets", response_model=List[schemas.ProblemSet])
def list_sets():
    sets: list[schemas.ProblemSet] = []
    project_root = os.path.normpath(os.path.join(os.path.dirname(__file__), os.pardir))
    base = os.path.join(project_root, "prob_db")
    if os.path.isdir(base):
        for name in os.listdir(base):
            if name.lower().endswith(".db"):
                sets.append(schemas.ProblemSet(name=name))
    return sets


@app.get("/api/questions/{subject}", response_model=List[schemas.Question])
def read_questions(subject: str, request: Request, db: Session = Depends(get_db)):
    subj = subject
    # Always use raw SQL and normalize list-like fields for robust decoding across DB sets
    try:
        sql = "SELECT * FROM questions" if subj.lower() in {"all", "*"} else "SELECT * FROM questions WHERE subject = :subject"
        params = {} if subj.lower() in {"all", "*"} else {"subject": subj}
        result = db.execute(text(sql), params)
        rows = []
        for row in result:
            m = row._mapping
            # Normalize list-like fields and log anomalies for troubleshooting
            raw_opt = m.get('options')
            raw_kf = m.get('keywords_full_credit')
            raw_kp = m.get('keywords_partial_credit')
            norm_opt = _to_list(raw_opt)
            norm_kf = _to_list(raw_kf)
            norm_kp = _to_list(raw_kp)
            try:
                if isinstance(raw_opt, str) and raw_opt.strip() and not norm_opt:
                    logger.debug(f"options parse empty id={m.get('id')} subject={m.get('subject')}")
                if isinstance(raw_kf, str) and raw_kf.strip() and not norm_kf:
                    logger.debug(f"keywords_full_credit parse empty id={m.get('id')} subject={m.get('subject')}")
                if isinstance(raw_kp, str) and raw_kp.strip() and not norm_kp:
                    logger.debug(f"keywords_partial_credit parse empty id={m.get('id')} subject={m.get('subject')}")
            except Exception:
                pass
            rows.append(schemas.Question(
                id=m.get('id'),
                subject=m.get('subject') or '',
                question_text=m.get('question_text') or '',
                question_type=m.get('question_type') or 'multiple_choice',
                options=norm_opt,
                model_answer=m.get('model_answer') or '',
                keywords_full_credit=norm_kf,
                keywords_partial_credit=norm_kp,
            ))
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read questions: {e}")


@app.post("/api/submit", response_model=List[schemas.AnswerResult])
def submit_answers(answers: List[schemas.UserAnswer], db: Session = Depends(get_db)):
    results = []
    for user_answer in answers:
        question = db.query(models.Question).filter(models.Question.id == user_answer.question_id).first()
        if not question:
            raise HTTPException(status_code=404, detail=f"Question with id {user_answer.question_id} not found")

        is_correct, score, explanation = _grade_answer(
            question, user_answer.answer, getattr(app.state, "gemini_api_key", None)
        )

        results.append(schemas.AnswerResult(
            question_id=user_answer.question_id,
            is_correct=is_correct,
            score=score,
            model_answer=question.model_answer,
            explanation=explanation
        ))
    return results


@app.post("/api/check-answer", response_model=schemas.AnswerResult)
def check_answer(payload: schemas.UserAnswer, db: Session = Depends(get_db)):
    question = db.query(models.Question).filter(models.Question.id == payload.question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail=f"Question with id {payload.question_id} not found")

    is_correct, score, explanation = _grade_answer(
        question, payload.answer, getattr(app.state, "gemini_api_key", None)
    )
    return schemas.AnswerResult(
        question_id=payload.question_id,
        is_correct=is_correct,
        score=score,
        model_answer=question.model_answer,
        explanation=explanation
    )


# --- Ephemeral Gemini Key Management ---
@app.get("/api/config/status", response_model=schemas.KeyStatus)
def get_config_status():
    return schemas.KeyStatus(gemini_key_set=bool(getattr(app.state, "gemini_api_key", None)))


@app.post("/api/config/gemini", response_model=schemas.KeyStatus)
def set_gemini_key(payload: schemas.GeminiKeyPayload):
    # Store only in memory (not persisted) for this process lifetime
    # Do NOT log the key
    app.state.gemini_api_key = payload.api_key.strip()
    return schemas.KeyStatus(gemini_key_set=True)


@app.post("/api/config/gemini/clear", response_model=schemas.KeyStatus)
def clear_gemini_key():
    app.state.gemini_api_key = None
    return schemas.KeyStatus(gemini_key_set=False)
