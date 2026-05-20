import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleAbort } from '../../cli/commands/abort.js';

export function registerAbort(server: McpServer): void {
  server.tool(
    'harness_abort',
    'Mark a run as aborted, stopping any further role dispatches. Optionally purge the git worktree if the run used one.',
    {
      run_id: z.string().describe('The run ID to abort'),
      purge: z
        .boolean()
        .optional()
        .describe('If true, also remove the git worktree and delete its branch')
    },
    async ({ run_id, purge }) => {
      const result = await handleAbort({ runId: run_id, purge: purge ?? false });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ok: true,
                run_id,
                purged: result.purged
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
