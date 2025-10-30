from sqlalchemy import Column, Integer, String, JSON
from app.database import Base

class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    subject = Column(String, index=True)
    question_text = Column(String, index=True)
    question_type = Column(String, index=True)  # 'multiple_choice', 'short_answer', 'descriptive', 'coding'
    options = Column(JSON)  # For multiple_choice
    model_answer = Column(String)
    keywords_full_credit = Column(JSON)
    keywords_partial_credit = Column(JSON)
