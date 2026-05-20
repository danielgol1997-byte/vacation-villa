#!/bin/bash
# Double-click this file in Finder to launch the Villa vacation site.
#
# What it does:
#   1. cd into the project directory (where this script lives)
#   2. Make sure node_modules is installed
#   3. Start `npm run dev` and wait for http://localhost:3000 to respond
#   4. Open Chrome (or your default browser) at the site
#   5. Keep the Terminal window open so the dev server stays alive.
#      Close the window (or Ctrl+C) to stop the server.

set -u

# Resolve project dir even if the user double-clicks from elsewhere.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR" || {
  echo "Could not cd into project directory: $SCRIPT_DIR"
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
}

clear
echo "================================================="
echo "  Villa — שישי בוילה"
echo "  $SCRIPT_DIR"
echo "================================================="
echo ""

# --- pick a node binary ---------------------------------------------------
# Finder launches .command files with a very minimal PATH (basically /usr/bin
# only), so `node` / `npm` are not on the PATH even when they're installed via
# Homebrew / nvm / Volta. Source the user's shell init so PATH is correct.

# Make Homebrew (Apple Silicon) visible if it exists.
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
fi
if [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null || true
fi

# Source common shell rc files so nvm / asdf / Volta land on the PATH.
for rc in "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.bashrc"; do
  if [ -f "$rc" ]; then
    # shellcheck disable=SC1090
    source "$rc" >/dev/null 2>&1 || true
  fi
done

# Lazy-load nvm if installed but not yet sourced.
if [ -z "${NVM_DIR:-}" ] && [ -d "$HOME/.nvm" ]; then
  export NVM_DIR="$HOME/.nvm"
fi
if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: 'npm' was not found on PATH."
  echo "Install Node.js from https://nodejs.org/ (LTS is fine) and try again."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo "Using Node:  $(command -v node) ($(node --version 2>/dev/null))"
echo "Using npm:   $(command -v npm)  ($(npm --version 2>/dev/null))"
echo ""

# --- install deps if missing ---------------------------------------------
if [ ! -d node_modules ]; then
  echo "First-time setup: installing dependencies (this takes ~1 minute)..."
  echo ""
  npm install || {
    echo ""
    echo "ERROR: npm install failed."
    read -n 1 -s -r -p "Press any key to close..."
    exit 1
  }
  echo ""
fi

# --- pick a free port and start dev server -------------------------------
PORT=3000
URL="http://localhost:${PORT}"

# If something else is already serving on 3000, just open the browser at it.
if curl --silent --max-time 1 --output /dev/null "$URL"; then
  echo "A server is already responding at $URL — opening browser."
  echo "(If you want to restart it, close that process and run this again.)"
  open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
  echo ""
  echo "This window can be closed."
  read -n 1 -s -r -p "Press any key to close..."
  exit 0
fi

echo "Starting dev server on port ${PORT}..."
echo "(Close this Terminal window to stop the server.)"
echo ""

# Start npm run dev in the foreground so Ctrl+C / closing the window
# cleanly tears it down. We background it just long enough to wait for the
# port to come up, then we wait on the PID for the rest of the session.
npm run dev -- --port "$PORT" &
DEV_PID=$!

cleanup() {
  echo ""
  echo "Shutting down dev server (pid $DEV_PID)..."
  # Kill the whole process group so Next's child workers go down too.
  kill -TERM "-$DEV_PID" 2>/dev/null || kill -TERM "$DEV_PID" 2>/dev/null || true
  wait "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- wait for server to respond, then open browser -----------------------
echo -n "Waiting for $URL "
ATTEMPTS=0
MAX_ATTEMPTS=60
while ! curl --silent --max-time 1 --output /dev/null "$URL"; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo ""
    echo ""
    echo "ERROR: server didn't come up after ${MAX_ATTEMPTS}s."
    echo "Scroll up to see the dev server output for clues."
    wait "$DEV_PID"
    exit 1
  fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo ""
    echo ""
    echo "ERROR: dev server exited before becoming ready."
    exit 1
  fi
  echo -n "."
  sleep 1
done
echo " ready."
echo ""

# Prefer Chrome (matches the user's stated workflow), fall back to default.
if open -Ra "Google Chrome" 2>/dev/null; then
  open -a "Google Chrome" "$URL"
else
  open "$URL"
fi

echo "Open at: $URL"
echo "Logs below — press Ctrl+C or close this window to stop."
echo "================================================="

# Hand control back to npm run dev so its logs stream to this window.
wait "$DEV_PID"
