/**
 * Shared types for ts-refactor-mcp
 */

/**
 * Position in a text document (0-indexed)
 */
export interface Position {
  line: number;
  offset: number;
}

/**
 * A text edit to apply to a file
 */
export interface TextEdit {
  start: Position;
  end: Position;
  newText: string;
}

/**
 * All edits to apply to a single file
 */
export interface FileEdit {
  filePath: string;
  textEdits: TextEdit[];
}

/**
 * Result of a file move operation
 */
export interface MoveFileResult {
  applied: boolean;
  filesModified: number;
  moved: {
    from: string;
    to: string;
  };
  durationMs?: number;
}

/**
 * Result of a dry-run move operation
 */
export interface DryRunResult {
  applied: false;
  edits: FileEdit[];
  wouldMove: {
    from: string;
    to: string;
  };
  filesModified: number;
}

/**
 * Result of a directory move operation
 */
export interface MoveDirectoryResult {
  applied: boolean;
  filesModified: number;
  filesMoved: number;
  durationMs?: number;
}

/**
 * Result of a warmup operation
 */
export interface WarmupResult {
  status: 'ready' | 'loading';
  filesIndexed?: number;
  durationMs?: number;
}
