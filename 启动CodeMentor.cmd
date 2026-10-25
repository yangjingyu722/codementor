@echo off
chcp 65001 >nul
title CodeMentor Core Service
cd /d "%~dp0"
node tools\start-service.mjs
pause
