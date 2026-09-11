/**
 * TypeScript / JavaScript CoverageSource over Jest or Vitest.
 *
 * Per-test attribution: both runners instrument with Istanbul and keep live
 * counters in a global inside the worker. A small hook (hooks/jest.cjs,
 * hooks/vitest.mjs) snapshots those counters around every test and writes
 * which statement lines each test executed. One ordinary test run, no
 * per-test process launches, nothing for the user to install beyond the
 * runner they already use (Vitest also needs @vitest/coverage-istanbul,
 * offered as a one-click install).
 *
 * How the hook gets loaded without clobbering the project's own config:
 *   Jest   - `jest --showConfig` reveals the existing setupFilesAfterEnv;
 *            the run passes that list plus the hook.
 *   Vitest - a generated .deeptest/vitest.config.mjs imports the project's
 *            config and mergeConfig()s the hook and coverage settings in.
 *
 * The executable-line universe comes from the runner's own
 * coverage-final.json (json reporter), which includes files no test
 * loaded, so an untested module shows up red instead of vanishing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileCoverage } from '../../engine/types';
import { runProcess } from '../shared/process';
import { CoverageRun, CoverageSource, EnvironmentCheck, LanguageSettings, RunContext, TestRunSummary } from '../types';
import { detectFramework } from './framework';

export type Runner = 'jest' | 'vitest';

export interface TsFields {
  runner: 'auto' | Runner;
  extraArgs: string;
}

export function tsFields(settings: LanguageSettings): TsFields {
  const f = settings.fields;
  const runner = f.runner === 'jest' || f.runner === 'vitest' ? f.runner : 'auto';
  return { runner, extraArgs: typeof f.extraArgs === 'string' ? f.extraArgs : '' };
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.deeptest', '.vscode-test', '.next', '.nuxt', '.svelte-kit', 'vendor']);
/** Source files the plugin walks and instruments. Single-file components (.vue, .svelte) are included from 1.0.2 so they show red rather than vanish. */
const SOURCE_EXT = /\.(m?[jt]sx?|c[jt]s|vue|svelte)$/;
/** The same set as a glob for the runners' coverage include lists. */
export const SOURCE_GLOB_EXTENSIONS = '{js,jsx,ts,tsx,mjs,cjs,vue,svelte}';
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)/;

export function isTestFile(relativePath: string): boolean {
  const name = path.basename(relativePath);
  return TEST_FILE.test(name) || relativePath.split('/').includes('__tests__');
}

export function walkSources(root: string, relative = ''): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        out.push(...walkSources(root, rel));
      }
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(rel);
    }
  }
  return out;
}

export function readPackageJson(workspaceRoot: string): { deps: Record<string, string>; scripts: Record<string, string>; jest?: unknown } | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    return {
      deps: { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) },
      scripts: (pkg.scripts as Record<string, string> | undefined) ?? {},
      jest: pkg.jest,
    };
  } catch {
    return undefined;
  }
}

export function findVitestConfig(workspaceRoot: string): string | undefined {
  for (const name of ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']) {
    if (fs.existsSync(path.join(workspaceRoot, name))) {
      return name;
    }
  }
  return undefined;
}

/**
 * Finds an installed package by walking up from the workspace, the way Node
 * resolves modules. Monorepos hoist runners to the repository root.
 */
export function resolveModuleDir(workspaceRoot: string, name: string): string | undefined {
  let dir = workspaceRoot;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Which runner the project uses, from its dependencies and config files. */
export function detectRunner(workspaceRoot: string): Runner | undefined {
  const pkg = readPackageJson(workspaceRoot);
  const hasVitest = Boolean(pkg?.deps.vitest) || Boolean(resolveModuleDir(workspaceRoot, 'vitest'));
  const hasJest = Boolean(pkg?.deps.jest) || Boolean(resolveModuleDir(workspaceRoot, 'jest'));
  const testScript = pkg?.scripts.test ?? '';
  if (hasVitest && hasJest) {
    return /\bjest\b/.test(testScript) && !/\bvitest\b/.test(testScript) ? 'jest' : 'vitest';
  }
  if (hasVitest) {
    return 'vitest';
  }
  if (hasJest) {
    return 'jest';
  }
  return undefined;
}

/** The coverage package pinned to the project's Vitest major: "@vitest/coverage-istanbul@4" for Vitest 4.x. */
export function coverageIstanbulSpec(vitestVersion: string): string {
  const major = /^(\d+)\./.exec(vitestVersion)?.[1];
  return major ? `@vitest/coverage-istanbul@${major}` : '@vitest/coverage-istanbul';
}

export function guessTestsPath(workspaceRoot: string): string {
  for (const candidate of ['test', 'tests', '__tests__', 'spec', 'src/__tests__']) {
    if (fs.existsSync(path.join(workspaceRoot, candidate))) {
      return candidate;
    }
  }
  return '';
}

export function guessSourceRoot(workspaceRoot: string, testsPath: string): string {
  for (const candidate of ['src', 'lib', 'app']) {
    if (candidate !== testsPath && fs.existsSync(path.join(workspaceRoot, candidate)) && walkSources(path.join(workspaceRoot, candidate)).length > 0) {
      return candidate;
    }
  }
  return '';
}

/** Terminal colour codes, which runners emit even when asked not to. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

export function parseJestSummary(output: string, exitCode: number | null): TestRunSummary {
  const summary: TestRunSummary = { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode };
  const line = stripAnsi(output)
    .split(/\r?\n/)
    .reverse()
    .find((l) => /^\s*Tests:/.test(l));
  if (!line) {
    return summary;
  }
  const grab = (word: string): number => {
    const m = line.match(new RegExp(`(\\d+) ${word}`));
    return m ? Number(m[1]) : 0;
  };
  summary.passed = grab('passed');
  summary.failed = grab('failed');
  summary.skipped = grab('skipped') + grab('todo');
  return summary;
}

export function parseVitestSummary(output: string, exitCode: number | null): TestRunSummary {
  const summary: TestRunSummary = { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode };
  const line = stripAnsi(output)
    .split(/\r?\n/)
    .reverse()
    .find((l) => /^\s*Tests\s+\d/.test(l));
  if (!line) {
    return summary;
  }
  const grab = (word: string): number => {
    const m = line.match(new RegExp(`(\\d+) ${word}`));
    return m ? Number(m[1]) : 0;
  };
  summary.passed = grab('passed');
  summary.failed = grab('failed');
  summary.skipped = grab('skipped') + grab('todo');
  return summary;
}

interface IstanbulFile {
  path: string;
  statementMap: Record<string, { start: { line: number; column: number }; end: { line: number; column: number } }>;
  s: Record<string, number>;
}

/**
 * Joins coverage-final.json (the executable universe and what executed at
 * all) with the hook's attribution lines (which test executed what).
 */
export function buildCoverages(workspaceRoot: string, coverageJson: string, attributionLines: string[]): FileCoverage[] {
  const final = JSON.parse(coverageJson) as Record<string, IstanbulFile>;
  const rel = (abs: string): string => path.relative(workspaceRoot, abs).split(path.sep).join('/');
  const byPath = new Map<string, FileCoverage>();
  for (const [abs, file] of Object.entries(final)) {
    const relative = rel(file.path ?? abs);
    if (relative.startsWith('..') || relative.split('/').includes('node_modules') || isTestFile(relative)) {
      continue;
    }
    const lines = new Map<number, Set<string>>();
    const executed = new Set<number>();
    for (const [id, loc] of Object.entries(file.statementMap ?? {})) {
      const line = loc.start.line;
      if (!lines.has(line)) {
        lines.set(line, new Set());
      }
      if ((file.s?.[id] ?? 0) > 0) {
        executed.add(line);
      }
    }
    byPath.set(relative, { path: relative, lines, executed });
  }
  for (const raw of attributionLines) {
    if (!raw.trim()) {
      continue;
    }
    let entry: { test: string; files: Record<string, number[]> };
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const [abs, executedLines] of Object.entries(entry.files ?? {})) {
      const file = byPath.get(rel(abs));
      if (!file) {
        continue;
      }
      for (const line of executedLines) {
        let set = file.lines.get(line);
        if (!set) {
          set = new Set();
          file.lines.set(line, set);
        }
        set.add(entry.test);
        file.executed.add(line);
      }
    }
  }
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function splitArgs(text: string): string[] {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface TsCoverageOptions {
  /** Absolute folder holding hooks/jest.cjs and hooks/vitest.mjs. */
  hooksDir: string;
}

export class TypeScriptCoverageSource implements CoverageSource {
  constructor(private readonly options: TsCoverageOptions) {}

  private runnerFor(workspaceRoot: string, settings: LanguageSettings): Runner | undefined {
    const { runner } = tsFields(settings);
    return runner === 'auto' ? detectRunner(workspaceRoot) : runner;
  }

  async discoverTests(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): Promise<string[]> {
    const testsPath = ctx.settings.testsPath;
    const root = path.join(ctx.workspaceRoot, testsPath);
    if (!fs.existsSync(root)) {
      return [];
    }
    return walkSources(root)
      .map((relPath) => (testsPath ? `${testsPath}/${relPath}` : relPath))
      .filter((relPath) => isTestFile(relPath));
  }

  async checkEnvironment(ctx: Pick<RunContext, 'workspaceRoot' | 'settings' | 'log'>): Promise<EnvironmentCheck> {
    const framework = detectFramework(ctx.workspaceRoot);
    if (framework?.name === 'Angular' && framework.angularRunner) {
      // Angular's tests run through the CLI's builder, not the vitest or karma
      // binaries. Driving the binary bypasses the Angular compiler and TestBed
      // (1.0 survey, finding 3a), and offering "Install Vitest" to a Karma
      // project is wrong advice (finding 4). Until the builder driver lands
      // (1.0.4 for Vitest, 1.0.5 for Karma) DeepTest says so and offers nothing.
      const runnerName = framework.angularRunner === 'karma' ? 'Karma' : 'Vitest';
      return {
        ok: false,
        summary: `Angular, ng test with ${runnerName}`,
        problems: [`This is an Angular project whose tests run through "ng test" with ${runnerName}. DeepTest cannot drive Angular's test builder yet; that is coming in a 1.0 update. Nothing needs installing.`],
      };
    }
    const problems: string[] = [];
    let nodeVersion = '';
    try {
      const probe = await runProcess('node', ['--version'], { cwd: ctx.workspaceRoot });
      nodeVersion = probe.stdout.trim();
    } catch (err) {
      return { ok: false, summary: 'Node.js not found', problems: [`${(err as Error).message} Install Node.js and make sure "node" is on PATH.`] };
    }
    const runner = this.runnerFor(ctx.workspaceRoot, ctx.settings);
    if (!runner) {
      return {
        ok: false,
        summary: `Node ${nodeVersion}, no test runner`,
        problems: ['Neither Jest nor Vitest is in this project. Install one, or pick one on the setup screen.'],
        fix: { title: 'Install Vitest', command: 'npm', args: ['install', '--save-dev', 'vitest', '@vitest/coverage-istanbul'] },
      };
    }
    const moduleDir = resolveModuleDir(ctx.workspaceRoot, runner);
    if (!moduleDir) {
      return {
        ok: false,
        summary: `Node ${nodeVersion}, ${runner} not installed`,
        problems: [`${runner} is listed in package.json but is not installed under node_modules. Run npm install.`],
        fix: { title: 'Run npm install', command: 'npm', args: ['install'] },
      };
    }
    let runnerVersion = '';
    try {
      runnerVersion = JSON.parse(fs.readFileSync(path.join(moduleDir, 'package.json'), 'utf8')).version ?? '';
    } catch {
      // version is decoration
    }
    if (runner === 'vitest' && !resolveModuleDir(ctx.workspaceRoot, '@vitest/coverage-istanbul')) {
      // The coverage package must match Vitest's major: an unpinned install
      // fetched 5.0.0 into a Vitest 4 project and every test file failed
      // with "coverageFilesDirectory is required" (1.0 survey, 2026-09-12).
      const spec = coverageIstanbulSpec(runnerVersion);
      problems.push(`Vitest needs ${spec} for per-test attribution.`);
      return {
        ok: false,
        summary: `Node ${nodeVersion}, vitest ${runnerVersion}`,
        problems,
        fix: { title: `Install ${spec}`, command: 'npm', args: ['install', '--save-dev', spec] },
      };
    }
    return { ok: true, summary: `Node ${nodeVersion}, ${runner} ${runnerVersion}`, problems: [] };
  }

  async run(ctx: RunContext): Promise<CoverageRun> {
    const runner = this.runnerFor(ctx.workspaceRoot, ctx.settings);
    if (!runner) {
      throw new Error('No test runner. Pick Jest or Vitest on the configuration screen.');
    }
    const workDir = path.join(ctx.workspaceRoot, '.deeptest');
    const attrDir = path.join(workDir, 'attribution');
    const coverageDir = path.join(workDir, 'coverage');
    fs.rmSync(attrDir, { recursive: true, force: true });
    fs.rmSync(coverageDir, { recursive: true, force: true });
    fs.mkdirSync(attrDir, { recursive: true });
    // The hook and its helper are copied into .deeptest/ and loaded from there
    // (see hooks/vitest.mjs for why); the helper is found through the
    // environment so a bundling runner cannot break the path.
    const hookDir = path.join(workDir, 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    for (const file of ['vitest.mjs', 'attribution.cjs']) {
      fs.copyFileSync(path.join(this.options.hooksDir, file), path.join(hookDir, file));
    }
    ctx.log(`Hook copied into ${hookDir}.`);
    const env = { ...process.env, DEEPTEST_ATTRIBUTION_DIR: attrDir, DEEPTEST_HOOKS_DIR: hookDir, CI: process.env.CI ?? 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
    const { extraArgs } = tsFields(ctx.settings);
    const sourceGlobRoot = ctx.settings.sourceRoot || '.';
    const testsPath = ctx.settings.testsPath;

    let output = '';
    let exitCode: number | null = null;
    const moduleDir = resolveModuleDir(ctx.workspaceRoot, runner);
    if (!moduleDir) {
      throw new Error(`${runner} is not installed. Run npm install.`);
    }
    if (runner === 'jest') {
      const bin = path.join(moduleDir, 'bin', 'jest.js');
      const shown = await runProcess('node', [bin, '--showConfig'], { cwd: ctx.workspaceRoot, signal: ctx.signal });
      let existingSetup: string[] = [];
      let existingCollect: string[] = [];
      try {
        const cfg = JSON.parse(shown.stdout) as { configs?: Array<{ setupFilesAfterEnv?: string[]; collectCoverageFrom?: string[] }> };
        existingSetup = cfg.configs?.[0]?.setupFilesAfterEnv ?? [];
        existingCollect = cfg.configs?.[0]?.collectCoverageFrom ?? [];
      } catch {
        ctx.log('Could not read the Jest config (jest --showConfig); running with the hook alone.');
      }
      const collect =
        existingCollect.length > 0
          ? existingCollect
          : [
              `${sourceGlobRoot === '.' ? '' : `${sourceGlobRoot}/`}**/*.${SOURCE_GLOB_EXTENSIONS}`,
              '!**/node_modules/**',
              '!**/*.test.*',
              '!**/*.spec.*',
              '!**/__tests__/**',
              '!**/*.d.ts',
              '!**/.deeptest/**',
              ...(testsPath ? [`!${testsPath}/**`] : []),
            ];
      const args = [
        bin,
        '--coverage',
        '--coverageProvider=babel',
        '--coverageReporters=json',
        `--coverageDirectory=${coverageDir}`,
        '--ci',
        '--setupFilesAfterEnv',
        ...existingSetup,
        path.join(this.options.hooksDir, 'jest.cjs'),
        '--collectCoverageFrom',
        ...collect,
        ...splitArgs(extraArgs),
      ];
      if (testsPath) {
        args.push(`^${escapeRegex(path.join(ctx.workspaceRoot, testsPath).split(path.sep).join('/'))}/`);
      }
      ctx.log(`$ node ${args.join(' ')}`);
      const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env, log: ctx.log, signal: ctx.signal });
      output = run.output;
      exitCode = run.exitCode;
    } else {
      const bin = path.join(moduleDir, 'vitest.mjs');
      const userConfig = findVitestConfig(ctx.workspaceRoot);
      const hook = path.join(hookDir, 'vitest.mjs');
      // A relative import: Vite bundles the wrapper and everything it
      // imports relatively, so a TypeScript config goes through esbuild
      // like it would on its own. A file:// URL would be left to Node
      // instead, which strips the types itself and warns about it.
      const relativeImport = (p: string): string => {
        const rel = path.relative(workDir, p).split(path.sep).join('/');
        return rel.startsWith('.') ? rel : `./${rel}`;
      };
      const include = `${sourceGlobRoot === '.' ? '' : `${sourceGlobRoot}/`}**/*.${SOURCE_GLOB_EXTENSIONS}`;
      const wrapper = [
        '// Generated by DeepTest on every run. Wraps the project config; do not edit.',
        "import { defineConfig, mergeConfig } from 'vitest/config';",
        userConfig ? `import base from ${JSON.stringify(relativeImport(path.join(ctx.workspaceRoot, userConfig)))};` : 'const base = {};',
        "const resolved = typeof base === 'function' ? await base({ command: 'serve', mode: 'test' }) : base;",
        'export default mergeConfig(resolved, defineConfig({',
        '  test: {',
        `    setupFiles: [${JSON.stringify(hook)}],`,
        '    coverage: {',
        '      enabled: true,',
        "      provider: 'istanbul',",
        "      reporter: ['json'],",
        `      reportsDirectory: ${JSON.stringify(coverageDir)},`,
        `      include: [${JSON.stringify(include)}],`,
        `      exclude: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/*.d.ts', '**/.deeptest/**'${testsPath ? `, ${JSON.stringify(`${testsPath}/**`)}` : ''}],`,
        '    },',
        '  },',
        '}));',
        '',
      ].join('\n');
      fs.mkdirSync(workDir, { recursive: true });
      const wrapperPath = path.join(workDir, 'vitest.config.mjs');
      fs.writeFileSync(wrapperPath, wrapper, 'utf8');
      // A positional filter is a substring match on test file paths. --dir
      // would re-root the project's include patterns, which breaks them.
      const args = [bin, 'run', '--config', wrapperPath, ...(testsPath ? [`${testsPath}/`] : []), ...splitArgs(extraArgs)];
      ctx.log(`$ node ${args.join(' ')}`);
      const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env, log: ctx.log, signal: ctx.signal });
      output = run.output;
      exitCode = run.exitCode;
    }

    const tests = runner === 'jest' ? parseJestSummary(output, exitCode) : parseVitestSummary(output, exitCode);
    const finalJson = path.join(coverageDir, 'coverage-final.json');
    if (!fs.existsSync(finalJson)) {
      throw new Error(`${runner} produced no coverage, and ended with exit code ${exitCode}. Press "Show the log" to see the test run.`);
    }
    const attribution: string[] = [];
    for (const file of fs.readdirSync(attrDir)) {
      if (file.endsWith('.jsonl')) {
        attribution.push(...fs.readFileSync(path.join(attrDir, file), 'utf8').split(/\r?\n/));
      }
    }
    if (attribution.length === 0) {
      ctx.log('The attribution hook produced nothing, so every executed line will show as having run at startup only.');
    }
    const coverages = buildCoverages(ctx.workspaceRoot, fs.readFileSync(finalJson, 'utf8'), attribution);
    return { coverages, tests, measuredFiles: coverages.map((c) => c.path) };
  }
}
