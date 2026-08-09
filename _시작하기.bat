@echo off
chcp 65001 >nul
title ON-FARM 서버
cd /d "%~dp0"
echo.
echo  [ON-FARM] 처음이면 의존성 설치와 빌드를 먼저 합니다 (1~2분).
echo.
if not exist node_modules ( call npm install --no-audit --no-fund )
call npm run build
if errorlevel 1 ( echo 빌드 실패 — 위 오류를 확인하세요. & pause & exit /b 1 )
echo.
echo  서버를 시작합니다. 브라우저에서 여세요:
echo    시연 시작   http://127.0.0.1:4173/demo
echo    농민 화면   http://127.0.0.1:4173/farmer
echo    소비자 매장 http://127.0.0.1:4173/
echo.
start "" http://127.0.0.1:4173/demo
node dist/server/main.js
pause
