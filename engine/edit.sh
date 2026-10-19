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

# "Generate for company": add/replace a section D with a company-page version of a personal post,
# plus a section B repost caption when the option has none (the queue's company mode reposts with it).
if [ "${SHIPPOST_EDIT_MODE:-}" = "company" ]; then
  PROMPT="Add a company-page version to ONE option in an existing draft. The file is at this exact path: $file
In 'Option $opt', section '**A. Company post**' is a first-person post for the author's own profile. Write the version of that post for the company page of $CFG_BRAND_NAME${CFG_BRAND_TAGLINE:+ ($CFG_BRAND_TAGLINE)}${CFG_BRAND_VIBE:+, vibe: $CFG_BRAND_VIBE}: same story and facts, in the company page's voice (plural 'we' is fine there), lighter and brand-safe, LinkedIn format, under 3000 characters.
Rules:
- Put it in a section headed exactly '**D. Company page post**', placed right before Option $opt's '_Why it works:_' line. If a section D already exists in Option $opt, replace its content.
- If Option $opt has no section headed '**B. Repost caption (your profile)**', also add one right after section A (before any '**C. First comment**'): one to three short first-person lines the author posts on their own profile when resharing the company page post. Never invent a fact that is not in section A. If section B already exists, leave it exactly as it is.
- Change NOTHING else: not section A, an existing B, or C, not the header line, not any other option, not the title or footer.
- No em dashes, no arrows. Language: $CFG_LANGUAGE.
- Scrub rules still apply: never name clients ($CFG_SCRUB_LIST), never the day job, no secrets/tokens/internal URLs.
Save the file in place. Do not ask any questions."
fi

before="$(shasum "$file" | cut -d' ' -f1)"

# Edit + acceptEdits: a headless run cannot answer a permission prompt, and without these the
# model drafted the change and then could not save it (exit 0, file untouched). acceptEdits only
# auto-approves file edits; shell commands stay limited to the allowed-tools list.
# shellcheck disable=SC2086 # CFG_ALLOWED_TOOLS is a deliberate space-separated arg list
"$CFG_CLAUDE_BIN" -p "$PROMPT" \
  --allowed-tools $CFG_ALLOWED_TOOLS Edit \
  --permission-mode acceptEdits \
  --model "$CFG_MODEL" \
  >> "$LOG" 2>&1
rc=$?

# Exit 0 is not proof: check the draft really changed (and, for "Generate for company", that
# section D is now in it). Exit 3 = the AI answered but nothing was saved.
if [ "$rc" -eq 0 ]; then
  if [ "$(shasum "$file" | cut -d' ' -f1)" = "$before" ]; then
    echo "$(date '+%F %T') edit NOT SAVED: option $opt in $file is unchanged" >> "$LOG"
    rc=3
  # Only Option $opt's block counts: another option's section D must not pass for this one.
  elif [ "${SHIPPOST_EDIT_MODE:-}" = "company" ] && ! awk -v o="$opt" '/^## /{blk = ($0 ~ ("Option " o "([^0-9]|$)"))} blk' "$file" | grep -q 'Company page post'; then
    echo "$(date '+%F %T') edit NOT SAVED: no company page section in option $opt of $file" >> "$LOG"
    rc=3
  fi
fi

if [ "$rc" -eq 0 ]; then
  echo "$(date '+%F %T') edit SUCCESS: option $opt in $file" >> "$LOG"
else
  echo "$(date '+%F %T') edit FAILED rc=$rc" >> "$LOG"
fi
exit "$rc"
