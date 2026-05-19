import * as fs from 'node:fs/promises';
import type { Command } from 'commander';
import { runsRoot } from '../../state/paths.js';
import { loadRun } from '../../state/run.js';
import type { State } from '../../state/schema.js';

export async function handleList(): Promise<{ runs: State[] }> {
  let entries: string[];
  try {
    entries = await fs.readdir(runsRoot());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { runs: [] };
    throw err;
  }
  const runs: State[] = [];
  for (const id of entries) {
    try {
      const r = await loadRun(id);
      runs.push(r.state);
    } catch {
      // skip unparseable
    }
  }
  runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { runs };
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List all runs')
    .action(async () => {
      const { runs } = await handleList();
      for (const r of runs) {
        console.log(
          `${r.run_id}\t${r.status}\t${r.next_role}\tsprint ${r.current_sprint}/${r.total_sprints}\t${r.task_summary}`
        );
      }
    });
}
