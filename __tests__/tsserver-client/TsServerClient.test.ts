import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { TsServerClient } from '../../src/tsserver-client/index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

  it('should get edits for file rename', async () => {
    // Test renaming utils.ts to helpers.ts
    // This should generate an edit to update the import in index.ts
    const oldPath = join(fixtureRoot, 'src/utils.ts');
    const newPath = join(fixtureRoot, 'src/helpers.ts');

    const edits = await client.getEditsForFileRename(oldPath, newPath);

    expect(edits).toBeDefined();
    expect(Array.isArray(edits)).toBe(true);

    // Should have at least one edit (in index.ts to update the import)
    expect(edits.length).toBeGreaterThan(0);

    // The edit should be for index.ts
    const indexEdit = edits.find(edit => edit.filePath.endsWith('index.ts'));
    expect(indexEdit).toBeDefined();

    if (indexEdit) {
      expect(indexEdit.textEdits.length).toBeGreaterThan(0);
      // Verify the edit changes './utils.js' to './helpers.js'
      const importEdit = indexEdit.textEdits[0];
      expect(importEdit.newText).toBe('./helpers.js');
    }
  }, 10000);
});
