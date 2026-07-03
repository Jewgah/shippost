#!/bin/bash
# doctor.sh — sanity-check a shippost install. Read-only.
# Usage: bash scripts/doctor.sh

REPO_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR" || exit 1
pass=0; warn=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
note() { echo "  ! $1"; warn=$((warn+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }

echo "shippost doctor — $REPO_DIR"
echo

echo "Dependencies:"
command -v jq    >/dev/null 2>&1 && ok "jq $(jq --version 2>/dev/null)"        || bad "jq not found (required) — brew install jq"
command -v node  >/dev/null 2>&1 && ok "node $(node -v 2>/dev/null)"            || bad "node not found (required, v18+)"
command -v git   >/dev/null 2>&1 && ok "git present"                            || note "git not found"
command -v claude>/dev/null 2>&1 && ok "claude CLI present"                     || note "claude CLI not on PATH (the engine needs it to generate)"

echo
echo "Config:"
if [ -f config.json ]; then
  ok "config.json exists"
  jq empty config.json 2>/dev/null && ok "config.json is valid JSON" || bad "config.json is NOT valid JSON (jq . config.json)"
else
  note "config.json missing — copy config.example.json to config.json and edit"
fi
if [ -f engine/postable-projects.txt ]; then ok "postable-projects.txt exists"; else note "postable-projects.txt missing (build-in-public pillar will be empty)"; fi

echo
echo "Privacy (must stay untracked):"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  for f in config.json engine/postable-projects.txt; do
    if [ -f "$f" ] && git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      bad "$f is TRACKED by git — remove it: git rm --cached $f"
    else
      ok "$f not tracked"
    fi
  done
else
  note "not a git repo (skipping tracked-file check)"
fi

echo
echo "Summary: $pass ok, $warn warnings, $fail failures"
[ "$fail" -gt 0 ] && exit 1 || exit 0
