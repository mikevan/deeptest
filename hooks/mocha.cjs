/**
 * DeepTest hook for Mocha: a root hook plugin (--require). Runs under the
 * Witness loader, so the counters carry the test id natively; begin/end
 * only tell the runtime which test is running. Test id:
 * "<spec file relative to cwd>::<full title>".
 */
'use strict';
const path = require('node:path');

function testId(test) {
  const file = test && test.file ? path.relative(process.cwd(), test.file).split(path.sep).join('/') : '?';
  return `${file}::${test ? test.fullTitle() : '?'}`;
}

exports.mochaHooks = {
  beforeEach() {
    globalThis.__witness__ && globalThis.__witness__.begin(testId(this.currentTest));
  },
  afterEach() {
    globalThis.__witness__ && globalThis.__witness__.end();
  },
};
