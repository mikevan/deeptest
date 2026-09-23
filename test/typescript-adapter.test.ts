import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TypeScriptCoverageSource, buildCoverages, detectRunner, findVitestConfig, guessSourceRoot, guessTestsPath, isTestFile, parseJestSummary, parseVitestSummary, walkSources, angularCliBin, parseKarmaSummary, angularKarmaConfig, clearWorkDir, readTsPaths, renameTestFiles, writeShadowTsConfig, reconcile, parseAttribution, readUnmeasured, witnessTransform, userFacingFailure, DiagnosedError } from '../src/languages/typescript/coverage';
import { typescriptPlugin } from '../src/languages/typescript';
import { upstreamPathFailure } from '@projectrevivesolutions/witness';
import { detectAngularBuilder, detectAngularKarmaConfig, detectAngularRunner, detectAngularRunnerConfig, detectFramework, frameworkSentence } from '../src/languages/typescript/framework';
import type { FileCoverage } from '../src/engine/types';
import { guessLanguage } from '../src/detect/language';
import { analyze } from '../src/engine/density';
import { DEFAULT_DEPTH_OPTIONS } from '../src/engine/types';
import { runtimeEnvironment } from '../src/languages/shared/runtime';
import { LanguageSettings } from '../src/languages/types';

const JEST_FIXTURE = path.join(process.cwd(), 'test', 'fixtures', 'jsproject-jest');
const VITEST_FIXTURE = path.join(process.cwd(), 'test', 'fixtures', 'tsproject-vitest');
const settings = (testsPath: string, sourceRoot = '', runner: 'auto' | 'jest' | 'vitest' = 'auto'): LanguageSettings => ({ testsPath, sourceRoot, fields: { runner, extraArgs: '' } });

test('isTestFile: .test / .spec suffixes and __tests__ folders', () => {
  assert.equal(isTestFile('src/a.test.ts'), true);
  assert.equal(isTestFile('src/a.spec.js'), true);
  assert.equal(isTestFile('src/a.test.tsx'), true);
  assert.equal(isTestFile('src/__tests__/a.ts'), true);
  assert.equal(isTestFile('src/a.ts'), false);
  assert.equal(isTestFile('src/tests.ts'), false);
});

test('walkSources skips node_modules and build output, drops .d.ts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-ts-'));
  fs.mkdirSync(path.join(dir, 'src', 'node_modules', 'x'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), '');
  fs.writeFileSync(path.join(dir, 'src', 'a.d.ts'), '');
  fs.writeFileSync(path.join(dir, 'src', 'b.mjs'), '');
  fs.writeFileSync(path.join(dir, 'src', 'node_modules', 'x', 'i.js'), '');
  fs.writeFileSync(path.join(dir, 'dist', 'a.js'), '');
  assert.deepEqual(walkSources(dir).sort(), ['src/a.ts', 'src/b.mjs']);
});

test('detectRunner reads package.json and prefers the test script when both are present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-ts-'));
  assert.equal(detectRunner(dir), undefined);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '1' } }));
  assert.equal(detectRunner(dir), 'jest');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '1', vitest: '1' }, scripts: { test: 'jest' } }));
  assert.equal(detectRunner(dir), 'jest');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '1', vitest: '1' }, scripts: { test: 'vitest run' } }));
  assert.equal(detectRunner(dir), 'vitest');
  assert.equal(detectRunner(JEST_FIXTURE), 'jest');
  assert.equal(detectRunner(VITEST_FIXTURE), 'vitest');
});

test('config and folder guesses', () => {
  assert.equal(findVitestConfig(VITEST_FIXTURE), 'vitest.config.ts');
  assert.equal(findVitestConfig(JEST_FIXTURE), undefined);
  assert.equal(guessTestsPath(JEST_FIXTURE), 'test');
  assert.equal(guessSourceRoot(JEST_FIXTURE, 'test'), 'src');
});

test('summary parsers', () => {
  assert.deepEqual(parseJestSummary('Tests:       1 failed, 3 passed, 1 skipped, 5 total\n', 1), { passed: 3, failed: 1, errors: 0, skipped: 1, exitCode: 1 });
  assert.deepEqual(parseJestSummary('nothing', 0), { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  assert.deepEqual(parseVitestSummary('      Tests  1 failed | 2 passed (3)\n', 1), { passed: 2, failed: 1, errors: 0, skipped: 0, exitCode: 1 });
  assert.deepEqual(parseVitestSummary('      Tests  3 passed (3)\n', 0), { passed: 3, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  assert.deepEqual(parseVitestSummary('\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n', 0), { passed: 3, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  assert.deepEqual(parseVitestSummary('No test files found', 1), { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode: 1 });
});

test('buildCoverages: executable universe from Istanbul, tests from the hook, test files and node_modules dropped', () => {
  const root = '/w';
  const finalJson = JSON.stringify({
    '/w/src/a.js': { path: '/w/src/a.js', statementMap: { '0': { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } }, '1': { start: { line: 4, column: 0 }, end: { line: 4, column: 5 } } }, s: { '0': 1, '1': 0 } },
    '/w/test/a.test.js': { path: '/w/test/a.test.js', statementMap: { '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } } }, s: { '0': 1 } },
    '/w/node_modules/x/i.js': { path: '/w/node_modules/x/i.js', statementMap: {}, s: {} },
  });
  const attribution = [JSON.stringify({ test: 'test/a.test.js::t1', files: { '/w/src/a.js': [2] } }), '', 'not json', JSON.stringify({ test: 'test/a.test.js::t2', files: { '/w/src/a.js': [2, 4] } })];
  const out = buildCoverages(root, finalJson, attribution);
  assert.deepEqual(out.map((f) => f.path), ['src/a.js']);
  const a = out[0];
  assert.deepEqual(Array.from(a.lines.get(2) ?? []).sort(), ['test/a.test.js::t1', 'test/a.test.js::t2']);
  assert.deepEqual(Array.from(a.lines.get(4) ?? []), ['test/a.test.js::t2']);
  assert.deepEqual(Array.from(a.executed).sort(), [2, 4]);
});

test('plugin detect fills runner, tests folder, source root, and test files', async () => {
  const d = await typescriptPlugin.detect(JEST_FIXTURE, { activeLanguageId: undefined, extensionApi: async () => undefined });
  assert.equal(d.testsPath, 'test');
  assert.equal(d.sourceRoot, 'src');
  assert.deepEqual(d.testFiles, ['test/calc.test.js']);
  assert.match(d.notes[0], /Found jest/);
  const v = await typescriptPlugin.detect(VITEST_FIXTURE, { activeLanguageId: undefined, extensionApi: async () => undefined });
  assert.match(v.notes[0], /Found vitest \(configured in vitest\.config\.ts\)/);
});

test('discoverTests and checkEnvironment on the fixtures', async () => {
  const source = new TypeScriptCoverageSource({});
  assert.deepEqual(await source.discoverTests({ workspaceRoot: JEST_FIXTURE, settings: settings('test') }), ['test/calc.test.js']);
  assert.deepEqual(await source.discoverTests({ workspaceRoot: JEST_FIXTURE, settings: settings('src') }), []);
  const env = await source.checkEnvironment({ workspaceRoot: JEST_FIXTURE, settings: settings('test'), log: () => undefined });
  assert.equal(env.ok, true, env.problems.join(' '));
  assert.match(env.summary, /jest \d/);
  const none = await source.checkEnvironment({ workspaceRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'nr-')), settings: settings(''), log: () => undefined });
  assert.equal(none.ok, false);
  assert.ok(none.fix);
});

async function endToEnd(fixture: string, expectedTestIds: string[], line25: 'declaration' | 'untested'): Promise<string[]> {
  const source = typescriptPlugin.createCoverageSource();
  const log: string[] = [];
  const run = await source.run({ workspaceRoot: fixture, settings: settings('test', 'src'), log: (l) => log.push(l) });
  assert.equal(run.tests.passed, 3, log.join('\n'));
  assert.equal(run.tests.failed, 0);
  // Every test that finished left its record, every record carried a file, the
  // code under test actually ran, and none was cut off (1.0.14, 1.0.15).
  assert.deepEqual(run.evidence, { testsFinished: 3, testsRecorded: 3, recordsWithEvidence: 3, filesWithHits: 1, brokenBoundaries: 0, reconcilable: true }, log.join('\n'));
  const calcPath = run.measuredFiles.find((f) => /src\/calc\.[jt]s$/.test(f));
  assert.ok(calcPath, `calc not measured: ${run.measuredFiles.join(', ')}`);
  const calc = run.coverages.find((c) => c.path === calcPath)!;
  assert.deepEqual(Array.from(calc.lines.get(4) ?? []), [expectedTestIds[0]]);
  assert.deepEqual(Array.from(calc.lines.get(2) ?? []).sort(), expectedTestIds.slice(0, 2).sort());
  assert.deepEqual(Array.from(calc.lines.get(8) ?? []), []);
  assert.equal(calc.executed.has(25), true, 'module-level statement executed at import');
  assert.deepEqual(Array.from(calc.lines.get(25) ?? []), [], 'but under no test');

  const structureSource = await typescriptPlugin.createStructureSource({ wasmDir: runtimeEnvironment().wasmDir });
  const structure = structureSource.analyze(calcPath, fs.readFileSync(path.join(fixture, calcPath), 'utf8'), DEFAULT_DEPTH_OPTIONS);
  structureSource.dispose();
  const result = analyze([calc], [structure]);
  const byLine = new Map(result.files[0].lines.map((l) => [l.line, l]));
  assert.equal(byLine.get(2)?.status, 'over');
  assert.equal(byLine.get(3)?.status, 'met');
  assert.equal(byLine.get(4)?.status, 'short');
  assert.equal(byLine.get(7)?.status, 'untested');
  assert.equal(byLine.get(7)?.bar, 3);
  assert.equal(byLine.get(10)?.status, 'untested');
  assert.equal(byLine.get(22)?.status, 'unreachable');
  // Jest fixture: `module.exports = ...` runs at import (declaration). Vitest fixture: a one-line arrow
  // `export const add = (a, b) => a + b` whose body no test ever calls (untested, though executed at import).
  assert.equal(byLine.get(25)?.status, line25);
  assert.equal(result.shortfalls[0].line, 7);
  assert.deepEqual(byLine.get(7)?.route.steps.map((s) => [s.condition, s.outcome]), [
    ['x > 0', 'is false'],
    ['y > 0', 'is true'],
    ['x === 0', 'is also true'],
  ]);
  fs.rmSync(path.join(fixture, '.deeptest'), { recursive: true, force: true });
  return log;
}

test('end to end with Jest', { timeout: 120_000 }, async () => {
  await endToEnd(JEST_FIXTURE, ['test/calc.test.js::classify both', 'test/calc.test.js::classify x only', 'test/calc.test.js::safeDiv'], 'declaration');
});

test('end to end with Vitest (source-mapped TypeScript)', { timeout: 120_000 }, async () => {
  await endToEnd(VITEST_FIXTURE, ['test/calc.test.ts::classify > both', 'test/calc.test.ts::classify > x only', 'test/calc.test.ts::safeDiv'], 'untested');
});

test('end to end with Vitest from a project outside the repository: the hook is loaded from the project, not the install folder', { timeout: 120_000 }, async () => {
  // Vite refuses a setup file outside the project root (server.fs.allow). The
  // repository's fixtures sit under the repository root, so the suite never
  // saw it; a real project never contains the extension's install folder.
  // The hook is therefore copied into <project>/.deeptest/hooks and loaded
  // from there. This test runs the fixture from a temporary folder whose only
  // link to the repository is node_modules, which is exactly a user's shape.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-vitest-'));
  fs.cpSync(VITEST_FIXTURE, tmp, { recursive: true, filter: (p) => !p.includes('node_modules') });
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(tmp, 'node_modules'), 'junction');
  const log = await endToEnd(tmp, ['test/calc.test.ts::classify > both', 'test/calc.test.ts::classify > x only', 'test/calc.test.ts::safeDiv'], 'untested');
  // endToEnd cleans the project's .deeptest folder when it is done, so the
  // evidence is the log: the hook was copied into the project, and the
  // wrapper config the runner was given points at that copy.
  const hookDir = path.join(tmp, '.deeptest', 'hooks');
  assert.ok(log.some((l) => l === `Hook copied into ${hookDir}.`), `no copy line in the log:\n${log.join('\n')}`);
  assert.ok(log.some((l) => l.includes('--config') && l.includes(path.join(tmp, '.deeptest', 'vitest.config.mjs'))), 'the wrapper config lives in the project');
});

test('witnessTransform wraps every entry the project has and keeps its patterns', () => {
  const ours = 'C:\\p\\.deeptest\\hooks\\witness-jest-transform.cjs';
  // What `jest --showConfig` resolves to, including the default babel-jest a
  // project that configures nothing still gets.
  const table = witnessTransform(
    [
      ['\\.[jt]sx?$', '/n/babel-jest/build/index.js', {}],
      ['\\.svg$', '/n/svg-transformer.js', { icon: true }],
    ],
    ours,
  );
  assert.deepEqual(Object.keys(table ?? {}), ['\\.[jt]sx?$', '\\.svg$'], "the project's own patterns, untouched and in order");
  assert.deepEqual(table?.['\\.[jt]sx?$'], [ours, { upstream: ['/n/babel-jest/build/index.js', {}] }]);
  assert.deepEqual(table?.['\\.svg$'], [ours, { upstream: ['/n/svg-transformer.js', { icon: true }] }], "a project that transforms other file types keeps doing so, with its options");

  // Nothing to wrap means nothing would be measured, and the driver refuses
  // rather than running blind.
  assert.equal(witnessTransform(undefined, ours), undefined);
  assert.equal(witnessTransform([], ours), undefined);
  assert.equal(witnessTransform([['\\.js$', undefined as unknown as string, {}]], ours), undefined, 'an entry Jest did not resolve to a path is not guessed at');
});

test('reconcile: the runner\'s count against the hooks\' records, and a broken boundary counted', () => {
  const t = { passed: 3, failed: 1, errors: 0, skipped: 2, exitCode: 1 };
  const rec = (test: string, boundary?: 'overlapped' | 'unterminated') => ({ test, files: {}, ...(boundary ? { boundary } : {}) });
  const hit = (p: string): FileCoverage => ({ path: p, lines: new Map([[1, new Set(['a'])]]), executed: new Set([1]) });
  const cold = (p: string): FileCoverage => ({ path: p, lines: new Map([[1, new Set<string>()]]), executed: new Set<number>() });
  assert.deepEqual(reconcile(t, [rec('a'), rec('b'), rec('c'), rec('d')]), { testsFinished: 4, testsRecorded: 4, recordsWithEvidence: 0, filesWithHits: 0, brokenBoundaries: 0, reconcilable: true });
  assert.deepEqual(reconcile(t, [rec('a'), rec('b')]), { testsFinished: 4, testsRecorded: 2, recordsWithEvidence: 0, filesWithHits: 0, brokenBoundaries: 0, reconcilable: true }, 'skipped tests are not expected to leave a record; finished ones are');
  // What the counts mean when the records carry something and the files ran.
  const full = { test: 'a', files: { 'src/x.ts': [1, 2] } };
  assert.deepEqual(reconcile(t, [full, rec('b')], [hit('src/x.ts'), cold('src/y.ts')]), { testsFinished: 4, testsRecorded: 2, recordsWithEvidence: 1, filesWithHits: 1, brokenBoundaries: 0, reconcilable: true });
  assert.deepEqual(reconcile(t, [rec('a', 'overlapped'), rec('b'), rec('c'), rec('d', 'unterminated')]).brokenBoundaries, 2);
  assert.deepEqual(parseAttribution(['', '{"test":"a","files":{}}', 'not json', '{"files":{}}', '{"test":"b","files":{},"boundary":"overlapped"}']).map((r) => `${r.test}:${r.boundary ?? 'clean'}`), ['a:clean', 'b:overlapped'], 'blank, torn, and testless lines are dropped');
});

test('readUnmeasured: the loader\'s and the plugin\'s notes beside the reports, one entry per file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-unmeasured-'));
  assert.deepEqual(readUnmeasured(path.join(dir, 'nowhere')), []);
  fs.writeFileSync(path.join(dir, 'unmeasured-1-0.json'), JSON.stringify([{ path: '/p/a.ts', reason: 'first' }]));
  fs.writeFileSync(path.join(dir, 'unmeasured-vite-9.json'), JSON.stringify([{ path: '/p/a.ts', reason: 'again' }, { path: '/p/b.ts', reason: 'other' }]));
  fs.writeFileSync(path.join(dir, 'unmeasured-torn.json'), '[{"path": "/p/c.ts"');
  fs.writeFileSync(path.join(dir, 'coverage-1-0.json'), '{}');
  assert.deepEqual(readUnmeasured(dir).sort((a, b) => a.path.localeCompare(b.path)), [
    { path: '/p/a.ts', reason: 'again' },
    { path: '/p/b.ts', reason: 'other' },
  ]);
});

test('buildCoverages carries what the instrumenter skipped, and nothing when it skipped nothing', () => {
  const root = process.cwd();
  const abs = path.join(root, 'src', 'x.ts');
  const final = JSON.stringify({
    [abs]: { path: abs, statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } } }, s: { 0: 1 }, skipped: [{ line: 4, reason: 'why' }] },
    [path.join(root, 'src', 'y.ts')]: { path: path.join(root, 'src', 'y.ts'), statementMap: { 0: { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } } }, s: { 0: 0 }, skipped: [] },
  });
  const out = buildCoverages(root, final, []);
  assert.deepEqual(out.map((c) => [c.path, c.skipped]), [
    ['src/x.ts', [{ line: 4, reason: 'why' }]],
    ['src/y.ts', undefined],
  ]);
});

// ---- 1.0.2: the framework is known; single-file components are visible ----

const HW = (port: string) => path.join(process.cwd(), 'test', 'fixtures', `helloworld-${port}`);

test('detectFramework reads package.json and, for Angular, the runner under the ng test builder', () => {
  assert.deepEqual(detectFramework(HW('react-vitest')), { name: 'React', major: '19', configFile: 'vite.config.ts' });
  assert.equal(detectFramework(HW('react-jest'))?.name, 'React');
  assert.deepEqual(detectFramework(HW('vue-vitest')), { name: 'Vue', major: '3', configFile: 'vite.config.ts' });
  assert.deepEqual(detectFramework(HW('svelte-vitest')), { name: 'Svelte', major: '5', configFile: 'svelte.config.js' });
  assert.equal(detectFramework(HW('angular-vitest'))?.angularRunner, 'vitest');
  assert.equal(detectFramework(HW('angular-karma'))?.angularRunner, 'karma');
  assert.equal(detectAngularRunner(HW('angular-karma')), 'karma');
  assert.equal(detectAngularRunner(JEST_FIXTURE), undefined);
  assert.equal(detectFramework(JEST_FIXTURE), undefined, 'a plain project has no framework');
});

test('frameworkSentence names the framework, its major, and the runner', () => {
  assert.equal(frameworkSentence({ name: 'Vue', major: '3' }, 'vitest'), 'Vue 3 with Vitest.');
  assert.equal(frameworkSentence({ name: 'React', major: '19' }, 'jest'), 'React 19 with Jest.');
  assert.equal(frameworkSentence({ name: 'React' }, undefined), 'React.');
  assert.equal(frameworkSentence({ name: 'Angular', major: '22', angularRunner: 'karma' }, undefined), 'Angular 22, tests through ng test with Karma.');
  assert.equal(frameworkSentence({ name: 'Angular', major: '22', angularRunner: 'vitest' }, undefined), 'Angular 22, tests through ng test with Vitest.');
});

test('plugin detect puts the framework first in the notes, and says ng test for Angular', async () => {
  const ctx = { activeLanguageId: undefined, extensionApi: async () => undefined };
  const vue = await typescriptPlugin.detect(HW('vue-vitest'), ctx);
  assert.equal(vue.notes[0], 'Framework: Vue 3 with Vitest.');
  assert.match(vue.notes[1], /Found vitest/);
  const karma = await typescriptPlugin.detect(HW('angular-karma'), ctx);
  assert.equal(karma.notes[0], 'Framework: Angular 22, tests through ng test with Karma.');
  assert.match(karma.notes[1], /ng test.*Karma.*generated Karma config/);
  assert.equal(karma.notes.some((n) => /Install/.test(n)), false, 'no install advice on a Karma project');
  const ng = await typescriptPlugin.detect(HW('angular-vitest'), ctx);
  assert.equal(ng.notes[0], 'Framework: Angular 22, tests through ng test with Vitest.');
  assert.match(ng.notes[1], /DeepTest drives that builder/);
  const plain = await typescriptPlugin.detect(JEST_FIXTURE, ctx);
  assert.equal(plain.notes.some((n) => /^Framework:/.test(n)), false);
});

/**
 * An Angular project with nothing installed, built here rather than borrowed.
 *
 * This used to point at the HelloWorlds ports and lean on their having no
 * node_modules. That held until 1.0.19, when the Angular Karma port had to be
 * installed so the behaviour gate could run a real browser against it, and
 * this test began failing for a reason that said nothing about DeepTest: the
 * CLI really was installed, so the preflight really did pass. A unit test
 * about an uninstalled project has to own the uninstalled project.
 */
function uninstalledAngular(runner: 'karma' | 'vitest'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `deeptest-ng-${runner}-`));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '^22.1.0' }, devDependencies: { '@angular/cli': '^22.1.8' } }));
  fs.writeFileSync(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { architect: { test: { builder: '@angular/build:unit-test', options: { runner } } } } } }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  return root;
}

test('checkEnvironment on an Angular project: both flavours want the CLI installed first, and the older Karma builder is refused (1.0.5)', async () => {
  const source = new TypeScriptCoverageSource({});
  // Nothing is installed in either of these, so both builder paths stop at the
  // CLI and ask for npm install, never for Vitest.
  for (const [flavour, runner] of [['karma', 'Karma'], ['vitest', 'Vitest']] as const) {
    const root = uninstalledAngular(flavour);
    assert.equal(detectAngularRunner(root), flavour, 'the synthetic project is the flavour it claims to be');
    assert.equal(detectAngularBuilder(root), 'unit-test');
    assert.equal(angularCliBin(root), undefined, 'and its CLI really is absent, which is the whole premise');
    const env = await source.checkEnvironment({ workspaceRoot: root, settings: settings('src'), log: () => undefined });
    assert.equal(env.ok, false);
    assert.match(env.summary, /Angular CLI not installed/);
    assert.equal(env.fix?.title, 'Run npm install');
    assert.match(env.problems[0], new RegExp(`"ng test" with ${runner}`));
    assert.doesNotMatch(env.problems.join(' '), /Install Vitest|Install Jest/);
  }
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-legacy-'));
  fs.writeFileSync(path.join(legacy, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '^16.0.0' } }));
  fs.writeFileSync(path.join(legacy, 'angular.json'), JSON.stringify({ projects: { app: { architect: { test: { builder: '@angular-devkit/build-angular:karma' } } } } }));
  assert.equal(detectAngularBuilder(legacy), 'legacy-karma');
  assert.equal(detectAngularRunner(legacy), 'karma');
  const refused = await source.checkEnvironment({ workspaceRoot: legacy, settings: settings('src'), log: () => undefined });
  assert.equal(refused.ok, false);
  assert.equal(refused.summary, 'Angular, the older Karma builder');
  assert.equal(refused.fix, undefined);
  assert.match(refused.problems[0], /@angular-devkit\/build-angular:karma/);
  assert.match(refused.problems[0], /Nothing needs installing\./);
  // These two read angular.json and nothing else, so they are unaffected by
  // whether a port happens to be installed and stay pointed at the real ones.
  assert.equal(detectAngularBuilder(HW('angular-karma')), 'unit-test');
  assert.equal(detectAngularBuilder(JEST_FIXTURE), undefined);
});

/**
 * The preflight has to ask for everything Angular's Karma runner asks for,
 * or it says the environment is ok and then the runner refuses, which is the
 * exact failure 1.0.15 built the preflight to remove.
 *
 * `karma-coverage` is the one that got away. 1.0.17 dropped it on the
 * reasoning that DeepTest had stopped using it for measurement, which was
 * true and beside the point: Angular's builder guards its check with
 * `if (options.coverage)` and `options.coverage` is an object carrying an
 * `enabled` field, so it is truthy with coverage off, and the package is
 * demanded on every run. Nothing in any suite noticed. It shipped in 1.0.17
 * and 1.0.18 and was found by running a real Angular Karma project.
 *
 * So the test withholds each package in turn. It fails if the preflight stops
 * asking for any of them, whatever the reasoning at the time.
 */
test('the Angular Karma preflight asks for every package the builder refuses to start without', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-ngkarma-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: { '@angular/core': '^22.0.0' } }));
  fs.writeFileSync(path.join(dir, 'angular.json'), JSON.stringify({ projects: { app: { architect: { test: { builder: '@angular/build:unit-test', options: { runner: 'karma' } } } } } }));
  const install = (name: string, contents: Record<string, unknown> = { name, version: '1.0.0' }): void => {
    const at = path.join(dir, 'node_modules', ...name.split('/'));
    fs.mkdirSync(at, { recursive: true });
    fs.writeFileSync(path.join(at, 'package.json'), JSON.stringify(contents));
  };
  // The CLI is checked first and by its binary, not by its package.json.
  fs.mkdirSync(path.join(dir, 'node_modules', '@angular', 'cli', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'), '');
  fs.writeFileSync(path.join(dir, 'node_modules', '@angular', 'cli', 'package.json'), JSON.stringify({ name: '@angular/cli', version: '22.1.8' }));

  const required = ['karma', 'karma-jasmine', 'karma-chrome-launcher', 'karma-coverage'] as const;
  for (const name of required) {
    install(name);
  }
  const source = new TypeScriptCoverageSource({});
  const ctx = { workspaceRoot: dir, settings: settings('src'), log: () => undefined };
  const complete = await source.checkEnvironment(ctx);
  assert.equal(complete.ok, true, `a project with all four is ready: ${complete.problems.join(' ')}`);

  for (const name of required) {
    const at = path.join(dir, 'node_modules', name);
    const kept = fs.readFileSync(path.join(at, 'package.json'), 'utf8');
    fs.rmSync(at, { recursive: true, force: true });
    const refused = await source.checkEnvironment(ctx);
    assert.equal(refused.ok, false, `without ${name} the run cannot start, and the check has to say so before the runner does`);
    assert.match(refused.summary, new RegExp(`${name} missing$`));
    assert.equal(refused.fix?.title, `Install ${name}`);
    assert.deepEqual(refused.fix?.args, ['install', '--save-dev', name]);
    install(name, JSON.parse(kept) as Record<string, unknown>);
  }

  // The sentence for this one says both halves out loud, because a person
  // reading "install a coverage package" from a tool that just told them it
  // needs no coverage package deserves to know which of the two is lying.
  fs.rmSync(path.join(dir, 'node_modules', 'karma-coverage'), { recursive: true, force: true });
  const coverage = await source.checkEnvironment(ctx);
  assert.equal(coverage.problems[0], "karma-coverage is required by Angular's Karma runner. DeepTest/Witness does not use it for measurement.");
});

test('parseKarmaSummary reads the last Executed line', () => {
  const ok = 'Chrome Headless 141.0.7390.37 (Linux 0.0.0): Executed 10 of 11 SUCCESS (0 secs / 0.02 secs)\nChrome Headless 141.0.7390.37 (Linux 0.0.0): Executed 11 of 11 SUCCESS (0.029 secs / 0.022 secs)\nTOTAL: 11 SUCCESS\n';
  assert.deepEqual(parseKarmaSummary(ok, 0), { passed: 11, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  const failed = 'Chrome Headless (Linux): Executed 11 of 11 (2 FAILED) (0.03 secs / 0.02 secs)\nTOTAL: 2 FAILED, 9 SUCCESS\n';
  assert.deepEqual(parseKarmaSummary(failed, 1), { passed: 9, failed: 2, errors: 0, skipped: 0, exitCode: 1 });
  const skipped = 'Chrome Headless (Linux): Executed 9 of 11 (skipped 2) SUCCESS (0.03 secs / 0.02 secs)\n';
  assert.deepEqual(parseKarmaSummary(skipped, 0), { passed: 9, failed: 0, errors: 0, skipped: 2, exitCode: 0 });
  assert.deepEqual(parseKarmaSummary('Application bundle generation failed.\n', 1), { passed: 0, failed: 0, errors: 1, skipped: 0, exitCode: 1 });
  const nothing = 'Chrome Headless (Linux) ERROR\n  Error: Cannot find module\nChrome Headless (Linux): Executed 0 of 0 ERROR (0 secs / 0 secs)\n';
  assert.equal(parseKarmaSummary(nothing, 1).errors, 1);
  assert.equal(parseKarmaSummary(nothing, 1).passed, 0);
});

test('the Karma config Angular would load: named, the project karma.conf.js, or none', () => {
  assert.equal(detectAngularKarmaConfig(HW('angular-karma')), undefined, 'the fixture has no karma.conf.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-karma-'));
  const write = (options: unknown, builder = '@angular/build:unit-test') =>
    fs.writeFileSync(path.join(dir, 'angular.json'), JSON.stringify({ projects: { app: { root: '', architect: { test: { builder, options } } } } }));
  write({ runner: 'karma' });
  assert.equal(detectAngularKarmaConfig(dir), undefined, 'no runnerConfig means the built-in defaults');
  write({ runner: 'karma', runnerConfig: true });
  assert.equal(detectAngularKarmaConfig(dir), undefined, 'true but no karma.conf.js');
  fs.writeFileSync(path.join(dir, 'karma.conf.js'), '');
  assert.equal(detectAngularKarmaConfig(dir), 'karma.conf.js');
  fs.writeFileSync(path.join(dir, 'custom.karma.cjs'), '');
  write({ runner: 'karma', runnerConfig: 'custom.karma.cjs' });
  assert.equal(detectAngularKarmaConfig(dir), 'custom.karma.cjs');
  write({ karmaConfig: 'karma.conf.js' }, '@angular-devkit/build-angular:karma');
  assert.equal(detectAngularKarmaConfig(dir), 'karma.conf.js', 'the older builder names it karmaConfig');
});

test('the runner config Angular would load: named in angular.json, the default file, or none', () => {
  assert.equal(detectAngularRunnerConfig(HW('angular-vitest')), undefined, 'the fixture has no runner config');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-ng-'));
  const write = (runnerConfig: unknown) =>
    fs.writeFileSync(path.join(dir, 'angular.json'), JSON.stringify({ projects: { app: { architect: { test: { builder: '@angular/build:unit-test', options: runnerConfig === undefined ? {} : { runnerConfig } } } } } }));
  write(undefined);
  assert.equal(detectAngularRunnerConfig(dir), undefined);
  fs.writeFileSync(path.join(dir, 'vitest-base.config.ts'), '');
  assert.equal(detectAngularRunnerConfig(dir), 'vitest-base.config.ts', 'the default file when the option is absent');
  write(true);
  assert.equal(detectAngularRunnerConfig(dir), 'vitest-base.config.ts');
  write(false);
  assert.equal(detectAngularRunnerConfig(dir), undefined, 'false means no external config');
  fs.writeFileSync(path.join(dir, 'custom.config.mjs'), '');
  write('custom.config.mjs');
  assert.equal(detectAngularRunnerConfig(dir), 'custom.config.mjs');
  write('missing.config.mjs');
  assert.equal(detectAngularRunnerConfig(dir), undefined, 'a named file that does not exist is not imported');
});


test('.vue and .svelte files are walked as sources and are in the plugin\'s extensions', () => {
  const vue = walkSources(HW('vue-vitest'));
  assert.ok(vue.includes('src/components/GreetingPicker.vue'), vue.join(', '));
  assert.ok(vue.includes('src/greet.ts'));
  const svelte = walkSources(HW('svelte-vitest'));
  assert.ok(svelte.includes('src/lib/GreetingPicker.svelte'), svelte.join(', '));
  assert.ok(typescriptPlugin.extensions.includes('.vue'));
  assert.ok(typescriptPlugin.extensions.includes('.svelte'));
  assert.equal(guessLanguage(HW('vue-vitest'))?.language, 'typescript');
  assert.equal(guessLanguage(HW('svelte-vitest'))?.language, 'typescript');
});

test('a single-file component is parsed through its script block on its real lines; the template is declarations (1.0.3)', async () => {
  const structureSource = await typescriptPlugin.createStructureSource({ wasmDir: runtimeEnvironment().wasmDir });
  try {
    const vueRel = 'src/components/GreetingPicker.vue';
    const vue = structureSource.analyze(vueRel, fs.readFileSync(path.join(HW('vue-vitest'), vueRel), 'utf8'), DEFAULT_DEPTH_OPTIONS);
    const villain = vue.functions.find((f) => f.name === 'pickGreeting');
    assert.ok(villain, 'the villain is found inside the .vue file');
    assert.equal(villain.startLine, 13, 'the line in the editor');
    assert.deepEqual([villain.complexity, villain.campbell, villain.mbcc], [27, 73, 97], 'the same villain as every other port');
    assert.equal(vue.depth.get(37), 6);
    assert.deepEqual(vue.routes.get(37)?.map((s) => `${s.condition} ${s.outcome}`), [
      "lang === 'en' is true", 'hour < 12 is false', 'hour < 18 is true', 'formal is true', "mood === 'great' is false", "mood === 'bad' is true",
    ]);
    assert.ok(vue.declarations.has(1), 'the <script> tag line is a declaration');
    assert.ok(vue.declarations.has(109), 'a template line is a declaration');
    assert.equal(vue.depth.has(109), false);

    const svelteRel = 'src/lib/GreetingPicker.svelte';
    const svelte = structureSource.analyze(svelteRel, fs.readFileSync(path.join(HW('svelte-vitest'), svelteRel), 'utf8'), DEFAULT_DEPTH_OPTIONS);
    const sv = svelte.functions.find((f) => f.name === 'pickGreeting');
    assert.ok(sv);
    assert.equal(sv.startLine, 11);
    assert.deepEqual([sv.complexity, sv.campbell, sv.mbcc], [27, 73, 97]);
    assert.ok(svelte.declarations.has(96), 'a <script> tag line is a declaration');
    assert.ok(svelte.declarations.has(101), 'a template line after the last </script> is a declaration');

    // A template-only component: no functions, every line a declaration.
    const plain = structureSource.analyze('src/Plain.vue', '<template>\n  <p>hi</p>\n</template>\n', DEFAULT_DEPTH_OPTIONS);
    assert.equal(plain.functions.length, 0);
    assert.deepEqual(Array.from(plain.declarations).sort((a, b) => a - b), [1, 2, 3, 4]);

    // Through the engine: a template line the runner reports is a declaration (counted for coverage, not density);
    // a script line deep in the villain is untested at the bar its depth sets.
    const lines = new Map<number, Set<string>>([[37, new Set()], [109, new Set()]]);
    const result = analyze([{ path: vueRel, lines, executed: new Set<number>() }], [vue]);
    const byLine = new Map(result.files[0].lines.map((l) => [l.line, l]));
    assert.equal(byLine.get(37)?.status, 'untested');
    assert.equal(byLine.get(37)?.bar, 6);
    assert.equal(byLine.get(109)?.status, 'declaration');
  } finally {
    structureSource.dispose();
  }
});

/**
 * The Angular drivers have no end-to-end test in this suite: running one
 * would mean carrying the whole Angular toolchain in DeepTest's
 * devDependencies. The proof that the path measures anything is the spike
 * that built it, run against a real Angular project with a templateUrl, a
 * styleUrls, an asset reached from the stylesheet and a TypeScript path
 * alias, under both runners; what is pinned here is the part a refactor
 * could quietly change.
 *
 * That distinction is not academic. The version of this test that stood from
 * 1.0.12 to 1.0.14 asserted that the generated Vitest config carried the
 * Witness plugin and no coverage provider, and it passed on every run while
 * that path measured nothing whatsoever: it pinned the string we meant to
 * generate, which was exactly the string we generated. A generated-string
 * test cannot prove a path measures anything, so none of these claim to.
 */
test('the generated Karma config wraps the project\'s own, adds Witness, and keeps the browser headless', () => {
  const generated = angularKarmaConfig({ tool: 'DeepTest', workspaceRoot: path.join('p'), hookDir: path.join('p', '.deeptest', 'hooks'), userConfig: 'karma.conf.js' });
  assert.match(generated, /require\("p\/karma\.conf\.js"\)\(config\);/, "the project's own config is applied first, so its settings are the ones being added to");
  assert.doesNotMatch(generated, /basePath/, 'and the builder\'s defaults are not also set: giving it a config is what takes them away, applying both would fight');
  assert.match(generated, /require\("p\/\.deeptest\/hooks\/witness-karma\.cjs"\)/, 'the plugin, by absolute path, because Karma resolves plugins from its own folder');
  // Asserted line by line. The first version of this checked only that
  // "concat(['witness'])" appeared somewhere, and a mutation that dropped the
  // framework entirely left the reporter's own concat to satisfy it: the
  // runtime would never be served, nothing would be measured, and this test
  // would still have passed.
  assert.match(generated, /frameworks: \(config\.frameworks \|\| \['jasmine'\]\)\.concat\(\['witness'\]\),/, 'the framework serves the runtime ahead of the bundle');
  assert.match(generated, /\.concat\(\['witness'\]\),\n    browsers:/, 'and the reporter writes what the browser sends back');
  assert.match(generated, /filter\(\(r\) => r !== 'kjhtml'\)/, 'kjhtml holds the browser open waiting for a person, and nobody is there');
  assert.match(generated, /b === 'Chrome' \? 'ChromeHeadless' : b/);
  assert.doesNotMatch(generated, /coverageReporter|karma-coverage/, 'Witness instruments before the builder bundles, so Karma\'s own coverage is not involved');

  const bare = angularKarmaConfig({ tool: 'DeepTest', workspaceRoot: '/p', hookDir: '/p/.deeptest/hooks' });
  assert.match(bare, /frameworks: \['jasmine'\],/, 'with no config of its own the project gets the defaults the builder would have applied');
  assert.match(bare, /plugins: \['karma-jasmine', 'karma-chrome-launcher'\]\.map\(\(p\) => projectRequire\(p\)\),/, "resolved from the project, not from DeepTest's own node_modules");
  assert.doesNotMatch(bare, /karma\.conf\.js/);
});

/**
 * The shadow tree runs the copy, so every runner names the copy. The lines in
 * the record already name the original, because the maps carry the original
 * path; without this the card would show test names pointing into a
 * generated folder beside lines pointing into the project.
 */
test('a test id names the spec the person wrote, not the copy that ran', () => {
  const lines = [
    JSON.stringify({ test: '.deeptest/instrumented/app/greeting.spec.ts::Greeting > renders', files: { '/p/src/app/greeting.ts': [14] } }),
    JSON.stringify({ test: 'src/app/other.spec.ts::elsewhere', files: {} }),
    '',
    'not json at all',
  ];
  const out = renameTestFiles(lines, '.deeptest/instrumented/', 'src/');
  assert.equal((JSON.parse(out[0]) as { test: string }).test, 'src/app/greeting.spec.ts::Greeting > renders');
  assert.deepEqual((JSON.parse(out[0]) as { files: unknown }).files, { '/p/src/app/greeting.ts': [14] }, 'only the leading folder moves; the lines were already right');
  assert.equal(out[1], lines[1], 'an id that does not start with the mirror is left exactly as it was');
  assert.equal(out[2], '');
  assert.equal(out[3], 'not json at all', 'a torn line is passed through rather than dropped');
  assert.deepEqual(renameTestFiles(lines, '.deeptest/instrumented/', ''), [JSON.stringify({ test: 'app/greeting.spec.ts::Greeting > renders', files: { '/p/src/app/greeting.ts': [14] } }), lines[1], '', 'not json at all'], 'a project whose source root is the project root gets no prefix put back');
});

/**
 * The folder is emptied by ownership, not by a list of names. Deleting the
 * three folders a run writes meant a generated file DeepTest had stopped
 * producing stayed forever: `.deeptest/vitest.config.mjs` from the Istanbul
 * Angular path outlived the code that wrote it by two deliveries, in every
 * port, still naming a coverage provider.
 */
test('the work folder keeps the decisions and nothing else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-workdir-'));
  const work = path.join(dir, '.deeptest');
  fs.mkdirSync(path.join(work, 'instrumented', 'src'), { recursive: true });
  fs.mkdirSync(path.join(work, 'attribution'), { recursive: true });
  fs.mkdirSync(path.join(work, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(work, 'decisions.json'), '{"version":1}');
  fs.writeFileSync(path.join(work, 'vitest.config.mjs'), "provider: 'istanbul'");
  fs.writeFileSync(path.join(work, 'karma.conf.cjs'), '// generated');
  fs.writeFileSync(path.join(work, 'instrumented', 'src', 'gone.ts'), 'export const x = 1;');

  clearWorkDir(work);

  assert.deepEqual(fs.readdirSync(work), ['decisions.json'], 'the decisions are the person\'s and travel with the code; everything else is rebuilt by the run that follows');
  assert.equal(fs.readFileSync(path.join(work, 'decisions.json'), 'utf8'), '{"version":1}', 'and they are not rewritten on the way past');

  clearWorkDir(path.join(dir, 'never-existed'));
  assert.ok(true, 'a first run has no folder to empty, and that is not an error');
});

/**
 * An alias left pointing at the real source root is the quiet failure this
 * guards: the build succeeds, the aliased module is the uninstrumented one,
 * and every line in it reads as never executed. The spike's `@util/*` case
 * exists for exactly this, and it is the one file in that project reachable
 * only through an alias.
 */
test('the shadow tsconfig repoints aliases into the mirror, and leaves the ones that point elsewhere', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-shadow-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    ['{', '  // a comment, because tsc --init writes them and every Angular project has them', '  "compilerOptions": {', '    "paths": {', '      "@util/*": ["./src/util/*"],', '      "@shared/*": ["./libs/shared/*"],', '    },', '  },', '}'].join('\n'),
  );
  fs.writeFileSync(path.join(dir, 'tsconfig.spec.json'), JSON.stringify({ extends: './tsconfig.json', compilerOptions: { types: ['jasmine'] } }));
  const workDir = path.join(dir, '.deeptest');
  const instrumented = path.join(workDir, 'instrumented');

  const paths = readTsPaths(path.join(dir, 'tsconfig.spec.json')).paths;
  assert.deepEqual(paths['@util/*'], [path.join(dir, 'src', 'util', '*').split(path.sep).join('/')], 'inherited through extends, resolved against the config that declared it');

  const generated = writeShadowTsConfig(workDir, path.join(dir, 'tsconfig.spec.json'), src, instrumented);
  const config = JSON.parse(fs.readFileSync(generated, 'utf8')) as { extends: string; compilerOptions: { paths: Record<string, string[]> }; include: string[] };
  assert.equal(config.extends, '../tsconfig.spec.json', "the project's own test tsconfig, so its types and strictness are the ones in force");
  assert.deepEqual(config.compilerOptions.paths['@util/*'], [path.join(instrumented, 'util', '*').split(path.sep).join('/')], 'inside the source root, so it follows the source into the mirror');
  assert.deepEqual(config.compilerOptions.paths['@shared/*'], [path.join(dir, 'libs', 'shared', '*').split(path.sep).join('/')], 'outside it, so it is left alone, absolute so it does not depend on where this file sits');
  assert.deepEqual(config.include, ['./instrumented/**/*.ts', './instrumented/**/*.tsx'], 'the mirror is what is compiled; the base\'s own include is discarded by having one here at all');

  const none = JSON.parse(fs.readFileSync(writeShadowTsConfig(workDir, path.join(dir, 'tsconfig.json'), src, path.join(workDir, 'i2')), 'utf8')) as { compilerOptions?: unknown };
  assert.ok(none.compilerOptions, 'a config that declares paths directly is read the same way');
  const bare = path.join(dir, 'bare.json');
  fs.writeFileSync(bare, '{}');
  assert.equal((JSON.parse(fs.readFileSync(writeShadowTsConfig(workDir, bare, src, instrumented), 'utf8')) as { compilerOptions?: unknown }).compilerOptions, undefined, 'a project with no aliases gets no paths block invented for it');
});


/**
 * What a person reads on the results panel when a run died before a test.
 *
 * The runner's own reason for an Angular or Playwright build that never
 * started is "produced no coverage, and ended with exit code 1". True, and
 * it sends someone straight to their tests, which are not the problem. When
 * the toolkit placed the failure, its headline stands on its own and the
 * runner's reason goes to the log.
 */
test('a failure the toolkit placed is reported as that, and only that', () => {
  const packet = upstreamPathFailure({
    workspaceRoot: "C:\\workspace\\MikeVan's AI Development Toolkit",
    runner: 'ng-karma',
    output: ['Application bundle generation failed.', "  1 │ import 'C:/workspace/MikeVan's AI Development Toolkit/app/polyfills.js';"].join('\n'),
    succeeded: false,
  })!.packet;
  const reason = 'ng test produced no coverage, and ended with exit code 1. Press "Show the log" to see the test run.';

  const shown = userFacingFailure(reason, packet.headline);
  assert.equal(shown, packet.headline, 'the headline is the message');
  assert.ok(!shown.includes('produced no coverage'), "and the runner's own reason is not glued onto it");
  assert.ok(!shown.includes('\n'), 'one line on the panel, not a report');
});

test('a failure with no diagnosis reads exactly as it always did', () => {
  const reason = 'vitest produced no coverage, and ended with exit code 1. Press "Show the log" to see the test run.';
  assert.equal(userFacingFailure(reason, ''), reason, 'nothing about ordinary failures changed');
});

/**
 * The packet has to survive the throw, or the panel has nothing to build the
 * "Explain with Copilot" offer from and the person is back to a line and a
 * log. This is the seam that carries it.
 */
test('a diagnosed failure carries its packet out to whoever shows it', () => {
  const packet = upstreamPathFailure({
    workspaceRoot: "C:\\workspace\\MikeVan's AI Development Toolkit",
    runner: 'playwright-ct',
    output: ["  Failed to parse code in 'C:/workspace/MikeVan's AI Development Toolkit/playwright/index.ts'", '✗ Build failed in 62ms'].join('\n'),
    succeeded: false,
  })!.packet;
  const err: unknown = new DiagnosedError(packet.headline, packet);

  assert.ok(err instanceof Error, 'it is still an error, and every existing catch still works');
  assert.ok(err instanceof DiagnosedError, 'and the layer that shows it can tell there is more');
  assert.equal((err as DiagnosedError).packet.condition, 'path-character');
  assert.deepEqual((err as DiagnosedError).packet.actions, ['explain'], 'moving a folder is not a code change, so no fix is offered');
  assert.equal((err as Error).message, packet.headline);

  // An ordinary failure is an ordinary Error, and nothing offers to explain it.
  assert.ok(!(new Error('vitest is not installed. Run npm install.') instanceof DiagnosedError));
});
