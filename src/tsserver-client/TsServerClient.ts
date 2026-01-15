import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { FileEdit } from '../types/index.js';

/**
 * Protocol types for tsserver communication
 */
interface TsServerRequest {
  seq: number;
  type: 'request';
  command: string;
  arguments?: unknown;
}

interface TsServerResponse {
  seq: number;
  type: 'response';
  command: string;
  request_seq: number;
  success: boolean;
  body?: unknown;
  message?: string;
}

interface TsServerEvent {
  seq: number;
  type: 'event';
  event: string;
  body?: unknown;
}

type TsServerMessage = TsServerResponse | TsServerEvent;

/**
 * tsserver protocol types for getEditsForFileRename
 */
interface CodeEdit {
  start: { line: number; offset: number };
  end: { line: number; offset: number };
  newText: string;
}

interface FileCodeEdits {
  fileName: string;
  textChanges: CodeEdit[];
}

interface GetEditsForFileRenameResponse {
  body: FileCodeEdits[];
}

/**
 * Manages a persistent tsserver process and exposes a clean async API
 */
export class TsServerClient {
  private process: ChildProcess | null = null;
  private requestSeq = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private buffer = '';
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Start the tsserver process
   */
  async start(): Promise<void> {
    // Find tsserver in project's node_modules
    const tsserverPath = this.findTsServer();
    if (!tsserverPath) {
      throw new Error(
        'Could not find tsserver. Make sure typescript is installed in node_modules.'
      );
    }

    // Spawn tsserver
    this.process = spawn('node', [tsserverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.projectRoot,
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to create tsserver process');
    }

    // Set up message handling
    this.process.stdout.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('tsserver stderr:', data.toString());
    });

    this.process.on('error', (error) => {
      console.error('tsserver process error:', error);
      this.cleanup();
    });

    this.process.on('exit', () => {
      this.cleanup();
    });

    // Open the project
    await this.openProject();
  }

  /**
   * Find tsserver in node_modules
   */
  private findTsServer(): string | null {
    const tsserverPath = join(
      this.projectRoot,
      'node_modules',
      'typescript',
      'lib',
      'tsserver.js'
    );

    if (existsSync(tsserverPath)) {
      return tsserverPath;
    }

    return null;
  }

  /**
   * Open the project in tsserver
   */
  private async openProject(): Promise<void> {
    // Find tsconfig.json
    const tsconfigPath = join(this.projectRoot, 'tsconfig.json');
    if (!existsSync(tsconfigPath)) {
      throw new Error('Could not find tsconfig.json in project root');
    }

    // Open the project
    await this.sendRequest('open', {
      file: tsconfigPath,
      projectRootPath: this.projectRoot,
    });
  }

  /**
   * Get edits for renaming a file
   */
  async getEditsForFileRename(
    oldPath: string,
    newPath: string
  ): Promise<FileEdit[]> {
    const response = (await this.sendRequest('getEditsForFileRename', {
      oldFilePath: oldPath,
      newFilePath: newPath,
    })) as GetEditsForFileRenameResponse;

    if (!response.body) {
      return [];
    }

    // Convert tsserver format to our format
    return response.body.map((fileEdit) => ({
      filePath: fileEdit.fileName,
      textEdits: fileEdit.textChanges.map((change) => ({
        start: change.start,
        end: change.end,
        newText: change.newText,
      })),
    }));
  }

  /**
   * Notify tsserver that a file has changed
   */
  async notifyFileChanged(path: string): Promise<void> {
    await this.sendRequest('change', {
      file: path,
    });
  }

  /**
   * Dispose of the tsserver process
   */
  dispose(): void {
    if (this.process) {
      // Remove all listeners to prevent any post-kill events
      this.process.removeAllListeners();
      this.process.stdout?.removeAllListeners();
      this.process.stderr?.removeAllListeners();
      this.process.stdin?.removeAllListeners();

      // Kill the process
      this.process.kill('SIGTERM');
      this.cleanup();
    }
  }

  /**
   * Send a request to tsserver
   */
  private sendRequest(command: string, args?: unknown): Promise<unknown> {
    if (!this.process || !this.process.stdin) {
      throw new Error('tsserver process not started');
    }

    const seq = ++this.requestSeq;
    const request: TsServerRequest = {
      seq,
      type: 'request',
      command,
      arguments: args,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(seq, { resolve, reject });

      const message = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(message);
    });
  }

  /**
   * Handle data from tsserver stdout
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete messages using Content-Length protocol
    while (true) {
      // Look for Content-Length header
      const headerMatch = this.buffer.match(/Content-Length: (\d+)\r?\n/);
      if (!headerMatch) {
        break;
      }

      const contentLength = parseInt(headerMatch[1], 10);
      const headerEndIndex = this.buffer.indexOf('\r\n\r\n');
      const headerEndIndexAlt = this.buffer.indexOf('\n\n');

      let contentStart: number;
      if (headerEndIndex !== -1) {
        contentStart = headerEndIndex + 4; // Skip \r\n\r\n
      } else if (headerEndIndexAlt !== -1) {
        contentStart = headerEndIndexAlt + 2; // Skip \n\n
      } else {
        // Header not complete yet
        break;
      }

      // Check if we have the full content
      if (this.buffer.length < contentStart + contentLength) {
        // Not enough data yet
        break;
      }

      // Extract the message content
      const messageContent = this.buffer.slice(contentStart, contentStart + contentLength);
      this.buffer = this.buffer.slice(contentStart + contentLength);

      // Parse and handle the message
      this.handleMessage(messageContent);
    }
  }

  /**
   * Handle a single message from tsserver
   */
  private handleMessage(content: string): void {
    try {
      const message: TsServerMessage = JSON.parse(content);

      if (message.type === 'response') {
        const pending = this.pendingRequests.get(message.request_seq);
        if (pending) {
          this.pendingRequests.delete(message.request_seq);

          if (message.success) {
            pending.resolve(message);
          } else {
            pending.reject(
              new Error(message.message || 'tsserver request failed')
            );
          }
        }
      }
      // Ignore events for now
    } catch (error) {
      console.error('Failed to parse tsserver message:', content, error);
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.process = null;
    this.pendingRequests.clear();
    this.buffer = '';
  }
}
