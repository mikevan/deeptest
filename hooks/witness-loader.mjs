/**
 * Witness: the loader. `node --import <this file>` before any runner, and
 * every source under the source root is instrumented as Node loads it,
 * ES module or CommonJS alike, through module.registerHooks (Node 22.15
 * and later; synchronous, in-thread, and it applies to require() as well
 * as import, which the older module.register never did). Test files,
 * node_modules, and DeepTest's own folder are left alone. At exit the
 * whole-run counters are written as coverage-final.json.
 *
 * Environment, all set by the driver:
 *   DEEPTEST_HOOKS_DIR        where witness.cjs and witness-instrument.cjs are
 *   DEEPTEST_WASM_DIR         where the tree-sitter grammars are
 *   DEEPTEST_SOURCE_ROOT      absolute folder whose files are instrumented
 *   DEEPTEST_COVERAGE_DIR     where coverage-final.json goes at exit
 *   DEEPTEST_ATTRIBUTION_DIR  where the per-test records go
 */
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const hooksDir = process.env.DEEPTEST_HOOKS_DIR || path.dirname(fileURLToPath(import.meta.url));
const witness = require(path.join(hooksDir, 'witness.cjs'));
const { createInstrumenter } = require(path.join(hooksDir, 'witness-instrument.cjs'));
const sourceRoot = path.resolve(process.env.DEEPTEST_SOURCE_ROOT || process.cwd());
const coverageDir = process.env.DEEPTEST_COVERAGE_DIR;
const SOURCE = /\.(m?[jt]sx?|c[jt]s)$/;
const SKIP = /[\\/](node_modules|\.deeptest|\.untangleit)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]|\.d\.ts$/;

const instrumenter = await createInstrumenter(process.env.DEEPTEST_WASM_DIR || hooksDir);

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith('file:')) {
      return result;
    }
    const file = fileURLToPath(url);
    if (!file.startsWith(sourceRoot) || !SOURCE.test(file) || SKIP.test(file)) {
      return result;
    }
    // A require()d CommonJS file arrives with no format at all (Node 22);
    // everything else that is a script has one of these.
    const format = result.format;
    if (format !== undefined && format !== 'module' && format !== 'commonjs' && format !== 'module-typescript' && format !== 'commonjs-typescript') {
      return result;
    }
    const source = result.source === undefined || result.source === null ? require('node:fs').readFileSync(file, 'utf8') : String(result.source);
    try {
      const out = instrumenter.instrument(file.split(path.sep).join('/'), source);
      witness.register(out.handle, file.split(path.sep).join('/'), out.maps);
      return { ...result, source: out.code, shortCircuit: true };
    } catch (err) {
      process.stderr.write(`Witness could not instrument ${file}: ${err && err.message}\n`);
      return result;
    }
  },
});

process.on('exit', () => {
  try {
    witness.end();
    if (coverageDir) {
      witness.writeReport(coverageDir);
    }
  } catch {
    // never fail the run over the report
  }
});
