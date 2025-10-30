from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class QuestionBase(BaseModel):
    subject: str
    question_text: str
    question_type: str
    options: Optional[List[str]] = None
    model_answer: str
    keywords_full_credit: List[str] = Field(default_factory=list)
    keywords_partial_credit: List[str] = Field(default_factory=list)

class QuestionCreate(QuestionBase):
    pass

class Question(QuestionBase):
    id: int

    class Config:
        orm_mode = True

class UserAnswer(BaseModel):
    question_id: int
    answer: str

class AnswerResult(BaseModel):
    question_id: int
    is_correct: bool
    score: float # 0.0 to 1.0
    model_answer: str
    explanation: Optional[str] = None

class ProblemSet(BaseModel):
    name: str


# --- Admin/Config Schemas ---
class GeminiKeyPayload(BaseModel):
    api_key: str

class KeyStatus(BaseModel):
    gemini_key_set: bool
