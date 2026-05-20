import * as path from 'node:path';
import type { RunSessionInput } from '../sdk/session.js';
import { loadPrompt } from './prompts.js';

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
