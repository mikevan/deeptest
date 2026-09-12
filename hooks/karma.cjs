/**
 * DeepTest Karma plugin: a framework that serves karma-client.js into the
 * browser after Jasmine, and a reporter that receives what the client
 * sends and writes the same per-test attribution file the Jest and Vitest
 * hooks write. Loaded through a generated Karma config that requires it
 * by absolute path; attribution.cjs sits beside it.
 *
 * The client sends, per spec, the statement ids whose counters rose, and,
 * once per file, that file's statementMap and inputSourceMap. The mapping
 * from a statement to a source line goes through attribution.cjs's
 * originalPosition, so a Karma line and a Vitest line are computed by one
 * function. Angular's builder instruments each source file before bundling,
 * so the counters are keyed by the source path and the map only moves the
 * line (TypeScript to the compiled JavaScript the instrumenter saw).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const attribution = require('./attribution.cjs');

const dir = process.env.DEEPTEST_ATTRIBUTION_DIR;
const outFile = dir ? path.join(dir, `attr-karma-${process.pid}.jsonl`) : undefined;

function framework(files) {
  // After Jasmine, which its own framework unshifts to the front; the
  // client registers a Jasmine reporter as it loads.
  files.push({ pattern: path.join(__dirname, 'karma-client.js'), included: true, served: true, watched: false });
}
framework.$inject = ['config.files'];

function reporter(emitter) {
  const maps = {};
  emitter.on('browser_info', (_browser, info) => {
    const message = info && info.deeptest;
    if (!message || !outFile) {
      return;
    }
    try {
      for (const file of Object.keys(message.maps || {})) {
        maps[file] = message.maps[file];
      }
      const files = {};
      for (const file of Object.keys(message.files || {})) {
        const map = maps[file];
        if (!map || !map.statementMap) {
          continue;
        }
        for (const id of message.files[file]) {
          const stmt = map.statementMap[id];
          if (stmt && stmt.start && typeof stmt.start.line === 'number') {
            const pos = attribution.originalPosition(map, file, stmt.start.line, stmt.start.column || 0);
            if (pos) {
              (files[pos.file] || (files[pos.file] = new Set())).add(pos.line);
            }
          }
        }
      }
      for (const f of Object.keys(files)) {
        files[f] = Array.from(files[f]).sort((a, b) => a - b);
      }
      fs.appendFileSync(outFile, `${JSON.stringify({ test: message.test, files })}\n`);
    } catch {
      // Never fail the user's tests over attribution.
    }
  });
}
reporter.$inject = ['emitter'];

module.exports = {
  'framework:deeptest': ['factory', framework],
  'reporter:deeptest': ['type', reporter],
};
