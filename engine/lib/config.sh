#!/bin/bash
# config.sh — shared config loader for shippost's shell scripts.
# Sourced by harvest.sh and generate.sh. Reads config.json with jq and exports
# flat CFG_* env vars. jq is REQUIRED: if it's missing we fail loudly rather
# than silently half-parsing (a quiet wrong value is worse than a clear stop).
#
# Resolves the repo root from this file's location, so it works no matter the
# CWD or whether the skill dir is a symlink.
#
# NOTE: this file is *sourced*, so it deliberately does NOT `set -e`/`-u`/pipefail
# — that would impose strict mode on the calling script (harvest.sh has many
# intentional non-zero greps). The loader does its own explicit error handling.

# --- locate repo root (engine/lib/config.sh -> repo root is ../..) ---
# Resolve symlinks so a symlinked skill dir still finds the real repo.
_src="${BASH_SOURCE[0]}"
while [ -h "$_src" ]; do
  _dir="$(cd -P "$(dirname "$_src")" && pwd)"
  _src="$(readlink "$_src")"
  case "$_src" in /*) ;; *) _src="$_dir/$_src" ;; esac
done
LIB_DIR="$(cd -P "$(dirname "$_src")" && pwd)"
ENGINE_DIR="$(cd -P "$LIB_DIR/.." && pwd)"
REPO_DIR="$(cd -P "$ENGINE_DIR/.." && pwd)"

# Config path: env override wins, else repo-root config.json.
CONFIG="${SHIPPOST_CONFIG:-$REPO_DIR/config.json}"

# --- hard dependency: jq ---
if ! command -v jq >/dev/null 2>&1; then
  echo "shippost: 'jq' is required but not found in PATH." >&2
  echo "  Install it (macOS: brew install jq) and ensure it's on PATH." >&2
  echo "  Under launchd, add /usr/bin (or jq's dir) to the plist's PATH." >&2
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "shippost: config not found at $CONFIG" >&2
  echo "  Copy config.example.json to config.json and edit it." >&2
  exit 1
fi

# Validate JSON early with a clear message.
if ! jq empty "$CONFIG" 2>/dev/null; then
  echo "shippost: $CONFIG is not valid JSON. Run: jq . \"$CONFIG\"" >&2
  exit 1
fi

# --- helpers ---
_expand() { # expand a leading ~ to $HOME
  case "$1" in "~"|"~/"*) printf '%s' "${HOME}${1#\~}" ;; *) printf '%s' "$1" ;; esac
}
_get() { # _get <jq-path> <default>
  local v; v="$(jq -r "$1 // empty" "$CONFIG" 2>/dev/null)"
  [ -n "$v" ] && printf '%s' "$v" || printf '%s' "${2:-}"
}

# --- author / brand ---
export CFG_AUTHOR_NAME="$(_get '.author.name' 'the author')"
export CFG_AUTHOR_BIO="$(_get '.author.bio' '')"
export CFG_PORTFOLIO_DATA_DIR="$(_expand "$(_get '.author.portfolioDataDir' '')")"
export CFG_BRAND_NAME="$(_get '.brand.name' 'the brand')"
export CFG_BRAND_TAGLINE="$(_get '.brand.tagline' '')"
export CFG_BRAND_OFFERS="$(_get '.brand.offers' '')"
export CFG_BRAND_VIBE="$(_get '.brand.vibe' '')"
export CFG_LOGO_PATH="$(_expand "$(_get '.brand.logoPath' '')")"

# --- day job (excluded from harvest; named so the model knows what NOT to post) ---
export CFG_DAYJOB_NAME="$(_get '.dayJob.name' '')"
export CFG_DAYJOB_SHORTCODE="$(_get '.dayJob.shortCode' '')"
export CFG_DAYJOB_REPOS_ROOT="$(_expand "$(_get '.dayJob.clientReposRoot' '')")"

# --- scrub list (array -> comma-joined; jq handles arrays natively) ---
export CFG_SCRUB_LIST="$(jq -r '[.scrub.clientNames[]?, .scrub.extraTerms[]?] | join(", ")' "$CONFIG" 2>/dev/null || true)"

# --- harvest ---
export CFG_REPO_ALLOWLIST="$REPO_DIR/$(_get '.harvest.repoAllowlistFile' 'engine/postable-projects.txt')"
export CFG_HARVEST_DAYS="$(_get '.harvest.windowDays' '4')"
export CFG_SKILLS_ROOT="$(_expand "$(_get '.harvest.skillsRoot' '~/.claude/skills')")"
export CFG_RECENT_DRAFTS="$(_get '.harvest.recentDraftsToScan' '3')"
export CFG_RECENT_POSTS_MAX="$(_get '.harvest.recentPostsMax' '12')"

# --- output ---
export CFG_OUTPUT_DIR="$(_expand "$(_get '.output.draftsDir' '~/Downloads/shippost-drafts')")"
export CFG_RECENT_POSTS_FILE="$(_get '.output.recentPostsFile' 'recent-posts.md')"
export CFG_VOICE_SAMPLE_FILE="$(_get '.output.voiceSampleFile' 'voice-sample.md')"
export CFG_PICKS_LOG_FILE="$(_get '.output.picksLogFile' '.picks.jsonl')"

# --- engine ---
export CFG_CLAUDE_BIN="$(_get '.engine.claudeBin' 'claude')"
export CFG_MODEL="$(_get '.engine.model' 'claude-sonnet-4-6')"
export CFG_MIN_GAP_HOURS="$(_get '.engine.minGapHours' '46')"
export CFG_LANGUAGE="$(_get '.engine.language' 'English')"
export CFG_ALLOWED_TOOLS="$(jq -r '(.engine.allowedTools // ["Bash","Read","Write"]) | join(" ")' "$CONFIG" 2>/dev/null || echo 'Bash Read Write')"

# --- schedule ---
export CFG_SCHED_HOUR="$(_get '.schedule.hour' '9')"
export CFG_SCHED_MINUTE="$(_get '.schedule.minute' '13')"
export CFG_LAUNCHD_LABEL="$(_get '.schedule.launchdLabel' 'com.example.shippost')"

# Convenience: where SKILL.md lives (for generate.sh to pass to claude).
export CFG_SKILL_MD="$ENGINE_DIR/SKILL.md"
export CFG_REPO_DIR="$REPO_DIR"
export CFG_ENGINE_DIR="$ENGINE_DIR"
