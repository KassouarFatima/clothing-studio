#!/bin/bash
# Double-click to open Atelier City: starts the local server (it keeps the AI keys private) and opens the browser.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT=8792
if ! lsof -i :$PORT >/dev/null 2>&1; then
  nohup node server.mjs > server.log 2>&1 &
  disown
  for i in $(seq 1 240); do # first start can take a while: macOS checks the image library once
    curl -s -o /dev/null "http://localhost:$PORT/" && break
    sleep 0.5
  done
fi
open "http://localhost:$PORT/street.html"
(sleep 0.5; osascript -e 'tell application "Terminal" to close (every window whose name contains "Open Atelier City")') >/dev/null 2>&1 &
disown
exit 0
