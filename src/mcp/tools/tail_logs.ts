import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logsDir } from '../../state/paths.js';

export function registerTailLogs(server: McpServer): void {
  server.tool(
    'harness_tail_logs',
    'Read lines from a log file for a run. If log_name is omitted, the lexicographically last .log file is used. Use since_line to paginate: the tool returns lines starting at that offset and reports next_line for the next call.',
    {
      run_id: z.string().describe('The run ID'),
      log_name: z
        .string()
        .optional()
        .describe('Log file name (e.g. "executor-s1-r0.log"). Omit to use the latest log file.'),
      since_line: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Return lines starting from this 0-based offset (default: 0)')
    },
    async ({ run_id, log_name, since_line }) => {
      const dir = logsDir(run_id);
      let files: string[];
      try {
        files = (await fs.readdir(dir)).filter((f) => f.endsWith('.log')).sort();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          files = [];
        } else {
          throw err;
        }
      }
      const chosen = log_name ?? (files.length > 0 ? files[files.length - 1] : null);
      if (!chosen) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ lines: [], next_line: 0, log_name: null }, null, 2)
            }
          ]
        };
      }
      const filePath = path.join(dir, chosen);
      const raw = await fs.readFile(filePath, 'utf8').catch(() => '');
      const allLines = raw.split('\n');
      const offset = since_line ?? 0;
      const sliced = allLines.slice(offset);
      const next_line = offset + sliced.length;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ lines: sliced, next_line, log_name: chosen }, null, 2)
          }
        ]
      };
    }
  );
}
