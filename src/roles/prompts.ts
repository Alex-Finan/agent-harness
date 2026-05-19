import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPTS_DIR = fileURLToPath(new URL('../prompts', import.meta.url));

export async function loadPrompt(name: string): Promise<string> {
  return fs.readFile(path.join(PROMPTS_DIR, name), 'utf8');
}
