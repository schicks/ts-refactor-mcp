/**
 * Acceptance test: Use the MCP server to refactor code in this project
 */

import { TsRefactorServer } from './src/mcp-server/index.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = __dirname;

async function main() {
  console.log('🚀 Starting acceptance test...\n');

  // Create test files in src/
  const testDir = join(projectRoot, 'src');
  const helperPath = join(testDir, 'test-helper.ts');
  const consumerPath = join(testDir, 'test-consumer.ts');

  console.log('📝 Creating test files...');
  await writeFile(
    helperPath,
    `export function testHelper(message: string): string {\n  return \`Helper: \${message}\`;\n}\n`
  );

  await writeFile(
    consumerPath,
    `import { testHelper } from './test-helper.js';\n\nexport function useHelper() {\n  return testHelper('Hello');\n}\n`
  );

  console.log('✅ Test files created');
  console.log(`   - ${helperPath}`);
  console.log(`   - ${consumerPath}\n`);

  // Create and use the MCP server
  const server = new TsRefactorServer();

  try {
    // Warmup the project
    console.log('🔥 Warming up project...');
    const warmupResult = await server.warmup(projectRoot);
    console.log(`✅ Warmup complete in ${warmupResult.durationMs}ms\n`);

    // First, do a dry-run to see what would change
    console.log('🔍 Performing dry-run to preview changes...');
    const newHelperPath = join(testDir, 'test-utility.ts');
    const dryRunResult = await server.moveFile({
      projectRoot,
      oldPath: helperPath,
      newPath: newHelperPath,
      dryRun: true,
    });

    console.log('📋 Dry-run results:');
    console.log(`   Files to modify: ${dryRunResult.filesModified}`);
    console.log(`   Applied: ${dryRunResult.applied}`);
    if (!dryRunResult.applied && 'edits' in dryRunResult && dryRunResult.edits.length > 0) {
      console.log('   Changes:');
      for (const edit of dryRunResult.edits) {
        console.log(`     - ${edit.filePath} (${edit.textEdits.length} edits)`);
      }
    }
    console.log();

    // Now do the actual move
    console.log('🚚 Moving file and updating imports...');
    const moveResult = await server.moveFile({
      projectRoot,
      oldPath: helperPath,
      newPath: newHelperPath,
      dryRun: false,
    });

    console.log('✅ File moved successfully!');
    console.log(`   From: test-helper.ts`);
    console.log(`   To: test-utility.ts`);
    console.log(`   Files modified: ${moveResult.filesModified}`);
    if ('durationMs' in moveResult && moveResult.durationMs) {
      console.log(`   Duration: ${moveResult.durationMs}ms`);
    }
    console.log();

    // Verify the results
    console.log('🔬 Verifying changes...');

    // Check old file is gone
    if (!existsSync(helperPath)) {
      console.log('✅ Old file removed: test-helper.ts');
    } else {
      throw new Error('Old file still exists!');
    }

    // Check new file exists
    if (existsSync(newHelperPath)) {
      console.log('✅ New file created: test-utility.ts');
    } else {
      throw new Error('New file does not exist!');
    }

    // Check imports were updated
    const consumerContent = await readFile(consumerPath, 'utf-8');
    if (consumerContent.includes('./test-utility.js')) {
      console.log('✅ Import updated in test-consumer.ts');
    } else {
      throw new Error('Import was not updated!');
    }

    if (!consumerContent.includes('./test-helper.js')) {
      console.log('✅ Old import removed from test-consumer.ts');
    } else {
      throw new Error('Old import still present!');
    }

    console.log('\n🎉 Acceptance test PASSED!');
    console.log('\n📊 Summary:');
    console.log(`   - Created test files with imports`);
    console.log(`   - Performed dry-run preview`);
    console.log(`   - Moved file using MCP server`);
    console.log(`   - Verified imports were updated`);
    console.log(`   - TypeScript relationships maintained`);

    // Cleanup
    console.log('\n🧹 Cleaning up test files...');
    await unlink(newHelperPath);
    await unlink(consumerPath);
    console.log('✅ Cleanup complete\n');

    server.dispose();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Acceptance test FAILED!');
    console.error(error);

    // Cleanup on error
    try {
      if (existsSync(helperPath)) await unlink(helperPath);
      if (existsSync(join(testDir, 'test-utility.ts')))
        await unlink(join(testDir, 'test-utility.ts'));
      if (existsSync(consumerPath)) await unlink(consumerPath);
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }

    server.dispose();
    process.exit(1);
  }
}

main();
