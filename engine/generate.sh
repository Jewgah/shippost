#!/bin/bash
# generate.sh — scheduler wrapper for the shippost content engine.
#  - enforces the ~2-day gap (so daily firing => every other day)
#  - runs the engine headless on the user's own Claude subscription
#  - notifies on success AND failure so silent breakage surfaces
#
# Config-driven (sources lib/config.sh). Safe to run by hand or from launchd/cron.

SELF_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
source "$SELF_DIR/lib/config.sh"
set +e  # we handle errors explicitly below

# --force (or SHIPPOST_FORCE=1) skips the 2-day guard — used by on-demand runs
# (the app's "Generate" button, or a manual `generate.sh --force`).
FORCE=0
case "${1:-}" in --force|-f) FORCE=1 ;; esac
[ "${SHIPPOST_FORCE:-0}" = "1" ] && FORCE=1

BOOST_DIR="$CFG_OUTPUT_DIR"
LAST_RUN="$BOOST_DIR/.last_run"
LOG="$BOOST_DIR/.run.log"
MIN_GAP=$(( CFG_MIN_GAP_HOURS * 3600 ))

mkdir -p "$BOOST_DIR"

notify() { # $1 = message, $2 = sound (macOS only)
  if [ "$(uname)" = "Darwin" ]; then
    /usr/bin/osascript -e "display notification \"$1\" with title \"shippost\" sound name \"$2\"" 2>/dev/null
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send "shippost" "$1" 2>/dev/null
  else
    echo "shippost: $1" >&2
  fi
}

# --- 2-day guard (skipped when --force / on-demand) ---
now=$(date +%s)
if [ "$FORCE" -ne 1 ] && [ -f "$LAST_RUN" ]; then
  last=$(cat "$LAST_RUN" 2>/dev/null || echo 0)
  [ -z "$last" ] && last=0
  if [ $((now - last)) -lt "$MIN_GAP" ]; then
    echo "$(date '+%F %T') guard: only $((now - last))s since last run (< ${MIN_GAP}s), skipping" >> "$LOG"
    exit 0
  fi
fi

today=$(date +%F)
draft="$BOOST_DIR/$today.md"
echo "$(date '+%F %T') starting generation -> $draft" >> "$LOG"

PROMPT="Run the shippost post pipeline now. Read and follow $CFG_SKILL_MD exactly, start to finish. Language: $CFG_LANGUAGE. Today is $today. Produce 5 ranked, distinct options and save them to this exact path: $draft . Do not ask any questions — make the best editorial choices and write the file."

"$CFG_CLAUDE_BIN" -p "$PROMPT" \
  --allowed-tools $CFG_ALLOWED_TOOLS \
  --model "$CFG_MODEL" \
  >> "$LOG" 2>&1
rc=$?

if [ "$rc" -eq 0 ] && [ -f "$draft" ]; then
  date +%s > "$LAST_RUN"
  echo "$(date '+%F %T') SUCCESS: $draft" >> "$LOG"
  notify "5 drafts ready — open the shippost app, pick one" "Glass"
else
  echo "$(date '+%F %T') FAILED rc=$rc draft_exists=$([ -f "$draft" ] && echo yes || echo no)" >> "$LOG"
  notify "draft generation FAILED (rc=$rc) — check .run.log in your drafts dir" "Basso"
fi
