import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { logsDir } from '../../state/paths.js';

export async function handleLogs(args: {
  runId: string;
  role?: string;
  sprint?: number;
}): Promise<{ content: string }> {
  const dir = logsDir(args.runId);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { content: '' };
    throw err;
  }
  files = files.filter((f) => {
    if (args.role && !f.startsWith(args.role)) return false;
    if (args.sprint !== undefined && !f.includes(`-s${args.sprint}-`)) return false;
    return true;
  });
  files.sort();
  const chunks: string[] = [];
  for (const f of files) {
    chunks.push(`==== ${f} ====`);
    chunks.push(await fs.readFile(path.join(dir, f), 'utf8'));
  }
  return { content: chunks.join('\n') };
}

export function registerLogs(program: Command): void {
  program
    .command('logs')
    .description('Print logs for a run')
    .requiredOption('--run <id>', 'Run id')
    .option('--role <r>', 'Filter by role (planner|executor|evaluator)')
    .option('--sprint <n>', 'Filter by sprint number', (v) => parseInt(v, 10))
    .action(async (opts) => {
      const { content } = await handleLogs({
        runId: opts.run,
        role: opts.role,
        sprint: opts.sprint
      });
      process.stdout.write(content);
    });
}
