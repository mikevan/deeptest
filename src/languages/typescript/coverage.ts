/**
 * TypeScript / JavaScript CoverageSource over Jest or Vitest.
 *
 * Per-test attribution, and the two runners no longer get it the same way.
 * Jest still instruments with Istanbul and keeps live counters in a global
 * inside the worker, and hooks/jest.cjs snapshots those counters around every
 * test. Vitest is measured by Witness: the Vite plugin instruments every source
 * as Vite transforms it, and hooks/witness-vitest.mjs marks the test boundary,
 * so nothing but Vitest itself has to be installed in the project.
 *
 * How the hook gets loaded without clobbering the project's own config:
 *   Jest   - `jest --showConfig` reveals the existing setupFilesAfterEnv;
 *            the run passes that list plus the hook.
 *   Vitest - a generated .deeptest/vitest.config.mjs imports the project's
 *            config, merges the Witness plugin in, and replaces setupFiles
 *            with the Witness hook ahead of the project's own. Replaces, not
 *            merges: a project's setup file usually sits under the source root,
 *            so it is instrumented, and it must not run before the runtime
 *            exists.
 *
 * The executable-line universe. Jest takes it from the runner's own
 * coverage-final.json, which includes files no test loaded. Vitest cannot:
 * Vite only transforms what something imports, so a source file no test
 * reaches is invisible to the plugin. witnessUniverse() measures those files
 * with the same instrumenter afterwards, which is what keeps an untested
 * module red instead of vanishing from the report.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileCoverage } from '../../engine/types';
import { runProcess } from '../shared/process';
import { CoverageRun, CoverageSource, EnvironmentCheck, Evidence, LanguageSettings, RunContext, TestRunSummary } from '../types';
import { detectAngularKarmaConfig, detectAngularRunnerConfig, detectFramework } from './framework';
import { createInstrumenter, hooksDir as witnessHooksDir, HOOK_FILES as WITNESS_HOOK_FILES, ENV as WITNESS_ENV, nodeSupportsWitness } from '@projectrevivesolutions/witness';

export { nodeSupportsWitness };
import { pathToFileURL } from 'node:url';
import { runtimeEnvironment } from '../shared/runtime';
import { engineMismatch, engineMismatchSentence } from './engines';

/**
 * jest and vitest are driven through their own binaries. ng-vitest is
 * Vitest under Angular's unit-test builder, driven through `ng test`,
 * because an Angular project's tests need the Angular compiler and
 * TestBed that only the builder provides (1.0 survey, finding 3a).
 */
export type Runner = 'jest' | 'vitest' | 'ng-vitest' | 'ng-karma' | 'mocha' | 'playwright-ct';

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
  /** Witness adds this: decisions it chose not to count, line and reason. Istanbul reports have no such key. */
  skipped?: Array<{ line: number; reason: string }>;
}

/** One per-test line as every hook writes it; `boundary` only when Witness had to cut the test off. */
export interface AttributionRecord {
  test: string;
  files: Record<string, number[]>;
  boundary?: 'overlapped' | 'unterminated';
}

/** The attribution lines parsed, blank and unreadable lines dropped. */
export function parseAttribution(lines: string[]): AttributionRecord[] {
  const out: AttributionRecord[] = [];
  for (const raw of lines) {
    if (!raw.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(raw) as AttributionRecord;
      if (entry && typeof entry.test === 'string') {
        out.push(entry);
      }
    } catch {
      // a torn line from a process that died mid-write; the count will show it
    }
  }
  return out;
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
    const skipped = Array.isArray(file.skipped) && file.skipped.length > 0 ? file.skipped : undefined;
    byPath.set(relative, skipped ? { path: relative, lines, executed, skipped } : { path: relative, lines, executed });
  }
  for (const entry of parseAttribution(attributionLines)) {
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

/**
 * The packages DeepTest actually starts for a runner, in the order a person
 * would meet them. Angular's CLI is first because it is the process that
 * refuses; the builder and the runner under it follow. Anything not
 * installed is skipped by the gate, so listing a package that a given
 * project does not have costs nothing.
 */
export function enginePackages(runner: Runner, workspaceRoot: string): string[] {
  if (runner === 'ng-vitest') {
    return ['@angular/cli', '@angular/build', 'vitest'];
  }
  if (runner === 'ng-karma') {
    return ['@angular/cli', '@angular/build', 'karma'];
  }
  if (runner === 'playwright-ct') {
    const ct = detectPlaywrightCt(workspaceRoot);
    return ct ? [ct.package, '@playwright/test'] : ['@playwright/test'];
  }
  return [runner];
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
    if (detectPlaywrightCt(workspaceRoot)) {
      return 'playwright-ct';
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

  /**
   * The environment check, and then the question it used to skip: does the
   * tool we are about to drive run on this Node at all? Everything below
   * answers "is it installed and configured"; the gate at the end reads what
   * each tool publishes in `engines.node` and refuses when the running Node
   * is outside it. Before 1.0.15 the screen said ok and the Angular CLI then
   * refused to start, which is the check answering a question it had not
   * asked. The gate runs only on an otherwise good environment, because a
   * missing package is the more useful thing to say first.
   */
  async checkEnvironment(ctx: Pick<RunContext, 'workspaceRoot' | 'settings' | 'log'>): Promise<EnvironmentCheck> {
    let nodeVersion = '';
    try {
      const probe = await runProcess('node', ['--version'], { cwd: ctx.workspaceRoot });
      nodeVersion = probe.stdout.trim();
    } catch (err) {
      return { ok: false, summary: 'Node.js not found', problems: [`${(err as Error).message} Install Node.js and make sure "node" is on PATH.`] };
    }
    const result = await this.checkInstalled(ctx, nodeVersion);
    if (!result.ok) {
      return result;
    }
    return this.engineGate(ctx.workspaceRoot, nodeVersion, this.runnerFor(ctx.workspaceRoot, ctx.settings), result);
  }

  /**
   * Reads what each tool this runner drives declares in `engines.node` and
   * turns the first unsatisfiable one into a refusal. A tool that declares
   * nothing, is not installed, or declares a range the reader cannot parse
   * is passed over: see engines.ts for why an unreadable range lets the run
   * proceed rather than stopping it.
   */
  private engineGate(workspaceRoot: string, nodeVersion: string, runner: Runner | undefined, ok: EnvironmentCheck): EnvironmentCheck {
    if (!runner) {
      return ok;
    }
    const packages = enginePackages(runner, workspaceRoot).map((name) => {
      const dir = resolveModuleDir(workspaceRoot, name);
      let packageJsonText: string | undefined;
      if (dir) {
        try {
          packageJsonText = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
        } catch {
          packageJsonText = undefined;
        }
      }
      return { name, packageJsonText };
    });
    const mismatch = engineMismatch(nodeVersion, packages);
    if (!mismatch) {
      return ok;
    }
    return {
      ok: false,
      summary: `Node ${nodeVersion}, ${mismatch.tool} needs ${mismatch.requires}`,
      problems: [engineMismatchSentence(mismatch)],
    };
  }

  private async checkInstalled(ctx: Pick<RunContext, 'workspaceRoot' | 'settings' | 'log'>, nodeVersion: string): Promise<EnvironmentCheck> {
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
    if (runner === 'playwright-ct') {
      return this.checkPlaywrightEnvironment(ctx.workspaceRoot, nodeVersion, ctx.settings);
    }
    if (!runner) {
      return {
        ok: false,
        summary: `Node ${nodeVersion}, no test runner`,
        problems: ['Neither Jest nor Vitest is in this project. Install one, or pick one on the setup screen.'],
        fix: { title: 'Install Vitest', command: 'npm', args: ['install', '--save-dev', 'vitest'] },
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
    // Vitest needs nothing installed beyond itself. Witness instruments through
    // the Vite plugin the generated wrapper adds, so the project's own coverage
    // provider is not used and the pinned @vitest/coverage-istanbul install this
    // check used to demand is gone. Angular's builder still runs on istanbul, so
    // checkAngularEnvironment keeps its requirement until that runner moves.
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
    // The builder bundles before Vitest runs, so this path measures through
    // the builder's own istanbul instrumentation of its chunks and maps the
    // counters back to sources (1.0.4, restored in 1.0.15). That needs the
    // provider in the project, pinned to the project's Vitest major, because
    // the provider and Vitest move together. 1.0.12 to 1.0.14 dropped this
    // requirement along with the path that needed it.
    if (!resolveModuleDir(workspaceRoot, '@vitest/coverage-istanbul')) {
      const spec = coverageIstanbulSpec(vitestVersion);
      return {
        ok: false,
        summary: `Node ${nodeVersion}, ng test with vitest ${vitestVersion}, ${spec} missing`,
        problems: [`This Angular project runs its tests through "ng test" with Vitest, and DeepTest measures that run with the istanbul coverage provider, which is not installed under node_modules. Install ${spec} and check again.`],
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
      [WITNESS_ENV.wasmDir]: this.options.wasmDir ?? runtimeEnvironment().wasmDir,
      [WITNESS_ENV.sourceRoot]: sourceRoot,
      [WITNESS_ENV.coverageDir]: coverageDir,
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

  /**
   * Playwright component tests. Witness instruments the component build
   * through a Vite plugin the wrapper config adds, and the page reports to
   * the Witness runtime the same plugin injects, so nothing is installed
   * in the project. Playwright runs code inside a test's worker only
   * through a fixture a test file imports (Playwright, "Fixtures"), so
   * DeepTest writes its fixture to .deeptest/hooks/ and a resolve hook in
   * every Playwright process (hooks/witness-playwright-loader.mjs, through
   * NODE_OPTIONS) answers each spec's import of the component package with
   * that file. The spec keeps its ordinary import; nothing in the project
   * changes. The hook needs the same Node as Mocha does.
   */
  private checkPlaywrightEnvironment(workspaceRoot: string, nodeVersion: string, settings: LanguageSettings): EnvironmentCheck {
    const ct = detectPlaywrightCt(workspaceRoot)!;
    if (!nodeSupportsWitness(nodeVersion)) {
      return {
        ok: false,
        summary: `Node ${nodeVersion}, Playwright component tests`,
        problems: [`DeepTest attributes Playwright component tests through a hook in Playwright's workers, which needs Node 22.15 or later; this project runs on Node ${nodeVersion}. Install a current Node and run the check again.`],
      };
    }
    if (!resolveModuleDir(workspaceRoot, '@playwright/test') || !resolveModuleDir(workspaceRoot, ct.package)) {
      return {
        ok: false,
        summary: `Node ${nodeVersion}, Playwright not installed`,
        problems: [`${ct.package} is listed in package.json but is not installed under node_modules. Run npm install.`],
        fix: { title: 'Run npm install', command: 'npm', args: ['install'] },
      };
    }
    if (playwrightComponentTests(workspaceRoot, settings).length === 0) {
      return { ok: false, summary: `Node ${nodeVersion}, Playwright component tests`, problems: [`No component test was found (${ct.configFile ?? 'no playwright-ct config'}).`] };
    }
    return { ok: true, summary: `Node ${nodeVersion}, Playwright component tests through Witness`, problems: [] };
  }

  private async runPlaywrightCt(ctx: RunContext): Promise<CoverageRun> {
    const ct = detectPlaywrightCt(ctx.workspaceRoot);
    // The component-testing package's own cli.js: it is what `npx playwright`
    // resolves to in such a project, and it registers the component plugin.
    // @playwright/test's cli.js can carry a second copy of the runner, and
    // two copies means "Playwright Test did not expect test() to be called here".
    const cli = ct ? resolveModuleDir(ctx.workspaceRoot, ct.package) : undefined;
    if (!ct || !cli) {
      throw new Error('Playwright component tests are not installed. Run npm install.');
    }
    if (!ct.configFile) {
      throw new Error('No playwright-ct config file was found at the workspace root.');
    }
    const { workDir, attrDir, coverageDir, hookDir, env } = this.prepareWorkDir(ctx);
    const fixture = writePlaywrightFixture(ctx.workspaceRoot, ct.package);
    const workerHook = pathToFileURL(path.join(hookDir, 'witness-playwright-loader.mjs')).href;
    const { extraArgs } = tsFields(ctx.settings);
    const sourceRoot = path.join(ctx.workspaceRoot, ctx.settings.sourceRoot || '');
    const wrapperPath = path.join(workDir, 'playwright-ct.config.mjs');
    fs.writeFileSync(wrapperPath, playwrightWrapperConfig(ctx.workspaceRoot, ct.configFile), 'utf8');
    fs.rmSync(path.join(workDir, 'playwright-cache'), { recursive: true, force: true });
    // Only the page is measured. Playwright's own loader transforms what a
    // test imports in the worker and short-circuits every other loader, so
    // a function a test calls in Node, not in the page, is not counted; the
    // setup screen says so (docs/witness.md, "Not yet").
    // The worker hook goes in through NODE_OPTIONS so Playwright's own
    // worker processes inherit it; it answers each spec's import of the
    // component package with the fixture.
    const witnessEnv = {
      ...env,
      [WITNESS_ENV.wasmDir]: this.options.wasmDir ?? runtimeEnvironment().wasmDir,
      [WITNESS_ENV.sourceRoot]: sourceRoot,
      [WITNESS_ENV.fixture]: fixture,
      [WITNESS_ENV.ctPackage]: ct.package,
      NODE_OPTIONS: `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--import=${workerHook}`,
    };
    const args = [path.join(cli, 'cli.js'), 'test', '-c', wrapperPath, ...splitArgs(extraArgs)];
    ctx.log(`$ NODE_OPTIONS=--import=${workerHook} node ${args.join(' ')}`);
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env: witnessEnv, log: ctx.log, signal: ctx.signal });
    if (/Executable doesn't exist|playwright install/.test(run.output) && run.exitCode !== 0) {
      throw new Error('Playwright has no browser installed for this project. Run "npx playwright install chromium" in the project, then check again.');
    }
    const tests = parsePlaywrightSummary(run.output, run.exitCode);
    mergePlaywrightRecords(attrDir, coverageDir);
    const relSourceRoot = ctx.settings.sourceRoot || '';
    const walked = walkSources(sourceRoot)
      .map((rel) => (relSourceRoot ? `${relSourceRoot}/${rel}` : rel))
      .filter((rel) => !isTestFile(rel) && !/\.ct\.[cm]?[jt]sx?$/.test(rel));
    const extra = await witnessUniverse(ctx.workspaceRoot, walked, this.options.wasmDir ?? runtimeEnvironment().wasmDir, ctx.log);
    return this.collect(ctx, 'playwright-ct', coverageDir, attrDir, tests, run.exitCode, extra);
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
    if (runner === 'playwright-ct') {
      return this.runPlaywrightCt(ctx);
    }
    const { workDir, attrDir, coverageDir, hookDir, env } = this.prepareWorkDir(ctx);
    const { extraArgs } = tsFields(ctx.settings);
    const sourceGlobRoot = ctx.settings.sourceRoot || '.';
    const testsPath = ctx.settings.testsPath;

    let output = '';
    let exitCode: number | null = null;
    // Files the run never loaded. Vite only transforms what something imports,
    // so a source file no test reaches is invisible to the plugin and would
    // vanish from the report rather than show as untested. Filled in below for
    // Vitest, the same way the Mocha and Playwright branches do it.
    let extra: FileCoverage[] = [];
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
      const hook = path.join(hookDir, 'witness-vitest.mjs');
      const sourceRoot = path.join(ctx.workspaceRoot, ctx.settings.sourceRoot || '');
      const wasmDir = this.options.wasmDir ?? runtimeEnvironment().wasmDir;
      // A relative import: Vite bundles the wrapper and everything it
      // imports relatively, so a TypeScript config goes through esbuild
      // like it would on its own. A file:// URL would be left to Node
      // instead, which strips the types itself and warns about it.
      const relativeImport = (p: string): string => {
        const rel = path.relative(workDir, p).split(path.sep).join('/');
        return rel.startsWith('.') ? rel : `./${rel}`;
      };
      const wrapper = [
        '// Generated by DeepTest on every run. Wraps the project config; do not edit.',
        "import { defineConfig, mergeConfig } from 'vitest/config';",
        `import { witnessPlugin } from ${JSON.stringify(relativeImport(path.join(hookDir, 'witness-vite.mjs')))};`,
        userConfig ? `import base from ${JSON.stringify(relativeImport(path.join(ctx.workspaceRoot, userConfig)))};` : 'const base = {};',
        "const resolved = typeof base === 'function' ? await base({ command: 'serve', mode: 'test' }) : base;",
        'const merged = mergeConfig(resolved, defineConfig({',
        '  plugins: [witnessPlugin({',
        `    hooksDir: ${JSON.stringify(hookDir)},`,
        `    wasmDir: ${JSON.stringify(wasmDir)},`,
        `    sourceRoot: ${JSON.stringify(sourceRoot)},`,
        '  })],',
        '}));',
        '// setupFiles is replaced, not merged. mergeConfig concatenates arrays, so a',
        "// merge leaves the project's own setup file first, and a project's setup file",
        '// usually lives under the source root, which means it is instrumented and',
        '// calls the runtime in its prologue. Loaded second, the Witness hook is too',
        '// late and every test file dies on "reading \'file\' of undefined".',
        'const theirs = merged.test?.setupFiles ?? [];',
        `merged.test = { ...merged.test, setupFiles: [${JSON.stringify(hook)}, ...(Array.isArray(theirs) ? theirs : [theirs])] };`,
        'export default merged;',
        '',
      ].join('\n');
      fs.mkdirSync(workDir, { recursive: true });
      const wrapperPath = path.join(workDir, 'vitest.config.mjs');
      fs.writeFileSync(wrapperPath, wrapper, 'utf8');
      // A positional filter is a substring match on test file paths. --dir
      // would re-root the project's include patterns, which breaks them.
      const args = [bin, 'run', '--config', wrapperPath, ...(testsPath ? [`${testsPath}/`] : []), ...splitArgs(extraArgs)];
      const witnessEnv = {
        ...env,
        [WITNESS_ENV.wasmDir]: wasmDir,
        [WITNESS_ENV.sourceRoot]: sourceRoot,
        [WITNESS_ENV.coverageDir]: coverageDir,
      };
      ctx.log(`$ node ${args.join(' ')}`);
      const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env: witnessEnv, log: ctx.log, signal: ctx.signal });
      output = run.output;
      exitCode = run.exitCode;
      const relSourceRoot = ctx.settings.sourceRoot || '';
      const walked = walkSources(sourceRoot)
        .map((rel) => (relSourceRoot ? `${relSourceRoot}/${rel}` : rel))
        .filter((rel) => !isTestFile(rel) && !(testsPath && rel.startsWith(`${testsPath}/`)));
      extra = await witnessUniverse(ctx.workspaceRoot, walked, wasmDir, ctx.log);
    }

    const tests = runner === 'jest' ? parseJestSummary(output, exitCode) : parseVitestSummary(output, exitCode);
    return this.collect(ctx, runner, coverageDir, attrDir, tests, exitCode, extra);
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
    for (const file of ['vitest.mjs', 'attribution.cjs', 'karma.cjs', 'karma-client.js']) {
      const from = path.join(this.options.hooksDir, file);
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, path.join(hookDir, file));
      }
    }
    // The Witness hooks come from the library (bundled into this extension,
    // so hooksDir() is dist/hooks at runtime and the package's dist in a
    // checkout); they sit beside DeepTest's own hooks in the same folder.
    for (const file of WITNESS_HOOK_FILES) {
      const from = path.join(witnessHooksDir(), file);
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, path.join(hookDir, file));
      }
    }
    ctx.log(`Hook copied into ${hookDir}.`);
    const env = { ...process.env, DEEPTEST_ATTRIBUTION_DIR: attrDir, DEEPTEST_HOOKS_DIR: hookDir, [WITNESS_ENV.attributionDir]: attrDir, [WITNESS_ENV.hooksDir]: hookDir, CI: process.env.CI ?? 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
    return { workDir, attrDir, coverageDir, hookDir, env };
  }

  private collect(ctx: RunContext, runner: Runner, coverageDir: string, attrDir: string, tests: TestRunSummary, exitCode: number | null, extra: FileCoverage[] = []): CoverageRun {
    const finalJson = path.join(coverageDir, 'coverage-final.json');
    mergeWitnessReports(coverageDir);
    if (!fs.existsSync(finalJson)) {
      throw new Error(`${runner === 'ng-vitest' || runner === 'ng-karma' ? 'ng test' : runner === 'mocha' ? 'mocha under Witness' : runner === 'playwright-ct' ? 'Playwright under Witness' : runner} produced no coverage, and ended with exit code ${exitCode}. Press "Show the log" to see the test run.`);
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
        seen.add(c.path);
      }
    }
    // A file a loader could not instrument ran as written. It is in no
    // report, so the universe walk above adds it as measured and never
    // executed, which is the one reading that must not survive. Its entry is
    // replaced by an unmeasured one carrying the reason.
    for (const { path: file, reason } of readUnmeasured(coverageDir)) {
      const relative = path.relative(ctx.workspaceRoot, file).split(path.sep).join('/');
      const at = coverages.findIndex((c) => c.path === relative);
      const entry: FileCoverage = { path: relative, lines: new Map(), executed: new Set(), unmeasured: reason };
      if (at >= 0) {
        coverages[at] = entry;
      } else if (!relative.startsWith('..')) {
        coverages.push(entry);
      }
    }
    coverages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const evidence = reconcile(tests, parseAttribution(attribution), coverages);
    ctx.log(
      `Evidence: ${evidence.testsFinished} tests finished, ${evidence.testsRecorded} attribution records, ${evidence.recordsWithEvidence} of them carrying a file, ${evidence.filesWithHits} files with a line that ran, ${evidence.brokenBoundaries} with a broken test boundary.`,
    );
    return { coverages, tests, measuredFiles: coverages.map((c) => c.path), evidence };
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
   *
   * This is 1.0.4's path, restored in 1.0.15. From 1.0.12 to 1.0.14 this
   * method instrumented through the Witness Vite plugin instead, and it
   * measured nothing at all: the builder bundles the application before
   * Vitest is involved, so the only files Vitest transforms are the built
   * chunks in the output folder, which sit outside the source root and the
   * plugin correctly declines. Measured on the angular-vitest port at
   * 1.0.14: eleven tests passed, every coverage report was `{}`, every
   * attribution record was `{"files":{}}`, and the card would have called
   * a fully tested project 81 untested lines. The change went in without an
   * end-to-end test, which the plan had already recorded as a debt. Moving
   * this path onto Witness is real work with no seam here yet; it belongs
   * to the runner migration, not to a delivery whose job is an honest
   * baseline to migrate against.
   */
  private async runAngular(ctx: RunContext): Promise<CoverageRun> {
    const cli = angularCliBin(ctx.workspaceRoot);
    if (!cli) {
      throw new Error('@angular/cli is not installed. Run npm install.');
    }
    const { workDir, attrDir, coverageDir, hookDir, env } = this.prepareWorkDir(ctx);
    const { extraArgs } = tsFields(ctx.settings);
    const testsPath = ctx.settings.testsPath;
    const posix = (p: string): string => p.split(path.sep).join('/');
    const relativeImport = (p: string): string => {
      const rel = posix(path.relative(workDir, p));
      return rel.startsWith('.') ? rel : `./${rel}`;
    };
    const userConfig = detectAngularRunnerConfig(ctx.workspaceRoot);
    const sourceRoot = path.join(ctx.workspaceRoot, ctx.settings.sourceRoot || '');
    const wasmDir = this.options.wasmDir ?? runtimeEnvironment().wasmDir;
    const relSourceRoot = ctx.settings.sourceRoot || '';
    const wrapper = angularRunnerConfig({
      userConfigImport: userConfig ? relativeImport(path.join(ctx.workspaceRoot, userConfig)) : undefined,
      coverageDir,
    });
    const wrapperPath = path.join(workDir, 'vitest.config.mjs');
    fs.writeFileSync(wrapperPath, wrapper, 'utf8');
    const args = [
      cli,
      'test',
      '--watch=false',
      '--isolate',
      '--coverage',
      // One flag per value throughout: the CLI's array options swallow every
      // following word otherwise, and the run dies with "Unknown arguments".
      '--coverage-reporters',
      'json',
      // Without this the report holds only what a test loaded, and a file no
      // test imports drops out of the report instead of showing as untested.
      '--coverage-include',
      posix(relSourceRoot ? `${relSourceRoot}/**/*.${SOURCE_GLOB_EXTENSIONS}` : `**/*.${SOURCE_GLOB_EXTENSIONS}`),
      ...['**/*.spec.*', '**/*.test.*', '**/.deeptest/**'].flatMap((g) => ['--coverage-exclude', g]),
      ...(testsPath ? [`${testsPath}/**/*.spec.*`, `${testsPath}/**/*.test.*`].flatMap((g) => ['--include', g]) : []),
      // The hook goes in through the CLI rather than the wrapper's setupFiles,
      // because that is the seam the builder documents and 1.0.4 proved. It
      // means the builder decides the order against a project's own setup
      // files, which the Vitest path controls directly. If an Angular project
      // with its own setup file under the source root fails on "reading 'file'
      // of undefined", that order is why.
      '--setup-files',
      posix(path.relative(ctx.workspaceRoot, path.join(hookDir, 'vitest.mjs'))),
      '--runner-config',
      posix(path.relative(ctx.workspaceRoot, wrapperPath)),
      ...splitArgs(extraArgs),
    ];
    ctx.log(`$ node ${args.join(' ')}`);
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env, log: ctx.log, signal: ctx.signal });
    const tests = parseVitestSummary(run.output, run.exitCode);
    // `--coverage-include` is meant to put every source file in the report, so
    // this walk should add nothing. It stays as a backstop, because a file
    // missing from the report reads as a file with nothing to say, and it logs
    // what it had to add: on this path that is a finding about the include
    // pattern, not routine. The lines it supplies come from Witness and the
    // rest from the builder's instrumentation of its own compiled output, so
    // the two disagree on a component; that is the universe question the
    // runner migration settles, and mixing them is still better than a file
    // silently vanishing.
    const walked = walkSources(sourceRoot)
      .map((rel) => (relSourceRoot ? `${relSourceRoot}/${rel}` : rel))
      .filter((rel) => !isTestFile(rel) && !(testsPath && rel.startsWith(`${testsPath}/`)));
    const extra = await witnessUniverse(ctx.workspaceRoot, walked, wasmDir, ctx.log);
    return this.collect(ctx, 'ng-vitest', coverageDir, attrDir, tests, run.exitCode, extra);
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
/**
 * The runner config DeepTest generates for `ng test` with Vitest. Pure, so it
 * can be proven without an Angular project installed: the Angular drivers have
 * no end-to-end test, and this pins what the builder is handed.
 *
 * It carries the Witness plugin and nothing else. No coverage provider and no
 * reports directory, because Witness instruments at transform time, on the
 * source, before the builder bundles. That ordering is what retired the
 * chunk-to-source mapping 1.0.4 needed.
 */
export function angularRunnerConfig(options: { userConfigImport?: string; coverageDir: string }): string {
  return [
    '// Generated by DeepTest on every run. Wraps the runner config Angular would load; do not edit.',
    "import { defineConfig, mergeConfig } from 'vitest/config';",
    options.userConfigImport ? `import base from ${JSON.stringify(options.userConfigImport)};` : 'const base = {};',
    "const resolved = typeof base === 'function' ? await base({ command: 'serve', mode: 'test' }) : base;",
    'export default mergeConfig(resolved, defineConfig({',
    '  test: {',
    '    coverage: {',
    // The builder picks v8 whenever v8 is installed beside istanbul or alone,
    // and v8 keeps no live counters for the hook to snapshot around a test.
    "      provider: 'istanbul',",
    `      reportsDirectory: ${JSON.stringify(options.coverageDir)},`,
    '    },',
    '  },',
    '}));',
    '',
  ].join('\n');
}

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
      const reason = `Its executable lines could not be read: ${(err as Error).message.split('\n')[0]}`;
      log(`Could not read the executable lines of ${rel}: ${(err as Error).message.split('\n')[0]}`);
      out.push({ path: rel, lines: new Map(), executed: new Set(), unmeasured: reason });
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
      // Dropping the file here made it vanish from the report, which reads as
      // "nothing wrong here". It is reported as unmeasured with the reason.
      const reason = `Its executable lines could not be read: ${(err as Error).message.split('\n')[0]}`;
      log(`Could not read the executable lines of ${rel}: ${(err as Error).message.split('\n')[0]}`);
      out.push({ path: rel, lines: new Map(), executed: new Set(), unmeasured: reason });
    }
  }
  return out;
}

/**
 * The files Witness could not instrument, from every worker's and every Vite
 * process's note beside the reports. Paths are absolute, forward slashes, as
 * the loader and the plugin spell them.
 */
export function readUnmeasured(coverageDir: string): Array<{ path: string; reason: string }> {
  if (!fs.existsSync(coverageDir)) {
    return [];
  }
  const byPath = new Map<string, string>();
  for (const file of fs.readdirSync(coverageDir).filter((f) => /^unmeasured-.*\.json$/.test(f))) {
    try {
      for (const entry of JSON.parse(fs.readFileSync(path.join(coverageDir, file), 'utf8')) as Array<{ path: string; reason: string }>) {
        if (entry && typeof entry.path === 'string') {
          byPath.set(entry.path, String(entry.reason ?? 'Witness could not instrument it.'));
        }
      }
    } catch {
      // a torn note; the file it named is at worst listed as measured, which the next run corrects
    }
  }
  return Array.from(byPath, ([p, reason]) => ({ path: p, reason }));
}

/**
 * The runner's count against the hooks' records. More records than tests is
 * a retried test and is allowed; fewer is a test that left no record; a
 * broken boundary is a record that credits lines to a test that did not run
 * them alone. The runner decides what to do with the numbers; this only
 * counts them.
 */
export function reconcile(tests: TestRunSummary, records: AttributionRecord[], coverages: FileCoverage[] = []): Evidence {
  return {
    testsFinished: tests.passed + tests.failed,
    testsRecorded: records.length,
    recordsWithEvidence: records.filter((r) => Object.keys(r.files ?? {}).length > 0).length,
    filesWithHits: coverages.filter((c) => c.executed.size > 0).length,
    brokenBoundaries: records.filter((r) => r.boundary !== undefined).length,
    reconcilable: true,
  };
}

const PLAYWRIGHT_CT_PACKAGES = ['@playwright/experimental-ct-react', '@playwright/experimental-ct-vue', '@playwright/experimental-ct-svelte', '@playwright/experimental-ct-solid', '@playwright/experimental-ct-react17'];
const PLAYWRIGHT_CT_CONFIGS = ['playwright-ct.config.ts', 'playwright-ct.config.mts', 'playwright-ct.config.js', 'playwright-ct.config.mjs', 'playwright-ct.config.cjs'];

/** The Playwright component-testing package the project uses, and its config file, or undefined. */
export function detectPlaywrightCt(workspaceRoot: string): { package: string; configFile?: string } | undefined {
  const pkg = readPackageJson(workspaceRoot);
  const found = PLAYWRIGHT_CT_PACKAGES.find((p) => Boolean(pkg?.deps[p]));
  if (!found) {
    return undefined;
  }
  return { package: found, configFile: PLAYWRIGHT_CT_CONFIGS.find((f) => fs.existsSync(path.join(workspaceRoot, f))) };
}

/** Writes the fixture to .deeptest/hooks/witness-playwright.ts for the project's package; the worker hook points specs at it. */
export function writePlaywrightFixture(workspaceRoot: string, ctPackage: string): string {
  const template = fs.readFileSync(path.join(witnessHooksDir(), 'witness-playwright.template.ts'), 'utf8');
  const dir = path.join(workspaceRoot, '.deeptest', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'witness-playwright.ts');
  const content = template.split('__PACKAGE__').join(ctPackage);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
    fs.writeFileSync(file, content, 'utf8');
  }
  return file;
}

/** Component test files under the tests folder (or the whole workspace), relative to the workspace. */
export function playwrightComponentTests(workspaceRoot: string, settings: LanguageSettings): string[] {
  const root = path.join(workspaceRoot, settings.testsPath || '');
  return walkSources(root)
    .map((rel) => (settings.testsPath ? `${settings.testsPath}/${rel}` : rel))
    .filter((rel) => isTestFile(rel) || /\.ct\.[cm]?[jt]sx?$/.test(rel));
}

/** The wrapper config: the project's own config with the Witness Vite plugin added and its relative paths re-rooted. */
export function playwrightWrapperConfig(workspaceRoot: string, configFile: string): string {
  const baseUrl = pathToFileURL(path.join(workspaceRoot, configFile)).href;
  return [
    '// Generated by DeepTest on every run. Wraps the project\'s Playwright config; do not edit.',
    `import base from ${JSON.stringify(baseUrl)};`,
    "import { witnessPlugin } from './hooks/witness-vite.mjs';",
    "import * as path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "const here = path.dirname(fileURLToPath(import.meta.url));",
    `const projectRoot = ${JSON.stringify(workspaceRoot)};`,
    "const abs = (p) => (typeof p === 'string' && !path.isAbsolute(p) ? path.resolve(projectRoot, p) : p);",
    "const plugin = witnessPlugin({ hooksDir: path.join(here, 'hooks'), wasmDir: process.env.WITNESS_WASM_DIR, sourceRoot: process.env.WITNESS_SOURCE_ROOT });",
    'function withWitness(use) {',
    "  // Playwright joins ctTemplateDir onto the config's own folder with path.join, so it stays relative to .deeptest/.",
    "  // Playwright reuses a built bundle when its sources and dependencies are unchanged, config included, so the Witness build lives in its own cache folder, emptied before every run.",
    "  use = { ...use, ctTemplateDir: path.relative(here, abs(use?.ctTemplateDir ?? 'playwright')), ctCacheDir: path.join(here, 'playwright-cache') };",
    '  const vite = use.ctViteConfig;',
    "  if (typeof vite === 'function') {",
    '    return { ...use, ctViteConfig: async (...args) => { const c = await vite(...args); return { ...c, plugins: [...(c?.plugins ?? []), plugin] }; } };',
    '  }',
    '  return { ...use, ctViteConfig: { ...(vite ?? {}), plugins: [...(vite?.plugins ?? []), plugin] } };',
    '}',
    "const config = { ...base, use: withWitness(base.use), testDir: abs(base.testDir ?? '.'), outputDir: abs(base.outputDir ?? 'test-results') };",
    "for (const k of ['snapshotDir', 'globalSetup', 'globalTeardown']) { if (base[k] !== undefined) { config[k] = abs(base[k]); } }",
    'if (Array.isArray(base.projects)) {',
    '  config.projects = base.projects.map((p) => ({ ...p, ...(p.testDir ? { testDir: abs(p.testDir) } : {}), ...(p.use ? { use: withWitness(p.use) } : {}) }));',
    '}',
    'export default config;',
    '',
  ].join('\n');
}

/** Playwright's summary: "2 passed (2.6s)", "1 failed", "1 flaky", "1 skipped", "1 did not run". */
export function parsePlaywrightSummary(output: string, exitCode: number | null): TestRunSummary {
  const summary: TestRunSummary = { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode };
  const text = stripAnsi(output);
  const grab = (word: string): number => {
    const m = new RegExp(`(\\d+) ${word}`).exec(text);
    return m ? Number(m[1]) : 0;
  };
  summary.passed = grab('passed') + grab('flaky');
  summary.failed = grab('failed');
  summary.skipped = grab('skipped') + grab('did not run');
  if (summary.passed + summary.failed + summary.skipped === 0 && exitCode !== 0) {
    summary.errors = 1;
  }
  return summary;
}

/**
 * The fixture writes one line per test holding that test's whole page
 * counters. The per-test attribution comes from them (the lines, decision
 * outcomes, and functions with a count above zero), and the whole-run
 * report is their sum.
 */
export function mergePlaywrightRecords(attrDir: string, coverageDir: string): void {
  type Cov = { path: string; statementMap: Record<string, { start: { line: number } }>; fnMap: Record<string, unknown>; branchMap: Record<string, unknown>; s: Record<string, number>; f: Record<string, number>; b: Record<string, number[]> };
  const merged: Record<string, Cov> = {};
  const attribution: string[] = [];
  for (const file of fs.existsSync(attrDir) ? fs.readdirSync(attrDir) : []) {
    if (!/^coverage-pw-.*\.pwcov$/.test(file)) {
      continue;
    }
    for (const line of fs.readFileSync(path.join(attrDir, file), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const record = JSON.parse(line) as { test: string; coverage: Record<string, Cov> };
      const files: Record<string, number[]> = {};
      const outcomes: Record<string, Record<string, number[]>> = {};
      const entered: Record<string, number[]> = {};
      for (const [filePath, cov] of Object.entries(record.coverage)) {
        const lines = new Set<number>();
        for (const [id, count] of Object.entries(cov.s)) {
          if (count > 0) {
            lines.add(cov.statementMap[id].start.line);
          }
        }
        if (lines.size > 0) {
          files[filePath] = Array.from(lines).sort((a, b) => a - b);
        }
        for (const [id, counts] of Object.entries(cov.b)) {
          const taken = counts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
          if (taken.length > 0) {
            (outcomes[filePath] ??= {})[id] = taken;
          }
        }
        const fns = Object.entries(cov.f).filter(([, c]) => c > 0).map(([id]) => Number(id));
        if (fns.length > 0) {
          entered[filePath] = fns;
        }
        const target = merged[filePath] ?? (merged[filePath] = { ...cov, s: {}, f: {}, b: {} });
        for (const [id, count] of Object.entries(cov.s)) {
          target.s[id] = (target.s[id] ?? 0) + count;
        }
        for (const [id, count] of Object.entries(cov.f)) {
          target.f[id] = (target.f[id] ?? 0) + count;
        }
        for (const [id, counts] of Object.entries(cov.b)) {
          target.b[id] = counts.map((c, i) => (target.b[id]?.[i] ?? 0) + c);
        }
      }
      attribution.push(JSON.stringify({ test: record.test, files, outcomes, entered }));
    }
  }
  fs.mkdirSync(coverageDir, { recursive: true });
  // One more per-process report for mergeWitnessReports to sum with the workers' own.
  fs.writeFileSync(path.join(coverageDir, 'coverage-page.json'), JSON.stringify(merged));
  if (attribution.length > 0) {
    fs.writeFileSync(path.join(attrDir, 'attr-witness-playwright.jsonl'), `${attribution.join('\n')}\n`);
  }
}

/**
 * Witness writes one Istanbul-shaped report per process (coverage-<pid>.json,
 * coverage-page.json). When no runner wrote coverage-final.json itself, this
 * sums them into one: the same file measured in two processes (a worker and
 * a page, or two workers) adds its counts.
 */
export function mergeWitnessReports(coverageDir: string): void {
  const finalJson = path.join(coverageDir, 'coverage-final.json');
  if (fs.existsSync(finalJson) || !fs.existsSync(coverageDir)) {
    return;
  }
  type Cov = { path: string; statementMap: Record<string, unknown>; fnMap: Record<string, unknown>; branchMap: Record<string, unknown>; s: Record<string, number>; f: Record<string, number>; b: Record<string, number[]> };
  const parts = fs.readdirSync(coverageDir).filter((f) => /^coverage-.*\.json$/.test(f));
  if (parts.length === 0) {
    return;
  }
  const merged: Record<string, Cov> = {};
  for (const part of parts) {
    const report = JSON.parse(fs.readFileSync(path.join(coverageDir, part), 'utf8')) as Record<string, Cov>;
    for (const [filePath, cov] of Object.entries(report)) {
      const target = merged[filePath] ?? (merged[filePath] = { ...cov, s: {}, f: {}, b: {} });
      for (const [id, count] of Object.entries(cov.s)) {
        target.s[id] = (target.s[id] ?? 0) + count;
      }
      for (const [id, count] of Object.entries(cov.f)) {
        target.f[id] = (target.f[id] ?? 0) + count;
      }
      for (const [id, counts] of Object.entries(cov.b)) {
        target.b[id] = counts.map((c, i) => (target.b[id]?.[i] ?? 0) + c);
      }
    }
  }
  fs.writeFileSync(finalJson, JSON.stringify(merged));
}
