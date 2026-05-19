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
