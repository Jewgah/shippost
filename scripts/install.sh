#!/bin/bash
# install.sh — install shippost's engine as a Claude Code skill.
# Symlinks engine/ into ~/.claude/skills/shippost so `/shippost` works and the
# repo stays the single source of truth. Pass --copy to copy instead of symlink.
#
# Usage: bash scripts/install.sh [--copy]

set -e
REPO_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
TARGET="$SKILLS_DIR/shippost"
MODE="symlink"
[ "${1:-}" = "--copy" ] && MODE="copy"

mkdir -p "$SKILLS_DIR"

# Back up an existing real directory (don't clobber).
if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  bak="$TARGET.backup.$(date +%s)"
  echo "→ existing $TARGET found; moving to $bak"
  mv "$TARGET" "$bak"
fi
[ -L "$TARGET" ] && rm -f "$TARGET"

if [ "$MODE" = "copy" ]; then
  cp -R "$REPO_DIR/engine" "$TARGET"
  echo "→ copied engine/ to $TARGET"
else
  ln -s "$REPO_DIR/engine" "$TARGET"
  echo "→ symlinked $TARGET -> $REPO_DIR/engine"
fi

# Verify the skill is discoverable and its scripts resolve.
ok=1
if [ ! -f "$TARGET/SKILL.md" ]; then echo "✗ SKILL.md not found at $TARGET"; ok=0; fi
if ! grep -q '^name: shippost' "$TARGET/SKILL.md" 2>/dev/null; then echo "✗ SKILL.md missing 'name: shippost'"; ok=0; fi
if [ ! -x "$TARGET/harvest.sh" ] && [ ! -f "$TARGET/harvest.sh" ]; then echo "✗ harvest.sh not reachable"; ok=0; fi

if [ "$ok" = 1 ]; then
  echo "✓ shippost skill installed. In Claude Code, run: /shippost"
  echo "  (If /shippost isn't found, your Claude Code may not follow symlinked skill"
  echo "   dirs — re-run: bash scripts/install.sh --copy)"
else
  echo "Install verification FAILED — see messages above."
  exit 1
fi

echo
echo "Next:"
echo "  1) cp config.example.json config.json   && edit it"
echo "  2) cp engine/postable-projects.txt.example engine/postable-projects.txt  && add your repos"
echo "  3) cd app && npm install && npm run dev   → http://localhost:3030"
echo "  4) schedule it — see engine/schedule/ and the README"
