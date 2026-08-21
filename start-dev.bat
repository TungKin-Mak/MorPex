@echo off
setlocal
title MorPex Dev Launcher
cd /d "%~dp0"

echo ============================================================
echo    MorPex Dev Environment - One Click Launch
echo    Backend : node --watch + lazy-load O(1) :5473
echo    Frontend: Vite HMR + Tauri window :5173
echo    Closing the UI window stops all processes (concurrently -k)
echo ============================================================
echo.

REM ---- deps (skip if installed) ----
if exist "%~dp0node_modules" goto deps_ok
echo [deps] installing root deps (npm install)...
call npm install --no-audit --no-fund
:deps_ok
if exist "%~dp0packages\studio\web\node_modules" goto web_ok
echo [deps] installing web deps...
pushd "%~dp0packages\studio\web"
call npm install --no-audit --no-fund
popd
:web_ok
if exist "%~dp0packages\studio\desktop\node_modules" goto desktop_ok
echo [deps] installing desktop deps...
pushd "%~dp0packages\studio\desktop"
call npm install --no-audit --no-fund
popd
:desktop_ok

REM ---- clean stale backend on :5473 (LISTENING only; loop until clean) ----
REM   netstat LISTENING = the backend process itself. Killing its tree
REM   (/T) also drops its ESTABLISHED/TIME_WAIT connections. We only kill
REM   LISTENING PIDs to avoid killing browser/client processes that merely
REM   hold a connection to :5473. Loop with a bounded retry to catch
REM   multiple stale orphans (e.g. zombie node --watch) and delayed teardown.
echo [0/3] Cleaning stale backend on :5473 (if any)...
set tries=0
:killloop
set found=0
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5473" ^| findstr /i "LISTENING"') do (
  if not "%%a"=="0" (
    echo        Killing stale backend PID %%a
    taskkill /PID %%a /T /F >nul 2>&1
    set found=1
  )
)
set /a tries+=1
if "%found%"=="1" if %tries% LSS 10 (
  ping -n 2 127.0.0.1 >nul
  goto killloop
)
echo        Port 5473 clean.

REM ---- desktop (Vite + Tauri + backend, concurrently -k) ----
echo [1/3] Starting desktop app + backend (Vite HMR + Tauri window)...
cd /d "%~dp0\packages\studio\desktop"
start "MorPex-Desktop" cmd /k "npm run dev:all"

echo        Waiting for backend (boot ~6s)...
set n=0
:waitloop
ping -n 4 127.0.0.1 >nul
curl -s -o nul -m 1 http://localhost:5473/api/health 2>nul && goto backend_ready
set /a n+=1
if %n% LSS 40 goto waitloop
echo        WARNING: backend not ready in ~120s. Checking anyway.
:backend_ready
echo        Backend ready.

echo.
echo [3/3] Done! One window opened: "MorPex-Desktop"
echo    (contains Vite HMR + Tauri window + backend; closing it exits all)
echo.
pause
exit /b 0
