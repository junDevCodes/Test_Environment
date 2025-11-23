@echo off
echo ====================================
echo   Quiz App Frontend
echo ====================================
echo.
echo Starting frontend dev server...
echo Frontend will run on http://localhost:5173
echo.
echo Press CTRL+C to stop the server
echo.

cd /d %~dp0
npm run dev

pause

