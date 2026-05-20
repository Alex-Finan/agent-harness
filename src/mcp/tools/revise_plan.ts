import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RunDispatcher } from '../../server/dispatch.js';

export function registerRevisePlan(server: McpServer, dispatcher: RunDispatcher): void {
  server.tool(
    'harness_revise_plan',
    'Start a planner revision session with a feedback message. Non-blocking: returns immediately. Use harness_get_run to poll status. The planner will re-run and update plan.md based on the revision message.',
    {
      run_id: z.string().describe('The run ID'),
      message: z.string().describe('Revision instructions or feedback for the planner')
    },
    async ({ run_id, message }) => {
      if (dispatcher.isBusy(run_id)) {
        throw new Error(`run ${run_id} already has an in-flight role`);
      }
      const handle = await dispatcher.startPlanRevise(run_id, message);
      const result = {
        run_id,
        role: handle.role,
        startedAt: handle.startedAt,
        message: 'Plan revision started (non-blocking). Use harness_get_run to poll status.'
      };
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
