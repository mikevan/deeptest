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
import { detectAngularKarmaConfig, detectAngularRunnerConfig, detectFramework } from './framework';
import { createInstrumenter } from '../../witness/hook';
import { pathToFileURL } from 'node:url';
import { runtimeEnvironment } from '../shared/runtime';

/**
 * jest and vitest are driven through their own binaries. ng-vitest is
 * Vitest under Angular's unit-test builder, driven through `ng test`,
 * because an Angular project's tests need the Angular compiler and
 * TestBed that only the builder provides (1.0 survey, finding 3a).
 */
export type Runner = 'jest' | 'vitest' | 'ng-vitest' | 'ng-karma' | 'mocha';

export interface TsFields {
  runner: 'auto' | Runner;
  extraArgs: string;
}

export function tsFields(settings: LanguageSettings): TsFields {
  const f = settings.fields;
  const runner = f.runner === 'jest' || f.runner === 'vitest' || f.runner === 'mocha' ? f.runner : 'auto';
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

export function readPackageJson(workspaceRoot: string): { deps: Record<string, string>; scripts: Record<string, string>; jest?: unknown; mocha?: unknown } | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    return {
      deps: { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) },
      scripts: (pkg.scripts as Record<string, string> | undefined) ?? {},
      jest: pkg.jest,
      mocha: pkg.mocha,
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
  const hasMocha = Boolean(pkg?.deps.mocha) || Boolean(resolveModuleDir(workspaceRoot, 'mocha'));
  const testScript = pkg?.scripts.test ?? '';
  const named = (word: string): boolean => new RegExp(`\\b${word}\\b`).test(testScript);
  // The test script settles a tie; otherwise the order is Vitest, Jest, Mocha.
  const present = [hasVitest && 'vitest', hasJest && 'jest', hasMocha && 'mocha'].filter((r): r is 'vitest' | 'jest' | 'mocha' => Boolean(r));
  if (present.length > 1) {
    const chosen = present.filter((r) => named(r));
    if (chosen.length === 1) {
      return chosen[0];
    }
  }
  return present[0];
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
  /** Absolute folder holding the hook files (jest.cjs, vitest.mjs, the Witness runtime and loader, and so on). */
  hooksDir: string;
  /** Absolute folder holding the tree-sitter grammars; the Witness loader reads them from here. */
  wasmDir?: string;
}

export class TypeScriptCoverageSource implements CoverageSource {
  constructor(private readonly options: TsCoverageOptions) {}

  private runnerFor(workspaceRoot: string, settings: LanguageSettings): Runner | undefined {
    const { runner } = tsFields(settings);
    if (runner !== 'auto') {
      return runner;
    }
    const framework = detectFramework(workspaceRoot);
    if (framework?.name === 'Angular' && framework.angularRunner && framework.angularBuilder === 'unit-test') {
      return framework.angularRunner === 'karma' ? 'ng-karma' : 'ng-vitest';
    }
    return detectRunner(workspaceRoot);
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
    const problems: string[] = [];
    let nodeVersion = '';
    try {
      const probe = await runProcess('node', ['--version'], { cwd: ctx.workspaceRoot });
      nodeVersion = probe.stdout.trim();
    } catch (err) {
      return { ok: false, summary: 'Node.js not found', problems: [`${(err as Error).message} Install Node.js and make sure "node" is on PATH.`] };
    }
    const framework = detectFramework(ctx.workspaceRoot);
    if (framework?.name === 'Angular' && framework.angularBuilder === 'legacy-karma' && tsFields(ctx.settings).runner === 'auto') {
      // The older devkit builder takes different flags (--karma-config,
      // --code-coverage) and has not been run against a fixture. Saying so
      // beats driving it blind; offering "Install Vitest" would be wrong.
      return {
        ok: false,
        summary: 'Angular, the older Karma builder',
        problems: ['This Angular project tests through the older "@angular-devkit/build-angular:karma" builder. DeepTest drives the "@angular/build:unit-test" builder, with Karma or Vitest under it; Angular\'s "ng update" moves a project across. Nothing needs installing.'],
      };
    }
    const runner = this.runnerFor(ctx.workspaceRoot, ctx.settings);
    if (runner === 'ng-vitest' || runner === 'ng-karma') {
      return this.checkAngularEnvironment(ctx.workspaceRoot, nodeVersion, runner);
    }
    if (runner === 'mocha') {
      return this.checkMochaEnvironment(ctx.workspaceRoot, nodeVersion);
    }
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

  /**
   * Angular with Vitest under the builder. `ng test` needs the CLI, Vitest,
   * and the istanbul coverage provider: the builder picks v8 when both
   * providers are installed or only v8 is, and v8 keeps no live counters
   * for the hook to snapshot, so the generated runner config pins istanbul
   * and the package has to be there.
   */
  private checkAngularEnvironment(workspaceRoot: string, nodeVersion: string, runner: 'ng-vitest' | 'ng-karma'): EnvironmentCheck {
    const runnerName = runner === 'ng-karma' ? 'Karma' : 'Vitest';
    const cli = angularCliBin(workspaceRoot);
    if (!cli) {
      return {
        ok: false,
        summary: `Node ${nodeVersion}, Angular CLI not installed`,
        problems: [`This Angular project runs its tests through "ng test" with ${runnerName}, but @angular/cli is not installed under node_modules. Run npm install.`],
        fix: { title: 'Run npm install', command: 'npm', args: ['install'] },
      };
    }
    if (runner === 'ng-karma') {
      // Karma needs its own Jasmine adapter, a Chrome launcher, and
      // karma-coverage for the counters; all three are in every Angular
      // CLI project's devDependencies. istanbul-lib-instrument, which the
      // builder itself requires for coverage, gives the executable lines of
      // the files no test loads.
      for (const [pkg, why] of [
        ['karma', 'the runner'],
        ['karma-jasmine', 'the Jasmine adapter'],
        ['karma-chrome-launcher', 'the headless Chrome launcher'],
        ['karma-coverage', 'the coverage counters'],
        ['istanbul-lib-instrument', 'the executable lines of files no test loads'],
      ] as const) {
        if (!resolveModuleDir(workspaceRoot, pkg)) {
          return {
            ok: false,
            summary: `Node ${nodeVersion}, ng test with Karma, ${pkg} missing`,
            problems: [`Karma needs ${pkg} (${why}), and it is not installed under node_modules.`],
            fix: { title: `Install ${pkg}`, command: 'npm', args: ['install', '--save-dev', pkg] },
          };
        }
      }
      let karmaVersion = '';
      try {
        karmaVersion = JSON.parse(fs.readFileSync(path.join(resolveModuleDir(workspaceRoot, 'karma')!, 'package.json'), 'utf8')).version ?? '';
      } catch {
        // version is decoration
      }
      return { ok: true, summary: `Node ${nodeVersion}, ng test with karma ${karmaVersion}`, problems: [] };
    }
    const vitestDir = resolveModuleDir(workspaceRoot, 'vitest');
    if (!vitestDir) {
      return {
        ok: false,
        summary: `Node ${nodeVersion}, vitest not installed`,
        problems: ['This Angular project runs its tests through "ng test" with Vitest, but vitest is not installed under node_modules. Run npm install.'],
        fix: { title: 'Run npm install', command: 'npm', args: ['install'] },
      };
    }
    let vitestVersion = '';
    try {
      vitestVersion = JSON.parse(fs.readFileSync(path.join(vitestDir, 'package.json'), 'utf8')).version ?? '';
    } catch {
      // version is decoration
    }
    if (!resolveModuleDir(workspaceRoot, '@vitest/coverage-istanbul')) {
      const spec = coverageIstanbulSpec(vitestVersion);
      return {
        ok: false,
        summary: `Node ${nodeVersion}, ng test with vitest ${vitestVersion}`,
        problems: [`Angular's test builder needs ${spec} for per-test attribution.`],
        fix: { title: `Install ${spec}`, command: 'npm', args: ['install', '--save-dev', spec] },
      };
    }
    return { ok: true, summary: `Node ${nodeVersion}, ng test with vitest ${vitestVersion}`, problems: [] };
  }

  /**
   * Mocha runs under the Witness loader, which needs module.registerHooks:
   * Node 22.15 or later (Node.js, "Modules: node:module API"). Nothing else
   * is required: no coverage package, because Witness instruments the
   * sources itself, in ES modules and CommonJS alike.
   */
  private checkMochaEnvironment(workspaceRoot: string, nodeVersion: string): EnvironmentCheck {
    const supported = nodeSupportsWitness(nodeVersion);
    if (!supported) {
      return {
        ok: false,
        summary: `Node ${nodeVersion}, mocha`,
        problems: [`DeepTest measures Mocha projects through the Witness loader, which needs Node 22.15 or later; this project runs on Node ${nodeVersion}. Install a current Node and run the check again.`],
      };
    }
    const mochaDir = resolveModuleDir(workspaceRoot, 'mocha');
    if (!mochaDir) {
      return {
        ok: false,
        summary: `Node ${nodeVersion}, mocha not installed`,
        problems: ['mocha is listed in package.json but is not installed under node_modules. Run npm install.'],
        fix: { title: 'Run npm install', command: 'npm', args: ['install'] },
      };
    }
    let mochaVersion = '';
    try {
      mochaVersion = JSON.parse(fs.readFileSync(path.join(mochaDir, 'package.json'), 'utf8')).version ?? '';
    } catch {
      // version is decoration
    }
    return { ok: true, summary: `Node ${nodeVersion}, mocha ${mochaVersion} through Witness`, problems: [] };
  }

  /**
   * Mocha through Witness. The loader goes in through NODE_OPTIONS so a
   * --parallel run's workers carry it too; the root hook plugin tells the
   * runtime which test is running. Files no test loads get their maps from
   * the same instrumenter, so the universe and the counters agree by
   * construction.
   */
  private async runMocha(ctx: RunContext): Promise<CoverageRun> {
    const mochaDir = resolveModuleDir(ctx.workspaceRoot, 'mocha');
    if (!mochaDir) {
      throw new Error('mocha is not installed. Run npm install.');
    }
    const { attrDir, coverageDir, hookDir, env } = this.prepareWorkDir(ctx);
    const { extraArgs } = tsFields(ctx.settings);
    const testsPath = ctx.settings.testsPath;
    const sourceRoot = path.join(ctx.workspaceRoot, ctx.settings.sourceRoot || '');
    const loader = pathToFileURL(path.join(hookDir, 'witness-loader.mjs')).href;
    const witnessEnv = {
      ...env,
      NODE_OPTIONS: `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--import=${loader}`,
      DEEPTEST_WASM_DIR: this.options.wasmDir ?? runtimeEnvironment().wasmDir,
      DEEPTEST_SOURCE_ROOT: sourceRoot,
      DEEPTEST_COVERAGE_DIR: coverageDir,
    };
    const args = [path.join(mochaDir, 'bin', 'mocha.js'), '--require', path.join(hookDir, 'mocha.cjs'), ...splitArgs(extraArgs), ...(testsPath ? [`${testsPath}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}`] : [])];
    ctx.log(`$ NODE_OPTIONS=--import=${loader} node ${args.join(' ')}`);
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env: witnessEnv, log: ctx.log, signal: ctx.signal });
    const tests = parseMochaSummary(run.output, run.exitCode);
    const relSourceRoot = ctx.settings.sourceRoot || '';
    const walked = walkSources(sourceRoot)
      .map((rel) => (relSourceRoot ? `${relSourceRoot}/${rel}` : rel))
      .filter((rel) => !isTestFile(rel) && !(testsPath && rel.startsWith(`${testsPath}/`)));
    const extra = await witnessUniverse(ctx.workspaceRoot, walked, this.options.wasmDir ?? runtimeEnvironment().wasmDir, ctx.log);
    return this.collect(ctx, 'mocha', coverageDir, attrDir, tests, run.exitCode, extra);
  }

  async run(ctx: RunContext): Promise<CoverageRun> {
    const runner = this.runnerFor(ctx.workspaceRoot, ctx.settings);
    if (!runner) {
      throw new Error('No test runner. Pick Jest or Vitest on the configuration screen.');
    }
    if (runner === 'ng-vitest') {
      return this.runAngular(ctx);
    }
    if (runner === 'ng-karma') {
      return this.runAngularKarma(ctx);
    }
    if (runner === 'mocha') {
      return this.runMocha(ctx);
    }
    const { workDir, attrDir, coverageDir, hookDir, env } = this.prepareWorkDir(ctx);
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
    return this.collect(ctx, runner, coverageDir, attrDir, tests, exitCode);
  }

  private prepareWorkDir(ctx: RunContext): { workDir: string; attrDir: string; coverageDir: string; hookDir: string; env: NodeJS.ProcessEnv } {
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
    for (const file of ['vitest.mjs', 'attribution.cjs', 'karma.cjs', 'karma-client.js', 'witness.cjs', 'witness-loader.mjs', 'witness-instrument.cjs', 'mocha.cjs']) {
      const from = path.join(this.options.hooksDir, file);
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, path.join(hookDir, file));
      }
    }
    ctx.log(`Hook copied into ${hookDir}.`);
    const env = { ...process.env, DEEPTEST_ATTRIBUTION_DIR: attrDir, DEEPTEST_HOOKS_DIR: hookDir, CI: process.env.CI ?? 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
    return { workDir, attrDir, coverageDir, hookDir, env };
  }

  private collect(ctx: RunContext, runner: Runner, coverageDir: string, attrDir: string, tests: TestRunSummary, exitCode: number | null, extra: FileCoverage[] = []): CoverageRun {
    const finalJson = path.join(coverageDir, 'coverage-final.json');
    if (!fs.existsSync(finalJson)) {
      throw new Error(`${runner === 'ng-vitest' || runner === 'ng-karma' ? 'ng test' : runner === 'mocha' ? 'mocha under Witness' : runner} produced no coverage, and ended with exit code ${exitCode}. Press "Show the log" to see the test run.`);
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
    const seen = new Set(coverages.map((c) => c.path));
    for (const c of extra) {
      if (!seen.has(c.path)) {
        coverages.push(c);
      }
    }
    coverages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { coverages, tests, measuredFiles: coverages.map((c) => c.path) };
  }

  /**
   * Angular with Vitest, through the builder. The run is `ng test` with
   * the hook as a setup file (a project-relative path: the builder bundles
   * setup files and appends an absolute path to the project root), a
   * generated runner config that wraps the project's own and pins the
   * istanbul provider and the reports directory, `--coverage-include` so
   * the report holds every source file and not only the ones a test
   * loaded, and `--isolate`. Isolation is the one that is not obvious:
   * the builder defaults it off to match Karma, and without it the setup
   * file runs once per worker, its hooks attach to the first spec file
   * only, and ten of eleven tests come back unattributed (1.0.4 notes).
   * The builder instruments its own chunks, so the hook maps each counter
   * back to the source file through the chunk's source map (hooks/attribution.cjs).
   */
  private async runAngular(ctx: RunContext): Promise<CoverageRun> {
    const cli = angularCliBin(ctx.workspaceRoot);
    if (!cli) {
      throw new Error('@angular/cli is not installed. Run npm install.');
    }
    const { workDir, attrDir, coverageDir, hookDir, env } = this.prepareWorkDir(ctx);
    const { extraArgs } = tsFields(ctx.settings);
    const sourceGlobRoot = ctx.settings.sourceRoot || '.';
    const testsPath = ctx.settings.testsPath;
    const posix = (p: string): string => p.split(path.sep).join('/');
    const relativeImport = (p: string): string => {
      const rel = posix(path.relative(workDir, p));
      return rel.startsWith('.') ? rel : `./${rel}`;
    };
    const userConfig = detectAngularRunnerConfig(ctx.workspaceRoot);
    const wrapper = [
      '// Generated by DeepTest on every run. Wraps the runner config Angular would load; do not edit.',
      "import { defineConfig, mergeConfig } from 'vitest/config';",
      userConfig ? `import base from ${JSON.stringify(relativeImport(path.join(ctx.workspaceRoot, userConfig)))};` : 'const base = {};',
      "const resolved = typeof base === 'function' ? await base({ command: 'serve', mode: 'test' }) : base;",
      'export default mergeConfig(resolved, defineConfig({',
      '  test: {',
      '    coverage: {',
      "      provider: 'istanbul',",
      `      reportsDirectory: ${JSON.stringify(coverageDir)},`,
      '    },',
      '  },',
      '}));',
      '',
    ].join('\n');
    const wrapperPath = path.join(workDir, 'vitest.config.mjs');
    fs.writeFileSync(wrapperPath, wrapper, 'utf8');
    const include = `${sourceGlobRoot === '.' ? '' : `${sourceGlobRoot}/`}**/*.${SOURCE_GLOB_EXTENSIONS}`;
    const args = [
      cli,
      'test',
      '--watch=false',
      '--isolate',
      '--coverage',
      '--coverage-reporters',
      'json',
      '--coverage-include',
      include,
      // One flag per value: the CLI's array options swallow every following
      // word otherwise, and the run dies with "Unknown arguments".
      ...['**/*.spec.*', '**/*.test.*', '**/.deeptest/**'].flatMap((g) => ['--coverage-exclude', g]),
      ...(testsPath ? [`${testsPath}/**/*.spec.*`, `${testsPath}/**/*.test.*`].flatMap((g) => ['--include', g]) : []),
      '--setup-files',
      posix(path.relative(ctx.workspaceRoot, path.join(hookDir, 'vitest.mjs'))),
      '--runner-config',
      posix(path.relative(ctx.workspaceRoot, wrapperPath)),
      ...splitArgs(extraArgs),
    ];
    ctx.log(`$ node ${args.join(' ')}`);
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env, log: ctx.log, signal: ctx.signal });
    const tests = parseVitestSummary(run.output, run.exitCode);
    return this.collect(ctx, 'ng-vitest', coverageDir, attrDir, tests, run.exitCode);
  }

  /**
   * Angular with Karma, through the builder. The builder ignores
   * `--setup-files` and `--coverage-include` for Karma, so the hook goes in
   * through a generated Karma config (`--runner-config`) that applies the
   * project's own karma.conf.js when there is one, or the builder's
   * built-in defaults when there is not (the builder applies those only
   * when no config file is given), then adds the deeptest framework and
   * reporter, points karma-coverage's json report at .deeptest/coverage,
   * and turns a bare "Chrome" into "ChromeHeadless" so no window opens.
   * The builder instruments each source file before bundling, so the
   * counters are keyed by source path and karma-coverage's report needs no
   * remapping. Files no test loads are absent from that report; they are
   * instrumented here with the project's istanbul-lib-instrument to get
   * their executable lines, all untested (see the 1.0.5 engineering notes
   * for the two-line difference against the Vitest flavour).
   */
  private async runAngularKarma(ctx: RunContext): Promise<CoverageRun> {
    const cli = angularCliBin(ctx.workspaceRoot);
    if (!cli) {
      throw new Error('@angular/cli is not installed. Run npm install.');
    }
    const { workDir, attrDir, coverageDir, hookDir, env } = this.prepareWorkDir(ctx);
    const { extraArgs } = tsFields(ctx.settings);
    const testsPath = ctx.settings.testsPath;
    const posix = (p: string): string => p.split(path.sep).join('/');
    const userConfig = detectAngularKarmaConfig(ctx.workspaceRoot);
    const config = [
      '// Generated by DeepTest on every run. Wraps the Karma config Angular would load; do not edit.',
      "'use strict';",
      "const { createRequire } = require('node:module');",
      `const projectRequire = createRequire(${JSON.stringify(posix(ctx.workspaceRoot) + '/')});`,
      'module.exports = function (config) {',
      userConfig
        ? `  require(${JSON.stringify(posix(path.join(ctx.workspaceRoot, userConfig)))})(config);`
        : [
            '  config.set({',
            "    basePath: '',",
            "    frameworks: ['jasmine'],",
            "    plugins: ['karma-jasmine', 'karma-chrome-launcher', 'karma-coverage'].map((p) => projectRequire(p)),",
            "    reporters: ['progress'],",
            "    browsers: ['ChromeHeadless'],",
            '  });',
          ].join('\n'),
      '  config.set({',
      `    plugins: (config.plugins || []).concat([require(${JSON.stringify(posix(path.join(hookDir, 'karma.cjs')))})]),`,
      "    frameworks: (config.frameworks || ['jasmine']).concat(['deeptest']),",
      "    reporters: (config.reporters || ['progress']).filter((r) => r !== 'kjhtml').concat(['deeptest']),",
      "    browsers: (config.browsers && config.browsers.length ? config.browsers : ['ChromeHeadless']).map((b) => (b === 'Chrome' ? 'ChromeHeadless' : b)),",
      `    coverageReporter: { dir: ${JSON.stringify(posix(coverageDir))}, subdir: '.', reporters: [{ type: 'json' }] },`,
      '  });',
      '};',
      '',
    ].join('\n');
    const configPath = path.join(workDir, 'karma.conf.cjs');
    fs.writeFileSync(configPath, config, 'utf8');
    const args = [
      cli,
      'test',
      '--watch=false',
      '--coverage',
      ...(testsPath ? [`${testsPath}/**/*.spec.*`, `${testsPath}/**/*.test.*`].flatMap((g) => ['--include', g]) : []),
      '--runner-config',
      posix(path.relative(ctx.workspaceRoot, configPath)),
      ...splitArgs(extraArgs),
    ];
    ctx.log(`$ node ${args.join(' ')}`);
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env, log: ctx.log, signal: ctx.signal });
    const tests = parseKarmaSummary(run.output, run.exitCode);
    const sourceRoot = ctx.settings.sourceRoot || '';
    const walked = walkSources(path.join(ctx.workspaceRoot, sourceRoot))
      .map((rel) => (sourceRoot ? `${sourceRoot}/${rel}` : rel))
      .filter((rel) => !isTestFile(rel) && !(testsPath && rel.startsWith(`${testsPath}/`)));
    const extra = unloadedCoverages(ctx.workspaceRoot, walked, ctx.log);
    return this.collect(ctx, 'ng-karma', coverageDir, attrDir, tests, run.exitCode, extra);
  }
}

/**
 * Karma's summary: the last "Executed N of M" line, with "(F FAILED)" and
 * "(skipped S)" when they apply. A run that never executed anything (the
 * browser did not start, the bundle did not build) has no such line and
 * reports 0 passed with the exit code, which the runner refuses to score.
 */
export function parseKarmaSummary(output: string, exitCode: number | null): TestRunSummary {
  const summary: TestRunSummary = { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode };
  const line = stripAnsi(output)
    .split(/\r?\n/)
    .reverse()
    .find((l) => /Executed \d+ of \d+/.test(l));
  if (!line) {
    if (exitCode !== 0) {
      summary.errors = 1;
    }
    return summary;
  }
  const executed = Number(/Executed (\d+) of/.exec(line)?.[1] ?? 0);
  const failed = Number(/\((\d+) FAILED\)/.exec(line)?.[1] ?? 0);
  const skipped = Number(/\(skipped (\d+)\)/.exec(line)?.[1] ?? 0);
  summary.failed = failed;
  summary.skipped = skipped;
  summary.passed = Math.max(0, executed - failed);
  if (/ERROR/.test(line) && executed === 0) {
    summary.errors = 1;
  }
  return summary;
}

/**
 * Executable lines of source files the Karma run never loaded, from the
 * project's istanbul-lib-instrument on the TypeScript as written, with no
 * test on any of them. The builder's own counters come from the compiled
 * JavaScript, so a decorator or class-field line the compiler lowers into
 * a statement is executable there and not here; nothing with a decision
 * differs. A file the instrumenter cannot parse is logged and left out
 * rather than guessed at.
 */
export function unloadedCoverages(workspaceRoot: string, relativePaths: string[], log: (line: string) => void): FileCoverage[] {
  const instrumentDir = resolveModuleDir(workspaceRoot, 'istanbul-lib-instrument');
  if (!instrumentDir) {
    log('istanbul-lib-instrument is not installed, so files no test loads are missing from this report.');
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createInstrumenter } = require(instrumentDir) as { createInstrumenter: (o: unknown) => { instrumentSync: (code: string, file: string) => string; lastFileCoverage: () => { statementMap: Record<string, { start: { line: number } }> } } };
  const out: FileCoverage[] = [];
  for (const rel of relativePaths) {
    const abs = path.join(workspaceRoot, rel);
    try {
      const instrumenter = createInstrumenter({
        esModules: true,
        parserPlugins: ['typescript', 'decorators-legacy', 'asyncGenerators', 'bigInt', 'classProperties', 'classPrivateProperties', 'dynamicImport', 'importMeta', 'numericSeparator', 'objectRestSpread', 'optionalCatchBinding', 'topLevelAwait'],
      });
      instrumenter.instrumentSync(fs.readFileSync(abs, 'utf8'), abs);
      const lines = new Map<number, Set<string>>();
      for (const stmt of Object.values(instrumenter.lastFileCoverage().statementMap)) {
        lines.set(stmt.start.line, new Set());
      }
      out.push({ path: rel, lines, executed: new Set() });
    } catch (err) {
      log(`Could not read the executable lines of ${rel}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  return out;
}

/** node_modules/@angular/cli/bin/ng.js, when the CLI is installed in the project. */
export function angularCliBin(workspaceRoot: string): string | undefined {
  const dir = resolveModuleDir(workspaceRoot, '@angular/cli');
  if (!dir) {
    return undefined;
  }
  const bin = path.join(dir, 'bin', 'ng.js');
  return fs.existsSync(bin) ? bin : undefined;
}

/** module.registerHooks exists from Node 22.15.0 and 23.5.0 ("Modules: node:module API", https://nodejs.org/api/module.html). */
export function nodeSupportsWitness(version: string): boolean {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) {
    return false;
  }
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 23 || (major === 23 && minor >= 5) || (major === 22 && minor >= 15);
}

/** Mocha's summary: "10 passing (5ms)", "2 failing", "1 pending". */
export function parseMochaSummary(output: string, exitCode: number | null): TestRunSummary {
  const summary: TestRunSummary = { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode };
  const text = stripAnsi(output);
  const grab = (word: string): number => {
    const m = new RegExp(`(\\d+) ${word}`).exec(text);
    return m ? Number(m[1]) : 0;
  };
  summary.passed = grab('passing');
  summary.failed = grab('failing');
  summary.skipped = grab('pending');
  if (summary.passed + summary.failed + summary.skipped === 0 && exitCode !== 0) {
    summary.errors = 1;
  }
  return summary;
}

/**
 * The executable universe of files the run never loaded, from the Witness
 * instrumenter in this process: the same rules as the counters, so a loaded
 * file and an unloaded one are measured alike. Every line is untested.
 */
export async function witnessUniverse(workspaceRoot: string, relativePaths: string[], wasmDir: string, log: (line: string) => void): Promise<FileCoverage[]> {
  if (relativePaths.length === 0) {
    return [];
  }
  const instrumenter = await createInstrumenter(wasmDir);
  const out: FileCoverage[] = [];
  for (const rel of relativePaths) {
    const abs = path.join(workspaceRoot, rel);
    try {
      const maps = instrumenter.mapsOnly(abs.split(path.sep).join('/'), fs.readFileSync(abs, 'utf8'));
      const lines = new Map<number, Set<string>>();
      for (const stmt of Object.values(maps.statementMap)) {
        lines.set(stmt.start.line, new Set());
      }
      out.push({ path: rel, lines, executed: new Set() });
    } catch (err) {
      log(`Could not read the executable lines of ${rel}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  return out;
}
