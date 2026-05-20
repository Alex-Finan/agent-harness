import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { jest } from '@jest/globals';

const mockRunSession = jest.fn();
jest.unstable_mockModule('../../src/sdk/session.js', () => ({
  runSession: mockRunSession
}));

const { buildServer } = await import('../../src/server/api.js');
const { handleInit } = await import('../../src/cli/commands/init.js');
const { writePrompt, readPrompt } = await import('../../src/server/prompts.js');

describe('server API', () => {
  let tmp: string;
  let originalPrompts: { planner: string; executor: string; evaluator: string };

  beforeAll(async () => {
    originalPrompts = {
      planner: await readPrompt('planner'),
      executor: await readPrompt('executor'),
      evaluator: await readPrompt('evaluator')
    };
  });

  afterAll(async () => {
    await writePrompt('planner', originalPrompts.planner);
    await writePrompt('executor', originalPrompts.executor);
    await writePrompt('evaluator', originalPrompts.evaluator);
  });

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-api-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });

  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
    mockRunSession.mockReset();
  });

  async function withServer<T>(fn: (app: Awaited<ReturnType<typeof buildServer>>) => Promise<T>): Promise<T> {
    const built = await buildServer({ logger: false });
    try {
      return await fn(built);
    } finally {
      await built.watcher.stop();
      await built.app.close();
    }
  }

  test('GET /api/meta returns version + harnessHome', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: '/api/meta' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.harnessHome).toBe(tmp);
      expect(typeof body.version).toBe('string');
    });
  });

  test('GET /api/runs returns [] when no runs', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ runs: [] });
    });
  });

  test('POST /api/runs creates a run', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { repo: '/some/repo', task: 'do the thing', maxRetries: 3 }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.runId).toMatch(/^\d{4}-\d{2}-\d{2}/);

      const list = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(list.json().runs).toHaveLength(1);
      expect(list.json().runs[0].run_id).toBe(body.runId);
    });
  });

  test('POST /api/runs returns 400 on invalid body', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { repo: '' }
      });
      expect(res.statusCode).toBe(400);
    });
  });

  test('GET /api/runs/:id returns 404 for missing run', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/nope' });
      expect(res.statusCode).toBe(404);
    });
  });

  test('GET /api/runs/:id returns detail with snapshot + cost', async () => {
    const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });
    await withServer(async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state.run_id).toBe(runId);
      expect(body.snapshot.taskMd).toContain('t');
      expect(body.cost.totalUsd).toBe(0);
      expect(body.dispatching).toBeNull();
    });
  });

  test('PUT /api/runs/:id/plan saves plan.md + updates total_sprints', async () => {
    const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });
    await withServer(async ({ app }) => {
      const planMd = '# Plan\n## Sprint 1: alpha\n## Sprint 2: bravo\n';
      const res = await app.inject({
        method: 'PUT',
        url: `/api/runs/${runId}/plan`,
        payload: { planMd }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sprints).toBe(2);

      const detail = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
      const body = detail.json();
      expect(body.snapshot.planMd).toBe(planMd);
      expect(body.state.total_sprints).toBe(2);
    });
  });

  test('PUT /api/runs/:id/sprints/:sprint/contract saves contract.md', async () => {
    const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });
    const sprintDir = path.join(tmp, 'runs', runId, 'sprints', '01-alpha');
    await fs.mkdir(sprintDir, { recursive: true });
    await withServer(async ({ app }) => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/runs/${runId}/sprints/01-alpha/contract`,
        payload: { contractMd: '# Sprint 1\n## Rubric\n1. ok' }
      });
      expect(res.statusCode).toBe(200);
      const onDisk = await fs.readFile(path.join(sprintDir, 'contract.md'), 'utf8');
      expect(onDisk).toContain('## Rubric');
    });
  });

  test('GET /api/prompts returns all three', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: '/api/prompts' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.planner).toMatch(/PLANNER/i);
      expect(body.executor).toMatch(/EXECUTOR/i);
      expect(body.evaluator).toMatch(/EVALUATOR/i);
    });
  });

  test('PUT /api/prompts/:name updates the file', async () => {
    await withServer(async ({ app }) => {
      const fresh = 'overridden planner prompt content';
      const res = await app.inject({
        method: 'PUT',
        url: '/api/prompts/planner',
        payload: { content: fresh }
      });
      expect(res.statusCode).toBe(200);
      const after = await readPrompt('planner');
      expect(after).toBe(fresh);
    });
  });

  test('PUT /api/prompts/:name rejects unknown name', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/prompts/hacker',
        payload: { content: 'x' }
      });
      expect(res.statusCode).toBe(400);
    });
  });

  test('POST /api/runs/:id/plan dispatches planner (mocked)', async () => {
    const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });
    await withServer(async ({ app, dispatcher }) => {
      mockRunSession.mockImplementationOnce(async (cfg: unknown) => {
        const c = cfg as { cwd: string };
        await fs.writeFile(path.join(c.cwd, 'plan.md'), `# Plan\n## Sprint 1: Alpha\n`);
        await fs.mkdir(path.join(c.cwd, 'sprints', '01-alpha'), { recursive: true });
        await fs.writeFile(
          path.join(c.cwd, 'sprints', '01-alpha', 'contract.md'),
          `# Sprint 1\n## Rubric\n1. always pass\n`
        );
        return { success: true, durationMs: 1 };
      });

      const res = await app.inject({ method: 'POST', url: `/api/runs/${runId}/plan` });
      expect(res.statusCode).toBe(200);
      const handle = dispatcher.current(runId)!;
      await handle.promise;
      expect(handle.finished).toBe(true);
      expect(handle.error).toBeUndefined();
    });
  });

  test('POST /api/runs/:id/abort marks run aborted', async () => {
    const { runId } = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });
    await withServer(async ({ app }) => {
      const res = await app.inject({ method: 'POST', url: `/api/runs/${runId}/abort` });
      expect(res.statusCode).toBe(200);
      const detail = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
      expect(detail.json().state.status).toBe('aborted');
    });
  });
});
