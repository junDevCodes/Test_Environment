import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, setDbSet } from '../lib/api';

// --- Utility Functions ---
// 코드 블록을 파싱하는 유틸리티 함수
function parseQuestionText(text: string) {
  // \n\n으로 문단을 분리
  const parts = text.split('\n\n');
  return parts.map((part, index) => {
    // 코드처럼 보이는 부분 감지 (console.log, const, let, var, function, if, for 등으로 시작)
    const isCode = /^(console\.|const |let |var |function |if |for |while |class |document\.|window\.|<[a-z]|{|\[)/.test(part.trim());
    
    if (isCode && part.trim().length > 0) {
      return (
        <pre key={index} className="code-block" style={{ 
          margin: '0.75rem 0',
          padding: '0.75rem 1rem',
          backgroundColor: '#1a1a1a',
          borderRadius: '4px',
          fontSize: '0.9em'
        }}>
          <code>{part.trim()}</code>
        </pre>
      );
    } else {
      return <span key={index}>{part}{index < parts.length - 1 ? '\n\n' : ''}</span>;
    }
  });
}

// --- Type Definitions ---
interface Question {
  id: number;
  subject: string; // e.g., "1. [실습] Python for AI"
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
  const [feedback, setFeedback] = useState<FeedbackMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uiMessage, setUiMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
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
    randomCount: 0, // 0이면 전체, 그 외엔 해당 개수만큼
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
    // 북마크 불러오기
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
      } else {
        newSet.add(questionId);
      }
      // localStorage에 저장
      localStorage.setItem(getBookmarkKey(), JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  };

  const loadBookmarkedQuestions = () => {
    const bookmarkedIds = Array.from(bookmarkedQuestions);
    if (bookmarkedIds.length === 0) {
      alert('북마크된 문제가 없습니다.');
      return;
    }
    localStorage.setItem('retry_questions', JSON.stringify(bookmarkedIds));
    window.location.reload(); // 문제 다시 로드
  };

  // --- Progress Save/Restore ---
  const getProgressKey = () => `quiz_progress_${currentDbSet}_${subject}`;

  // 진행도 저장
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

  // 진행도 복원 체크
  useEffect(() => {
    if (!subject || !currentDbSet || questions.length === 0) return;

    const savedProgress = localStorage.getItem(getProgressKey());
    if (!savedProgress) return;

    try {
      const progress = JSON.parse(savedProgress);
      const savedTime = new Date(progress.timestamp);
      const timeDiff = Date.now() - progress.timestamp;
      
      // 24시간 이내의 진행도만 복원 제안
      if (timeDiff < 24 * 60 * 60 * 1000 && Object.keys(progress.answers).length > 0) {
        // 저장된 문제 ID와 현재 문제 ID가 일치하는지 확인
        const currentIds = questions.map(q => q.id).sort().join(',');
        const savedIds = (progress.questionIds || []).sort().join(',');
        
        if (currentIds === savedIds) {
          // 모달 표시 전에 이미 답변이 있으면 복원 안함
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
      // localStorage에서 선택된 DB set 복원
      const savedDbSet = localStorage.getItem('dbSet');
      if (savedDbSet) {
        setCurrentDbSet(savedDbSet);
      }

      api.get('/api/sets')
        .then(res => {
          const sets: string[] = res.data || [];
          setDbSets(sets);

          // localStorage에 저장된 값이 있으면 그것 사용, 없으면 첫 번째 세트로 자동 지정
          if (savedDbSet && sets.includes(savedDbSet)) {
            // 이미 savedDbSet으로 설정되어 있음
          } else if (sets.length > 0) {
            setCurrentDbSet(sets[0]);
            setDbSet(sets[0]);
          }
        })
        .catch(() => {
          setError('문제집 목록을 불러오지 못했습니다.');
        });
      // 의도: 첫 마운트 시 한 번만 호출
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // 추가: 빈 deps → 최초 1회만 실행

  useEffect(() => {
      if (!subject) return;          // 기존과 동일: URL 파라미터 없으면 대기
      if (!currentDbSet) return;     // 추가: 아직 어떤 문제집 쓸지 모르면 문제 로드하지 않음

      setLoading(true);

      // 여기서부터는 api 인스턴스에 이미 X-DB-SET 헤더가 들어가 있으므로
      // 따로 headers: { 'X-DB-SET': ... } 안 줘도 된다.
      api.get(`/api/questions/${subject}`)
        .then(response => {
          let data: Question[] = response.data || [];

          // 오답 다시 풀기 모드 체크
          const retryQuestions = localStorage.getItem('retry_questions');
          if (retryQuestions) {
            try {
              const retryIds: number[] = JSON.parse(retryQuestions);
              data = data.filter(q => retryIds.includes(q.id));
              localStorage.removeItem('retry_questions'); // 한 번 사용 후 삭제
            } catch (e) {
              console.error('Failed to parse retry questions:', e);
            }
          }

          // 문제 유형별 필터링
          const enabledTypes = Object.entries(quizSettings.questionTypes)
            .filter(([_, enabled]) => enabled)
            .map(([type, _]) => type);
          
          if (enabledTypes.length > 0) {
            data = data.filter(q => enabledTypes.includes(q.question_type));
          }

          // 랜덤 개수 선택
          if (quizSettings.randomCount > 0 && data.length > quizSettings.randomCount) {
            // 랜덤 샘플링
            const shuffledForSampling = [...data];
            for (let i = shuffledForSampling.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffledForSampling[i], shuffledForSampling[j]] = [shuffledForSampling[j], shuffledForSampling[i]];
            }
            data = shuffledForSampling.slice(0, quizSettings.randomCount);
          }

          // 문제 순서 섞기
          let finalQuestions = [...data];
          if (quizSettings.shuffleQuestions) {
            for (let i = finalQuestions.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [finalQuestions[i], finalQuestions[j]] = [finalQuestions[j], finalQuestions[i]];
            }
          }

          // 보기 섞기
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
          setUiMessage(null);
          setLoading(false);
          
          // 진행도 복원이 없으면 타이머 시작
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
    }, [subject, currentDbSet]); // 변경: currentDbSet을 의존성에 추가 → 세트 바뀌면 새 문제 로드

  // --- Event Handlers ---
  const handleAnswerChange = (questionId: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
    if (feedback[questionId]) setFeedback(prev => ({ ...prev, [questionId]: null }));
    if (uiMessage) setUiMessage(null);
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
      setUiMessage({ type: 'error', text: 'Please provide an answer before checking.' });
      return;
    }
    api.post(`/api/check-answer/${subject}`, { question_id: currentQuestion.id, answer: userAnswer })
      .then(response => {
        setFeedback(prev => ({ ...prev, [currentQuestion.id]: response.data }));
        setUiMessage(null);
      })
      .catch(() => setError('Failed to check answer.'));
  };

  const handleSubmit = () => {
    if (Object.keys(answers).length !== questions.length) {
      setUiMessage({ type: 'error', text: 'Please answer all questions before submitting.' });
      return;
    }
    const payload: UserAnswer[] = Object.keys(answers).map(id => ({
      question_id: parseInt(id),
      answer: answers[parseInt(id)],
    }));
    api.post(`/api/submit/${subject}`, payload)
      .then(response => {
        // 제출 완료 시 진행도 삭제 및 타이머 정지
        setIsTimerRunning(false);
        localStorage.removeItem(getProgressKey());
        navigate('/results', { state: { 
          results: response.data, 
          questions, 
          answers,
          elapsedSeconds 
        } });
      })
      .catch(() => setError('Failed to submit answers.'));
  };

  const handleEndExam = () => setShowEndModal(true);

  const confirmEndExam = () => {
    // Include all questions; unanswered counted as incorrect (empty string)
    const payload: UserAnswer[] = questions.map(q => ({
      question_id: q.id,
      answer: (answers[q.id] ?? '').trim(),
    }));
    api.post(`/api/submit/${subject}`, payload)
      .then(response => {
        const answersForResults: { [key: number]: string } = {};
        questions.forEach(q => { answersForResults[q.id] = answers[q.id] ?? ''; });
        setShowEndModal(false);
        // 제출 완료 시 진행도 삭제 및 타이머 정지
        setIsTimerRunning(false);
        localStorage.removeItem(getProgressKey());
        navigate('/results', { state: { 
          results: response.data, 
          questions, 
          answers: answersForResults,
          elapsedSeconds 
        } });
      })
      .catch(() => setError('Failed to submit answers.'));
  };

  // 사용자가 드롭다운으로 문제집을 바꿀 때 호출되는 핸들러
  const handleDbSetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSet = e.target.value;
    setCurrentDbSet(newSet); // React state
    setDbSet(newSet);        // 추가: axios 기본 헤더(X-DB-SET)도 같이 교체 + localStorage 갱신
    // 바뀌면 useEffect([subject, currentDbSet])가 다시 돌면서 새 문제집에서 문제를 불러온다
  };

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // input/textarea에 포커스가 있으면 단축키 무시
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      const currentQuestion = questions[currentQuestionIndex];
      if (!currentQuestion) return;

      switch(e.key.toLowerCase()) {
        case 'arrowright':
        case 'n':
          // Next
          e.preventDefault();
          if (currentQuestionIndex < questions.length - 1) {
            handleNext();
          }
          break;
        case 'arrowleft':
        case 'p':
          // Previous
          e.preventDefault();
          if (currentQuestionIndex > 0) {
            handlePrevious();
          }
          break;
        case 'enter':
          // Check answer (if not already checked)
          e.preventDefault();
          if (!feedback[currentQuestion.id]) {
            handleCheckAnswer();
          }
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          // 객관식 선택 (1-5번)
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

  if (loading) return <div className="quiz-app-container"><h1>Loading Quiz...</h1></div>;
  if (error) return <div className="quiz-app-container error">{error}</div>;
  if (questions.length === 0) return <div className="quiz-app-container"><h1>No questions found.</h1></div>;

  const currentQuestion = questions[currentQuestionIndex];
  const currentFeedback = feedback[currentQuestion.id];
  const labelId = `question-label-${currentQuestion.id}`;

  return (
    <div className="quiz-app-container">
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
        
        {/* ⭐ 추가: 문제집 세트 선택 드롭다운 */}
        <div className="fluent-select-group">
          <label style={{ fontSize: '0.8rem', opacity: 0.8, marginRight: '0.5rem' }}>
            문제집 세트
          </label>
          <select
            value={currentDbSet}
            onChange={handleDbSetChange}
            className="fluent-select"
          >
            {dbSets.map(setName => (
              <option key={setName} value={setName}>
                {setName}
              </option>
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
      <div className="fluent-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <div style={{ opacity: 0.8 }}>
            {`${currentQuestionIndex + 1}. ${currentQuestion.subject || ''}`}
          </div>
          <button 
            onClick={() => toggleBookmark(currentQuestion.id)}
            className="fluent-button"
            style={{ 
              padding: '0.25rem 0.75rem', 
              fontSize: '1.2rem',
              background: bookmarkedQuestions.has(currentQuestion.id) ? 'var(--fluent-accent-blue)' : 'transparent'
            }}
            title={bookmarkedQuestions.has(currentQuestion.id) ? '북마크 제거' : '북마크 추가'}
          >
            {bookmarkedQuestions.has(currentQuestion.id) ? '★' : '☆'}
          </button>
        </div>
        <div id={labelId} className="fluent-card__question-text" style={{ whiteSpace: 'pre-wrap' }}>
          {parseQuestionText(currentQuestion.question_text)}
        </div>

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
            <div>{currentFeedback.is_correct ? 'Correct' : 'Incorrect'}</div>
            {currentFeedback.explanation && (
              <div style={{ opacity: 0.9, marginTop: '0.5rem' }}>
                <strong>Explanation:</strong> {currentFeedback.explanation}
              </div>
            )}
          </div>
        )}

        {uiMessage && (
          <div className={`inline-message ${uiMessage.type}`}>{uiMessage.text}</div>
        )}
      </div>

      <div className="fluent-card__actions">
        <button onClick={handlePrevious} className="fluent-button" disabled={currentQuestionIndex === 0}>
          ← Previous (P)
        </button>

        <button onClick={handleCheckAnswer} className="fluent-button" disabled={!!currentFeedback}>
          Check (Enter)
        </button>

        {currentQuestionIndex < questions.length - 1 ? (
          <button onClick={handleNext} className="fluent-button fluent-button--primary">Next (N) →</button>
        ) : (
          <button onClick={handleSubmit} className="fluent-button fluent-button--primary">Submit Quiz</button>
        )}
      </div>

      {/* 키보드 단축키 안내 */}
      <div style={{ 
        marginTop: '1.5rem', 
        padding: '1rem', 
        background: 'rgba(255,255,255,0.05)', 
        borderRadius: '4px',
        fontSize: '0.85rem',
        opacity: 0.7
      }}>
        <strong>⌨️ 키보드 단축키:</strong> 
        <span style={{ marginLeft: '0.5rem' }}>
          1-5: 객관식 선택 | N/→: 다음 | P/←: 이전 | Enter: 답안 확인
        </span>
      </div>

      {showEndModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="end-exam-title">
          <div className="modal">
            <h2 id="end-exam-title" className="fluent-card__question-text">시험 종료</h2>
            <p style={{ opacity: 0.8 }}>시험을 종료할까요? 답하지 않은 문항은 오답으로 처리됩니다.</p>
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
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={quizSettings.questionTypes.multiple_choice}
                      onChange={(e) => setQuizSettings(prev => ({ 
                        ...prev, 
                        questionTypes: { ...prev.questionTypes, multiple_choice: e.target.checked }
                      }))}
                    />
                    <span>객관식</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={quizSettings.questionTypes.short_answer}
                      onChange={(e) => setQuizSettings(prev => ({ 
                        ...prev, 
                        questionTypes: { ...prev.questionTypes, short_answer: e.target.checked }
                      }))}
                    />
                    <span>단답형</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={quizSettings.questionTypes.descriptive}
                      onChange={(e) => setQuizSettings(prev => ({ 
                        ...prev, 
                        questionTypes: { ...prev.questionTypes, descriptive: e.target.checked }
                      }))}
                    />
                    <span>서술형</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={quizSettings.questionTypes.coding}
                      onChange={(e) => setQuizSettings(prev => ({ 
                        ...prev, 
                        questionTypes: { ...prev.questionTypes, coding: e.target.checked }
                      }))}
                    />
                    <span>코딩</span>
                  </label>
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
                <p style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '0.25rem' }}>
                  현재 문제집 총 {questions.length}문제
                </p>
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
