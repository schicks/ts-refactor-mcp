import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyEdits, moveFile } from '../../src/edit-applier/index.js';
import type { FileEdit } from '../../src/types/index.js';

describe('applyEdits', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ts-refactor-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should apply a single text edit to a file', async () => {
    const filePath = join(tempDir, 'test.ts');
    const originalContent = 'const x = 1;\nconst y = 2;\n';
    await writeFile(filePath, originalContent);

    const edits: FileEdit[] = [
      {
        filePath,
        textEdits: [
          {
            start: { line: 1, offset: 7 },
            end: { line: 1, offset: 8 },
            newText: 'foo',
          },
        ],
      },
    ];

    await applyEdits(edits);

    const newContent = await readFile(filePath, 'utf-8');
    expect(newContent).toBe('const foo = 1;\nconst y = 2;\n');
  });

  it('should apply multiple edits to a file in reverse order', async () => {
    const filePath = join(tempDir, 'test.ts');
    const originalContent = 'const x = 1;\nconst y = 2;\n';
    await writeFile(filePath, originalContent);

    const edits: FileEdit[] = [
      {
        filePath,
        textEdits: [
          {
            start: { line: 1, offset: 7 },
            end: { line: 1, offset: 8 },
            newText: 'foo',
          },
          {
            start: { line: 2, offset: 7 },
            end: { line: 2, offset: 8 },
            newText: 'bar',
          },
        ],
      },
    ];

    await applyEdits(edits);

    const newContent = await readFile(filePath, 'utf-8');
    expect(newContent).toBe('const foo = 1;\nconst bar = 2;\n');
  });

  it('should throw if file does not exist', async () => {
    const filePath = join(tempDir, 'nonexistent.ts');

    const edits: FileEdit[] = [
      {
        filePath,
        textEdits: [
          {
            start: { line: 1, offset: 1 },
            end: { line: 1, offset: 1 },
            newText: 'test',
          },
        ],
      },
    ];

    await expect(applyEdits(edits)).rejects.toThrow('File does not exist');
  });
});

describe('moveFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ts-refactor-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should move a file to a new location', async () => {
    const oldPath = join(tempDir, 'old.ts');
    const newPath = join(tempDir, 'new.ts');
    await writeFile(oldPath, 'const x = 1;');

    await moveFile(oldPath, newPath);

    const content = await readFile(newPath, 'utf-8');
    expect(content).toBe('const x = 1;');
  });

  it('should create parent directories if needed', async () => {
    const oldPath = join(tempDir, 'old.ts');
    const newPath = join(tempDir, 'subdir', 'new.ts');
    await writeFile(oldPath, 'const x = 1;');

    await moveFile(oldPath, newPath);

    const content = await readFile(newPath, 'utf-8');
    expect(content).toBe('const x = 1;');
  });

  it('should throw if source file does not exist', async () => {
    const oldPath = join(tempDir, 'nonexistent.ts');
    const newPath = join(tempDir, 'new.ts');

    await expect(moveFile(oldPath, newPath)).rejects.toThrow(
      'Source file does not exist'
    );
  });
});
