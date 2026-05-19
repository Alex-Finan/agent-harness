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
