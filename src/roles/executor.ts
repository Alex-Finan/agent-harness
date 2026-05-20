import * as path from 'node:path';
import type { RunSessionInput } from '../sdk/session.js';
import { loadPrompt } from './prompts.js';

export interface ExecutorArgs {
  runId: string;
  targetRepo: string;
  transcriptPath: string;
  runDirAbs: string;
  sprintDirAbs: string;
  planMdAbs: string;
  retryNotes: string | null;
}

export async function buildExecutorInput(args: ExecutorArgs): Promise<RunSessionInput> {
  const systemPrompt = await loadPrompt('executor.md');
  const contractAbs = path.join(args.sprintDirAbs, 'contract.md');
  const outputAbs = path.join(args.sprintDirAbs, 'output.md');

  const lines = [
    `Run ID: ${args.runId}`,
    `Your working directory is the target repository: ${args.targetRepo}`,
    `Plan (read-only reference): ${args.planMdAbs}`,
    `Sprint contract: ${contractAbs}`,
    `Write your output summary to: ${outputAbs}`
  ];

  if (args.retryNotes) {
    lines.push('');
    lines.push('THIS IS A RETRY. The evaluator gave fix-it-back notes:');
    lines.push('---');
    lines.push(args.retryNotes);
    lines.push('---');
    lines.push('Read sprints/.../verdict.md for the full prior verdict. Address every item.');
  }

  return {
    prompt: lines.join('\n'),
    systemPrompt,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'NotebookEdit'],
    cwd: args.targetRepo,
    maxTurns: 120,
    maxBudgetUsd: 10.0,
    transcriptPath: args.transcriptPath
  };
}
