/**
 * Witness as DeepTest drives it. The library proves itself in its own tree
 * (the rewrite, the loader, the Vite plugin, the Playwright worker hook);
 * this suite proves what DeepTest adds: the differential test against
 * istanbul-lib-instrument over every fixture project and DeepTest's own
 * source, the universe of files no test loads, and the Mocha and Playwright
 * drivers (detection, the fixture DeepTest writes, the wrapper config, the
 * summaries, and the merge of per-test records).
 */
import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { repoWasmDir } from '../src/languages/shared/treeSitter';
import { createInstrumenter, hooksDir as witnessHooksDir } from '@projectrevivesolutions/witness';
import type { WitnessInstrumenter } from '@projectrevivesolutions/witness';
import { nodeSupportsWitness, parseMochaSummary, detectRunner, witnessUniverse, detectPlaywrightCt, writePlaywrightFixture, playwrightComponentTests, playwrightWrapperConfig, parsePlaywrightSummary, mergePlaywrightRecords, mergeWitnessReports } from '../src/languages/typescript/coverage';

let witness: WitnessInstrumenter;
const wasmDir = repoWasmDir();

beforeAll(async () => {
  witness = await createInstrumenter(wasmDir);
});

test('differential: the maps agree with istanbul-lib-instrument on every fixture and on DeepTest itself', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createInstrumenter: istanbul } = require('istanbul-lib-instrument') as { createInstrumenter: (o: unknown) => { instrumentSync: (c: string, f: string) => string; lastFileCoverage: () => { statementMap: Record<string, { start: { line: number } }>; fnMap: Record<string, { loc: { start: { line: number } } }>; branchMap: Record<string, { type: string; line: number }> } } };
  const roots = [path.join('test', 'fixtures'), 'src', 'hooks'];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/node_modules|coverage|\.deeptest|\.angular|dist/.test(entry.name)) {
          walk(p);
        }
      } else if (/\.(m?[jt]sx?|c[jt]s)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        files.push(p);
      }
    }
  };
  roots.forEach(walk);
  assert.ok(files.length > 100, `${files.length} files`);
  const failures: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const plugins = ['asyncGenerators', 'bigInt', 'classProperties', 'classPrivateProperties', 'classPrivateMethods', 'dynamicImport', 'importMeta', 'numericSeparator', 'objectRestSpread', 'optionalCatchBinding', 'topLevelAwait', 'decorators-legacy', ...(/\.tsx$/.test(file) ? ['typescript', 'jsx'] : /\.(ts|mts|cts)$/.test(file) ? ['typescript'] : ['jsx'])];
    const theirs = istanbul({ esModules: true, parserPlugins: plugins });
    theirs.instrumentSync(source, file);
    const i = theirs.lastFileCoverage();
    const ours = witness.mapsOnly(file.split(path.sep).join('/'), source);
    const lines = (m: Record<string, { start?: { line: number }; loc?: { start: { line: number } } }>) => Array.from(new Set(Object.values(m).map((e) => (e.loc ?? e).start!.line))).sort((a, b) => a - b);
    const branches = (m: Record<string, { type: string; line: number }>) => Object.values(m).map((b) => `${b.type}@${b.line}`).sort();
    const same = JSON.stringify([lines(i.statementMap), lines(i.fnMap), branches(i.branchMap)]) === JSON.stringify([lines(ours.statementMap), lines(ours.fnMap), branches(ours.branchMap)]);
    if (!same || ours.skipped.length > 0) {
      failures.push(`${file}: statements ${lines(i.statementMap).join(',')} vs ${lines(ours.statementMap).join(',')}; functions ${lines(i.fnMap).join(',')} vs ${lines(ours.fnMap).join(',')}; branches ${branches(i.branchMap).join(' ')} vs ${branches(ours.branchMap).join(' ')}; skipped ${ours.skipped.map((s) => s.line).join(',')}`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('files no test loads get their universe from the same instrumenter', async () => {
  const log: string[] = [];
  const out = await witnessUniverse(process.cwd(), ['test/fixtures/helloworld-react-jest/src/schedule.js', 'test/fixtures/helloworld-angular-karma/src/app/schedule.service.ts', 'test/fixtures/missing.ts'], wasmDir, (l) => log.push(l));
  assert.equal(out.length, 2, log.join('\n'));
  assert.equal(Array.from(out[0].lines.keys()).sort((a, b) => a - b)[0], 13, 'the first if in pickGreeting');
  assert.ok(Array.from(out[1].lines.keys()).includes(13));
  assert.ok(Array.from(out[0].lines.values()).every((s) => s.size === 0));
  assert.match(log[0], /missing\.ts/);
});

test('Mocha: the summary, the Node floor, and detection', () => {
  assert.deepEqual(parseMochaSummary('\n  10 passing (5ms)\n\n', 0), { passed: 10, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  assert.deepEqual(parseMochaSummary('\n  8 passing (9ms)\n  1 pending\n  2 failing\n', 2), { passed: 8, failed: 2, errors: 0, skipped: 1, exitCode: 2 });
  assert.equal(parseMochaSummary('Error: Cannot find module', 1).errors, 1);
  assert.equal(nodeSupportsWitness('v22.15.0'), true);
  assert.equal(nodeSupportsWitness('v22.14.9'), false);
  assert.equal(nodeSupportsWitness('v23.5.0'), true);
  assert.equal(nodeSupportsWitness('v23.4.0'), false);
  assert.equal(nodeSupportsWitness('v24.0.0'), true);
  assert.equal(nodeSupportsWitness('v20.19.0'), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-detect-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { mocha: '^11' } }));
  assert.equal(detectRunner(dir), 'mocha');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { mocha: '^11', vitest: '^3' }, scripts: { test: 'mocha' } }));
  assert.equal(detectRunner(dir), 'mocha', 'the test script settles a tie');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { mocha: '^11', vitest: '^3' } }));
  assert.equal(detectRunner(dir), 'vitest', 'no script: Vitest first');
});

test('Playwright component tests: detection, the fixture, the wrapper config, the summary, and the merge', () => {
  const fixture = path.join('test', 'fixtures', 'helloworld-react-playwright-ct');
  assert.deepEqual(detectPlaywrightCt(fixture), { package: '@playwright/experimental-ct-react', configFile: 'playwright-ct.config.ts' });
  assert.equal(detectPlaywrightCt(path.join('test', 'fixtures', 'jsproject-jest')), undefined);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-pw-'));
  const written = writePlaywrightFixture(dir, '@playwright/experimental-ct-vue');
  assert.equal(path.relative(dir, written).split(path.sep).join('/'), '.deeptest/hooks/witness-playwright.ts', 'the fixture is DeepTest output, not a project file');
  const text = fs.readFileSync(written, 'utf8');
  assert.match(text, /import \{ test as base \} from '@playwright\/experimental-ct-vue'/);
  assert.match(text, /export \* from '@playwright\/experimental-ct-vue'/, 'the fixture is the package, whole, with test replaced');
  assert.doesNotMatch(text, /__PACKAGE__/);
  assert.equal(fs.existsSync(path.join(fixture, '.deeptest')), false, 'the port commits nothing of DeepTest\'s');
  assert.deepEqual(playwrightComponentTests(fixture, { testsPath: '', sourceRoot: 'src', fields: {} }).sort(), ['src/components/Greeting.spec.tsx', 'src/components/NameTag.spec.tsx']);
  for (const spec of playwrightComponentTests(fixture, { testsPath: '', sourceRoot: 'src', fields: {} })) {
    assert.match(fs.readFileSync(path.join(fixture, spec), 'utf8'), /from '@playwright\/experimental-ct-react'/, `${spec} imports the package, not a DeepTest file`);
  }
  const wrapper = playwrightWrapperConfig(dir, 'playwright-ct.config.ts');
  assert.match(wrapper, /^import base from "file:\/\/\//m);
  assert.match(wrapper, /ctCacheDir: path\.join\(here, 'playwright-cache'\)/, 'its own build cache, since Playwright would reuse a bundle built without the plugin');
  assert.match(wrapper, /testDir: abs\(base\.testDir \?\? '\.'\)/);
  assert.deepEqual(parsePlaywrightSummary('  10 passed (2.5s)\n', 0), { passed: 10, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  assert.deepEqual(parsePlaywrightSummary('  1 failed\n  1 flaky\n  2 skipped\n  7 passed (3.1s)\n', 1), { passed: 8, failed: 1, errors: 0, skipped: 2, exitCode: 1 });
  assert.equal(parsePlaywrightSummary("Error: browserType.launch: Executable doesn't exist", 1).errors, 1);
  // Two tests in one worker, each with its page's counters: attribution per test, whole run as the sum.
  const attr = path.join(dir, 'attr');
  const cov = path.join(dir, 'cov');
  fs.mkdirSync(attr);
  const maps = { path: '/p/src/greet.ts', statementMap: { '0': { start: { line: 4, column: 2 }, end: { line: 4, column: 9 } }, '1': { start: { line: 7, column: 2 }, end: { line: 7, column: 9 } } }, fnMap: { '0': {} }, branchMap: { '0': { locations: [{}, {}] } } };
  const page = (s: number[], b: number[], f: number) => ({ '/p/src/greet.ts': { ...maps, s: { '0': s[0], '1': s[1] }, f: { '0': f }, b: { '0': b } } });
  fs.writeFileSync(path.join(attr, 'coverage-pw-1.pwcov'), `${JSON.stringify({ test: 'a.spec.tsx::one', coverage: page([1, 1], [1, 0], 1) })}\n${JSON.stringify({ test: 'a.spec.tsx::two', coverage: page([0, 2], [0, 2], 2) })}\n`);
  mergePlaywrightRecords(attr, cov);
  mergeWitnessReports(cov);
  const merged = JSON.parse(fs.readFileSync(path.join(cov, 'coverage-final.json'), 'utf8')) as Record<string, { s: Record<string, number>; b: Record<string, number[]>; f: Record<string, number> }>;
  assert.deepEqual(merged['/p/src/greet.ts'].s, { '0': 1, '1': 3 });
  assert.deepEqual(merged['/p/src/greet.ts'].b, { '0': [1, 2] });
  assert.deepEqual(merged['/p/src/greet.ts'].f, { '0': 3 });
  const records = fs.readFileSync(path.join(attr, 'attr-witness-playwright.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { test: string; files: Record<string, number[]>; outcomes: Record<string, Record<string, number[]>> });
  assert.deepEqual(records.map((r) => [r.test, r.files['/p/src/greet.ts'], r.outcomes['/p/src/greet.ts']]), [
    ['a.spec.tsx::one', [4, 7], { '0': [0] }],
    ['a.spec.tsx::two', [7], { '0': [1] }],
  ]);
});
