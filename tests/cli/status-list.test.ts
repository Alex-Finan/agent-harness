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
