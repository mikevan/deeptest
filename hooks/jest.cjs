/**
 * DeepTest hook for Jest. Loaded through --setupFilesAfterEnv, so the
 * Jest globals exist. Test id: "<test file relative to cwd>::<full test name>".
 */
'use strict';
const path = require('node:path');
const attribution = require('./attribution.cjs');

function testId() {
  const state = expect.getState();
  const file = state.testPath ? path.relative(process.cwd(), state.testPath).split(path.sep).join('/') : '?';
  return `${file}::${state.currentTestName || '?'}`;
}

beforeEach(() => attribution.begin());
afterEach(() => attribution.end(testId()));
