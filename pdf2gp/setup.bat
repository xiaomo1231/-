@echo off
rem Sets up the Python environment for the PDF to GP5 helper (pdf2gp\.venv). Run once.
rem Needs Python 3.11 or newer (install from python.org and tick "Add python.exe to PATH").
cd /d "%~dp0"

set PYCMD=python
where py >nul 2>nul
if not errorlevel 1 set PYCMD=py -3

%PYCMD% -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
if errorlevel 1 goto :oldpython

if exist .venv\Scripts\python.exe goto :havevenv
%PYCMD% -m venv .venv
if errorlevel 1 goto :novenv
:havevenv

.venv\Scripts\python.exe -m pip install --upgrade pip >nul
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto :installfailed

echo PDF to GP5 helper: installed OK.
exit /b 0

:oldpython
echo Python 3.11 or newer is required. Install it from https://www.python.org (tick "Add python.exe to PATH").
pause
exit /b 1

:novenv
echo Could not create the virtual environment pdf2gp\.venv.
pause
exit /b 1

:installfailed
echo Installation failed. Check the internet connection and run setup.bat again.
pause
exit /b 1
