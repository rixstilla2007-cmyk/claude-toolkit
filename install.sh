#!/usr/bin/env bash
# install.sh — copy this toolkit's agents, skills and hooks into ~/.claude
# (existing files of the same name are backed up as *.bak first), then wire
# the hooks, settings and CLAUDE.md rules with scripts/install_user.py.
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
for f in "$here"/.claude/hooks/*.py; do
  copy "$f" "$dest/hooks/$(basename "$f")"
done
py=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1; then py="$c"; break; fi
done
if [ -n "$py" ]; then
  "$py" "$here/scripts/install_user.py" --dest "$dest"
else
  echo "warning: Python 3 not found - hooks copied but not wired; settings.json and CLAUDE.md left as they are" >&2
fi
echo "done: restart Claude Code (or start a new session) to pick up new agents"
