/**
 * Witness as a Vite plugin, for runners that build the code under test with
 * Vite and run it in a browser page (Playwright component tests). Every
 * source under the source root is instrumented as Vite transforms it, with
 * its maps embedded, and the Witness runtime is injected into the page's
 * HTML ahead of every module, so `window.__witness__` exists before the
 * first counter fires. Nothing is installed in the project: the plugin,
 * the runtime, and the instrumenter all come from .deeptest/hooks.
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = /\.(m?[jt]sx?|c[jt]s)$/;
const SKIP = /[\\/](node_modules|\.deeptest|\.untangleit|playwright)[\\/]|\.(test|spec|ct)\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]|\.d\.ts$/;

/**
 * @param {{ hooksDir?: string; wasmDir: string; sourceRoot: string }} options
 */
export function witnessPlugin(options) {
  const hooksDir = options.hooksDir || here;
  const sourceRoot = path.resolve(options.sourceRoot);
  const runtimeSource = fs.readFileSync(path.join(hooksDir, 'witness.cjs'), 'utf8');
  let instrumenter;
  return {
    name: 'deeptest-witness',
    enforce: 'pre',
    async buildStart() {
      const { createInstrumenter } = require(path.join(hooksDir, 'witness-instrument.cjs'));
      instrumenter = await createInstrumenter(options.wasmDir);
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (!instrumenter || !file.startsWith(sourceRoot) || !SOURCE.test(file) || SKIP.test(file)) {
        return null;
      }
      try {
        const out = instrumenter.instrument(file.split(path.sep).join('/'), code, true);
        // Every line is where it was; columns moved. No map is right: Vite then
        // treats the output as line-aligned with the input, which it is.
        return { code: out.code, map: null };
      } catch (err) {
        this.warn(`Witness could not instrument ${file}: ${err && err.message}`);
        return null;
      }
    },
    transformIndexHtml() {
      return [{ tag: 'script', injectTo: 'head-prepend', children: runtimeSource }];
    },
  };
}
