import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readOrNull } from '../../lib/fs.js';
import { planPath } from '../../state/paths.js';
import { parseSprintsFromPlan } from '../../state/artifacts.js';

export function registerGetPlan(server: McpServer): void {
  server.tool(
    'harness_get_plan',
    'Read the plan.md file for a run and parse its sprint headers. Returns plan_md (the markdown content) and sprints (an array of parsed sprint headers with num, slug, and title). Returns empty plan_md and empty sprints array if no plan exists yet.',
    {
      run_id: z.string().describe('The run ID')
    },
    async ({ run_id }) => {
      const plan_md = (await readOrNull(planPath(run_id))) ?? '';
      const sprints = plan_md ? parseSprintsFromPlan(plan_md) : [];
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ plan_md, sprints }, null, 2)
          }
        ]
      };
    }
  );
}
