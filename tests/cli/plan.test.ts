import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { jest } from '@jest/globals';

// In native ESM mode, use unstable_mockModule + dynamic import.
const mockRunSession = jest.fn();
jest.unstable_mockModule('../../src/sdk/session.js', () => ({
  runSession: mockRunSession
}));

const { handleInit } = await import('../../src/cli/commands/init.js');
const { handlePlan } = await import('../../src/cli/commands/plan.js');
const { loadRun } = await import('../../src/state/run.js');

describe('harness plan', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-plan-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });
  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
    mockRunSession.mockReset();
  });

  test('runs planner, parses sprints from plan.md, updates state', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });

    mockRunSession.mockImplementation(async (cfg: unknown) => {
      const plan = `# Plan\n## Sprint 1: First sprint\n## Sprint 2: Second sprint\n`;
      await fs.writeFile(path.join((cfg as { cwd: string }).cwd, 'plan.md'), plan);
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
    mockRunSession.mockResolvedValue({ success: true, durationMs: 1 } as never);
    await expect(handlePlan({ runId })).rejects.toThrow(/plan\.md/);
  });

  test('fails if SDK session unsuccessful', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });
    mockRunSession.mockResolvedValue({ success: false, failureSubtype: 'error_max_turns', durationMs: 1 } as never);
    await expect(handlePlan({ runId })).rejects.toThrow(/planner/);
  });
});
