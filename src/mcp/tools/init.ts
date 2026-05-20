import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RunDispatcher } from '../../server/dispatch.js';

export function registerInit(server: McpServer, dispatcher: RunDispatcher): void {
  server.tool(
    'harness_init',
    'Create a new harness run. Provide a target repository path and task description (markdown). Returns the new run_id and optional worktree_path and branch when using worktree mode.',
    {
      repo: z.string().describe('Absolute path to the target repository'),
      task_md: z.string().describe('Task description in markdown format'),
      max_retries: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum retries per sprint (default: 3)'),
      base: z
        .string()
        .optional()
        .describe('Base branch to stack on — enables worktree mode'),
      branch: z
        .string()
        .optional()
        .describe('Branch name for the worktree (default: harness/<run_id>)')
    },
    async ({ repo, task_md, max_retries, base, branch }) => {
      const result = await dispatcher.createRun({
        repo,
        task: task_md,
        maxRetries: max_retries ?? 3,
        base,
        branch
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );
}
