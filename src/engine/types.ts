/**
 * Shared data model. Everything is keyed by workspace-relative file path with
 * forward slashes, and by 1-based line number, because that is what every
 * coverage tool and every parser agree on.
 */

/** Which distinct tests executed each executable line of one file. */
export interface FileCoverage {
  /** Workspace-relative path, forward slashes. */
  path: string;
  /**
   * Every executable line the coverage tool knows about. A line that ran
   * under no test maps to an empty set; a line absent from the map is not
   * executable (blank, comment, docstring, or dropped by the tool).
   */
  lines: Map<number, Set<string>>;
  /**
   * Lines that executed at all, under a test or not. Import-time code (a
   * module constant, a def line, a decorator) runs under no test context, so
   * it shows up here and nowhere else.
   */
  executed: Set<number>;
}

/** What kind of decision a route step is. Shared vocabulary across languages. */
export type DecisionKind =
  | 'if'
  | 'elif'
  | 'else'
  | 'loop'
  | 'except'
  | 'case'
  | 'guard'
  | 'and'
  | 'or'
  | 'ternary'
  | 'comprehension'
  | 'with';

/**
 * One decision on the way to a line. `condition` is the source text, kept
 * verbatim so the report can show it beside any plain-language gloss and a
 * bad gloss cannot hide the truth. `outcome` is what has to happen at this
 * decision for control to continue toward the line, in plain words.
 */
export interface RouteStep {
  line: number;
  kind: DecisionKind;
  condition: string;
  outcome: string;
}

/** Which language rules count as a decision. Every plugin honours the same flags. */
export interface DepthOptions {
  countShortCircuit: boolean;
  countTernary: boolean;
  countComprehensions: boolean;
  countExcept: boolean;
}

export const DEFAULT_DEPTH_OPTIONS: DepthOptions = {
  countShortCircuit: true,
  countTernary: true,
  countComprehensions: true,
  countExcept: true,
};

export interface FunctionComplexity {
  name: string;
  startLine: number;
  endLine: number;
  /** McCabe cyclomatic complexity: 1 + decisions inside the function. */
  complexity: number;
}

/** Static facts about one file: depth per line, complexity per function. */
export interface FileStructure {
  path: string;
  /**
   * Decisions that must be satisfied to reach each line, plus decisions on
   * the line itself. Missing lines have depth 0.
   */
  depth: Map<number, number>;
  /**
   * The decisions on the path to each line, outermost first. Its length is
   * the line's depth; the two are produced together and must agree.
   */
  routes: Map<number, RouteStep[]>;
  functions: FunctionComplexity[];
  /** Lines that can never execute (code after return, raise, break, continue). */
  unreachable: Set<number>;
  /**
   * Lines outside every function body: module-level statements, def and
   * class headers, decorators. They execute at import time, not under a
   * test, so density does not apply to them. They still count for coverage.
   */
  declarations: Set<number>;
}

export type LineStatus = 'over' | 'met' | 'short' | 'untested' | 'unreachable' | 'declaration';

export interface LineResult {
  line: number;
  /** Distinct tests that executed this line, sorted. */
  tests: string[];
  /** tests.length */
  density: number;
  /** Decisions guarding this line, as reported by the structure source. */
  depth: number;
  /** max(depth, 1): every executable line needs at least one test. */
  bar: number;
  /** bar - density, never negative. Zero when met or over. */
  gap: number;
  status: LineStatus;
  /** True when the line ran at least once, under a test or at import time. */
  executed: boolean;
  /** The route to this line with, per step, how many tests got past it. */
  route: RouteProgress;
}

export interface RouteProgressStep extends RouteStep {
  /** Distinct tests that reached this decision's line. */
  testsAtDecision: number;
  /** Distinct tests that went on past this decision toward the target line. */
  testsPast: number;
}

export interface RouteProgress {
  steps: RouteProgressStep[];
  /** Number of leading steps that at least one test got past. */
  reached: number;
  /** steps.length */
  total: number;
}

export interface FileResult {
  path: string;
  lines: LineResult[];
  functions: FunctionComplexity[];
  /** Executable lines, declarations included, unreachable excluded. */
  executableLines: number;
  /** Executable lines that ran at least once. */
  coveredLines: number;
  /** Executable lines that density applies to: executable minus declarations. */
  scoredLines: number;
  /** Scored lines with status over or met. */
  passingLines: number;
  /** Sum of gap across short and untested lines. */
  totalGap: number;
  unreachableLines: number[];
}

export interface Shortfall {
  path: string;
  line: number;
  density: number;
  bar: number;
  gap: number;
  status: 'short' | 'untested';
}

export interface Thresholds {
  maxFunctionComplexity: number;
  minCoverage: number;
  minAverageDensity: number;
  minDensityPassRate: number;
}

export interface Summary {
  files: number;
  executableLines: number;
  coveredLines: number;
  /** covered / executable, in percent. 100 when there are no executable lines. */
  coveragePercent: number;
  /** Executable lines density applies to (function bodies). */
  scoredLines: number;
  /** Mean of density / bar over all scored lines. */
  averageDensity: number;
  /** Lines with status over or met, in percent of scored lines. */
  densityPassRate: number;
  functions: number;
  totalComplexity: number;
  averageComplexity: number;
  maxComplexity: number;
  /** Functions whose complexity exceeds the threshold, worst first. */
  complexFunctions: Array<FunctionComplexity & { path: string }>;
  unreachableLines: number;
  declarationLines: number;
  untestedLines: number;
  shortLines: number;
  thresholds: Thresholds;
  coverageOk: boolean;
  averageDensityOk: boolean;
  densityPassRateOk: boolean;
  complexityOk: boolean;
}

export interface AnalysisResult {
  files: FileResult[];
  /** Worst first: largest gap, then untested before short, then by path and line. */
  shortfalls: Shortfall[];
  summary: Summary;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  maxFunctionComplexity: 10,
  minCoverage: 80,
  minAverageDensity: 1,
  minDensityPassRate: 90,
};
