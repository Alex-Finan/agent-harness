import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { jest } from '@jest/globals';

const mockRunSession = jest.fn();
jest.unstable_mockModule('../../src/sdk/session.js', () => ({
  runSession: mockRunSession
}));

// Dynamic imports must come after jest.unstable_mockModule
const { buildServer } = await import('../../src/server/api.js');
const { handleInit } = await import('../../src/cli/commands/init.js');
const { StateSchema } = await import('../../src/state/schema.js');
const { statePath } = await import('../../src/state/paths.js');
const { saveState, loadRun } = await import('../../src/state/run.js');
const { resumeAutoIterates } = await import('../../src/server/index.js');

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

type ServerBuilt = Awaited<ReturnType<typeof buildServer>>;

async function withServer<T>(fn: (built: ServerBuilt) => Promise<T>): Promise<T> {
  const built = await buildServer({ logger: false });
  try {
    return await fn(built);
  } finally {
    await built.watcher.stop();
    await built.app.close();
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('auto-iterate-resume', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-ai-resume-'));
    process.env.AGENT_HARNESS_HOME = tmp;
    // Ensure the runs directory exists so resumeAutoIterates can read it
    await fs.mkdir(path.join(tmp, 'runs'), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
    mockRunSession.mockReset();
  });

  // -------------------------------------------------------------------------
  // Rubric 2: old state.json (no auto_iterate field) parses as false
  // -------------------------------------------------------------------------

  test('StateSchema defaults auto_iterate to false when field is absent', () => {
    const result = StateSchema.parse({
      run_id: 'x',
      target_repo: '/r',
      task_summary: 't',
      current_sprint: 0,
      total_sprints: 0,
      next_role: 'planner',
      retry_count: 0,
      max_retries: 3,
      status: 'in_progress',
      created_at: 'x',
      updated_at: 'x'
    });
    expect(result.auto_iterate).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Rubric 3: startAutoIterate persists auto_iterate: true during the loop
  // -------------------------------------------------------------------------

  test('startAutoIterate writes auto_iterate: true to state.json before running', async () => {
    const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });

    let autoIterateWasTrueDuringLoop = false;

    // Planner mock: capture auto_iterate, write plan.md + sprint scaffold
    mockRunSession.mockImplementationOnce(async (cfg: unknown) => {
      const c = cfg as { cwd: string };
      const raw = await fs.readFile(path.join(c.cwd, 'state.json'), 'utf8');
      const state = JSON.parse(raw) as { auto_iterate?: boolean };
      autoIterateWasTrueDuringLoop = state.auto_iterate === true;

      await fs.writeFile(path.join(c.cwd, 'plan.md'), '# Plan\n## Sprint 1: Alpha\n');
      await fs.mkdir(path.join(c.cwd, 'sprints', '01-alpha'), { recursive: true });
      await fs.writeFile(
        path.join(c.cwd, 'sprints', '01-alpha', 'contract.md'),
        '# Sprint 1\n## Rubric\n1. ok\n'
      );
      return { success: true, durationMs: 1 };
    });

    // Executor mock: write output.md
    mockRunSession.mockImplementationOnce(async () => {
      await fs.writeFile(
        path.join(tmp, 'runs', runId, 'sprints', '01-alpha', 'output.md'),
        '# Output\nDone.\n'
      );
      return { success: true, durationMs: 1 };
    });

    // Evaluator mock: write verdict.md with PASS (terminates the loop)
    mockRunSession.mockImplementationOnce(async () => {
      await fs.writeFile(
        path.join(tmp, 'runs', runId, 'sprints', '01-alpha', 'verdict.md'),
        'Verdict: PASS\n'
      );
      return { success: true, durationMs: 1 };
    });

    await withServer(async ({ dispatcher }) => {
      const handle = await dispatcher.startAutoIterate(runId);
      await handle.promise;
    });

    expect(autoIterateWasTrueDuringLoop).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Rubric 4: startAutoIterate clears auto_iterate: false after loop exits
  // -------------------------------------------------------------------------

  test('startAutoIterate clears auto_iterate to false after loop completes', async () => {
    const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });

    // Planner mock — auto-iterate stops here at the post-planning checkpoint.
    mockRunSession.mockImplementationOnce(async (cfg: unknown) => {
      const c = cfg as { cwd: string };
      await fs.writeFile(path.join(c.cwd, 'plan.md'), '# Plan\n## Sprint 1: Alpha\n');
      await fs.mkdir(path.join(c.cwd, 'sprints', '01-alpha'), { recursive: true });
      await fs.writeFile(
        path.join(c.cwd, 'sprints', '01-alpha', 'contract.md'),
        '# Sprint 1\n## Rubric\n1. ok\n'
      );
      return { success: true, durationMs: 1 };
    });

    // Executor mock — runs after the user resumes past the checkpoint.
    mockRunSession.mockImplementationOnce(async () => {
      await fs.writeFile(
        path.join(tmp, 'runs', runId, 'sprints', '01-alpha', 'output.md'),
        '# Output\nDone.\n'
      );
      return { success: true, durationMs: 1 };
    });

    // Evaluator mock with PASS → completes run
    mockRunSession.mockImplementationOnce(async () => {
      await fs.writeFile(
        path.join(tmp, 'runs', runId, 'sprints', '01-alpha', 'verdict.md'),
        'Verdict: PASS\n'
      );
      return { success: true, durationMs: 1 };
    });

    await withServer(async ({ dispatcher }) => {
      // First auto-iterate: planner runs, then stops at the checkpoint.
      const planHandle = await dispatcher.startAutoIterate(runId);
      await planHandle.promise;

      // Second auto-iterate (operator clicks "go" after reviewing the plan):
      // executor + evaluator run through to completion.
      const execHandle = await dispatcher.startAutoIterate(runId);
      await execHandle.promise;

      const raw = await fs.readFile(statePath(runId), 'utf8');
      const state = JSON.parse(raw) as { auto_iterate?: boolean; status?: string };
      expect(state.auto_iterate).toBe(false);
      expect(state.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // Post-planning checkpoint: auto-iterate must not roll directly into the
  // executor — the operator gets a chance to review/revise the plan first.
  // -------------------------------------------------------------------------

  test('startAutoIterate halts at the post-planning checkpoint and does not run the executor', async () => {
    const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });

    // Planner mock: writes plan + sprint scaffold.
    mockRunSession.mockImplementationOnce(async (cfg: unknown) => {
      const c = cfg as { cwd: string };
      await fs.writeFile(path.join(c.cwd, 'plan.md'), '# Plan\n## Sprint 1: Alpha\n');
      await fs.mkdir(path.join(c.cwd, 'sprints', '01-alpha'), { recursive: true });
      await fs.writeFile(
        path.join(c.cwd, 'sprints', '01-alpha', 'contract.md'),
        '# Sprint 1\n## Rubric\n1. ok\n'
      );
      return { success: true, durationMs: 1 };
    });

    // Executor mock: must NOT be called. If invoked, fail loudly.
    mockRunSession.mockImplementationOnce(async () => {
      throw new Error('executor should not run before operator approves the plan');
    });

    await withServer(async ({ dispatcher }) => {
      const handle = await dispatcher.startAutoIterate(runId);
      await handle.promise;
    });

    expect(mockRunSession).toHaveBeenCalledTimes(1);

    const raw = await fs.readFile(statePath(runId), 'utf8');
    const state = JSON.parse(raw) as {
      auto_iterate?: boolean;
      status?: string;
      next_role?: string;
    };
    expect(state.next_role).toBe('executor');
    expect(state.status).toBe('in_progress');
    expect(state.auto_iterate).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Rubric 5: abort() clears the auto_iterate flag
  // -------------------------------------------------------------------------

  test('abort clears auto_iterate flag and marks run aborted', async () => {
    const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });

    // Manually set auto_iterate: true in state.json
    const run = await loadRun(runId);
    await saveState({ ...run.state, auto_iterate: true });

    await withServer(async ({ dispatcher }) => {
      await dispatcher.abort(runId);

      const raw = await fs.readFile(statePath(runId), 'utf8');
      const state = JSON.parse(raw) as { auto_iterate?: boolean; status?: string };
      expect(state.auto_iterate).toBe(false);
      expect(state.status).toBe('aborted');
    });
  });

  // -------------------------------------------------------------------------
  // Rubric 6: resume scan calls startAutoIterate for qualifying runs
  // -------------------------------------------------------------------------

  test('resumeAutoIterates calls startAutoIterate for a qualifying run', async () => {
    const runId = '2024-01-01-000000-abc123';
    const runDirectory = path.join(tmp, 'runs', runId);
    await fs.mkdir(runDirectory, { recursive: true });

    const state = {
      run_id: runId,
      target_repo: '/r',
      task_summary: 't',
      current_sprint: 1,
      total_sprints: 2,
      next_role: 'executor',
      retry_count: 0,
      max_retries: 3,
      status: 'in_progress',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      auto_iterate: true
    };
    await fs.writeFile(path.join(runDirectory, 'state.json'), JSON.stringify(state, null, 2));

    const mockDispatcher = {
      startAutoIterate: jest.fn<() => Promise<object>>().mockResolvedValue({})
    };

    await resumeAutoIterates(mockDispatcher as never);

    expect(mockDispatcher.startAutoIterate).toHaveBeenCalledWith(runId);
  });

  // -------------------------------------------------------------------------
  // Rubric 7: resume scan skips non-qualifying runs
  // -------------------------------------------------------------------------

  test('resumeAutoIterates skips runs that do not qualify for resume', async () => {
    // Run 1: auto_iterate: false
    const runId1 = '2024-01-01-000001-aaa111';
    const runDir1 = path.join(tmp, 'runs', runId1);
    await fs.mkdir(runDir1, { recursive: true });
    await fs.writeFile(
      path.join(runDir1, 'state.json'),
      JSON.stringify({
        run_id: runId1,
        target_repo: '/r',
        task_summary: 't',
        current_sprint: 1,
        total_sprints: 2,
        next_role: 'executor',
        retry_count: 0,
        max_retries: 3,
        status: 'in_progress',
        created_at: 'x',
        updated_at: 'x',
        auto_iterate: false
      })
    );

    // Run 2: status: 'halted', auto_iterate: true
    const runId2 = '2024-01-01-000002-bbb222';
    const runDir2 = path.join(tmp, 'runs', runId2);
    await fs.mkdir(runDir2, { recursive: true });
    await fs.writeFile(
      path.join(runDir2, 'state.json'),
      JSON.stringify({
        run_id: runId2,
        target_repo: '/r',
        task_summary: 't',
        current_sprint: 1,
        total_sprints: 2,
        next_role: 'executor',
        retry_count: 3,
        max_retries: 3,
        status: 'halted',
        created_at: 'x',
        updated_at: 'x',
        auto_iterate: true
      })
    );

    // Run 3: next_role: 'done', auto_iterate: true
    const runId3 = '2024-01-01-000003-ccc333';
    const runDir3 = path.join(tmp, 'runs', runId3);
    await fs.mkdir(runDir3, { recursive: true });
    await fs.writeFile(
      path.join(runDir3, 'state.json'),
      JSON.stringify({
        run_id: runId3,
        target_repo: '/r',
        task_summary: 't',
        current_sprint: 1,
        total_sprints: 1,
        next_role: 'done',
        retry_count: 0,
        max_retries: 3,
        status: 'completed',
        created_at: 'x',
        updated_at: 'x',
        auto_iterate: true
      })
    );

    const mockDispatcher = {
      startAutoIterate: jest.fn<() => Promise<object>>().mockResolvedValue({})
    };

    await resumeAutoIterates(mockDispatcher as never);

    expect(mockDispatcher.startAutoIterate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Rubric 8: resume scan tolerates malformed state.json
  // -------------------------------------------------------------------------

  test('resumeAutoIterates tolerates a malformed state.json without throwing', async () => {
    const runId = '2024-01-01-000004-ddd444';
    const runDirectory = path.join(tmp, 'runs', runId);
    await fs.mkdir(runDirectory, { recursive: true });
    await fs.writeFile(path.join(runDirectory, 'state.json'), 'NOT VALID JSON {{{');

    const mockDispatcher = {
      startAutoIterate: jest.fn<() => Promise<object>>().mockResolvedValue({})
    };

    await expect(resumeAutoIterates(mockDispatcher as never)).resolves.toBeUndefined();
    expect(mockDispatcher.startAutoIterate).not.toHaveBeenCalled();
  });
});
