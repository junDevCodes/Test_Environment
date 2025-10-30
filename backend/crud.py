
from sqlalchemy.orm import Session
from backend import models, schemas

def get_questions_by_subject(db: Session, subject: str):
    return db.query(models.Question).filter(models.Question.subject == subject).all()

def create_question(db: Session, question: schemas.QuestionCreate):
    db_question = models.Question(**question.dict())
    db.add(db_question)
    db.commit()
    db.refresh(db_question)
    return db_question

def init_db(db: Session):
    # Check if there is already data
    if db.query(models.Question).count() > 0:
        return

    dummy_questions = [
        schemas.QuestionCreate(
            subject="Data Analysis (EDA)",
            question_text="What is the pandas function to read a CSV file?",
            question_type='multiple_choice',
            options=['read_csv', 'open_csv', 'load_csv', 'read_file'],
            model_answer='read_csv',
            keywords_full_credit=['read_csv']
        ),
        schemas.QuestionCreate(
            subject="Data Analysis (EDA)",
            question_text="In pandas, what is the method to show the first 5 rows of a DataFrame?",
            question_type='short_answer',
            model_answer='head()',
            keywords_full_credit=['head']
        ),
        schemas.QuestionCreate(
            subject="Data Analysis (EDA)",
            question_text="What is the purpose of Exploratory Data Analysis (EDA)?",
            question_type='descriptive',
            model_answer="EDA is the process of analyzing datasets to summarize their main characteristics, often with visual methods. It is used to see what the data can tell us before we start formal modeling.",
            keywords_full_credit=['analyzing', 'summarize', 'characteristics', 'visual'],
            keywords_partial_credit=['data', 'summary', 'visualize']
        ),
        schemas.QuestionCreate(
            subject="Data Analysis (EDA)",
            question_text="Given a pandas DataFrame named `df` with a column 'age', write the code to select all rows where age is greater than 30.",
            question_type='coding',
            model_answer="df[df['age'] > 30]",
            keywords_full_credit=["df", "[", "age", ">", "30", "]"]
        ),
    ]

    for q in dummy_questions:
        create_question(db, q)
