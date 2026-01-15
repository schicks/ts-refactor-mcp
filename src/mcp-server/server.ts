import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { TsServerClient } from '../tsserver-client/index.js';
import { applyEditsAndMoveFile } from '../edit-applier/index.js';
import type {
  MoveFileResult,
  DryRunResult,
  WarmupResult,
} from '../types/index.js';

/**
 * MCP Server for TypeScript-aware file refactoring
 */
export class TsRefactorServer {
  private server: Server;
  private clients = new Map<string, TsServerClient>();

  constructor() {
    this.server = new Server(
      {
        name: 'ts-refactor-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * Get or create a TsServerClient for a project
   */
  private async getClient(projectRoot: string): Promise<TsServerClient> {
    let client = this.clients.get(projectRoot);

    if (!client) {
      client = new TsServerClient(projectRoot);
      await client.start();
      this.clients.set(projectRoot, client);
    }

    return client;
  }

  /**
   * Set up MCP protocol handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: 'moveFile',
          description:
            'Move a TypeScript file and update all imports automatically. Applies edits atomically.',
          inputSchema: {
            type: 'object',
            properties: {
              projectRoot: {
                type: 'string',
                description: 'Absolute path to the project root (where tsconfig.json is)',
              },
              oldPath: {
                type: 'string',
                description: 'Absolute path to the file to move',
              },
              newPath: {
                type: 'string',
                description: 'Absolute path to the new location',
              },
              dryRun: {
                type: 'boolean',
                description: 'If true, return the edit plan without applying changes',
                default: false,
              },
            },
            required: ['projectRoot', 'oldPath', 'newPath'],
          },
        },
        {
          name: 'warmup',
          description:
            'Pre-load a TypeScript project to speed up subsequent operations',
          inputSchema: {
            type: 'object',
            properties: {
              projectRoot: {
                type: 'string',
                description: 'Absolute path to the project root (where tsconfig.json is)',
              },
            },
            required: ['projectRoot'],
          },
        },
      ];

      return { tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'moveFile':
          return await this.handleMoveFile(args);
        case 'warmup':
          return await this.handleWarmup(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  /**
   * Handle moveFile tool call
   */
  private async handleMoveFile(args: unknown): Promise<{
    content: Array<{ type: 'text'; text: string }>;
  }> {
    const startTime = Date.now();

    // Validate arguments
    if (!this.isValidMoveFileArgs(args)) {
      throw new Error('Invalid arguments for moveFile');
    }

    const { projectRoot, oldPath, newPath, dryRun = false } = args;

    try {
      // Get or create client
      const client = await this.getClient(projectRoot);

      // Get edits from tsserver
      const edits = await client.getEditsForFileRename(oldPath, newPath);

      if (dryRun) {
        // Return dry-run result
        const result: DryRunResult = {
          applied: false,
          edits,
          wouldMove: {
            from: oldPath,
            to: newPath,
          },
          filesModified: edits.length,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Apply edits and move file
      await applyEditsAndMoveFile(edits, oldPath, newPath);

      // Notify tsserver
      await client.notifyFileChanged(newPath);

      const durationMs = Date.now() - startTime;

      const result: MoveFileResult = {
        applied: true,
        filesModified: edits.length,
        moved: {
          from: oldPath,
          to: newPath,
        },
        durationMs,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      throw new Error(
        `Failed to move file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle warmup tool call
   */
  private async handleWarmup(args: unknown): Promise<{
    content: Array<{ type: 'text'; text: string }>;
  }> {
    const startTime = Date.now();

    // Validate arguments
    if (!this.isValidWarmupArgs(args)) {
      throw new Error('Invalid arguments for warmup');
    }

    const { projectRoot } = args;

    try {
      // Get or create client (this triggers project loading)
      await this.getClient(projectRoot);

      const durationMs = Date.now() - startTime;

      const result: WarmupResult = {
        status: 'ready',
        durationMs,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      throw new Error(
        `Failed to warm up project: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Type guard for moveFile arguments
   */
  private isValidMoveFileArgs(
    args: unknown
  ): args is {
    projectRoot: string;
    oldPath: string;
    newPath: string;
    dryRun?: boolean;
  } {
    return (
      typeof args === 'object' &&
      args !== null &&
      'projectRoot' in args &&
      typeof args.projectRoot === 'string' &&
      'oldPath' in args &&
      typeof args.oldPath === 'string' &&
      'newPath' in args &&
      typeof args.newPath === 'string'
    );
  }

  /**
   * Type guard for warmup arguments
   */
  private isValidWarmupArgs(
    args: unknown
  ): args is {
    projectRoot: string;
  } {
    return (
      typeof args === 'object' &&
      args !== null &&
      'projectRoot' in args &&
      typeof args.projectRoot === 'string'
    );
  }

  /**
   * Start the server
   */
  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Clean up on exit
    process.on('SIGINT', () => {
      this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    for (const client of this.clients.values()) {
      client.dispose();
    }
    this.clients.clear();
  }
}
