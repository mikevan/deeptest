/**
 * TypeScript / JavaScript coverage, per test, for every runner DeepTest
 * drives: Jest, Vitest, Mocha, Playwright component tests, and Angular
 * through its unit-test builder with either Vitest or Karma under it.
 *
 * One instrumenter and one runtime underneath all of them. Witness rewrites
 * the source textually, on the source's own lines, and the runtime records
 * for every statement, decision and function entry which test was running.
 * So a line in a record is already a line in the person's editor, in every
 * runner, and nothing is ever mapped back out of compiled or bundled output.
 * Since 1.0.17 no runner uses Istanbul: the only istanbul left in the tree is
 * the library the test suite differentials the maps against, which is a
 * development dependency and never ships.
 *
 * What differs between runners is only where the instrumenting can be done,
 * and that is decided by where each one's own transform sits:
 *   Vitest  - the Witness Vite plugin, in a generated wrapper config that
 *             imports the project's own and puts the runtime's setup file
 *             ahead of the project's (a project's setup file usually lives
 *             under the source root, so it is instrumented, and it must not
 *             run before the runtime exists).
 *   Jest    - Jest's transform contract is synchronous and the instrumenter
 *             is not, so every source is instrumented ahead of the run and a
 *             generated transformer substitutes the instrumented text before
 *             calling the project's own.
 *   Mocha,
 *   Playwright - the Witness loader and the component-build plugin.
 *   Angular - the builder bundles the application before either runner is
 *             involved and exposes no hook in front of that, so the source
 *             root is mirrored into a shadow tree, instrumented, and the
 *             builder is pointed at the mirror (writeShadowTree).
 *
 * The executable-line universe. Only Jest's own report lists files no test
 * loaded; everywhere else a file nothing imports is invisible to the
 * transform. witnessUniverse() measures those afterwards with the same
 * instrumenter, which is what keeps an untested module red instead of
 * vanishing from the report.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileCoverage } from '../../engine/types';
import { runProcess } from '../shared/process';
import { CoverageRun, CoverageSource, EnvironmentCheck, Evidence, LanguageSettings, RunContext, TestRunSummary } from '../types';
import { detectAngularKarmaConfig, detectAngularRunnerConfig, detectAngularTestTarget, detectFramework } from './framework';
import {
  createInstrumenter,
  ENV as WITNESS_ENV,
  nodeSupportsWitness,
  copyHooks,
  readPackageJson,
  findVitestConfig,
  resolveModuleDir,
  detectRunner,
  vitestWrapperConfig,
  witnessTransform,
  angularKarmaConfig,
  writeShadowTree as mirrorSourceRoot,
  detectPlaywrightCt,
  writePlaywrightFixture as writeWitnessPlaywrightFixture,
  playwrightWrapperConfig as witnessPlaywrightWrapperConfig,
  pathCondition,
  pathConditionNote,
  presentPathFailure,
  writeShadowTsConfig,
  parseTsConfigText,
  readTsPaths,
  renameTestFiles,
  posixPath,
  splitArgs,
  escapeRegex,
} from '@projectrevivesolutions/witness';
import type { Runner, TsPaths, JestResolvedConfig, WitnessMaps, ProblemPacket } from '@projectrevivesolutions/witness';

// The runner-delivery layer lives in Witness, so both tools reach a project's
// own runner the same way. These are re-exported because they are part of the
// TypeScript driver's surface and its callers should not have to know which
// package a helper moved to.
export { detectPlaywrightCt, readPackageJson, findVitestConfig, resolveModuleDir, detectRunner, witnessTransform, angularKarmaConfig, writeShadowTsConfig, parseTsConfigText, readTsPaths, renameTestFiles, nodeSupportsWitness };
export type { Runner, TsPaths, JestResolvedConfig };

/**
 * The pointer at the run log, in the words of the control a person presses.
 * The results panel carries a "Show the log" link, so this says "Show the
 * log" and not "check the output" or anything else a person cannot find.
 */
export const SHOW_THE_LOG = 'Press "Show the log" to see the runner\'s own output.';

/**
 * The one line a person reads on the results panel when a run failed.
 *
 * When the toolkit diagnosed the failure, its headline is the whole message.
 * It is not glued onto the end of the runner's own reason, because the
 * runner's reason in that case is "produced no coverage, and ended with exit
 * code 1", which is true, useless, and, read first, sends someone looking at
 * their tests. The runner's reason still goes to the log.
 *
 * With no diagnosis, nothing changes: the person reads the reason the run
 * gave, exactly as before.
 */
export function userFacingFailure(reason: string, headline: string): string {
  return headline || reason;
}

/**
 * A failure the toolkit placed, carrying what it established.
 *
 * The packet rides on the error so that the layer which shows the failure
 * can offer to have it explained, without this file knowing anything about
 * panels, assistants, or buttons.
 */
export class DiagnosedError extends Error {
  constructor(
    message: string,
    readonly packet: ProblemPacket,
  ) {
    super(message);
    this.name = 'DiagnosedError';
  }
}

import { pathToFileURL } from 'node:url';
import { runtimeEnvironment } from '../shared/runtime';
import { engineMismatch, engineMismatchSentence } from './engines';

/**
 * jest and vitest are driven through their own binaries. ng-vitest is
 * Vitest under Angular's unit-test builder, driven through `ng test`,
 * because an Angular project's tests need the Angular compiler and
 * TestBed that only the builder provides (1.0 survey, finding 3a).
 */

export interface TsFields {
  runner: 'auto' | Runner;
  extraArgs: string;
}

export function tsFields(settings: LanguageSettings): TsFields {
  const f = settings.fields;
  const runner = f.runner === 'jest' || f.runner === 'vitest' || f.runner === 'mocha' ? f.runner : 'auto';
  return { runner, extraArgs: typeof f.extraArgs === 'string' ? f.extraArgs : '' };
}

// The sibling tools' folders are skipped alongside DeepTest's own. UntangleIt
// writes generated hooks and a shadow tree into .untangleit from 1.0.19, and
// the two tools are meant to be installed together, so a project measured
// after an untangling would otherwise have UntangleIt's generated files walked
// as if they were the person's source. UntangleIt has skipped all three since
// it shipped; this is the same list from the other side.
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.deeptest', '.untangleit', '.keepsafe', '.vscode-test', '.next', '.nuxt', '.svelte-kit', 'vendor']);
/** Source files the plugin walks and instruments. Single-file components (.vue, .svelte) are included from 1.0.2 so they show red rather than vanish. */
const SOURCE_EXT = /\.(m?[jt]sx?|c[jt]s|vue|svelte)$/;
/** The same set as a glob for the runners' coverage include lists. */
export const SOURCE_GLOB_EXTENSIONS = '{js,jsx,ts,tsx,mjs,cjs,vue,svelte}';
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)/;

export function isTestFile(relativePath: string): boolean {
  const name = path.basename(relativePath);
  return TEST_FILE.test(name) || relativePath.split('/').includes('__tests__');
}

/**
 * What travels with the code rather than being generated. Everything else in
 * `.deeptest` belongs to a run.
 */
const WORK_DIR_KEEP = new Set(['decisions.json']);

/**
 * Empty the tool's folder, keeping only what is the person's.
 *
 * This used to delete the three folders a run writes, by name, which meant a
 * generated file DeepTest had stopped producing stayed forever. The Angular
 * path wrote `.deeptest/vitest.config.mjs` until 1.0.15; two deliveries after
 * the code that wrote it was deleted, the file was still sitting in the ports,
 * still naming a coverage provider, still looking like current configuration
 * to anyone who opened it. Deleting by name can only ever remove the names we
 * think of, and the ones worth removing are the ones we have forgotten.
 *
 * So the rule is ownership, not a list. `.deeptest` is DeepTest's, except the
 * decisions, which are the person's and are meant to be committed. Everything
 * else in it is rebuilt by the run that follows this call, and a stale source
 * file's instrumented copy cannot survive to be served by the transformer.
 */
export function clearWorkDir(workDir: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(workDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!WORK_DIR_KEEP.has(entry)) {
      fs.rmSync(path.join(workDir, entry), { recursive: true, force: true });
    }
  }
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
    // Nothing is installed beyond the runner itself. Witness instruments the
    // sources, so no coverage provider is involved for any runner: the pinned
    // @vitest/coverage-istanbul install this check used to demand went in
    // 1.0.16, and karma-coverage went with the Angular runners in 1.0.17.
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
      // This list is Angular's, not ours. Its Karma runner calls
      // `checker.check(...)` on each of these before it will start
      // (`@angular/build`, `builders/unit-test/runners/karma/index.js`) and
      // refuses the run when one is missing, so a check that does not ask for
      // them first is a check that says "ok" and then watches the runner
      // refuse. That is the shape 1.0.15 existed to remove.
      //
      // `karma-coverage` is on the list and is worth writing down, because it
      // looks like something we should have dropped. The builder guards that
      // one with `if (options.coverage)`, and `options.coverage` is normalized
      // to an object carrying an `enabled` field, so it is truthy whether
      // coverage is on or off. The Vitest runner in the same builder checks
      // `options.coverage.enabled` and gets it right. So Karma demands the
      // package on every run, including this one, which enables no coverage,
      // generates no coverage reporter, and reads none of its output. 1.0.17
      // dropped it from this list on the reasoning that DeepTest had stopped
      // using it, which was true and beside the point: Angular had not.
      for (const [pkg, problem] of [
        ['karma', 'Karma needs karma (the runner), and it is not installed under node_modules.'],
        ['karma-jasmine', 'Karma needs karma-jasmine (the Jasmine adapter), and it is not installed under node_modules.'],
        ['karma-chrome-launcher', 'Karma needs karma-chrome-launcher (the headless Chrome launcher), and it is not installed under node_modules.'],
        ['karma-coverage', "karma-coverage is required by Angular's Karma runner. DeepTest/Witness does not use it for measurement."],
      ] as const) {
        if (!resolveModuleDir(workspaceRoot, pkg)) {
          return {
            ok: false,
            summary: `Node ${nodeVersion}, ng test with Karma, ${pkg} missing`,
            problems: [problem],
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
    const fixture = writeWitnessPlaywrightFixture(workDir, ct.package);
    const workerHook = pathToFileURL(path.join(hookDir, 'witness-playwright-loader.mjs')).href;
    const { extraArgs } = tsFields(ctx.settings);
    const sourceRoot = path.join(ctx.workspaceRoot, ctx.settings.sourceRoot || '');
    const wrapperPath = path.join(workDir, 'playwright-ct.config.mjs');
    fs.writeFileSync(wrapperPath, witnessPlaywrightWrapperConfig({ tool: 'DeepTest', workspaceRoot: ctx.workspaceRoot, configFile: ct.configFile }), 'utf8');
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
    this.notePath(ctx, 'playwright-ct');
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env: witnessEnv, log: ctx.log, signal: ctx.signal });
    if (/Executable doesn't exist|playwright install/.test(run.output) && run.exitCode !== 0) {
      throw new Error('Playwright has no browser installed for this project. Run "npx playwright install chromium" in the project, then check again.');
    }
    const tests = parsePlaywrightSummary(run.output, run.exitCode);
    const guidance = this.explainPath(ctx, 'playwright-ct', run.output, run.exitCode === 0);
    mergePlaywrightRecords(attrDir, coverageDir);
    const relSourceRoot = ctx.settings.sourceRoot || '';
    const walked = walkSources(sourceRoot)
      .map((rel) => (relSourceRoot ? `${relSourceRoot}/${rel}` : rel))
      .filter((rel) => !isTestFile(rel) && !/\.ct\.[cm]?[jt]sx?$/.test(rel));
    const extra = await witnessUniverse(ctx.workspaceRoot, walked, this.options.wasmDir ?? runtimeEnvironment().wasmDir, ctx.log);
    try {
      return this.collect(ctx, 'playwright-ct', coverageDir, attrDir, tests, run.exitCode, extra);
    } catch (err) {
      throw this.failed(ctx, err, guidance);
    }
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
      // Witness measures this run, so Jest's own coverage is not asked for at
      // all. The instrumenting happens before Jest starts, because Jest's
      // transform contract is synchronous and the instrumenter is not; the
      // transformer wraps the project's own and substitutes the instrumented
      // text for the source. See hooks/witness-jest-transform.cjs.
      const bin = path.join(moduleDir, 'bin', 'jest.js');
      const shown = await runProcess('node', [bin, '--showConfig'], { cwd: ctx.workspaceRoot, signal: ctx.signal });
      let resolved: JestResolvedConfig | undefined;
      try {
        resolved = (JSON.parse(shown.stdout) as { configs?: JestResolvedConfig[] }).configs?.[0];
      } catch {
        resolved = undefined;
      }
      const sourceRoot = path.join(ctx.workspaceRoot, ctx.settings.sourceRoot || '');
      const wasmDir = this.options.wasmDir ?? runtimeEnvironment().wasmDir;
      const instrumentedDir = path.join(workDir, 'instrumented');
      const relSourceRoot = ctx.settings.sourceRoot || '';
      const walked = walkSources(sourceRoot)
        .map((rel) => (relSourceRoot ? `${relSourceRoot}/${rel}` : rel))
        .filter((rel) => !isTestFile(rel) && !(testsPath && rel.startsWith(`${testsPath}/`)));
      extra = await witnessUniverse(ctx.workspaceRoot, walked, wasmDir, ctx.log, { sourceRoot, instrumentedDir });
      const transform = witnessTransform(resolved?.transform, path.join(hookDir, 'witness-jest-transform.cjs'));
      if (!transform) {
        // Without the project's resolved transform there is nothing to wrap,
        // and instrumenting nothing would produce a run that measures nothing.
        // Saying so beats running: the evidence check refuses that run anyway,
        // and this names the cause instead of leaving it to be deduced.
        ctx.log('Could not read the Jest config (jest --showConfig), so the project\'s own transformer could not be wrapped and nothing would be measured.');
        throw new Error('DeepTest could not read this project\'s Jest configuration, so it cannot measure the run. Press "Show the log" to see what "jest --showConfig" reported.');
      }
      const args = [
        bin,
        // The test-path filter goes ahead of every flag. Jest's CLI options are
        // yargs arrays, and an array swallows each following word until the
        // next flag, so a positional after them is read as one more setup file
        // and the run dies with "Module ^/...\test\/ in the setupFilesAfterEnv
        // option was not found". That is the same rule the Angular driver hit,
        // written down there as one flag per value.
        ...(testsPath ? [`^${escapeRegex(path.join(ctx.workspaceRoot, testsPath).split(path.sep).join('/'))}/`] : []),
        '--ci',
        '--transform',
        JSON.stringify(transform),
        // Ours first in both lists. The runtime has to exist before any
        // instrumented module's prologue runs, and a project's own setup file
        // may import source; the boundary has to register its beforeEach
        // before a project's, so begin() runs before anything a project's hook
        // touches.
        ...['--setupFiles', path.join(hookDir, 'witness-jest-runtime.cjs')],
        ...(resolved?.setupFiles ?? []).flatMap((f) => ['--setupFiles', f]),
        ...['--setupFilesAfterEnv', path.join(hookDir, 'witness-jest.cjs')],
        ...(resolved?.setupFilesAfterEnv ?? []).flatMap((f) => ['--setupFilesAfterEnv', f]),
        ...splitArgs(extraArgs),
      ];
      const witnessEnv = {
        ...env,
        [WITNESS_ENV.wasmDir]: wasmDir,
        [WITNESS_ENV.sourceRoot]: sourceRoot,
        [WITNESS_ENV.coverageDir]: coverageDir,
        [WITNESS_ENV.instrumentedDir]: instrumentedDir,
      };
      ctx.log(`$ node ${args.join(' ')}`);
      const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env: witnessEnv, log: ctx.log, signal: ctx.signal });
      output = run.output;
      exitCode = run.exitCode;
    } else {
      const bin = path.join(moduleDir, 'vitest.mjs');
      const userConfig = findVitestConfig(ctx.workspaceRoot);
      const sourceRoot = path.join(ctx.workspaceRoot, ctx.settings.sourceRoot || '');
      const wasmDir = this.options.wasmDir ?? runtimeEnvironment().wasmDir;
      const wrapper = vitestWrapperConfig({ tool: 'DeepTest', workDir, hookDir, wasmDir, sourceRoot, workspaceRoot: ctx.workspaceRoot, userConfig });
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
    clearWorkDir(workDir);
    fs.mkdirSync(attrDir, { recursive: true });
    // Every hook is copied into .deeptest/ and loaded from there, and found
    // through the environment rather than by a relative path, so a bundling
    // runner cannot rewrite its way out of finding it.
    // The Witness hooks come from the library (bundled into this extension,
    // so its hooks folder is dist/hooks at runtime and the package's dist in a
    // checkout); Witness copies them, because putting its hooks in front of a
    // runner is Witness's job and UntangleIt needs exactly the same thing.
    const hookDir = copyHooks(path.join(workDir, 'hooks'));
    ctx.log(`Hook copied into ${hookDir}.`);
    const env = { ...process.env, DEEPTEST_ATTRIBUTION_DIR: attrDir, DEEPTEST_HOOKS_DIR: hookDir, [WITNESS_ENV.attributionDir]: attrDir, [WITNESS_ENV.hooksDir]: hookDir, CI: process.env.CI ?? 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
    return { workDir, attrDir, coverageDir, hookDir, env };
  }

  /**
   * The project path as a condition of the run, noted before it starts and
   * explained afterwards if the run failed and the path may be why.
   *
   * It never fails a run on its own and never looks at the person's source.
   * Code a customer wrote to work around this is a solution, not a smell.
   */
  private notePath(ctx: RunContext, runner: Runner): void {
    const note = pathConditionNote(pathCondition(ctx.workspaceRoot), runner);
    if (note) {
      ctx.log(note);
    }
  }

  /**
   * The path guidance, split the way Witness splits it: the supporting lines
   * go to the log, and the one paragraph a person should read comes back for
   * the caller to show.
   *
   * Empty when there is nothing to say, which is every ordinary run.
   */
  private explainPath(ctx: RunContext, runner: Runner, output: string, succeeded: boolean): ProblemPacket | undefined {
    const shown = presentPathFailure({ workspaceRoot: ctx.workspaceRoot, runner, output, succeeded, detailsHint: SHOW_THE_LOG });
    if (!shown) {
      return undefined;
    }
    for (const line of shown.log) {
      ctx.log(line);
    }
    return shown.packet;
  }

  /**
   * What to raise when a run failed and the path may be the reason.
   *
   * The guidance replaces the runner's own reason rather than being glued to
   * the end of it. "ng test produced no coverage, and ended with exit code 1"
   * is true and useless here: the builder never got as far as a test, and a
   * person who reads both sentences at once has to work out which one is the
   * real one. The runner's reason is still written down, in the log, next to
   * the output it came from.
   */
  private failed(ctx: RunContext, err: unknown, packet: ProblemPacket | undefined): Error {
    const reason = err instanceof Error ? err.message : String(err);
    if (!packet) {
      return new Error(reason);
    }
    ctx.log(reason);
    return new DiagnosedError(userFacingFailure(reason, packet.headline), packet);
  }

  private collect(ctx: RunContext, runner: Runner, coverageDir: string, attrDir: string, tests: TestRunSummary, exitCode: number | null, extra: FileCoverage[] = [], rename?: { from: string; to: string }): CoverageRun {
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
    const named = rename ? renameTestFiles(attribution, rename.from, rename.to) : attribution;
    const coverages = buildCoverages(ctx.workspaceRoot, fs.readFileSync(finalJson, 'utf8'), named);
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
    const evidence = reconcile(tests, parseAttribution(named), coverages);
    ctx.log(
      `Evidence: ${evidence.testsFinished} tests finished, ${evidence.testsRecorded} attribution records, ${evidence.recordsWithEvidence} of them carrying a file, ${evidence.filesWithHits} files with a line that ran, ${evidence.brokenBoundaries} with a broken test boundary.`,
    );
    return { coverages, tests, measuredFiles: coverages.map((c) => c.path), evidence };
  }

  /**
   * Everything both Angular runners need, because everything hard about
   * Angular is the same for both: the builder bundles the application before
   * either runner is involved, and exposes no hook in front of that. So the
   * source is instrumented before the builder reads it, into a shadow tree
   * beside the project, and the builder is pointed at the shadow tree.
   *
   * What comes back is the universe (one walk produces both the instrumented
   * text and the executable lines, so they cannot disagree), the include
   * pattern the builder will glob, and the tsconfig it will type-check with.
   * The include is written relative to Angular's project source root and
   * never as an absolute path: the Karma compatibility layer strips a leading
   * slash from every pattern before globbing, which turns an absolute pattern
   * into a relative one that matches nothing, and the run then reports zero
   * tests and passes.
   */
  private async prepareAngularShadow(ctx: RunContext, workDir: string): Promise<{ universe: FileCoverage[]; include: string; tsConfig: string | undefined; rename: { from: string; to: string } }> {
    const wasmDir = this.options.wasmDir ?? runtimeEnvironment().wasmDir;
    const relSourceRoot = ctx.settings.sourceRoot || '';
    const sourceRoot = path.join(ctx.workspaceRoot, relSourceRoot);
    const instrumentedDir = path.join(workDir, 'instrumented');
    const testsPath = ctx.settings.testsPath;
    const measurable = walkSources(sourceRoot)
      .map((rel) => (relSourceRoot ? `${relSourceRoot}/${rel}` : rel))
      .filter((rel) => !isTestFile(rel) && !(testsPath && rel.startsWith(`${testsPath}/`)));
    const tree = await writeShadowTree(ctx.workspaceRoot, sourceRoot, instrumentedDir, measurable, wasmDir, ctx.log);
    const target = detectAngularTestTarget(ctx.workspaceRoot);
    const mirrorOf = (absolute: string): string => path.join(instrumentedDir, path.relative(sourceRoot, absolute));
    const from = target?.projectSourceRoot ?? sourceRoot;
    const specs = testsPath ? mirrorOf(path.join(ctx.workspaceRoot, testsPath)) : instrumentedDir;
    // Both infixes, because the builder's own default is both and a project
    // that names its tests *.test.ts would otherwise run nothing and pass.
    const include = `${posixPath(path.relative(from, specs))}/**/*.@(spec|test).@(ts|tsx)`;
    const tsConfig = target?.tsConfig ? writeShadowTsConfig(workDir, path.join(ctx.workspaceRoot, target.tsConfig), sourceRoot, instrumentedDir) : undefined;
    if (!target) {
      ctx.log('angular.json does not name a project using the unit-test builder, so the shadow tree is addressed from the source root and the project tsconfig is left as it is.');
    }
    return { universe: tree.universe, include, tsConfig, rename: { from: `${posixPath(path.relative(ctx.workspaceRoot, instrumentedDir))}/`, to: relSourceRoot ? `${relSourceRoot}/` : '' } };
  }

  /**
   * Angular with Vitest, through the builder, measured by Witness.
   *
   * The builder bundles the application before Vitest runs, so the Witness
   * Vite plugin never sees a source file: from 1.0.12 to 1.0.14 this path
   * carried that plugin and measured exactly nothing, eleven passing tests
   * with eleven empty records. 1.0.15 restored the 1.0.4 Istanbul path as an
   * honest baseline. This is the third answer and the one that holds: the
   * source is instrumented into the shadow tree first, and the builder is
   * told to build that instead. The counters are therefore already in the
   * bundle by the time the builder touches it, and the maps they carry name
   * the original file and the original line, so nothing has to be mapped back
   * out of a chunk afterwards.
   *
   * `--isolate` stays from 1.0.4 and is not cosmetic: the builder defaults it
   * off to match Karma, and without it the setup file runs once per worker,
   * its hooks attach to the first spec file only, and ten of eleven tests
   * come back unattributed.
   */
  private async runAngular(ctx: RunContext): Promise<CoverageRun> {
    const cli = angularCliBin(ctx.workspaceRoot);
    if (!cli) {
      throw new Error('@angular/cli is not installed. Run npm install.');
    }
    const { workDir, attrDir, coverageDir, hookDir, env } = this.prepareWorkDir(ctx);
    const { extraArgs } = tsFields(ctx.settings);
    const relative = (p: string): string => posixPath(path.relative(ctx.workspaceRoot, p));
    const { universe, include, tsConfig, rename } = await this.prepareAngularShadow(ctx, workDir);
    const runnerConfig = detectAngularRunnerConfig(ctx.workspaceRoot);
    const args = [
      cli,
      'test',
      '--watch=false',
      '--isolate',
      // One flag per value throughout: the CLI's array options swallow every
      // following word otherwise, and the run dies with "Unknown arguments".
      '--include',
      include,
      ...(tsConfig ? ['--ts-config', relative(tsConfig)] : []),
      // The hook goes in through the CLI rather than through a runner config,
      // because that is the seam the builder documents and 1.0.4 proved. It
      // means the builder decides the order against a project's own setup
      // files. If an Angular project with its own setup file under the source
      // root fails on "reading 'file' of undefined", that order is why.
      '--setup-files',
      relative(path.join(hookDir, 'witness-vitest.mjs')),
      // The project's own runner config, passed through untouched. It used to
      // be wrapped, to pin the istanbul provider and the reports directory;
      // with Witness there is nothing left to pin.
      ...(runnerConfig ? ['--runner-config', runnerConfig] : []),
      ...splitArgs(extraArgs),
    ];
    const witnessEnv = { ...env, [WITNESS_ENV.coverageDir]: coverageDir };
    ctx.log(`$ node ${args.join(' ')}`);
    this.notePath(ctx, 'ng-vitest');
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env: witnessEnv, log: ctx.log, signal: ctx.signal });
    const tests = parseVitestSummary(run.output, run.exitCode);
    const guidance = this.explainPath(ctx, 'ng-vitest', run.output, run.exitCode === 0);
    try {
      return this.collect(ctx, 'ng-vitest', coverageDir, attrDir, tests, run.exitCode, universe, rename);
    } catch (err) {
      throw this.failed(ctx, err, guidance);
    }
  }

  /**
   * Angular with Karma, through the builder, measured by Witness. The same
   * shadow tree as the Vitest flavour, and the records that come out of the
   * two are identical, which is the point: one instrumenter, one runtime, one
   * reader, and the runner underneath stops mattering.
   *
   * The hook cannot go in through `--setup-files` here. The builder ignores
   * that option for Karma and says so in a warning. What it does support is
   * `--runner-config`, a Karma config, so the config generated below wraps
   * the project's own when there is one (and reproduces the builder's
   * defaults when there is not, because the builder applies those only when
   * no config file is given) and adds the Witness framework and reporter.
   * The framework serves the runtime ahead of the bundle, so the global
   * exists before any instrumented module's prologue runs; the reporter
   * writes what the browser sends to the same attribution files every other
   * hook writes. A bare "Chrome" becomes "ChromeHeadless" so no window opens.
   */
  private async runAngularKarma(ctx: RunContext): Promise<CoverageRun> {
    const cli = angularCliBin(ctx.workspaceRoot);
    if (!cli) {
      throw new Error('@angular/cli is not installed. Run npm install.');
    }
    const { workDir, attrDir, coverageDir, hookDir, env } = this.prepareWorkDir(ctx);
    const { extraArgs } = tsFields(ctx.settings);
    const relative = (p: string): string => posixPath(path.relative(ctx.workspaceRoot, p));
    const { universe, include, tsConfig, rename } = await this.prepareAngularShadow(ctx, workDir);
    const userConfig = detectAngularKarmaConfig(ctx.workspaceRoot);
    const configPath = path.join(workDir, 'karma.conf.cjs');
    fs.writeFileSync(configPath, angularKarmaConfig({ tool: 'DeepTest', workspaceRoot: ctx.workspaceRoot, hookDir, userConfig }), 'utf8');
    const args = [
      cli,
      'test',
      '--watch=false',
      '--include',
      include,
      ...(tsConfig ? ['--ts-config', relative(tsConfig)] : []),
      '--runner-config',
      relative(configPath),
      ...splitArgs(extraArgs),
    ];
    const witnessEnv = { ...env, [WITNESS_ENV.coverageDir]: coverageDir };
    ctx.log(`$ node ${args.join(' ')}`);
    this.notePath(ctx, 'ng-karma');
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env: witnessEnv, log: ctx.log, signal: ctx.signal });
    const tests = parseKarmaSummary(run.output, run.exitCode);
    const guidance = this.explainPath(ctx, 'ng-karma', run.output, run.exitCode === 0);
    try {
      return this.collect(ctx, 'ng-karma', coverageDir, attrDir, tests, run.exitCode, universe, rename);
    } catch (err) {
      throw this.failed(ctx, err, guidance);
    }
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

/** What one shadow tree came out as, for the log line and for the caller's include pattern. */
export interface ShadowTree {
  /** The folder the mirror was written into, absolute. */
  root: string;
  /** How many files were instrumented into it. */
  instrumented: number;
  /** How many were copied through untouched. */
  copied: number;
  /** The executable-line universe of the instrumented files, every line untested. */
  universe: FileCoverage[];
}

/**
 * The shadow source tree: the project's source root mirrored file for file,
 * with every source file instrumented and everything else copied as it is.
 *
 * This exists because Angular's unit-test builder bundles the application
 * before either runner sees it. There is no plugin hook in front of that —
 * no schema in the builder exposes one — so the only place left to
 * instrument is before the builder reads the files at all. Instrumenting the
 * input rather than the output is also what keeps the coordinates: Witness
 * rewrites source textually on the source's own lines, and the maps are
 * labelled with the ORIGINAL path, so a record names the file in the
 * person's editor and the line they can put a cursor on. Reading them back
 * out of a bundle would need a source map the builder does not emit for
 * tests, which is the failure the Angular path spent 1.0.12 to 1.0.15 in.
 *
 * Everything that is not a source file is copied rather than skipped, and
 * that is the half that is easy to get wrong. A component names its template
 * and stylesheet by relative path, a stylesheet names an image by relative
 * path, and each of those is resolved from the file that names it. Mirror
 * only the TypeScript and every one of those references dangles; Angular
 * then fails the build rather than measuring nothing, which is at least
 * loud, but it fails.
 *
 * Test files are copied, not instrumented: a spec's own lines are not the
 * subject, and instrumenting one would attribute the test's body to itself.
 */
export async function writeShadowTree(
  workspaceRoot: string,
  sourceRoot: string,
  instrumentedDir: string,
  measurable: string[],
  wasmDir: string,
  log: (line: string) => void,
): Promise<ShadowTree> {
  // Witness mirrors the tree; DeepTest supplies the rewrite and keeps what
  // the rewrite produced. That is the whole split: putting instrumented code
  // in front of a runner is Witness's job, and the executable-line universe
  // is DeepTest's, because only DeepTest needs one. UntangleIt calls the same
  // mirror with a rewrite that touches exactly one function in one file.
  const instrumenter = await createInstrumenter(wasmDir);
  const maps = new Map<string, WitnessMaps>();
  const mirror = mirrorSourceRoot({
    workspaceRoot,
    sourceRoot,
    instrumentedDir,
    files: measurable,
    rewrite: (absolute, source) => {
      // One parse gives both halves, so the mirror and the executable lines
      // cannot disagree. The maps are embedded, so each instrumented module
      // registers itself with whatever runtime it lands beside.
      const out = instrumenter.instrument(absolute, source, true);
      maps.set(absolute, out.maps);
      return out.code;
    },
  });
  const refused = new Map(mirror.refused.map((r) => [r.path, r.reason]));
  const universe: FileCoverage[] = measurable.map((rel) => {
    const reason = refused.get(rel);
    if (reason !== undefined) {
      // Dropping the file here made it vanish from the report, which reads as
      // "nothing wrong here". It is reported as unmeasured with the reason.
      log(`Could not read the executable lines of ${rel}: ${reason}`);
      return { path: rel, lines: new Map(), executed: new Set(), unmeasured: `Its executable lines could not be read: ${reason}` };
    }
    const lines = new Map<number, Set<string>>();
    for (const stmt of Object.values(maps.get(posixPath(path.resolve(workspaceRoot, rel)))?.statementMap ?? {})) {
      lines.set(stmt.start.line, new Set());
    }
    return { path: rel, lines, executed: new Set() };
  });
  log(`Shadow source tree at ${instrumentedDir}: ${mirror.rewritten.length} instrumented, ${mirror.copied + mirror.refused.length} copied through.`);
  return { root: instrumentedDir, instrumented: mirror.rewritten.length, copied: mirror.copied + mirror.refused.length, universe };
}

/**
 * The executable universe of files the run never loaded, from the Witness
 * instrumenter in this process: the same rules as the counters, so a loaded
 * file and an unloaded one are measured alike. Every line is untested.
 */
export async function witnessUniverse(
  workspaceRoot: string,
  relativePaths: string[],
  wasmDir: string,
  log: (line: string) => void,
  write?: { sourceRoot: string; instrumentedDir: string },
): Promise<FileCoverage[]> {
  if (relativePaths.length === 0) {
    return [];
  }
  const instrumenter = await createInstrumenter(wasmDir);
  const out: FileCoverage[] = [];
  for (const rel of relativePaths) {
    const abs = path.join(workspaceRoot, rel);
    try {
      // With `write`, the same parse produces both halves: the executable-line
      // universe, and the instrumented text a synchronous transformer can hand
      // to the project's own (Jest, where the instrumenter cannot run inside
      // the transform). The maps are embedded, so each instrumented module
      // registers itself with whatever runtime it lands beside; Jest gives
      // every test file its own global, and a registration performed in one
      // sandbox is not visible in the next.
      const maps = write
        ? (() => {
            const instrumented = instrumenter.instrument(abs.split(path.sep).join('/'), fs.readFileSync(abs, 'utf8'), true);
            const target = path.join(write.instrumentedDir, path.relative(write.sourceRoot, abs));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, instrumented.code, 'utf8');
            return instrumented.maps;
          })()
        : instrumenter.mapsOnly(abs.split(path.sep).join('/'), fs.readFileSync(abs, 'utf8'));
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




/** Component test files under the tests folder (or the whole workspace), relative to the workspace. */
export function playwrightComponentTests(workspaceRoot: string, settings: LanguageSettings): string[] {
  const root = path.join(workspaceRoot, settings.testsPath || '');
  return walkSources(root)
    .map((rel) => (settings.testsPath ? `${settings.testsPath}/${rel}` : rel))
    .filter((rel) => isTestFile(rel) || /\.ct\.[cm]?[jt]sx?$/.test(rel));
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
