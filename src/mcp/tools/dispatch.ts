import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RunDispatcher } from '../../server/dispatch.js';

export function registerDispatch(server: McpServer, dispatcher: RunDispatcher): void {
  server.tool(
    'harness_dispatch',
    'Dispatch a role session for a run. Use role="planner" to run the planner, role="next" to run the next executor/evaluator step, or role="auto" to auto-iterate until completion. Non-blocking: returns immediately and the session runs in the background. Poll with harness_get_run to check progress.',
    {
      run_id: z.string().describe('The run ID'),
      role: z
        .enum(['planner', 'next', 'auto'])
        .describe(
          '"planner" runs the planner role, "next" runs the next executor/evaluator step, "auto" iterates until the run completes'
        )
    },
    async ({ run_id, role }) => {
      if (dispatcher.isBusy(run_id)) {
        throw new Error(`run ${run_id} already has an in-flight role`);
      }
      let handle;
      if (role === 'planner') {
        handle = await dispatcher.startPlan(run_id);
      } else if (role === 'next') {
        handle = await dispatcher.startNext(run_id);
      } else {
        handle = await dispatcher.startAutoIterate(run_id);
      }
      const result = {
        run_id,
        role: handle.role,
        startedAt: handle.startedAt,
        message: `${role} session started (non-blocking). Use harness_get_run to poll status.`
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
