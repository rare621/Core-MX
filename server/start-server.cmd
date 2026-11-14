@echo off
title MX Bikes Manager online service
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed on this PC.
  echo Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
echo Keep this window open while people use the service. Close it to stop.
echo.
node mxbm-server.js --port 60000
pause
