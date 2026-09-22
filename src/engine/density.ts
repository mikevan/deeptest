/**
 * DensityEngine: joins per-test coverage with per-line depth and produces a
 * ranked list of shortfalls plus summary statistics.
 *
 * Pure. No editor, no file system, no language. That is deliberate: this is
 * the one piece that must be right, and it is tested to its own bar in
 * test/density.test.ts.
 *
 * The metric:
 *   density(line) = number of DISTINCT tests that executed the line
 *   depth(line)   = decisions that must be satisfied to reach the line,
 *                   plus decisions on the line itself
 *   bar(line)     = max(depth, 1)
 *   over     when density >  bar
 *   met      when density == bar
 *   short    when 0 < density < bar
 *   untested when density == 0
 *
 * The bar floors at 1 because a straight-line statement in a function still
 * has to run under at least one test before anyone can claim it works.
 *
 * Declaration lines (module-level code, def and class headers, decorators)
 * execute at import time under no test. They count for coverage, and they
 * are excluded from density, because "which test exercised this def line"
 * is not a question anyone needs answered.
 *
 * Ranking ("worst first") is the gap, complexity minus tests, largest first.
 * Ties break by the bar (18 short by 5 is a bigger hole than 6 short by 5),
 * then untested before short, then file and line so the order is stable.
 * That is the metric applied as the ranking, with nothing bolted on, and it
 * is the one definition every list in the tool uses.
 *
 * Unreachable lines come from the structure source, never from coverage.
 * coverage.py silently drops code after a return from its statement list, so
 * a coverage-only view would never show it. They are reported in their own
 * list and excluded from every percentage, because the fix is to delete the
 * dead code, not to write a test that cannot reach it.
 */

import {
  AnalysisResult,
  DEFAULT_THRESHOLDS,
  FileCoverage,
  FileResult,
  FileStructure,
  FunctionComplexity,
  LineResult,
  LineStatus,
  RouteProgress,
  RouteStep,
  Shortfall,
  Summary,
  Thresholds,
} from './types';

export function classify(density: number, bar: number): LineStatus {
  if (density === 0) {
    return 'untested';
  }
  if (density < bar) {
    return 'short';
  }
  if (density === bar) {
    return 'met';
  }
  return 'over';
}

const NO_ROUTE: RouteProgress = { steps: [], reached: 0, total: 0 };

/**
 * Walks the route to a line and records, per decision, how many tests got
 * there and how many got past it. "Past" means: reached the next decision's
 * line, or the target line itself after the last decision. `reached` is the
 * count of leading decisions that at least one test cleared, which is the
 * number a non-programmer can act on: "your tests get past 3 of 18".
 */
export function routeProgress(steps: RouteStep[], targetLine: number, lines: Map<number, Set<string>>): RouteProgress {
  if (steps.length === 0) {
    return NO_ROUTE;
  }
  const count = (line: number): number => lines.get(line)?.size ?? 0;
  // "Past" a decision means reaching the next executable line on the route.
  // A `case` label or an `else` line carries no statement counter, so skip
  // forward to the first route line the coverage tool knows about.
  const nextExecutable = (i: number): number => {
    for (let j = i + 1; j < steps.length; j += 1) {
      if (lines.has(steps[j].line)) {
        return steps[j].line;
      }
    }
    return targetLine;
  };
  const out = steps.map((step, i) => ({ ...step, testsAtDecision: count(step.line), testsPast: count(nextExecutable(i)) }));
  let reached = 0;
  while (reached < out.length && out[reached].testsPast > 0) {
    reached += 1;
  }
  return { steps: out, reached, total: out.length };
}

export function scoreLine(line: number, tests: Iterable<string>, depth: number, executed = true, route: RouteProgress = NO_ROUTE): LineResult {
  const sorted = Array.from(new Set(tests)).sort();
  const density = sorted.length;
  const bar = Math.max(depth, 1);
  const status = classify(density, bar);
  const gap = status === 'over' || status === 'met' ? 0 : bar - density;
  return { line, tests: sorted, density, depth, bar, gap, status, executed: executed || density > 0, route };
}

export function declarationLine(line: number, tests: Iterable<string>, executed: boolean): LineResult {
  const sorted = Array.from(new Set(tests)).sort();
  return { line, tests: sorted, density: sorted.length, depth: 0, bar: 0, gap: 0, status: 'declaration', executed: executed || sorted.length > 0, route: NO_ROUTE };
}

export function analyzeFile(coverage: FileCoverage, structure: FileStructure | undefined): FileResult {
  if (coverage.unmeasured !== undefined) {
    // Nothing about this file is known. It gets no lines, no functions, and
    // no place in any total: a file with zero executable lines would read as
    // fully covered, and a file with every line untested would read as
    // measured. Both are wrong. It is listed by name with the reason instead.
    return { path: coverage.path, unmeasured: coverage.unmeasured, skipped: [], lines: [], functions: [], executableLines: 0, coveredLines: 0, scoredLines: 0, passingLines: 0, totalGap: 0, unreachableLines: [] };
  }
  const depth = structure?.depth ?? new Map<number, number>();
  const routes = structure?.routes ?? new Map<number, RouteStep[]>();
  const unreachable = structure?.unreachable ?? new Set<number>();
  const declarations = structure?.declarations ?? new Set<number>();
  const functions = structure?.functions ?? [];

  const lines: LineResult[] = [];
  let coveredLines = 0;
  let scoredLines = 0;
  let passingLines = 0;
  let totalGap = 0;

  const executable = Array.from(coverage.lines.keys()).sort((a, b) => a - b);
  for (const lineNo of executable) {
    if (unreachable.has(lineNo)) {
      continue;
    }
    const tests = coverage.lines.get(lineNo) ?? [];
    const executed = coverage.executed.has(lineNo);
    if (declarations.has(lineNo)) {
      const result = declarationLine(lineNo, tests, executed);
      lines.push(result);
      if (result.executed) {
        coveredLines += 1;
      }
      continue;
    }
    const result = scoreLine(lineNo, tests, depth.get(lineNo) ?? 0, executed, routeProgress(routes.get(lineNo) ?? [], lineNo, coverage.lines));
    lines.push(result);
    scoredLines += 1;
    if (result.executed) {
      coveredLines += 1;
    }
    if (result.status === 'over' || result.status === 'met') {
      passingLines += 1;
    }
    totalGap += result.gap;
  }

  const unreachableLines = Array.from(unreachable).sort((a, b) => a - b);
  for (const lineNo of unreachableLines) {
    lines.push({ line: lineNo, tests: [], density: 0, depth: depth.get(lineNo) ?? 0, bar: 0, gap: 0, status: 'unreachable', executed: false, route: NO_ROUTE });
  }
  lines.sort((a, b) => a.line - b.line);

  return {
    path: coverage.path,
    skipped: [...(coverage.skipped ?? [])].sort((a, b) => a.line - b.line),
    lines,
    functions: [...functions].sort((a, b) => a.startLine - b.startLine),
    executableLines: lines.length - unreachableLines.length,
    coveredLines,
    scoredLines,
    passingLines,
    totalGap,
    unreachableLines,
  };
}

export function rankShortfalls(files: FileResult[]): Shortfall[] {
  const out: Shortfall[] = [];
  for (const file of files) {
    for (const line of file.lines) {
      if (line.status === 'short' || line.status === 'untested') {
        out.push({ path: file.path, line: line.line, density: line.density, bar: line.bar, gap: line.gap, status: line.status });
      }
    }
  }
  out.sort((a, b) => {
    if (b.gap !== a.gap) {
      return b.gap - a.gap;
    }
    if (b.bar !== a.bar) {
      return b.bar - a.bar;
    }
    if (a.status !== b.status) {
      return a.status === 'untested' ? -1 : 1;
    }
    if (a.path !== b.path) {
      return a.path < b.path ? -1 : 1;
    }
    return a.line - b.line;
  });
  return out;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function summarize(files: FileResult[], thresholds: Thresholds = DEFAULT_THRESHOLDS): Summary {
  let executableLines = 0;
  let coveredLines = 0;
  let scoredLines = 0;
  let passingLines = 0;
  let unreachableLines = 0;
  let declarationLines = 0;
  let untestedLines = 0;
  let shortLines = 0;
  let ratioSum = 0;
  let skippedDecisions = 0;
  const unmeasuredFiles: Array<{ path: string; reason: string }> = [];
  const functions: Array<FunctionComplexity & { path: string }> = [];

  for (const file of files) {
    if (file.unmeasured !== undefined) {
      unmeasuredFiles.push({ path: file.path, reason: file.unmeasured });
      continue;
    }
    skippedDecisions += file.skipped.length;
    executableLines += file.executableLines;
    coveredLines += file.coveredLines;
    scoredLines += file.scoredLines;
    passingLines += file.passingLines;
    unreachableLines += file.unreachableLines.length;
    for (const line of file.lines) {
      if (line.status === 'unreachable') {
        continue;
      }
      if (line.status === 'declaration') {
        declarationLines += 1;
        continue;
      }
      ratioSum += line.density / line.bar;
      if (line.status === 'untested') {
        untestedLines += 1;
      } else if (line.status === 'short') {
        shortLines += 1;
      }
    }
    for (const fn of file.functions) {
      functions.push({ ...fn, path: file.path });
    }
  }

  const totalComplexity = functions.reduce((sum, fn) => sum + fn.complexity, 0);
  const maxComplexity = functions.reduce((max, fn) => Math.max(max, fn.complexity), 0);
  const maxCampbell = functions.reduce((max, fn) => Math.max(max, fn.campbell), 0);
  const maxMbcc = functions.reduce((max, fn) => Math.max(max, fn.mbcc), 0);
  const measuredFunctions = [...functions].sort(
    (a, b) => b.complexity - a.complexity || b.mbcc - a.mbcc || a.path.localeCompare(b.path) || a.startLine - b.startLine,
  );
  const complexFunctions = functions
    .filter((fn) => fn.complexity > thresholds.maxFunctionComplexity)
    .sort((a, b) => b.complexity - a.complexity || a.path.localeCompare(b.path) || a.startLine - b.startLine);

  const coveragePercent = executableLines === 0 ? 100 : round((coveredLines / executableLines) * 100);
  const averageDensity = scoredLines === 0 ? 0 : round(ratioSum / scoredLines);
  const densityPassRate = scoredLines === 0 ? 100 : round((passingLines / scoredLines) * 100);

  return {
    files: files.length - unmeasuredFiles.length,
    executableLines,
    coveredLines,
    coveragePercent,
    scoredLines,
    averageDensity,
    densityPassRate,
    functions: functions.length,
    totalComplexity,
    averageComplexity: functions.length === 0 ? 0 : round(totalComplexity / functions.length),
    maxComplexity,
    maxCampbell,
    maxMbcc,
    measuredFunctions,
    complexFunctions,
    unreachableLines,
    declarationLines,
    untestedLines,
    shortLines,
    unmeasuredFiles,
    skippedDecisions,
    thresholds,
    coverageOk: coveragePercent >= thresholds.minCoverage,
    averageDensityOk: averageDensity >= thresholds.minAverageDensity,
    densityPassRateOk: densityPassRate >= thresholds.minDensityPassRate,
    complexityOk: complexFunctions.length === 0,
  };
}

/**
 * Entry point. `structures` may be missing files that `coverages` has (the
 * parser could not read them); those files are scored with depth 0, so
 * every line's bar is 1 and the result still says something true.
 */
export function analyze(
  coverages: FileCoverage[],
  structures: FileStructure[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): AnalysisResult {
  const structureByPath = new Map(structures.map((s) => [s.path, s]));
  const files = coverages
    .map((coverage) => analyzeFile(coverage, structureByPath.get(coverage.path)))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    shortfalls: rankShortfalls(files),
    summary: summarize(files, thresholds),
  };
}
