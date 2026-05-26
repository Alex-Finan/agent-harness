# Agent Harness — Design

**Status:** Draft v1
**Owner:** Alex
**Date:** 2026-05-19
**Pattern reference:** [Anthropic — Harness design for long-running agents](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## 1. Purpose

A general-purpose, local-CLI harness for running long (multi-hour) Claude Agent SDK sessions against any target repository, using a three-role split — **Planner → Executor → Evaluator** — that handles work the way Anthropic's article describes: file-based handoffs, fresh contexts per role, and an LLM-as-judge evaluator working from a rubric the planner writes.

The harness is the orchestrator. Claude is the worker. Files on disk are the only shared state.

## 2. Non-goals

- Not a service. No HTTP API, no daemon, no Slack integration.
- Not multi-user or multi-machine. One operator, one Mac, files on disk.
- Not crash-recoverable beyond "resume from the last role boundary."
- Not parallel. Sprints run sequentially. Roles never run concurrently.
- Not domain-specific. Knows nothing about any particular stack, language, or codebase. The planner figures out what the target repo needs.

## 3. Roles

Three Claude sessions, each invoked with a separate context. Files are the only handoff.

| Role | Reads | Writes | Tools |
|---|---|---|---|
| **Planner** | `task.md`, target repo (read-only exploration) | `plan.md`, `sprints/NN/contract.md` (one per sprint) | Read, Glob, Grep, Bash (read-only commands only) |
| **Executor** | `plan.md`, current `sprints/NN/contract.md`, prior `verdict.md` if retry | `sprints/NN/output.md`, code changes in target repo | Full tool set: Read, Edit, Write, Bash, etc. |
| **Evaluator** | `plan.md`, `sprints/NN/contract.md`, `sprints/NN/output.md`, target repo as it now stands | `sprints/NN/verdict.md` | Read, Bash (verification commands only), Grep |

**Planner is read-only against the target repo.** Never writes code.
**Executor is the only role that mutates the target repo.**
**Evaluator may run commands** (test suites, scripts, queries the rubric names) but **never edits code**. If a fix is needed, the verdict says so and the harness routes back to the executor.

## 4. Loop & control flow

The harness is a CLI. It does not run roles in a single process. Each role invocation is a separate process that exits when the role finishes, leaving its artifacts on disk. The operator (or an outer shell loop) calls `harness next` to step forward.

```
init  →  plan  →  for each sprint:
                    executor  →  evaluator  →  pass?
                                              ├─ yes → next sprint
                                              └─ no  → executor (retry, max N)
         →  done
```

### State machine

`state.json` at the run root tracks:

```json
{
  "run_id": "2026-05-19-093712-ace1f3",
  "target_repo": "/Users/<user>/Developer/your-repo",
  "current_sprint": 2,
  "total_sprints": 5,
  "next_role": "evaluator",
  "retry_count": 0,
  "max_retries": 3,
  "status": "in_progress"
}
```

`next_role` advances on completion of each role. The harness reads it on `next` to know what to invoke. No daemon; the file is the source of truth.

### Retry policy

If evaluator returns fail, harness increments `retry_count` and routes back to executor with verdict appended to its prompt. If `retry_count > max_retries`, harness halts and surfaces the sprint for human review.

## 5. On-disk layout

Run state lives in `~/.agent-harness/`, **not** in the target repo. This keeps the harness invisible to git in the target repo.

```
~/.agent-harness/
├── config.yaml                       global defaults (model, max_retries, etc.)
└── runs/
    └── <run_id>/
        ├── task.md                   user's original prompt + metadata
        ├── plan.md                   planner output
        ├── state.json                state machine
        ├── sprints/
        │   ├── 01-<slug>/
        │   │   ├── contract.md       planner-written: scope + rubric
        │   │   ├── generator.log     full SDK transcript
        │   │   ├── output.md         executor hand-off summary
        │   │   ├── verdict.md        evaluator pass/fail + rubric scores
        │   │   └── attempts/         retry transcripts archived here
        │   └── 02-<slug>/
        └── logs/
            └── harness.log           CLI-level events (timestamps, role starts/ends)
```

## 6. The contract file

The planner writes one `contract.md` per sprint. This file is the seam between planner intent and evaluator judgment. Format:

```markdown
# Sprint NN — <slug>

## Scope
<what this sprint changes; bounded so executor work is < ~30 min>

## Inputs
<files/paths/data the executor needs>

## Deliverables
<files created/modified, commands run, etc.>

## Rubric
1. <criterion 1 — e.g., "All new tests pass when running `pytest tests/foo/`">
2. <criterion 2 — e.g., "No regressions in `make lint`">
3. <criterion 3 — e.g., "Schema in registry/features.yaml validates per `python scripts/registry.py validate`">
...

## Verification commands
- `<command 1>` — expected: <what counts as success>
- `<command 2>` — expected: <what counts as success>
```

The evaluator's job: **run every command in "Verification commands", grade against every criterion in "Rubric"**, and produce verdict.md. The planner sets the bar; the evaluator enforces it.

## 7. The verdict file

```markdown
# Sprint NN — Verdict: PASS | FAIL

## Rubric scoring
1. <criterion 1> — PASS — <evidence>
2. <criterion 2> — FAIL — <evidence + what's missing>
...

## Verification command results
- `<command 1>` — exit 0, output matched expected
- `<command 2>` — exit 1, output: <snippet>

## Fix-it-back notes (only present on FAIL)
<specific, actionable notes for the executor's next attempt>
```

Verdict is binary at the sprint level (PASS = all criteria pass + all commands succeed). Per-criterion FAIL is allowed in the body but rolls up to a sprint-level FAIL.

## 8. CLI surface

```bash
harness init --repo <path> --task <file|inline>     # creates run dir + task.md + initial state
harness plan                                        # invokes planner, writes plan.md + sprint contracts
harness next                                        # invokes whichever role state.json says is next
harness status                                      # prints state + last verdict
harness logs [--sprint N] [--role R]                # tails logs for current or specified sprint/role
harness retry --notes "<text>"                      # forces re-run of current role with extra prompt notes
harness abort                                       # marks run halted, preserves all files
harness list                                        # lists known runs
```

`harness next` is the workhorse. It reads `state.json`, dispatches the correct role, blocks until that role's session completes, writes the updated state, exits.

## 9. Component breakdown

```
agent-harness/
├── src/
│   ├── cli/
│   │   ├── index.ts                  CLI entry (commander/yargs)
│   │   └── commands/                 one file per subcommand
│   ├── state/
│   │   ├── run.ts                    Run model: dirs, paths, state.json read/write
│   │   └── transitions.ts            state machine: next_role logic
│   ├── roles/
│   │   ├── planner.ts                builds planner SDK session
│   │   ├── executor.ts               builds executor SDK session
│   │   └── evaluator.ts              builds evaluator SDK session
│   ├── prompts/
│   │   ├── planner.md                system prompt template
│   │   ├── executor.md
│   │   └── evaluator.md
│   ├── sdk/
│   │   └── session.ts                thin wrapper over @anthropic-ai/claude-agent-sdk
│   └── lib/
│       ├── paths.ts                  ~/.agent-harness/ resolution
│       └── logger.ts
├── docs/
│   └── superpowers/specs/...
├── package.json
└── tsconfig.json
```

Each module is bounded:
- `state/` knows files and JSON, nothing about Claude.
- `roles/` knows prompts and tool allowlists per role, nothing about state files (gets paths handed to it).
- `sdk/session.ts` is the only file that imports `@anthropic-ai/claude-agent-sdk`.
- `cli/` orchestrates state ↔ roles, has no business logic.

## 10. Tool allowlists per role

This is the only opinion the harness imposes on Claude. Enforced by passing different tool sets to each SDK session:

- **Planner:** `Read, Glob, Grep, Bash(allow:[git,ls,cat,head,tail,find,pwd])`. No write tools. Bash is restricted to read-only commands via the SDK's bash command filtering.
- **Executor:** Full default tool set (Read, Edit, Write, Bash, NotebookEdit, etc.).
- **Evaluator:** `Read, Grep, Bash(allow:[*])` — needs full bash to run test suites, scripts, queries; but **no Edit/Write tools**.

## 11. Self-evaluation bias mitigation

Per the Anthropic article: agents grade their own work too generously. Mitigations baked in:

1. **Separate SDK sessions.** Evaluator never sees executor's transcript except through `output.md`.
2. **Rubric and verification commands are written by the planner**, not the executor. The executor cannot move the goalposts.
3. **Evaluator's prompt explicitly frames its job as adversarial QA**, not collaboration: "Your job is to find ways this fails the rubric. Default to FAIL when evidence is missing."
4. **Failure on missing verification.** If `output.md` doesn't tell the evaluator how to verify, the verdict is FAIL with a note requesting the executor produce verifiable evidence. The harness will not let the executor declare victory without proof.

## 12. Error handling

| Situation | Behavior |
|---|---|
| SDK session crashes mid-role | Role-level transcript preserved in `attempts/`; state.json unchanged; user must `harness retry` |
| Planner produces empty/garbage `plan.md` | No automatic detection; surfaced by next role failing. Future: a "plan validator" pre-check. |
| Executor exhausts retries | Halt the run, leave all files for inspection. Operator decides: edit contract by hand, `harness retry`, or `harness abort`. |
| Disk full / permissions errors | Hard exit with clear message, no partial state writes (write to tmp then rename). |
| Run dir already exists on `init` | Refuse unless `--force`. |

## 13. Testing strategy

- **Unit:** state transitions, path resolution, contract.md parsing, verdict.md parsing — all pure functions, easy to test.
- **Integration:** mock SDK session with canned responses; run full planner→executor→evaluator loop against a fixture target repo (e.g., a tiny dummy Python project with one failing test). Assert files land in the right shape.
- **No live SDK tests in CI.** Manual smoke against a real target repo before each release.

## 14. Out of scope (deferred to V2+)

- Daemon mode / crash recovery beyond role boundaries
- Slack or web UI
- Multi-machine sync of run state
- Parallel sprints
- Cost / token tracking dashboards (SDK already logs to stdout)
- Plan-validator pre-check
- Cross-run learning (planner reading prior runs' verdicts)
- Hosted version on ECS

## 15. Open questions

None blocking. Will revisit if these come up during implementation:

- Should `contract.md` be parsed as structured (frontmatter + sections) or free-text? Lean: free-text for V1, parse heuristically.
- Should the executor be allowed to amend its own `contract.md` if it discovers scope was misjudged? Lean: no — escalate via halt instead.

## 16. Success criteria for V1

- Can `init` a run against any local repo path.
- Planner produces a plan and at least one sprint contract.
- Executor produces code changes and `output.md`.
- Evaluator runs the rubric's verification commands and produces a verdict.
- Loop can iterate retries automatically until pass or max_retries.
- Operator can `status`, `logs`, `retry`, `abort` at any boundary.
- All state survives `harness next` exits — resume hours later works without ceremony.
