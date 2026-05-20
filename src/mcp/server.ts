import * as fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { EventBus } from '../server/events.js';
import { RunDispatcher } from '../server/dispatch.js';
import { registerListRuns } from './tools/list_runs.js';
import { registerGetRun } from './tools/get_run.js';
import { registerGetPlan } from './tools/get_plan.js';
import { registerInit } from './tools/init.js';
import { registerDispatch } from './tools/dispatch.js';
import { registerSavePlan } from './tools/save_plan.js';
import { registerSaveContract } from './tools/save_contract.js';
import { registerRevisePlan } from './tools/revise_plan.js';
import { registerTailLogs } from './tools/tail_logs.js';
import { registerAbort } from './tools/abort.js';

export interface McpServerOptions {
  /** Path to write stderr/debug log. When omitted, stderr is left unchanged. */
  logFile?: string;
}

export async function startMcpServer(opts: McpServerOptions = {}): Promise<void> {
  // Optionally redirect stderr to a log file so stdio transport stays clean.
  if (opts.logFile) {
    const logStream = fs.createWriteStream(opts.logFile, { flags: 'a' });
    process.stderr.write = (
      chunk: Buffer | string,
      encoding?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void
    ): boolean => {
      if (typeof encoding === 'function') {
        logStream.write(chunk as Buffer | string, encoding);
      } else if (encoding !== undefined) {
        logStream.write(chunk, encoding, cb);
      } else {
        logStream.write(chunk, cb);
      }
      return true;
    };
  }

  const server = new McpServer({
    name: 'agent-harness',
    version: '0.1.0'
  });

  // EventBus has no subscribers in MCP context — publish() calls are no-ops.
  const bus = new EventBus();
  const dispatcher = new RunDispatcher(bus);

  // Register all 10 tools.
  registerListRuns(server);
  registerGetRun(server, dispatcher);
  registerGetPlan(server);
  registerInit(server, dispatcher);
  registerDispatch(server, dispatcher);
  registerSavePlan(server);
  registerSaveContract(server);
  registerRevisePlan(server, dispatcher);
  registerTailLogs(server);
  registerAbort(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
