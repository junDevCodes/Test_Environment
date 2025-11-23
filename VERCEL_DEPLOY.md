# 🚀 Vercel 배포 가이드

## 📋 배포 전 체크리스트

### 1️⃣ **Vercel 프로젝트 설정**

Vercel 대시보드에서 프로젝트 Settings → General:

```
Root Directory: frontend
Build Command: npm run build
Output Directory: dist
Install Command: npm install
Node Version: 18.x
```

### 2️⃣ **환경 변수 설정** ⚠️ **필수**

Vercel 대시보드 → Settings → Environment Variables:

```bash
# 백엔드 API URL (Render 배포 URL)
VITE_API_BASE_URL=https://your-backend-name.onrender.com

# 예시:
# VITE_API_BASE_URL=https://quiz-backend-abc123.onrender.com
```

**중요**: `VITE_` 접두사 필수! (Vite 환경 변수 규칙)

### 3️⃣ **Git Push 트리거**

```bash
# 변경사항 푸시
git add .
git commit -m "chore: update vercel config"
git push origin main
```

Vercel이 자동으로 배포를 시작합니다.

---

## 🔧 배포 실패 시 해결 방법

### **문제 1: 404 에러 발생**

**원인**: SPA 라우팅 문제

**해결**: `vercel.json` 파일이 프로젝트 루트에 있는지 확인

### **문제 2: API 호출 실패 (Failed to load questions)**

**원인**: 환경 변수 미설정 또는 잘못된 백엔드 URL

**해결**:
1. Vercel 대시보드 → Settings → Environment Variables
2. `VITE_API_BASE_URL` 확인
3. 백엔드 URL이 정확한지 확인 (https:// 포함, 끝에 / 없음)
4. 재배포: Deployments → ... → Redeploy

### **문제 3: 빌드 실패**

**원인**: 의존성 설치 오류 또는 TypeScript 오류

**해결**:
1. Vercel 대시보드 → Deployments → 최신 배포 → View Build Logs
2. 에러 로그 확인
3. 로컬에서 빌드 테스트:
   ```bash
   cd frontend
   npm run build
   ```

### **문제 4: CSS가 적용 안됨**

**원인**: 빌드 출력 디렉토리 잘못 설정

**해결**:
- Output Directory를 `dist`로 설정 (frontend/dist 아님!)
- Vercel은 Root Directory가 `frontend`라서 자동으로 `frontend/dist`를 찾음

---

## 🎯 배포 확인

### **1. Vercel 대시보드**
- Deployments 탭에서 "Ready" 상태 확인
- Visit 버튼으로 사이트 접속

### **2. 브라우저 테스트**
1. 배포된 URL 접속
2. F12 → Network 탭
3. `/api/` 요청 확인
4. CORS 에러가 있다면 → 백엔드 CORS 설정 확인

### **3. 백엔드 CORS 설정 확인**

`app/main.py`에서:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://your-vercel-app.vercel.app",  # ← Vercel URL 추가
        "*"  # 개발 중에만 사용, 프로덕션에서는 제거 권장
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 📊 배포 후 확인 사항

✅ 홈 화면 로딩
✅ 문제집 선택 화면
✅ 퀴즈 시작 (문제 로딩)
✅ 답안 제출
✅ 결과 화면
✅ 통계 대시보드
✅ 모든 새 기능 (타이머, 북마크, 오답노트 등)

---

## 🆘 여전히 안되면?

### **방법 1: Vercel 재배포 강제**
```bash
# 빈 커밋으로 재배포 트리거
git commit --allow-empty -m "chore: trigger vercel redeploy"
git push origin main
```

### **방법 2: Vercel CLI 사용**
```bash
# Vercel CLI 설치
npm i -g vercel

# 로그인
vercel login

# 수동 배포
cd frontend
vercel --prod
```

### **방법 3: Vercel 프로젝트 재연결**
1. Vercel 대시보드에서 프로젝트 삭제
2. "New Project" → GitHub 저장소 다시 연결
3. Root Directory를 `frontend`로 설정
4. 환경 변수 다시 설정
5. Deploy

---

## 🔗 유용한 링크

- [Vercel Documentation](https://vercel.com/docs)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [Environment Variables in Vite](https://vitejs.dev/guide/env-and-mode.html)

---

## 📝 현재 커밋 상태

```bash
# 최신 커밋
9af8f81 - feat: UI/UX개선
872e4b4 - fix: Quiz 컴포넌트에서 localStorage DB set 복원 로직 추가
8e9ef00 - feat: 고급 디자인 요소 추가
```

모든 기능이 Git에 push 되어 있으므로 Vercel에서 최신 코드로 배포됩니다!

