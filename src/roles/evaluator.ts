import * as path from 'node:path';
import type { RunSessionInput } from '../sdk/session.js';
import { loadPrompt } from './prompts.js';

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
