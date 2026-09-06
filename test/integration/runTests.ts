/**
 * Downloads a VS Code build (cached under .vscode-test/) and runs the suite
 * inside it against the Python fixture project. `npm run test:vscode`.
 */
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..');
  const runs: Array<[string, string]> = [
    ['suite', 'pyproject'],
    ['suite-ts', 'jsproject-jest'],
  ];
  const only = process.env.DEEPTEST_IT_ONLY;
  for (const [suite, fixture] of runs) {
    if (only && suite !== only) {
      continue;
    }
    const extensionTestsPath = path.resolve(__dirname, suite);
    const workspace = path.resolve(extensionDevelopmentPath, 'test', 'fixtures', fixture);
    // DEEPTEST_VSCODE_PATH points at an existing VS Code / VSCodium executable
    // (needed where update.code.visualstudio.com is unreachable). Otherwise
    // @vscode/test-electron downloads a build into .vscode-test/.
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath: process.env.DEEPTEST_VSCODE_PATH,
      launchArgs: [workspace, '--disable-extensions', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
      // Lets the suite through the modal "Send this to your AI assistant?"
      // confirmation, which no script can press. Set here and nowhere else.
      extensionTestsEnv: { DEEPTEST_TEST_HOST: '1' },
    });
  }
}

main().catch((err) => {
  console.error('Integration tests failed:', err);
  process.exit(1);
});
