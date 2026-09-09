import { test } from 'vitest';
import assert from 'node:assert/strict';
import { analyze, analyzeFile, classify, rankShortfalls, routeProgress, scoreLine, summarize } from '../src/engine/density';
import { FileCoverage, FileStructure, RouteStep } from '../src/engine/types';

function cov(path: string, lines: Record<number, string[]>, executedAtImport: number[] = []): FileCoverage {
  const map = new Map<number, Set<string>>();
  const executed = new Set<number>(executedAtImport);
  for (const [line, tests] of Object.entries(lines)) {
    map.set(Number(line), new Set(tests));
    if (tests.length > 0) {
      executed.add(Number(line));
    }
  }
  return { path, lines: map, executed };
}

function struct(
  path: string,
  depth: Record<number, number>,
  unreachable: number[] = [],
  functions: FileStructure['functions'] = [],
  declarations: number[] = [],
  routes: Record<number, RouteStep[]> = {},
): FileStructure {
  return {
    path,
    depth: new Map(Object.entries(depth).map(([k, v]) => [Number(k), v])),
    routes: new Map(Object.entries(routes).map(([k, v]) => [Number(k), v])),
    unreachable: new Set(unreachable),
    functions,
    declarations: new Set(declarations),
  };
}

const step = (line: number, condition: string, outcome = 'is true'): RouteStep => ({ line, kind: 'if', condition, outcome });

test('classify: untested when zero tests, whatever the bar', () => {
  assert.equal(classify(0, 1), 'untested');
  assert.equal(classify(0, 5), 'untested');
});

test('classify: short when below the bar', () => {
  assert.equal(classify(1, 2), 'short');
  assert.equal(classify(4, 5), 'short');
});

test('classify: met when equal to the bar', () => {
  assert.equal(classify(1, 1), 'met');
  assert.equal(classify(3, 3), 'met');
});

test('classify: over when above the bar', () => {
  assert.equal(classify(2, 1), 'over');
});

test('scoreLine: bar floors at 1 so a depth-0 line still needs a test', () => {
  const r = scoreLine(7, [], 0);
  assert.equal(r.bar, 1);
  assert.equal(r.status, 'untested');
  assert.equal(r.gap, 1);
});

test('scoreLine: distinct tests are deduplicated and sorted', () => {
  const r = scoreLine(3, ['b', 'a', 'b'], 2);
  assert.deepEqual(r.tests, ['a', 'b']);
  assert.equal(r.density, 2);
  assert.equal(r.status, 'met');
  assert.equal(r.gap, 0);
});

test('scoreLine: gap is bar minus density when short, zero when over', () => {
  assert.equal(scoreLine(1, ['a'], 4).gap, 3);
  assert.equal(scoreLine(1, ['a', 'b', 'c'], 1).gap, 0);
  assert.equal(scoreLine(1, ['a', 'b', 'c'], 1).status, 'over');
});

test('analyzeFile: scores every executable line and counts covered and passing', () => {
  const c = cov('a.py', { 1: ['t1'], 2: ['t1', 't2'], 3: [], 4: ['t1'] });
  const s = struct('a.py', { 2: 2, 3: 3, 4: 2 });
  const f = analyzeFile(c, s);
  assert.equal(f.executableLines, 4);
  assert.equal(f.coveredLines, 3);
  assert.equal(f.passingLines, 2);
  assert.equal(f.totalGap, 3 + 1);
  assert.deepEqual(f.lines.map((l) => l.status), ['met', 'met', 'untested', 'short']);
});

test('analyzeFile: missing structure means depth 0 everywhere', () => {
  const c = cov('a.py', { 5: ['t'], 6: [] });
  const f = analyzeFile(c, undefined);
  assert.deepEqual(f.lines.map((l) => [l.depth, l.bar, l.status]), [[0, 1, 'met'], [0, 1, 'untested']]);
  assert.deepEqual(f.functions, []);
  assert.deepEqual(f.unreachableLines, []);
});

test('analyzeFile: unreachable lines are listed separately and excluded from executable count', () => {
  const c = cov('a.py', { 1: ['t'], 2: [] });
  const s = struct('a.py', { 2: 1, 9: 1 }, [2, 9]);
  const f = analyzeFile(c, s);
  assert.equal(f.executableLines, 1);
  assert.deepEqual(f.unreachableLines, [2, 9]);
  assert.deepEqual(f.lines.map((l) => [l.line, l.status]), [[1, 'met'], [2, 'unreachable'], [9, 'unreachable']]);
  assert.equal(f.totalGap, 0);
});

test('analyzeFile: declarations count for coverage but never for density', () => {
  // line 1 is a def that ran at import, line 2 a def that never ran (module never imported),
  // line 3 a body line under a test
  const c = cov('a.py', { 1: [], 2: [], 3: ['t'] }, [1]);
  const s = struct('a.py', { 3: 1 }, [], [], [1, 2]);
  const f = analyzeFile(c, s);
  assert.deepEqual(f.lines.map((l) => [l.status, l.executed]), [['declaration', true], ['declaration', false], ['met', true]]);
  assert.equal(f.executableLines, 3);
  assert.equal(f.coveredLines, 2);
  assert.equal(f.scoredLines, 1);
  assert.equal(f.passingLines, 1);
  assert.equal(f.totalGap, 0);
  assert.deepEqual(rankShortfalls([f]), []);
  const sum = summarize([f]);
  assert.equal(sum.declarationLines, 2);
  assert.equal(sum.scoredLines, 1);
  assert.equal(sum.coveragePercent, 66.67);
  assert.equal(sum.densityPassRate, 100);
  assert.equal(sum.averageDensity, 1);
});

test('analyzeFile: a scored line that ran only at import time is covered but untested', () => {
  const c = cov('a.py', { 4: [] }, [4]);
  const f = analyzeFile(c, struct('a.py', { 4: 1 }));
  assert.equal(f.lines[0].status, 'untested');
  assert.equal(f.lines[0].executed, true);
  assert.equal(f.coveredLines, 1);
});

test('analyzeFile: functions are returned sorted by start line', () => {
  const c = cov('a.py', {});
  const s = struct('a.py', {}, [], [
    { name: 'b', startLine: 10, endLine: 12, complexity: 1, campbell: 0, mbcc: 0 },
    { name: 'a', startLine: 1, endLine: 5, complexity: 3, campbell: 0, mbcc: 0 },
  ]);
  assert.deepEqual(analyzeFile(c, s).functions.map((fn) => fn.name), ['a', 'b']);
});

test('rankShortfalls: largest gap first, deeper bar next, untested before short, then path, then line', () => {
  const files = [
    analyzeFile(cov('b.py', { 1: ['t'], 2: [], 5: ['t'] }), struct('b.py', { 1: 3, 2: 2, 5: 9 })),
    analyzeFile(cov('a.py', { 1: [], 2: ['t'], 3: [], 4: ['t', 'u'] }), struct('a.py', { 1: 2, 2: 3, 3: 2, 4: 2 })),
  ];
  const ranked = rankShortfalls(files).map((s) => `${s.path}:${s.line}:${s.status}:${s.gap}`);
  assert.deepEqual(ranked, [
    'b.py:5:short:8',
    // gap 2 with bar 3 outranks gap 2 with bar 2: the deeper hole first
    'a.py:2:short:2',
    'b.py:1:short:2',
    'a.py:1:untested:2',
    'a.py:3:untested:2',
    'b.py:2:untested:2',
  ]);
});

test('routeProgress: counts tests at and past each decision, and where they stop', () => {
  const lines = new Map<number, Set<string>>([
    [2, new Set(['a', 'b', 'c'])],
    [3, new Set(['a', 'b'])],
    [4, new Set()],
    [5, new Set()],
  ]);
  const route = routeProgress([step(2, 'x > 0'), step(3, 'y > 0'), step(4, 'z')], 5, lines);
  assert.equal(route.total, 3);
  assert.equal(route.reached, 1);
  assert.deepEqual(route.steps.map((s) => [s.testsAtDecision, s.testsPast]), [[3, 2], [2, 0], [0, 0]]);
});

test('routeProgress: a fully walked route reaches every step; an empty route is empty', () => {
  const lines = new Map<number, Set<string>>([[1, new Set(['t'])], [2, new Set(['t'])], [3, new Set(['t'])]]);
  const full = routeProgress([step(1, 'a'), step(2, 'b')], 3, lines);
  assert.equal(full.reached, 2);
  const none = routeProgress([], 3, lines);
  assert.equal(none.total, 0);
  assert.equal(none.reached, 0);
});

test('routeProgress: a step on a line with no statement counter (a case label) is skipped when looking for "past"', () => {
  // switch at 2; case labels at 3 and 5 carry no counters; bodies at 4 and 6.
  const lines = new Map<number, Set<string>>([
    [2, new Set(['a', 'b'])],
    [4, new Set(['a'])],
    [6, new Set()],
  ]);
  const route = routeProgress([{ line: 3, kind: 'case', condition: 'v is 1', outcome: 'is false' }, { line: 5, kind: 'case', condition: 'v is 2', outcome: 'is true' }], 6, lines);
  // Past the first label means reaching the next executable route line, which is the target (6): nobody.
  assert.deepEqual(route.steps.map((s) => [s.testsAtDecision, s.testsPast]), [[0, 0], [0, 0]]);
  assert.equal(route.reached, 0);
  // With the second case's body reached by a test, the first label is "past".
  lines.set(6, new Set(['b']));
  const again = routeProgress([{ line: 3, kind: 'case', condition: 'v is 1', outcome: 'is false' }, { line: 5, kind: 'case', condition: 'v is 2', outcome: 'is true' }], 6, lines);
  assert.deepEqual(again.steps.map((s) => s.testsPast), [1, 1]);
  assert.equal(again.reached, 2);
});

test('routeProgress: on-line decisions use the target line itself as the next line', () => {
  const lines = new Map<number, Set<string>>([[7, new Set(['t'])]]);
  const route = routeProgress([step(7, 'a'), step(7, 'b')], 7, lines);
  assert.deepEqual(route.steps.map((s) => s.testsPast), [1, 1]);
  assert.equal(route.reached, 2);
});

test('analyzeFile: routes flow through to line results', () => {
  // if x: (2) / if y: (3) / body (4). One test enters the outer block, none the inner.
  const c = cov('a.py', { 2: ['t'], 3: ['t'], 4: [] });
  const s = struct('a.py', { 2: 1, 3: 2, 4: 2 }, [], [], [], { 2: [step(2, 'x')], 3: [step(2, 'x'), step(3, 'y')], 4: [step(2, 'x'), step(3, 'y')] });
  const f = analyzeFile(c, s);
  const body = f.lines[2];
  assert.equal(body.route.total, 2);
  assert.equal(body.route.reached, 1);
  assert.equal(body.route.steps[1].condition, 'y');
  assert.deepEqual(body.route.steps.map((st) => st.testsPast), [1, 0]);
});

test('rankShortfalls: met and over lines never appear', () => {
  const f = analyzeFile(cov('a.py', { 1: ['t'], 2: ['t', 'u'] }), struct('a.py', { 1: 1, 2: 1 }));
  assert.deepEqual(rankShortfalls([f]), []);
});

test('summarize: empty input is 100% covered, 100% passing, zero complexity', () => {
  const s = summarize([]);
  assert.equal(s.coveragePercent, 100);
  assert.equal(s.densityPassRate, 100);
  assert.equal(s.averageDensity, 0);
  assert.equal(s.totalComplexity, 0);
  assert.equal(s.averageComplexity, 0);
  assert.equal(s.maxComplexity, 0);
  assert.equal(s.coverageOk, true);
  assert.equal(s.densityPassRateOk, true);
  assert.equal(s.averageDensityOk, false);
  assert.equal(s.complexityOk, true);
});

test('summarize: percentages, average density, and status counts', () => {
  const f = analyzeFile(
    cov('a.py', { 1: ['t'], 2: ['t'], 3: [], 4: ['t', 'u', 'v'] }),
    struct('a.py', { 1: 1, 2: 2, 3: 1, 4: 1 }, [8]),
  );
  const s = summarize([f], { maxFunctionComplexity: 10, minCoverage: 75, minAverageDensity: 1, minDensityPassRate: 50 });
  assert.equal(s.executableLines, 4);
  assert.equal(s.coveredLines, 3);
  assert.equal(s.coveragePercent, 75);
  // ratios: 1/1, 1/2, 0/1, 3/1 -> (1 + 0.5 + 0 + 3) / 4
  assert.equal(s.averageDensity, 1.13);
  assert.equal(s.densityPassRate, 50);
  assert.equal(s.untestedLines, 1);
  assert.equal(s.shortLines, 1);
  assert.equal(s.unreachableLines, 1);
  assert.equal(s.coverageOk, true);
  assert.equal(s.averageDensityOk, true);
  assert.equal(s.densityPassRateOk, true);
});

test('summarize: thresholds fail when not met', () => {
  const f = analyzeFile(cov('a.py', { 1: [], 2: ['t'] }), struct('a.py', { 1: 1, 2: 4 }));
  const s = summarize([f], { maxFunctionComplexity: 10, minCoverage: 80, minAverageDensity: 1, minDensityPassRate: 90 });
  assert.equal(s.coveragePercent, 50);
  assert.equal(s.coverageOk, false);
  assert.equal(s.averageDensityOk, false);
  assert.equal(s.densityPassRateOk, false);
});

test('summarize: complexity totals and over-threshold functions sorted worst first with stable tie-breaks', () => {
  const a = analyzeFile(cov('a.py', {}), struct('a.py', {}, [], [
    { name: 'low', startLine: 1, endLine: 3, complexity: 2, campbell: 9, mbcc: 11 },
    { name: 'high2', startLine: 20, endLine: 30, complexity: 12, campbell: 1, mbcc: 4 },
    { name: 'high1', startLine: 5, endLine: 15, complexity: 12, campbell: 1, mbcc: 1 },
  ]));
  const b = analyzeFile(cov('b.py', {}), struct('b.py', {}, [], [
    { name: 'worst', startLine: 1, endLine: 50, complexity: 20, campbell: 0, mbcc: 0 },
    { name: 'also12', startLine: 60, endLine: 70, complexity: 12, campbell: 0, mbcc: 0 },
  ]));
  const s = summarize([a, b]);
  assert.equal(s.functions, 5);
  assert.equal(s.totalComplexity, 58);
  assert.equal(s.averageComplexity, 11.6);
  assert.equal(s.maxComplexity, 20);
  assert.equal(s.complexityOk, false);
  assert.deepEqual(s.complexFunctions.map((fn) => `${fn.path}:${fn.name}`), ['b.py:worst', 'a.py:high1', 'a.py:high2', 'b.py:also12']);
  // The comparison list holds every function, by ways through, then by ordered tangle, then path and line.
  // A deep but flat-forked function (low) stays at the bottom: the verdict is on ways through; the tangle is beside it.
  assert.deepEqual(s.measuredFunctions.map((fn) => fn.name), ['worst', 'high2', 'high1', 'also12', 'low']);
  assert.equal(s.maxCampbell, 9);
  assert.equal(s.maxMbcc, 11);
});

test('summarize: complexity passes when every function is within threshold', () => {
  const a = analyzeFile(cov('a.py', {}), struct('a.py', {}, [], [{ name: 'f', startLine: 1, endLine: 2, complexity: 10, campbell: 0, mbcc: 0 }]));
  assert.equal(summarize([a]).complexityOk, true);
});

test('analyze: joins by path, sorts files, tolerates a missing structure, and uses default thresholds', () => {
  const result = analyze(
    [cov('z.py', { 1: ['t'] }), cov('m.py', { 1: [], 2: ['t'] })],
    [struct('m.py', { 1: 2, 2: 1 })],
  );
  assert.deepEqual(result.files.map((f) => f.path), ['m.py', 'z.py']);
  assert.equal(result.files[1].lines[0].depth, 0);
  assert.deepEqual(result.shortfalls.map((s) => `${s.path}:${s.line}`), ['m.py:1']);
  assert.equal(result.summary.thresholds.minCoverage, 80);
  assert.equal(result.summary.files, 2);
});
