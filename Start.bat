@echo off
rem ============================================================
rem  GrooveLab - one-click launcher
rem
rem    1. checks Node.js
rem    2. installs dependencies on first run
rem    3. builds the app when the source changed (takes ~15 s)
rem    4. serves the built app on port 5174 (installable, works offline)
rem    5. opens http://localhost:5174 in Chrome (or the default browser)
rem
rem  If the build fails it falls back to the development server.
rem  Close this window to stop the server.
rem  ASCII-only on purpose: cmd.exe reads .bat files in the OEM
rem  code page, so Chinese text here would be garbled.
rem ============================================================

setlocal
cd /d "%~dp0"
title GrooveLab
set "URL=http://localhost:5174"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js was not found.
  echo  Install Node.js 20 or newer from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

rem Already running? Just open the browser.
netstat -ano | findstr /r /c:":5174 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo  GrooveLab is already running. Opening the browser...
  call :open
  exit /b 0
)

if not exist "node_modules\" (
  echo  First run: installing dependencies, this takes a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [ERROR] npm install failed. Check your network and try again.
    pause
    exit /b 1
  )
)

rem Rebuild when dist is missing or any source file is newer than the last build.
set "MODE=preview"
powershell -NoProfile -Command ^
  "$b='dist\index.html'; if(-not (Test-Path $b)){exit 1}; $t=(Get-Item $b).LastWriteTime; $n=Get-ChildItem -Recurse -File src,public,index.html,package.json,vite.config.ts | Where-Object { $_.LastWriteTime -gt $t } | Select-Object -First 1; if($n){exit 1}else{exit 0}"
if errorlevel 1 (
  echo  Building GrooveLab, this takes about 15 seconds...
  call npm run build
  if errorlevel 1 (
    echo.
    echo  [WARN] Build failed. Starting the development server instead.
    set "MODE=dev"
  )
)

rem Start the local separation helper too when it is installed (helper\install.bat).
if exist "helper\.venv\Scripts\python.exe" (
  netstat -ano | findstr /r /c:":5175 .*LISTENING" >nul 2>nul
  if errorlevel 1 start "GrooveLab helper" /min cmd /c helper\start.bat
)

rem Open the browser in the background once the server answers.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "for($i=0;$i -lt 120;$i++){try{Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 1 | Out-Null; try{Start-Process chrome '%URL%'}catch{Start-Process '%URL%'}; break}catch{Start-Sleep -Milliseconds 500}}"

echo.
echo  Starting GrooveLab at %URL%
echo  Keep this window open while you practise. Close it to stop.
echo  Tip: in Chrome, use the install icon in the address bar to add GrooveLab as an app.
echo.
if "%MODE%"=="dev" (
  call npm run dev
) else (
  call npm run preview
)

endlocal
exit /b 0

:open
powershell -NoProfile -Command "try{Start-Process chrome '%URL%'}catch{Start-Process '%URL%'}"
exit /b 0
