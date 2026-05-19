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
    mockedRun.mockImplementationOnce(async (cfg: { prompt: string }) => {
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
    await handleNext({ runId });

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
    await handleNext({ runId });

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
    await handleNext({ runId });

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
    await handleNext({ runId });

    const run = await loadRun(runId);
    expect(run.state.next_role).toBe('executor');
    expect(run.state.current_sprint).toBe(1);
    expect(run.state.retry_count).toBe(1);
  });
});
