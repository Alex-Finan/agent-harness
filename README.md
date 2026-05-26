# agent-harness

> Local CLI + web UI for running long, multi-sprint Claude Agent SDK sessions through a **Planner → Executor → Evaluator** loop — based on the [Anthropic harness-design pattern](https://www.anthropic.com/engineering/harness-design-long-running-apps).

Designed for work that's too big for a single Claude Code conversation: multi-file refactors, migrations, and feature work that needs to survive context resets. Each run produces one branch (and typically one PR); within a run, the planner splits work into sprints with rubrics and verification commands, and the loop iterates until every sprint passes.

```
┌──────────┐    plan.md       ┌──────────┐    output.md    ┌───────────┐
│ Planner  │ ───────────────▶ │ Executor │ ──────────────▶ │ Evaluator │ ──▶ PASS / FAIL
└──────────┘   contract.md    └──────────┘                 └───────────┘
                                                                 │
                                                                 ▼
                                                          next sprint, or done
```

All shared state lives on disk under `~/.agent-harness/runs/<run_id>/` — files are the only communication channel between roles. Each role runs as its own Claude session, so you can inspect, edit, or replay any step.

---

## Prerequisites

- **Node.js ≥ 20.19**
- **`ANTHROPIC_API_KEY`** — export in your shell, or save it from the in-app **Settings** panel after install (persists to `~/.agent-harness/config.json` with `0600` perms; env var wins when set)
- **git** with worktree support (built in to modern git)
- *Optional:* [`gt`](https://graphite.dev) if you want the stacked-PR submit workflow

---

## Install

```bash
git clone https://github.com/Alex-Finan/agent-harness.git
cd agent-harness
npm install
npm run build           # compiles the CLI + MCP server
npm run build:web       # builds the web UI bundle

# put `harness` on your PATH (optional but recommended)
ln -sf "$PWD/bin/harness" /usr/local/bin/harness
```

Verify:

```bash
harness --help
```

---

## Quickstart — your first run

The fastest way in is the web UI. It handles `init → plan → next → next → …` for you with one click.

```bash
harness serve            # http://127.0.0.1:8787
```

In the browser:

1. Click **New Run**.
2. Pick a target repo (any local git repo you want the harness to work on).
3. Paste a task description — e.g. *"Add a `--dry-run` flag to the CLI that prints what would happen without writing files."*
4. Click **Auto-iterate**. The planner writes `plan.md`, then the executor/evaluator loop runs sprint by sprint until everything passes (or halts on FAIL).

You'll see:

- live SDK transcript streaming (assistant text, tool calls, results)
- cost per role / sprint / token type
- PASS / FAIL badges on each sprint
- editable plan markdown + per-sprint contracts

### Or do it from the CLI

```bash
# 1. create a run
RUN=$(harness init --repo ~/Developer/my-project --task "Add a --dry-run flag to the CLI")

# 2. plan
harness plan --run "$RUN"

# 3. iterate — `next` runs whichever role is up (executor or evaluator)
harness next --run "$RUN"
harness next --run "$RUN"
# … repeat until `harness status --run "$RUN"` shows completed

# 4. inspect
harness logs --run "$RUN"
```

When the run completes, your changes are committed on the current branch of the target repo, ready to push.

---

## Use it from Claude Code (recommended)

The harness ships an **MCP server** that exposes every operation (init, plan, next, list, status, edit plan/contract, abort, tail logs, …) as Claude Code tools. This is usually the nicest way to drive it — you describe the work in plain English and Claude calls the harness for you.

Add to `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "harness": {
      "command": "/absolute/path/to/agent-harness/bin/harness",
      "args": ["mcp"]
    }
  }
}
```

Then in any Claude Code conversation:

- *"Kick off a harness run on `~/Developer/my-project` to add a dark-mode toggle to the settings page."*
- *"List my active harness runs and show the current sprint for each."*
- *"Show me the verdict of sprint 2 on run `2026-05-20-143000-abc123`."*
- *"Abort the stalled run and purge its worktree."*

---

## Mental model: run vs sprint vs PR

| | What it is | Maps to |
|---|---|---|
| **Sprint** | One executor → evaluator cycle. Has a contract (scope + rubric + verification commands). All sprints in a run land on **the same branch**. | A checkpoint inside one PR |
| **Run** | One `harness init`. One branch. Contains 1+ sprints. | One pull request |
| **Stack** | Several runs whose branches are based on each other. | Several stacked PRs |

A sprint is **never** its own PR. Sprints are the planner's way of breaking *one PR's worth of work* into checkpointable pieces. The planner explicitly flags when a task is too big for one PR and suggests how to split it.

---

## Stacked PRs (advanced)

For larger features, chain runs together with `--base` so each PR branches off the previous one:

```bash
ORIGIN=~/Developer/your-repo

# PR #1 — bottom of the stack, branches off develop
R1=$(harness init --repo "$ORIGIN" --base develop \
        --branch feat/payout-bronze --task-file sprint1.md)
harness plan --run "$R1"
# … iterate to completion

cd ~/.agent-harness/worktrees/$R1
gt submit --stack            # or: git push -u origin HEAD && gh pr create

# PR #2 — stacked on PR #1
R2=$(harness init --repo "$ORIGIN" --base feat/payout-bronze \
        --branch feat/payout-silver --task-file sprint2.md)

# PR #3 — stacked on PR #2
R3=$(harness init --repo "$ORIGIN" --base feat/payout-silver \
        --branch feat/payout-gold --task-file sprint3.md)
```

When PR #1 merges into `develop`, run `gt sync` (or `git rebase`) from the next worktree to restack the rest.

Clean up a finished run:

```bash
harness finish --run "$R1" --purge      # marks completed, removes the worktree
```

`harness init` **without** `--base` writes directly into the target repo on whatever branch is checked out — handy for quick experiments where you don't care about stacking.

---

## Desktop app (optional)

A native Electron shell that wraps the server + UI in a real window — no `harness serve` + browser tab needed:

```bash
npm run desktop            # dev: builds + launches the Electron window
npm run desktop:dist:mac   # produce a .dmg in desktop/release/
```

Native menus include **File → New Run** and **File → Open ~/.agent-harness**.

---

## CLI reference

| Command | Purpose |
|---|---|
| `harness init --repo … --base <branch>` | Create a run in a new worktree branched off `<branch>` |
| `harness init --repo …` *(no `--base`)* | Create a run that writes directly into the target repo |
| `harness plan --run <id>` | Invoke the planner |
| `harness next --run <id>` | Invoke whichever role is next (executor or evaluator) |
| `harness status --run <id>` | Print `state.json` |
| `harness logs --run <id>` | Tail SDK transcripts |
| `harness list` | List all runs |
| `harness retry --run <id>` | Bump current role to re-run |
| `harness finish --run <id> [--purge]` | Mark completed; optionally remove the worktree |
| `harness abort --run <id> [--purge]` | Mark aborted; optionally remove the worktree |
| `harness serve [--port N] [--host H]` | Start the local web UI (loopback by default; **see security note below before binding to non-loopback**) |
| `harness mcp` | Run the MCP server (used by Claude Code, not directly by you) |

---

## On-disk layout

```
~/.agent-harness/
├── config.json                       optional, holds saved API key (0600)
├── runs/<run_id>/
│   ├── task.md                       the prompt you gave the planner
│   ├── plan.md                       planner output: sprint list + rationale
│   ├── state.json                    run metadata (status, current role/sprint, cost)
│   ├── sprints/01-<slug>/
│   │   ├── contract.md               planner-written: scope + rubric + verification cmds
│   │   ├── output.md                 executor's summary
│   │   └── verdict.md                evaluator's PASS|FAIL + reasoning
│   └── logs/                         per-role SDK transcripts (JSONL)
└── worktrees/<run_id>/               git worktree (only when run was created with --base)
```

Everything is plain text or JSON — `cat`, `grep`, and your editor work fine for inspecting or hand-editing any of it.

---

## Web UI features at a glance

- **Multi-run sidebar** — every run with status, current role, sprint, cost
- **Auto-iterate** — planner → executor → evaluator loop runs to completion or halt
- **Plan editor** — rendered markdown, edit + save inline; re-parses sprint headers
- **Per-sprint tabs** — contract / output / verdict, with PASS/FAIL badges
- **Live SDK transcript** via SSE — assistant text, tool calls, results, final message
- **Cost panel** — per role, per sprint, per session; token breakdown (input/output/cache create/cache read), turns, duration. Parsed from the JSONL transcripts the SDK already writes — no extra instrumentation.
- **Prompt editor** — edit `src/prompts/{planner,executor,evaluator}.md` from the UI; takes effect on next role invocation
- **Contract editor** — tweak the planner's rubric per sprint when it over- or under-scopes
- **Abort** from the UI

---

## Security notes

- **The web server has no authentication.** Default bind is `127.0.0.1`, which is safe — only your own machine can reach it. Do **not** bind to a non-loopback address (`--host 0.0.0.0`, your LAN IP, etc.) on an untrusted network: anyone reachable on that interface could trigger runs, spend your Anthropic API credit, and have the executor read or modify any local git repo on the host. Use an SSH tunnel if you need remote access.
- **The executor writes to and commits in real git repos** you point it at. Use a worktree (`--base <branch>`) or a scratch clone unless you're comfortable with that.
- **API keys** are read from `ANTHROPIC_API_KEY` or `~/.agent-harness/config.json` (`0600`). They are not sent anywhere except to the Anthropic API by the SDK.

## Design doc

Full architecture & rationale: [`docs/superpowers/specs/2026-05-19-agent-harness-design.md`](docs/superpowers/specs/2026-05-19-agent-harness-design.md).

## License

MIT — see [LICENSE](LICENSE) if present, otherwise treat as MIT.
