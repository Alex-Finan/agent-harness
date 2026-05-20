import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../lib/fs.js';

const PROMPTS_DIR = fileURLToPath(new URL('../prompts', import.meta.url));

export type PromptName = 'planner' | 'executor' | 'evaluator';

const VALID: PromptName[] = ['planner', 'executor', 'evaluator'];

export function isPromptName(s: string): s is PromptName {
  return (VALID as string[]).includes(s);
}

function promptFile(name: PromptName): string {
  return path.join(PROMPTS_DIR, `${name}.md`);
}

export async function readPrompt(name: PromptName): Promise<string> {
  return fs.readFile(promptFile(name), 'utf8');
}

export async function readAllPrompts(): Promise<Record<PromptName, string>> {
  const result = {} as Record<PromptName, string>;
  for (const n of VALID) {
    result[n] = await readPrompt(n);
  }
  return result;
}

export async function writePrompt(name: PromptName, content: string): Promise<void> {
  await writeAtomic(promptFile(name), content);
}

export function promptsDir(): string {
  return PROMPTS_DIR;
}
