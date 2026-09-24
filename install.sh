#!/usr/bin/env bash
# Copy skills, agents and commands into your Claude Code config directory.
# Existing items with the same name are kept unless you pass --force.
set -euo pipefail
FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1
ROOT="$(cd "$(dirname "$0")" && pwd)"
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

copy() {  # copy <src> <dest-dir>
  local src="$1" dest="$2/$(basename "$1")"
  mkdir -p "$2"
  if [ -e "$dest" ] && [ "$FORCE" -eq 0 ]; then
    echo "skip       $(basename "$src") (already installed; --force to overwrite)"; return
  fi
  rm -rf "$dest"; cp -r "$src" "$dest"
  echo "installed  $(basename "$src")"
}

for d in "$ROOT"/skills/*/; do copy "${d%/}" "$CFG/skills"; done
for f in "$ROOT"/agents/*.md; do copy "$f" "$CFG/agents"; done
for f in "$ROOT"/commands/*.md; do copy "$f" "$CFG/commands"; done
echo; echo "Done. Set OBSIDIAN_VAULT_PATH, then restart Claude Code."
