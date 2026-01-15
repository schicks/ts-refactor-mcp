import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { FileEdit, TextEdit } from '../types/index.js';

/**
 * Apply a list of text edits to a file's content
 * Edits are applied in reverse order to avoid position shifting
 */
function applyTextEdits(content: string, edits: TextEdit[]): string {
  // Convert content to array of lines
  const lines = content.split('\n');

  // Sort edits in reverse order (bottom to top, right to left)
  const sortedEdits = [...edits].sort((a, b) => {
    if (a.start.line !== b.start.line) {
      return b.start.line - a.start.line;
    }
    return b.start.offset - a.start.offset;
  });

  // Apply each edit
  for (const edit of sortedEdits) {
    const startLine = edit.start.line - 1; // tsserver uses 1-indexed lines
    const endLine = edit.end.line - 1;
    const startOffset = edit.start.offset - 1; // tsserver uses 1-indexed offsets
    const endOffset = edit.end.offset - 1;

    if (startLine === endLine) {
      // Single line edit
      const line = lines[startLine];
      lines[startLine] =
        line.slice(0, startOffset) + edit.newText + line.slice(endOffset);
    } else {
      // Multi-line edit
      const firstLine = lines[startLine];
      const lastLine = lines[endLine];

      const newLine = firstLine.slice(0, startOffset) + edit.newText + lastLine.slice(endOffset);

      // Replace the range of lines with the new content
      lines.splice(startLine, endLine - startLine + 1, newLine);
    }
  }

  return lines.join('\n');
}

/**
 * Validate that all edits can be applied
 * Throws an error if any edit is invalid
 */
async function validateEdits(edits: FileEdit[]): Promise<void> {
  for (const fileEdit of edits) {
    if (!existsSync(fileEdit.filePath)) {
      throw new Error(`File does not exist: ${fileEdit.filePath}`);
    }

    // Read file to validate it's accessible
    try {
      await readFile(fileEdit.filePath, 'utf-8');
    } catch (error) {
      throw new Error(
        `Cannot read file ${fileEdit.filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Validate edit positions
    for (const edit of fileEdit.textEdits) {
      if (edit.start.line < 1 || edit.start.offset < 1) {
        throw new Error(
          `Invalid edit position in ${fileEdit.filePath}: line ${edit.start.line}, offset ${edit.start.offset}`
        );
      }
      if (edit.end.line < edit.start.line) {
        throw new Error(
          `Invalid edit range in ${fileEdit.filePath}: end line ${edit.end.line} before start line ${edit.start.line}`
        );
      }
      if (
        edit.end.line === edit.start.line &&
        edit.end.offset < edit.start.offset
      ) {
        throw new Error(
          `Invalid edit range in ${fileEdit.filePath}: end offset ${edit.end.offset} before start offset ${edit.start.offset}`
        );
      }
    }
  }
}

/**
 * Apply a list of file edits atomically
 * Either all edits succeed or none are applied
 */
export async function applyEdits(edits: FileEdit[]): Promise<void> {
  // Validate all edits first
  await validateEdits(edits);

  // Read all files and compute new content
  const filesToWrite: Array<{ path: string; content: string }> = [];

  for (const fileEdit of edits) {
    const originalContent = await readFile(fileEdit.filePath, 'utf-8');
    const newContent = applyTextEdits(originalContent, fileEdit.textEdits);
    filesToWrite.push({ path: fileEdit.filePath, content: newContent });
  }

  // Write all files
  for (const { path, content } of filesToWrite) {
    await writeFile(path, content, 'utf-8');
  }
}

/**
 * Move a file from oldPath to newPath
 * Creates parent directories if needed
 */
export async function moveFile(oldPath: string, newPath: string): Promise<void> {
  if (!existsSync(oldPath)) {
    throw new Error(`Source file does not exist: ${oldPath}`);
  }

  // Create parent directory if it doesn't exist
  const newDir = dirname(newPath);
  if (!existsSync(newDir)) {
    await mkdir(newDir, { recursive: true });
  }

  // Move the file
  await rename(oldPath, newPath);
}

/**
 * Apply edits and move a file atomically
 * This is the main operation for the moveFile tool
 */
export async function applyEditsAndMoveFile(
  edits: FileEdit[],
  oldPath: string,
  newPath: string
): Promise<void> {
  // First apply all edits
  if (edits.length > 0) {
    await applyEdits(edits);
  }

  // Then move the file
  await moveFile(oldPath, newPath);
}
