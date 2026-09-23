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
import { createInstrumenter, DECORATED_FIELD } from '@projectrevivesolutions/witness';
import type { WitnessInstrumenter } from '@projectrevivesolutions/witness';
import { nodeSupportsWitness, parseMochaSummary, detectRunner, witnessUniverse, detectPlaywrightCt, playwrightComponentTests, parsePlaywrightSummary, mergePlaywrightRecords, mergeWitnessReports, writeShadowTree } from '../src/languages/typescript/coverage';
// The Playwright delivery moved into Witness at 1.0.19, because UntangleIt's
// recorded runs need exactly the same fixture and wrapper config.
import { writePlaywrightFixture, playwrightWrapperConfig } from '@projectrevivesolutions/witness';

let witness: WitnessInstrumenter;
const wasmDir = repoWasmDir();

beforeAll(async () => {
  witness = await createInstrumenter(wasmDir);
});

test('differential: the maps agree with istanbul-lib-instrument on every fixture and on DeepTest itself', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createInstrumenter: istanbul } = require('istanbul-lib-instrument') as { createInstrumenter: (o: unknown) => { instrumentSync: (c: string, f: string) => string; lastFileCoverage: () => { statementMap: Record<string, { start: { line: number } }>; fnMap: Record<string, { loc: { start: { line: number } } }>; branchMap: Record<string, { type: string; line: number }> } } };
  // 'hooks' was a third root until 1.0.17, when the last DeepTest hook went away: every hook now ships from the Witness package, whose own suite runs this same differential over them.
  const roots = [path.join('test', 'fixtures'), 'src'];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // The sibling tools' generated folders are skipped alongside DeepTest's
        // own. From 1.0.19 the browser-gate tests leave a .untangleit in two
        // fixtures, and without this the differential would measure UntangleIt's
        // generated hooks and fail for a reason that says nothing about either
        // instrumenter.
        if (!/node_modules|coverage|\.deeptest|\.untangleit|\.keepsafe|test-results|\.angular|dist/.test(entry.name)) {
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
    // The one departure from istanbul, and it is deliberate: a decorated
    // class's field initialiser is left exactly as written, because Angular's
    // compiler rejects any wrapper around it with NG8110. Witness records
    // those lines as skipped instead of counting them, so istanbul having a
    // statement where Witness has a recorded skip is agreement, not drift.
    // Every other skip is still a failure, and a statement Witness invented
    // where istanbul has none still fails, so this cannot hide real drift.
    // The excuse is allowed only in a file that actually carries a decorator.
    // Without that guard, broadening the rule to every class would silently
    // excuse itself and this test would pass on code it is supposed to catch;
    // it did exactly that on the first attempt.
    const hasDecorator = /^[ \t]*@[A-Za-z_$][\w$.]*\s*[({]/m.test(source);
    const excused = new Set(hasDecorator ? ours.skipped.filter((k) => k.reason === DECORATED_FIELD).map((k) => k.line) : []);
    const unexcused = ours.skipped.filter((k) => k.reason !== DECORATED_FIELD || !hasDecorator);
    const oursStatements = lines(ours.statementMap);
    const theirsStatements = lines(i.statementMap).filter((line) => !excused.has(line) || oursStatements.includes(line));
    const same = JSON.stringify([theirsStatements, lines(i.fnMap), branches(i.branchMap)]) === JSON.stringify([oursStatements, lines(ours.fnMap), branches(ours.branchMap)]);
    if (!same || unexcused.length > 0) {
      failures.push(`${file}: statements ${lines(i.statementMap).join(',')} vs ${lines(ours.statementMap).join(',')}; functions ${lines(i.fnMap).join(',')} vs ${lines(ours.fnMap).join(',')}; branches ${branches(i.branchMap).join(' ')} vs ${branches(ours.branchMap).join(' ')}; skipped ${ours.skipped.map((s) => s.line).join(',')}`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('files no test loads get their universe from the same instrumenter', async () => {
  const log: string[] = [];
  const out = await witnessUniverse(process.cwd(), ['test/fixtures/helloworld-react-jest/src/schedule.js', 'test/fixtures/helloworld-angular-karma/src/app/schedule.service.ts', 'test/fixtures/missing.ts'], wasmDir, (l) => log.push(l));
  assert.equal(out.length, 3, log.join('\n'));
  assert.equal(Array.from(out[0].lines.keys()).sort((a, b) => a - b)[0], 13, 'the first if in pickGreeting');
  assert.ok(Array.from(out[1].lines.keys()).includes(13));
  assert.ok(Array.from(out[0].lines.values()).every((s) => s.size === 0));
  assert.match(log[0], /missing\.ts/);
  // Until 1.0.14 the unreadable file was dropped, which made it vanish from
  // the report as if there were nothing to say about it. It is kept, marked.
  assert.equal(out[2].path, 'test/fixtures/missing.ts');
  assert.match(out[2].unmeasured ?? '', /could not be read/);
  assert.equal(out[2].lines.size, 0);
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
  const written = writePlaywrightFixture(path.join(dir, '.deeptest'), '@playwright/experimental-ct-vue');
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
  const wrapper = playwrightWrapperConfig({ tool: 'DeepTest', workspaceRoot: dir, configFile: 'playwright-ct.config.ts' });
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

/**
 * The half of the mirror that is easy to forget. A component names its
 * template and stylesheet by relative path and the stylesheet names an image
 * the same way; mirror only the TypeScript and every one of those dangles.
 */
test('the shadow tree instruments the source and copies everything beside it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-mirror-'));
  const src = path.join(dir, 'src', 'app');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'greeting.ts'), "export function hello(name: string) {\n  return `Hello, ${name}!`;\n}\n");
  fs.writeFileSync(path.join(src, 'greeting.html'), '<h1>{{ text() }}</h1>\n');
  fs.writeFileSync(path.join(src, 'greeting.css'), ".g { background-image: url('./logo.svg'); }\n");
  fs.writeFileSync(path.join(src, 'logo.svg'), '<svg/>\n');
  fs.writeFileSync(path.join(src, 'greeting.spec.ts'), "describe('x', () => {});\n");

  const sourceRoot = path.join(dir, 'src');
  const mirror = path.join(dir, '.deeptest', 'instrumented');
  const log: string[] = [];
  const tree = await writeShadowTree(dir, sourceRoot, mirror, ['src/app/greeting.ts', 'src/app/gone.ts'], repoWasmDir(), (l) => log.push(l));

  const instrumented = fs.readFileSync(path.join(mirror, 'app', 'greeting.ts'), 'utf8');
  assert.match(instrumented, /__witness__\.file\("__witness_\w+", \{"path":/, 'the maps ride in the file: a browser page cannot be told about it any other way');
  assert.ok(instrumented.includes(path.join(sourceRoot, 'app', 'greeting.ts').split(path.sep).join('/')), 'labelled with the original path, so a record names the file in the editor');
  for (const beside of ['greeting.html', 'greeting.css', 'logo.svg', 'greeting.spec.ts']) {
    assert.ok(fs.existsSync(path.join(mirror, 'app', beside)), `${beside} is copied through, or the reference to it dangles`);
  }
  assert.equal(fs.readFileSync(path.join(mirror, 'app', 'greeting.spec.ts'), 'utf8'), "describe('x', () => {});\n", 'a spec is copied, never instrumented: its own lines are not the subject');
  assert.equal(tree.instrumented, 1);
  assert.match(tree.universe.find((c) => c.path === 'src/app/gone.ts')?.unmeasured ?? '', /could not be read/, 'a file the instrumenter could not take is still reported, with the reason, rather than counted as measured');
  assert.ok(!fs.existsSync(path.join(mirror, 'app', 'gone.ts')), 'and nothing is invented in its place');
  assert.deepEqual(Array.from(tree.universe.find((c) => c.path === 'src/app/greeting.ts')!.lines.keys()), [2], 'one walk gives the mirror and the executable lines, so the two cannot disagree');
});
