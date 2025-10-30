import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const Home: React.FC = () => {
    const [geminiEnabled, setGeminiEnabled] = useState<boolean | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);

    useEffect(() => {
        axios.get('http://localhost:8000/api/config/status')
            .then(res => {
                setGeminiEnabled(!!res.data.gemini_key_set);
            })
            .catch(() => {
                setGeminiEnabled(null);
                setStatusError('백엔드 상태를 확인할 수 없습니다. 서버가 실행 중인지 확인하세요.');
            });
    }, []);

    return (
        <div className="quiz-app-container">
            <div className="fluent-card" style={{textAlign: 'center'}}>
                <h1 className="fluent-card__question-text">AI 기반 맞춤형 퀴즈 학습</h1>
                <p style={{opacity: 0.8}}>시작하려면 과목을 선택하세요.</p>

                {geminiEnabled === true && (
                    <div className="inline-message success" style={{marginTop: '1rem'}}>
                        Gemini 키가 설정되어 있습니다. 단답/서술형은 AI 채점이 적용됩니다.
                    </div>
                )}
                {geminiEnabled === false && (
                    <div className="inline-message info" style={{marginTop: '1rem'}}>
                        Gemini 키가 설정되지 않았습니다. 단답/서술형은 키워드 기반 임시 채점이 적용됩니다.
                        더 정확한 평가를 위해 키를 설정하는 것을 권장합니다.
                        <div className="fluent-card__actions" style={{marginTop: '0.5rem', justifyContent: 'center'}}>
                            <button className="fluent-button" onClick={() => (window as any).__openKeyModal?.()}>Gemini 키 설정</button>
                        </div>
                    </div>
                )}
                {statusError && (
                    <div className="inline-message error" style={{marginTop: '1rem'}}>
                        {statusError}
                    </div>
                )}

                <div className="fluent-card__actions" style={{justifyContent: 'center'}}>
                    <Link className="fluent-button fluent-button--primary" to="/quiz/Data%20Analysis%20(EDA)">
                        EDA 퀴즈 시작
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default Home;
