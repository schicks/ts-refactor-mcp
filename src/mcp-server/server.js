import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { TsServerClient } from '../tsserver-client/index.js';
import { applyEditsAndMoveFile } from '../edit-applier/index.js';
/**
 * MCP Server for TypeScript-aware file refactoring
 */
export class TsRefactorServer {
    server;
    clients = new Map();
    constructor() {
        this.server = new Server({
            name: 'ts-refactor-mcp',
            version: '0.1.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
    }
    /**
     * Get or create a TsServerClient for a project
     */
    async getClient(projectRoot) {
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
    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const tools = [
                {
                    name: 'moveFile',
                    description: 'Move a TypeScript file and update all imports automatically. Applies edits atomically.',
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
                    description: 'Pre-load a TypeScript project to speed up subsequent operations',
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
    async handleMoveFile(args) {
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
                const result = {
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
            // Note: We don't need to notify tsserver about the file move
            // tsserver will detect the changes when needed
            const durationMs = Date.now() - startTime;
            const result = {
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
        }
        catch (error) {
            throw new Error(`Failed to move file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle warmup tool call
     */
    async handleWarmup(args) {
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
            const result = {
                status: 'ready',
                durationMs,
            };
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            throw new Error(`Failed to warm up project: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Type guard for moveFile arguments
     */
    isValidMoveFileArgs(args) {
        return (typeof args === 'object' &&
            args !== null &&
            'projectRoot' in args &&
            typeof args.projectRoot === 'string' &&
            'oldPath' in args &&
            typeof args.oldPath === 'string' &&
            'newPath' in args &&
            typeof args.newPath === 'string');
    }
    /**
     * Type guard for warmup arguments
     */
    isValidWarmupArgs(args) {
        return (typeof args === 'object' &&
            args !== null &&
            'projectRoot' in args &&
            typeof args.projectRoot === 'string');
    }
    /**
     * Start the server
     */
    async run() {
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
    cleanup() {
        for (const client of this.clients.values()) {
            client.dispose();
        }
        this.clients.clear();
    }
    /**
     * Public method for testing: move a file and update imports
     */
    async moveFile(args) {
        const result = await this.handleMoveFile(args);
        return JSON.parse(result.content[0].text);
    }
    /**
     * Public method for testing: warmup a project
     */
    async warmup(projectRoot) {
        const result = await this.handleWarmup({ projectRoot });
        return JSON.parse(result.content[0].text);
    }
    /**
     * Public method for testing: cleanup
     */
    dispose() {
        this.cleanup();
    }
}
