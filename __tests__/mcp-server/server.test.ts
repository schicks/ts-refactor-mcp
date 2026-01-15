import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { TsRefactorServer } from '../../src/mcp-server/index.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

describe('TsRefactorServer', () => {
  let server: TsRefactorServer;
  let testProjectRoot: string;

  beforeAll(async () => {
    // Create a temporary test project
    testProjectRoot = join(tmpdir(), `mcp-test-${Date.now()}`);
    await mkdir(testProjectRoot, { recursive: true });

    // Set up a simple TypeScript project
    const srcDir = join(testProjectRoot, 'src');
    await mkdir(srcDir, { recursive: true });

    // Create package.json
    await writeFile(
      join(testProjectRoot, 'package.json'),
      JSON.stringify({
        name: 'test-project',
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

    // Create source files
    await writeFile(
      join(srcDir, 'math.ts'),
      `export function add(a: number, b: number): number {\n  return a + b;\n}\n`
    );

    await writeFile(
      join(srcDir, 'index.ts'),
      `import { add } from './math.js';\n\nconsole.log(add(1, 2));\n`
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

  it('should warmup a project', async () => {
    const result = await server.warmup(testProjectRoot);

    expect(result).toBeDefined();
    expect(result.status).toBe('ready');
    expect(result.durationMs).toBeGreaterThan(0);
  }, 30000);

  it('should support dry-run mode', async () => {
    // First warmup the project
    await server.warmup(testProjectRoot);

    const oldPath = join(testProjectRoot, 'src/math.ts');
    const newPath = join(testProjectRoot, 'src/calculator.ts');

    const result = await server.moveFile({
      projectRoot: testProjectRoot,
      oldPath,
      newPath,
      dryRun: true,
    });

    expect(result).toBeDefined();
    expect(result.applied).toBe(false);
    expect(result.edits).toBeDefined();
    expect(result.edits!.length).toBeGreaterThan(0);

    // Verify the file was NOT actually moved
    expect(existsSync(oldPath)).toBe(true);
    expect(existsSync(newPath)).toBe(false);

    // Verify the import was NOT updated in index.ts
    const { readFile } = await import('node:fs/promises');
    const indexContent = await readFile(
      join(testProjectRoot, 'src/index.ts'),
      'utf-8'
    );
    expect(indexContent).toContain('./math.js');
    expect(indexContent).not.toContain('./calculator.js');
  }, 30000);

  it('should move a file and update imports', async () => {
    const oldPath = join(testProjectRoot, 'src/math.ts');
    const newPath = join(testProjectRoot, 'src/calculator.ts');

    const result = await server.moveFile({
      projectRoot: testProjectRoot,
      oldPath,
      newPath,
      dryRun: false,
    });

    expect(result).toBeDefined();
    expect(result.applied).toBe(true);
    expect(result.filesModified).toBeGreaterThanOrEqual(1);
    expect(result.moved).toEqual({
      from: oldPath,
      to: newPath,
    });
    expect(result.durationMs).toBeGreaterThan(0);

    // Verify the file was actually moved
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);

    // Verify the import was updated in index.ts
    const { readFile } = await import('node:fs/promises');
    const indexContent = await readFile(
      join(testProjectRoot, 'src/index.ts'),
      'utf-8'
    );
    expect(indexContent).toContain('./calculator.js');
    expect(indexContent).not.toContain('./math.js');
  }, 30000);
});
