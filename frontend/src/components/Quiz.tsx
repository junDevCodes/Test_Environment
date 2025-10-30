
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

// --- Type Definitions ---
interface Question {
    id: number;
    question_text: string;
    question_type: 'multiple_choice' | 'short_answer' | 'descriptive' | 'coding';
    options?: string[];
}

interface UserAnswer {
    question_id: number;
    answer: string;
}

interface Feedback {
    [key: number]: {
        is_correct: boolean;
        model_answer: string;
    } | null;
}

// --- Components ---
const ProgressBar: React.FC<{ current: number; total: number }> = ({ current, total }) => {
    const progress = total > 0 ? (current / total) * 100 : 0;
    return (
        <div
            className="fluent-progress"
            role="progressbar"
            aria-label="Quiz progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={current}
        >
            <div className="fluent-progress__bar" style={{ width: `${progress}%` }}></div>
        </div>
    );
};

const Quiz: React.FC = () => {
    const { subject } = useParams<{ subject: string }>();
    const navigate = useNavigate();

    // --- State Management ---
    const [questions, setQuestions] = useState<Question[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<{ [key: number]: string }>({});
    const [feedback, setFeedback] = useState<Feedback>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [uiMessage, setUiMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null);

    // --- Data Fetching ---
    useEffect(() => {
        axios.get(`http://localhost:8000/api/questions/${subject}`)
            .then(response => {
                setQuestions(response.data);
                setLoading(false);
            })
            .catch(err => {
                setError('Failed to load questions. Please ensure the backend server is running.');
                setLoading(false);
            });
    }, [subject]);

    // --- Event Handlers ---
    const handleAnswerChange = (questionId: number, answer: string) => {
        setAnswers(prev => ({ ...prev, [questionId]: answer }));
        // Reset feedback when a new answer is chosen
        if (feedback[questionId]) {
            setFeedback(prev => ({...prev, [questionId]: null}));
        }
        if (uiMessage) setUiMessage(null);
    };

    const handlePrevious = () => {
        if (currentQuestionIndex > 0) {
            setCurrentQuestionIndex(prev => prev - 1);
        }
    };

    const handleNext = () => {
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        }
    };

    const handleCheckAnswer = () => {
        const currentQuestion = questions[currentQuestionIndex];
        const userAnswer = answers[currentQuestion.id];

        if (!userAnswer) {
            setUiMessage({ type: 'error', text: 'Please provide an answer before checking.' });
            return;
        }

        axios.post('http://localhost:8000/api/check-answer', { question_id: currentQuestion.id, answer: userAnswer })
            .then(response => {
                setFeedback(prev => ({ ...prev, [currentQuestion.id]: response.data }));
                setUiMessage(null);
            })
            .catch(err => {
                setError('Failed to check answer.');
            });
    };

    const handleSubmit = () => {
        if (Object.keys(answers).length !== questions.length) {
            setUiMessage({ type: 'error', text: 'Please answer all questions before submitting.' });
            return;
        }
        const payload = Object.keys(answers).map(id => ({ question_id: parseInt(id), answer: answers[parseInt(id)] }));
        axios.post('http://localhost:8000/api/submit', payload)
            .then(response => {
                navigate('/results', { state: { results: response.data, questions, answers } });
            })
            .catch(() => setError('Failed to submit answers.'));
    };

    // --- Render Logic ---
    if (loading) return <div className="quiz-app-container"><h1>Loading Quiz...</h1></div>;
    if (error) return <div className="quiz-app-container error">{error}</div>;
    if (questions.length === 0) return <div className="quiz-app-container"><h1>No questions found.</h1></div>;

    const currentQuestion = questions[currentQuestionIndex];
    const currentFeedback = feedback[currentQuestion.id];
    const labelId = `question-label-${currentQuestion.id}`;

    return (
        <div className="quiz-app-container">
            <ProgressBar current={currentQuestionIndex + 1} total={questions.length} />
            <div className="fluent-card">
                <p id={labelId} className="fluent-card__question-text">{currentQuestion.question_text}</p>
                
                {currentQuestion.question_type === 'multiple_choice' && (
                    <div className="fluent-options-group" role="radiogroup" aria-labelledby={labelId}>
                        {currentQuestion.options?.map(option => {
                            const isSelected = answers[currentQuestion.id] === option;
                            let feedbackClass = '';
                            if (isSelected && currentFeedback) {
                                feedbackClass = currentFeedback.is_correct ? 'correct' : 'incorrect';
                            }

                            return (
                                <label key={option} className={`fluent-option ${isSelected ? 'selected' : ''} ${feedbackClass}`}>
                                    <input 
                                        type="radio" 
                                        name={`question-${currentQuestion.id}`} 
                                        value={option} 
                                        checked={isSelected}
                                        onChange={() => handleAnswerChange(currentQuestion.id, option)}
                                        className="visually-hidden"
                                    />
                                    {option}
                                </label>
                            );
                        })}
                    </div>
                )}

                {['short_answer', 'descriptive', 'coding'].includes(currentQuestion.question_type) && (
                     <textarea 
                        className="textarea-input"
                        onChange={e => handleAnswerChange(currentQuestion.id, e.target.value)}
                        value={answers[currentQuestion.id] || ''}
                        placeholder="Enter your answer here..."
                        rows={currentQuestion.question_type === 'short_answer' ? 2 : 6}
                    />
                )}
                {currentFeedback && (
                    <div className={`inline-message ${currentFeedback.is_correct ? 'success' : 'error'}`} role="status" aria-live="polite">
                        {currentFeedback.is_correct ? 'Correct' : 'Incorrect'}
                    </div>
                )}
                {uiMessage && (
                    <div className={`inline-message ${uiMessage.type}`}>{uiMessage.text}</div>
                )}
            </div>

            <div className="fluent-card__actions">
                <button onClick={handlePrevious} className="fluent-button" disabled={currentQuestionIndex === 0}>
                    Previous
                </button>
                
                <button onClick={handleCheckAnswer} className="fluent-button" disabled={!!currentFeedback}>
                    Check Answer
                </button>

                {currentQuestionIndex < questions.length - 1 ? (
                    <button onClick={handleNext} className="fluent-button fluent-button--primary">Next</button>
                ) : (
                    <button onClick={handleSubmit} className="fluent-button fluent-button--primary">Submit Quiz</button>
                )}
            </div>
        </div>
    );
};

export default Quiz;
