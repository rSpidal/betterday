#!/bin/zsh
# Double-click to open the local app. Closing this Terminal window stops the preview.
cd -- "${0:A:h}" || exit 1
betterday_python="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
if [[ ! -x "$betterday_python" ]]; then
  betterday_python="$(command -v python3)"
fi
if [[ -z "$betterday_python" ]]; then
  print 'Python 3 is needed to open this local preview.'
  read '?Press Return to close.'
  exit 1
fi
"$betterday_python" - <<'PY'
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import webbrowser

try:
    server = ThreadingHTTPServer(('127.0.0.1', 8080), SimpleHTTPRequestHandler)
except OSError:
    print('Port 8080 is already in use. Close the earlier local preview and try again.')
    input('Press Return to close.')
    raise SystemExit(1)

print('BetterDay is open at http://127.0.0.1:8080/#schedule')
print('Keep this window open while using BetterDay. Close it to stop the preview.')
webbrowser.open('http://127.0.0.1:8080/#schedule')
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
