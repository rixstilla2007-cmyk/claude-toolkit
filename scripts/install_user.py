#!/usr/bin/env python3
"""Install the toolkit's user-level config into ~/.claude.

- merges user/settings-add.json into settings.json: the user's own values win,
  lists get only missing items, a hook is skipped when its script is already wired;
- keeps user/CLAUDE.md as a marked block in CLAUDE.md (replaced on re-run,
  text outside the markers is left alone).

A file that changes is first copied to <name>.bak-<date> (an existing one is kept).
The hook scripts themselves are copied by install.sh / install.ps1.
"""
import argparse
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BEGIN, END = "<!-- claude-toolkit:begin -->", "<!-- claude-toolkit:end -->"
SCRIPT = re.compile(r"hooks/[\w.-]+\.py")


def fill(v, subs):
    if isinstance(v, dict):
        return {k: fill(x, subs) for k, x in v.items()}
    if isinstance(v, list):
        return [fill(x, subs) for x in v]
    if isinstance(v, str):
        for k, s in subs.items():
            v = v.replace(k, s)
    return v


def hook_key(h):
    # The same hook script is the same hook, whatever Python path launches it.
    cmd = str(h.get("command", "")).replace("\\", "/")
    m = SCRIPT.search(cmd)
    return m.group(0) if m else cmd


def merge_hooks(have, add):
    for event, groups in add.items():
        cur = have.setdefault(event, [])
        known = {hook_key(h) for g in cur for h in g.get("hooks", [])}
        for g in groups:
            new = [h for h in g.get("hooks", []) if hook_key(h) not in known]
            if new:
                cur.append({**g, "hooks": new})
                known |= {hook_key(h) for h in new}


def merge(have, add):
    for k, v in add.items():
        if k not in have:
            have[k] = v
        elif k == "hooks" and isinstance(v, dict) and isinstance(have[k], dict):
            merge_hooks(have[k], v)
        elif isinstance(v, dict) and isinstance(have[k], dict):
            merge(have[k], v)
        elif isinstance(v, list) and isinstance(have[k], list):
            have[k] += [x for x in v if x not in have[k]]
    return have


def with_block(text, block):
    block = f"{BEGIN}\n{block.strip()}\n{END}"
    if BEGIN in text and END in text:
        a, b = text.index(BEGIN), text.index(END) + len(END)
        return text[:a] + block + text[b:]
    return (text.rstrip("\n") + "\n\n" if text.strip() else "") + block + "\n"


def save(path, text):
    if path.exists():
        if path.read_text(encoding="utf-8-sig") == text:
            print(f"unchanged {path}")
            return
        bak = path.with_name(f"{path.name}.bak-{date.today()}")
        if not bak.exists():
            shutil.copy2(path, bak)
            print(f"backed up {path} -> {bak}")
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"installed {path}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dest", default=str(Path.home() / ".claude"))
    dest = Path(p.parse_args(argv).dest)
    dest.mkdir(parents=True, exist_ok=True)

    settings = dest / "settings.json"
    try:
        have = json.loads(settings.read_text(encoding="utf-8-sig")) if settings.exists() else {}
    except json.JSONDecodeError as e:
        print(f"{settings} is not valid JSON ({e}); fix it and run again. Nothing changed.", file=sys.stderr)
        return 1
    subs = {"{PYTHON}": Path(sys.executable).as_posix(), "{CLAUDE}": dest.resolve().as_posix()}
    add = fill(json.loads((ROOT / "user" / "settings-add.json").read_text(encoding="utf-8")), subs)
    save(settings, json.dumps(merge(have, add), indent=2, ensure_ascii=False) + "\n")

    claude_md = dest / "CLAUDE.md"
    old = claude_md.read_text(encoding="utf-8-sig") if claude_md.exists() else ""
    save(claude_md, with_block(old, (ROOT / "user" / "CLAUDE.md").read_text(encoding="utf-8")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
