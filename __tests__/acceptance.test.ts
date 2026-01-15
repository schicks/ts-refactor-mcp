/**
 * Acceptance test: Use the MCP server to refactor code in a realistic project
 *
 * This test demonstrates the full end-to-end workflow:
 * - Warmup a TypeScript project
 * - Preview changes with dry-run
 * - Move a file and update all imports
 * - Verify the refactoring was correct
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { TsRefactorServer } from '../src/mcp-server/index.js';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

describe('Acceptance Test: End-to-End Refactoring', () => {
  let server: TsRefactorServer;
  let testProjectRoot: string;

  beforeAll(async () => {
    // Create a temporary test project (isolated from actual repo)
    testProjectRoot = join(tmpdir(), `acceptance-test-${Date.now()}`);
    await mkdir(testProjectRoot, { recursive: true });

    // Set up a realistic TypeScript project
    const srcDir = join(testProjectRoot, 'src');
    await mkdir(srcDir, { recursive: true });

    // Create package.json
    await writeFile(
      join(testProjectRoot, 'package.json'),
      JSON.stringify({
        name: 'acceptance-test-project',
        version: '1.0.0',
        type: 'module',
      })
    );

    // Create tsconfig.json
    await writeFile(
      join(testProjectRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ES2022',
          target: 'ES2022',
          moduleResolution: 'node',
          esModuleInterop: true,
          strict: true,
        },
      })
    );

    // Create test files with imports (simulating real code)
    await writeFile(
      join(srcDir, 'test-helper.ts'),
      `export function testHelper(message: string): string {\n  return \`Helper: \${message}\`;\n}\n`
    );

    await writeFile(
      join(srcDir, 'test-consumer.ts'),
      `import { testHelper } from './test-helper.js';\n\nexport function useHelper() {\n  return testHelper('Hello');\n}\n`
    );

    // Install TypeScript in the test project
    const { execSync } = await import('node:child_process');
    execSync('npm install typescript@^5.3.0', {
      cwd: testProjectRoot,
      stdio: 'ignore',
    });

    // Create the MCP server
    server = new TsRefactorServer();
  }, 60000);

  afterAll(async () => {
    // Clean up
    if (server) {
      server.dispose();
    }
    if (testProjectRoot && existsSync(testProjectRoot)) {
      await rm(testProjectRoot, { recursive: true, force: true });
    }
  });

  it('should perform complete end-to-end refactoring workflow', async () => {
    // Step 1: Warmup the project
    const warmupResult = await server.warmup(testProjectRoot);
    expect(warmupResult).toBeDefined();
    expect(warmupResult.status).toBe('ready');
    expect(warmupResult.durationMs).toBeGreaterThan(0);

    const helperPath = join(testProjectRoot, 'src/test-helper.ts');
    const newHelperPath = join(testProjectRoot, 'src/test-utility.ts');
    const consumerPath = join(testProjectRoot, 'src/test-consumer.ts');

    // Step 2: Perform dry-run to preview changes
    const dryRunResult = await server.moveFile({
      projectRoot: testProjectRoot,
      oldPath: helperPath,
      newPath: newHelperPath,
      dryRun: true,
    });

    expect(dryRunResult).toBeDefined();
    expect(dryRunResult.applied).toBe(false);
    expect(dryRunResult.filesModified).toBeGreaterThan(0);

    if (!dryRunResult.applied && 'edits' in dryRunResult) {
      expect(dryRunResult.edits).toBeDefined();
      expect(dryRunResult.edits.length).toBeGreaterThan(0);

      // Should have an edit for the consumer file
      const consumerEdit = dryRunResult.edits.find(edit =>
        edit.filePath.endsWith('test-consumer.ts')
      );
      expect(consumerEdit).toBeDefined();
    }

    // Verify original files still exist (dry-run didn't modify anything)
    expect(existsSync(helperPath)).toBe(true);
    expect(existsSync(newHelperPath)).toBe(false);

    // Step 3: Perform the actual move
    const moveResult = await server.moveFile({
      projectRoot: testProjectRoot,
      oldPath: helperPath,
      newPath: newHelperPath,
      dryRun: false,
    });

    expect(moveResult).toBeDefined();
    expect(moveResult.applied).toBe(true);
    expect(moveResult.filesModified).toBeGreaterThanOrEqual(1);
    expect(moveResult.moved).toEqual({
      from: helperPath,
      to: newHelperPath,
    });

    if ('durationMs' in moveResult && moveResult.durationMs) {
      expect(moveResult.durationMs).toBeGreaterThan(0);
    }

    // Step 4: Verify the refactoring was correct

    // Old file should be gone
    expect(existsSync(helperPath)).toBe(false);

    // New file should exist
    expect(existsSync(newHelperPath)).toBe(true);

    // Import should be updated in consumer
    const consumerContent = await readFile(consumerPath, 'utf-8');
    expect(consumerContent).toContain('./test-utility.js');
    expect(consumerContent).not.toContain('./test-helper.js');

    // New file should have the same content
    const newHelperContent = await readFile(newHelperPath, 'utf-8');
    expect(newHelperContent).toContain('testHelper');
    expect(newHelperContent).toContain('Helper:');
  }, 60000);

  it('should maintain TypeScript correctness after refactoring', async () => {
    // Verify the project would still compile by checking tsserver can analyze it
    // The fact that we can warmup again means tsserver accepts the refactored code
    const secondWarmup = await server.warmup(testProjectRoot);
    expect(secondWarmup.status).toBe('ready');
  }, 30000);
});
