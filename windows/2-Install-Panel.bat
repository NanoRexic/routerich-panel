@echo off
cd /d "%~dp0"
echo.
echo [Step 2/2] Install panel on router...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-RouteRich.ps1" %*
echo.
pause