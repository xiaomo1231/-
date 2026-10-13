@echo off
rem Starts the GrooveLab separation helper (127.0.0.1:5175). ASCII-only.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo  The helper is not installed yet. Run helper\install.bat first.
  pause
  exit /b 1
)
title GrooveLab helper
".venv\Scripts\python.exe" server.py
