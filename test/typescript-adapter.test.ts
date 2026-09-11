import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TypeScriptCoverageSource, buildCoverages, detectRunner, findVitestConfig, guessSourceRoot, guessTestsPath, isTestFile, parseJestSummary, parseVitestSummary, walkSources, coverageIstanbulSpec } from '../src/languages/typescript/coverage';
import { typescriptPlugin } from '../src/languages/typescript';
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
  const source = new TypeScriptCoverageSource({ hooksDir: runtimeEnvironment().hooksDir });
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

test('the coverage package install is pinned to the project\'s Vitest major', () => {
  assert.equal(coverageIstanbulSpec('4.1.11'), '@vitest/coverage-istanbul@4');
  assert.equal(coverageIstanbulSpec('3.2.7'), '@vitest/coverage-istanbul@3');
  assert.equal(coverageIstanbulSpec(''), '@vitest/coverage-istanbul');
});
