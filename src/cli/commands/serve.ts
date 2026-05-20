import type { Command } from 'commander';
import { serve } from '../../server/index.js';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the local web UI (planner/executor progress, costs, prompt editing)')
    .option('--port <n>', 'Port to bind (default 8787)', (v) => parseInt(v, 10), 8787)
    .option('--host <host>', 'Host to bind (default 127.0.0.1)', '127.0.0.1')
    .option('--web-dist <path>', 'Override path to the built web bundle')
    .action(async (opts) => {
      await serve({
        port: opts.port,
        host: opts.host,
        webDist: opts.webDist
      });
      // Keep alive: the Fastify server holds the event loop.
      process.on('SIGINT', () => process.exit(0));
      process.on('SIGTERM', () => process.exit(0));
    });
}
