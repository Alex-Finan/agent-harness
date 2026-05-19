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
