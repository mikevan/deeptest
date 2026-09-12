/**
 * Witness: the instrumenter, the runtime, and the loader.
 *
 * Three kinds of proof. The instrumenter's rewrite must be a valid program
 * (node --check) with the counters where the rules put them. The maps must
 * agree with istanbul-lib-instrument, line for line, on every fixture and
 * on DeepTest's own source: that differential test is the gate everything
 * else stands on. And a program run under the loader must report the
 * lines, decisions, and functions each test touched, in ES modules and in
 * CommonJS, through one hook.
 */
import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoWasmDir } from '../src/languages/shared/treeSitter';
import { createInstrumenter, WitnessInstrumenter } from '../src/witness/hook';
import { nodeSupportsWitness, parseMochaSummary, detectRunner, witnessUniverse, detectPlaywrightCt, writePlaywrightFixture, playwrightTestsImportingFixture, playwrightWrapperConfig, parsePlaywrightSummary, mergePlaywrightRecords, mergeWitnessReports } from '../src/languages/typescript/coverage';
import { runtimeEnvironment } from '../src/languages/shared/runtime';

let witness: WitnessInstrumenter;
const wasmDir = repoWasmDir();

beforeAll(async () => {
  witness = await createInstrumenter(wasmDir);
});

function check(code: string, ext = '.mjs'): void {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'witness-check-')), `x${ext}`);
  fs.writeFileSync(file, code);
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

test('the rewrite keeps every line where it was and stays a valid program', () => {
  const source = fs.readFileSync(path.join('test', 'fixtures', 'helloworld-react-jest', 'src', 'greet.js'), 'utf8');
  const out = witness.instrument('/p/greet.js', source);
  assert.equal(out.code.split('\n').length, source.split('\n').length, 'same line count');
  check(out.code);
  assert.deepEqual(Object.values(out.maps.statementMap).map((s) => s.start.line), [4, 5, 7, 11, 12, 14, 15, 17, 21]);
  assert.deepEqual(Object.values(out.maps.fnMap).map((f) => `${f.name}@${f.line}`), ['hello@3', 'helloMany@10', 'shout@20']);
  assert.deepEqual(Object.values(out.maps.branchMap).map((b) => `${b.type}@${b.line}`), ['default-arg@3', 'if@4', 'if@11', 'if@14']);
  assert.match(out.code, /^const __witness_\w+ = globalThis\.__witness__\.file\("__witness_\w+"\);/);
  assert.deepEqual(out.maps.skipped, []);
});

test('every statement shape the rules name: bodies get braces, values get wrapped, labels stay on their loops', () => {
  const source = [
    "'use strict';",
    'function f(a = 1, { b } = {}) { if (a) return 1; else if (b) { x = a && b || c; } else x = a ? 1 : 2; }',
    'const g = (x) => x * 2, h = function () {};',
    'class A { y = 3; static z = () => 1; m() { switch (y) { case 1: break; default: return; } } }',
    'let u = 0; for (const q of qs) q(); outer: while (u) do u--; while (u);',
    'a ??= b; for (let i = 0; i < 2; i++) if (i) continue; else break;',
    'const o = { k: function () { return 1; }, [c]: () => ({ n: 1 }) };',
    'export default class {}',
    'export const k = 1;',
  ].join('\n');
  const out = witness.instrument('/p/shapes.mjs', source);
  check(out.code);
  assert.match(out.code, /^'use strict';const __witness_/, 'the prologue follows the directive');
  assert.match(out.code, /if \(\(__witness_\w+\.b\(\d+, a\)\)\) \{__witness_\w+\.s\(\d+\);return 1;\} else if \(\(__witness_\w+\.s\(\d+\), __witness_\w+\.b\(\d+, b\)\)\)/, "an else-if keeps its else; its statement counter rides in the condition");
  assert.match(out.code, /outer: while \(u\) \{__witness_\w+\.s\(\d+\);do \{__witness_\w+\.s\(\d+\);u--;\} while \(u\);\}/, 'the label stays on its loop, the loop under it carries no counter of its own');
  assert.match(out.code, /__witness_\w+\.s\(\d+\);a \?\?= b;/, 'logical assignment is a statement, not an Istanbul branch');
  assert.match(out.code, /const g = __witness_\w+\.v\(\d+, "g", \(x\) => \(__witness_\w+\.f\(\d+\), __witness_\w+\.s\(\d+\), x \* 2\)\)/);
  assert.match(out.code, /case 1:__witness_\w+\.c\(\d+, 0\);/);
  assert.match(out.code, /default:__witness_\w+\.c\(\d+, 1\);/);
  const types = Object.values(out.maps.branchMap).map((b) => b.type);
  assert.deepEqual(types.filter((t) => t === 'default-arg').length, 2);
  assert.ok(types.includes('switch') && types.includes('cond-expr') && types.includes('binary-expr') && types.includes('if'));
  assert.deepEqual(out.maps.skipped, []);
});

test('a TypeScript non-null assertion after a logical operator is blanked before parsing (tree-sitter-typescript issue 299)', () => {
  const source = "export function f(a: A | null, b: B | null): boolean {\n  return Boolean(a) && b!.kind === 'x' || a!.kind === 'y';\n}\n";
  const out = witness.instrument('/p/nn.ts', source);
  assert.deepEqual(out.maps.skipped, []);
  const run = Object.values(out.maps.branchMap).find((b) => b.type === 'binary-expr');
  assert.ok(run);
  assert.equal(run.locations.length, 3, 'three operands, as istanbul reads it');
  assert.match(out.code, /b \.kind === 'x'/, 'the assertion is gone from the rewrite; it meant nothing at run time');
  assert.equal(out.code.split('\n').length, source.split('\n').length);
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

/**
 * A hooks folder the way the driver makes one in a project: the plain hook
 * files plus the bundled instrumenter, because in a real project DeepTest's
 * node_modules is not there. The bundle is built here from the current
 * source every time: the tests run before the build, so dist/hooks holds
 * the previous release's bundle, and a test against that would pass or
 * fail on the wrong code (it did, once). DEEPTEST_TEST_BUNDLE names a
 * prebuilt one for a harness that cannot run esbuild.
 */
function hooksFolder(dir: string): string {
  const hooks = path.join(dir, 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  for (const f of ['witness.cjs', 'witness-loader.mjs', 'witness-vite.mjs', 'witness-playwright.template.ts']) {
    fs.copyFileSync(path.join('hooks', f), path.join(hooks, f));
  }
  const bundle = process.env.DEEPTEST_TEST_BUNDLE;
  if (!bundle) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const esbuild = require('esbuild') as { buildSync: (o: unknown) => void };
    esbuild.buildSync({
      entryPoints: ['src/witness/hook.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      outfile: path.join(hooks, 'witness-instrument.cjs'),
      plugins: [],
      alias: { 'web-tree-sitter': path.resolve('node_modules/web-tree-sitter/web-tree-sitter.cjs') },
      logLevel: 'silent',
    });
  } else {
    fs.copyFileSync(bundle, path.join(hooks, 'witness-instrument.cjs'));
  }
  return hooks;
}

test('the loader: ES modules and CommonJS through one hook, with lines, outcomes, and entries per test', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-run-'));
  const hooks = hooksFolder(dir);
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'esm.mjs'), 'export function pick(n) {\n  if (n > 0) {\n    return "pos";\n  } else if (n < 0) {\n    return "neg";\n  }\n  return "zero";\n}\n');
  fs.writeFileSync(path.join(src, 'cjs.cjs'), 'function twice(n = 1) {\n  return n * 2;\n}\nmodule.exports = { twice };\n');
  fs.writeFileSync(path.join(src, 'never.mjs'), 'export function unused(a) {\n  return a && a.b;\n}\n');
  // The villain, instrumented under src/ and untouched under plain/: the two
  // must agree on every input, or the rewrite changed the program.
  const villain = fs.readFileSync(path.join('test', 'fixtures', 'helloworld-react-vitest', 'src', 'schedule.ts'), 'utf8');
  fs.writeFileSync(path.join(src, 'schedule.ts'), villain);
  fs.mkdirSync(path.join(dir, 'plain'));
  fs.writeFileSync(path.join(dir, 'plain', 'schedule.ts'), villain);
  fs.writeFileSync(
    path.join(dir, 'run.mjs'),
    [
      "import { pick } from './src/esm.mjs';",
      "import { pickGreeting } from './src/schedule.ts';",
      "import { pickGreeting as plain } from './plain/schedule.ts';",
      "import { createRequire } from 'node:module';",
      "const { twice } = createRequire(import.meta.url)('./src/cjs.cjs');",
      "globalThis.__witness__.begin('t1'); pick(1); globalThis.__witness__.end();",
      "globalThis.__witness__.begin('t2'); pick(-1); twice(); globalThis.__witness__.end();",
      "globalThis.__witness__.begin('t3');",
      'let checked = 0;',
      "for (const hour of [0, 9, 12, 15, 18, 23]) for (const lang of ['en', 'es', 'fr', 'xx']) for (const formal of [true, false]) for (const mood of ['great', 'bad', 'ok', 'tired']) for (const name of ['Jeff', '']) {",
      '  const a = pickGreeting(hour, name, lang, formal, mood); const b = plain(hour, name, lang, formal, mood);',
      "  if (a !== b) throw new Error(`instrumented ${JSON.stringify(a)} vs plain ${JSON.stringify(b)} for ${[hour, name, lang, formal, mood]}`);",
      '  checked += 1;',
      '}',
      "globalThis.__witness__.end();",
      "console.log('checked ' + checked);",
      '',
    ].join('\n'),
  );
  const attr = path.join(dir, 'attr');
  const cov = path.join(dir, 'cov');
  fs.mkdirSync(attr);
  // Node strips the types itself (--experimental-strip-types, on by default from 23.6), so a .ts villain runs as written.
  const stdout = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', pathToFileURL(path.join(hooks, 'witness-loader.mjs')).href, path.join(dir, 'run.mjs')], {
    cwd: dir,
    stdio: 'pipe',
    env: { ...process.env, DEEPTEST_HOOKS_DIR: hooks, DEEPTEST_WASM_DIR: wasmDir, DEEPTEST_SOURCE_ROOT: src, DEEPTEST_COVERAGE_DIR: cov, DEEPTEST_ATTRIBUTION_DIR: attr },
  }).toString();
  assert.match(stdout, /checked 384/, 'the instrumented villain and the plain one agree on every input');
  const parts = fs.readdirSync(cov).filter((f) => /^coverage-\d+\.json$/.test(f));
  assert.equal(parts.length, 1, 'one report per process');
  const report = JSON.parse(fs.readFileSync(path.join(cov, parts[0]), 'utf8')) as Record<string, { s: Record<string, number>; b: Record<string, number[]>; f: Record<string, number> }>;
  const key = (name: string) => Object.keys(report).find((k) => k.endsWith(name))!;
  assert.ok(key('esm.mjs') && key('cjs.cjs'), Object.keys(report).join(', '));
  assert.equal(key('never.mjs'), undefined, 'a file nobody loaded is not in the run report; the driver adds it from the same maps');
  assert.equal(key('plain/schedule.ts'), undefined, 'outside the source root, untouched');
  const villainCov = report[key('src/schedule.ts')];
  assert.ok(Object.values(villainCov.s).every((n) => n > 0), 'the grid reaches every statement of the villain');
  assert.deepEqual(report[key('esm.mjs')].b['0'], [1, 1], 'the first if went each way once');
  assert.deepEqual(report[key('esm.mjs')].b['1'], [1, 0], 'the else-if went true once, false never');
  assert.deepEqual(report[key('cjs.cjs')].b['0'], [1], 'the default parameter was used once');
  assert.equal(report[key('cjs.cjs')].f['0'], 1);
  const records = fs.readdirSync(attr).flatMap((f) => fs.readFileSync(path.join(attr, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { test: string; files: Record<string, number[]>; outcomes: Record<string, Record<string, number[]>>; entered: Record<string, number[]> }));
  const byTest = Object.fromEntries(records.map((r) => [r.test, r]));
  const rel = (r: Record<string, unknown>, name: string) => r[Object.keys(r).find((k) => k.endsWith(name))!];
  assert.deepEqual(rel(byTest.t1.files, 'esm.mjs'), [2, 3]);
  assert.deepEqual(rel(byTest.t2.files, 'esm.mjs'), [2, 4, 5]);
  assert.deepEqual(rel(byTest.t2.files, 'cjs.cjs'), [2]);
  assert.deepEqual(rel(byTest.t1.outcomes, 'esm.mjs'), { '0': [0] });
  assert.deepEqual(rel(byTest.t2.outcomes, 'esm.mjs'), { '0': [1], '1': [0] });
  assert.deepEqual(rel(byTest.t2.outcomes, 'cjs.cjs'), { '0': [0] });
  assert.deepEqual(rel(byTest.t1.entered, 'esm.mjs'), [0]);
  assert.equal(byTest.t1.files[Object.keys(byTest.t1.files).find((k) => k.endsWith('cjs.cjs')) ?? ''], undefined, 't1 never touched the CommonJS file');
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

test('the Vite plugin: instruments a component build with the maps embedded and puts the runtime in the page', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-vite-'));
  const hooks = hooksFolder(dir);
  const { witnessPlugin } = (await import(pathToFileURL(path.join(hooks, 'witness-vite.mjs')).href)) as { witnessPlugin: (o: { hooksDir: string; wasmDir: string; sourceRoot: string }) => { buildStart(): Promise<void>; transform(code: string, id: string): { code: string } | null; transformIndexHtml(): Array<{ tag: string; children: string }> } };
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  const plugin = witnessPlugin({ hooksDir: hooks, wasmDir, sourceRoot: src });
  await plugin.buildStart();
  const greeting = "import { hello } from '../greet';\nexport function Greeting({ name }: { name: string }) {\n  return <h1>{name ? hello(name) : 'nobody'}</h1>;\n}\n";
  const out = plugin.transform(greeting, path.join(src, 'components', 'Greeting.tsx'));
  assert.ok(out, 'a source under the root is transformed');
  assert.match(out.code, /globalThis\.__witness__\.file\("__witness_\w+", \{"path":/, 'the maps ride in the file: a page cannot be told about it any other way');
  assert.match(out.code, /\(__witness_\w+\.b\(0, name\)\) \? hello\(name\) : 'nobody'/);
  assert.equal(out.code.split('\n').length, greeting.split('\n').length);
  assert.equal(plugin.transform(greeting, path.join(src, 'components', 'Greeting.spec.tsx')), null, 'a spec is left alone');
  assert.equal(plugin.transform(greeting, path.join(dir, 'elsewhere', 'x.tsx')), null, 'outside the root is left alone');
  const tags = plugin.transformIndexHtml();
  assert.equal(tags[0].tag, 'script');
  assert.match(tags[0].children, /globalThis\.__witness__ = witness/, 'the runtime, verbatim, ahead of every module');
});

test('Playwright component tests: detection, the fixture, the wrapper config, the summary, and the merge', () => {
  const fixture = path.join('test', 'fixtures', 'helloworld-react-playwright-ct');
  assert.deepEqual(detectPlaywrightCt(fixture), { package: '@playwright/experimental-ct-react', configFile: 'playwright-ct.config.ts' });
  assert.equal(detectPlaywrightCt(path.join('test', 'fixtures', 'jsproject-jest')), undefined);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-pw-'));
  const written = writePlaywrightFixture(dir, '@playwright/experimental-ct-vue');
  const text = fs.readFileSync(written, 'utf8');
  assert.match(text, /from '@playwright\/experimental-ct-vue'/);
  assert.doesNotMatch(text, /__PACKAGE__/);
  assert.equal(fs.readFileSync(path.join(fixture, '.deeptest', 'witness-playwright.ts'), 'utf8'), fs.readFileSync(path.join(runtimeEnvironment().hooksDir, 'witness-playwright.template.ts'), 'utf8').split('__PACKAGE__').join('@playwright/experimental-ct-react'), 'the fixture in HelloWorlds is the template, filled in');
  const importing = playwrightTestsImportingFixture(fixture, { testsPath: '', sourceRoot: 'src', fields: {} });
  assert.deepEqual(importing, { total: 2, withFixture: 2, exampleImport: './.deeptest/witness-playwright' });
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'deep', 'a.spec.tsx'), "import { test } from '@playwright/experimental-ct-vue';");
  const none = playwrightTestsImportingFixture(dir, { testsPath: '', sourceRoot: 'src', fields: {} });
  assert.deepEqual(none, { total: 1, withFixture: 0, exampleImport: '../../.deeptest/witness-playwright' }, 'the example import is relative to the spec that lacks it');
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
