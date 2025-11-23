import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { api, setDbSet } from '../lib/api';

// --- Components ---

interface ToastProps {
  message: { type: 'success' | 'error' | 'info'; text: string } | null;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  useEffect(() => {
    if (message) {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className="toast-container">
      <div className={`toast ${message.type}`}>
        <span>{message.type === 'success' ? '✅' : message.type === 'error' ? '❌' : 'ℹ️'}</span>
        <span>{message.text}</span>
      </div>
    </div>
  );
};

// Markdown Renderer Component
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

// --- Type Definitions ---
interface Question {
  id: number;
  subject: string;
  question_text: string;
  question_type: 'multiple_choice' | 'short_answer' | 'descriptive' | 'coding';
  options?: string[];
}

interface UserAnswer {
  question_id: number;
  answer: string;
}

interface FeedbackItem {
  is_correct: boolean;
  model_answer: string;
  explanation?: string | null;
}
interface FeedbackMap {
  [key: number]: FeedbackItem | null;
}

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
  const [feedback, setFeedback] = useState<FeedbackMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Toast State
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  
  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [showRestoreModal, setShowRestoreModal] = useState<boolean>(false);

  const [dbSets, setDbSets] = useState<string[]>([]);
  const [currentDbSet, setCurrentDbSet] = useState<string>('');
  
  // 타이머 관련 상태
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  
  // 북마크 관련
  const [bookmarkedQuestions, setBookmarkedQuestions] = useState<Set<number>>(new Set());
  
  // 퀴즈 설정 관련
  const [showQuizSettings, setShowQuizSettings] = useState(false);
  const [quizSettings, setQuizSettings] = useState({
    shuffleQuestions: true,
    randomCount: 0, // 0이면 전체
    shuffleOptions: false,
    questionTypes: {
      multiple_choice: true,
      short_answer: true,
      descriptive: true,
      coding: true
    }
  });

  // --- Timer ---
  useEffect(() => {
    if (!isTimerRunning) return;
    const interval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // --- Bookmark Management ---
  const getBookmarkKey = () => `quiz_bookmarks_${currentDbSet}`;

  useEffect(() => {
    const savedBookmarks = localStorage.getItem(getBookmarkKey());
    if (savedBookmarks) {
      try {
        const bookmarkArray: number[] = JSON.parse(savedBookmarks);
        setBookmarkedQuestions(new Set(bookmarkArray));
      } catch (e) {
        console.error('Failed to load bookmarks:', e);
      }
    }
  }, [currentDbSet]);

  const toggleBookmark = (questionId: number) => {
    setBookmarkedQuestions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
        setToast({ type: 'info', text: '북마크가 해제되었습니다.' });
      } else {
        newSet.add(questionId);
        setToast({ type: 'success', text: '북마크되었습니다.' });
      }
      localStorage.setItem(getBookmarkKey(), JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  };

  const loadBookmarkedQuestions = () => {
    const bookmarkedIds = Array.from(bookmarkedQuestions);
    if (bookmarkedIds.length === 0) {
      setToast({ type: 'error', text: '북마크된 문제가 없습니다.' });
      return;
    }
    localStorage.setItem('retry_questions', JSON.stringify(bookmarkedIds));
    window.location.reload();
  };

  // --- Progress Save/Restore ---
  const getProgressKey = () => `quiz_progress_${currentDbSet}_${subject}`;

  useEffect(() => {
    if (questions.length === 0) return;
    
    const progressData = {
      answers,
      currentQuestionIndex,
      timestamp: Date.now(),
      questionIds: questions.map(q => q.id),
      elapsedSeconds
    };
    
    localStorage.setItem(getProgressKey(), JSON.stringify(progressData));
  }, [answers, currentQuestionIndex, questions, currentDbSet, subject, elapsedSeconds]);

  useEffect(() => {
    if (!subject || !currentDbSet || questions.length === 0) return;

    const savedProgress = localStorage.getItem(getProgressKey());
    if (!savedProgress) return;

    try {
      const progress = JSON.parse(savedProgress);
      const timeDiff = Date.now() - progress.timestamp;
      
      if (timeDiff < 24 * 60 * 60 * 1000 && Object.keys(progress.answers).length > 0) {
        const currentIds = questions.map(q => q.id).sort().join(',');
        const savedIds = (progress.questionIds || []).sort().join(',');
        
        if (currentIds === savedIds) {
          if (Object.keys(answers).length === 0) {
            setShowRestoreModal(true);
          }
        }
      }
    } catch (e) {
      console.error('Failed to parse saved progress:', e);
    }
  }, [questions, subject, currentDbSet]);

  const handleRestoreProgress = () => {
    const savedProgress = localStorage.getItem(getProgressKey());
    if (savedProgress) {
      try {
        const progress = JSON.parse(savedProgress);
        setAnswers(progress.answers || {});
        setCurrentQuestionIndex(progress.currentQuestionIndex || 0);
        setElapsedSeconds(progress.elapsedSeconds || 0);
        setShowRestoreModal(false);
        setIsTimerRunning(true);
        setToast({ type: 'success', text: '진행도가 복원되었습니다.' });
      } catch (e) {
        console.error('Failed to restore progress:', e);
      }
    }
  };

  const handleStartFresh = () => {
    localStorage.removeItem(getProgressKey());
    setElapsedSeconds(0);
    setShowRestoreModal(false);
    setIsTimerRunning(true);
  };

  // --- Data Fetching ---
  useEffect(() => {
      const savedDbSet = localStorage.getItem('dbSet');
      if (savedDbSet) {
        setCurrentDbSet(savedDbSet);
      }

      api.get('/api/sets')
        .then(res => {
          const sets: string[] = res.data || [];
          setDbSets(sets);

          if (savedDbSet && sets.includes(savedDbSet)) {
            // pass
          } else if (sets.length > 0) {
            setCurrentDbSet(sets[0]);
            setDbSet(sets[0]);
          }
        })
        .catch(() => {
          setError('문제집 목록을 불러오지 못했습니다.');
        });
    }, []);

  useEffect(() => {
      if (!subject) return;
      if (!currentDbSet) return;

      setLoading(true);

      api.get(`/api/questions/${subject}`)
        .then(response => {
          let data: Question[] = response.data || [];

          const retryQuestions = localStorage.getItem('retry_questions');
          if (retryQuestions) {
            try {
              const retryIds: number[] = JSON.parse(retryQuestions);
              data = data.filter(q => retryIds.includes(q.id));
              localStorage.removeItem('retry_questions');
            } catch (e) {
              console.error('Failed to parse retry questions:', e);
            }
          }

          const enabledTypes = Object.entries(quizSettings.questionTypes)
            .filter(([_, enabled]) => enabled)
            .map(([type, _]) => type);
          
          if (enabledTypes.length > 0) {
            data = data.filter(q => enabledTypes.includes(q.question_type));
          }

          if (quizSettings.randomCount > 0 && data.length > quizSettings.randomCount) {
            const shuffledForSampling = [...data];
            for (let i = shuffledForSampling.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffledForSampling[i], shuffledForSampling[j]] = [shuffledForSampling[j], shuffledForSampling[i]];
            }
            data = shuffledForSampling.slice(0, quizSettings.randomCount);
          }

          let finalQuestions = [...data];
          if (quizSettings.shuffleQuestions) {
            for (let i = finalQuestions.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [finalQuestions[i], finalQuestions[j]] = [finalQuestions[j], finalQuestions[i]];
            }
          }

          if (quizSettings.shuffleOptions) {
            finalQuestions = finalQuestions.map(q => {
              if (q.question_type === 'multiple_choice' && q.options) {
                const shuffledOptions = [...q.options];
                for (let i = shuffledOptions.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
                }
                return { ...q, options: shuffledOptions };
              }
              return q;
            });
          }

          setQuestions(finalQuestions);
          setCurrentQuestionIndex(0);
          setAnswers({});
          setFeedback({});
          setLoading(false);
          
          const savedProgress = localStorage.getItem(getProgressKey());
          if (!savedProgress || Object.keys(JSON.parse(savedProgress).answers || {}).length === 0) {
            setElapsedSeconds(0);
            setIsTimerRunning(true);
          }
        })
        .catch(() => {
          setError('Failed to load questions. Please ensure the backend server is running.');
          setLoading(false);
        });
    }, [subject, currentDbSet]);

  // --- Event Handlers ---
  const handleAnswerChange = (questionId: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
    if (feedback[questionId]) setFeedback(prev => ({ ...prev, [questionId]: null }));
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) setCurrentQuestionIndex(i => i - 1);
  };

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) setCurrentQuestionIndex(i => i + 1);
  };

  const handleCheckAnswer = () => {
    const currentQuestion = questions[currentQuestionIndex];
    const userAnswer = answers[currentQuestion.id];
    if (!userAnswer) {
      setToast({ type: 'error', text: '답안을 입력해주세요.' });
      return;
    }
    api.post(`/api/check-answer/${subject}`, { question_id: currentQuestion.id, answer: userAnswer })
      .then(response => {
        setFeedback(prev => ({ ...prev, [currentQuestion.id]: response.data }));
        if (response.data.is_correct) {
            setToast({ type: 'success', text: '정답입니다!' });
        } else {
            setToast({ type: 'error', text: '오답입니다. 다시 시도해보세요.' });
        }
      })
      .catch(() => setToast({ type: 'error', text: '채점에 실패했습니다.' }));
  };

  const handleSubmit = () => {
    const unansweredCount = questions.filter(q => !answers[q.id]?.trim()).length;
    
    if (unansweredCount > 0) {
      if (!window.confirm(`${unansweredCount}개의 문제가 풀리지 않았습니다. 정말 제출하시겠습니까?`)) {
        return;
      }
    }
    
    const payload: UserAnswer[] = Object.keys(answers).map(id => ({
      question_id: parseInt(id),
      answer: answers[parseInt(id)],
    }));
    
    submitQuiz(payload);
  };

  const handleEndExam = () => setShowEndModal(true);

  const confirmEndExam = () => {
    const payload: UserAnswer[] = questions.map(q => ({
      question_id: q.id,
      answer: (answers[q.id] ?? '').trim(),
    }));
    submitQuiz(payload);
  };
  
  const submitQuiz = (payload: UserAnswer[]) => {
    api.post(`/api/submit/${subject}`, payload)
      .then(response => {
        setIsTimerRunning(false);
        localStorage.removeItem(getProgressKey());
        const answersForResults: { [key: number]: string } = {};
        questions.forEach(q => { answersForResults[q.id] = answers[q.id] ?? ''; });
        
        navigate('/results', { state: { 
          results: response.data, 
          questions, 
          answers: answersForResults,
          elapsedSeconds 
        } });
      })
      .catch(() => setToast({ type: 'error', text: '제출에 실패했습니다.' }));
  };

  const handleDbSetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSet = e.target.value;
    setCurrentDbSet(newSet);
    setDbSet(newSet);
  };

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      const currentQuestion = questions[currentQuestionIndex];
      if (!currentQuestion) return;

      switch(e.key.toLowerCase()) {
        case 'arrowright':
        case 'n':
          e.preventDefault();
          if (currentQuestionIndex < questions.length - 1) handleNext();
          break;
        case 'arrowleft':
        case 'p':
          e.preventDefault();
          if (currentQuestionIndex > 0) handlePrevious();
          break;
        case 'enter':
          e.preventDefault();
          if (!feedback[currentQuestion.id]) handleCheckAnswer();
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          if (currentQuestion.question_type === 'multiple_choice' && currentQuestion.options) {
            const index = parseInt(e.key) - 1;
            if (index >= 0 && index < currentQuestion.options.length) {
              e.preventDefault();
              handleAnswerChange(currentQuestion.id, currentQuestion.options[index]);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentQuestionIndex, questions, feedback]);

  if (loading) return <div className="quiz-app-container"><div className="loading">Loading Quiz...</div></div>;
  if (error) return <div className="quiz-app-container error">{error}</div>;
  if (questions.length === 0) return <div className="quiz-app-container"><h1>No questions found.</h1></div>;

  const currentQuestion = questions[currentQuestionIndex];
  const currentFeedback = feedback[currentQuestion.id];
  const labelId = `question-label-${currentQuestion.id}`;

  return (
    <div className="quiz-app-container">
      <Toast message={toast} onClose={() => setToast(null)} />
      
      <div className="fluent-card__actions" style={{ justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="fluent-button" onClick={() => navigate('/')}>홈화면</button>
          <button className="fluent-button" onClick={() => setShowQuizSettings(true)} title="퀴즈 설정">⚙️</button>
          {bookmarkedQuestions.size > 0 && (
            <button 
              className="fluent-button" 
              onClick={loadBookmarkedQuestions}
              title="북마크한 문제만 풀기"
            >
              ★ 북마크 ({bookmarkedQuestions.size})
            </button>
          )}
        </div>
        
        <div className="fluent-select-group">
          <select
            value={currentDbSet}
            onChange={handleDbSetChange}
            className="fluent-select"
          >
            {dbSets.map(setName => (
              <option key={setName} value={setName}>{setName}</option>
            ))}
          </select>
        </div>
        
        <div style={{ 
          fontSize: '1.1rem',
          fontWeight: '600',
          color: 'var(--fluent-accent-blue)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span>⏱️</span>
          <span>{formatTime(elapsedSeconds)}</span>
        </div>
        
        <button className="fluent-button fluent-button--primary" onClick={handleEndExam}>시험 종료</button>
      </div>

      <ProgressBar current={currentQuestionIndex + 1} total={questions.length} />

      {/* Split Layout */}
      <div className="quiz-split-layout">
        {/* Left Panel: Question Content */}
        <div className="fluent-card quiz-left-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ opacity: 0.8, fontWeight: 'bold', color: 'var(--fluent-accent-blue)' }}>
                QUESTION {currentQuestionIndex + 1} / {questions.length}
              </div>
              <button 
                onClick={() => toggleBookmark(currentQuestion.id)}
                className="fluent-button"
                style={{ 
                  padding: '0.25rem 0.75rem', 
                  fontSize: '1.2rem',
                  background: bookmarkedQuestions.has(currentQuestion.id) ? 'var(--fluent-accent-blue)' : 'transparent',
                  flexGrow: 0
                }}
                title={bookmarkedQuestions.has(currentQuestion.id) ? '북마크 제거' : '북마크 추가'}
              >
                {bookmarkedQuestions.has(currentQuestion.id) ? '★' : '☆'}
              </button>
            </div>
            
            <div style={{ fontSize: '1.1em', marginBottom: '1rem', fontWeight: 600 }}>
                {currentQuestion.subject}
            </div>

            <div id={labelId} className="fluent-card__question-text">
                <QuestionRenderer content={currentQuestion.question_text} />
            </div>
        </div>

        {/* Right Panel: Interaction & Navigation */}
        <div className="quiz-right-panel">
            {/* Answer Section */}
            <div className="fluent-card" style={{ marginBottom: 0 }}>
                {currentQuestion.question_type === 'multiple_choice' && (
                    <div className="fluent-options-group" role="radiogroup" aria-labelledby={labelId}>
                        {currentQuestion.options?.map(option => {
                        const isSelected = answers[currentQuestion.id] === option;
                        let feedbackClass = '';
                        if (isSelected && currentFeedback) feedbackClass = currentFeedback.is_correct ? 'correct' : 'incorrect';
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
                            <QuestionRenderer content={option} />
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
                    placeholder="정답을 입력하세요..."
                    rows={currentQuestion.question_type === 'coding' ? 10 : 4}
                    style={{ fontFamily: currentQuestion.question_type === 'coding' ? 'monospace' : 'inherit' }}
                />
                )}
                
                <div className="fluent-card__actions">
                    <button onClick={handlePrevious} className="fluent-button" disabled={currentQuestionIndex === 0}>
                        ← Prev
                    </button>
                    <button onClick={handleCheckAnswer} className="fluent-button" disabled={!!currentFeedback}>
                        Check
                    </button>
                    <button onClick={handleNext} className="fluent-button fluent-button--primary" disabled={currentQuestionIndex === questions.length - 1}>
                        Next →
                    </button>
                </div>

                {currentFeedback && (
                    <div className={`inline-message ${currentFeedback.is_correct ? 'success' : 'error'}`} style={{ marginTop: '1rem' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{currentFeedback.is_correct ? 'Correct! 🎉' : 'Incorrect 😢'}</div>
                        {currentFeedback.explanation && (
                        <div style={{ opacity: 0.9 }}>
                            <strong>Explanation:</strong> <QuestionRenderer content={currentFeedback.explanation} />
                        </div>
                        )}
                    </div>
                )}
            </div>

            {/* Question Navigation Grid (OMR) */}
            <div className="fluent-card">
                <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>문제 탐색</h3>
                <div className="omr-grid">
                    {questions.map((q, idx) => {
                        const isCurrent = idx === currentQuestionIndex;
                        const isAnswered = !!answers[q.id];
                        const isBookmarked = bookmarkedQuestions.has(q.id);
                        
                        return (
                            <div 
                                key={q.id}
                                className={`omr-item ${isCurrent ? 'current' : ''} ${isAnswered ? 'answered' : ''} ${isBookmarked ? 'bookmarked' : ''}`}
                                onClick={() => setCurrentQuestionIndex(idx)}
                                title={`문제 ${idx + 1}`}
                            >
                                {idx + 1}
                            </div>
                        );
                    })}
                </div>
                <div style={{ marginTop: '1rem', fontSize: '0.8rem', opacity: 0.7, display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <div style={{ width: 8, height: 8, background: 'var(--fluent-accent-blue)', borderRadius: '50%' }}></div> 풀이됨
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <div style={{ width: 8, height: 8, border: '1px solid var(--fluent-accent-blue)', borderRadius: '50%' }}></div> 현재
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span>★</span> 북마크
                    </span>
                </div>
            </div>
        </div>
      </div>

      {/* Modals */}
      {showEndModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="end-exam-title">
          <div className="modal">
            <h2 id="end-exam-title" className="fluent-card__question-text">시험 종료</h2>
            <p style={{ opacity: 0.8 }}>시험을 종료할까요? <br/>답하지 않은 문항은 오답으로 처리됩니다.</p>
            <div className="fluent-card__actions" style={{ marginTop: '1rem' }}>
              <button className="fluent-button" onClick={() => setShowEndModal(false)}>취소</button>
              <button className="fluent-button fluent-button--primary" onClick={confirmEndExam}>종료</button>
            </div>
          </div>
        </div>
      )}

      {showRestoreModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="restore-progress-title">
          <div className="modal">
            <h2 id="restore-progress-title" className="fluent-card__question-text">이전 진행도 발견</h2>
            <p style={{ opacity: 0.8 }}>저장된 진행도가 있습니다. 이어서 푸시겠습니까?</p>
            <div className="fluent-card__actions" style={{ marginTop: '1rem' }}>
              <button className="fluent-button" onClick={handleStartFresh}>처음부터 시작</button>
              <button className="fluent-button fluent-button--primary" onClick={handleRestoreProgress}>이어서 풀기</button>
            </div>
          </div>
        </div>
      )}

      {showQuizSettings && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="quiz-settings-title">
          <div className="modal" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <h2 id="quiz-settings-title" className="fluent-card__question-text">퀴즈 설정</h2>
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', opacity: 0.9 }}>기본 설정</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={quizSettings.shuffleQuestions}
                      onChange={(e) => setQuizSettings(prev => ({ ...prev, shuffleQuestions: e.target.checked }))}
                    />
                    <span>문제 순서 섞기</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={quizSettings.shuffleOptions}
                      onChange={(e) => setQuizSettings(prev => ({ ...prev, shuffleOptions: e.target.checked }))}
                    />
                    <span>객관식 보기 순서 섞기</span>
                  </label>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', opacity: 0.9 }}>문제 유형</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                   {Object.keys(quizSettings.questionTypes).map(type => (
                       <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={quizSettings.questionTypes[type as keyof typeof quizSettings.questionTypes]}
                          onChange={(e) => setQuizSettings(prev => ({ 
                            ...prev, 
                            questionTypes: { ...prev.questionTypes, [type]: e.target.checked }
                          }))}
                        />
                        <span>
                            {type === 'multiple_choice' ? '객관식' : 
                             type === 'short_answer' ? '단답형' : 
                             type === 'descriptive' ? '서술형' : '코딩'}
                        </span>
                      </label>
                   ))}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '1rem', opacity: 0.9 }}>
                  출제 문제 개수 (0 = 전체)
                </label>
                <input 
                  type="number" 
                  min="0"
                  max={questions.length}
                  value={quizSettings.randomCount}
                  onChange={(e) => setQuizSettings(prev => ({ ...prev, randomCount: parseInt(e.target.value) || 0 }))}
                  className="text-input"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="fluent-card__actions" style={{ marginTop: '1.5rem' }}>
              <button className="fluent-button fluent-button--primary" onClick={() => setShowQuizSettings(false)}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Quiz;
