import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { writeAtomic } from '../../lib/fs.js';
import { planPath } from '../../state/paths.js';
import { loadRun, saveState } from '../../state/run.js';
import { parseSprintsFromPlan } from '../../state/artifacts.js';

export function registerSavePlan(server: McpServer): void {
  server.tool(
    'harness_save_plan',
    'Write or overwrite plan.md for a run. Also updates total_sprints in state to match the sprint headers found in the markdown.',
    {
      run_id: z.string().describe('The run ID'),
      plan_md: z.string().describe('Full markdown content to write to plan.md')
    },
    async ({ run_id, plan_md }) => {
      await writeAtomic(planPath(run_id), plan_md);
      const sprints = parseSprintsFromPlan(plan_md);
      // Update total_sprints if state is still in early stages.
      try {
        const run = await loadRun(run_id);
        if (
          run.state.next_role === 'planner' ||
          (run.state.next_role === 'executor' && run.state.current_sprint <= 1)
        ) {
          await saveState({
            ...run.state,
            total_sprints: sprints.length,
            updated_at: new Date().toISOString()
          });
        }
      } catch {
        /* run may not exist or state update is optional */
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ok: true, sprints: sprints.length }, null, 2)
          }
        ]
      };
    }
  );
}
