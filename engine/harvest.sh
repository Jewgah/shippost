#!/bin/bash
# harvest.sh — gather raw material for the shippost content engine.
# Prints a plain-text digest to stdout. Side effect: ensures the drafts dir exists.
# Usage: harvest.sh [DAYS]   (default = config harvest.windowDays)
#
# Config-driven (sources lib/config.sh). Never aborts on a missing/non-git repo.

SELF_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
source "$SELF_DIR/lib/config.sh"

DAYS="${1:-$CFG_HARVEST_DAYS}"
BOOST_DIR="$CFG_OUTPUT_DIR"
RECENT_POSTS="$BOOST_DIR/$CFG_RECENT_POSTS_FILE"
VOICE_SAMPLE="$BOOST_DIR/$CFG_VOICE_SAMPLE_FILE"

mkdir -p "$BOOST_DIR"

# Optional project scope from the app (env). Matched against the allowlist ONLY — the
# allowlist stays the sole set of repos ever mined. A scope matching no allowlisted repo
# falls back to the full allowlist (never an empty harvest). Notes go to stderr so they
# don't pollute the stdout digest.
SCOPE="${SHIPPOST_PROJECT:-}"
if [ -n "$SCOPE" ] && [ -f "$CFG_REPO_ALLOWLIST" ]; then
  _match=0
  while IFS= read -r _l; do
    case "$_l" in ''|\#*) continue ;; esac
    case "$_l" in "~"|"~/"*) _r="${HOME}${_l#\~}" ;; *) _r="$_l" ;; esac
    [ "$(basename "$_r")" = "$SCOPE" ] && { _match=1; break; }
  done < "$CFG_REPO_ALLOWLIST"
  if [ "$_match" -eq 0 ]; then
    echo "shippost: scope '$SCOPE' not in allowlist — using full allowlist (prompt-level focus only)" >&2
    SCOPE=""
  fi
fi

echo "=================================================================="
echo "SHIPPOST HARVEST   (window: last ${DAYS} days)"
echo "=================================================================="

# ---------- WHO YOU ARE (profile context) ----------
echo
echo "### WHO YOU ARE — profile context (ground every post in this; never contradict it)"
if [ -n "$CFG_PORTFOLIO_DATA_DIR" ] && [ -f "$CFG_PORTFOLIO_DATA_DIR/personal-data.js" ]; then
  # Optional: extract bio from a portfolio data file (filters out contact fields).
  sed -n '/personalData = {/,/^}/p' "$CFG_PORTFOLIO_DATA_DIR/personal-data.js" \
    | grep -vE "email:|phone:|address:|github:|linkedIn:|resume:|profile:" | sed 's/^/  /'
  if [ -f "$CFG_PORTFOLIO_DATA_DIR/experience.js" ]; then
    echo "  -- experience --"
    grep -E "title:|company:|duration:" "$CFG_PORTFOLIO_DATA_DIR/experience.js" | sed 's/^ *//; s/^/    /'
  fi
else
  echo "  Name: $CFG_AUTHOR_NAME"
  [ -n "$CFG_AUTHOR_BIO" ] && echo "  $CFG_AUTHOR_BIO" | fold -s -w 80 | sed 's/^/  /'
fi

# ---------- BRAND (the page you post to) ----------
echo
echo "### BRAND — the company page these posts go on (the author's own brand)"
echo "  Name: $CFG_BRAND_NAME"
[ -n "$CFG_BRAND_TAGLINE" ] && echo "  Tagline: \"$CFG_BRAND_TAGLINE\""
[ -n "$CFG_BRAND_OFFERS" ]  && echo "  Offers: $CFG_BRAND_OFFERS"
[ -n "$CFG_BRAND_VIBE" ]    && echo "  Vibe: $CFG_BRAND_VIBE"
echo "  IMPORTANT: you may name the brand and frame posts around it, but write in"
echo "  the author's real, human first-person voice — do NOT copy marketing adjectives."
[ -n "$CFG_LOGO_PATH" ] && [ -f "$CFG_LOGO_PATH" ] && echo "  Logo to attach (manual): $CFG_LOGO_PATH"

# ---------- SCRUB hints ----------
echo
echo "### SCRUB — names/terms to redact or generalize in EVERY option"
[ -n "$CFG_DAYJOB_NAME" ] && echo "  Day job (background only, never the subject): $CFG_DAYJOB_NAME"
if [ -n "$CFG_SCRUB_LIST" ]; then
  echo "  Never name these clients/customers: $CFG_SCRUB_LIST"
fi
echo "  Also strip: people's names (except the author/brand), emails, phones,"
echo "  secrets, tokens, DB names, internal/staging URLs, IPs."

# ---------- PILLAR 1: BUILD-IN-PUBLIC (git activity, allowlist only) ----------
echo
echo "### PILLAR build-in-public  — recent commits in allowlisted repos"
[ -n "$SCOPE" ] && echo "  (scoped to project: $SCOPE)"
if [ -f "$CFG_REPO_ALLOWLIST" ]; then
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    # expand a leading ~ in the allowlist path
    case "$line" in "~"|"~/"*) repo="${HOME}${line#\~}" ;; *) repo="$line" ;; esac
    # honor an optional single-project scope (allowlist-bounded)
    if [ -n "$SCOPE" ] && [ "$(basename "$repo")" != "$SCOPE" ]; then
      continue
    fi
    if [ ! -d "$repo/.git" ]; then
      echo "  [skip] not a git repo / missing: $repo"
      continue
    fi
    name="$(basename "$repo")"
    subjects="$(git -C "$repo" log --since="${DAYS} days ago" --pretty=format:'  - %s' 2>/dev/null)"
    if [ -z "$subjects" ]; then
      echo "  ($name) no commits in window"
      continue
    fi
    total="$(printf '%s\n' "$subjects" | grep -c .)"
    echo
    echo "  PROJECT: $name   ($repo)   ($total commits in window)"
    printf '%s\n' "$subjects" | head -12
    [ "$total" -gt 12 ] && echo "  … +$((total - 12)) more"
    echo "  --- detail: up to 3 most recent commits (subject + body) ---"
    git -C "$repo" log -3 --since="${DAYS} days ago" --pretty=format:'  • %s%n%w(72,4,4)%b' 2>/dev/null
    echo
    echo "  --- files touched ---"
    git -C "$repo" log --since="${DAYS} days ago" --stat --pretty=format:'' 2>/dev/null \
      | grep '|' | sed 's/^/   /' | sort -u | head -25
  done < "$CFG_REPO_ALLOWLIST"
else
  echo "  [warn] allowlist not found: $CFG_REPO_ALLOWLIST"
  echo "         Copy engine/postable-projects.txt.example and add your repos."
fi

# ---------- PILLAR 2: SMART AI WORKFLOW (your custom skills) ----------
echo
echo "### PILLAR smart-ai-workflow  — custom Claude Code skills you built"
echo "  (each is a candidate 'here is a smart way I use AI' post)"
if [ -d "$CFG_SKILLS_ROOT" ]; then
  for f in "$CFG_SKILLS_ROOT"/*/SKILL.md; do
    [ -f "$f" ] || continue
    case "$f" in *"/linkedin-post/"*|*"/shippost/"*) continue ;; esac
    n="$(grep -m1 '^name:' "$f" | sed 's/name: *//')"
    d="$(grep -m1 '^description:' "$f" | sed 's/description: *//' | tr -d '"' | cut -c1-100)"
    [ -n "$n" ] && printf '  - %s: %s\n' "$n" "$d"
  done
fi

# ---------- PILLAR 3 + 4 hints ----------
echo
echo "### PILLAR cool-repo  — only if you genuinely tried something. NEVER claim to"
echo "    have tried what you didn't."
echo "### PILLAR lesson  — a concrete takeaway tied to real work above (a tradeoff, gotcha, mindset)."

# ---------- ANTI-REPETITION: recent drafts ----------
echo
echo "### RECENT DRAFTS — option topics already offered (do NOT repeat these)"
found=0
while IFS= read -r d; do
  [ -n "$d" ] || continue
  echo "  --- $(basename "$d") ---"
  grep '^## ' "$d" 2>/dev/null | sed 's/^## /    /'
  found=1
done < <(ls -1t "$BOOST_DIR"/*.md 2>/dev/null | head -"$CFG_RECENT_DRAFTS")
[ "$found" -eq 0 ] && echo "  (none yet — this is the first run)"

# ---------- REJECTED ANGLES: options the author thumbed down in the app ----------
# Written by the app's "Not for me" button to .rejects.jsonl (one JSON object per line).
# We surface the recent rejected topics so the model avoids them and close variants.
REJECTS_LOG="$BOOST_DIR/.rejects.jsonl"
if [ -f "$REJECTS_LOG" ]; then
  # length<=120 guards against a pathological topic bloating (or injecting structure into) the prompt
  rejected="$(tail -n 60 "$REJECTS_LOG" 2>/dev/null | jq -r '.topic // empty' 2>/dev/null | awk 'NF && length<=120' | sort -u)"
  if [ -n "$rejected" ]; then
    echo
    echo "### REJECTED ANGLES — the author thumbed these down; do NOT offer them again or close variants"
    printf '%s\n' "$rejected" | sed 's/^/  - /'
  fi
fi

# ---------- YOUR RECENT LINKEDIN POSTS (capped) ----------
# FIX: only inject the last N posts so this can't grow unbounded and flood the prompt.
if [ -f "$RECENT_POSTS" ]; then
  echo
  echo "### YOUR RECENT LINKEDIN POSTS — match this voice AND do not repeat these themes"
  echo "    (most recent $CFG_RECENT_POSTS_MAX shown)"
  awk -v max="$CFG_RECENT_POSTS_MAX" '
    function flush() { if (cur ~ /[^[:space:]]/) blocks[++n]=cur; cur="" }
    /^---[[:space:]]*$/ { flush(); next }
    { cur = cur $0 "\n" }
    END {
      flush()
      start = (n > max) ? n - max + 1 : 1
      for (i = start; i <= n; i++) printf "%s\n---\n", blocks[i]
    }
  ' "$RECENT_POSTS" | sed 's/^/  /'
fi

# ---------- VOICE SAMPLE (optional) ----------
if [ -f "$VOICE_SAMPLE" ]; then
  echo
  echo "### VOICE SAMPLE (match this tone — a real past post you wrote)"
  sed 's/^/  /' "$VOICE_SAMPLE"
fi

echo
echo "=================================================================="
