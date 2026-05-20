import type { Command } from 'commander';
import { startMcpServer } from '../../mcp/server.js';

export function registerMcp(program: Command): void {
  program
    .command('mcp')
    .description(
      'Start the MCP server (stdio transport). Exposes all harness operations as MCP tools for use with Claude Code and other MCP clients.'
    )
    .option('--log <file>', 'Redirect stderr/debug output to this file (keeps stdio clean)')
    .action(async (opts) => {
      await startMcpServer({ logFile: opts.log });
      // The MCP server holds the event loop via the stdio transport.
      process.on('SIGINT', () => process.exit(0));
      process.on('SIGTERM', () => process.exit(0));
    });
}
