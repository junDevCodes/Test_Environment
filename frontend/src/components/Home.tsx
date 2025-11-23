import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

interface QuizStats {
  totalAttempts: number;
  totalQuestions: number;
  totalCorrect: number;
  averageScore: number;
  totalTimeSpent: number;
  recentScores: number[];
}

const Home: React.FC = () => {
  const [geminiEnabled, setGeminiEnabled] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [stats, setStats] = useState<QuizStats | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/config/status')
      .then(res => setGeminiEnabled(!!res.data.gemini_key_set))
      .catch(() => {
        setGeminiEnabled(null);
        setStatusError('백엔드 상태를 확인할 수 없습니다. 서버가 실행 중인지 확인하세요.');
      });
    const onKeyUpdated = () => setGeminiEnabled(true);
    window.addEventListener('gemini:updated', onKeyUpdated as any);
    return () => window.removeEventListener('gemini:updated', onKeyUpdated as any);
  }, []);

  useEffect(() => {
    // 통계 계산
    const calculateStats = () => {
      const statsData = localStorage.getItem('quiz_history');
      if (!statsData) return null;

      try {
        const history: Array<{
          date: number;
          correct: number;
          total: number;
          timeSpent: number;
        }> = JSON.parse(statsData);

        const totalAttempts = history.length;
        const totalQuestions = history.reduce((sum, h) => sum + h.total, 0);
        const totalCorrect = history.reduce((sum, h) => sum + h.correct, 0);
        const totalTimeSpent = history.reduce((sum, h) => sum + h.timeSpent, 0);
        const averageScore = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;
        const recentScores = history.slice(-5).map(h => (h.correct / h.total) * 100);

        return {
          totalAttempts,
          totalQuestions,
          totalCorrect,
          averageScore,
          totalTimeSpent,
          recentScores
        };
      } catch (e) {
        console.error('Failed to parse quiz history:', e);
        return null;
      }
    };

    setStats(calculateStats());
  }, []);

  return (
    <div className="quiz-app-container">
      <div className="fluent-card" style={{ textAlign: 'center' }}>
        <h1 className="fluent-card__question-text">AI 기반 맞춤형 퀴즈 학습</h1>
        <p style={{ opacity: 0.8 }}>시작하려면 과목을 선택하세요.</p>

        {geminiEnabled === true && (
          <div className="inline-message success" style={{ marginTop: '1rem' }}>
            Gemini 키가 설정되어 있습니다. 단답/서술형은 AI 채점이 적용됩니다.
          </div>
        )}
        {geminiEnabled === false && (
          <div className="inline-message info" style={{ marginTop: '1rem' }}>
            Gemini 키가 설정되지 않았습니다. 단답/서술형은 키워드 기반 임시 채점이 적용됩니다.
            더 정확한 평가를 위해 키를 설정하는 것을 권장합니다.
            <div className="fluent-card__actions" style={{ marginTop: '0.5rem', justifyContent: 'center' }}>
              <button className="fluent-button" onClick={() => (window as any).__openKeyModal?.()}>Gemini 키 설정</button>
            </div>
          </div>
        )}
        {statusError && (
          <div className="inline-message error" style={{ marginTop: '1rem' }}>
            {statusError}
          </div>
        )}

        <div className="fluent-card__actions" style={{ justifyContent: 'center' }}>
          <button
            className="fluent-button fluent-button--primary"
            onClick={() => navigate('/select-set')}
          >
            퀴즈 시작
          </button>
        </div>
      </div>

      {stats && stats.totalAttempts > 0 && (
        <div className="fluent-card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', textAlign: 'center' }}>📊 학습 통계</h2>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <div style={{ 
              padding: '1.25rem', 
              background: 'linear-gradient(135deg, rgba(79, 172, 254, 0.2) 0%, rgba(0, 242, 254, 0.15) 100%)', 
              borderRadius: '8px',
              textAlign: 'center',
              border: '1px solid rgba(79, 172, 254, 0.3)',
              boxShadow: '0 4px 15px rgba(79, 172, 254, 0.2)'
            }}>
              <div style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '0.5rem' }}>📝 총 시도</div>
              <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#4facfe' }}>
                {stats.totalAttempts}
              </div>
            </div>

            <div style={{ 
              padding: '1.25rem', 
              background: 'linear-gradient(135deg, rgba(17, 153, 142, 0.2) 0%, rgba(56, 239, 125, 0.15) 100%)', 
              borderRadius: '8px',
              textAlign: 'center',
              border: '1px solid rgba(56, 239, 125, 0.3)',
              boxShadow: '0 4px 15px rgba(17, 153, 142, 0.2)'
            }}>
              <div style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '0.5rem' }}>🎯 평균 정답률</div>
              <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#38ef7d' }}>
                {stats.averageScore.toFixed(0)}%
              </div>
            </div>

            <div style={{ 
              padding: '1.25rem', 
              background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.15) 100%)', 
              borderRadius: '8px',
              textAlign: 'center',
              border: '1px solid rgba(102, 126, 234, 0.3)',
              boxShadow: '0 4px 15px rgba(102, 126, 234, 0.2)'
            }}>
              <div style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '0.5rem' }}>✍️ 푼 문제 수</div>
              <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#667eea' }}>
                {stats.totalQuestions}
              </div>
            </div>

            <div style={{ 
              padding: '1.25rem', 
              background: 'linear-gradient(135deg, rgba(240, 147, 251, 0.2) 0%, rgba(245, 87, 108, 0.15) 100%)', 
              borderRadius: '8px',
              textAlign: 'center',
              border: '1px solid rgba(240, 147, 251, 0.3)',
              boxShadow: '0 4px 15px rgba(240, 147, 251, 0.2)'
            }}>
              <div style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '0.5rem' }}>⏰ 총 학습 시간</div>
              <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#f093fb' }}>
                {Math.floor(stats.totalTimeSpent / 60)}분
              </div>
            </div>
          </div>

          {stats.recentScores.length > 0 && (
            <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', opacity: 0.9 }}>📈 최근 5회 성적</h3>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', height: '120px', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                {stats.recentScores.map((score, idx) => {
                  const color = score >= 80 ? '#38ef7d' : score >= 60 ? '#4facfe' : '#f5576c';
                  const gradient = score >= 80 
                    ? 'linear-gradient(180deg, #38ef7d 0%, #11998e 100%)'
                    : score >= 60 
                    ? 'linear-gradient(180deg, #4facfe 0%, #667eea 100%)'
                    : 'linear-gradient(180deg, #f5576c 0%, #f093fb 100%)';
                  
                  return (
                    <div 
                      key={idx} 
                      style={{ 
                        flex: 1, 
                        background: gradient,
                        height: `${Math.max(score, 10)}%`,
                        borderRadius: '8px 8px 0 0',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        paddingTop: '0.5rem',
                        fontSize: '0.85rem',
                        fontWeight: '700',
                        boxShadow: `0 -4px 15px ${color}66`,
                        position: 'relative',
                        transition: 'all 0.3s ease',
                        cursor: 'pointer'
                      }}
                      title={`시도 ${idx + 1}: ${score.toFixed(1)}%`}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-5px) scale(1.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0) scale(1)';
                      }}
                    >
                      {score.toFixed(0)}%
                      <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: '0.25rem' }}>
                        #{idx + 1}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Home;

