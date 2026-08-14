@echo off
setlocal
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%NODE_EXE%" goto run
where node >nul 2>nul
if errorlevel 1 goto no_node
set "NODE_EXE=node"

:run
"%NODE_EXE%" "%~dp0refresh-tour-data.mjs"
if errorlevel 1 goto failed
echo.
echo TourAPI, ferry API, and weather API data refresh completed.
pause
exit /b 0

:no_node
echo Node.js was not found.
pause
exit /b 1

:failed
echo.
echo Public API refresh failed. Check TOUR_API_KEY in .env and API usage approvals.
pause
exit /b 1
