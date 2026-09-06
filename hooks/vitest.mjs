/**
 * DeepTest hook for Vitest. Loaded through test.setupFiles in a generated
 * config that wraps the project's own. Test id matches the Jest hook.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect } from 'vitest';

const require = createRequire(import.meta.url);
const attribution = require('./attribution.cjs');

function testId() {
  const state = expect.getState();
  const file = state.testPath ? path.relative(process.cwd(), state.testPath).split(path.sep).join('/') : '?';
  return `${file}::${state.currentTestName || '?'}`;
}

beforeEach(() => attribution.begin());
afterEach(() => attribution.end(testId()));
