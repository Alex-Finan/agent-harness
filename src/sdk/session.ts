import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { writeAtomic, ensureDir } from '../lib/fs.js';

const _require = createRequire(import.meta.url);

export interface RunSessionInput {
  prompt: string;
  systemPrompt: string;
  allowedTools: string[];
  cwd: string;
  maxTurns: number;
  maxBudgetUsd: number;
  transcriptPath: string;
  model?: string;
  /** Override the path to the Claude Code executable. If omitted, resolved from the SDK's native-binary sibling package. */
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
 * Resolve the path to the Claude Code native binary that the SDK spawns.
 *
 * The SDK ships the binary in a platform-specific sibling package:
 *   @anthropic-ai/claude-agent-sdk-{platform}-{arch}/claude
 *
 * We resolve that package's manifest, then derive the binary path.
 * Falls back to the system `claude` on PATH if the sibling package is absent.
 */
function resolveCliPath(): string {
  const platform = process.platform;
  const arch = process.arch;
  const ext = platform === 'win32' ? '.exe' : '';
  const candidates = [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude${ext}`];
  if (platform === 'linux') {
    candidates.push(`@anthropic-ai/claude-agent-sdk-linux-${arch}-musl/claude`);
  }
  for (const c of candidates) {
    try {
      const resolved = _require.resolve(c);
      if (existsSync(resolved)) return resolved;
    } catch {
      // fall through
    }
  }
  // Fallback: system `claude` on PATH
  const systemClaude = `/usr/local/bin/claude`;
  if (existsSync(systemClaude)) return systemClaude;
  const homeClaude = path.join(process.env.HOME ?? '', '.local/bin/claude');
  if (existsSync(homeClaude)) return homeClaude;
  throw new Error(
    `Could not locate the Claude Code binary. Tried: ${candidates.join(', ')}, ${systemClaude}, ${homeClaude}. ` +
      `Pass cliPath in RunSessionInput to override.`
  );
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
      cwd: input.cwd,
      stderr: (chunk: string) => process.stderr.write(`[sdk-stderr] ${chunk}`)
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
