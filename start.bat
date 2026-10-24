@echo off
rem Double-click on Windows. Serves the ready-built app from web\dist and opens it in the browser.
rem Close this window to stop it.

cd /d "%~dp0web\dist" || (echo web\dist is missing. Run: npm --prefix web ci ^&^& npm --prefix web run build & pause & exit /b 1)
set PORT=5173
echo SMBO is running at http://localhost:%PORT%
echo Leave this window open while you look. Close it to stop.
start "" http://localhost:%PORT%

where py >nul 2>nul && (py -3 -m http.server %PORT% & goto :eof)
where python >nul 2>nul && (python -m http.server %PORT% & goto :eof)
where npx >nul 2>nul && (npx --yes serve -l %PORT% . & goto :eof)
echo Needs Python 3 (python.org) or Node.js (nodejs.org) to serve the page. Install either and run this again.
pause
