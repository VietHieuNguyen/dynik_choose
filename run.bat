@echo off
title DYNIK Trac Nghiem
cd /d "%~dp0"
echo ==============================================
echo Dang khoi dong DYNIK Quiz tai http://localhost:4173/
echo Nhan Ctrl+C de dung server.
echo ==============================================
start http://localhost:4173/
node serve.js
pause
