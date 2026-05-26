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
    `Write overview.md, plan.md, and sprints/NN-<slug>/contract.md files here.`,
    `overview.md is the authoritative narrative; plan.md is the execution detail; contracts are per-sprint rubrics.`,
    `If the task is too big for a single PR, ALSO write stack.json describing the recommended PR stack (see system prompt for the exact schema). Otherwise omit stack.json.`
  ];
  const prompt = args.revisionMessage
    ? [
        ...baseLines,
        ``,
        `An existing overview.md and plan.md are present in your working directory.`,
        `The operator has sent you a message. FIRST decide what kind of message it is:`,
        ``,
        `  - QUESTION / clarification / "does this work" / "is X correct" / "what about Y":`,
        `      write your reply to ./planner-reply.md and DO NOT edit overview.md or plan.md.`,
        `      The UI surfaces planner-reply.md as your conversational answer.`,
        ``,
        `  - EDIT REQUEST (e.g. "add a sprint", "combine 2 and 3", "drop the migration"):`,
        `      edit overview.md and/or plan.md (and any sprints/NN-<slug>/contract.md files`,
        `      that must stay consistent). Remember: overview.md is authoritative — if the`,
        `      revision changes the goal or approach, edit overview first and bring plan.md`,
        `      in line. Keep sprint numbering contiguous. Optionally also write a short`,
        `      planner-reply.md summarising what you changed.`,
        ``,
        `  - MIXED: do both, but only edit what is necessary, and use planner-reply.md to`,
        `      answer the question parts.`,
        ``,
        `Default to "reply, don't edit" when in doubt. Unnecessary edits churn the plan.`,
        `Do not start from scratch unless the request demands it.`,
        ``,
        `Operator message:`,
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
