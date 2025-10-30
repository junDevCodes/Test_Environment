import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import Home from './components/Home';
import Quiz from './components/Quiz';
import Results from './components/Results';

const App: React.FC = () => {
    const [needsKey, setNeedsKey] = useState<boolean>(false);
    const [apiKey, setApiKey] = useState<string>('');
    const [statusLoaded, setStatusLoaded] = useState<boolean>(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        axios.get('http://localhost:8000/api/config/status')
            .then(res => {
                setNeedsKey(!res.data.gemini_key_set);
                setStatusLoaded(true);
            })
            .catch(() => {
                // If status cannot be fetched, still allow entering a key
                setNeedsKey(true);
                setStatusLoaded(true);
            });
    }, []);

    // Expose a simple way for pages to open the key modal
    useEffect(() => {
        (window as any).__openKeyModal = () => setNeedsKey(true);
        return () => { try { delete (window as any).__openKeyModal; } catch { /* noop */ } };
    }, []);

    const handleSaveKey = () => {
        setSaveError(null);
        if (!apiKey.trim()) {
            setSaveError('Please enter a valid API key.');
            return;
        }
        axios.post('http://localhost:8000/api/config/gemini', { api_key: apiKey.trim() })
            .then(() => setNeedsKey(false))
            .catch(() => setSaveError('Failed to save API key.'));    
    };

    return (
        <Router>
            <div className="app">
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/quiz/:subject" element={<Quiz />} />
                    <Route path="/results" element={<Results />} />
                </Routes>

                {statusLoaded && needsKey && (
                    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="gemini-key-title">
                        <div className="modal">
                            <h2 id="gemini-key-title" className="fluent-card__question-text">Gemini API 키 입력</h2>
                            <p style={{opacity: 0.8}}>
                                단답/서술형 문제의 AI 채점을 위해 사용됩니다. 키는 서버 메모리에만 일시 저장되며,
                                디스크/DB/로그에 기록하지 않습니다. 서버 재시작 시 초기화됩니다.
                            </p>
                            <input
                                type="password"
                                className="text-input"
                                placeholder="Gemini API 키를 입력하세요"
                                value={apiKey}
                                onChange={e => setApiKey(e.target.value)}
                            />
                            {saveError && <div className="inline-message error" style={{marginTop: '0.75rem'}}>{saveError}</div>}
                            <div className="fluent-card__actions" style={{marginTop: '1rem'}}>
                                <button className="fluent-button" onClick={() => setNeedsKey(false)}>지금은 건너뛰기</button>
                                <button className="fluent-button fluent-button--primary" onClick={handleSaveKey}>키 저장</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Router>
    );
};

export default App;
