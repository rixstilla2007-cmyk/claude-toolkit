import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("install_user", ROOT / "scripts" / "install_user.py")
iu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(iu)
HOOKS = ROOT / ".claude" / "hooks"


def settings(d):
    return json.loads((d / "settings.json").read_text(encoding="utf-8"))


def commands(s):
    return [h["command"] for groups in s["hooks"].values() for g in groups for h in g["hooks"]]


def test_fresh_install_wires_existing_hooks(tmp_path):
    assert iu.main(["--dest", str(tmp_path)]) == 0
    s = settings(tmp_path)
    assert s["cleanupPeriodDays"] == 3650
    cmds = commands(s)
    assert len(cmds) == 4
    for c in cmds:
        assert "{" not in c and tmp_path.resolve().as_posix() in c
        assert (HOOKS / Path(iu.hook_key({"command": c})).name).is_file()
    md = (tmp_path / "CLAUDE.md").read_text(encoding="utf-8")
    assert md.startswith(iu.BEGIN) and md.rstrip().endswith(iu.END)


def test_rerun_changes_nothing(tmp_path):
    iu.main(["--dest", str(tmp_path)])
    before = {p.name: p.read_text(encoding="utf-8") for p in tmp_path.iterdir()}
    iu.main(["--dest", str(tmp_path)])
    after = {p.name: p.read_text(encoding="utf-8") for p in tmp_path.iterdir()}
    assert after == before  # no duplicates, no backups of our own output


def test_user_values_win_and_are_backed_up(tmp_path):
    own = {
        "cleanupPeriodDays": 10,
        "permissions": {"deny": ["Read(**/secret.txt)", "Read(**/.env)"]},
        "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [
            {"type": "command", "command": '"C:\\Py\\python.exe" "C:\\Users\\x\\.claude\\hooks\\no_delete.py"'}]}]},
    }
    (tmp_path / "settings.json").write_text(json.dumps(own), encoding="utf-8-sig")
    (tmp_path / "CLAUDE.md").write_text("# Mine\nkeep me\n", encoding="utf-8")
    assert iu.main(["--dest", str(tmp_path)]) == 0
    s = settings(tmp_path)
    assert s["cleanupPeriodDays"] == 10
    assert s["permissions"]["deny"].count("Read(**/.env)") == 1 and "Read(**/secret.txt)" in s["permissions"]["deny"]
    assert sum("no_delete.py" in c for c in commands(s)) == 1  # already wired by the user
    assert any("sekrety_git.py" in c for c in commands(s))
    md = (tmp_path / "CLAUDE.md").read_text(encoding="utf-8")
    assert md.startswith("# Mine\nkeep me\n") and iu.BEGIN in md
    baks = sorted(p.name for p in tmp_path.glob("*.bak-*"))
    assert [b.split(".bak-")[0] for b in baks] == ["CLAUDE.md", "settings.json"]


def test_block_is_replaced_not_appended(tmp_path):
    (tmp_path / "CLAUDE.md").write_text(f"top\n{iu.BEGIN}\nold\n{iu.END}\nbottom\n", encoding="utf-8")
    iu.main(["--dest", str(tmp_path)])
    md = (tmp_path / "CLAUDE.md").read_text(encoding="utf-8")
    assert md.startswith("top\n") and md.endswith("\nbottom\n") and "old" not in md and md.count(iu.BEGIN) == 1


def test_broken_settings_left_untouched(tmp_path):
    (tmp_path / "settings.json").write_text("{oops", encoding="utf-8")
    assert iu.main(["--dest", str(tmp_path)]) == 1
    assert (tmp_path / "settings.json").read_text(encoding="utf-8") == "{oops"
    assert not (tmp_path / "CLAUDE.md").exists()


def run_hook(name, payload, home=None):
    env = {**os.environ, "HOME": str(home), "USERPROFILE": str(home)} if home else None  # hooks keep state in ~
    return subprocess.run([sys.executable, str(HOOKS / name)], input=json.dumps(payload),
                          capture_output=True, text=True, encoding="utf-8", env=env)


@pytest.mark.parametrize("cmd,code", [
    ("rm -rf ~/Documents/x", 2),
    ("git reset --hard", 2),
    ("git stash drop", 2),
    ("git branch -D test", 2),
    ("ls", 0),
    ("rm -f /tmp/probe.txt", 0),
    ('git commit -m "fix: del button"', 0),
])
def test_no_delete(cmd, code):
    assert run_hook("no_delete.py", {"tool_name": "Bash", "tool_input": {"command": cmd}}).returncode == code


@pytest.mark.parametrize("name,payload", [
    ("razmer_konteksta.py", {}),
    ("posle_szhatiya.py", {"source": "compact"}),
    ("sekrety_git.py", {"tool_name": "Bash", "tool_input": {"command": "ls"}}),
])
def test_other_hooks_stay_quiet(name, payload, tmp_path):
    r = run_hook(name, payload, home=tmp_path)
    assert r.returncode == 0 and "Traceback" not in r.stderr and '"deny"' not in r.stdout


def test_secret_in_commit_is_denied(tmp_path):
    git = lambda *a: subprocess.run(["git", *a], cwd=tmp_path, check=True, capture_output=True)
    git("init", "-q")
    (tmp_path / "conf.txt").write_text("token = ghp_" + "a" * 36 + "\n", encoding="utf-8")  # built here, not a literal
    git("add", "conf.txt")
    r = run_hook("sekrety_git.py", {"tool_name": "Bash", "cwd": str(tmp_path), "permission_mode": "default",
                                    "tool_input": {"command": "git commit -m test"}}, home=tmp_path)
    assert json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"
