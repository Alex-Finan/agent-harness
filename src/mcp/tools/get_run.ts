import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadRun } from '../../state/run.js';
import { readRunSnapshot } from '../../server/readers.js';
import { computeRunCost } from '../../server/cost.js';
import type { RunDispatcher } from '../../server/dispatch.js';

export function registerGetRun(server: McpServer, dispatcher: RunDispatcher): void {
  server.tool(
    'harness_get_run',
    'Get the full state and snapshot (plan, sprints, logs) for a specific run by ID.',
    {
      run_id: z.string().describe('The run ID (e.g. 2025-01-15-120000-abc123)')
    },
    async ({ run_id }) => {
      const run = await loadRun(run_id);
      const snapshot = await readRunSnapshot(run_id);
      const cost = await computeRunCost(run_id);
      const dispatching = dispatcher.current(run_id);
      const result = {
        state: run.state,
        snapshot,
        cost,
        dispatching: dispatching
          ? {
              role: dispatching.role,
              startedAt: dispatching.startedAt,
              finished: dispatching.finished,
              error: dispatching.error
            }
          : null
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
