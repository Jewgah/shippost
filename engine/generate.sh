#!/bin/bash
# generate.sh — scheduler wrapper for the shippost content engine.
#  - enforces the minGapHours gap (so daily firing => every other day; a weekly schedule
#    wants a lower gap, see engine/schedule/)
#  - runs the engine headless on the user's own Claude subscription
#  - notifies on success AND failure so silent breakage surfaces, writes the run's outcome
#    to .last_generate.json, and appends failures to .failures.log
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
  [ "${SHIPPOST_NO_NOTIFY:-0}" = "1" ] && return 0 # tests/CI: no desktop notifications
  if [ "$(uname)" = "Darwin" ]; then
    local url="http://localhost:${CFG_APP_PORT:-3030}/"
    # Resolve terminal-notifier even under a minimal launchd PATH: try PATH first,
    # then the usual Homebrew locations (arm64 + Intel).
    local tn
    tn="$(command -v terminal-notifier 2>/dev/null)"
    if [ -z "$tn" ]; then
      for c in /opt/homebrew/bin/terminal-notifier /usr/local/bin/terminal-notifier; do
        [ -x "$c" ] && { tn="$c"; break; }
      done
    fi
    if [ -n "$tn" ]; then
      # terminal-notifier lets the notification's CLICK open the app.
      "$tn" -title "shippost" -message "$1" -open "$url" ${2:+-sound "$2"} >/dev/null 2>&1
    else
      # Fallback: a plain notification. NOTE: clicking an osascript notification
      # opens Script Editor (a macOS quirk — osascript "owns" the notification).
      # Install terminal-notifier for a clickable "open shippost" action:
      #   brew install terminal-notifier
      /usr/bin/osascript -e "display notification \"$1\" with title \"shippost\" sound name \"$2\"" 2>/dev/null
    fi
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
  case "$last" in ''|*[!0-9]*) last=0 ;; esac # a corrupt .last_run must not break the arithmetic
  if [ $((now - last)) -lt "$MIN_GAP" ]; then
    echo "$(date '+%F %T') guard: only $((now - last))s since last run (< ${MIN_GAP}s), skipping" >> "$LOG"
    exit 0
  fi
fi

today=$(date +%F)
# Each run gets its own timestamped file so multiple generations on the same day
# don't overwrite each other. The app passes SHIPPOST_STAMP so it can predict the
# output path; scheduled/manual runs fall back to computing their own.
stamp="${SHIPPOST_STAMP:-$(date +%F_%H%M%S)}"
draft="$BOOST_DIR/$stamp.md"
echo "$(date '+%F %T') starting generation -> $draft" >> "$LOG"

PROMPT="Run the shippost post pipeline now. Read and follow $CFG_SKILL_MD exactly, start to finish. Language: $CFG_LANGUAGE. Today is $today. Produce 5 ranked, distinct options and save them to this exact path: $draft . Do not ask any questions — make the best editorial choices and write the file."

# Optional per-run steering passed from the app via env vars. Appended to the prompt;
# SHIPPOST_PROJECT additionally scopes the harvest (see harvest.sh).
FOCUS=""
[ -n "${SHIPPOST_PROJECT:-}" ]  && FOCUS="$FOCUS Scope this run to the project '${SHIPPOST_PROJECT}' only — base every option on that project's recent work."
[ -n "${SHIPPOST_CATEGORY:-}" ] && FOCUS="$FOCUS Bias the 5 options toward the '${SHIPPOST_CATEGORY}' pillar."
[ -n "${SHIPPOST_FOCUS:-}" ]    && FOCUS="$FOCUS Direction from the user — honor it above generic editorial choices: \"${SHIPPOST_FOCUS}\"."
if [ -n "$FOCUS" ]; then
  PROMPT="$PROMPT  Additional steering for THIS run:$FOCUS"
  echo "$(date '+%F %T') steering:$FOCUS" >> "$LOG"
fi

# Posting mode (personal-only is the default; company mode is opt-in in Settings).
if [ "${SHIPPOST_COMPANY_MODE:-0}" = "1" ]; then
  PROMPT="$PROMPT  Mode: COMPANY — each option keeps a company-page post (section A) AND a short first-person repost caption (section B), exactly as the SKILL specifies."
else
  PROMPT="$PROMPT  Mode: PERSONAL-ONLY — write each option as ONE first-person post for the author's OWN LinkedIn profile (not a company page). Put that single post under '**A. Company post**' and OMIT section B entirely (no repost caption). Everything else (header, '**C. First comment**' when the option has a link, _Why it works:_, _Suggested visuals:_) stays as specified."
fi

# shellcheck disable=SC2086 # CFG_ALLOWED_TOOLS is a deliberate space-separated arg list
"$CFG_CLAUDE_BIN" -p "$PROMPT" \
  --allowed-tools $CFG_ALLOWED_TOOLS \
  --model "$CFG_MODEL" \
  >> "$LOG" 2>&1
rc=$?

RESULT="$BOOST_DIR/.last_generate.json"
FAILURES="$BOOST_DIR/.failures.log"
PICKS="$BOOST_DIR/$CFG_PICKS_LOG_FILE"

# Machine-readable outcome of THIS run, in the shape the app writes after a button run
# ({ok, date, finishedAt, code}; see app/app/api/generate/route.ts), so a scheduled run
# leaves the same trace instead of a file only the app ever refreshed.
write_result() { # $1 = ok (true|false), $2 = exit code
  jq -nc --argjson ok "$1" --arg date "$stamp" --argjson finishedAt "$(( $(date +%s) * 1000 ))" --argjson code "$2" \
    '{ok: $ok, date: $date, finishedAt: $finishedAt, code: $code}' > "$RESULT.tmp" 2>/dev/null \
    && mv -f "$RESULT.tmp" "$RESULT"
}

# Unpicked drafts newer than the newest pick: draft ids sort lexically (YYYY-MM-DD_HHMMSS),
# so "newer" is a string compare against the picked draft's id. $1 = that id.
count_waiting() {
  local picked n=0 f id
  local LC_ALL=C # deterministic string compare whatever locale the caller runs under
  picked="$(jq -R 'fromjson? | .date? // empty | select(type=="string")' "$PICKS" 2>/dev/null | jq -rs 'unique[]' 2>/dev/null)"
  for f in "$BOOST_DIR"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*.md; do
    [ -f "$f" ] || continue
    id="$(basename "$f" .md)"
    [[ "$id" > "$1" ]] || continue
    grep -qxF "$id" <<< "$picked" && continue
    n=$((n + 1))
  done
  printf '%s' "$n"
}

# The success notification: the plain "drafts ready" line, unless the author has gone quiet
# (newest pick older than 5 days). Then it says for how long and how many drafts are waiting,
# so a batch nobody reads stops looking like success. jq's fromdateiso8601 rejects the
# fractional seconds every app-written ts carries, hence the sub() before parsing.
success_message() {
  local msg="5 drafts ready, open the shippost app and pick one"
  [ -f "$PICKS" ] || { printf '%s' "$msg"; return; }
  local newest last_epoch last_date days waiting
  newest="$(jq -R 'fromjson? | select(type == "object" and (.ts | type) == "string" and (.date | type) == "string")
                   | {date: .date, epoch: (.ts | sub("\\.[0-9]+"; "") | try fromdateiso8601 catch empty)}' "$PICKS" 2>/dev/null \
            | jq -rs 'max_by(.epoch) // empty | "\(.epoch) \(.date)"' 2>/dev/null)"
  [ -n "$newest" ] || { printf '%s' "$msg"; return; }
  last_epoch="${newest%% *}"
  last_date="${newest#* }"
  days=$(( ($(date +%s) - last_epoch) / 86400 ))
  if [ "$days" -gt 5 ]; then
    waiting="$(count_waiting "$last_date")"
    local unit="drafts"
    [ "$waiting" -eq 1 ] && unit="draft"
    msg="you have not posted in $days days, $waiting $unit waiting"
  fi
  printf '%s' "$msg"
}

if [ "$rc" -eq 0 ] && [ -f "$draft" ]; then
  date +%s > "$LAST_RUN"
  write_result true "$rc"
  echo "$(date '+%F %T') SUCCESS: $draft" >> "$LOG"
  msg="$(success_message)"
  echo "$(date '+%F %T') notify: $msg" >> "$LOG"
  notify "$msg" "Glass"
else
  exists="$([ -f "$draft" ] && echo yes || echo no)"
  # One entry per failure in its own file (the run log buries them under the engine's own
  # output), with the tail of this run's output for a first diagnosis.
  {
    echo "$(date '+%F %T') FAILED rc=$rc draft_exists=$exists stamp=$stamp"
    tail -n 5 "$LOG" 2>/dev/null | sed 's/^/    /'
  } >> "$FAILURES"
  write_result false "$rc"
  echo "$(date '+%F %T') FAILED rc=$rc draft_exists=$exists" >> "$LOG"
  msg="draft generation FAILED (rc=$rc), see .failures.log in your drafts dir"
  echo "$(date '+%F %T') notify: $msg" >> "$LOG"
  notify "$msg" "Basso"
fi
