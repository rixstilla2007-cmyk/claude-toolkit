#!/usr/bin/env python3
"""hire_agent.py - create, list and check Claude Code subagents.

  hire_agent.py hire --name seo-auditor --description "..." --tools Read,Grep,WebFetch \
                     [--model sonnet] [--body-file role.md | --body "..."] [--install] [--force]
  hire_agent.py list  [--json]
  hire_agent.py check

Agents live in <toolkit>/.claude/agents/<name>.md (or --dir). --install also
copies the file into ~/.claude/agents (or $CLAUDE_HOME/agents) so every
project sees it. Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

TOOLKIT = Path(__file__).resolve().parent.parent
DEFAULT_DIR = TOOLKIT / ".claude" / "agents"

KNOWN_TOOLS = {
    "Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch", "WebSearch",
    "Skill", "NotebookEdit", "TodoWrite", "Agent",
}
WRITE_TOOLS = {"Write", "Edit", "NotebookEdit", "Bash"}
MODELS = {"sonnet", "opus", "haiku", "fable", "inherit"}
NAME_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
RESERVED = {"claude", "general-purpose", "explore", "plan", "fork"}


class AgentError(Exception):
    pass


def parse_tools(raw: str) -> list[str]:
    tools = [t.strip() for t in raw.split(",") if t.strip()]
    if not tools:
        raise AgentError("--tools needs at least one tool, e.g. Read,Grep,Glob")
    seen: list[str] = []
    for t in tools:
        if t not in KNOWN_TOOLS and not t.startswith("mcp__"):
            raise AgentError(
                f"unknown tool {t!r}; known: {', '.join(sorted(KNOWN_TOOLS))}, or an mcp__ tool name"
            )
        if t not in seen:
            seen.append(t)
    return seen


def validate(name: str, description: str, body: str, model: str | None) -> None:
    if not NAME_RE.match(name) or len(name) > 64:
        raise AgentError(f"name {name!r} must be kebab-case (a-z, 0-9, dashes), at most 64 chars")
    if name in RESERVED:
        raise AgentError(f"name {name!r} is taken by a built-in agent")
    description = description.strip()
    if len(description) < 20:
        raise AgentError("description is too short: say what the agent does and when to use it (20+ chars)")
    if "\n" in description:
        raise AgentError("description must be one line")
    if len(body.strip()) < 80:
        raise AgentError("body is too short: give the role, the method, the report format and the limits")
    if model is not None and model not in MODELS:
        raise AgentError(f"model must be one of {', '.join(sorted(MODELS))}")


def render(name: str, description: str, tools: list[str], body: str, model: str | None) -> str:
    lines = ["---", f"name: {name}", f"description: {description.strip()}", f"tools: {', '.join(tools)}"]
    if model:
        lines.append(f"model: {model}")
    lines.append("---")
    return "\n".join(lines) + "\n\n" + body.strip() + "\n"


def parse_agent(path: Path) -> dict:
    """Read an agent file's frontmatter; raise AgentError if malformed."""
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        raise AgentError(f"{path.name}: no frontmatter between --- lines")
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            raise AgentError(f"{path.name}: bad frontmatter line {line!r}")
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip()
    for key in ("name", "description"):
        if not meta.get(key):
            raise AgentError(f"{path.name}: missing {key}")
    if meta["name"] != path.stem:
        raise AgentError(f"{path.name}: name {meta['name']!r} differs from the file name")
    tools = [t.strip() for t in meta.get("tools", "").split(",") if t.strip()]
    return {
        "name": meta["name"],
        "description": meta["description"],
        "tools": tools,
        "model": meta.get("model"),
        "path": str(path),
        "body_chars": len(m.group(2).strip()),
    }


def install_dir() -> Path:
    home = os.environ.get("CLAUDE_HOME") or str(Path.home() / ".claude")
    return Path(home) / "agents"


def cmd_hire(a: argparse.Namespace) -> int:
    if a.body_file:
        body = Path(a.body_file).read_text(encoding="utf-8")
    elif a.body is not None:
        body = a.body
    else:
        body = sys.stdin.read()
    tools = parse_tools(a.tools)
    validate(a.name, a.description, body, a.model)
    out_dir = Path(a.dir)
    target = out_dir / f"{a.name}.md"
    if target.exists() and not a.force:
        raise AgentError(f"{target} exists; pass --force to replace it")
    out_dir.mkdir(parents=True, exist_ok=True)
    target.write_text(render(a.name, a.description, tools, body, a.model), encoding="utf-8")
    parse_agent(target)  # round-trip check
    print(f"hired {a.name}: {target}")
    risky = sorted(set(tools) & WRITE_TOOLS)
    if risky:
        print(f"note: {a.name} can change files or run commands ({', '.join(risky)})")
    if a.install:
        dst = install_dir() / target.name
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() and dst.read_bytes() != target.read_bytes():
            shutil.copy2(dst, dst.with_suffix(".md.bak"))
            print(f"backed up {dst} -> {dst.with_suffix('.md.bak')}")
        shutil.copy2(target, dst)
        print(f"installed {dst}")
    print("a new agent may only be callable in a new session")
    return 0


def load_all(directory: Path) -> tuple[list[dict], list[str]]:
    agents, errors = [], []
    for p in sorted(directory.glob("*.md")):
        try:
            agents.append(parse_agent(p))
        except AgentError as e:
            errors.append(str(e))
    return agents, errors


def cmd_list(a: argparse.Namespace) -> int:
    agents, errors = load_all(Path(a.dir))
    if a.json:
        print(json.dumps({"agents": agents, "errors": errors}, ensure_ascii=False, indent=2))
    else:
        for ag in agents:
            print(f"{ag['name']:<14} [{', '.join(ag['tools']) or 'all tools'}]")
            print(f"  {ag['description']}")
        for e in errors:
            print(f"ERROR {e}", file=sys.stderr)
    return 1 if errors else 0


def cmd_check(a: argparse.Namespace) -> int:
    agents, errors = load_all(Path(a.dir))
    for ag in agents:
        for t in ag["tools"]:
            if t not in KNOWN_TOOLS and not t.startswith("mcp__"):
                errors.append(f"{ag['name']}: unknown tool {t!r}")
        if ag["body_chars"] < 80:
            errors.append(f"{ag['name']}: body too short ({ag['body_chars']} chars)")
    for e in errors:
        print(f"ERROR {e}")
    print(f"checked {len(agents)} agent(s), {len(errors)} problem(s)")
    return 1 if errors else 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Create, list and check Claude Code subagents.")
    p.add_argument("--dir", default=str(DEFAULT_DIR), help="agents folder (default: the toolkit's)")
    sub = p.add_subparsers(dest="cmd", required=True)

    h = sub.add_parser("hire", help="create an agent")
    h.add_argument("--name", required=True)
    h.add_argument("--description", required=True)
    h.add_argument("--tools", required=True, help="comma-separated, least needed")
    h.add_argument("--model", choices=sorted(MODELS))
    h.add_argument("--body")
    h.add_argument("--body-file")
    h.add_argument("--install", action="store_true", help="also copy into ~/.claude/agents")
    h.add_argument("--force", action="store_true", help="replace an existing agent")
    h.set_defaults(fn=cmd_hire)

    ls = sub.add_parser("list", help="list agents")
    ls.add_argument("--json", action="store_true")
    ls.set_defaults(fn=cmd_list)

    ck = sub.add_parser("check", help="validate every agent file")
    ck.set_defaults(fn=cmd_check)

    a = p.parse_args(argv)
    try:
        return a.fn(a)
    except AgentError as e:
        print(f"hire_agent: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
