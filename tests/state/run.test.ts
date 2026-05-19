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
