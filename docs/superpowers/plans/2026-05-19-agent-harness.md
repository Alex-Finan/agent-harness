# Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone local-CLI harness that orchestrates three Claude Agent SDK sessions (Planner → Executor → Evaluator) over file-based handoffs, following Anthropic's long-running-agent harness pattern.

**Architecture:** TypeScript CLI. Each role is a separate `@anthropic-ai/claude-agent-sdk` session invoked with a different system prompt and tool allowlist. Run state lives in `~/.agent-harness/runs/<run_id>/` as files (plan.md, sprints/NN/{contract,output,verdict}.md, state.json). The CLI exits between roles; `harness next` advances the state machine.

**Tech Stack:** TypeScript 5.x, Node 20, `@anthropic-ai/claude-agent-sdk`, `commander` (CLI), `zod` (config/state validation), Jest (tests).

**Spec:** [`../specs/2026-05-19-agent-harness-design.md`](../specs/2026-05-19-agent-harness-design.md)

---

## File map

Files this plan creates (all under `/Users/alexfinan/Developer/agent-harness/`):

| Path | Responsibility |
|---|---|
| `package.json` | Deps, scripts, bin entry |
| `tsconfig.json` | Strict TS, NodeNext modules |
| `jest.config.js` | Jest with ts-jest |
| `.gitignore` | node_modules, dist, .env |
| `bin/harness` | CLI shebang stub |
| `src/cli/index.ts` | Commander root, dispatches subcommands |
| `src/cli/commands/init.ts` | `harness init` |
| `src/cli/commands/plan.ts` | `harness plan` |
| `src/cli/commands/next.ts` | `harness next` |
| `src/cli/commands/status.ts` | `harness status` |
| `src/cli/commands/logs.ts` | `harness logs` |
| `src/cli/commands/list.ts` | `harness list` |
| `src/cli/commands/retry.ts` | `harness retry` |
| `src/cli/commands/abort.ts` | `harness abort` |
| `src/state/paths.ts` | Resolve `~/.agent-harness/`, run dirs, sprint dirs |
| `src/state/run.ts` | Run model: read/write state.json, list sprints |
| `src/state/transitions.ts` | Pure: compute next_role from current state + verdict |
| `src/state/artifacts.ts` | Parse plan.md sprints, verdict.md verdict, contract.md scope |
| `src/state/schema.ts` | Zod schemas for state.json |
| `src/sdk/session.ts` | Thin wrapper over SDK `query()` — runs one role session to completion |
| `src/roles/planner.ts` | Build planner SDK config and invoke `runSession` |
| `src/roles/executor.ts` | Build executor SDK config (forward + retry variants) |
| `src/roles/evaluator.ts` | Build evaluator SDK config |
| `src/prompts/planner.md` | Planner system prompt |
| `src/prompts/executor.md` | Executor system prompt |
| `src/prompts/evaluator.md` | Evaluator system prompt |
| `src/lib/logger.ts` | Tiny structured logger (file + stdout) |
| `src/lib/fs.ts` | Atomic write helper (tmp + rename), read-or-null |
| `tests/state/paths.test.ts` | |
| `tests/state/transitions.test.ts` | |
| `tests/state/artifacts.test.ts` | |
| `tests/state/run.test.ts` | |
| `tests/sdk/session.test.ts` | (mocked SDK) |
| `tests/cli/init.test.ts` | |
| `tests/cli/next.test.ts` | (mocked roles) |
| `tests/fixtures/dummy-repo/` | Tiny target repo for smoke tests |
| `README.md` | Quickstart + CLI reference |

---

## Task 1: Repo bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `jest.config.js`
- Create: `.gitignore`
- Create: `bin/harness`
- Create: `src/index.ts`

- [ ] **Step 1: Write `package.json`**

Create `/Users/alexfinan/Developer/agent-harness/package.json`:

```json
{
  "name": "agent-harness",
  "version": "0.1.0",
  "private": true,
  "description": "Local CLI harness for long-running Claude Agent SDK sessions (Planner -> Executor -> Evaluator).",
  "type": "module",
  "bin": {
    "harness": "./bin/harness"
  },
  "main": "dist/src/index.js",
  "scripts": {
    "build": "rm -rf dist && tsc -p tsconfig.json && cp -r src/prompts dist/src/prompts",
    "dev": "tsc --watch",
    "test": "jest --passWithNoTests",
    "lint": "tsc -p tsconfig.json --noEmit",
    "start": "node ./bin/harness"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.63",
    "commander": "^12.1.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/node": "^20.17.30",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "typescript": "^5.8.3"
  },
  "engines": {
    "node": ">=20.19.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Write `jest.config.js`**

```js
/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: { module: 'NodeNext' } }]
  }
};
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules
dist
*.tsbuildinfo
.env
.DS_Store
coverage
```

- [ ] **Step 5: Write `bin/harness` stub**

```js
#!/usr/bin/env node
import('../dist/src/cli/index.js').then(m => m.main(process.argv));
```

Then `chmod +x bin/harness`.

- [ ] **Step 6: Write `src/index.ts` placeholder**

```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 7: Install deps and verify build**

Run:
```bash
cd /Users/alexfinan/Developer/agent-harness
npm install
npm run build
```
Expected: `npm install` completes, `dist/src/index.js` exists.

- [ ] **Step 8: Commit**

```bash
cd /Users/alexfinan/Developer/agent-harness
git add package.json package-lock.json tsconfig.json jest.config.js .gitignore bin/ src/
git commit -m "feat: repo bootstrap (package.json, tsconfig, jest, bin stub)"
```

---

## Task 2: Path resolution (`src/state/paths.ts`)

**Files:**
- Create: `src/state/paths.ts`
- Create: `tests/state/paths.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/state/paths.test.ts`:

```ts
import * as path from 'node:path';
import * as os from 'node:os';
import { harnessHome, runDir, sprintDir, sprintArtifactPath } from '../../src/state/paths.js';

describe('paths', () => {
  test('harnessHome defaults to ~/.agent-harness', () => {
    expect(harnessHome()).toBe(path.join(os.homedir(), '.agent-harness'));
  });

  test('harnessHome honors AGENT_HARNESS_HOME env override', () => {
    const prev = process.env.AGENT_HARNESS_HOME;
    process.env.AGENT_HARNESS_HOME = '/tmp/foo';
    expect(harnessHome()).toBe('/tmp/foo');
    if (prev === undefined) delete process.env.AGENT_HARNESS_HOME;
    else process.env.AGENT_HARNESS_HOME = prev;
  });

  test('runDir composes correctly', () => {
    process.env.AGENT_HARNESS_HOME = '/tmp/h';
    expect(runDir('run-abc')).toBe('/tmp/h/runs/run-abc');
    delete process.env.AGENT_HARNESS_HOME;
  });

  test('sprintDir uses 2-digit zero-padded numbers', () => {
    process.env.AGENT_HARNESS_HOME = '/tmp/h';
    expect(sprintDir('run-abc', 3, 'add-graph-features'))
      .toBe('/tmp/h/runs/run-abc/sprints/03-add-graph-features');
    delete process.env.AGENT_HARNESS_HOME;
  });

  test('sprintArtifactPath builds expected file paths', () => {
    process.env.AGENT_HARNESS_HOME = '/tmp/h';
    expect(sprintArtifactPath('run-abc', 1, 'init', 'contract.md'))
      .toBe('/tmp/h/runs/run-abc/sprints/01-init/contract.md');
    delete process.env.AGENT_HARNESS_HOME;
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
npm test -- tests/state/paths.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/state/paths.ts`**

```ts
import * as path from 'node:path';
import * as os from 'node:os';

export function harnessHome(): string {
  return process.env.AGENT_HARNESS_HOME ?? path.join(os.homedir(), '.agent-harness');
}

export function runsRoot(): string {
  return path.join(harnessHome(), 'runs');
}

export function runDir(runId: string): string {
  return path.join(runsRoot(), runId);
}

export function statePath(runId: string): string {
  return path.join(runDir(runId), 'state.json');
}

export function taskPath(runId: string): string {
  return path.join(runDir(runId), 'task.md');
}

export function planPath(runId: string): string {
  return path.join(runDir(runId), 'plan.md');
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function sprintsDir(runId: string): string {
  return path.join(runDir(runId), 'sprints');
}

export function sprintDir(runId: string, sprintNum: number, slug: string): string {
  return path.join(sprintsDir(runId), `${pad2(sprintNum)}-${slug}`);
}

export function sprintArtifactPath(
  runId: string,
  sprintNum: number,
  slug: string,
  filename: string
): string {
  return path.join(sprintDir(runId, sprintNum, slug), filename);
}

export function logsDir(runId: string): string {
  return path.join(runDir(runId), 'logs');
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/state/paths.test.ts
```
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/state/paths.ts tests/state/paths.test.ts
git commit -m "feat(state): path resolution for run/sprint artifacts"
```

---

## Task 3: Atomic file helpers (`src/lib/fs.ts`)

**Files:**
- Create: `src/lib/fs.ts`
- Create: `tests/lib/fs.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lib/fs.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeAtomic, readOrNull, ensureDir } from '../../src/lib/fs.js';

describe('lib/fs', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-test-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('writeAtomic creates parent dirs and writes file', async () => {
    const target = path.join(tmp, 'nested/dir/file.txt');
    await writeAtomic(target, 'hello');
    const content = await fs.readFile(target, 'utf8');
    expect(content).toBe('hello');
  });

  test('writeAtomic overwrites existing file', async () => {
    const target = path.join(tmp, 'file.txt');
    await writeAtomic(target, 'first');
    await writeAtomic(target, 'second');
    expect(await fs.readFile(target, 'utf8')).toBe('second');
  });

  test('readOrNull returns null for missing file', async () => {
    expect(await readOrNull(path.join(tmp, 'nope'))).toBeNull();
  });

  test('readOrNull returns contents when file exists', async () => {
    const target = path.join(tmp, 'a.txt');
    await fs.writeFile(target, 'hi');
    expect(await readOrNull(target)).toBe('hi');
  });

  test('ensureDir is idempotent', async () => {
    const d = path.join(tmp, 'a/b/c');
    await ensureDir(d);
    await ensureDir(d);
    const stat = await fs.stat(d);
    expect(stat.isDirectory()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/lib/fs.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/fs.ts`**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeAtomic(target: string, content: string): Promise<void> {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, target);
}

export async function readOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/lib/fs.test.ts
```
Expected: PASS, all 5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fs.ts tests/lib/fs.test.ts
git commit -m "feat(lib): atomic write + readOrNull helpers"
```

---

## Task 4: State schema (`src/state/schema.ts`)

**Files:**
- Create: `src/state/schema.ts`
- Create: `tests/state/schema.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/state/schema.test.ts`:

```ts
import { StateSchema, RoleEnum, StatusEnum } from '../../src/state/schema.js';

describe('state schema', () => {
  test('accepts a valid state record', () => {
    const parsed = StateSchema.parse({
      run_id: '2026-05-19-093712-ace1f3',
      target_repo: '/Users/alex/repo',
      task_summary: 'add graph features',
      current_sprint: 0,
      total_sprints: 0,
      next_role: 'planner',
      retry_count: 0,
      max_retries: 3,
      status: 'in_progress',
      created_at: '2026-05-19T09:37:12.000Z',
      updated_at: '2026-05-19T09:37:12.000Z'
    });
    expect(parsed.next_role).toBe('planner');
  });

  test('rejects unknown role', () => {
    expect(() => RoleEnum.parse('hacker')).toThrow();
  });

  test('rejects unknown status', () => {
    expect(() => StatusEnum.parse('frozen')).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/state/schema.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/state/schema.ts`**

```ts
import { z } from 'zod';

export const RoleEnum = z.enum(['planner', 'executor', 'evaluator', 'done']);
export type Role = z.infer<typeof RoleEnum>;

export const StatusEnum = z.enum(['in_progress', 'halted', 'completed', 'aborted']);
export type Status = z.infer<typeof StatusEnum>;

export const StateSchema = z.object({
  run_id: z.string(),
  target_repo: z.string(),
  task_summary: z.string(),
  current_sprint: z.number().int().nonnegative(),
  total_sprints: z.number().int().nonnegative(),
  next_role: RoleEnum,
  retry_count: z.number().int().nonnegative(),
  max_retries: z.number().int().positive(),
  status: StatusEnum,
  created_at: z.string(),
  updated_at: z.string(),
  last_verdict: z.enum(['PASS', 'FAIL']).optional()
});

export type State = z.infer<typeof StateSchema>;
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/state/schema.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/schema.ts tests/state/schema.test.ts
git commit -m "feat(state): zod schema for run state"
```

---

## Task 5: State transitions (`src/state/transitions.ts`)

**Files:**
- Create: `src/state/transitions.ts`
- Create: `tests/state/transitions.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/state/transitions.test.ts`:

```ts
import { advance } from '../../src/state/transitions.js';
import type { State } from '../../src/state/schema.js';

const base: State = {
  run_id: 'r',
  target_repo: '/x',
  task_summary: 't',
  current_sprint: 1,
  total_sprints: 3,
  next_role: 'planner',
  retry_count: 0,
  max_retries: 3,
  status: 'in_progress',
  created_at: 'now',
  updated_at: 'now'
};

describe('advance', () => {
  test('after planner -> executor on sprint 1', () => {
    const next = advance({ ...base, next_role: 'planner', current_sprint: 0 }, { totalSprints: 3 });
    expect(next.next_role).toBe('executor');
    expect(next.current_sprint).toBe(1);
    expect(next.total_sprints).toBe(3);
  });

  test('after executor -> evaluator (same sprint)', () => {
    const next = advance({ ...base, next_role: 'executor' });
    expect(next.next_role).toBe('evaluator');
    expect(next.current_sprint).toBe(1);
  });

  test('after evaluator PASS -> executor on next sprint', () => {
    const next = advance({ ...base, next_role: 'evaluator' }, { verdict: 'PASS' });
    expect(next.next_role).toBe('executor');
    expect(next.current_sprint).toBe(2);
    expect(next.retry_count).toBe(0);
    expect(next.last_verdict).toBe('PASS');
  });

  test('after evaluator FAIL under cap -> executor same sprint, retry++', () => {
    const next = advance({ ...base, next_role: 'evaluator', retry_count: 0 }, { verdict: 'FAIL' });
    expect(next.next_role).toBe('executor');
    expect(next.current_sprint).toBe(1);
    expect(next.retry_count).toBe(1);
    expect(next.status).toBe('in_progress');
  });

  test('after evaluator FAIL at cap -> halted', () => {
    const next = advance(
      { ...base, next_role: 'evaluator', retry_count: 3, max_retries: 3 },
      { verdict: 'FAIL' }
    );
    expect(next.status).toBe('halted');
    expect(next.next_role).toBe('evaluator'); // unchanged on halt
  });

  test('after evaluator PASS on last sprint -> done + completed', () => {
    const next = advance(
      { ...base, next_role: 'evaluator', current_sprint: 3, total_sprints: 3 },
      { verdict: 'PASS' }
    );
    expect(next.next_role).toBe('done');
    expect(next.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/state/transitions.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/state/transitions.ts`**

```ts
import type { State } from './schema.js';

export interface AdvanceContext {
  verdict?: 'PASS' | 'FAIL';
  totalSprints?: number;
}

export function advance(state: State, ctx: AdvanceContext = {}): State {
  const now = new Date().toISOString();
  const base: State = { ...state, updated_at: now };

  if (state.next_role === 'planner') {
    return {
      ...base,
      next_role: 'executor',
      current_sprint: 1,
      total_sprints: ctx.totalSprints ?? state.total_sprints,
      retry_count: 0
    };
  }

  if (state.next_role === 'executor') {
    return { ...base, next_role: 'evaluator' };
  }

  if (state.next_role === 'evaluator') {
    if (ctx.verdict === 'PASS') {
      if (state.current_sprint >= state.total_sprints) {
        return {
          ...base,
          next_role: 'done',
          status: 'completed',
          last_verdict: 'PASS'
        };
      }
      return {
        ...base,
        next_role: 'executor',
        current_sprint: state.current_sprint + 1,
        retry_count: 0,
        last_verdict: 'PASS'
      };
    }
    if (ctx.verdict === 'FAIL') {
      const next = state.retry_count + 1;
      if (next > state.max_retries) {
        return { ...base, status: 'halted', last_verdict: 'FAIL' };
      }
      return {
        ...base,
        next_role: 'executor',
        retry_count: next,
        last_verdict: 'FAIL'
      };
    }
    throw new Error('evaluator transition requires verdict in ctx');
  }

  // 'done' is terminal
  return base;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/state/transitions.test.ts
```
Expected: PASS, all 6.

- [ ] **Step 5: Commit**

```bash
git add src/state/transitions.ts tests/state/transitions.test.ts
git commit -m "feat(state): pure transition function"
```

---

## Task 6: Run model (`src/state/run.ts`)

**Files:**
- Create: `src/state/run.ts`
- Create: `tests/state/run.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/state/run.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRun, loadRun, saveState, generateRunId } from '../../src/state/run.js';

describe('run model', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-run-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });
  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('generateRunId returns timestamp-prefixed unique id', () => {
    const a = generateRunId();
    const b = generateRunId();
    expect(a).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{6}$/);
    expect(a).not.toBe(b);
  });

  test('createRun writes task.md and initial state.json', async () => {
    const run = await createRun({
      targetRepo: '/some/repo',
      task: 'do the thing',
      maxRetries: 3
    });
    expect(run.state.next_role).toBe('planner');
    expect(run.state.current_sprint).toBe(0);
    expect(run.state.total_sprints).toBe(0);

    const taskMd = await fs.readFile(path.join(tmp, 'runs', run.state.run_id, 'task.md'), 'utf8');
    expect(taskMd).toContain('do the thing');
    expect(taskMd).toContain('/some/repo');
  });

  test('loadRun round-trips state', async () => {
    const created = await createRun({ targetRepo: '/r', task: 't', maxRetries: 3 });
    const loaded = await loadRun(created.state.run_id);
    expect(loaded.state).toEqual(created.state);
  });

  test('saveState writes new state to disk', async () => {
    const run = await createRun({ targetRepo: '/r', task: 't', maxRetries: 3 });
    const updated = { ...run.state, next_role: 'executor' as const };
    await saveState(updated);
    const reloaded = await loadRun(run.state.run_id);
    expect(reloaded.state.next_role).toBe('executor');
  });

  test('loadRun on missing run throws', async () => {
    await expect(loadRun('nonexistent')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/state/run.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/state/run.ts`**

```ts
import * as crypto from 'node:crypto';
import { StateSchema, type State } from './schema.js';
import { runDir, statePath, taskPath, sprintsDir, logsDir } from './paths.js';
import { writeAtomic, readOrNull, ensureDir } from '../lib/fs.js';

export interface Run {
  state: State;
}

export function generateRunId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  const timePart =
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${datePart}-${timePart}-${suffix}`;
}

export interface CreateRunInput {
  targetRepo: string;
  task: string;
  maxRetries: number;
}

export async function createRun(input: CreateRunInput): Promise<Run> {
  const runId = generateRunId();
  const now = new Date().toISOString();

  const state: State = {
    run_id: runId,
    target_repo: input.targetRepo,
    task_summary: input.task.split('\n')[0].slice(0, 120),
    current_sprint: 0,
    total_sprints: 0,
    next_role: 'planner',
    retry_count: 0,
    max_retries: input.maxRetries,
    status: 'in_progress',
    created_at: now,
    updated_at: now
  };

  await ensureDir(runDir(runId));
  await ensureDir(sprintsDir(runId));
  await ensureDir(logsDir(runId));

  const taskBody = [
    `# Task`,
    ``,
    `**Target repo:** ${input.targetRepo}`,
    `**Created:** ${now}`,
    `**Run ID:** ${runId}`,
    ``,
    `## Prompt`,
    ``,
    input.task
  ].join('\n');

  await writeAtomic(taskPath(runId), taskBody);
  await writeAtomic(statePath(runId), JSON.stringify(state, null, 2) + '\n');

  return { state };
}

export async function loadRun(runId: string): Promise<Run> {
  const raw = await readOrNull(statePath(runId));
  if (raw === null) {
    throw new Error(`Run not found: ${runId}`);
  }
  const parsed = StateSchema.parse(JSON.parse(raw));
  return { state: parsed };
}

export async function saveState(state: State): Promise<void> {
  StateSchema.parse(state);
  await writeAtomic(statePath(state.run_id), JSON.stringify(state, null, 2) + '\n');
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/state/run.test.ts
```
Expected: PASS, all 5.

- [ ] **Step 5: Commit**

```bash
git add src/state/run.ts tests/state/run.test.ts
git commit -m "feat(state): Run model — createRun, loadRun, saveState"
```

---

## Task 7: Artifact parsing (`src/state/artifacts.ts`)

The planner writes `plan.md` containing sprint sections. Each sprint has a contract.md with a rubric. The evaluator writes verdict.md starting with `PASS` or `FAIL`. This task adds parsers for those three artifacts.

**Files:**
- Create: `src/state/artifacts.ts`
- Create: `tests/state/artifacts.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/state/artifacts.test.ts`:

```ts
import { parseVerdict, parseSprintsFromPlan } from '../../src/state/artifacts.js';

describe('parseVerdict', () => {
  test('extracts PASS from header', () => {
    const md = '# Sprint 01 — Verdict: PASS\n\n## Rubric scoring\n...';
    expect(parseVerdict(md)).toBe('PASS');
  });

  test('extracts FAIL from header', () => {
    const md = '# Sprint 02 — Verdict: FAIL\n\nFix things';
    expect(parseVerdict(md)).toBe('FAIL');
  });

  test('case-insensitive', () => {
    expect(parseVerdict('# Verdict: pass')).toBe('PASS');
  });

  test('returns null when missing', () => {
    expect(parseVerdict('# random doc')).toBeNull();
  });
});

describe('parseSprintsFromPlan', () => {
  test('extracts sprint headers and slugs', () => {
    const plan = `
# Plan

## Sprint 1: Add silver job
something

## Sprint 2: Add gold job
more

## Notes
not a sprint
`;
    const sprints = parseSprintsFromPlan(plan);
    expect(sprints).toEqual([
      { num: 1, slug: 'add-silver-job', title: 'Add silver job' },
      { num: 2, slug: 'add-gold-job', title: 'Add gold job' }
    ]);
  });

  test('returns empty array when no sprints', () => {
    expect(parseSprintsFromPlan('# Plan\nno sprints')).toEqual([]);
  });

  test('slugifies titles with punctuation', () => {
    const plan = '## Sprint 1: Build the silver/payout_graph_edges job!';
    const sprints = parseSprintsFromPlan(plan);
    expect(sprints[0].slug).toBe('build-the-silver-payout-graph-edges-job');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/state/artifacts.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/state/artifacts.ts`**

```ts
export type Verdict = 'PASS' | 'FAIL';

export interface SprintHeader {
  num: number;
  slug: string;
  title: string;
}

const VERDICT_RE = /verdict\s*:\s*(pass|fail)/i;

export function parseVerdict(md: string): Verdict | null {
  const m = md.match(VERDICT_RE);
  if (!m) return null;
  return m[1].toUpperCase() as Verdict;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SPRINT_HEADER_RE = /^##\s+sprint\s+(\d+)\s*[:\-—]\s*(.+?)\s*$/i;

export function parseSprintsFromPlan(planMd: string): SprintHeader[] {
  const sprints: SprintHeader[] = [];
  for (const line of planMd.split('\n')) {
    const m = line.match(SPRINT_HEADER_RE);
    if (m) {
      const num = parseInt(m[1], 10);
      const title = m[2].trim();
      sprints.push({ num, slug: slugify(title), title });
    }
  }
  return sprints;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/state/artifacts.test.ts
```
Expected: PASS, all 7.

- [ ] **Step 5: Commit**

```bash
git add src/state/artifacts.ts tests/state/artifacts.test.ts
git commit -m "feat(state): parsers for verdict + plan sprint headers"
```

---

## Task 8: Logger (`src/lib/logger.ts`)

A tiny structured logger. Writes JSON lines to a per-run log file and human lines to stdout.

**Files:**
- Create: `src/lib/logger.ts`
- Create: `tests/lib/logger.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lib/logger.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createLogger } from '../../src/lib/logger.js';

describe('logger', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-log-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('writes JSON lines to file', async () => {
    const logFile = path.join(tmp, 'h.log');
    const log = createLogger({ file: logFile, stdout: false });
    await log.info('hello', { a: 1 });
    await log.flush();
    const content = await fs.readFile(logFile, 'utf8');
    const line = JSON.parse(content.trim());
    expect(line.level).toBe('info');
    expect(line.msg).toBe('hello');
    expect(line.a).toBe(1);
    expect(typeof line.ts).toBe('string');
  });

  test('appends multiple lines', async () => {
    const logFile = path.join(tmp, 'h.log');
    const log = createLogger({ file: logFile, stdout: false });
    await log.info('a');
    await log.error('b');
    await log.flush();
    const lines = (await fs.readFile(logFile, 'utf8')).trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).msg).toBe('a');
    expect(JSON.parse(lines[1]).level).toBe('error');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/lib/logger.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/logger.ts`**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureDir } from './fs.js';

export interface LoggerOptions {
  file?: string;
  stdout?: boolean;
}

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): Promise<void>;
  error(msg: string, extra?: Record<string, unknown>): Promise<void>;
  debug(msg: string, extra?: Record<string, unknown>): Promise<void>;
  flush(): Promise<void>;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const useStdout = opts.stdout !== false;
  const file = opts.file;
  let writes: Promise<void> = Promise.resolve();

  async function emit(level: string, msg: string, extra?: Record<string, unknown>) {
    const record = { ts: new Date().toISOString(), level, msg, ...(extra ?? {}) };
    const line = JSON.stringify(record) + '\n';
    if (useStdout) {
      const human = `[${record.ts}] ${level.toUpperCase()} ${msg}`;
      process.stdout.write(human + '\n');
    }
    if (file) {
      writes = writes.then(async () => {
        await ensureDir(path.dirname(file));
        await fs.appendFile(file, line, 'utf8');
      });
      await writes;
    }
  }

  return {
    info: (m, e) => emit('info', m, e),
    error: (m, e) => emit('error', m, e),
    debug: (m, e) => emit('debug', m, e),
    flush: () => writes
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/lib/logger.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logger.ts tests/lib/logger.test.ts
git commit -m "feat(lib): structured JSON logger"
```

---

## Task 9: Prompt templates

Three system prompts as `.md` files. These are loaded at runtime.

**Files:**
- Create: `src/prompts/planner.md`
- Create: `src/prompts/executor.md`
- Create: `src/prompts/evaluator.md`

- [ ] **Step 1: Write `src/prompts/planner.md`**

```markdown
You are the PLANNER role in a three-agent harness (Planner -> Executor -> Evaluator).

Your job: read the user's task from `task.md`, explore the target repository read-only, and produce two things:

1. `plan.md` at the run root, containing:
   - **Goal** — one sentence
   - **Approach** — 2-4 paragraphs covering architecture and key decisions
   - **Sprints** — a sequence of `## Sprint N: <title>` sections, each with a 2-4 sentence scope description. Each sprint should be small enough for a single executor session (target: < 30 minutes of work).

2. For each sprint, a `sprints/NN-<slug>/contract.md` file containing:
   - **Scope** — what this sprint changes
   - **Inputs** — files/paths/data the executor needs
   - **Deliverables** — files created/modified, commands run
   - **Rubric** — 3-7 criteria the evaluator will grade against. Be specific and verifiable.
   - **Verification commands** — exact shell commands the evaluator will run, with the expected success signal for each (e.g., "exit code 0", "output contains 'PASSED'").

CRITICAL RULES:
- You are READ-ONLY against the target repository. Never edit, create, or run mutating commands.
- The rubric and verification commands you write are the ONLY bar the executor must clear. The executor cannot move the goalposts later. Make them specific and testable.
- Never write a rubric criterion that says "the code is clean" or similar non-verifiable phrases.
- If verification requires running tests, name the exact command (e.g., `pytest tests/foo/`, `pnpm test packages/x`).
- The sprint slug must be lowercase, hyphenated, derived from the title.
- Do not include implementation code in the plan. The executor will write it. You describe what, the executor decides how.

When you are done, your last action should be writing the final sprints/NN-*/contract.md file. Do not produce a chat summary.
```

- [ ] **Step 2: Write `src/prompts/executor.md`**

```markdown
You are the EXECUTOR role in a three-agent harness (Planner -> Executor -> Evaluator).

Your job: implement one sprint at a time.

Inputs you must read first:
1. `plan.md` at the run root — overall context.
2. `sprints/NN-<slug>/contract.md` — your scope, deliverables, rubric, and verification commands.
3. If a `sprints/NN-<slug>/verdict.md` already exists with `Verdict: FAIL`, this is a retry — read its "Fix-it-back notes" section and address each item.

Your output:
- All code changes go in the TARGET REPOSITORY (your `cwd` is set to it).
- A summary file at `sprints/NN-<slug>/output.md` covering:
  - **Changes made** — files modified, with one-line descriptions
  - **How to verify** — restate the verification commands and what to look for
  - **Notes for evaluator** — anything non-obvious (e.g., "test X is intentionally skipped because Y")

CRITICAL RULES:
- Do exactly what the contract says, no more, no less. Do not expand scope.
- Do not modify the contract.md or rubric.
- If you believe the contract is wrong, STOP and write `output.md` explaining the problem instead of trying to fix it yourself.
- Run the verification commands yourself before declaring done. If they fail, fix the code and re-run.
- Commit early and often within the target repo's git history if it is a git repo.
- Your `cwd` is the target repository. Do not write files outside it except for output.md (which is in the run dir, given to you as an absolute path).
```

- [ ] **Step 3: Write `src/prompts/evaluator.md`**

```markdown
You are the EVALUATOR role in a three-agent harness (Planner -> Executor -> Evaluator).

Your job is ADVERSARIAL QA. You are not a collaborator. You are looking for ways the work fails the rubric. Default to FAIL when evidence is missing or weak.

Inputs:
1. `plan.md` — overall context.
2. `sprints/NN-<slug>/contract.md` — the rubric and verification commands you must enforce.
3. `sprints/NN-<slug>/output.md` — the executor's self-report. TREAT IT AS A CLAIM, NOT A FACT.

Your process:
1. Run EVERY verification command in the contract. Record exit code and relevant output.
2. Inspect the target repo to confirm the changes in `output.md` actually exist (read files, check git diff if applicable).
3. Score each rubric criterion: PASS (with cited evidence) or FAIL (with what's missing).
4. Produce `sprints/NN-<slug>/verdict.md` with this exact format:

```
# Sprint NN — Verdict: PASS | FAIL

## Rubric scoring
1. <criterion 1 text> — PASS | FAIL — <evidence>
2. <criterion 2 text> — PASS | FAIL — <evidence>
...

## Verification command results
- `<cmd 1>` — exit <N>, <output snippet or "matched expected">
- `<cmd 2>` — exit <N>, <output snippet or "matched expected">

## Fix-it-back notes
<only on FAIL — specific, actionable items the executor must address next attempt>
```

CRITICAL RULES:
- The verdict is PASS only if EVERY rubric criterion is PASS AND every verification command produced the expected outcome.
- If `output.md` lacks information you need to verify a criterion, that criterion is FAIL with the note "executor did not provide evidence".
- You may NOT edit any code in the target repo. Read-only on the target. You may run any shell command that does not mutate the target repo.
- Be specific. "Tests fail" is not enough — quote the failing test name and the relevant assertion error.
- Do not give the executor the benefit of the doubt.
```

- [ ] **Step 4: Verify files exist**

```bash
ls -la src/prompts/
```
Expected: planner.md, executor.md, evaluator.md present.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/
git commit -m "feat(prompts): planner, executor, evaluator system prompts"
```

---

## Task 10: SDK session wrapper (`src/sdk/session.ts`)

Thin wrapper around `@anthropic-ai/claude-agent-sdk`'s `query()`. Streams messages, captures final result text, persists the transcript.

**Files:**
- Create: `src/sdk/session.ts`
- Create: `tests/sdk/session.test.ts`

- [ ] **Step 1: Write failing test (with mocked SDK)**

Create `tests/sdk/session.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock the SDK before importing the wrapper.
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn()
}));
import { query } from '@anthropic-ai/claude-agent-sdk';
import { runSession } from '../../src/sdk/session.js';

const mockedQuery = query as unknown as jest.Mock;

async function* fakeStream(messages: unknown[]): AsyncIterable<unknown> {
  for (const m of messages) yield m;
}

describe('runSession', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-sdk-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    mockedQuery.mockReset();
  });

  test('streams messages, writes transcript, returns final text', async () => {
    mockedQuery.mockReturnValue(
      fakeStream([
        { type: 'assistant', content: [{ type: 'text', text: 'thinking...' }] },
        { type: 'result', subtype: 'success', result: 'done', total_cost_usd: 0.01 }
      ])
    );

    const transcriptPath = path.join(tmp, 'transcript.log');
    const result = await runSession({
      prompt: 'go',
      systemPrompt: 'you are a tester',
      allowedTools: ['Read'],
      cwd: tmp,
      maxTurns: 10,
      maxBudgetUsd: 1,
      transcriptPath
    });

    expect(result.success).toBe(true);
    expect(result.resultText).toBe('done');
    const transcript = await fs.readFile(transcriptPath, 'utf8');
    expect(transcript).toContain('"type":"assistant"');
    expect(transcript).toContain('"type":"result"');
  });

  test('returns success=false when subtype is not success', async () => {
    mockedQuery.mockReturnValue(
      fakeStream([{ type: 'result', subtype: 'error_max_turns' }])
    );

    const result = await runSession({
      prompt: 'go',
      systemPrompt: 's',
      allowedTools: [],
      cwd: tmp,
      maxTurns: 1,
      maxBudgetUsd: 1,
      transcriptPath: path.join(tmp, 'tr.log')
    });

    expect(result.success).toBe(false);
    expect(result.failureSubtype).toBe('error_max_turns');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/sdk/session.test.ts
```
Expected: FAIL — `runSession` not found.

- [ ] **Step 3: Implement `src/sdk/session.ts`**

```ts
import * as path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { writeAtomic, ensureDir } from '../lib/fs.js';
import * as fs from 'node:fs/promises';

export interface RunSessionInput {
  prompt: string;
  systemPrompt: string;
  allowedTools: string[];
  cwd: string;
  maxTurns: number;
  maxBudgetUsd: number;
  transcriptPath: string;
  model?: string;
}

export interface RunSessionResult {
  success: boolean;
  resultText?: string;
  failureSubtype?: string;
  totalCostUsd?: number;
  durationMs: number;
}

function resolveCliPath(): string {
  // Same pattern as the-oracle/research-agent: resolve the SDK's bundled cli.js.
  const sdkMain = require.resolve('@anthropic-ai/claude-agent-sdk');
  return path.join(path.dirname(sdkMain), 'cli.js');
}

export async function runSession(input: RunSessionInput): Promise<RunSessionResult> {
  const start = Date.now();
  await ensureDir(path.dirname(input.transcriptPath));
  // Truncate transcript on each run.
  await writeAtomic(input.transcriptPath, '');

  let result: RunSessionResult = { success: false, durationMs: 0 };

  for await (const message of query({
    prompt: input.prompt,
    options: {
      pathToClaudeCodeExecutable: resolveCliPath(),
      systemPrompt: input.systemPrompt,
      model: input.model ?? 'claude-sonnet-4-6',
      maxTurns: input.maxTurns,
      maxBudgetUsd: input.maxBudgetUsd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      allowedTools: input.allowedTools,
      cwd: input.cwd
    }
  })) {
    await fs.appendFile(input.transcriptPath, JSON.stringify(message) + '\n', 'utf8');

    const m = message as { type: string; subtype?: string; result?: unknown; total_cost_usd?: number };
    if (m.type === 'result') {
      const durationMs = Date.now() - start;
      if (m.subtype === 'success') {
        result = {
          success: true,
          resultText: typeof m.result === 'string' ? m.result : JSON.stringify(m.result),
          totalCostUsd: m.total_cost_usd,
          durationMs
        };
      } else {
        result = {
          success: false,
          failureSubtype: m.subtype,
          totalCostUsd: m.total_cost_usd,
          durationMs
        };
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/sdk/session.test.ts
```
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add src/sdk/session.ts tests/sdk/session.test.ts
git commit -m "feat(sdk): runSession wrapper over Claude Agent SDK query()"
```

---

## Task 11: Role builders (`src/roles/{planner,executor,evaluator}.ts`)

Each role builds the input for `runSession` with the right system prompt, tool allowlist, cwd, and prompt body.

**Files:**
- Create: `src/roles/planner.ts`
- Create: `src/roles/executor.ts`
- Create: `src/roles/evaluator.ts`
- Create: `tests/roles/builders.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/roles/builders.test.ts`:

```ts
import { buildPlannerInput } from '../../src/roles/planner.js';
import { buildExecutorInput } from '../../src/roles/executor.js';
import { buildEvaluatorInput } from '../../src/roles/evaluator.js';

describe('role builders', () => {
  const baseArgs = {
    runId: 'run-1',
    targetRepo: '/target',
    transcriptPath: '/h/t.log',
    runDirAbs: '/h/runs/run-1'
  };

  test('planner uses read-only tool set and run dir as cwd', () => {
    const input = buildPlannerInput({
      ...baseArgs,
      taskMdAbs: '/h/runs/run-1/task.md'
    });
    expect(input.allowedTools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep']));
    expect(input.allowedTools).not.toContain('Edit');
    expect(input.allowedTools).not.toContain('Write');
    // Planner runs in run dir so it can write plan.md and contract.md.
    expect(input.cwd).toBe('/h/runs/run-1');
    expect(input.prompt).toContain('/target');
    expect(input.prompt).toContain('/h/runs/run-1/task.md');
  });

  test('executor uses full tools and target repo as cwd', () => {
    const input = buildExecutorInput({
      ...baseArgs,
      sprintDirAbs: '/h/runs/run-1/sprints/01-foo',
      planMdAbs: '/h/runs/run-1/plan.md',
      retryNotes: null
    });
    expect(input.allowedTools).toEqual(expect.arrayContaining(['Read', 'Edit', 'Write', 'Bash']));
    expect(input.cwd).toBe('/target');
    expect(input.prompt).toContain('/h/runs/run-1/sprints/01-foo/contract.md');
  });

  test('executor retry includes prior verdict notes', () => {
    const input = buildExecutorInput({
      ...baseArgs,
      sprintDirAbs: '/h/runs/run-1/sprints/01-foo',
      planMdAbs: '/h/runs/run-1/plan.md',
      retryNotes: 'fix the foo'
    });
    expect(input.prompt).toContain('fix the foo');
    expect(input.prompt.toLowerCase()).toContain('retry');
  });

  test('evaluator gets read+bash but not write tools', () => {
    const input = buildEvaluatorInput({
      ...baseArgs,
      sprintDirAbs: '/h/runs/run-1/sprints/01-foo',
      planMdAbs: '/h/runs/run-1/plan.md'
    });
    expect(input.allowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Bash']));
    expect(input.allowedTools).not.toContain('Edit');
    expect(input.allowedTools).not.toContain('Write');
    expect(input.cwd).toBe('/target');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/roles/builders.test.ts
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/roles/planner.ts`**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunSessionInput } from '../sdk/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadPrompt(name: string): Promise<string> {
  return fs.readFile(path.join(__dirname, '..', 'prompts', name), 'utf8');
}

export interface PlannerArgs {
  runId: string;
  targetRepo: string;
  transcriptPath: string;
  runDirAbs: string;
  taskMdAbs: string;
}

export async function buildPlannerInput(args: PlannerArgs): Promise<RunSessionInput> {
  const systemPrompt = await loadPrompt('planner.md');
  const prompt = [
    `Run ID: ${args.runId}`,
    `Target repository (READ-ONLY for you): ${args.targetRepo}`,
    `Task description: ${args.taskMdAbs}`,
    ``,
    `Your working directory is the run directory: ${args.runDirAbs}`,
    `Write plan.md and sprints/NN-<slug>/contract.md files here.`,
    ``,
    `Begin by reading the task file, then read whatever you need from the target repo to plan.`
  ].join('\n');

  return {
    prompt,
    systemPrompt,
    allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Bash'],
    cwd: args.runDirAbs,
    maxTurns: 80,
    maxBudgetUsd: 5.0,
    transcriptPath: args.transcriptPath
  };
}
```

Note: planner needs `Write` for plan.md/contract.md and `Bash` for reading the target repo. The prompt enforces read-only against the target; trusted-by-instruction here. (A stricter version using a custom MCP tool to lock down writes outside the run dir is V2.)

- [ ] **Step 4: Implement `src/roles/executor.ts`**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunSessionInput } from '../sdk/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadPrompt(name: string): Promise<string> {
  return fs.readFile(path.join(__dirname, '..', 'prompts', name), 'utf8');
}

export interface ExecutorArgs {
  runId: string;
  targetRepo: string;
  transcriptPath: string;
  runDirAbs: string;
  sprintDirAbs: string;
  planMdAbs: string;
  retryNotes: string | null;
}

export async function buildExecutorInput(args: ExecutorArgs): Promise<RunSessionInput> {
  const systemPrompt = await loadPrompt('executor.md');
  const contractAbs = path.join(args.sprintDirAbs, 'contract.md');
  const outputAbs = path.join(args.sprintDirAbs, 'output.md');

  const lines = [
    `Run ID: ${args.runId}`,
    `Your working directory is the target repository: ${args.targetRepo}`,
    `Plan (read-only reference): ${args.planMdAbs}`,
    `Sprint contract: ${contractAbs}`,
    `Write your output summary to: ${outputAbs}`
  ];
  if (args.retryNotes) {
    lines.push('');
    lines.push('THIS IS A RETRY. The evaluator gave fix-it-back notes:');
    lines.push('---');
    lines.push(args.retryNotes);
    lines.push('---');
    lines.push('Read sprints/.../verdict.md for the full prior verdict. Address every item.');
  }

  return {
    prompt: lines.join('\n'),
    systemPrompt,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'NotebookEdit'],
    cwd: args.targetRepo,
    maxTurns: 120,
    maxBudgetUsd: 10.0,
    transcriptPath: args.transcriptPath
  };
}
```

- [ ] **Step 5: Implement `src/roles/evaluator.ts`**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunSessionInput } from '../sdk/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadPrompt(name: string): Promise<string> {
  return fs.readFile(path.join(__dirname, '..', 'prompts', name), 'utf8');
}

export interface EvaluatorArgs {
  runId: string;
  targetRepo: string;
  transcriptPath: string;
  runDirAbs: string;
  sprintDirAbs: string;
  planMdAbs: string;
}

export async function buildEvaluatorInput(args: EvaluatorArgs): Promise<RunSessionInput> {
  const systemPrompt = await loadPrompt('evaluator.md');
  const contractAbs = path.join(args.sprintDirAbs, 'contract.md');
  const outputAbs = path.join(args.sprintDirAbs, 'output.md');
  const verdictAbs = path.join(args.sprintDirAbs, 'verdict.md');

  const prompt = [
    `Run ID: ${args.runId}`,
    `Target repository (READ-ONLY for you): ${args.targetRepo}`,
    `Your working directory is the target repository.`,
    `Plan: ${args.planMdAbs}`,
    `Sprint contract (the rubric and verification commands you must enforce): ${contractAbs}`,
    `Executor output to verify: ${outputAbs}`,
    `Write your verdict to: ${verdictAbs}`,
    ``,
    `Your verdict.md MUST start with "# Sprint NN — Verdict: PASS" or "Verdict: FAIL".`
  ].join('\n');

  return {
    prompt,
    systemPrompt,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Write'],
    cwd: args.targetRepo,
    maxTurns: 60,
    maxBudgetUsd: 5.0,
    transcriptPath: args.transcriptPath
  };
}
```

Note: evaluator needs `Write` only to produce verdict.md. The prompt forbids editing target code; tool trust is by instruction. V2: scope `Write` via custom MCP to allow only verdict.md path.

- [ ] **Step 6: Run tests, verify pass**

```bash
npm test -- tests/roles/builders.test.ts
```
Expected: PASS, all 4.

- [ ] **Step 7: Commit**

```bash
git add src/roles/ tests/roles/
git commit -m "feat(roles): planner, executor, evaluator session builders"
```

---

## Task 12: CLI scaffolding (`src/cli/index.ts`)

**Files:**
- Create: `src/cli/index.ts`

- [ ] **Step 1: Write `src/cli/index.ts`**

```ts
import { Command } from 'commander';
import { VERSION } from '../index.js';

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('harness')
    .description('Local CLI harness for long-running Claude Agent SDK sessions')
    .version(VERSION);

  // Subcommands wired up in subsequent tasks.
  const { registerInit } = await import('./commands/init.js');
  const { registerPlan } = await import('./commands/plan.js');
  const { registerNext } = await import('./commands/next.js');
  const { registerStatus } = await import('./commands/status.js');
  const { registerList } = await import('./commands/list.js');
  const { registerLogs } = await import('./commands/logs.js');
  const { registerRetry } = await import('./commands/retry.js');
  const { registerAbort } = await import('./commands/abort.js');

  registerInit(program);
  registerPlan(program);
  registerNext(program);
  registerStatus(program);
  registerList(program);
  registerLogs(program);
  registerRetry(program);
  registerAbort(program);

  await program.parseAsync(argv);
}
```

- [ ] **Step 2: Create stub command files so import doesn't fail**

For each of init, plan, next, status, list, logs, retry, abort — create stub at `src/cli/commands/<name>.ts`:

```ts
import type { Command } from 'commander';
export function registerInit(program: Command): void {
  program.command('init').description('Create a new run').action(() => {
    console.error('not yet implemented');
    process.exit(1);
  });
}
```

Repeat with the corresponding `registerX` name and command name for each of the other 7. (Implementations follow in next tasks.)

- [ ] **Step 3: Build and smoke-test help**

```bash
npm run build
node bin/harness --help
```
Expected: prints help listing all 8 commands.

- [ ] **Step 4: Commit**

```bash
git add src/cli/
git commit -m "feat(cli): commander scaffold with 8 subcommand stubs"
```

---

## Task 13: `harness init` command

**Files:**
- Modify: `src/cli/commands/init.ts`
- Create: `tests/cli/init.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/cli/init.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleInit } from '../../src/cli/commands/init.js';

describe('harness init', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-init-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });
  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('inline task creates run dir with task.md and state.json', async () => {
    const result = await handleInit({
      repo: '/some/repo',
      task: 'do the thing',
      maxRetries: 3
    });
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}-/);
    const runDir = path.join(tmp, 'runs', result.runId);
    expect((await fs.readFile(path.join(runDir, 'task.md'), 'utf8'))).toContain('do the thing');
    const state = JSON.parse(await fs.readFile(path.join(runDir, 'state.json'), 'utf8'));
    expect(state.next_role).toBe('planner');
    expect(state.target_repo).toBe('/some/repo');
  });

  test('file task loads contents from file', async () => {
    const taskFile = path.join(tmp, 'task.txt');
    await fs.writeFile(taskFile, 'task from file');
    const result = await handleInit({
      repo: '/r',
      taskFile,
      maxRetries: 2
    });
    const task = await fs.readFile(path.join(tmp, 'runs', result.runId, 'task.md'), 'utf8');
    expect(task).toContain('task from file');
  });

  test('requires either task or taskFile', async () => {
    await expect(handleInit({ repo: '/r', maxRetries: 3 })).rejects.toThrow(/task/);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/cli/init.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/cli/commands/init.ts`**

Overwrite the stub:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { createRun } from '../../state/run.js';

export interface InitArgs {
  repo: string;
  task?: string;
  taskFile?: string;
  maxRetries: number;
}

export interface InitResult {
  runId: string;
}

export async function handleInit(args: InitArgs): Promise<InitResult> {
  let body = args.task;
  if (!body && args.taskFile) {
    body = await fs.readFile(args.taskFile, 'utf8');
  }
  if (!body) {
    throw new Error('--task or --task-file is required');
  }
  const repoAbs = path.resolve(args.repo);
  const run = await createRun({
    targetRepo: repoAbs,
    task: body,
    maxRetries: args.maxRetries
  });
  return { runId: run.state.run_id };
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create a new run')
    .requiredOption('--repo <path>', 'Target repository path')
    .option('--task <text>', 'Task description (inline)')
    .option('--task-file <path>', 'Task description (from file)')
    .option('--max-retries <n>', 'Max retries per sprint', (v) => parseInt(v, 10), 3)
    .action(async (opts) => {
      const result = await handleInit({
        repo: opts.repo,
        task: opts.task,
        taskFile: opts.taskFile,
        maxRetries: opts.maxRetries
      });
      console.log(result.runId);
    });
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/cli/init.test.ts
```
Expected: PASS, all 3.

- [ ] **Step 5: Smoke test**

```bash
npm run build
AGENT_HARNESS_HOME=/tmp/harness-smoke node bin/harness init --repo /tmp --task "smoke test"
ls /tmp/harness-smoke/runs/
```
Expected: prints a run id; the runs dir contains one entry with task.md + state.json.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/init.ts tests/cli/init.test.ts
git commit -m "feat(cli): harness init creates run with task.md + state.json"
```

---

## Task 14: `harness status` and `harness list`

These are pure reads — good to land before the role-invoking commands.

**Files:**
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/list.ts`
- Create: `tests/cli/status-list.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/cli/status-list.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleStatus } from '../../src/cli/commands/status.js';
import { handleList } from '../../src/cli/commands/list.js';
import { handleInit } from '../../src/cli/commands/init.js';

describe('status & list', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-sl-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });
  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('list returns empty when no runs', async () => {
    const result = await handleList();
    expect(result.runs).toEqual([]);
  });

  test('list returns created runs sorted desc', async () => {
    const a = await handleInit({ repo: '/r', task: 'a', maxRetries: 3 });
    await new Promise((r) => setTimeout(r, 10));
    const b = await handleInit({ repo: '/r', task: 'b', maxRetries: 3 });
    const result = await handleList();
    const ids = result.runs.map((r) => r.run_id);
    expect(ids).toContain(a.runId);
    expect(ids).toContain(b.runId);
  });

  test('status returns current state for a run', async () => {
    const init = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });
    const status = await handleStatus({ runId: init.runId });
    expect(status.state.next_role).toBe('planner');
    expect(status.state.run_id).toBe(init.runId);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/cli/status-list.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/cli/commands/status.ts`**

```ts
import type { Command } from 'commander';
import { loadRun } from '../../state/run.js';
import type { State } from '../../state/schema.js';

export async function handleStatus(args: { runId: string }): Promise<{ state: State }> {
  const run = await loadRun(args.runId);
  return { state: run.state };
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Print state of a run')
    .requiredOption('--run <id>', 'Run id')
    .action(async (opts) => {
      const { state } = await handleStatus({ runId: opts.run });
      console.log(JSON.stringify(state, null, 2));
    });
}
```

- [ ] **Step 4: Implement `src/cli/commands/list.ts`**

```ts
import * as fs from 'node:fs/promises';
import type { Command } from 'commander';
import { runsRoot } from '../../state/paths.js';
import { loadRun } from '../../state/run.js';
import type { State } from '../../state/schema.js';

export async function handleList(): Promise<{ runs: State[] }> {
  let entries: string[];
  try {
    entries = await fs.readdir(runsRoot());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { runs: [] };
    throw err;
  }
  const runs: State[] = [];
  for (const id of entries) {
    try {
      const r = await loadRun(id);
      runs.push(r.state);
    } catch {
      // skip unparseable
    }
  }
  runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { runs };
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List all runs')
    .action(async () => {
      const { runs } = await handleList();
      for (const r of runs) {
        console.log(
          `${r.run_id}\t${r.status}\t${r.next_role}\tsprint ${r.current_sprint}/${r.total_sprints}\t${r.task_summary}`
        );
      }
    });
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
npm test -- tests/cli/status-list.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/status.ts src/cli/commands/list.ts tests/cli/status-list.test.ts
git commit -m "feat(cli): harness status + harness list"
```

---

## Task 15: `harness plan` command

Invokes the planner role, then parses the resulting plan.md for sprint headers and updates state with `total_sprints`.

**Files:**
- Modify: `src/cli/commands/plan.ts`
- Create: `tests/cli/plan.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/cli/plan.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

jest.mock('../../src/sdk/session.js', () => ({
  runSession: jest.fn()
}));
import { runSession } from '../../src/sdk/session.js';
import { handleInit } from '../../src/cli/commands/init.js';
import { handlePlan } from '../../src/cli/commands/plan.js';
import { loadRun } from '../../src/state/run.js';

const mockedRun = runSession as unknown as jest.Mock;

describe('harness plan', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-plan-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });
  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
    mockedRun.mockReset();
  });

  test('runs planner, parses sprints from plan.md, updates state', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });

    // Simulate planner writing plan.md to the run dir.
    mockedRun.mockImplementation(async (cfg: { cwd: string }) => {
      const plan = `# Plan\n## Sprint 1: First sprint\n## Sprint 2: Second sprint\n`;
      await fs.writeFile(path.join(cfg.cwd, 'plan.md'), plan);
      return { success: true, durationMs: 1, resultText: 'done' };
    });

    await handlePlan({ runId });

    const run = await loadRun(runId);
    expect(run.state.total_sprints).toBe(2);
    expect(run.state.next_role).toBe('executor');
    expect(run.state.current_sprint).toBe(1);
  });

  test('fails clearly if plan.md not written', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });
    mockedRun.mockResolvedValue({ success: true, durationMs: 1 });
    await expect(handlePlan({ runId })).rejects.toThrow(/plan\.md/);
  });

  test('fails if SDK session unsuccessful', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });
    mockedRun.mockResolvedValue({ success: false, failureSubtype: 'error_max_turns', durationMs: 1 });
    await expect(handlePlan({ runId })).rejects.toThrow(/planner/);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/cli/plan.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/cli/commands/plan.ts`**

```ts
import * as path from 'node:path';
import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';
import { runDir, planPath, taskPath, logsDir } from '../../state/paths.js';
import { readOrNull } from '../../lib/fs.js';
import { parseSprintsFromPlan } from '../../state/artifacts.js';
import { buildPlannerInput } from '../../roles/planner.js';
import { runSession } from '../../sdk/session.js';
import { advance } from '../../state/transitions.js';

export async function handlePlan(args: { runId: string }): Promise<void> {
  const run = await loadRun(args.runId);
  if (run.state.next_role !== 'planner') {
    throw new Error(`Cannot plan: next_role is ${run.state.next_role}`);
  }

  const input = await buildPlannerInput({
    runId: run.state.run_id,
    targetRepo: run.state.target_repo,
    runDirAbs: runDir(run.state.run_id),
    taskMdAbs: taskPath(run.state.run_id),
    transcriptPath: path.join(logsDir(run.state.run_id), 'planner.log')
  });

  const result = await runSession(input);
  if (!result.success) {
    throw new Error(`planner session failed: ${result.failureSubtype ?? 'unknown'}`);
  }

  const planMd = await readOrNull(planPath(run.state.run_id));
  if (planMd === null) {
    throw new Error(`planner did not write plan.md at ${planPath(run.state.run_id)}`);
  }

  const sprints = parseSprintsFromPlan(planMd);
  if (sprints.length === 0) {
    throw new Error('planner produced plan.md but no ## Sprint N: headers were found');
  }

  const nextState = advance(run.state, { totalSprints: sprints.length });
  await saveState(nextState);
}

export function registerPlan(program: Command): void {
  program
    .command('plan')
    .description('Invoke the planner role for a run')
    .requiredOption('--run <id>', 'Run id')
    .action(async (opts) => {
      await handlePlan({ runId: opts.run });
      console.log(`planner complete`);
    });
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/cli/plan.test.ts
```
Expected: PASS, all 3.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/plan.ts tests/cli/plan.test.ts
git commit -m "feat(cli): harness plan invokes planner + parses sprints"
```

---

## Task 16: `harness next` command

Dispatches the next role based on state.json. For executor: build executor input, run, advance. For evaluator: build evaluator input, run, parse verdict, advance with verdict.

**Files:**
- Modify: `src/cli/commands/next.ts`
- Create: `tests/cli/next.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/cli/next.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

jest.mock('../../src/sdk/session.js', () => ({
  runSession: jest.fn()
}));
import { runSession } from '../../src/sdk/session.js';
import { handleInit } from '../../src/cli/commands/init.js';
import { handlePlan } from '../../src/cli/commands/plan.js';
import { handleNext } from '../../src/cli/commands/next.js';
import { loadRun } from '../../src/state/run.js';

const mockedRun = runSession as unknown as jest.Mock;

async function seedWithPlan(tmp: string): Promise<string> {
  process.env.AGENT_HARNESS_HOME = tmp;
  const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });
  mockedRun.mockImplementationOnce(async (cfg: { cwd: string }) => {
    await fs.writeFile(
      path.join(cfg.cwd, 'plan.md'),
      `# Plan\n## Sprint 1: First sprint\n`
    );
    await fs.mkdir(path.join(cfg.cwd, 'sprints', '01-first-sprint'), { recursive: true });
    await fs.writeFile(
      path.join(cfg.cwd, 'sprints', '01-first-sprint', 'contract.md'),
      `# Sprint 1 — first sprint\n## Rubric\n1. always pass\n`
    );
    return { success: true, durationMs: 1, resultText: 'done' };
  });
  await handlePlan({ runId });
  return runId;
}

describe('harness next', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-next-'));
  });
  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
    mockedRun.mockReset();
  });

  test('next executor writes output.md and advances to evaluator', async () => {
    const runId = await seedWithPlan(tmp);
    mockedRun.mockImplementationOnce(async (cfg: { cwd: string; prompt: string }) => {
      // Executor's cwd is the target repo; output.md path comes from prompt.
      const outPath = cfg.prompt.match(/Write your output summary to: (\S+)/)?.[1];
      if (outPath) await fs.writeFile(outPath, 'work done');
      return { success: true, durationMs: 1 };
    });

    await handleNext({ runId });
    const run = await loadRun(runId);
    expect(run.state.next_role).toBe('evaluator');
  });

  test('next evaluator with PASS advances sprint', async () => {
    const runId = await seedWithPlan(tmp);

    mockedRun.mockImplementationOnce(async (cfg: { prompt: string }) => {
      const outPath = cfg.prompt.match(/Write your output summary to: (\S+)/)?.[1];
      if (outPath) await fs.writeFile(outPath, 'work done');
      return { success: true, durationMs: 1 };
    });
    await handleNext({ runId }); // executor

    mockedRun.mockImplementationOnce(async (cfg: { prompt: string }) => {
      const verdictPath = cfg.prompt.match(/Write your verdict to: (\S+)/)?.[1];
      if (verdictPath) {
        await fs.writeFile(
          verdictPath,
          '# Sprint 01 — Verdict: PASS\n## Rubric scoring\n1. ok — PASS — evidence\n'
        );
      }
      return { success: true, durationMs: 1 };
    });
    await handleNext({ runId }); // evaluator

    const run = await loadRun(runId);
    expect(run.state.status).toBe('completed');
    expect(run.state.next_role).toBe('done');
    expect(run.state.last_verdict).toBe('PASS');
  });

  test('next evaluator with FAIL stays in sprint, retry++', async () => {
    const runId = await seedWithPlan(tmp);

    mockedRun.mockImplementationOnce(async (cfg: { prompt: string }) => {
      const outPath = cfg.prompt.match(/Write your output summary to: (\S+)/)?.[1];
      if (outPath) await fs.writeFile(outPath, 'work done');
      return { success: true, durationMs: 1 };
    });
    await handleNext({ runId }); // executor

    mockedRun.mockImplementationOnce(async (cfg: { prompt: string }) => {
      const verdictPath = cfg.prompt.match(/Write your verdict to: (\S+)/)?.[1];
      if (verdictPath) {
        await fs.writeFile(
          verdictPath,
          '# Sprint 01 — Verdict: FAIL\n## Fix-it-back notes\nfix X\n'
        );
      }
      return { success: true, durationMs: 1 };
    });
    await handleNext({ runId }); // evaluator

    const run = await loadRun(runId);
    expect(run.state.next_role).toBe('executor');
    expect(run.state.current_sprint).toBe(1);
    expect(run.state.retry_count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/cli/next.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/cli/commands/next.ts`**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';
import { runDir, sprintsDir, planPath, logsDir } from '../../state/paths.js';
import { readOrNull } from '../../lib/fs.js';
import { advance } from '../../state/transitions.js';
import { parseVerdict, parseSprintsFromPlan } from '../../state/artifacts.js';
import { buildExecutorInput } from '../../roles/executor.js';
import { buildEvaluatorInput } from '../../roles/evaluator.js';
import { runSession } from '../../sdk/session.js';

async function resolveSprintDir(runId: string, sprintNum: number): Promise<string> {
  const dir = sprintsDir(runId);
  const entries = await fs.readdir(dir);
  const prefix = sprintNum.toString().padStart(2, '0') + '-';
  const match = entries.find((e) => e.startsWith(prefix));
  if (!match) throw new Error(`no sprint dir for sprint ${sprintNum} (prefix ${prefix}) in ${dir}`);
  return path.join(dir, match);
}

async function readRetryNotes(sprintDir: string): Promise<string | null> {
  const verdictMd = await readOrNull(path.join(sprintDir, 'verdict.md'));
  if (!verdictMd) return null;
  const verdict = parseVerdict(verdictMd);
  if (verdict !== 'FAIL') return null;
  const m = verdictMd.match(/## Fix-it-back notes\s*\n([\s\S]+)$/i);
  return m ? m[1].trim() : verdictMd;
}

export async function handleNext(args: { runId: string }): Promise<void> {
  const run = await loadRun(args.runId);
  const s = run.state;

  if (s.status !== 'in_progress') {
    throw new Error(`run not in progress: status=${s.status}`);
  }
  if (s.next_role === 'planner') {
    throw new Error('use `harness plan` for the planner role');
  }
  if (s.next_role === 'done') {
    throw new Error('run already done');
  }

  const sprintDir = await resolveSprintDir(s.run_id, s.current_sprint);

  if (s.next_role === 'executor') {
    const retryNotes = await readRetryNotes(sprintDir);
    const input = await buildExecutorInput({
      runId: s.run_id,
      targetRepo: s.target_repo,
      runDirAbs: runDir(s.run_id),
      sprintDirAbs: sprintDir,
      planMdAbs: planPath(s.run_id),
      transcriptPath: path.join(logsDir(s.run_id), `executor-s${s.current_sprint}-r${s.retry_count}.log`),
      retryNotes
    });
    const result = await runSession(input);
    if (!result.success) {
      throw new Error(`executor session failed: ${result.failureSubtype ?? 'unknown'}`);
    }
    const outputMd = await readOrNull(path.join(sprintDir, 'output.md'));
    if (outputMd === null) {
      throw new Error(`executor did not write output.md in ${sprintDir}`);
    }
    await saveState(advance(s, {}));
    return;
  }

  if (s.next_role === 'evaluator') {
    const input = await buildEvaluatorInput({
      runId: s.run_id,
      targetRepo: s.target_repo,
      runDirAbs: runDir(s.run_id),
      sprintDirAbs: sprintDir,
      planMdAbs: planPath(s.run_id),
      transcriptPath: path.join(logsDir(s.run_id), `evaluator-s${s.current_sprint}-r${s.retry_count}.log`)
    });
    const result = await runSession(input);
    if (!result.success) {
      throw new Error(`evaluator session failed: ${result.failureSubtype ?? 'unknown'}`);
    }
    const verdictMd = await readOrNull(path.join(sprintDir, 'verdict.md'));
    if (verdictMd === null) {
      throw new Error(`evaluator did not write verdict.md in ${sprintDir}`);
    }
    const verdict = parseVerdict(verdictMd);
    if (verdict === null) {
      throw new Error(`evaluator wrote verdict.md but no "Verdict: PASS|FAIL" header found`);
    }
    await saveState(advance(s, { verdict }));
    return;
  }
}

export function registerNext(program: Command): void {
  program
    .command('next')
    .description('Advance the run by invoking the next role')
    .requiredOption('--run <id>', 'Run id')
    .action(async (opts) => {
      await handleNext({ runId: opts.run });
      console.log('advanced');
    });
}

// parseSprintsFromPlan referenced indirectly via plan command; re-export not needed here
void parseSprintsFromPlan;
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/cli/next.test.ts
```
Expected: PASS, all 3.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/next.ts tests/cli/next.test.ts
git commit -m "feat(cli): harness next dispatches executor/evaluator + applies transitions"
```

---

## Task 17: `harness logs`, `harness retry`, `harness abort`

Smaller commands with simpler tests.

**Files:**
- Modify: `src/cli/commands/logs.ts`
- Modify: `src/cli/commands/retry.ts`
- Modify: `src/cli/commands/abort.ts`
- Create: `tests/cli/misc.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/cli/misc.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleInit } from '../../src/cli/commands/init.js';
import { handleAbort } from '../../src/cli/commands/abort.js';
import { handleLogs } from '../../src/cli/commands/logs.js';
import { loadRun } from '../../src/state/run.js';
import { logsDir } from '../../src/state/paths.js';

describe('logs & abort', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-misc-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });
  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('abort sets status to aborted', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });
    await handleAbort({ runId });
    const run = await loadRun(runId);
    expect(run.state.status).toBe('aborted');
  });

  test('logs returns concatenated log files for a run', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });
    await fs.writeFile(path.join(logsDir(runId), 'planner.log'), 'planner output\n');
    await fs.writeFile(path.join(logsDir(runId), 'executor-s1-r0.log'), 'executor output\n');
    const { content } = await handleLogs({ runId });
    expect(content).toContain('planner output');
    expect(content).toContain('executor output');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/cli/misc.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/cli/commands/abort.ts`**

```ts
import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';

export async function handleAbort(args: { runId: string }): Promise<void> {
  const run = await loadRun(args.runId);
  await saveState({ ...run.state, status: 'aborted', updated_at: new Date().toISOString() });
}

export function registerAbort(program: Command): void {
  program
    .command('abort')
    .description('Mark a run as aborted')
    .requiredOption('--run <id>', 'Run id')
    .action(async (opts) => {
      await handleAbort({ runId: opts.run });
      console.log('aborted');
    });
}
```

- [ ] **Step 4: Implement `src/cli/commands/logs.ts`**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { logsDir } from '../../state/paths.js';

export async function handleLogs(args: {
  runId: string;
  role?: string;
  sprint?: number;
}): Promise<{ content: string }> {
  const dir = logsDir(args.runId);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { content: '' };
    throw err;
  }
  files = files.filter((f) => {
    if (args.role && !f.startsWith(args.role)) return false;
    if (args.sprint !== undefined && !f.includes(`-s${args.sprint}-`)) return false;
    return true;
  });
  files.sort();
  const chunks: string[] = [];
  for (const f of files) {
    chunks.push(`==== ${f} ====`);
    chunks.push(await fs.readFile(path.join(dir, f), 'utf8'));
  }
  return { content: chunks.join('\n') };
}

export function registerLogs(program: Command): void {
  program
    .command('logs')
    .description('Print logs for a run')
    .requiredOption('--run <id>', 'Run id')
    .option('--role <r>', 'Filter by role (planner|executor|evaluator)')
    .option('--sprint <n>', 'Filter by sprint number', (v) => parseInt(v, 10))
    .action(async (opts) => {
      const { content } = await handleLogs({
        runId: opts.run,
        role: opts.role,
        sprint: opts.sprint
      });
      process.stdout.write(content);
    });
}
```

- [ ] **Step 5: Implement `src/cli/commands/retry.ts`**

```ts
import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';

export async function handleRetry(args: { runId: string; notes?: string }): Promise<void> {
  const run = await loadRun(args.runId);
  if (run.state.next_role !== 'executor' && run.state.next_role !== 'evaluator') {
    throw new Error(`cannot retry from next_role=${run.state.next_role}`);
  }
  // For V1, retry is a re-invocation hint: it does not modify state.
  // It just persists the extra notes into the sprint dir so the next handleNext picks them up.
  // (Implementation detail handled by storing notes alongside verdict.md.)
  // For simplicity in V1, just update the updated_at and log.
  await saveState({ ...run.state, updated_at: new Date().toISOString() });
  if (args.notes) {
    // Future: write notes to a per-sprint retry-notes.md that executor reads.
    console.log(`(retry notes recorded but not yet wired into executor prompt: ${args.notes})`);
  }
}

export function registerRetry(program: Command): void {
  program
    .command('retry')
    .description('Re-mark the current role as ready to run')
    .requiredOption('--run <id>', 'Run id')
    .option('--notes <text>', 'Extra notes (V1: logged only)')
    .action(async (opts) => {
      await handleRetry({ runId: opts.run, notes: opts.notes });
      console.log('retry recorded');
    });
}
```

(Note: `retry` is intentionally minimal for V1. The verdict's fix-it-back notes already flow into the executor prompt on the next FAIL. Manual operator notes are deferred to V2 unless the user wants them now.)

- [ ] **Step 6: Run tests, verify pass**

```bash
npm test -- tests/cli/misc.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/abort.ts src/cli/commands/logs.ts src/cli/commands/retry.ts tests/cli/misc.test.ts
git commit -m "feat(cli): logs, retry, abort commands"
```

---

## Task 18: README + smoke test

**Files:**
- Create: `README.md`
- Create: `tests/fixtures/dummy-repo/README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Create dummy fixture repo for manual smoke**

Create `tests/fixtures/dummy-repo/README.md`:

```markdown
# Dummy fixture repo

Used for manual smoke tests of agent-harness. Contains nothing executable;
the harness just needs a directory it can point at.
```

- [ ] **Step 3: Full test run + build**

```bash
npm test
npm run build
node bin/harness --help
```
Expected: all tests pass; help lists all 8 commands.

- [ ] **Step 4: Commit**

```bash
git add README.md tests/fixtures/
git commit -m "docs: README + smoke fixture"
```

---

## Self-review

**Spec coverage check** (against `2026-05-19-agent-harness-design.md`):

- §3 Roles + tool allowlists → Tasks 9, 11 (prompts + role builders enforcing tool lists). ✅
- §4 Loop & state machine → Tasks 4, 5 (schema + transitions, with PASS/FAIL/retry/halt branches all tested). ✅
- §5 On-disk layout → Tasks 2, 6 (paths.ts, run.ts create the exact tree). ✅
- §6 Contract file format → Task 9 (planner prompt instructs the exact section structure). Parser is intentionally lax — only PASS/FAIL header is parsed strictly. ✅
- §7 Verdict file format → Task 9 (evaluator prompt prescribes exact format) + Task 7 (parseVerdict). ✅
- §8 CLI surface — init, plan, next, status, logs, list, retry, abort → Tasks 13–17. ✅
- §9 Component breakdown → matches file map at top of this plan. ✅
- §10 Tool allowlists per role → Task 11 (builders set `allowedTools` per spec). One deliberate deviation: planner has `Write` + `Bash`, evaluator has `Write` + `Bash` — needed to write artifacts. Read-only constraint against the **target repo** is enforced by prompt, not by tool. Documented as V2 hardening in Task 11 notes. ✅
- §11 Self-eval bias mitigation → Task 9 (evaluator prompt: "ADVERSARIAL QA", "default to FAIL", "treat output.md as a claim"). ✅
- §12 Error handling — empty plan, missing artifacts, etc. → Tasks 15, 16 (handlePlan/handleNext throw on missing plan.md, missing output.md, missing/unparseable verdict.md). ✅
- §13 Testing strategy — unit tests on pure logic, integration with mocked SDK → covered across Tasks 2–17. ✅

**Placeholder scan:** No TBDs, no "implement appropriate X". Two deliberate V2 deferrals are documented in-task (`retry` notes wiring; tool-level write scoping). Both are explicit and harmless if left as-is.

**Type consistency check:**
- `Role` enum (planner, executor, evaluator, done) used identically in Tasks 4, 5, 16. ✅
- `Status` enum (in_progress, halted, completed, aborted) used identically in Tasks 4, 17. ✅
- `Verdict` (PASS|FAIL) used identically in Tasks 7, 16, 5. ✅
- `RunSessionInput`/`RunSessionResult` fields stable across Tasks 10, 11, 15, 16. ✅
- `advance()` signature `(state, ctx?)` matches all call sites. ✅
- `parseVerdict` returns `Verdict | null` — matches callers in Task 16. ✅
