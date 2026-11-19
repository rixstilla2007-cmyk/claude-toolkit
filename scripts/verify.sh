#!/usr/bin/env bash
# verify.sh [dir] — find how a project tests itself and run it.
# Prints the command it runs and exits with that command's status.
# Exit 3 when no known test setup was found.
set -uo pipefail

dir="${1:-.}"
cd "$dir" || { echo "verify: no such directory: $dir" >&2; exit 2; }

run() {
  echo "verify: \$ $*"
  "$@"
  status=$?
  echo "verify: exit $status"
  exit "$status"
}

has_script() { # has_script <name>: package.json has scripts.<name>
  node -e 'const s=require("./package.json").scripts||{};process.exit(s[process.argv[1]]?0:1)' "$1" 2>/dev/null
}

if [ -f .claude-plugin/plugin.json ] && [ -f hooks/hooks.json ]; then
  claude plugin validate . || exit $?
  [ -d tests ] && run claude plugin test .
  exit 0
fi

if [ -f package.json ]; then
  pm=npm
  [ -f pnpm-lock.yaml ] && pm=pnpm
  [ -f yarn.lock ] && pm=yarn
  [ -f bun.lockb ] || [ -f bun.lock ] && pm=bun
  if has_script test; then run "$pm" test; fi
fi

pytests=
for f in tests/test_*.py test_*.py; do [ -e "$f" ] && pytests=1; done
if [ -f pyproject.toml ] || [ -f pytest.ini ] || [ -f setup.cfg ] || [ -n "$pytests" ]; then
  if command -v pytest >/dev/null; then run pytest -q; fi
  run python3 -m pytest -q
fi

[ -f Cargo.toml ] && run cargo test
[ -f go.mod ] && run go test ./...
if [ -f Makefile ] && grep -qE '^test:' Makefile; then run make test; fi

echo "verify: no test setup found in $(pwd) (looked for a mod, package.json test script, pytest, cargo, go, make test)" >&2
exit 3
