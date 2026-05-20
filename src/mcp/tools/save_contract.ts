import { z } from 'zod';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { writeAtomic, ensureDir } from '../../lib/fs.js';
import { sprintsDir } from '../../state/paths.js';

export function registerSaveContract(server: McpServer): void {
  server.tool(
    'harness_save_contract',
    'Write or overwrite contract.md for a specific sprint directory. The sprint parameter should be the sprint directory name (e.g. "01-my-slug").',
    {
      run_id: z.string().describe('The run ID'),
      sprint_dir: z
        .string()
        .regex(/^[a-z0-9_-]+$/i)
        .describe('Sprint directory name, e.g. "01-mcp-skeleton". Must be alphanumeric with hyphens/underscores only.'),
      contract_md: z.string().describe('Full markdown content to write to contract.md')
    },
    async ({ run_id, sprint_dir, contract_md }) => {
      const sprintPath = path.join(sprintsDir(run_id), sprint_dir);
      await ensureDir(sprintPath);
      const target = path.join(sprintPath, 'contract.md');
      await writeAtomic(target, contract_md);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ok: true }, null, 2)
          }
        ]
      };
    }
  );
}
