import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PythonCoverageSource, guessTestsPath, isTestFile, normalizeContext, parseCoverageJson, parsePytestSummary, interpreterFromProject, pythonFields, walkPython, missingPackagesSentence } from '../src/languages/python/coverage';
import { pythonPlugin } from '../src/languages/python';
import { countLanguages, guessLanguage } from '../src/detect/language';
import { analyze } from '../src/engine/density';
import { LanguageSettings } from '../src/languages/types';
import { DEFAULT_DEPTH_OPTIONS } from '../src/engine/types';
import { repoWasmDir } from '../src/languages/shared/treeSitter';

const PY = process.env.DEEPTEST_PYTHON ?? 'python3';
const settings = (testsPath: string, sourceRoot = ''): LanguageSettings => ({ testsPath, sourceRoot, fields: { interpreter: PY, pytestArgs: '' } });

const FIXTURE = path.join(process.cwd(), 'test', 'fixtures', 'pyproject');

test('isTestFile matches pytest conventions only', () => {
  assert.equal(isTestFile('test_calc.py'), true);
  assert.equal(isTestFile('calc_test.py'), true);
  assert.equal(isTestFile('tests.py'), true);
  assert.equal(isTestFile('calc.py'), false);
  assert.equal(isTestFile('testing.py'), false);
  assert.equal(isTestFile('test_calc.txt'), false);
});

test('normalizeContext drops import-time and non-run phases, keeps both id styles', () => {
  assert.equal(normalizeContext(''), undefined);
  assert.equal(normalizeContext('tests.test_calc.test_both'), 'tests.test_calc.test_both');
  assert.equal(normalizeContext('tests/test_calc.py::test_both|run'), 'tests/test_calc.py::test_both');
  assert.equal(normalizeContext('tests/test_calc.py::test_both|setup'), undefined);
  assert.equal(normalizeContext('tests/test_calc.py::test_both|teardown'), undefined);
});

test('parseCoverageJson builds executable lines, executed lines, and per-line test sets', () => {
  const json = JSON.stringify({
    files: {
      'src\\calc.py': {
        executed_lines: [1, 2, 3],
        missing_lines: [4],
        contexts: { '1': [''], '2': ['t.a', 't.b'], '3': ['t.a'], '5': ['t.c|run'] },
      },
    },
  });
  const [file] = parseCoverageJson(json);
  assert.equal(file.path, 'src/calc.py');
  assert.deepEqual(Array.from(file.lines.keys()).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(file.lines.get(1) ?? []), []);
  assert.deepEqual(Array.from(file.lines.get(2) ?? []).sort(), ['t.a', 't.b']);
  assert.deepEqual(Array.from(file.lines.get(4) ?? []), []);
  assert.deepEqual(Array.from(file.lines.get(5) ?? []), ['t.c']);
  assert.deepEqual(Array.from(file.executed).sort((a, b) => a - b), [1, 2, 3, 5]);
});

test('parseCoverageJson tolerates a file with no contexts block', () => {
  const [file] = parseCoverageJson(JSON.stringify({ files: { 'a.py': { executed_lines: [1], missing_lines: [] } } }));
  assert.deepEqual(Array.from(file.executed), [1]);
  assert.equal(file.lines.size, 1);
});

test('parsePytestSummary reads counts from the final summary line', () => {
  assert.deepEqual(parsePytestSummary('....\n3 passed, 1 failed, 2 skipped in 0.12s\n', 1), { passed: 3, failed: 1, errors: 0, skipped: 2, exitCode: 1 });
  assert.deepEqual(parsePytestSummary('== 2 passed in 1.00s ==', 0), { passed: 2, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  assert.deepEqual(parsePytestSummary('1 error in 0.5s', 2), { passed: 0, failed: 0, errors: 1, skipped: 0, exitCode: 2 });
  assert.deepEqual(parsePytestSummary('no tests ran in 0.01s', 5), { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode: 5 });
  assert.deepEqual(parsePytestSummary('garbage', 3), { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode: 3 });
});

test('walkPython skips virtualenvs and caches, returns forward-slash paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-'));
  fs.mkdirSync(path.join(dir, 'pkg', '.venv', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'pkg', '__pycache__'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'a.py'), '');
  fs.writeFileSync(path.join(dir, 'pkg', 'b.txt'), '');
  fs.writeFileSync(path.join(dir, 'pkg', '.venv', 'lib', 'x.py'), '');
  fs.writeFileSync(path.join(dir, 'pkg', '__pycache__', 'a.pyc'), '');
  assert.deepEqual(walkPython(dir), ['pkg/a.py']);
  assert.deepEqual(walkPython(path.join(dir, 'missing')), []);
});

test('guessTestsPath prefers tests/, then test/, else empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-'));
  assert.equal(guessTestsPath(dir), '');
  fs.mkdirSync(path.join(dir, 'test'));
  assert.equal(guessTestsPath(dir), 'test');
  fs.mkdirSync(path.join(dir, 'tests'));
  assert.equal(guessTestsPath(dir), 'tests');
});

test('discoverTests finds the fixture tests and nothing when the folder is empty', async () => {
  const source = new PythonCoverageSource();
  assert.deepEqual(await source.discoverTests({ workspaceRoot: FIXTURE, settings: settings('') }), ['tests/test_calc.py']);
  assert.deepEqual(await source.discoverTests({ workspaceRoot: FIXTURE, settings: settings('src') }), []);
  assert.deepEqual(await source.discoverTests({ workspaceRoot: FIXTURE, settings: settings('nope') }), []);
});

test('plugin detect pre-fills tests folder, source root, and test files without asking', async () => {
  const d = await pythonPlugin.detect(FIXTURE, { activeLanguageId: undefined, extensionApi: async () => undefined });
  assert.equal(d.testsPath, 'tests');
  assert.equal(d.sourceRoot, 'src');
  assert.deepEqual(d.testFiles, ['tests/test_calc.py']);
  assert.ok('interpreter' in d.fields);
  assert.ok(d.notes.length >= 1);
});

test('the project\'s own virtual environment beats PATH, and the editor\'s selection beats both', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-venv-'));
  assert.equal(interpreterFromProject(dir), undefined);
  const bin = process.platform === 'win32' ? path.join(dir, '.venv', 'Scripts') : path.join(dir, '.venv', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const exe = path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python');
  fs.writeFileSync(exe, '');
  assert.equal(interpreterFromProject(dir), exe);
  assert.equal(pythonFields({ testsPath: '', sourceRoot: '', fields: {} }, dir).interpreter, exe);
  assert.equal(pythonFields({ testsPath: '', sourceRoot: '', fields: { interpreter: 'custom' } }, dir).interpreter, 'custom');
  const detected = await pythonPlugin.detect(dir, { activeLanguageId: undefined, extensionApi: async () => undefined });
  assert.equal(detected.fields.interpreter, exe);
  assert.match(detected.notes[0], /project's own virtual environment/);
  const editor = await pythonPlugin.detect(dir, { activeLanguageId: undefined, extensionApi: async () => ({ environments: { getActiveEnvironmentPath: () => ({ path: process.execPath }) } }) });
  assert.equal(editor.fields.interpreter, process.execPath);
});

test('plugin detect takes the interpreter the editor already selected', async () => {
  const d = await pythonPlugin.detect(FIXTURE, {
    activeLanguageId: 'python',
    extensionApi: async (id) => (id === 'ms-python.python' ? { environments: { getActiveEnvironmentPath: () => ({ path: process.execPath }) } } : undefined),
  });
  assert.equal(d.fields.interpreter, process.execPath);
});

test('countLanguages ranks by file count and guessLanguage honours the active editor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-'));
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'i.js'), '');
  fs.writeFileSync(path.join(dir, 'a.py'), '');
  fs.writeFileSync(path.join(dir, 'b.py'), '');
  fs.writeFileSync(path.join(dir, 'c.ts'), '');
  fs.writeFileSync(path.join(dir, 'README.md'), '');
  assert.deepEqual(countLanguages(dir), [{ language: 'python', files: 2 }, { language: 'typescript', files: 1 }]);
  assert.equal(guessLanguage(dir)?.language, 'python');
  assert.equal(guessLanguage(dir, 'typescript')?.language, 'typescript');
  assert.equal(guessLanguage(dir, 'rust')?.language, 'python');
  assert.equal(guessLanguage(fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'))), undefined);
});

const hasPython = ((): boolean => {
  try {
    const { execFileSync } = require('node:child_process');
    execFileSync(PY, ['-c', 'import coverage, pytest'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('checkEnvironment reports a bad interpreter as a problem, not a crash', async () => {
  const source = new PythonCoverageSource();
  const check = await source.checkEnvironment({ workspaceRoot: FIXTURE, settings: { testsPath: '', sourceRoot: '', fields: { interpreter: 'definitely-not-python-xyz' } }, log: () => undefined });
  assert.equal(check.ok, false);
  assert.equal(check.problems.length, 1);
});

test.skipIf(!hasPython)('end to end on the fixture: coverage.py contexts through the engine', async () => {
  const source = pythonPlugin.createCoverageSource();
  const log: string[] = [];
  const env = await source.checkEnvironment({ workspaceRoot: FIXTURE, settings: settings('tests', 'src'), log: (l) => log.push(l) });
  assert.equal(env.ok, true, env.problems.join('; '));

  const run = await source.run({ workspaceRoot: FIXTURE, settings: settings('tests', 'src'), log: (l) => log.push(l) });
  assert.equal(run.tests.passed, 3);
  assert.equal(run.tests.failed, 0);
  assert.deepEqual(run.measuredFiles.sort(), ['src/__init__.py', 'src/calc.py']);

  const calc = run.coverages.find((c) => c.path === 'src/calc.py');
  assert.ok(calc);
  assert.deepEqual(Array.from(calc.lines.get(4) ?? []), ['test_calc.test_both']);
  assert.deepEqual(Array.from(calc.lines.get(2) ?? []).sort(), ['test_calc.test_both', 'test_calc.test_x_only']);
  assert.deepEqual(Array.from(calc.lines.get(6) ?? []), []);
  assert.equal(calc.executed.has(1), true);
  assert.equal(calc.lines.has(15), false, 'coverage.py drops the dead return; the structure pass must report it');

  const structureSource = await pythonPlugin.createStructureSource({ wasmDir: repoWasmDir() });
  const structure = structureSource.analyze('src/calc.py', fs.readFileSync(path.join(FIXTURE, 'src', 'calc.py'), 'utf8'), DEFAULT_DEPTH_OPTIONS);
  structureSource.dispose();
  const result = analyze([calc], [structure]);
  const file = result.files[0];
  const byLine = new Map(file.lines.map((l) => [l.line, l]));

  assert.equal(byLine.get(1)?.status, 'declaration');
  assert.equal(byLine.get(2)?.status, 'over'); // depth 1, two tests
  assert.equal(byLine.get(3)?.status, 'met'); // depth 2, two tests
  assert.equal(byLine.get(4)?.status, 'short'); // depth 2, one test
  assert.equal(byLine.get(6)?.status, 'untested'); // elif y > 0 and x == 0: depth 3
  assert.equal(byLine.get(6)?.bar, 3);
  assert.equal(byLine.get(15)?.status, 'unreachable');
  assert.deepEqual(file.unreachableLines, [15]);
  assert.equal(result.shortfalls[0].line, 6);
  assert.equal(result.shortfalls[0].gap, 3);
  // The route to line 6: `if x > 0` must be false, then `y > 0` true, then `x == 0` also true.
  const route = byLine.get(6)?.route;
  assert.deepEqual(route?.steps.map((s) => [s.condition, s.outcome, s.testsPast]), [
    ['x > 0', 'is false', 0],
    ['y > 0', 'is true', 0],
    ['x == 0', 'is also true', 0],
  ]);
  assert.equal(route?.reached, 0);
  // Line 4 (`return "both"`): tests get past both decisions; one test is there, bar is 2.
  assert.equal(byLine.get(4)?.route.reached, 2);
  assert.equal(result.summary.functions, 2);
  assert.equal(result.summary.totalComplexity, 5 + 2);
  assert.ok(log.some((l) => l.includes('coverage run')));

  fs.rmSync(path.join(FIXTURE, '.deeptest'), { recursive: true, force: true });
});

// ---- addopts and pytest failures (0.3.8) --------------------------------

import { pytestFailureBeforeTests, readProjectAddopts, withoutCoverageOptions } from '../src/languages/python/coverage';

function tempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-addopts-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

test('readProjectAddopts: pytest.ini wins, continuation lines join, other files follow pytest order', () => {
  const both = tempProject({
    'pytest.ini': '[pytest]\ntestpaths = tests\naddopts = --cov=. --cov-report=html:htmlcov\n    --cov-fail-under=5 -ra\n\n[other]\naddopts = nope\n',
    'setup.cfg': '[tool:pytest]\naddopts = --from-setup-cfg\n',
  });
  assert.equal(readProjectAddopts(both), '--cov=. --cov-report=html:htmlcov --cov-fail-under=5 -ra');
  const cfgOnly = tempProject({ 'setup.cfg': '[tool:pytest]\naddopts = --from-setup-cfg\n' });
  assert.equal(readProjectAddopts(cfgOnly), '--from-setup-cfg');
  const toxOnly = tempProject({ 'tox.ini': '[tox]\nenvlist = py\n[pytest]\naddopts: -x\n' });
  assert.equal(readProjectAddopts(toxOnly), '-x');
  const tomlString = tempProject({ 'pyproject.toml': '[tool.black]\nline-length = 100\n\n[tool.pytest.ini_options]\naddopts = "--cov=src -q"\n\n[tool.other]\n' });
  assert.equal(readProjectAddopts(tomlString), '--cov=src -q');
  const tomlArray = tempProject({ 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = [\n  "--cov=src",\n  "-ra",\n]\n' });
  assert.equal(readProjectAddopts(tomlArray), '--cov=src -ra');
  assert.equal(readProjectAddopts(tempProject({ 'pytest.ini': '[pytest]\ntestpaths = tests\n' })), undefined);
  assert.equal(readProjectAddopts(tempProject({})), undefined);
});

test('withoutCoverageOptions drops every pytest-cov option, with its value, and keeps the rest', () => {
  assert.deepEqual(withoutCoverageOptions('--cov=. --cov-report=html:htmlcov --cov-report=term-missing --cov-report=xml:coverage.xml --cov-fail-under=5'), {
    kept: [],
    dropped: ['--cov=.', '--cov-report=html:htmlcov', '--cov-report=term-missing', '--cov-report=xml:coverage.xml', '--cov-fail-under=5'],
  });
  assert.deepEqual(withoutCoverageOptions('-ra --cov src --cov-report html -x --no-cov --cov-branch --tb=short'), {
    kept: ['-ra', '-x', '--tb=short'],
    dropped: ['--cov', 'src', '--cov-report', 'html', '--no-cov', '--cov-branch'],
  });
  // A bare --cov followed by another option keeps that option.
  assert.deepEqual(withoutCoverageOptions('--cov -q'), { kept: ['-q'], dropped: ['--cov'] });
  assert.deepEqual(withoutCoverageOptions('-ra -x'), { kept: ['-ra', '-x'], dropped: [] });
  assert.deepEqual(withoutCoverageOptions(''), { kept: [], dropped: [] });
});

test('pytestFailureBeforeTests names the failure for exit codes 2 to 5 and stays silent for a real run', () => {
  const usage = 'ERROR: usage: __main__.py [options] [file_or_dir]\n__main__.py: error: unrecognized arguments: --cov=.\n  inifile: pytest.ini\n';
  assert.match(pytestFailureBeforeTests(usage, 4, 'tests') ?? '', /^The test run failed before any test ran, because pytest did not accept its command line\. pytest said: ERROR: usage/);
  assert.match(pytestFailureBeforeTests(usage, 4, 'tests') ?? '', /Press "Show the log" to see the whole run\.$/);
  assert.match(pytestFailureBeforeTests('', 3, 'tests') ?? '', /internal error/);
  assert.equal(pytestFailureBeforeTests('no tests ran in 0.01s', 5, 'tests'), 'pytest found no tests under "tests". Press "Change the setup" and check the tests folder.');
  assert.match(pytestFailureBeforeTests('ERROR tests/test_a.py - ImportError: x\n!!! Interrupted: 1 error during collection !!!\n1 error in 0.2s', 2, 'tests') ?? '', /a test file failed to import/);
  assert.equal(pytestFailureBeforeTests('3 passed in 0.1s', 0, 'tests'), undefined);
  assert.equal(pytestFailureBeforeTests('2 passed, 1 failed in 0.1s', 1, 'tests'), undefined);
  // Ctrl-C after some tests ran is exit 2 too; that is not "before any test ran".
  assert.equal(pytestFailureBeforeTests('3 passed in 0.1s\n!!! KeyboardInterrupt !!!', 2, 'tests'), undefined);
});

test.skipIf(!hasPython)('end to end: a project whose addopts turn on pytest-cov still runs its tests', async () => {
  // Regalia's exact addopts line. With pytest-cov disabled these options made pytest exit 4 before collecting.
  const dir = tempProject({ 'pytest.ini': '[pytest]\naddopts = --cov=. --cov-report=html:htmlcov --cov-report=term-missing --cov-report=xml:coverage.xml --cov-fail-under=5\n' });
  fs.cpSync(path.join(FIXTURE, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(FIXTURE, 'tests'), path.join(dir, 'tests'), { recursive: true });
  const source = pythonPlugin.createCoverageSource();
  const log: string[] = [];
  const run = await source.run({ workspaceRoot: dir, settings: settings('tests', 'src'), log: (l) => log.push(l) });
  assert.equal(run.tests.passed, 3, log.join('\n'));
  assert.ok(log.some((l) => l.startsWith("The project's pytest addopts turn on pytest-cov (--cov=. ")), log.join('\n'));
  assert.ok(log.some((l) => l.includes('-o addopts=')), log.join('\n'));
});

test.skipIf(!hasPython)('end to end: a pytest usage error is reported as a failed run, never as 0 passed', async () => {
  const dir = tempProject({ 'pytest.ini': '[pytest]\naddopts = --definitely-not-an-option\n' });
  fs.cpSync(path.join(FIXTURE, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(FIXTURE, 'tests'), path.join(dir, 'tests'), { recursive: true });
  const source = pythonPlugin.createCoverageSource();
  await assert.rejects(
    source.run({ workspaceRoot: dir, settings: settings('tests', 'src'), log: () => undefined }),
    (err: Error) => /failed before any test ran, because pytest did not accept its command line/.test(err.message) && /--definitely-not-an-option/.test(err.message),
  );
});

test('missingPackagesSentence names the interpreter the packages are missing from', () => {
  const venv = process.platform === 'win32' ? 'C:\\work\\app\\.venv\\Scripts\\python.exe' : '/work/app/.venv/bin/python';
  assert.equal(missingPackagesSentence(venv, ['coverage']), `The Python at ${venv} is missing coverage.`);
  assert.equal(missingPackagesSentence(venv, ['coverage', 'pytest']), `The Python at ${venv} is missing coverage and pytest.`);
  assert.equal(missingPackagesSentence('python', ['coverage']), 'The Python found as "python" on your PATH is missing coverage.');
});
