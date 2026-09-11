/**
 * DeepTest hook for Vitest. Loaded through test.setupFiles in a generated
 * config that wraps the project's own. Test id matches the Jest hook.
 *
 * This file is copied into the project's .deeptest/ folder before every
 * run and loaded from there, never from the extension's install folder:
 * Vite refuses a setup file outside the project root (server.fs.allow),
 * which is where the install folder always is. The helper next to it is
 * found through DEEPTEST_HOOKS_DIR rather than a relative require, because
 * a bundling runner (the Angular builder) rewrites import.meta.url and a
 * relative path would point at the bundle, not at the helper.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect } from 'vitest';

const require = createRequire(import.meta.url);
const helperDir = process.env.DEEPTEST_HOOKS_DIR;
const attribution = require(helperDir ? path.join(helperDir, 'attribution.cjs') : './attribution.cjs');

function testId() {
  const state = expect.getState();
  const file = state.testPath ? path.relative(process.cwd(), state.testPath).split(path.sep).join('/') : '?';
  return `${file}::${state.currentTestName || '?'}`;
}

beforeEach(() => attribution.begin());
afterEach(() => attribution.end(testId()));
