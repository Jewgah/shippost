#!/bin/bash
# edit.sh — revise a SINGLE option in an existing draft per a user instruction.
# Driven by env (set by the app's /api/edit route):
#   SHIPPOST_EDIT_FILE   — absolute path to the draft .md (already validated by the app)
#   SHIPPOST_EDIT_OPTION — the option number to rewrite
#   SHIPPOST_EDIT_PROMPT — the author's instruction (sanitized by the app)
# Sources lib/config.sh for the claude bin / model / scrub rules / language.

SELF_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
source "$SELF_DIR/lib/config.sh"
set +e

LOG="$CFG_OUTPUT_DIR/.run.log"
file="${SHIPPOST_EDIT_FILE:-}"
opt="${SHIPPOST_EDIT_OPTION:-}"
instr="${SHIPPOST_EDIT_PROMPT:-}"

if [ -z "$file" ] || [ ! -f "$file" ] || [ -z "$opt" ] || [ -z "$instr" ]; then
  echo "$(date '+%F %T') edit: missing/invalid args (file=$file opt=$opt)" >> "$LOG"
  exit 2
fi

echo "$(date '+%F %T') editing option $opt in $file" >> "$LOG"

PROMPT="Revise ONE option in an existing draft. The file is at this exact path: $file
Rewrite ONLY 'Option $opt' according to this instruction from the author: \"$instr\"
Rules:
- Leave every OTHER option byte-for-byte unchanged; do not touch the title or footer.
- Keep Option $opt's structure exactly: the header line '## [⭐ ]Option $opt — {pillar} — {2-4 word topic}   ({score}/10)', then '**A. Company post**', '**B. Repost caption (your profile)**', '**C. First comment**' (only if the option already has one — keep it verbatim unless the instruction targets it), '_Why it works:_', and '_Suggested visuals:_'.
- Keep section A under 3000 characters; keep section B short and first-person.
- Language: $CFG_LANGUAGE.
- Scrub rules still apply: never name clients ($CFG_SCRUB_LIST), never the day job, no secrets/tokens/internal URLs.
Make the edit and save the file in place. Do not ask any questions — make the best editorial choice."

# shellcheck disable=SC2086 # CFG_ALLOWED_TOOLS is a deliberate space-separated arg list
"$CFG_CLAUDE_BIN" -p "$PROMPT" \
  --allowed-tools $CFG_ALLOWED_TOOLS \
  --model "$CFG_MODEL" \
  >> "$LOG" 2>&1
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "$(date '+%F %T') edit SUCCESS: option $opt in $file" >> "$LOG"
else
  echo "$(date '+%F %T') edit FAILED rc=$rc" >> "$LOG"
fi
exit "$rc"
