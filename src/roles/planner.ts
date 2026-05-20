import * as path from 'node:path';
import type { RunSessionInput } from '../sdk/session.js';
import { loadPrompt } from './prompts.js';

export interface PlannerArgs {
  runId: string;
  targetRepo: string;
  transcriptPath: string;
  runDirAbs: string;
  taskMdAbs: string;
  /**
   * Optional operator revision request. When set, the planner is being
   * re-invoked against an existing plan.md and should *revise* it according
   * to the message rather than starting from scratch.
   */
  revisionMessage?: string;
}

export async function buildPlannerInput(args: PlannerArgs): Promise<RunSessionInput> {
  const systemPrompt = await loadPrompt('planner.md');
  const baseLines = [
    `Run ID: ${args.runId}`,
    `Target repository (READ-ONLY for you): ${args.targetRepo}`,
    `Task description: ${args.taskMdAbs}`,
    ``,
    `Your working directory is the run directory: ${args.runDirAbs}`,
    `Write plan.md and sprints/NN-<slug>/contract.md files here.`
  ];
  const prompt = args.revisionMessage
    ? [
        ...baseLines,
        ``,
        `An existing plan.md is already present in your working directory.`,
        `The operator has requested the following revisions — apply them by`,
        `editing plan.md (and any sprints/NN-<slug>/contract.md files that`,
        `must change to stay consistent). Do not start from scratch unless`,
        `the request demands it. Keep sprint numbering contiguous.`,
        ``,
        `Operator revision request:`,
        args.revisionMessage
      ].join('\n')
    : [
        ...baseLines,
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
