@echo off
cd /d "%~dp0"
echo.
echo Uninstall RouteRich panel from router...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-RouteRich.ps1" %*
echo.
pause