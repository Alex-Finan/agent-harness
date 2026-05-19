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
```

Set `ANTHROPIC_API_KEY` in your env.

## Quickstart

```bash
# 1. Start a run
RUN=$(harness init --repo ~/Developer/payabli-datalake --task "Add silver/vendor_address_clusters.py per RFC-004")
echo "$RUN"

# 2. Plan
harness plan --run "$RUN"

# 3. Walk through sprints
harness next --run "$RUN"     # invokes executor
harness next --run "$RUN"     # invokes evaluator
# repeat until status == completed (or halted)

# Inspect
harness status --run "$RUN"
harness logs --run "$RUN"
```

## Commands

| Command | Purpose |
|---|---|
| `harness init` | Create a run |
| `harness plan` | Invoke the planner |
| `harness next` | Invoke whichever role is next (executor or evaluator) |
| `harness status` | Print state.json |
| `harness logs` | Tail SDK transcripts |
| `harness list` | List all runs |
| `harness retry` | Bump current role to re-run |
| `harness abort` | Mark run aborted |

See `docs/superpowers/specs/2026-05-19-agent-harness-design.md` for the full design.

## Layout under `~/.agent-harness/`

```
runs/<run_id>/
├── task.md
├── plan.md
├── state.json
├── sprints/01-<slug>/
│   ├── contract.md      planner-written: scope + rubric + verification cmds
│   ├── output.md        executor's summary
│   └── verdict.md       evaluator's PASS|FAIL + reasoning
└── logs/                per-role SDK transcripts (JSONL)
```
