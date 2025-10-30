import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { setDbSet } from '../lib/api';

interface SetItem { name: string }

const displayName = (filename: string) => filename.replace(/_prob\.db$/i, '').replace(/\.db$/i, '');

const SelectSet: React.FC = () => {
  const [sets, setSets] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/sets')
      .then(res => {
        const list = (res.data || []).map((s: SetItem) => s.name);
        setSets(list);
        setLoading(false);
      })
      .catch(() => {
        setError('문제 세트 목록을 불러올 수 없습니다.');
        setLoading(false);
      });
  }, []);

  const canStart = !!selected;

  return (
    <div className="quiz-app-container">
      <div className="fluent-card">
        <h1 className="fluent-card__question-text" style={{ textAlign: 'center' }}>문제 세트 선택</h1>
        {loading && <div>불러오는 중...</div>}
        {error && <div className="inline-message error">{error}</div>}

        {!loading && !error && (
          <>
            {sets.length > 0 ? (
              <div className="set-list">
                {sets.map(name => (
                  <div
                    key={name}
                    className={`set-item ${selected === name ? 'selected' : ''}`}
                    onClick={() => setSelected(name)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(name); }}
                    aria-pressed={selected === name}
                  >
                    <span className="set-item__name">{displayName(name)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="inline-message info">문제 세트를 찾을 수 없습니다.</div>
            )}
            <div className="fluent-card__actions" style={{ marginTop: '1rem' }}>
              <button className="fluent-button" onClick={() => navigate(-1)}>뒤로가기</button>
              <button
                className="fluent-button fluent-button--primary"
                disabled={!canStart}
                onClick={() => { if (selected) { setDbSet(selected); navigate('/quiz/all'); } }}
              >
                시작
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SelectSet;
