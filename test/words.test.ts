import { test } from 'vitest';
import assert from 'node:assert/strict';
import { scoreLine, summarize, analyzeFile } from '../src/engine/density';
import { FileCoverage, FileStructure } from '../src/engine/types';
import { badge, decisionSentence, findingSentence, hoverText, lineCaption, summaryRows, tangleSentence, testsSentence, threeNumbers, verdict } from '../src/ui/words';

const plain = { showNumbers: false };
const numbers = { showNumbers: true };
const tests = { passed: 3, failed: 0, errors: 0, skipped: 0, exitCode: 0 };

function cov(path: string, lines: Record<number, string[]>): FileCoverage {
  const map = new Map<number, Set<string>>();
  const executed = new Set<number>();
  for (const [l, t] of Object.entries(lines)) {
    map.set(Number(l), new Set(t));
    if (t.length) {
      executed.add(Number(l));
    }
  }
  return { path, lines: map, executed };
}
function struct(path: string, depth: Record<number, number>, functions: FileStructure['functions'] = []): FileStructure {
  return { path, depth: new Map(Object.entries(depth).map(([k, v]) => [Number(k), v])), routes: new Map(), unreachable: new Set(), declarations: new Set(), functions };
}

test('lineCaption: plain by default, numbers on request, silence on green lines', () => {
  assert.equal(lineCaption(scoreLine(1, [], 3), plain), 'Never tested. Needs 3 tests.');
  assert.equal(lineCaption(scoreLine(1, [], 0), plain), 'Never tested.');
  assert.equal(lineCaption(scoreLine(1, ['a'], 3), plain), '1 test. Needs 3.');
  assert.equal(lineCaption(scoreLine(1, ['a', 'b'], 2), plain), '');
  assert.equal(lineCaption(scoreLine(1, ['a', 'b'], 2), numbers), '2 tests. Needs 2.');
  assert.equal(lineCaption(scoreLine(1, ['a', 'b', 'c'], 1), plain), '');
  assert.equal(lineCaption({ ...scoreLine(1, [], 0), status: 'unreachable' }, plain), 'This line can never run.');
  assert.equal(lineCaption({ ...scoreLine(1, [], 0), status: 'declaration' }, plain), '');
  assert.equal(lineCaption({ ...scoreLine(1, [], 0), status: 'declaration' }, numbers), 'Runs at startup; not scored.');
});

test('findingSentence says why, in words, and hides the metric unless asked', () => {
  assert.equal(findingSentence(scoreLine(6, [], 3), plain), 'Never tested. Needs 3 tests because 3 conditions guard it.');
  assert.equal(findingSentence(scoreLine(6, [], 1), plain), 'Never tested. Needs 1 test because one condition guards it.');
  assert.equal(findingSentence(scoreLine(6, [], 0), plain), 'Never tested.');
  assert.equal(findingSentence(scoreLine(4, ['t'], 2), plain), '1 test reaches it. Needs 2 because 2 conditions guard it.');
  assert.equal(findingSentence(scoreLine(4, ['t', 'u'], 2), plain), 'Tested by 2 tests.');
  assert.match(findingSentence(scoreLine(6, [], 3), numbers), /\(density 0, depth 3, bar 3\)$/);
  assert.equal(findingSentence({ ...scoreLine(9, [], 0), status: 'unreachable' }, plain), 'Can never run. Delete it rather than test around it.');
});

test('badge', () => {
  assert.equal(badge(scoreLine(1, [], 3)), 'never tested');
  assert.equal(badge(scoreLine(1, ['a'], 3)), 'needs 2 more tests');
  assert.equal(badge(scoreLine(1, ['a'], 2)), 'needs 1 more test');
  assert.equal(badge(scoreLine(1, ['a'], 1)), 'fine');
  assert.equal(badge({ ...scoreLine(1, [], 0), status: 'unreachable' }), 'can never run');
});

test('decisionSentence for every state', () => {
  const d = { path: 'a', line: 1, lineHash: 'h', kind: 'fix' as const, reason: '', by: 'mike', at: '2026-09-05T10:00:00Z', gapAtDecision: 3 };
  assert.equal(decisionSentence({ kind: 'none' }), '');
  assert.match(decisionSentence({ kind: 'accepted', decision: { ...d, kind: 'accept', reason: 'legacy' } }), /Accepted by mike on 2026-09-05: legacy/);
  assert.match(decisionSentence({ kind: 'fix-pending', decision: d, stillShortBy: 2, moved: true }), /Still 2 tests short, but closer/);
  assert.match(decisionSentence({ kind: 'fix-pending', decision: d, stillShortBy: 1, moved: false }), /Still one test short, nothing changed/);
  assert.match(decisionSentence({ kind: 'fixed', decision: d }), /Fixed after your request/);
  assert.match(decisionSentence({ kind: 'stale', decision: d }), /the line has changed since/);
});

test('verdict: not ready names the untested lines first; ready says what is left', () => {
  const f = analyzeFile(cov('a.py', { 1: [], 2: ['t'], 3: ['t', 'u'] }), struct('a.py', { 1: 1, 2: 2, 3: 1 }));
  const s = summarize([f]);
  const v = verdict(s, tests, 2, 0);
  assert.equal(v.ready, false);
  assert.equal(v.headline, 'This is not ready: 1 line was never tested.');
  assert.match(v.detail, /^1 line of code has never been tested; 1 line has too few tests; tests reach 67% of the code and you asked for 80%/);
  const failing = verdict(s, { ...tests, failed: 2 }, 2, 0);
  assert.equal(failing.headline, 'This is not ready: tests fail.');
  assert.match(failing.detail, /^2 tests fail;/);

  const g = analyzeFile(cov('a.py', { 1: ['t'], 2: ['t', 'u'] }), struct('a.py', { 1: 1, 2: 1 }));
  const gs = summarize([g], { maxFunctionComplexity: 10, minCoverage: 80, minAverageDensity: 1, minDensityPassRate: 90 });
  const ok = verdict(gs, tests, 0, 1);
  assert.equal(ok.ready, true);
  assert.equal(ok.headline, 'This looks ready.');
  assert.equal(ok.detail, 'It meets the limits you set. Every line has the tests it needs. 1 line accepted by a person.');
  const okOpen = verdict({ ...gs, densityPassRateOk: true }, tests, 3, 0);
  assert.match(okOpen.detail, /3 lines still want more tests; your limits allow that\./);
});

test('summaryRows: plain values, numbers only when asked, hardest function named', () => {
  const f = analyzeFile(cov('a.py', { 1: ['t'], 2: [], 3: ['t'] }), struct('a.py', { 1: 1, 2: 1, 3: 2 }, [{ name: 'big', startLine: 1, endLine: 9, complexity: 12, cognitive: 7, cognitiveOrdered: 9 }]));
  const s = summarize([f]);
  const rows = summaryRows(s, plain);
  assert.deepEqual(rows.map((r) => r.label), ['Tests reach', 'Lines with enough tests', 'Hardest to test']);
  assert.equal(rows[0].value, '2 of 3 lines (67%). You want 80%.');
  assert.equal(rows[1].value, '1 of 3 (33%). You want 90%.');
  assert.equal(rows[2].value, 'big() has 12 ways through it. Your limit is 10. Its tangle is 7 by Campbell and 9 by MBCC.');
  assert.equal(rows[2].ok, false);
  assert.equal(rows[0].numbers, undefined);
  const withNumbers = summaryRows(s, numbers);
  assert.match(withNumbers[2].numbers ?? '', /cyclomatic complexity total 12/);
  assert.match(withNumbers[2].numbers ?? '', /cognitive complexity max 7 \(Campbell\), 9 \(MBCC\)/);
  assert.equal(tangleSentence({ name: 'f', startLine: 1, endLine: 2, complexity: 3, cognitive: 4, cognitiveOrdered: 4 }), 'Its tangle is 4 by Campbell and by MBCC.');
  assert.equal(threeNumbers({ name: 'f', startLine: 1, endLine: 2, complexity: 3, cognitive: 4, cognitiveOrdered: 4 }), '3 ways through, tangle 4');
  assert.equal(threeNumbers({ name: 'f', startLine: 1, endLine: 2, complexity: 3, cognitive: 4, cognitiveOrdered: 6 }), '3 ways through, tangle 4 / 6');
  const fine = summarize([analyzeFile(cov('a.py', { 1: ['t'] }), struct('a.py', { 1: 1 }, [{ name: 'f', startLine: 1, endLine: 2, complexity: 2, cognitive: 0, cognitiveOrdered: 0 }]))]);
  assert.equal(summaryRows(fine, plain)[2].value, 'Every function is within your limit of 10 ways through.');
  assert.equal(summaryRows(summarize([]), plain)[2].value, 'No functions measured.');
});

test('testsSentence and hoverText', () => {
  assert.equal(testsSentence(tests), '3 tests passed');
  assert.equal(testsSentence({ ...tests, failed: 1, errors: 2, skipped: 3 }), '3 tests passed, 1 failed, 2 could not run, 3 skipped');
  const h = hoverText(scoreLine(6, [], 3), 'a.py', { kind: 'none' }, 'Your tests stop at X.', plain);
  assert.match(h, /^\*\*DeepTest: Never tested\. Needs 3 tests because 3 conditions guard it\.\*\*/);
  assert.match(h, /Your tests stop at X\./);
  assert.doesNotMatch(h, /density/);
  const t = hoverText(scoreLine(6, ['t1', 't2'], 2), 'a.py', { kind: 'none' }, '', plain);
  assert.match(t, /- `t1`/);
  const ran = hoverText({ ...scoreLine(6, [], 1), executed: true }, 'a.py', { kind: 'none' }, '', plain);
  assert.match(ran, /ran when the program started/);
  assert.match(hoverText({ ...scoreLine(1, [], 0), status: 'declaration' }, 'a.py', { kind: 'none' }, '', plain), /not scored/);
  assert.match(hoverText({ ...scoreLine(1, [], 0), status: 'unreachable' }, 'a.py', { kind: 'none' }, '', plain), /can never run/);
});
