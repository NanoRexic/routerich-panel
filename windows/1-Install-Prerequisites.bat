@echo off
cd /d "%~dp0"
echo.
echo [Step 1/2] Install PC dependencies...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Prerequisites.ps1"
echo.
pause