import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { jest } from '@jest/globals';

// Mock runSession BEFORE any dynamic imports that pull it in transitively.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRunSession = jest.fn<(...args: any[]) => Promise<{ success: boolean; durationMs: number }>>();
jest.unstable_mockModule('../../src/sdk/session.js', () => ({
  runSession: mockRunSession
}));

// All imports must come AFTER unstable_mockModule so the mock is in place.
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { EventBus } = await import('../../src/server/events.js');
const { RunDispatcher } = await import('../../src/server/dispatch.js');
const { handleInit } = await import('../../src/cli/commands/init.js');
const { loadRun } = await import('../../src/state/run.js');

// MCP tool registrars
const { registerListRuns } = await import('../../src/mcp/tools/list_runs.js');
const { registerGetRun } = await import('../../src/mcp/tools/get_run.js');
const { registerGetPlan } = await import('../../src/mcp/tools/get_plan.js');
const { registerInit: registerMcpInit } = await import('../../src/mcp/tools/init.js');
const { registerDispatch } = await import('../../src/mcp/tools/dispatch.js');
const { registerSavePlan } = await import('../../src/mcp/tools/save_plan.js');
const { registerSaveContract } = await import('../../src/mcp/tools/save_contract.js');
const { registerRevisePlan } = await import('../../src/mcp/tools/revise_plan.js');
const { registerTailLogs } = await import('../../src/mcp/tools/tail_logs.js');
const { registerAbort } = await import('../../src/mcp/tools/abort.js');

// ── Types ────────────────────────────────────────────────────────────────────

type McpContent = { type: string; text?: string };
type CallToolResult = { isError?: boolean; content: McpContent[] };

/** Parse the JSON text payload from a tool result's first text content item. */
function parseResult(result: CallToolResult): Record<string, unknown> {
  const item = result.content.find((c) => c.type === 'text' && c.text !== undefined);
  if (!item?.text) throw new Error('No text content in result');
  return JSON.parse(item.text) as Record<string, unknown>;
}

// ── Server/client builder ────────────────────────────────────────────────────

type TestRig = {
  client: InstanceType<typeof Client>;
  mcpServer: InstanceType<typeof McpServer>;
  dispatcher: InstanceType<typeof RunDispatcher>;
};

async function buildTestRig(): Promise<TestRig> {
  const bus = new EventBus();
  const dispatcher = new RunDispatcher(bus);
  const mcpServer = new McpServer({ name: 'test-harness', version: '0.1.0' });

  registerListRuns(mcpServer);
  registerGetRun(mcpServer, dispatcher);
  registerGetPlan(mcpServer);
  registerMcpInit(mcpServer, dispatcher);
  registerDispatch(mcpServer, dispatcher);
  registerSavePlan(mcpServer);
  registerSaveContract(mcpServer);
  registerRevisePlan(mcpServer, dispatcher);
  registerTailLogs(mcpServer);
  registerAbort(mcpServer);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0' }, { capabilities: {} });

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, mcpServer, dispatcher };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('MCP tool handlers', () => {
  let tmp: string;
  let client: InstanceType<typeof Client>;
  let mcpServer: InstanceType<typeof McpServer>;
  let dispatcher: InstanceType<typeof RunDispatcher>;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-mcp-'));
    process.env.AGENT_HARNESS_HOME = tmp;
    ({ client, mcpServer, dispatcher } = await buildTestRig());
  });

  afterEach(async () => {
    await client.close();
    await mcpServer.close();
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
    mockRunSession.mockReset();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // State-mutating tools
  // ─────────────────────────────────────────────────────────────────────────

  describe('harness_init', () => {
    test('creates state.json on disk and returns matching run_id', async () => {
      const result = (await client.callTool({
        name: 'harness_init',
        arguments: { repo: tmp, task_md: 'Add a dark mode toggle', max_retries: 3 }
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result);
      const runId = parsed.runId as string;
      expect(runId).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}$/);

      // FILESYSTEM SIDE-EFFECT: state.json must exist with correct run_id
      const stateRaw = await fs.readFile(
        path.join(tmp, 'runs', runId, 'state.json'),
        'utf8'
      );
      const state = JSON.parse(stateRaw) as { run_id: string; status: string };
      expect(state.run_id).toBe(runId);
      expect(state.status).toBe('in_progress');
    });
  });

  describe('harness_dispatch', () => {
    test('planner role: returns handle info, calls runSession, advances state.json', async () => {
      const { runId } = await handleInit({ repo: tmp, task: 'test task', maxRetries: 3 });

      // Mock: write plan.md (required by handlePlan post-session check) then return success.
      mockRunSession.mockImplementationOnce(async (input: unknown) => {
        const { cwd } = input as { cwd: string };
        await fs.writeFile(path.join(cwd, 'plan.md'), '# Plan\n## Sprint 1: Alpha\n');
        return { success: true, durationMs: 1 };
      });

      const result = (await client.callTool({
        name: 'harness_dispatch',
        arguments: { run_id: runId, role: 'planner' }
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result);
      expect(parsed.run_id).toBe(runId);
      expect(parsed.role).toBe('planner');
      expect(typeof parsed.startedAt).toBe('string');

      // Handle must exist immediately after the non-blocking dispatch returns.
      const handle = dispatcher.current(runId);
      expect(handle).not.toBeNull();

      // Wait for the background session to complete.
      await handle!.promise;

      // runSession mock was invoked.
      expect(mockRunSession).toHaveBeenCalledTimes(1);

      // FILESYSTEM SIDE-EFFECT: state.json must reflect planner → executor advance.
      const run = await loadRun(runId);
      expect(run.state.next_role).toBe('executor');
      expect(run.state.current_sprint).toBe(1);
    });

    test('returns isError when run is already busy', async () => {
      // Directly inject a fake in-flight handle so there are no background tasks
      // or real file I/O — avoids timing races with afterEach cleanup.
      const fakeRunId = 'fake-run-busy-test';
      const fakeHandle = {
        runId: fakeRunId,
        role: 'planner' as const,
        startedAt: new Date().toISOString(),
        promise: new Promise<void>(() => {
          /* never resolves */
        }),
        finished: false
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dispatcher as any).inflight.set(fakeRunId, fakeHandle);

      const result = (await client.callTool({
        name: 'harness_dispatch',
        arguments: { run_id: fakeRunId, role: 'planner' }
      })) as CallToolResult;

      expect(result.isError).toBe(true);
    });
  });

  describe('harness_save_plan', () => {
    test('writes plan.md to disk and updates total_sprints in state.json', async () => {
      const { runId } = await handleInit({ repo: tmp, task: 'test', maxRetries: 3 });
      const planContent = '# Plan\n## Sprint 1: Alpha\n## Sprint 2: Bravo\n';

      const result = (await client.callTool({
        name: 'harness_save_plan',
        arguments: { run_id: runId, plan_md: planContent }
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(true);
      expect(parsed.sprints).toBe(2);

      // FILESYSTEM SIDE-EFFECT: plan.md must exist with exact content.
      const onDisk = await fs.readFile(path.join(tmp, 'runs', runId, 'plan.md'), 'utf8');
      expect(onDisk).toBe(planContent);

      // FILESYSTEM SIDE-EFFECT: state.json must have total_sprints updated.
      const run = await loadRun(runId);
      expect(run.state.total_sprints).toBe(2);
    });
  });

  describe('harness_save_contract', () => {
    test('writes contract.md under sprints/<sprint_dir>/ on disk', async () => {
      const { runId } = await handleInit({ repo: tmp, task: 'test', maxRetries: 3 });
      const sprintDir = '01-alpha';
      const contractContent = '# Sprint 1\n## Rubric\n1. always pass\n';

      const result = (await client.callTool({
        name: 'harness_save_contract',
        arguments: { run_id: runId, sprint_dir: sprintDir, contract_md: contractContent }
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(true);

      // FILESYSTEM SIDE-EFFECT: contract.md must exist with exact content.
      const contractPath = path.join(tmp, 'runs', runId, 'sprints', sprintDir, 'contract.md');
      const onDisk = await fs.readFile(contractPath, 'utf8');
      expect(onDisk).toBe(contractContent);
    });

    test('rejects sprint_dir containing path-traversal characters', async () => {
      const { runId } = await handleInit({ repo: tmp, task: 'test', maxRetries: 3 });

      const result = (await client.callTool({
        name: 'harness_save_contract',
        arguments: { run_id: runId, sprint_dir: '../bad', contract_md: 'x' }
      })) as CallToolResult;

      // Zod regex validation failure → isError: true
      expect(result.isError).toBe(true);
    });
  });

  describe('harness_abort', () => {
    test('sets state.status to "aborted" in state.json', async () => {
      const { runId } = await handleInit({ repo: tmp, task: 'test', maxRetries: 3 });

      const result = (await client.callTool({
        name: 'harness_abort',
        arguments: { run_id: runId }
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(true);
      expect(parsed.run_id).toBe(runId);

      // FILESYSTEM SIDE-EFFECT: re-load state.json and check status.
      const run = await loadRun(runId);
      expect(run.state.status).toBe('aborted');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Read-only tools — shared integration test seeding a single run
  // ─────────────────────────────────────────────────────────────────────────

  describe('read-only tools (seeded run)', () => {
    let runId: string;

    beforeEach(async () => {
      ({ runId } = await handleInit({ repo: tmp, task: 'integration test task', maxRetries: 3 }));
    });

    test('harness_list_runs returns array containing the seeded run', async () => {
      const result = (await client.callTool({
        name: 'harness_list_runs',
        arguments: {}
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result);
      const runs = parsed.runs as Array<{ run_id: string }>;
      expect(Array.isArray(runs)).toBe(true);
      expect(runs.some((r) => r.run_id === runId)).toBe(true);
    });

    test('harness_get_run returns state, snapshot, cost, and dispatching', async () => {
      const result = (await client.callTool({
        name: 'harness_get_run',
        arguments: { run_id: runId }
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result);

      // state
      const state = parsed.state as { run_id: string; status: string };
      expect(state.run_id).toBe(runId);
      expect(state.status).toBe('in_progress');

      // snapshot
      const snapshot = parsed.snapshot as { taskMd: string | null };
      expect(snapshot).toBeDefined();
      expect(typeof snapshot.taskMd).toBe('string');

      // cost (added in get_run.ts)
      const cost = parsed.cost as { totalUsd: number };
      expect(cost).toBeDefined();
      expect(cost.totalUsd).toBe(0); // fresh run, no logs

      // dispatching
      expect(parsed.dispatching).toBeNull();
    });

    test('harness_get_plan returns empty plan_md and sprints for fresh run', async () => {
      const result = (await client.callTool({
        name: 'harness_get_plan',
        arguments: { run_id: runId }
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result);
      // Fresh run: no plan written yet → empty string (readOrNull ?? '')
      expect(parsed.plan_md).toBe('');
      expect(Array.isArray(parsed.sprints)).toBe(true);
      expect((parsed.sprints as unknown[]).length).toBe(0);
    });

    test('harness_tail_logs returns empty lines for fresh run with no logs', async () => {
      const result = (await client.callTool({
        name: 'harness_tail_logs',
        arguments: { run_id: runId }
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result);
      expect(Array.isArray(parsed.lines)).toBe(true);
      expect(parsed.next_line).toBe(0);
      // No log files in fresh run → log_name is null
      expect(parsed.log_name).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Additional error cases
  // ─────────────────────────────────────────────────────────────────────────

  describe('error handling', () => {
    test('harness_get_run returns isError for non-existent run_id', async () => {
      const result = (await client.callTool({
        name: 'harness_get_run',
        arguments: { run_id: 'nonexistent-run-id-xyz' }
      })) as CallToolResult;

      expect(result.isError).toBe(true);
    });
  });
});
