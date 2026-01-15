# ts-refactor-mcp

TypeScript-aware file refactoring for AI agents via the Model Context Protocol (MCP).

## What is this?

An MCP server that enables AI coding agents to move TypeScript files while automatically updating all imports. When you move a file in VS Code, TypeScript's language server updates every import automatically. This tool exposes that same capability to AI agents through MCP.

**The problem it solves:** AI agents can move files, but they break imports. They either miss updates or waste tokens fixing them manually. This server does it correctly in one atomic operation.

## Installation

```bash
npm install ts-refactor-mcp
```

Or install from source:

```bash
git clone https://github.com/schicks/ts-refactor-mcp.git
cd ts-refactor-mcp
npm install
npm run build
```

## MCP Configuration

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "ts-refactor": {
      "command": "npx",
      "args": ["ts-refactor-mcp"]
    }
  }
}
```

Or use the built package:

```json
{
  "mcpServers": {
    "ts-refactor": {
      "command": "node",
      "args": ["/path/to/ts-refactor-mcp/dist/index.js"]
    }
  }
}
```

## Available Tools

### `moveFile`

Move a TypeScript file and update all imports automatically.

**Input:**
```typescript
{
  projectRoot: string;  // Path to project root (where tsconfig.json is)
  oldPath: string;      // Current file path
  newPath: string;      // New file path
  dryRun?: boolean;     // If true, preview changes without applying
}
```

**Output (when applied):**
```typescript
{
  applied: true;
  filesModified: number;
  moved: { from: string; to: string };
  durationMs: number;
}
```

**Output (dry-run):**
```typescript
{
  applied: false;
  edits: Array<{
    filePath: string;
    textEdits: Array<{
      start: { line: number; offset: number };
      end: { line: number; offset: number };
      newText: string;
    }>;
  }>;
  wouldMove: { from: string; to: string };
  filesModified: number;
}
```

**Example:**
```typescript
// Move a file and update all imports
{
  "projectRoot": "/home/user/my-project",
  "oldPath": "/home/user/my-project/src/utils/helper.ts",
  "newPath": "/home/user/my-project/src/lib/helper.ts",
  "dryRun": false
}

// Preview changes first
{
  "projectRoot": "/home/user/my-project",
  "oldPath": "/home/user/my-project/src/utils/helper.ts",
  "newPath": "/home/user/my-project/src/lib/helper.ts",
  "dryRun": true
}
```

### `warmup`

Pre-load a TypeScript project to speed up subsequent operations.

**Input:**
```typescript
{
  projectRoot: string;  // Path to project root (where tsconfig.json is)
}
```

**Output:**
```typescript
{
  status: 'ready';
  durationMs: number;
}
```

**Why use this:** First operation on a project takes 5-30 seconds while TypeScript loads. Call `warmup` at session start to pay this cost upfront. Subsequent operations complete in 10-100ms.

## How it Works

1. **Persistent tsserver**: Keeps TypeScript's language server running between requests
2. **Atomic operations**: All import updates succeed or none do—no partial failures
3. **Uses project's TypeScript**: Spawns tsserver from your `node_modules/typescript`
4. **Battle-tested**: Uses the same `getEditsForFileRename` API that VS Code uses

```
Agent calls moveFile
    ↓
MCP Server
    ↓
tsserver.getEditsForFileRename() ← Same API VS Code uses
    ↓
Apply all edits atomically
    ↓
Move the file
    ↓
Return success
```

## Performance

- **Initial warmup**: 5-30 seconds (large projects)
- **Subsequent moves**: 10-100ms
- **Memory**: Persistent tsserver process (~100-500MB depending on project size)

## Requirements

- Node.js >= 18.0.0
- TypeScript project with `tsconfig.json`
- TypeScript installed in project's `node_modules`

## Development

### Setup

```bash
git clone https://github.com/schicks/ts-refactor-mcp.git
cd ts-refactor-mcp
npm install
```

### Run Tests

```bash
npm test                 # Run all tests
npm run test:watch      # Watch mode
```

### Build

```bash
npm run build           # Compile TypeScript
npm run watch           # Watch mode
```

### Project Structure

```
src/
├── tsserver-client/    # Wrapper around tsserver process
├── edit-applier/       # Applies text edits to filesystem
├── mcp-server/         # MCP protocol implementation
└── types/              # Shared TypeScript types

__tests__/
├── tsserver-client/    # Unit tests for tsserver wrapper
├── edit-applier/       # Unit tests for edit applier
├── mcp-server/         # Integration tests for MCP server
├── acceptance.test.ts  # End-to-end acceptance test
└── fixtures/           # Test fixtures
```

## Architecture Decisions

### Persistent tsserver Process

We keep tsserver running between requests. First request pays startup cost (5-30s), subsequent requests are fast (10-100ms). Without persistence, every move would reload the entire project.

### Atomic Operations

All edits and the file move happen atomically. Either everything succeeds or nothing changes. This prevents broken intermediate states.

### Project's Own TypeScript

We use the TypeScript version from your project's `node_modules`, not a global install. This ensures refactoring behavior matches your project's TypeScript version.

### No State Management

When files change outside our server, we don't track it. If tsserver gets out of sync, call `warmup` again. Trying to maintain perfect sync is complex and unnecessary—tsserver handles file watching internally.

## Limitations

- **TypeScript only**: Requires `tsconfig.json` (JavaScript-only projects not supported)
- **One project at a time**: One tsserver per tsconfig
- **No directory moves**: Currently only supports single file moves
- **Cold starts**: MCP server restart requires project warmup again

## Future Enhancements

Potential future additions (not currently implemented):

- `moveDirectory`: Move entire directories with all files
- `renameSymbol`: Rename a function/class across files
- `extractToFile`: Move a function to a new file
- Multi-root workspace support
- JavaScript-only project support

## Contributing

Pull requests welcome! Please:

1. Add tests for new functionality
2. Ensure all tests pass (`npm test`)
3. Follow existing code style
4. Update documentation

## License

MIT

## Credits

Built using:
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) - MCP protocol implementation
- TypeScript's tsserver - Language service API
