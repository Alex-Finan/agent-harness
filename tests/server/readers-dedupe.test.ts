import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Dynamic imports so AGENT_HARNESS_HOME is honored when paths resolve.
const { readSprints, readSprintPips } = await import('../../src/server/readers.js');
const { handleInit } = await import('../../src/cli/commands/init.js');

describe('readers — orphan sprint dir dedup', () => {
  let tmp: string;
  let runId: string;
  let sprintsRoot: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-readers-'));
    process.env.AGENT_HARNESS_HOME = tmp;
    await fs.mkdir(path.join(tmp, 'runs'), { recursive: true });
    const init = await handleInit({ repo: tmp, task: 't', maxRetries: 3 });
    runId = init.runId;
    sprintsRoot = path.join(tmp, 'runs', runId, 'sprints');
    await fs.mkdir(sprintsRoot, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function mkSprint(name: string, contractAtMs: number, withOutput = false) {
    const dir = path.join(sprintsRoot, name);
    await fs.mkdir(dir, { recursive: true });
    const contract = path.join(dir, 'contract.md');
    await fs.writeFile(contract, `# ${name}\n`);
    await fs.utimes(contract, contractAtMs / 1000, contractAtMs / 1000);
    if (withOutput) {
      const out = path.join(dir, 'output.md');
      await fs.writeFile(out, `# output\n`);
    }
  }

  test('readSprints keeps the dir with the newest contract.md per sprint number', async () => {
    // Older orphan from a prior plan revision.
    await mkSprint('01-scaffold-old', Date.now() - 60_000, true);
    // Current sprint dir — newer contract.
    await mkSprint('01-scaffold-new', Date.now(), false);

    const sprints = await readSprints(runId);
    expect(sprints).toHaveLength(1);
    expect(sprints[0].dirName).toBe('01-scaffold-new');
  });

  test('readSprintPips dedupes identically and preserves sort order by num', async () => {
    await mkSprint('04-old', Date.now() - 90_000, true);
    await mkSprint('04-new', Date.now(), false);
    await mkSprint('05-only', Date.now() - 1000, false);
    await mkSprint('02-only', Date.now() - 2000, true);

    const pips = await readSprintPips(runId);
    expect(pips.map((p) => p.num)).toEqual([2, 4, 5]);
    // Dedup picked the newer 04.
    const four = pips.find((p) => p.num === 4)!;
    expect(four.hasOutput).toBe(false); // 04-new had no output.md
  });

  test('readSprints leaves single-dir-per-num runs untouched', async () => {
    await mkSprint('01-a', Date.now() - 3000, true);
    await mkSprint('02-b', Date.now() - 2000, true);
    await mkSprint('03-c', Date.now() - 1000, false);

    const sprints = await readSprints(runId);
    expect(sprints.map((s) => s.dirName)).toEqual(['01-a', '02-b', '03-c']);
  });
});
