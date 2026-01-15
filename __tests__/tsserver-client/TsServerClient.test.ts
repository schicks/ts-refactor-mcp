import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { TsServerClient } from '../../src/tsserver-client/index.js';
import { join } from 'node:path';

describe('TsServerClient', () => {
  let client: TsServerClient;
  const fixtureRoot = join(__dirname, '../fixtures/simple-project');

  beforeAll(async () => {
    // Note: This test requires a fixture project with TypeScript installed
    client = new TsServerClient(fixtureRoot);
    await client.start();
  }, 30000); // 30 second timeout for tsserver startup

  afterAll(() => {
    if (client) {
      client.dispose();
    }
  });

  it('should start successfully', () => {
    expect(client).toBeDefined();
  });

  it.skip('should get edits for file rename', async () => {
    // This test is skipped until we have a proper fixture
    const oldPath = join(fixtureRoot, 'src/old.ts');
    const newPath = join(fixtureRoot, 'src/new.ts');

    const edits = await client.getEditsForFileRename(oldPath, newPath);

    expect(edits).toBeDefined();
    expect(Array.isArray(edits)).toBe(true);
  });
});
