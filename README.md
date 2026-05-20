# agent-harness

Local CLI harness for long-running Claude Agent SDK sessions, following the [Anthropic harness-design pattern](https://www.anthropic.com/engineering/harness-design-long-running-apps).

Three roles, each a separate Claude session, communicating via files:

- **Planner** — reads your task, explores the target repo read-only, writes `plan.md` + per-sprint `contract.md` with rubrics + verification commands.
- **Executor** — implements one sprint at a time in the target repo.
- **Evaluator** — adversarial QA, runs verification commands, writes `verdict.md` (PASS / FAIL).

State lives in `~/.agent-harness/runs/<run_id>/`. Files are the only shared state.

## Install

```bash
cd ~/Developer/agent-harness
npm install
npm run build
ln -sf "$PWD/bin/harness" /usr/local/bin/harness    # optional

# build the web UI bundle (one-time, also rebuilds on each `harness serve` cycle if you re-run)
npm run build:web
```

Set `ANTHROPIC_API_KEY` in your env.

## Web UI

```bash
harness serve          # serves http://127.0.0.1:8787
harness serve --port 9000 --host 0.0.0.0
```

The UI streams live state from `~/.agent-harness/runs/`. From the browser you can:

- watch **multiple harnesses iterating simultaneously** — sidebar lists every run with status, current role, sprint, cost
- **start new runs** from a form (target repo + task + optional `--base`/`--branch` for stacked workflows)
- **auto-iterate** — kicks off planner → executor/evaluator loop and runs to completion or halt
- **visualize the plan** as rendered markdown, edit it inline, and save (re-parses sprint headers, updates `total_sprints` when safe)
- **see sprint progress** with PASS/FAIL badges and per-sprint contract/output/verdict tabs
- watch the **live SDK transcript** stream (assistant text, tool calls, tool results, result message) via Server-Sent Events
- see **cost** per role, per sprint, per session — with token-level breakdown (input/output/cache create/cache read), turns, duration
- **edit the system prompts** for planner/executor/evaluator from the UI (writes `src/prompts/*.md`; takes effect on next role invocation)
- **edit per-sprint contracts** inline (planner-written rubrics; useful when the planner over- or under-scopes a sprint)
- **abort** runs from the UI

Cost is parsed from the JSONL transcript files the SDK writes — no extra instrumentation.

## Mental model: run vs sprint vs PR

| | What it is | Maps to |
|---|---|---|
| **Sprint** | One executor → evaluator loop. Has a contract, a rubric, and verification commands. All sprints in a run land on **the same branch**. | A checkpoint inside one PR |
| **Run** | One `harness init`. One branch. Contains 1+ sprints. | One pull request |
| **Stack** | Several runs whose branches are based on each other. | Several stacked PRs |

A sprint is **never** its own PR. Sprints are the planner's way of breaking *one PR's worth of work* into checkpointable pieces. PR boundaries are your call — the planner explicitly flags when a task is too big for one PR and recommends a split.

## Quickstart — stacked PR workflow

```bash
ORIGIN=~/Developer/payabli-datalake

# PR #1 — bottom of the stack, branches off develop
R1=$(harness init --repo "$ORIGIN" --base develop \
        --branch feat/payout-bronze --task-file sprint1.md)

harness plan --run "$R1"
harness next --run "$R1"     # executor
harness next --run "$R1"     # evaluator
# repeat until status == completed

# Push and open PR #1
cd ~/.agent-harness/worktrees/$R1
gt submit --stack            # or: git push -u origin HEAD && gh pr create

# PR #2 — stacked on PR #1's branch
R2=$(harness init --repo "$ORIGIN" --base feat/payout-bronze \
        --branch feat/payout-silver --task-file sprint2.md)

# PR #3 — stacked on PR #2's branch
R3=$(harness init --repo "$ORIGIN" --base feat/payout-silver \
        --branch feat/payout-gold --task-file sprint3.md)
```

When PR #1 merges into `develop`, run `gt sync` (or `git rebase`) from inside the run 2 worktree to restack the rest.

After a PR merges, close out the run and reclaim the worktree:

```bash
harness finish --run "$R1" --purge
```

## Legacy single-checkout mode

`harness init` without `--base` writes directly into the target repo on whatever branch is checked out — same behavior as before this feature. Useful for quick experiments where you don't care about stacking.

```bash
harness init --repo ~/Developer/some-repo --task "fix the bug"
```

## Commands

| Command | Purpose |
|---|---|
| `harness init --repo … --base <branch>` | Create a run in a new worktree branched off `<branch>` |
| `harness init --repo …` *(no --base)* | Create a run that writes directly into the target repo |
| `harness plan` | Invoke the planner |
| `harness next` | Invoke whichever role is next (executor or evaluator) |
| `harness status` | Print state.json |
| `harness logs` | Tail SDK transcripts |
| `harness list` | List all runs |
| `harness retry` | Bump current role to re-run |
| `harness finish [--purge]` | Mark a run completed; optionally remove the worktree |
| `harness abort [--purge]` | Mark a run aborted; optionally remove the worktree |
| `harness serve [--port N]` | Start the local web UI (live transcripts, costs, prompt + plan editing, multi-run dashboard) |

See `docs/superpowers/specs/2026-05-19-agent-harness-design.md` for the full design.

## Layout under `~/.agent-harness/`

```
runs/<run_id>/
├── task.md
├── plan.md
├── state.json           run metadata; includes worktree fields when --base was used
├── sprints/01-<slug>/
│   ├── contract.md      planner-written: scope + rubric + verification cmds
│   ├── output.md        executor's summary
│   └── verdict.md       evaluator's PASS|FAIL + reasoning
└── logs/                per-role SDK transcripts (JSONL)

worktrees/<run_id>/      git worktree, only present when run was created with --base
```
