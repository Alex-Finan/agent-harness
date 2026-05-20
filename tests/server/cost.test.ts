import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { computeRunCost } from '../../src/server/cost.js';
import { logsDir } from '../../src/state/paths.js';
import { handleInit } from '../../src/cli/commands/init.js';

describe('computeRunCost', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-cost-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });

  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('returns zero for run with no logs', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });
    const cost = await computeRunCost(runId);
    expect(cost.totalUsd).toBe(0);
    expect(cost.entries).toEqual([]);
  });

  test('sums total_cost_usd across role+sprint log files', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });
    const dir = logsDir(runId);
    await fs.mkdir(dir, { recursive: true });
    const resultLine = (cost: number, turns: number) =>
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        total_cost_usd: cost,
        duration_ms: 12000,
        num_turns: turns,
        usage: { input_tokens: 1000, output_tokens: 200 }
      }) + '\n';

    await fs.writeFile(
      path.join(dir, 'planner.log'),
      JSON.stringify({ type: 'assistant' }) + '\n' + resultLine(0.05, 8)
    );
    await fs.writeFile(
      path.join(dir, 'executor-s1-r0.log'),
      resultLine(0.12, 22)
    );
    await fs.writeFile(
      path.join(dir, 'evaluator-s1-r0.log'),
      resultLine(0.03, 7)
    );

    const cost = await computeRunCost(runId);
    expect(cost.totalUsd).toBeCloseTo(0.2, 5);
    expect(cost.perRole.planner).toBeCloseTo(0.05);
    expect(cost.perRole.executor).toBeCloseTo(0.12);
    expect(cost.perRole.evaluator).toBeCloseTo(0.03);
    expect(cost.entries).toHaveLength(3);
    expect(cost.entries.find((e) => e.role === 'executor')?.numTurns).toBe(22);
    expect(cost.perSprint['sprint-1']).toBeCloseTo(0.15);
    expect(cost.perSprint['plan']).toBeCloseTo(0.05);
  });

  test('tolerates partial/malformed lines (e.g. transcript mid-write)', async () => {
    const { runId } = await handleInit({ repo: '/r', task: 't', maxRetries: 3 });
    const dir = logsDir(runId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'planner.log'),
      'NOT JSON\n' +
        JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.42 }) +
        '\n{ broken'
    );
    const cost = await computeRunCost(runId);
    expect(cost.totalUsd).toBeCloseTo(0.42);
  });
});
