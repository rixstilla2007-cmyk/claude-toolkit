#!/usr/bin/env bash
# install.sh — copy this toolkit's agents and skills into ~/.claude
# (existing files of the same name are backed up as *.bak first).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dest="${CLAUDE_HOME:-$HOME/.claude}"

copy() { # copy <src> <dst>
  if [ -e "$2" ] && ! diff -rq "$1" "$2" >/dev/null 2>&1; then
    rm -rf "$2.bak"
    mv "$2" "$2.bak"
    echo "backed up $2 -> $2.bak"
  fi
  mkdir -p "$(dirname "$2")"
  rm -rf "$2"
  cp -r "$1" "$2"
  echo "installed $2"
}

for f in "$here"/.claude/agents/*.md; do
  copy "$f" "$dest/agents/$(basename "$f")"
done
for d in "$here"/.claude/skills/*/; do
  name="$(basename "$d")"
  copy "${d%/}" "$dest/skills/$name"
done
echo "done: restart Claude Code (or start a new session) to pick up new agents"
