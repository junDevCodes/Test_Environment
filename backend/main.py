
import os
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List

from backend import crud, models, schemas
from backend.database import SessionLocal, engine
from backend.llm import grade_with_gemini

# Create all tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _grade_answer(question: models.Question, user_answer_raw: str, gemini_api_key: str | None = None) -> tuple[bool, float]:
    is_correct = False
    score = 0.0
    # Prefer Gemini for short/descriptive if key provided
    if gemini_api_key and question.question_type in {"short_answer", "descriptive"}:
        result = grade_with_gemini(
            question_text=question.question_text,
            model_answer=question.model_answer or "",
            user_answer=user_answer_raw,
            api_key=gemini_api_key,
        )
        if result is not None:
            is_correct, score, _reason = result
            return is_correct, score
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

    return is_correct, score

@app.on_event("startup")
def on_startup():
    # Create a new DB session
    db = SessionLocal()
    # Initialize DB with dummy data
    crud.init_db(db)
    db.close()
    # Set ephemeral Gemini key from environment if present
    app.state.gemini_api_key = os.environ.get("GEMINI_API_KEY")

@app.get("/api/questions/{subject}", response_model=List[schemas.Question])
def read_questions(subject: str, db: Session = Depends(get_db)):
    questions = crud.get_questions_by_subject(db, subject=subject)
    return questions

@app.post("/api/submit", response_model=List[schemas.AnswerResult])
def submit_answers(answers: List[schemas.UserAnswer], db: Session = Depends(get_db)):
    results = []
    for user_answer in answers:
        question = db.query(models.Question).filter(models.Question.id == user_answer.question_id).first()
        if not question:
            raise HTTPException(status_code=404, detail=f"Question with id {user_answer.question_id} not found")

        is_correct, score = _grade_answer(question, user_answer.answer, getattr(app.state, "gemini_api_key", None))

        results.append(schemas.AnswerResult(
            question_id=user_answer.question_id,
            is_correct=is_correct,
            score=score,
            model_answer=question.model_answer
        ))
    return results

@app.post("/api/check-answer", response_model=schemas.AnswerResult)
def check_answer(payload: schemas.UserAnswer, db: Session = Depends(get_db)):
    question = db.query(models.Question).filter(models.Question.id == payload.question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail=f"Question with id {payload.question_id} not found")

    is_correct, score = _grade_answer(question, payload.answer, getattr(app.state, "gemini_api_key", None))
    return schemas.AnswerResult(
        question_id=payload.question_id,
        is_correct=is_correct,
        score=score,
        model_answer=question.model_answer
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
