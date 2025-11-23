@echo off
echo ====================================
echo   Quiz App Backend Server
echo ====================================
echo.
echo Starting backend server...
echo Server will run on http://localhost:8000
echo.
echo Press CTRL+C to stop the server
echo.

cd /d %~dp0
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

pause

