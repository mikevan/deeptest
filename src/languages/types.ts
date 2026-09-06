/**
 * THE CONTRACT.
 *
 * Every language plugs in here, and nothing above this file knows which
 * language it is talking to. The runner, the engine, the overlay, the
 * sidebar, the report, and the configuration screen consume only these
 * types. Adding a language is a new folder under src/languages/, one line
 * in the registry, and zero edits anywhere else. If adding a language needs
 * an edit above this contract, that is a bug in the contract.
 *
 * A plugin supplies four things:
 *   detect     - look at the workspace and pre-fill every setting it can,
 *                so the first run asks the user nothing
 *   coverage   - run the tests and say which tests executed each line
 *   structure  - parse a source file and say what guards each line
 *   configFields - the small language-specific block on the config screen,
 *                rendered by the shared screen from this description
 */
import { DepthOptions, FileCoverage, FileStructure } from '../engine/types';

/** One language-specific field on the configuration screen. */
export interface FieldSpec {
  /** Key inside deeptest.languageSettings.<languageId>. */
  key: string;
  label: string;
  kind: 'text' | 'number' | 'checkbox' | 'select';
  placeholder?: string;
  /** One sentence under the field. Plain words. */
  hint?: string;
  options?: Array<{ value: string; label: string }>;
}

/** Everything a plugin worked out about a workspace without asking. */
export interface Detection {
  /** Tests folder relative to the workspace, or empty when unknown. */
  testsPath: string;
  /** Code under test relative to the workspace, or empty for the whole workspace. */
  sourceRoot: string;
  /** Test files found, workspace-relative, for the "found N tests" line. */
  testFiles: string[];
  /** Pre-filled values for this plugin's configFields. */
  fields: Record<string, unknown>;
  /** Plain-language notes shown on the config screen, e.g. "Found pytest in pyproject.toml". */
  notes: string[];
}

/** What the host can do for a plugin during detection. Keeps vscode out of plugins. */
export interface HostServices {
  /** Language id of the active editor, if any. */
  activeLanguageId?: string;
  /**
   * Exports of another installed editor extension, or undefined. Lets a
   * plugin ask e.g. the Python extension which interpreter is selected
   * without the host knowing that such a thing exists.
   */
  extensionApi(extensionId: string): Promise<unknown>;
}

/** The user's answers for one language: the common fields plus the plugin's own. */
export interface LanguageSettings {
  testsPath: string;
  sourceRoot: string;
  fields: Record<string, unknown>;
}

export interface RunContext {
  workspaceRoot: string;
  settings: LanguageSettings;
  log: (line: string) => void;
  signal?: AbortSignal;
}

export interface TestRunSummary {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  exitCode: number | null;
}

export interface CoverageRun {
  coverages: FileCoverage[];
  tests: TestRunSummary;
  /** Source files measured, workspace-relative, forward slashes. */
  measuredFiles: string[];
}

export interface EnvironmentCheck {
  ok: boolean;
  /** e.g. "Python 3.12.1, coverage 7.6.1, pytest 8.3.2" */
  summary: string;
  problems: string[];
  /** A command that would fix the problems, offered to the user as a button. */
  fix?: { title: string; command: string; args: string[] };
}

/** Runs the tests and attributes every executed line to the tests that ran it. */
export interface CoverageSource {
  discoverTests(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): Promise<string[]>;
  checkEnvironment(ctx: Pick<RunContext, 'workspaceRoot' | 'settings' | 'log'>): Promise<EnvironmentCheck>;
  run(ctx: RunContext): Promise<CoverageRun>;
}

/** Parses one source file into depth, complexity, routes, unreachable, and declarations. */
export interface StructureSource {
  analyze(relativePath: string, text: string, options: DepthOptions): FileStructure;
  dispose(): void;
}

export interface StructureEnvironment {
  /** Absolute folder holding the tree-sitter runtime and grammar wasm files. */
  wasmDir: string;
}

export interface LanguagePlugin {
  /** Stable id used in settings: 'python', 'typescript'. */
  readonly id: string;
  readonly displayName: string;
  /** VS Code language ids this plugin measures (typescript, typescriptreact...). */
  readonly vscodeLanguageIds: string[];
  /** File extensions, with the dot, for workspace detection. */
  readonly extensions: string[];
  readonly configFields: FieldSpec[];

  isTestFile(fileName: string): boolean;
  detect(workspaceRoot: string, host: HostServices): Promise<Detection>;
  createCoverageSource(): CoverageSource;
  createStructureSource(env: StructureEnvironment): Promise<StructureSource>;
}
