@echo off
rem ============================================================
rem  GrooveLab local separation helper - one-time install
rem
rem    1. installs Python 3.12 with the Python install manager (py)
rem    2. creates helper\.venv
rem    3. installs audio-separator (UVR engine, MIT) and PyTorch
rem       (CUDA build when an NVIDIA GPU is present)
rem  About 3-4 GB. Models (~1 GB) download on the first separation.
rem  ASCII-only on purpose (cmd.exe code page).
rem ============================================================
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] The Python install manager "py" was not found.
  echo  Install it from https://www.python.org/downloads/ and run this again.
  pause
  exit /b 1
)
py install 3.12
if not exist ".venv\Scripts\python.exe" (
  py -V:3.12 -m venv .venv || (echo  [ERROR] Could not create the virtual environment. & pause & exit /b 1)
)
".venv\Scripts\python.exe" -m pip install --upgrade pip
where nvidia-smi >nul 2>nul
if errorlevel 1 (
  echo  No NVIDIA GPU found: installing the CPU version.
  ".venv\Scripts\python.exe" -m pip install "audio-separator[cpu]" || goto fail
) else (
  ".venv\Scripts\python.exe" -m pip install "audio-separator[gpu]" || goto fail
  ".venv\Scripts\python.exe" -m pip install --force-reinstall --no-deps torch torchvision --index-url https://download.pytorch.org/whl/cu128 || goto fail
)
rem audioread is no longer pulled in by librosa; torch wants setuptools < 82.
".venv\Scripts\python.exe" -m pip install audioread "setuptools<82" || goto fail
where ffmpeg >nul 2>nul
if errorlevel 1 echo  [WARN] ffmpeg was not found. mp3/m4a input needs it: winget install Gyan.FFmpeg
echo.
echo  Done. Start.bat will now start the helper together with GrooveLab.
pause
exit /b 0
:fail
echo  [ERROR] Installing packages failed. Check your network and run this again.
pause
exit /b 1
