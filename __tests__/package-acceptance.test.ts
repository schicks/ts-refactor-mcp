/**
 * Package Acceptance Test: Verify the npm package is properly packaged and startable
 *
 * This test ensures that:
 * - The package can be packed with npm pack
 * - All necessary files are included in the package
 * - The MCP server can be started from the packed package
 * - The server responds to MCP protocol initialization
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';

describe('Package Acceptance Test: npm pack and MCP server startup', () => {
  let testDir: string;
  let packageTarball: string;
  let extractedPackageDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `package-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    const projectRoot = process.cwd();
    
    console.log('Building the package...');
    execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
    
    console.log('Packing the package...');
    const packOutput = execSync('npm pack --pack-destination ' + testDir, {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    
    const tarballName = packOutput.trim().split('\n').pop()?.trim();
    if (!tarballName) {
      throw new Error('Failed to get tarball name from npm pack output');
    }
    
    packageTarball = join(testDir, tarballName);
    console.log(`Package created: ${packageTarball}`);
    
    extractedPackageDir = join(testDir, 'package');
    console.log('Extracting package...');
    execSync(`tar -xzf "${packageTarball}"`, { cwd: testDir });
    
    console.log('Installing package dependencies...');
    execSync('npm install --production', {
      cwd: extractedPackageDir,
      stdio: 'inherit',
    });
  }, 120000);

  afterAll(async () => {
    if (testDir && existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('should include all required dist files in the package', async () => {
    const distDir = join(extractedPackageDir, 'dist');
    expect(existsSync(distDir)).toBe(true);

    const requiredFiles = [
      'dist/index.js',
      'dist/mcp-server/index.js',
      'dist/mcp-server/server.js',
      'dist/tsserver-client/index.js',
      'dist/tsserver-client/TsServerClient.js',
      'dist/edit-applier/index.js',
      'dist/edit-applier/applyEdits.js',
      'dist/types/index.js',
    ];

    for (const file of requiredFiles) {
      const filePath = join(extractedPackageDir, file);
      expect(existsSync(filePath)).toBe(true);
    }
  });

  it('should include declaration files', async () => {
    const requiredDeclarations = [
      'dist/index.d.ts',
      'dist/mcp-server/index.d.ts',
      'dist/mcp-server/server.d.ts',
      'dist/tsserver-client/TsServerClient.d.ts',
    ];

    for (const file of requiredDeclarations) {
      const filePath = join(extractedPackageDir, file);
      expect(existsSync(filePath)).toBe(true);
    }
  });

  it('should not include source files or tests', async () => {
    const shouldNotExist = ['src', '__tests__', 'tsconfig.json', 'jest.config.js'];

    for (const item of shouldNotExist) {
      const itemPath = join(extractedPackageDir, item);
      expect(existsSync(itemPath)).toBe(false);
    }
  });

  it('should start the MCP server and respond to initialization', async () => {
    return new Promise<void>((resolve, reject) => {
      const serverPath = join(extractedPackageDir, 'dist/index.js');
      
      const serverProcess = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdoutData = '';
      let stderrData = '';
      let initializationReceived = false;
      const timeout = setTimeout(() => {
        serverProcess.kill();
        reject(new Error(`Server did not respond within timeout. stdout: ${stdoutData}, stderr: ${stderrData}`));
      }, 10000);

      serverProcess.stdout?.on('data', (data) => {
        stdoutData += data.toString();
        
        try {
          const lines = stdoutData.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            
            const message = JSON.parse(line);
            
            if (message.method === 'initialize' || message.result?.protocolVersion) {
              initializationReceived = true;
            }
          }
        } catch (e) {
          // Not yet a complete JSON message
        }
      });

      serverProcess.stderr?.on('data', (data) => {
        stderrData += data.toString();
      });

      serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start server: ${error.message}`));
      });

      serverProcess.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(`Server exited with code ${code}. stderr: ${stderrData}`));
        }
      });

      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      };

      serverProcess.stdin?.write(JSON.stringify(initializeRequest) + '\n');

      const checkInterval = setInterval(() => {
        if (initializationReceived || stdoutData.includes('capabilities')) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          serverProcess.kill();
          
          expect(stdoutData.length).toBeGreaterThan(0);
          expect(stderrData).not.toContain('Error');
          expect(stderrData).not.toContain('Cannot find module');
          
          resolve();
        }
      }, 100);
    });
  }, 15000);

  it('should have correct package.json metadata', async () => {
    const packageJsonPath = join(extractedPackageDir, 'package.json');
    expect(existsSync(packageJsonPath)).toBe(true);

    const { readFile } = await import('node:fs/promises');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

    expect(packageJson.name).toBe('ts-refactor-mcp');
    expect(packageJson.main).toBe('dist/index.js');
    expect(packageJson.bin).toEqual({ 'ts-refactor-mcp': 'dist/index.js' });
    expect(packageJson.type).toBe('module');
    expect(packageJson.files).toContain('dist');
  });

  it('should be installable via npx simulation', async () => {
    const npxTestDir = join(testDir, 'npx-test');
    await mkdir(npxTestDir, { recursive: true });

    console.log('Installing package from tarball...');
    execSync(`npm install "${packageTarball}"`, {
      cwd: npxTestDir,
      stdio: 'inherit',
    });

    const installedPackage = join(npxTestDir, 'node_modules/ts-refactor-mcp');
    expect(existsSync(installedPackage)).toBe(true);

    const installedIndexJs = join(installedPackage, 'dist/index.js');
    expect(existsSync(installedIndexJs)).toBe(true);

    const installedMcpServerIndexJs = join(
      installedPackage,
      'dist/mcp-server/index.js'
    );
    expect(existsSync(installedMcpServerIndexJs)).toBe(true);
  }, 30000);
});
