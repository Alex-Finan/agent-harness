import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleList } from '../../cli/commands/list.js';
import { StatusEnum } from '../../state/schema.js';

export function registerListRuns(server: McpServer): void {
  server.tool(
    'harness_list_runs',
    'List all harness runs sorted by creation time (newest first). Optionally filter by status. Returns run_id, status, next_role, sprint progress, task summary, and timestamps.',
    {
      status: StatusEnum.optional().describe(
        'Filter runs by status: "in_progress", "halted", "completed", or "aborted". Omit to list all runs.'
      )
    },
    async ({ status }) => {
      const { runs } = await handleList();
      const filtered = status ? runs.filter((r) => r.status === status) : runs;
      const summaries = filtered.map((r) => ({
        run_id: r.run_id,
        status: r.status,
        next_role: r.next_role,
        current_sprint: r.current_sprint,
        total_sprints: r.total_sprints,
        task_summary: r.task_summary,
        created_at: r.created_at,
        updated_at: r.updated_at
      }));
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ runs: summaries }, null, 2)
          }
        ]
      };
    }
  );
}
