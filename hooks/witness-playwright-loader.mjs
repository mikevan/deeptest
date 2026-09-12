/**
 * Witness: the Playwright worker hook. Playwright runs code inside a test
 * only through a fixture a test file imports (Playwright, "Fixtures");
 * there is no config-level way to add one. Rather than ask every spec to
 * import DeepTest's fixture, this hook goes into every Playwright process
 * through NODE_OPTIONS and answers the spec's ordinary import of the
 * component package with DeepTest's fixture file instead. The fixture
 * re-exports the whole package and replaces `test` with one that reports
 * to Witness, so a spec sees the same names it imported and changes
 * nothing. The fixture's own import of the package, and any import from
 * inside node_modules, resolve normally.
 *
 * Nothing on disk is touched: this is a resolve hook, it only changes
 * which file an import lands on, and it lasts for the run.
 *
 * Environment, set by the driver:
 *   DEEPTEST_FIXTURE     absolute path of the fixture file
 *   DEEPTEST_CT_PACKAGE  the component package the project uses
 */
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const fixturePath = process.env.DEEPTEST_FIXTURE;
const ctPackage = process.env.DEEPTEST_CT_PACKAGE;

if (fixturePath && ctPackage) {
  const fixture = pathToFileURL(path.resolve(fixturePath)).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        (specifier === ctPackage || specifier.startsWith(`${ctPackage}/`)) &&
        context.parentURL &&
        context.parentURL !== fixture &&
        !/[\\/]node_modules[\\/]/.test(context.parentURL)
      ) {
        return { url: fixture, format: 'module', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}
