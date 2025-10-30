
import React from 'react';
import { useLocation, Link } from 'react-router-dom';

// Define types
interface Result {
    question_id: number;
    is_correct: boolean;
    score: number;
    model_answer: string;
    explanation?: string | null;
}

interface Question {
    id: number;
    question_text: string;
    question_type?: 'multiple_choice' | 'short_answer' | 'descriptive' | 'coding';
}

interface Answers {
    [key: number]: string;
}

const Results: React.FC = () => {
    const location = useLocation();
    // Receive answers from the navigation state
    const { results, questions, answers } = location.state as { results: Result[], questions: Question[], answers: Answers };

    if (!results || !questions || !answers) {
        return (
            <div className="quiz-app-container error">
                <p>No results to display. Please take a quiz first.</p>
                <Link to="/" className="fluent-button">Go Home</Link>
            </div>
        );
    }

    const totalScore = results.reduce((acc, result) => acc + (result.is_correct ? 1 : 0), 0);
    const percentage = (totalScore / questions.length) * 100;

    const getQuestionText = (id: number) => {
        const question = questions.find(q => q.id === id);
        return question ? question.question_text : 'Question not found';
    };

    const getQuestionType = (id: number) => {
        const question = questions.find(q => q.id === id);
        return question?.question_type;
    };

    return (
        <div className="quiz-app-container">
            <div className="results-summary">
                <h1>Quiz Results</h1>
                <h2>Your Score: {percentage.toFixed(0)}%</h2>
                <p>({totalScore} out of {questions.length} correct)</p>
            </div>

            <div className="results-details">
                {results.map(result => {
                    const qType = getQuestionType(result.question_id);
                    const userAns = answers[result.question_id] || "(No answer provided)";
                    const scorePct = (result.score * 100).toFixed(0);
                    return (
                        <div key={result.question_id} className={`fluent-card result-card ${result.is_correct ? 'correct' : 'incorrect'}`}>
                            <h4 className="fluent-card__question-text">{getQuestionText(result.question_id)}</h4>

                            {qType === 'coding' ? (
                                <>
                                    <div className="result-card__user-answer">
                                        <strong>Your Answer:</strong>
                                        <pre className="code-block">{userAns}</pre>
                                    </div>
                                    <div>
                                        <strong>Model Answer:</strong>
                                        <pre className="code-block">{result.model_answer}</pre>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="result-card__user-answer">
                                        <strong>Your Answer:</strong> {userAns}
                                    </div>
                                    <p><strong>Model Answer:</strong> {result.model_answer}</p>
                                </>
                            )}
                            <p><strong>Result:</strong> {result.is_correct ? 'Correct' : 'Incorrect'} (Score: {scorePct}%)</p>
                            {result.explanation && (
                                <p><strong>Explanation:</strong> {result.explanation}</p>
                            )}
                        </div>
                    );
                })}
            </div>

            <Link to="/" className="fluent-button" style={{marginTop: '2rem', textAlign: 'center'}}>홈화면 돌아가기</Link>
        </div>
    );
};

export default Results;
