/**
 * DeepTest's fixture for Playwright. Generated into .deeptest/hooks/ on
 * every check and never imported by a spec: the worker hook
 * (witness-playwright-loader.mjs) answers each spec's import of
 * __PACKAGE__ with this file, which re-exports the package whole and
 * replaces `test` with one that reports, per test, the lines it reached,
 * the decisions it took, and the functions it entered. A spec keeps its
 * ordinary import and DeepTest never edits a test.
 *
 * Each test runs in its own page, so the page's counters at the end of the
 * test are that test's attribution, and the page is reset afterwards in case
 * a project shares one. Only the page is measured: a function a test calls
 * in Node rather than in the page is not counted.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test as base } from '__PACKAGE__';

export * from '__PACKAGE__';

export const test = base.extend<{ witness: void }>({
  witness: [
    async ({ page }, use, testInfo) => {
      const id = `${path.relative(process.cwd(), testInfo.file).split(path.sep).join('/')}::${testInfo.titlePath.slice(1).join(' > ')}`;
      await use();
      const dir = process.env.DEEPTEST_ATTRIBUTION_DIR;
      if (!dir) {
        return;
      }
      const out = await page
        .evaluate((testId) => {
          const w = (window as unknown as { __witness__?: { begin(id: string): void; end(): unknown; snapshot(): unknown; reset(): void } }).__witness__;
          if (!w) {
            return null;
          }
          const coverage = w.snapshot();
          w.reset();
          return { coverage, testId };
        }, id)
        .catch(() => null);
      if (!out) {
        return;
      }
      fs.appendFileSync(path.join(dir, `coverage-pw-${process.pid}.pwcov`), `${JSON.stringify({ test: out.testId, coverage: out.coverage })}\n`);
    },
    { auto: true },
  ],
});
