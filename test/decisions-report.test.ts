import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  applyDecisions,
  decisionState,
  emptyDecisionFile,
  findDecision,
  functionDecisionState,
  hashLine,
  openShortfalls,
  parseDecisionFile,
  recordDecision,
  removeDecision,
  serializeDecisionFile,
  Decision,
} from '../src/decisions/decisions';
import { analyze, scoreLine } from '../src/engine/density';
import { FileCoverage, FileStructure, RouteStep } from '../src/engine/types';
import { buildBrief, buildFunctionBrief } from '../src/report/brief';
import { functionDecisionSentence } from '../src/ui/words';
import { classifyEnding, describeAction, describeMeaning, describeReach, describeRouteSteps, describeStep } from '../src/report/plain';
import { buildReport, renderMarkdown, verdictFor } from '../src/report/report';

function cov(path: string, lines: Record<number, string[]>): FileCoverage {
  const map = new Map<number, Set<string>>();
  const executed = new Set<number>();
  for (const [line, tests] of Object.entries(lines)) {
    map.set(Number(line), new Set(tests));
    if (tests.length) {
      executed.add(Number(line));
    }
  }
  return { path, lines: map, executed };
}

function struct(path: string, depth: Record<number, number>, routes: Record<number, RouteStep[]> = {}, unreachable: number[] = []): FileStructure {
  return {
    path,
    depth: new Map(Object.entries(depth).map(([k, v]) => [Number(k), v])),
    routes: new Map(Object.entries(routes).map(([k, v]) => [Number(k), v])),
    unreachable: new Set(unreachable),
    functions: [{ name: 'f', startLine: 1, endLine: 20, complexity: 12, campbell: 5, mbcc: 8 }],
    declarations: new Set([1]),
  };
}

const step = (line: number, condition: string, outcome = 'is true', kind: RouteStep['kind'] = 'if'): RouteStep => ({ line, kind, condition, outcome });

// A small program:
//  1 def f(x, y):
//  2     if x > 0:           <- 2 tests
//  3         if y > 0:       <- 1 test   (bar 2 -> short by 1)
//  4             return 1    <- 0 tests   (route: x>0 true, y>0 true) bar 2
//  5     elif y > 0 and x == 0:  <- 0 tests (route: x>0 false, y>0 true, x==0 also true) bar 3
//  6         return 2        <- 0 tests   bar 3
//  7     return 3            <- 2 tests   bar 1 -> over
//  8     print("dead")       <- unreachable
const SRC: Record<number, string> = {
  1: 'def f(x, y):',
  2: '    if x > 0:',
  3: '        if y > 0:',
  4: '            return 1',
  5: '    elif y > 0 and x == 0:',
  6: '        return 2',
  7: '    return 3',
  8: '    print("dead")',
};
const readLine = (_p: string, l: number): string | undefined => SRC[l];

function sampleResult() {
  const routes: Record<number, RouteStep[]> = {
    2: [step(2, 'x > 0')],
    3: [step(2, 'x > 0'), step(3, 'y > 0')],
    4: [step(2, 'x > 0'), step(3, 'y > 0')],
    5: [step(2, 'x > 0', 'is false'), step(5, 'y > 0', 'is true', 'elif'), step(5, 'x == 0', 'is also true', 'and')],
    6: [step(2, 'x > 0', 'is false'), step(5, 'y > 0', 'is true', 'elif'), step(5, 'x == 0', 'is also true', 'and')],
    7: [],
  };
  return analyze(
    [cov('a.py', { 1: [], 2: ['t1', 't2'], 3: ['t1'], 4: [], 5: [], 6: [], 7: ['t1', 't2'] })],
    [struct('a.py', { 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 0 }, routes, [8])],
  );
}

const run = { tests: { passed: 2, failed: 0, errors: 0, skipped: 0, exitCode: 0 }, language: 'Python', finishedAt: new Date('2026-09-05T12:00:00Z') };

test('hashLine ignores surrounding whitespace only', () => {
  assert.equal(hashLine('  return 1  '), hashLine('return 1'));
  assert.notEqual(hashLine('return 1'), hashLine('return 2'));
});

test('decision file round-trips, replaces per line, removes, and rejects junk', () => {
  const d: Decision = { path: 'a.py', line: 5, lineHash: hashLine(SRC[5]), kind: 'accept', reason: 'legacy path', by: 'me', at: '2026-09-05T00:00:00Z', gapAtDecision: 3 };
  let file = recordDecision(emptyDecisionFile(), d);
  file = recordDecision(file, { ...d, reason: 'updated' });
  assert.equal(file.decisions.length, 1);
  assert.equal(findDecision(file, 'a.py', 5)?.reason, 'updated');
  const parsed = parseDecisionFile(serializeDecisionFile(file));
  assert.deepEqual(parsed, file);
  assert.equal(removeDecision(file, 'a.py', 5).decisions.length, 0);
  assert.throws(() => parseDecisionFile('{"version":2}'));
  assert.throws(() => parseDecisionFile('{"version":1,"decisions":"no"}'));
});

test('decisionState: none, accepted, fix pending (moved or not), fixed, and stale', () => {
  const base: Decision = { path: 'a.py', line: 5, lineHash: hashLine(SRC[5]), kind: 'accept', reason: 'r', by: 'me', at: '2026-09-05T00:00:00Z', gapAtDecision: 3 };
  const short = scoreLine(5, ['t'], 3);
  const met = scoreLine(5, ['a', 'b', 'c'], 3);
  assert.equal(decisionState(undefined, short, SRC[5]).kind, 'none');
  assert.equal(decisionState(base, short, SRC[5]).kind, 'accepted');
  assert.equal(decisionState(base, short, 'something else').kind, 'stale');
  assert.equal(decisionState(base, short, undefined).kind, 'accepted', 'unreadable file keeps the decision');
  const fix = { ...base, kind: 'fix' as const };
  const pending = decisionState(fix, short, SRC[5]);
  assert.equal(pending.kind, 'fix-pending');
  if (pending.kind === 'fix-pending') {
    assert.equal(pending.stillShortBy, 2);
    assert.equal(pending.moved, true);
  }
  const stuck = decisionState({ ...fix, gapAtDecision: 2 }, short, SRC[5]);
  if (stuck.kind === 'fix-pending') {
    assert.equal(stuck.moved, false);
  }
  assert.equal(decisionState(fix, met, SRC[5]).kind, 'fixed');
});

test('applyDecisions and openShortfalls: accepted lines leave the open list, order follows the ranking', () => {
  const result = sampleResult();
  const file = recordDecision(emptyDecisionFile(), {
    path: 'a.py', line: 6, lineHash: hashLine(SRC[6]), kind: 'accept', reason: 'covered by integration tests', by: 'me', at: '2026-09-05T00:00:00Z', gapAtDecision: 3,
  });
  const decided = applyDecisions(result, file, readLine);
  assert.deepEqual(decided.map((d) => `${d.line.line}:${d.state.kind}`).sort(), ['3:none', '4:none', '5:none', '6:accepted']);
  const open = openShortfalls(decided, result.shortfalls);
  assert.deepEqual(open.map((d) => d.line.line), [5, 4, 3]);
});

test('plain: steps, reach, endings, meaning, action', () => {
  assert.equal(describeStep(step(2, 'x > 0')), 'the check `x > 0` is true');
  assert.equal(describeStep(step(5, 'x == 0', 'is also true', 'and')), 'and also `x == 0` is also true');
  assert.equal(describeStep(step(9, 'ValueError', 'is raised inside the try', 'except')), 'the error handler for `ValueError` is raised inside the try');
  assert.equal(describeStep(step(9, 'v matches 1', 'is false', 'case')), '`v matches 1` does not hold');

  const result = sampleResult();
  const line5 = result.files[0].lines.find((l) => l.line === 5)!;
  assert.match(describeReach(line5.route), /get past none of the decisions/);
  assert.match(describeReach(line5.route), /the check `x > 0` is false/);
  const line4 = result.files[0].lines.find((l) => l.line === 4)!;
  assert.equal(line4.route.reached, 1);
  assert.match(describeReach(line4.route), /get past 1 of 2/);
  assert.deepEqual(describeRouteSteps(line4.route).map((s) => s[0]), ['✓', '✗']);
  const line7 = result.files[0].lines.find((l) => l.line === 7)!;
  assert.match(describeReach(line7.route), /No decision guards/);

  assert.equal(classifyEnding('return x'), 'returns');
  assert.equal(classifyEnding('raise ValueError()'), 'raises');
  assert.equal(classifyEnding('throw new Error()'), 'raises');
  assert.equal(classifyEnding('total = a + b'), 'assigns');
  assert.equal(classifyEnding('save(order)'), 'calls');
  assert.equal(classifyEnding('pass'), 'runs');
  assert.match(describeMeaning('raise X', true, 3), /error path/);
  assert.match(describeMeaning('return 1', false, 2), /short by 2/);
  assert.match(describeMeaning('go()', true, 1), /calls `go\(\)`/);
  assert.match(describeMeaning('y = 1', true, 1), /sets a value/);
  assert.match(describeMeaning('pass', true, 1), /has never run/);
  assert.match(describeAction(line5.route, 3, 0), /Write a test where the check `x > 0` is false/);
  const stopAtOperand = { ...line5.route, reached: 2 };
  assert.match(describeAction(stopAtOperand, 3, 0), /Write a test where `x == 0` is also true/);
  assert.match(describeAction(line7.route, 1, 0), /Write one test that runs this line/);
  assert.match(describeAction(line7.route, 3, 1), /2 more tests that run this line/);
  assert.match(describeAction(line7.route, 2, 1), /1 more test that runs this line/);
  const walked = { steps: line4.route.steps.map((s) => ({ ...s, testsPast: 1 })), reached: 2, total: 2 };
  assert.match(describeReach(walked), /past every one of the 2 decisions/);
  assert.match(describeAction(walked, 2, 1), /1 more test that reaches this line/);
  assert.match(describeAction(walked, 3, 1), /2 more tests that reach this line/);
  assert.match(describeMeaning('return 1', false, 2), /checked from too few directions/);
});

test('report: worst N in full by the gap ranking, the rest in one line, accepted apart, verdict from thresholds', () => {
  const result = sampleResult();
  const file = recordDecision(emptyDecisionFile(), {
    path: 'a.py', line: 6, lineHash: hashLine(SRC[6]), kind: 'accept', reason: 'covered elsewhere', by: 'me', at: '2026-09-05T00:00:00Z', gapAtDecision: 3,
  });
  const decided = applyDecisions(result, file, readLine);
  const model = buildReport({ result, decided, run, readLine, detailCount: 1 });
  assert.equal(model.ready, false);
  assert.match(model.verdict, /This is not ready/);
  assert.match(model.verdict, /1 function is harder to test than your limit/);
  assert.deepEqual(model.detailed.map((d) => d.line), [5]);
  assert.deepEqual(model.rest.map((d) => d.line), [4, 3]);
  assert.deepEqual(model.accepted.map((d) => d.line), [6]);
  assert.deepEqual(model.unreachable, [{ path: 'a.py', line: 8, code: 'print("dead")' }]);
  assert.equal(model.detailed[0].code, 'elif y > 0 and x == 0:');
  assert.equal(model.detailed[0].steps.length, 3);

  const md = renderMarkdown(model);
  assert.match(md, /## This is not ready\./);
  assert.match(md, /### 1\. a\.py, line 5: never tested/);
  assert.match(md, /\| a\.py \| 4 \| 0 \/ 2 \| 1 of 2 \|/);
  assert.match(md, /Accepted by me on 2026-09-05: covered elsewhere/);
  assert.match(md, /Code that can never run \(1\)/);
  assert.match(md, /`f\(\)` in a\.py line 1: 12 ways through, tangle 5 \/ 8/);
  assert.match(md, /## Ways through against tangle \(1 of 1 functions\)/);
  assert.match(md, /\| Function \| Where \| Ways through \| Tangle \(Campbell\) \| Tangle \(MBCC\) \|/);
  assert.match(md, /\| `f\(\)` \| a\.py line 1 \| 12 \| 5 \| 8 \|/);
  assert.deepEqual(model.compared.map((fn) => fn.name), ['f']);
});

test('report: verdict is ready when thresholds pass, and says how many lines are still open', () => {
  const s = sampleResult().summary;
  const passing = { ...s, coverageOk: true, densityPassRateOk: true, averageDensityOk: true, complexityOk: true, complexFunctions: [] };
  assert.deepEqual(verdictFor(passing, 2, run), { ready: true, verdict: 'It meets the limits you set. 2 lines still want more tests; your limits allow that.' });
  assert.deepEqual(verdictFor(passing, 0, run), { ready: true, verdict: 'It meets the limits you set. Every line has the tests it needs.' });
  const failing = verdictFor(passing, 0, { ...run, tests: { ...run.tests, failed: 1 } });
  assert.match(failing.verdict, /1 test fail/);
  assert.equal(failing.ready, false);
});

test('report: fix decisions show as pending, fixed, or stale', () => {
  const result = sampleResult();
  let file = recordDecision(emptyDecisionFile(), { path: 'a.py', line: 5, lineHash: hashLine(SRC[5]), kind: 'fix', reason: '', by: 'me', at: '2026-09-04T00:00:00Z', gapAtDecision: 3 });
  file = recordDecision(file, { path: 'a.py', line: 4, lineHash: 'stalehash', kind: 'accept', reason: 'old', by: 'me', at: '2026-09-01T00:00:00Z', gapAtDecision: 2 });
  const decided = applyDecisions(result, file, readLine);
  const md = renderMarkdown(buildReport({ result, decided, run, readLine, detailCount: 5 }));
  assert.match(md, /A fix was requested on 2026-09-04; still 3 tests short, nothing changed/);
  assert.match(md, /the line has changed since, so it no longer applies/);
});

test('brief: names the line, the bar, the route, where tests stop, nearby tests, and what done means', () => {
  const result = sampleResult();
  const file = result.files[0];
  const line = file.lines.find((l) => l.line === 4)!;
  const brief = buildBrief({
    path: 'a.py',
    line,
    file,
    context: [2, 3, 4, 5].map((l) => ({ line: l, text: SRC[l] })),
    testsPath: 'tests',
    language: 'Python',
  });
  assert.match(brief, /make a\.py line 4 meet its test bar/);
  assert.match(brief, />\s+4 \| {13}return 1/);
  assert.match(brief, /needs at least 2 DISTINCT tests/);
  assert.match(brief, /Existing tests stop at decision 2: the check `y > 0` is true/);
  assert.match(brief, /Decision 1 \(line 2\) is already cleared by 1 test/);
  assert.match(brief, /- `t1`/);
  assert.match(brief, /- `t2`/);
  assert.match(brief, /2 new tests, each a separate test case/);
  assert.match(brief, /will not accept the fix on your behalf/);

  const flat = file.lines.find((l) => l.line === 7)!;
  const flatBrief = buildBrief({ path: 'a.py', line: flat, file, context: [{ line: 7, text: SRC[7] }], testsPath: '', language: 'Python' });
  assert.match(flatBrief, /No decisions guard this line/);
  assert.match(flatBrief, /\(workspace root\)/);
});

test('function brief: both modes quote the function, list the short lines, and end with the judge sentence', () => {
  const result = sampleResult();
  const file = result.files[0];
  const fn = { name: 'f', startLine: 1, endLine: 8, complexity: 5, campbell: 0, mbcc: 0 };
  const source = [1, 2, 3, 4, 5, 6, 7, 8].map((l) => ({ line: l, text: SRC[l] }));
  const testing = buildFunctionBrief({ path: 'a.py', fn, file, source, sourceTruncated: false, limit: 3, testsPath: 'tests', language: 'Python', mode: 'test' });
  assert.match(testing, /^# DeepTest: test every way through f\(\) in a\.py/);
  assert.match(testing, /It has 5 ways through it .* the limit for this project is 3/);
  assert.match(testing, /   1 \| def f\(x, y\):/);
  assert.match(testing, /4 lines inside it are short of the tests they need, 9 tests in all/);
  assert.match(testing, /- Line 4: 0 of 2 tests \(2 decisions guard it\)\. Tests stop at: the check `y > 0` is true\./);
  assert.match(testing, /Do not change `f\(\)` or any other code under test/);
  assert.match(testing, /It will not accept the result on your behalf\.$/);
  assert.doesNotMatch(testing, /Break `f\(\)`/);

  const refactor = buildFunctionBrief({ path: 'a.py', fn, file, source: source.slice(0, 2), sourceTruncated: true, limit: 3, testsPath: '', language: 'Python', mode: 'refactor' });
  assert.match(refactor, /^# DeepTest: bring f\(\) within 3 ways through in a\.py/);
  assert.match(refactor, /cut here; read the rest of the function from the file/);
  assert.match(refactor, /Break `f\(\)` into smaller functions so that it, and every function you create from it, has at most 3 ways through/);
  assert.match(refactor, /The existing tests pass without being edited/);
  assert.match(refactor, /\(workspace root\)/);
});

test('function decisions: pinned to the start line, judged by ways over the limit, kept apart from line decisions', () => {
  const fn = { name: 'f', startLine: 1, endLine: 8, complexity: 5, campbell: 0, mbcc: 0 };
  const d = { path: 'a.py', line: 1, lineHash: hashLine(SRC[1]), kind: 'fix' as const, reason: 'refactor', by: 'mike', at: '2026-09-06T10:00:00Z', gapAtDecision: 2, scope: 'function' as const, functionName: 'f' };
  assert.equal(functionDecisionState(undefined, fn, 3, SRC[1]).kind, 'none');
  assert.deepEqual(functionDecisionState(d, fn, 3, SRC[1]), { kind: 'fix-pending', decision: d, stillShortBy: 2, moved: false });
  assert.deepEqual(functionDecisionState(d, { ...fn, complexity: 4 }, 3, SRC[1]), { kind: 'fix-pending', decision: d, stillShortBy: 1, moved: true });
  assert.equal(functionDecisionState(d, { ...fn, complexity: 3 }, 3, SRC[1]).kind, 'fixed');
  assert.equal(functionDecisionState(d, fn, 3, 'def g(x, y):').kind, 'stale');
  // A line decision on the same line number is a different decision.
  const lineDecision = { ...d, scope: undefined, functionName: undefined, kind: 'accept' as const, reason: 'legacy code' };
  let file = recordDecision(emptyDecisionFile(), d);
  file = recordDecision(file, lineDecision);
  assert.equal(file.decisions.length, 2);
  assert.equal(findDecision(file, 'a.py', 1)?.kind, 'accept');
  assert.equal(functionDecisionState(d, fn, 3, SRC[1]).kind, 'fix-pending');
  file = removeDecision(file, 'a.py', 1, 'function');
  assert.equal(file.decisions.length, 1);
  assert.equal(file.decisions[0].kind, 'accept');
  assert.equal(functionDecisionSentence({ kind: 'fix-pending', decision: d, stillShortBy: 2, moved: false }), 'A fix was requested on 2026-09-06. Still 2 ways through over your limit, nothing changed. Your call again.');
  assert.equal(functionDecisionSentence({ kind: 'fixed', decision: d }), 'Fixed after your request on 2026-09-06. It is within your limit now.');
});
