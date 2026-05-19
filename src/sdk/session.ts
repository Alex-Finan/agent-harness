import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { writeAtomic, ensureDir } from '../lib/fs.js';

export interface RunSessionInput {
  prompt: string;
  systemPrompt: string;
  allowedTools: string[];
  cwd: string;
  maxTurns: number;
  maxBudgetUsd: number;
  transcriptPath: string;
  model?: string;
  /** Override the path to the Claude Code executable. If omitted, resolved from the SDK package. */
  cliPath?: string;
}

export interface RunSessionResult {
  success: boolean;
  resultText?: string;
  failureSubtype?: string;
  totalCostUsd?: number;
  durationMs: number;
}

/**
 * Resolve the path to the SDK's bundled cli.js.
 * Anchors the require context to the project root (process.cwd()) so that
 * the SDK package is found regardless of this file's location.
 */
function resolveCliPath(): string {
  // Use dynamic require from cwd — works in both real runtime and jest mocked tests
  // (this function is never called when query() is mocked).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createRequire } = require('node:module') as typeof import('node:module');
  const req = createRequire(path.join(process.cwd(), 'package.json'));
  const sdkMain = req.resolve('@anthropic-ai/claude-agent-sdk');
  return path.join(path.dirname(sdkMain), 'cli.js');
}

export async function runSession(input: RunSessionInput): Promise<RunSessionResult> {
  const start = Date.now();
  await ensureDir(path.dirname(input.transcriptPath));
  await writeAtomic(input.transcriptPath, '');

  const cliPath = input.cliPath ?? resolveCliPath();

  let result: RunSessionResult = { success: false, durationMs: 0 };

  for await (const message of query({
    prompt: input.prompt,
    options: {
      pathToClaudeCodeExecutable: cliPath,
      systemPrompt: input.systemPrompt,
      model: input.model ?? 'claude-sonnet-4-6',
      maxTurns: input.maxTurns,
      maxBudgetUsd: input.maxBudgetUsd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      allowedTools: input.allowedTools,
      cwd: input.cwd
    }
  })) {
    await fs.appendFile(input.transcriptPath, JSON.stringify(message) + '\n', 'utf8');

    const m = message as {
      type: string;
      subtype?: string;
      result?: unknown;
      total_cost_usd?: number;
    };

    if (m.type === 'result') {
      const durationMs = Date.now() - start;
      if (m.subtype === 'success') {
        result = {
          success: true,
          resultText: typeof m.result === 'string' ? m.result : JSON.stringify(m.result),
          totalCostUsd: m.total_cost_usd,
          durationMs
        };
      } else {
        result = {
          success: false,
          failureSubtype: m.subtype,
          totalCostUsd: m.total_cost_usd,
          durationMs
        };
      }
    }
  }

  return result;
}
