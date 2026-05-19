import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RunSessionInput } from '../sdk/session.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: string | undefined;

function resolvePromptsDir(): string {
  if (typeof __dirname !== 'undefined') {
    return path.join(__dirname as string, '..', 'prompts');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createRequire } = require('node:module') as typeof import('node:module');
  const req = createRequire(path.join(process.cwd(), 'package.json'));
  const selfResolved = req.resolve('./dist/roles/evaluator');
  return path.join(path.dirname(selfResolved), '..', 'prompts');
}

async function loadPrompt(name: string): Promise<string> {
  return fs.readFile(path.join(resolvePromptsDir(), name), 'utf8');
}

export interface EvaluatorArgs {
  runId: string;
  targetRepo: string;
  transcriptPath: string;
  runDirAbs: string;
  sprintDirAbs: string;
  planMdAbs: string;
}

export async function buildEvaluatorInput(args: EvaluatorArgs): Promise<RunSessionInput> {
  const systemPrompt = await loadPrompt('evaluator.md');
  const contractAbs = path.join(args.sprintDirAbs, 'contract.md');
  const outputAbs = path.join(args.sprintDirAbs, 'output.md');
  const verdictAbs = path.join(args.sprintDirAbs, 'verdict.md');

  const prompt = [
    `Run ID: ${args.runId}`,
    `Target repository (READ-ONLY for you): ${args.targetRepo}`,
    `Your working directory is the target repository.`,
    `Plan: ${args.planMdAbs}`,
    `Sprint contract (the rubric and verification commands you must enforce): ${contractAbs}`,
    `Executor output to verify: ${outputAbs}`,
    `Write your verdict to: ${verdictAbs}`,
    ``,
    `Your verdict.md MUST start with "# Sprint NN — Verdict: PASS" or "Verdict: FAIL".`
  ].join('\n');

  return {
    prompt,
    systemPrompt,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Write'],
    cwd: args.targetRepo,
    maxTurns: 60,
    maxBudgetUsd: 5.0,
    transcriptPath: args.transcriptPath
  };
}
