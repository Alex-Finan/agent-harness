import { buildPlannerInput } from '../../src/roles/planner.js';
import { buildExecutorInput } from '../../src/roles/executor.js';
import { buildEvaluatorInput } from '../../src/roles/evaluator.js';

describe('role builders', () => {
  const baseArgs = {
    runId: 'run-1',
    targetRepo: '/target',
    transcriptPath: '/h/t.log',
    runDirAbs: '/h/runs/run-1'
  };

  test('planner uses read-only tool set and run dir as cwd', async () => {
    const input = await buildPlannerInput({
      ...baseArgs,
      taskMdAbs: '/h/runs/run-1/task.md'
    });
    expect(input.allowedTools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep']));
    expect(input.allowedTools).not.toContain('Edit');
    expect(input.cwd).toBe('/h/runs/run-1');
    expect(input.prompt).toContain('/target');
    expect(input.prompt).toContain('/h/runs/run-1/task.md');
  });

  test('executor uses full tools and target repo as cwd', async () => {
    const input = await buildExecutorInput({
      ...baseArgs,
      sprintDirAbs: '/h/runs/run-1/sprints/01-foo',
      planMdAbs: '/h/runs/run-1/plan.md',
      retryNotes: null
    });
    expect(input.allowedTools).toEqual(expect.arrayContaining(['Read', 'Edit', 'Write', 'Bash']));
    expect(input.cwd).toBe('/target');
    expect(input.prompt).toContain('/h/runs/run-1/sprints/01-foo/contract.md');
  });

  test('executor retry includes prior verdict notes', async () => {
    const input = await buildExecutorInput({
      ...baseArgs,
      sprintDirAbs: '/h/runs/run-1/sprints/01-foo',
      planMdAbs: '/h/runs/run-1/plan.md',
      retryNotes: 'fix the foo'
    });
    expect(input.prompt).toContain('fix the foo');
    expect(input.prompt.toLowerCase()).toContain('retry');
  });

  test('evaluator gets read+bash but not edit tools', async () => {
    const input = await buildEvaluatorInput({
      ...baseArgs,
      sprintDirAbs: '/h/runs/run-1/sprints/01-foo',
      planMdAbs: '/h/runs/run-1/plan.md'
    });
    expect(input.allowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Bash']));
    expect(input.allowedTools).not.toContain('Edit');
    expect(input.cwd).toBe('/target');
  });
});
