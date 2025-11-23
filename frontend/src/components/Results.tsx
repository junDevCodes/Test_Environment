import React from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';

// --- Shared Component (duplicated for now to avoid file creation overhead) ---
const QuestionRenderer: React.FC<{ content: string }> = ({ content }) => {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={match[1]}
                PreTag="div"
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

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
    subject: string;
    question_text: string;
    question_type?: 'multiple_choice' | 'short_answer' | 'descriptive' | 'coding';
}

interface Answers {
    [key: number]: string;
}

const Results: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    // Receive answers from the navigation state
    const { results, questions, answers, elapsedSeconds } = location.state as { 
        results: Result[], 
        questions: Question[], 
        answers: Answers,
        elapsedSeconds?: number 
    };

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
    
    // 오답 문제 추출
    const wrongQuestions = results.filter(r => !r.is_correct).map(r => r.question_id);
    
    const handleRetryWrong = () => {
        // 오답 문제만 다시 풀기 위해 localStorage에 저장
        localStorage.setItem('retry_questions', JSON.stringify(wrongQuestions));
        // subject 추출 (첫 번째 문제의 subject 사용)
        const subject = questions[0]?.subject?.split('.')[0] || 'quiz';
        navigate(`/quiz/${subject}`);
    };

    // 퀴즈 히스토리 저장
    React.useEffect(() => {
        const historyData = {
            date: Date.now(),
            correct: totalScore,
            total: questions.length,
            timeSpent: elapsedSeconds || 0
        };

        try {
            const existingHistory = localStorage.getItem('quiz_history');
            const history = existingHistory ? JSON.parse(existingHistory) : [];
            history.push(historyData);
            
            // 최대 100개까지만 저장
            if (history.length > 100) {
                history.shift();
            }
            
            localStorage.setItem('quiz_history', JSON.stringify(history));
        } catch (e) {
            console.error('Failed to save quiz history:', e);
        }
    }, [totalScore, questions.length, elapsedSeconds]);
    
    const formatTime = (seconds: number) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hrs > 0) {
            return `${hrs}시간 ${mins}분 ${secs}초`;
        }
        return `${mins}분 ${secs}초`;
    };

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
                
                {/* 성적별 이모지 및 메시지 */}
                <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
                    {percentage >= 90 ? '🏆' : 
                     percentage >= 80 ? '🎉' : 
                     percentage >= 70 ? '😊' : 
                     percentage >= 60 ? '🙂' : 
                     percentage >= 50 ? '😐' : '😢'}
                </div>
                
                <h2 style={{ marginBottom: '0.5rem' }}>Your Score: {percentage.toFixed(0)}%</h2>
                
                <p style={{ 
                    fontSize: '1.1rem', 
                    fontWeight: '600',
                    color: percentage >= 70 ? '#38ef7d' : percentage >= 50 ? '#ffd93d' : '#f5576c',
                    marginBottom: '0.25rem'
                }}>
                    {percentage >= 90 ? '완벽해요! 🌟' : 
                     percentage >= 80 ? '훌륭해요! 👏' : 
                     percentage >= 70 ? '잘했어요! 💪' : 
                     percentage >= 60 ? '괜찮아요! 👍' : 
                     percentage >= 50 ? '조금만 더 힘내요! 📚' : '다음엔 더 잘할 수 있어요! 💪'}
                </p>
                
                <p style={{ opacity: 0.8 }}>({totalScore} out of {questions.length} correct)</p>
                {elapsedSeconds !== undefined && (
                    <p style={{ opacity: 0.8, fontSize: '1rem', marginTop: '0.5rem' }}>
                        ⏱️ 소요 시간: {formatTime(elapsedSeconds)}
                    </p>
                )}
            </div>

            <div className="results-details">
                {results.map(result => {
                    const qType = getQuestionType(result.question_id);
                    const userAns = answers[result.question_id] || "(No answer provided)";
                    const scorePct = (result.score * 100).toFixed(0);
                    
                    return (
                        <div key={result.question_id} className={`fluent-card result-card ${result.is_correct ? 'correct' : 'incorrect'}`}>
                            <h4 className="fluent-card__question-text">
                                <QuestionRenderer content={getQuestionText(result.question_id)} />
                            </h4>

                            <div className="result-card__user-answer">
                                <strong>Your Answer:</strong>
                                {qType === 'coding' || qType === 'descriptive' ? (
                                    <QuestionRenderer content={userAns} />
                                ) : (
                                    <div>{userAns}</div>
                                )}
                            </div>

                            <div style={{ marginTop: '1rem' }}>
                                <strong>Model Answer:</strong>
                                <QuestionRenderer content={result.model_answer} />
                            </div>

                            <p style={{ marginTop: '1rem' }}>
                                <strong>Result:</strong> {result.is_correct ? 'Correct' : 'Incorrect'} (Score: {scorePct}%)
                            </p>
                            
                            {result.explanation && (
                                <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                                    <strong>Explanation:</strong>
                                    <QuestionRenderer content={result.explanation} />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link to="/" className="fluent-button">홈화면 돌아가기</Link>
                {wrongQuestions.length > 0 && (
                    <button 
                        className="fluent-button fluent-button--primary" 
                        onClick={handleRetryWrong}
                    >
                        오답 다시 풀기 ({wrongQuestions.length}문제)
                    </button>
                )}
            </div>
        </div>
    );
};

export default Results;
