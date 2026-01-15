#!/usr/bin/env node

import { TsRefactorServer } from './mcp-server/index.js';

/**
 * Main entry point for ts-refactor-mcp server
 */
async function main() {
  const server = new TsRefactorServer();
  await server.run();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
