import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TypeScriptCoverageSource, buildCoverages, detectRunner, findVitestConfig, guessSourceRoot, guessTestsPath, isTestFile, parseJestSummary, parseVitestSummary, walkSources, coverageIstanbulSpec, angularCliBin } from '../src/languages/typescript/coverage';
import { typescriptPlugin } from '../src/languages/typescript';
import { detectAngularRunner, detectAngularRunnerConfig, detectFramework, frameworkSentence } from '../src/languages/typescript/framework';
import { createRequire } from 'node:module';
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
  assert.match(karma.notes[1], /ng test.*Karma/);
  assert.equal(karma.notes.some((n) => /Install/.test(n)), false, 'no install advice on a Karma project');
  const ng = await typescriptPlugin.detect(HW('angular-vitest'), ctx);
  assert.equal(ng.notes[0], 'Framework: Angular 22, tests through ng test with Vitest.');
  assert.match(ng.notes[1], /DeepTest drives that builder/);
  const plain = await typescriptPlugin.detect(JEST_FIXTURE, ctx);
  assert.equal(plain.notes.some((n) => /^Framework:/.test(n)), false);
});

test('checkEnvironment on an Angular project: Karma is refused with no install; Vitest under the builder needs the CLI installed (1.0.4)', async () => {
  const source = new TypeScriptCoverageSource({ hooksDir: runtimeEnvironment().hooksDir });
  const karma = await source.checkEnvironment({ workspaceRoot: HW('angular-karma'), settings: settings('src'), log: () => undefined });
  assert.equal(karma.ok, false);
  assert.equal(karma.summary, 'Angular, ng test with Karma');
  assert.equal(karma.fix, undefined, 'no fix offered on a Karma project');
  assert.match(karma.problems[0], /"ng test" with Karma/);
  assert.match(karma.problems[0], /Nothing needs installing\./);
  assert.doesNotMatch(karma.problems.join(' '), /Install Vitest|Install Jest/);
  // The fixture carries no node_modules, so the builder path stops at the CLI and asks for npm install, never for Vitest.
  const vitest = await source.checkEnvironment({ workspaceRoot: HW('angular-vitest'), settings: settings('src'), log: () => undefined });
  assert.equal(vitest.ok, false);
  assert.match(vitest.summary, /Angular CLI not installed/);
  assert.equal(vitest.fix?.title, 'Run npm install');
  assert.match(vitest.problems[0], /"ng test"/);
  assert.doesNotMatch(vitest.problems.join(' '), /Install Vitest|Install Jest/);
  assert.equal(angularCliBin(HW('angular-vitest')), undefined);
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

test('the hook maps a bundled chunk\'s counters back to the source file through the chunk\'s source map (1.0.4)', () => {
  const hook = createRequire(__filename)(path.join(process.cwd(), 'hooks', 'attribution.cjs')) as {
    originalPosition: (fileCov: unknown, file: string, line: number, column: number) => { file: string; line: number } | undefined;
    decodeMappings: (m: string) => number[][][];
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-map-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x\ny\n');
  // Three generated lines: [0,0,0,0] -> a.ts line 1; [0,0,+1,0] -> a.ts line 2; [0,+1,0,0] -> the builder's virtual module.
  const map = { sources: ['src/a.ts', 'virtual:builder'], mappings: 'AAAA;AACA;ACAA' };
  assert.deepEqual(hook.decodeMappings(map.mappings), [[[0, 0, 0]], [[0, 1, 0]], [[0, 1, 1]]]);
  const chunk = path.join(dir, 'chunk-ABC123.js');
  assert.equal(fs.existsSync(chunk), false, 'the chunk exists nowhere on disk');
  assert.deepEqual(hook.originalPosition({ inputSourceMap: map }, chunk, 1, 0), { file: path.join(dir, 'src', 'a.ts'), line: 1 });
  assert.deepEqual(hook.originalPosition({ inputSourceMap: map }, chunk, 2, 0), { file: path.join(dir, 'src', 'a.ts'), line: 2 });
  assert.equal(hook.originalPosition({ inputSourceMap: map }, chunk, 3, 0), undefined, 'a virtual module is nobody\'s line');
  // A file that is on disk keeps its key and only moves the line (Vite's own transform).
  const onDisk = path.join(dir, 'src', 'a.ts');
  assert.deepEqual(hook.originalPosition({ inputSourceMap: { sources: ['a.ts'], mappings: 'AAAA;AACA' } }, onDisk, 2, 0), { file: onDisk, line: 2 });
  assert.deepEqual(hook.originalPosition({}, onDisk, 5, 0), { file: onDisk, line: 5 }, 'no map, no change');
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
