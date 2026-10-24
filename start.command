#!/bin/bash
# Double-click on a Mac (or run ./start.command anywhere with bash). Serves the ready-built app
# from web/dist and opens it in the browser. Ctrl+C in this window stops it.

cd "$(dirname "$0")/web/dist" || { echo "web/dist is missing. Run: npm --prefix web ci && npm --prefix web run build"; exit 1; }
PORT="${PORT:-5173}"
URL="http://localhost:$PORT"

# the browser opens once the server has had a second to start
( sleep 1.5; (open "$URL" || xdg-open "$URL") >/dev/null 2>&1 ) &

echo "SMBO is running at $URL"
echo "Leave this window open while you look. Ctrl+C stops it."
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  npx --yes serve -l "$PORT" .
else
  echo "Needs Python 3 (python.org) or Node.js (nodejs.org) to serve the page. Install either and run this again."
  read -r -p "Press Enter to close."
fi
