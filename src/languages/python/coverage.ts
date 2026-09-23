/**
 * Python CoverageSource over coverage.py and pytest.
 *
 * Per-test attribution comes from coverage.py's dynamic contexts
 * (`dynamic_context = test_function`), verified against coverage 7.16: with
 * `coverage json --show-contexts`, every executed line carries the list of
 * test functions that ran it, as "module.test_name". Import-time execution
 * shows up as the empty context "" and is not a test.
 *
 * One ordinary pytest run gives the whole numerator. No per-test process
 * launches, no plugin, nothing to install beyond coverage and pytest.
 *
 * Known limit: pytest parametrized cases share one function name, so
 * `test_x[1]` and `test_x[2]` count as one test. pytest-cov's
 * `--cov-context=test` records node ids instead; supporting that is a
 * follow-up, not a redesign, because the parser below already strips the
 * `|run` suffix that format carries.
 *
 * coverage.py's own parser drops statements after a return from its
 * statement list, so those lines never appear here. The structure analyzer
 * reports them as unreachable instead.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileCoverage } from '../../engine/types';
import { runProcess } from '../shared/process';
import { CoverageRun, CoverageSource, EnvironmentCheck, LanguageSettings, RunContext, TestRunSummary } from '../types';

export interface PythonFields {
  /** Interpreter to run. Pre-filled by detection; the adapter trusts it. */
  interpreter: string;
  /** Extra pytest arguments, space separated. */
  pytestArgs: string;
}

export function pythonFields(settings: LanguageSettings, workspaceRoot?: string): PythonFields {
  const f = settings.fields;
  const fromProject = workspaceRoot ? interpreterFromProject(workspaceRoot) : undefined;
  return {
    interpreter: typeof f.interpreter === 'string' && f.interpreter ? f.interpreter : fromProject ?? (process.platform === 'win32' ? 'python' : 'python3'),
    pytestArgs: typeof f.pytestArgs === 'string' ? f.pytestArgs : '',
  };
}

/** The project's own virtual environment, when it has one. Mirrors index.ts; kept here so coverage.ts stays testable alone. */
export function interpreterFromProject(workspaceRoot: string): string | undefined {
  const bin = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  for (const env of ['.venv', 'venv', 'env', '.env', 'virtualenv']) {
    const candidate = path.join(workspaceRoot, env, ...bin);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Names the interpreter the packages are missing from, so a person can tell
 * a project's .venv from the global Python before pressing the install
 * button. "This Python is missing coverage." left that ambiguous in the
 * field (2026-09-12): the install goes wherever DeepTest pointed, and the
 * sentence did not say where that was.
 */
export function missingPackagesSentence(interpreter: string, missing: string[]): string {
  const what = missing.join(' and ');
  return path.isAbsolute(interpreter)
    ? `The Python at ${interpreter} is missing ${what}.`
    : `The Python found as "${interpreter}" on your PATH is missing ${what}.`;
}

export function splitArgs(text: string): string[] {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

/**
 * The project's own `addopts`, from whichever config file pytest would read
 * (in pytest's own order of precedence), or undefined when there is none.
 *
 * Why this exists: DeepTest runs pytest with `-p no:cov`, so its own
 * coverage.py run is the only one measuring. A project whose addopts turn
 * pytest-cov on (`--cov=. --cov-report=...`) then hands pytest options that
 * no loaded plugin understands, and pytest exits with a usage error before
 * collecting a single test. Regalia did exactly that: every check reported
 * "0 passed" and a coverage figure made of import-time execution. The fix is
 * to read the project's addopts, drop only the pytest-cov options, and hand
 * the rest back with `-o addopts=...`, which overrides the ini value for
 * this one run and leaves the project's file untouched.
 */
export function readProjectAddopts(workspaceRoot: string): string | undefined {
  const ini = (file: string, section: string): string | undefined => {
    const full = path.join(workspaceRoot, file);
    if (!fs.existsSync(full)) {
      return undefined;
    }
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    let inSection = false;
    let value: string | undefined;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const header = /^\[([^\]]+)\]\s*$/.exec(line);
      if (header) {
        if (value !== undefined) {
          break;
        }
        inSection = header[1].trim() === section;
        continue;
      }
      if (!inSection) {
        continue;
      }
      if (value !== undefined) {
        // ini continuation lines are indented.
        if (/^\s/.test(raw) && line.trim()) {
          value += ` ${line.trim()}`;
          continue;
        }
        break;
      }
      const m = /^addopts\s*[=:]\s*(.*)$/.exec(line);
      if (m) {
        value = m[1].trim();
      }
    }
    return value;
  };
  const toml = (): string | undefined => {
    const full = path.join(workspaceRoot, 'pyproject.toml');
    if (!fs.existsSync(full)) {
      return undefined;
    }
    const text = fs.readFileSync(full, 'utf8');
    const section = /\[tool\.pytest\.ini_options\]([\s\S]*?)(?=\n\[|$)/.exec(text);
    if (!section) {
      return undefined;
    }
    const body = section[1];
    const str = /^\s*addopts\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(body) ?? /^\s*addopts\s*=\s*'([^']*)'/m.exec(body);
    if (str) {
      return str[1];
    }
    const arr = /^\s*addopts\s*=\s*\[([\s\S]*?)\]/m.exec(body);
    if (arr) {
      return Array.from(arr[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g))
        .map((m) => m[1] ?? m[2])
        .join(' ');
    }
    return undefined;
  };
  // pytest's order: pytest.ini, then pyproject.toml, then tox.ini, then setup.cfg.
  return ini('pytest.ini', 'pytest') ?? ini('.pytest.ini', 'pytest') ?? toml() ?? ini('tox.ini', 'pytest') ?? ini('setup.cfg', 'tool:pytest');
}

/** pytest-cov options that take a value in a separate token when written without `=`. */
const COV_WITH_VALUE = new Set(['--cov', '--cov-report', '--cov-config', '--cov-fail-under', '--cov-context']);

/**
 * The same arguments with every pytest-cov option removed. Returns the kept
 * arguments and the dropped ones, so the log can say what was left out.
 */
export function withoutCoverageOptions(addopts: string): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  const args = splitArgs(addopts);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--no-cov' || arg === '--no-cov-on-fail' || arg.startsWith('--cov')) {
      dropped.push(arg);
      // `--cov src` and `--cov-report html` carry the value in the next token.
      if (COV_WITH_VALUE.has(arg) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
        dropped.push(args[i + 1]);
        i += 1;
      }
      continue;
    }
    kept.push(arg);
  }
  return { kept, dropped };
}

/**
 * When pytest stopped before any test ran, the sentence to show instead of
 * numbers; otherwise undefined. pytest's exit codes: 2 interrupted (this
 * includes collection errors), 3 internal error, 4 usage error, 5 no tests
 * collected. A run like that must never be scored: "0 passed" beside a
 * coverage percentage reads like a result, and it is not one.
 */
export function pytestFailureBeforeTests(output: string, exitCode: number | null, target: string): string | undefined {
  const tail = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^={3,}/.test(l))
    .slice(-8)
    .join(' ');
  const said = tail ? ` pytest said: ${tail}` : '';
  switch (exitCode) {
    case 4:
      return `The test run failed before any test ran, because pytest did not accept its command line.${said} Press "Show the log" to see the whole run.`;
    case 3:
      return `The test run failed before any test ran, because pytest hit an internal error.${said} Press "Show the log" to see the whole run.`;
    case 5:
      return `pytest found no tests under "${target}". Press "Change the setup" and check the tests folder.`;
    case 2:
      if (/\b0 passed\b|no tests ran|error(s)? during collection|Interrupted/i.test(output) && !/\b[1-9]\d* passed\b/.test(output)) {
        return `The test run stopped before any test ran, usually because a test file failed to import.${said} Press "Show the log" to see the whole run.`;
      }
      return undefined;
    default:
      return undefined;
  }
}

// The sibling tools' folders, skipped alongside DeepTest's own; see the note
// on the TypeScript walker.
const IGNORED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'env', '.env', 'site-packages', '.tox', '.mypy_cache', '.pytest_cache', '.deeptest', '.untangleit', '.keepsafe', 'build', 'dist', '.eggs']);
const TEST_FILE = /^(test_.*\.py|.*_test\.py|tests?\.py)$/;

export function isTestFile(name: string): boolean {
  return TEST_FILE.test(name);
}

export function walkPython(root: string, relative = ''): string[] {
  const out: string[] = [];
  const dir = path.join(root, relative);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        out.push(...walkPython(root, rel));
      }
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      out.push(rel);
    }
  }
  return out;
}

/** Pick a tests folder when the user has not named one. */
export function guessTestsPath(workspaceRoot: string): string {
  for (const candidate of ['tests', 'test', 'src/tests', 'src/test']) {
    if (fs.existsSync(path.join(workspaceRoot, candidate))) {
      return candidate;
    }
  }
  return '';
}

/**
 * Turn a coverage.py context into a test id. Handles both the
 * `dynamic_context = test_function` form ("pkg.test_mod.test_fn") and the
 * pytest-cov form ("tests/test_mod.py::test_fn|run"). Returns undefined for
 * the import-time context and for setup/teardown phases.
 */
export function normalizeContext(context: string): string | undefined {
  if (!context) {
    return undefined;
  }
  const pipe = context.lastIndexOf('|');
  if (pipe >= 0) {
    const phase = context.slice(pipe + 1);
    if (phase !== 'run') {
      return undefined;
    }
    return context.slice(0, pipe);
  }
  return context;
}

interface CoverageJsonFile {
  executed_lines: number[];
  missing_lines: number[];
  excluded_lines?: number[];
  contexts?: Record<string, string[]>;
}

interface CoverageJson {
  files: Record<string, CoverageJsonFile>;
}

export function parseCoverageJson(text: string): FileCoverage[] {
  const data = JSON.parse(text) as CoverageJson;
  const out: FileCoverage[] = [];
  for (const [rawPath, file] of Object.entries(data.files ?? {})) {
    const filePath = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const lines = new Map<number, Set<string>>();
    const executed = new Set<number>();
    for (const line of file.executed_lines ?? []) {
      lines.set(line, new Set());
      executed.add(line);
    }
    for (const line of file.missing_lines ?? []) {
      lines.set(line, new Set());
    }
    for (const [lineText, contexts] of Object.entries(file.contexts ?? {})) {
      const line = Number(lineText);
      let set = lines.get(line);
      if (!set) {
        set = new Set();
        lines.set(line, set);
      }
      for (const context of contexts) {
        const id = normalizeContext(context);
        if (id) {
          set.add(id);
          executed.add(line);
        }
      }
    }
    out.push({ path: filePath, lines, executed });
  }
  return out;
}

export function parsePytestSummary(output: string, exitCode: number | null): TestRunSummary {
  const summary: TestRunSummary = { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode };
  // The last "=== 3 passed, 1 failed in 0.12s ===" style line wins; pytest -q prints it without the bars.
  const lines = output.split(/\r?\n/).reverse();
  const line = lines.find((l) => /\b(passed|failed|error|errors|skipped|no tests ran)\b/.test(l) && /\bin [\d.]+s\b/.test(l));
  if (!line) {
    return summary;
  }
  const grab = (word: string): number => {
    const m = line.match(new RegExp(`(\\d+) ${word}`));
    return m ? Number(m[1]) : 0;
  };
  summary.passed = grab('passed');
  summary.failed = grab('failed');
  summary.errors = grab('errors?');
  summary.skipped = grab('skipped');
  return summary;
}

export class PythonCoverageSource implements CoverageSource {
  async discoverTests(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): Promise<string[]> {
    const testsPath = ctx.settings.testsPath || guessTestsPath(ctx.workspaceRoot);
    const root = path.join(ctx.workspaceRoot, testsPath);
    if (!fs.existsSync(root)) {
      return [];
    }
    return walkPython(root)
      .filter((rel) => isTestFile(path.basename(rel)))
      .map((rel) => (testsPath ? `${testsPath}/${rel}` : rel));
  }

  async checkEnvironment(ctx: Pick<RunContext, 'workspaceRoot' | 'settings' | 'log'>): Promise<EnvironmentCheck> {
    const { interpreter } = pythonFields(ctx.settings, ctx.workspaceRoot);
    const probe = [
      'import sys, json',
      'mods = {}',
      'for m in ("coverage", "pytest"):',
      '    try:',
      '        mods[m] = __import__(m).__version__',
      '    except Exception:',
      '        mods[m] = None',
      'print(json.dumps({"python": sys.version.split()[0], "mods": mods}))',
    ].join('\n');
    let result;
    try {
      result = await runProcess(interpreter, ['-c', probe], { cwd: ctx.workspaceRoot });
    } catch (err) {
      return {
        ok: false,
        summary: `Could not run '${interpreter}'`,
        problems: [`${(err as Error).message} Enter the Python interpreter on the DeepTest setup screen, or select one in the Python extension.`],
      };
    }
    let parsed: { python: string; mods: Record<string, string | null> };
    try {
      parsed = JSON.parse(result.stdout.trim().split(/\r?\n/).pop() ?? '');
    } catch {
      return {
        ok: false,
        summary: `'${interpreter}' did not answer like a Python interpreter`,
        problems: [result.output.trim() || `exit code ${result.exitCode}`],
      };
    }
    const missing = Object.entries(parsed.mods)
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    const summary = `Python ${parsed.python}` + Object.entries(parsed.mods).filter(([, v]) => v).map(([k, v]) => `, ${k} ${v}`).join('');
    if (missing.length === 0) {
      return { ok: true, summary, problems: [] };
    }
    return {
      ok: false,
      summary,
      problems: [missingPackagesSentence(interpreter, missing)],
      fix: {
        title: `Install ${missing.join(' and ')} into that Python`,
        command: interpreter,
        args: ['-m', 'pip', 'install', ...missing],
      },
    };
  }

  async run(ctx: RunContext): Promise<CoverageRun> {
    const { interpreter, pytestArgs } = pythonFields(ctx.settings, ctx.workspaceRoot);
    const testsPath = ctx.settings.testsPath || guessTestsPath(ctx.workspaceRoot);
    const workDir = path.join(ctx.workspaceRoot, '.deeptest');
    fs.mkdirSync(workDir, { recursive: true });

    const dataFile = path.join(workDir, '.coverage');
    const jsonFile = path.join(workDir, 'coverage.json');
    const rcFile = path.join(workDir, 'coveragerc');
    const source = ctx.settings.sourceRoot ? ctx.settings.sourceRoot : '.';
    const omit = [testsPath ? `${testsPath}/*` : undefined, '.deeptest/*', '*/site-packages/*', 'setup.py', 'conftest.py', '*/conftest.py']
      .filter((x): x is string => Boolean(x))
      .join('\n    ');
    const rc = [
      '# Generated by DeepTest on every run. Do not edit; it will be overwritten.',
      '[run]',
      'branch = True',
      'dynamic_context = test_function',
      `data_file = ${dataFile.replace(/\\/g, '/')}`,
      `source = ${source}`,
      'omit =',
      `    ${omit}`,
      '',
      '[json]',
      'show_contexts = True',
      '',
    ].join('\n');
    fs.writeFileSync(rcFile, rc, 'utf8');
    for (const stale of [dataFile, jsonFile]) {
      if (fs.existsSync(stale)) {
        fs.unlinkSync(stale);
      }
    }

    const target = testsPath || '.';
    const runArgs = [
      '-m', 'coverage', 'run', `--rcfile=${rcFile}`,
      '-m', 'pytest', target, '-q', '-p', 'no:cacheprovider', '-p', 'no:cov',
    ];
    const projectAddopts = readProjectAddopts(ctx.workspaceRoot);
    if (projectAddopts !== undefined) {
      const { kept, dropped } = withoutCoverageOptions(projectAddopts);
      if (dropped.length > 0) {
        ctx.log(`The project's pytest addopts turn on pytest-cov (${dropped.join(' ')}). DeepTest measures coverage itself, so it ran pytest without those options and kept the rest${kept.length ? ` (${kept.join(' ')})` : ''}.`);
        runArgs.push('-o', `addopts=${kept.join(' ')}`);
      }
    }
    runArgs.push(...splitArgs(pytestArgs));
    ctx.log(`$ ${interpreter} ${runArgs.join(' ')}`);
    const run = await runProcess(interpreter, runArgs, { cwd: ctx.workspaceRoot, log: ctx.log, signal: ctx.signal });
    const tests = parsePytestSummary(run.output, run.exitCode);

    const failure = pytestFailureBeforeTests(run.output, run.exitCode, target);
    if (failure) {
      throw new Error(failure);
    }

    if (!fs.existsSync(dataFile)) {
      throw new Error(`coverage.py produced no data, and the test run ended with exit code ${run.exitCode}. Press "Show the log" to see the test run.`);
    }

    const jsonArgs = ['-m', 'coverage', 'json', `--rcfile=${rcFile}`, '--show-contexts', '-o', jsonFile];
    ctx.log(`$ ${interpreter} ${jsonArgs.join(' ')}`);
    const report = await runProcess(interpreter, jsonArgs, { cwd: ctx.workspaceRoot, log: ctx.log, signal: ctx.signal });
    if (report.exitCode !== 0 || !fs.existsSync(jsonFile)) {
      throw new Error(`coverage.py could not write its report, and ended with exit code ${report.exitCode}. Press "Show the log" to see why.`);
    }

    const coverages = parseCoverageJson(fs.readFileSync(jsonFile, 'utf8')).filter((f) => !isTestFile(path.basename(f.path)));
    // coverage.py writes a context only where a test touched a measured line,
    // so a test that touched none leaves nothing behind and the count of
    // contexts cannot be held against the count of tests. Said so, not hidden.
    const recorded = new Set<string>();
    for (const file of coverages) {
      for (const tests of file.lines.values()) {
        for (const id of tests) {
          recorded.add(id);
        }
      }
    }
    return {
      coverages,
      tests,
      measuredFiles: coverages.map((c) => c.path),
      evidence: {
        testsFinished: tests.passed + tests.failed,
        testsRecorded: recorded.size,
        // A context exists only where a test touched a measured line, so every
        // context that exists is evidence by construction.
        recordsWithEvidence: recorded.size,
        filesWithHits: coverages.filter((c) => c.executed.size > 0).length,
        brokenBoundaries: 0,
        reconcilable: false,
      },
    };
  }
}
