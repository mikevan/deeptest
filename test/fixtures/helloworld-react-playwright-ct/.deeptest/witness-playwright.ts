/**
 * DeepTest's fixture for Playwright. Generated into .deeptest/witness-playwright.ts
 * on every check; import `test` and `expect` from it instead of from
 * @playwright/experimental-ct-react and every test in that file reports, per test, the lines it
 * reached, the decisions it took, and the functions it entered. This is the
 * one line a project adds; DeepTest never edits a test itself.
 *
 * Each test runs in its own page, so the page's counters at the end of the
 * test are that test's attribution, and the page is reset afterwards in case
 * a project shares one. Only the page is measured: a function a test calls
 * in Node rather than in the page is not counted.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test as base, expect } from '@playwright/experimental-ct-react';

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

export { expect };
