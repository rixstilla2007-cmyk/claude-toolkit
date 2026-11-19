---
name: assemble-team
description: Run a large task with a team of subagents — split it into independent parts, pick an agent for each (hiring a missing specialist with hire-agent), brief them, run independent parts in parallel, then verify, critique and merge the results. Use for tasks with several separable parts, or when the user asks for a team of agents.
---

# Assemble a team

You are the lead. Subagents cannot start other subagents, so the lead does
all hiring, dispatching and merging.

## 1. Decide if a team is worth it

A team costs more tokens and time than doing the work yourself. Use one only
when the task has 2+ parts that are independent (no shared files being
edited, no part needing another's output) or when a part needs a specialist.
Otherwise do it yourself and say why.

## 2. Plan

Write a short table before dispatching:

| Part | Agent | Depends on | Done when |
| --- | --- | --- | --- |

- Pick from `python3 scripts/hire_agent.py list` and the built-in agents
  (`Explore` for code search, `Plan` for design, `general-purpose`).
- A part with no fitting agent: follow the `hire-agent` skill. If the new
  agent is not callable in this session yet, use `general-purpose` with the
  same brief.
- Two parts that edit the same files are one part, or run one after another.

Show the plan to the user when the task is large, costly or ambiguous; ask
the questions whose answers would change it.

## 3. Brief each agent

Each brief stands alone (the agent sees nothing else): the goal, the exact
files or sources, constraints, what "done" means, and the report format.
Include facts you already established so it does not redo them.

## 4. Dispatch

Start independent parts in one message so they run in parallel. Dependent
parts wait for their inputs. Do not start a duplicate of an agent that is
still running; wait for its result.

## 5. Check, then merge

- Read every report; reject claims without evidence.
- Send code changes to `reviewer`, and the finished result to `verifier`.
- For a plan, text or design, send it to `critic`.
- Fix or re-brief what fails; do not hide a failed part.
- Merge into one answer: what was done, by whom, the evidence, and what is
  still open.

End with the `Проверка: …` line from the `verify-before-done` skill.
