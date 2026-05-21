# Web UI Improvements — Scoping

Working doc. Goal: make the harness UI the kind of thing you leave open on a side
monitor for half a day and can glance at to instantly know **what every agent is
doing, where it's stuck, and whether the plan still looks right**.

Two design pillars:

1. **Planning management** — reviewing/editing plan.md and per-sprint
   contracts should feel like a real review surface, not a markdown blob with
   an edit button.
2. **Progress tracking** — at a glance an operator should answer four
   questions for every run, in <1 second:
   - Is it moving right now? Or is it waiting on me?
   - How far through is it?
   - Did anything just go wrong?
   - How much has it cost / how long has it taken?

## What I observed in the UI tour

I seeded six fixture runs (planning-no-plan, planning-with-plan, mid-sprint,
halted/FAIL, completed, aborted) at `~/.agent-harness/runs/` and walked the UI
in playwright.

### Pain points

**Status legibility**

- `in progress` (green) is used both for *actively-dispatching* and for
  *idle-waiting-for-operator*. Operators can't distinguish "agent is thinking"
  from "agent is paused for input" without reading the small "operator action
  needed" pill on the right side.
- The yellow `needs action` pill in the sidebar is shown on every idle in-progress
  row — but those rows are also colored "in progress." So the most actionable
  visual state (operator must do something) gets the second-loudest badge.
- The header has *seven* simultaneous pieces of state (status badge, dispatching
  pill, verdict badge, "updated Xs ago", role pill, task summary, sub-line of
  metadata). No visual hierarchy — everything is the same weight.

**Progress is invisible until you click**

- The sidebar shows `sprint 3/5` but no progress bar / no PASS/FAIL dots per
  sprint. You have to click into a run to find out whether sprint 2 passed or
  failed.
- The sprint timeline shows the right info but requires expansion to read the
  contract. The list is also vertical with each row taking ~50px — for a
  5-sprint plan that's almost a screen.
- No timeline of *when* phases changed. "How long did sprint 2 actually take?"
  has no answer in the UI.
- The role pill (`planner → executor → evaluator`) doesn't tell you *which
  sprint* it relates to, and it's small / low-contrast.

**Halted/failed runs hide the diagnostic**

- When a run is halted on FAIL, the *reason* (verdict.md) is buried behind
  clicking the failed sprint → switching to the verdict tab. The most important
  thing on the page (why are we stuck?) takes two clicks to read.
- No "last 3 lines of verdict.md" preview anywhere.

**Plan view in sprint mode is dead weight**

- Once sprints exist, plan.md still takes a quarter of the SprintView grid.
  Most of the time you don't need to re-read the plan — you need to see what's
  happening now. Plan should collapse to a one-line "view plan" affordance.

**Cost panel takes a lot of space for tiny info**

- 3-tile header + per-role grid + full table = ~45% of the right column on a
  finished run. For monitoring, total + delta-since-last-load is more useful.

**No cross-run dashboard**

- The `RunOverview` (no-selection state) is a tiny prompt — "Select a run."
  Wasted screen. A live dashboard of all in-flight runs would be high-leverage
  on a side monitor.

**Sidebar density**

- Each row is ~80px tall with 4 lines of text. Hard to compare 10 runs at once.
- `run_id` mono string at the bottom of every row is rarely useful and adds
  weight.
- The group-by-base_branch is good but the `⎇ develop` header is duplicated on
  every row inside the group.

**Cosmetic bug**

- In the run header, target repo + branch render with no separator:
  `/Users/alexanderfinan/sports_trading_algfeat/cpi-v3-conformal`. Need a
  space/divider.

**Planning UI gaps**

- "Revise Plan" is a one-line input. Plan revision is usually a paragraph of
  feedback. Should be a textarea with Cmd+Enter to send.
- No way to see *diff* of what the planner changed when it revises. The
  planner just writes a new plan.md and the operator has to remember what was
  there.
- No way to preview each sprint's contract before the executor runs. You can
  only review the contract once it exists, by then you've already paid the
  planning cost.
- The plan markdown's "Sprint N — ..." headings aren't linked to the actual
  sprint rows in the timeline. Operator has to mentally cross-reference.

## Prioritized improvements

Ranked by impact-per-effort. Each entry: **what**, **why it matters**, **files
touched**, **rough effort**.

### P0 — high impact, small effort

**1. Unified status + activity indicator in the header**
- Replace the "in progress" green badge + separate "operator action needed"
  pill with one large status chip that has four states: `Running`, `Idle ·
  needs action`, `Halted · failed`, `Done`. Color-coded with an icon.
- Add a live "current activity" line: `executor is editing
  adapters/kalshi/cpi_yoy.py` pulled from the most recent assistant
  tool_use in the transcript stream.
- *Why*: this is what the operator looks at first. Right now the truth is
  scattered across 3+ visual elements.
- Files: `RunDetail.tsx`, `StatusBadge.tsx`, possibly add
  `ActivityLine.tsx`.
- Effort: 1-2 hours.

**2. Sidebar: collapse run row to a single dense line with mini-progress**
- Each row: status icon (1ch), task summary (truncate), sprint pips
  `●●○◌◌` (PASS/FAIL/running/pending), branch tag, age.
- Move `run_id` to title attribute / hover; drop the dollar amount when zero.
- Render rows at ~40-44px instead of ~80px. Doubles density.
- *Why*: a 10-run sidebar should fit on screen. Right now it scrolls after 5.
- Files: `RunList.tsx`.
- Effort: 1-2 hours.

**3. Verdict-on-top: when a sprint failed, show the FAIL summary at the
header level**
- If `status === 'halted'`, render an inline alert under the title with the
  first ~3 lines of `verdict.md` of the failed sprint + a "view full verdict"
  link that scrolls/expands the sprint.
- *Why*: when a run halts the operator needs to know *why* without two clicks.
- Files: `RunDetail.tsx`, possibly `lib/format.ts` for a `verdictExcerpt()`
  helper.
- Effort: ~1 hour.

**4. Fix the target repo + branch concatenation bug**
- Add a separator/space + `font-mono` on branch.
- *Why*: it's broken right now and obscures the branch.
- Files: `RunDetail.tsx` header section.
- Effort: 5 minutes.

**5. Auto-collapse plan.md once sprints exist**
- In `SprintView`, render plan.md as a collapsed `<details>` accordion (default
  closed) instead of a full grid cell. Reclaim the right column for transcript
  + cost.
- *Why*: plan is reference; sprint progress is the work.
- Files: `RunDetail.tsx` (`SprintView` layout).
- Effort: 30 minutes.

### P1 — high impact, medium effort

**6. Sprint timeline → horizontal progress bar + click-to-focus**
- Horizontal pip-strip at top of SprintView showing all sprints with phase
  color + click-to-focus the detail pane below.
- Below the strip: only the currently focused sprint's contract/output/verdict
  expanded, plus the next-up sprint's contract preview if it exists.
- *Why*: vertical list is hard to scan; the dominant question is "where are we"
  not "list all 5".
- Files: `SprintTimeline.tsx` (rewrite the top portion), add
  `SprintPipStrip.tsx`.
- Effort: 2-3 hours.

**7. Multi-run dashboard for the no-selection state**
- Replace the bare "Select a run" message with a tile grid of live runs:
  task summary, status, current activity (from transcript), sprint progress,
  cost. Tiles auto-update via SSE.
- *Why*: side-monitor use case. Right now selecting one run hides the others.
- Files: `RunOverview.tsx` (full rewrite).
- Effort: 3-4 hours.

**8. "Activity log" — timeline of state transitions**
- Persist + render a chronological list: planner started 14:02:11, planner
  finished 14:04:33, sprint 1 contract written 14:04:35, executor started …
  Each row clickable to open relevant artifact.
- *Why*: answers "how long did each phase take" and "what happened while I was
  away." Today this info is implicit in file mtimes.
- Files: requires a small server addition (`/api/runs/:id/timeline` derived from
  filesystem mtimes), plus `ActivityLog.tsx`. Could ship FE-only by deriving
  from existing readers.
- Effort: 2-3 hours.

**9. Revise Plan: textarea + diff preview**
- Replace single-line input with a `<textarea>` (`Cmd+Enter` submits — already
  the implied affordance in label, just isn't wired up to a multi-line input).
- After the planner replies, show plan.md diff (added/removed/modified
  sections) instead of just swapping the markdown.
- *Why*: plan revision is the highest-leverage operator action. Right now it's
  the least-polished input on the page.
- Files: `RunDetail.tsx` (revise input), `PlanEditor.tsx` (diff view), add
  `lib/markdown-diff.ts` (or use a tiny dep).
- Effort: 3-4 hours.

### P2 — quality of life, smaller individual impact

**10. Per-sprint cost + duration**
- Each sprint timeline row shows `$0.12 · 47s` next to its phase badge,
  derived from the matching log file's cost entries.
- *Why*: helps spot expensive/slow sprints. Today you have to read the cost
  table and mentally join log → sprint.
- Files: `SprintTimeline.tsx`, `CostPanel.tsx` (move some logic to a shared
  helper).
- Effort: 1-2 hours.

**11. Cross-link plan.md sprint headings ↔ timeline**
- When rendered, "## Sprint N — slug" headings in plan.md become anchors that
  scroll/focus the matching sprint in the timeline pane (and vice versa).
- *Why*: planning and progress should feel like one model, not two parallel
  blobs.
- Files: `Markdown.tsx` (extract heading anchors), `RunDetail.tsx` (focus
  state), `SprintTimeline.tsx`.
- Effort: 2 hours.

**12. Transcript stream improvements**
- Header on transcript indicates "sprint 3, executor, retry 0/3" instead of
  raw log filename.
- Collapsible tool calls (tool_use + tool_result pair into one expandable
  entry).
- Subtle "live" indicator dot when SSE is appending.
- *Why*: the transcript is dense. Today every tool call + result is two big
  rows.
- Files: `TranscriptStream.tsx`.
- Effort: 2-3 hours.

**13. Compact cost panel by default**
- One-line cost summary: `$2.14 · 4 sessions · 6m 22s` with a "details ▾"
  toggle for the full table. Expanded only when you ask.
- *Why*: reclaim space; full breakdown is rarely the question.
- Files: `CostPanel.tsx`.
- Effort: 30 minutes.

**14. Keyboard navigation**
- `j`/`k` to move between runs in the sidebar, `enter` to focus, `p` for plan
  view, `c` for cost, `t` for transcript.
- *Why*: side-monitor / monitoring workflow benefits from never reaching for
  mouse.
- Files: new `lib/useKeyboardShortcuts.ts`, `App.tsx`, `RunList.tsx`.
- Effort: 2 hours.

**15. Header doesn't waste a line on run metadata**
- Combine `run_id 2026-... · sprint 3/5 · next executor · retry 0/3 · cost $0`
  into structured pills or a single right-aligned monospace line that wraps to
  title attribute on hover.
- *Why*: the metadata bar is read maybe twice a session; it takes a full row
  always.
- Files: `RunDetail.tsx`.
- Effort: 30 minutes.

## Execution plan

I'll work P0 first (items 1–5), then re-screenshot to confirm impact before
moving to P1. P2 items get folded in opportunistically when I'm already
touching the relevant files.

Iteration cadence: ship each P0 item, rebuild web bundle, reload UI in
playwright, confirm visually, move on. No batch commits — one improvement per
verification cycle so regressions are easy to bisect.
