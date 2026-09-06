#!/bin/bash
# comfy-headless.sh - bring a local ComfyUI up on 127.0.0.1:8188, headless.
#
# Idempotent: if the server already answers, this exits 0 immediately. Otherwise it starts
# ComfyUI detached (nohup, log in the drafts dir) and polls until the API responds.
#
# Deliberately never calls `open`: a scheduled run has no desktop session, and the desktop
# launcher (~/Desktop/ComfyUI.command) stays the way a human starts it interactively.
#
# Env overrides: SHIPPOST_COMFY_DIR (default ~/ComfyUI), SHIPPOST_COMFY_URL, SHIPPOST_COMFY_PORT.

SELF_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
source "$SELF_DIR/lib/config.sh"

COMFY_DIR="${SHIPPOST_COMFY_DIR:-$HOME/ComfyUI}"
PORT="${SHIPPOST_COMFY_PORT:-8188}"
URL="${SHIPPOST_COMFY_URL:-http://127.0.0.1:$PORT}"
WAIT_SECONDS=180
LOG="$CFG_OUTPUT_DIR/.comfy.log"

up() { curl -fsS -m 5 "$URL/system_stats" >/dev/null 2>&1; }

if up; then
  echo "ComfyUI already up at $URL"
  exit 0
fi

PYTHON="$COMFY_DIR/venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  echo "shippost: no ComfyUI venv at $PYTHON" >&2
  echo "  Install ComfyUI (https://github.com/comfyanonymous/ComfyUI) or set SHIPPOST_COMFY_DIR." >&2
  exit 1
fi

mkdir -p "$CFG_OUTPUT_DIR"
cd "$COMFY_DIR" || exit 1
# --reserve-vram 6 leaves headroom for the OS: the fp8 checkpoint has no fp8 compute path on
# Apple silicon, so it upcasts to ~20-24 GB of unified memory while sampling.
nohup "$PYTHON" main.py --port "$PORT" --listen 127.0.0.1 --reserve-vram 6 >> "$LOG" 2>&1 &
pid=$!
echo "starting ComfyUI (pid $pid), log: $LOG"

waited=0
while [ "$waited" -lt "$WAIT_SECONDS" ]; do
  if up; then
    echo "ComfyUI ready at $URL after ${waited}s"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "shippost: ComfyUI exited during startup - see $LOG" >&2
    exit 1
  fi
  sleep 3
  waited=$((waited + 3))
done

echo "shippost: ComfyUI did not answer within ${WAIT_SECONDS}s - see $LOG" >&2
exit 1
