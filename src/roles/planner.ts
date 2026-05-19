import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RunSessionInput } from '../sdk/session.js';

/**
 * Resolve the prompts directory relative to this source file.
 *
 * In jest (ts-jest CJS transform), `__dirname` is injected as a CJS global.
 * In real ESM runtime (dist/), `__dirname` is not defined; we fall back to
 * resolving via `require` from the compiled file's location.
 *
 * We avoid `import.meta.url` because ts-jest v29 with NodeNext + isolatedModules=false
 * raises TS1343 at parse time even though the branch is never executed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: string | undefined;

function resolvePromptsDir(): string {
  if (typeof __dirname !== 'undefined') {
    return path.join(__dirname as string, '..', 'prompts');
  }
  // ESM runtime: use createRequire anchored to this file via a dynamic require call
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createRequire } = require('node:module') as typeof import('node:module');
  const req = createRequire(path.join(process.cwd(), 'package.json'));
  // The dist layout mirrors src/, so dist/roles/../prompts = dist/prompts
  const selfResolved = req.resolve('./dist/roles/planner');
  return path.join(path.dirname(selfResolved), '..', 'prompts');
}

async function loadPrompt(name: string): Promise<string> {
  return fs.readFile(path.join(resolvePromptsDir(), name), 'utf8');
}

export interface PlannerArgs {
  runId: string;
  targetRepo: string;
  transcriptPath: string;
  runDirAbs: string;
  taskMdAbs: string;
}

export async function buildPlannerInput(args: PlannerArgs): Promise<RunSessionInput> {
  const systemPrompt = await loadPrompt('planner.md');
  const prompt = [
    `Run ID: ${args.runId}`,
    `Target repository (READ-ONLY for you): ${args.targetRepo}`,
    `Task description: ${args.taskMdAbs}`,
    ``,
    `Your working directory is the run directory: ${args.runDirAbs}`,
    `Write plan.md and sprints/NN-<slug>/contract.md files here.`,
    ``,
    `Begin by reading the task file, then read whatever you need from the target repo to plan.`
  ].join('\n');

  return {
    prompt,
    systemPrompt,
    allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Bash'],
    cwd: args.runDirAbs,
    maxTurns: 80,
    maxBudgetUsd: 5.0,
    transcriptPath: args.transcriptPath
  };
}
