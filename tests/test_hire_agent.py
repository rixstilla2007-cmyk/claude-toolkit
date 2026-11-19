import importlib.util
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("hire_agent", ROOT / "scripts" / "hire_agent.py")
ha = importlib.util.module_from_spec(spec)
sys.modules["hire_agent"] = ha
spec.loader.exec_module(ha)

BODY = (
    "You audit pages for SEO. Method: fetch the page, check title, meta, headings, "
    "links. Report: findings by severity with the URL and the fix."
)


def hire(tmp_path, *extra, name="seo-auditor", tools="Read,WebFetch", body=BODY):
    return ha.main([
        "--dir", str(tmp_path), "hire", f"--name={name}",
        "--description", "Audits a web page for SEO problems and lists fixes.",
        "--tools", tools, "--body", body, *extra,
    ])


def test_hire_writes_a_valid_agent(tmp_path):
    assert hire(tmp_path) == 0
    agent = ha.parse_agent(tmp_path / "seo-auditor.md")
    assert agent["name"] == "seo-auditor"
    assert agent["tools"] == ["Read", "WebFetch"]


def test_refuses_to_overwrite_without_force(tmp_path, capsys):
    assert hire(tmp_path) == 0
    assert hire(tmp_path) == 2
    assert "exists" in capsys.readouterr().err
    assert hire(tmp_path, "--force") == 0


@pytest.mark.parametrize("name", ["SEO", "seo_auditor", "-x", "general-purpose", "a" * 65])
def test_rejects_bad_names(tmp_path, name):
    assert hire(tmp_path, name=name) == 2
    assert not list(tmp_path.glob("*.md"))


def test_rejects_unknown_tool_but_allows_mcp(tmp_path):
    assert hire(tmp_path, tools="Read,Teleport") == 2
    assert hire(tmp_path, tools="Read,mcp__github__get_issue") == 0


def test_rejects_thin_body(tmp_path):
    assert hire(tmp_path, body="Do SEO.") == 2


def test_install_copies_and_backs_up(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("CLAUDE_HOME", str(home))
    agents = tmp_path / "agents"
    assert hire(agents, "--install") == 0
    installed = home / "agents" / "seo-auditor.md"
    assert installed.read_text() == (agents / "seo-auditor.md").read_text()
    installed.write_text("old version\n")
    assert hire(agents, "--install", "--force") == 0
    assert (home / "agents" / "seo-auditor.md.bak").read_text() == "old version\n"


def test_check_and_list_flag_broken_files(tmp_path, capsys):
    assert hire(tmp_path) == 0
    (tmp_path / "broken.md").write_text("no frontmatter here\n")
    assert ha.main(["--dir", str(tmp_path), "check"]) == 1
    out = capsys.readouterr().out
    assert "broken.md: no frontmatter" in out
    assert ha.main(["--dir", str(tmp_path), "list"]) == 1


def test_toolkit_agents_all_pass_check():
    assert ha.main(["check"]) == 0
