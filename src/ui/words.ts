/**
 * Every phrase a person reads, in one place, written for the lawyer first.
 *
 * The rule: no engineer's word on the front of any screen. Density, depth,
 * bar, cyclomatic complexity, gap, declaration: none of it appears unless
 * "Show the numbers" is on, and then it appears beside the plain phrase,
 * never instead of it.
 *
 * Pure. Testable. The screens format; this file decides what is said.
 */
import { FunctionComplexity, LineResult, Summary } from '../engine/types';
import { DecisionState } from '../decisions/decisions';
import { Evidence, TestRunSummary } from '../languages/types';

export interface Voice {
  /** Append the technical form for people who want it. */
  showNumbers: boolean;
}

export const PRODUCT = 'DeepTest';

/** The full product name, series included. Used where the product is named in full,
 *  never in running text like "DeepTest: checking", which reads worse with it. */
export const PRODUCT_FULL = `${PRODUCT} - Polyglot`;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Whole percentages for people; the decimals live behind the numbers switch. */
function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** "never tested" / "1 test, needs 2" / "tested" — the phrase after a line. */
export function lineCaption(line: LineResult, voice: Voice): string {
  switch (line.status) {
    case 'unreachable':
      return 'This line can never run.';
    case 'declaration':
      return voice.showNumbers ? 'Runs at startup; not scored.' : '';
    case 'untested':
      return line.bar === 1 ? 'Never tested.' : `Never tested. Needs ${plural(line.bar, 'test')}.`;
    case 'short':
      return `${plural(line.density, 'test')}. Needs ${line.bar}.`;
    case 'met':
      return voice.showNumbers ? `${plural(line.density, 'test')}. Needs ${line.bar}.` : '';
    case 'over':
      return voice.showNumbers ? `${plural(line.density, 'test')}. Needs ${line.bar}.` : '';
    default:
      return '';
  }
}

/** One line for a finding in a list: "never tested. Needs 3 tests because 3 conditions guard it." */
export function findingSentence(line: LineResult, voice: Voice): string {
  const why = line.depth === 0 ? '' : line.depth === 1 ? ' because one condition guards it' : ` because ${line.depth} conditions guard it`;
  let text: string;
  if (line.status === 'untested') {
    text = line.depth === 0 ? 'Never tested.' : `Never tested. Needs ${plural(line.bar, 'test')}${why}.`;
  } else if (line.status === 'short') {
    text = `${plural(line.density, 'test')} reach${line.density === 1 ? 'es' : ''} it. Needs ${line.bar}${why}.`;
  } else if (line.status === 'unreachable') {
    text = 'Can never run. Delete it rather than test around it.';
  } else {
    text = `Tested by ${plural(line.density, 'test')}.`;
  }
  return voice.showNumbers ? `${text} (density ${line.density}, depth ${line.depth}, bar ${line.bar})` : text;
}

/** Short badge: "never tested", "needs 2 more", "can never run", "fine". */
export function badge(line: LineResult): string {
  switch (line.status) {
    case 'untested':
      return 'never tested';
    case 'short':
      return `needs ${plural(line.gap, 'more test')}`;
    case 'unreachable':
      return 'can never run';
    default:
      return 'fine';
  }
}

export function decisionSentence(state: DecisionState): string {
  switch (state.kind) {
    case 'accepted':
      return `Accepted by ${state.decision.by} on ${state.decision.at.slice(0, 10)}: ${state.decision.reason.replace(/[.!?]$/, '')}.`;
    case 'fix-pending':
      return `A fix was requested on ${state.decision.at.slice(0, 10)}. Still ${state.stillShortBy === 1 ? 'one test short' : `${state.stillShortBy} tests short`}${state.moved ? ', but closer' : ', nothing changed'}. Your call again.`;
    case 'fixed':
      return `Fixed after your request on ${state.decision.at.slice(0, 10)}.`;
    case 'stale':
      return `You decided about this line on ${state.decision.at.slice(0, 10)}, but the line has changed since. Decide again.`;
    default:
      return '';
  }
}

/** The sentence under a function that carries a fix decision. */
export function functionDecisionSentence(state: DecisionState): string {
  switch (state.kind) {
    case 'fix-pending':
      return `A fix was requested on ${state.decision.at.slice(0, 10)}. Still ${state.stillShortBy === 1 ? 'one way' : `${state.stillShortBy} ways`} through over your limit${state.moved ? ', but closer' : ', nothing changed'}. Your call again.`;
    case 'fixed':
      return `Fixed after your request on ${state.decision.at.slice(0, 10)}. It is within your limit now.`;
    case 'stale':
      return `You decided about this function on ${state.decision.at.slice(0, 10)}, but it has changed since. Decide again.`;
    default:
      return '';
  }
}

export interface VerdictWords {
  ready: boolean;
  headline: string;
  detail: string;
}

/** The first thing anyone sees. */
export function verdict(summary: Summary, tests: TestRunSummary, openCount: number, acceptedCount: number): VerdictWords {
  const failing = tests.failed + tests.errors;
  const problems: string[] = [];
  if (failing > 0) {
    problems.push(`${plural(failing, 'test')} fail${failing === 1 ? 's' : ''}`);
  }
  if (summary.untestedLines > 0) {
    problems.push(`${plural(summary.untestedLines, 'line')} of code ${summary.untestedLines === 1 ? 'has' : 'have'} never been tested`);
  }
  if (summary.shortLines > 0) {
    problems.push(`${plural(summary.shortLines, 'line')} ${summary.shortLines === 1 ? 'has' : 'have'} too few tests`);
  }
  const thresholdMisses: string[] = [];
  if (!summary.coverageOk) {
    thresholdMisses.push(`tests reach ${pct(summary.coveragePercent)} of the code and you asked for ${pct(summary.thresholds.minCoverage)}`);
  }
  if (!summary.densityPassRateOk) {
    thresholdMisses.push(`${pct(summary.densityPassRate)} of lines have enough tests and you asked for ${pct(summary.thresholds.minDensityPassRate)}`);
  }
  if (!summary.complexityOk) {
    thresholdMisses.push(`${plural(summary.complexFunctions.length, 'function')} ${summary.complexFunctions.length === 1 ? 'is' : 'are'} harder to test than your limit`);
  }
  const unmeasured = summary.unmeasuredFiles.length;
  if (unmeasured > 0) {
    problems.push(`${plural(unmeasured, 'file')} could not be measured`);
  }
  const belowBar = !summary.coverageOk || !summary.densityPassRateOk || !summary.averageDensityOk || !summary.complexityOk || failing > 0 || unmeasured > 0;
  if (!belowBar) {
    const tail = openCount > 0 ? ` ${plural(openCount, 'line')} still ${openCount === 1 ? 'wants' : 'want'} more tests; your limits allow that.` : ' Every line has the tests it needs.';
    const acc = acceptedCount > 0 ? ` ${plural(acceptedCount, 'line')} accepted by a person.` : '';
    return { ready: true, headline: 'This looks ready.', detail: `It meets the limits you set.${tail}${acc}` };
  }
  const headline =
    failing > 0
      ? 'This is not ready: tests fail.'
      : summary.untestedLines > 0
        ? `This is not ready: ${plural(summary.untestedLines, 'line')} ${summary.untestedLines === 1 ? 'was' : 'were'} never tested.`
        : unmeasured > 0
          ? `This is not ready: ${plural(unmeasured, 'file')} could not be measured.`
          : 'This is not ready.';
  const detail = [...problems, ...thresholdMisses].join('; ');
  return { ready: false, headline, detail: detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.` : '' };
}

export interface SummaryRow {
  label: string;
  value: string;
  ok: boolean;
  /** Technical form, shown only with the numbers switch. */
  numbers?: string;
}

/** The name of the ordered-operand measure, long form for a first mention and short form after. */
export const MBCC = 'MBCC';
export const MBCC_LONG = "MikeVan's Better Cognitive Complexity";

/**
 * The second and third numbers for one function, in plain words. "Tangle"
 * is cognitive complexity: how hard the function is to follow, as opposed
 * to how many ways there are through it. Two measures are shown side by
 * side: Campbell's published Cognitive Complexity, and MikeVan's Better
 * Cognitive Complexity (MBCC), which charges a run of and/or one per
 * operand when the order of the operands carries meaning.
 */
export function tangleSentence(fn: FunctionComplexity): string {
  const numbers = fn.campbell === fn.mbcc
    ? `Its tangle is ${fn.campbell} by Campbell and by ${MBCC}.`
    : `Its tangle is ${fn.campbell} by Campbell and ${fn.mbcc} by ${MBCC}.`;
  const check = tangleCheck(fn);
  return check ? `${numbers} ${check}` : numbers;
}

/**
 * The sanity check between ways through and tangle. DeepTest ranks and
 * judges by ways through; tangle rides beside it so the two can disagree
 * out loud. When they do, the disagreement is the finding: tangle above
 * ways through is a nest (short, dangerous, UntangleIt's job); ways
 * through at twice the tangle or more is a flat dispatcher (long, not
 * hard, needs tests more than untangling). Agreement says nothing extra.
 */
export function tangleCheck(fn: FunctionComplexity): string {
  if (fn.mbcc > fn.complexity) {
    return 'It is harder to follow than it is to test, which means nesting. That is a job for UntangleIt.';
  }
  if (fn.complexity >= 2 * fn.mbcc && fn.complexity > 1) {
    return 'It is long rather than hard to follow. It needs tests more than it needs untangling.';
  }
  return '';
}

/** The three numbers, compact, for a list row: "30 ways through, tangle 12 / 15". */
export function threeNumbers(fn: FunctionComplexity): string {
  const tangle = fn.campbell === fn.mbcc ? `${fn.campbell}` : `${fn.campbell} / ${fn.mbcc}`;
  return `${fn.complexity} ways through, tangle ${tangle}`;
}

export function summaryRows(summary: Summary, voice: Voice): SummaryRow[] {
  const t = summary.thresholds;
  const hardest = summary.complexFunctions[0];
  const rows: SummaryRow[] = [
    {
      label: 'Tests reach',
      value: `${summary.coveredLines} of ${plural(summary.executableLines, 'line')} (${pct(summary.coveragePercent)}). You want ${pct(t.minCoverage)}.`,
      ok: summary.coverageOk,
      numbers: `line coverage ${summary.coveragePercent}%`,
    },
    {
      label: 'Lines with enough tests',
      value: `${summary.scoredLines - summary.untestedLines - summary.shortLines} of ${summary.scoredLines} (${pct(summary.densityPassRate)}). You want ${pct(t.minDensityPassRate)}.`,
      ok: summary.densityPassRateOk,
      numbers: `density pass rate ${summary.densityPassRate}%, average density ${summary.averageDensity.toFixed(2)} against ${t.minAverageDensity.toFixed(2)}`,
    },
    {
      label: 'Hardest to test',
      value: hardest
        ? `${hardest.name}() has ${hardest.complexity} ways through it. Your limit is ${t.maxFunctionComplexity}. ${tangleSentence(hardest)}`
        : summary.functions === 0
          ? 'No functions measured.'
          : `Every function is within your limit of ${t.maxFunctionComplexity} ways through.`,
      ok: summary.complexityOk,
      numbers: `cyclomatic complexity total ${summary.totalComplexity}, average ${summary.averageComplexity.toFixed(1)}, max ${summary.maxComplexity}; cognitive complexity max ${summary.maxCampbell} (Campbell), ${summary.maxMbcc} (${MBCC})`,
    },
  ];
  if (summary.unreachableLines > 0) {
    rows.push({
      label: 'Can never run',
      value: `${plural(summary.unreachableLines, 'line')}. Delete ${summary.unreachableLines === 1 ? 'it' : 'them'}.`,
      ok: false,
      numbers: 'statically unreachable',
    });
  }
  if (!voice.showNumbers) {
    for (const r of rows) {
      delete r.numbers;
    }
  }
  return rows;
}

/**
 * A run counts only when at least one test reached its end, passing or
 * failing. Tests that errored at setup (a missing fixture, a database that
 * is not running) and tests that were skipped executed no code under test,
 * so coverage from such a run is noise and must never be scored. 0.3.8
 * scored "0 passed, 5 could not run" beside a 16% coverage figure; this is
 * the language-neutral guard that stops it, above the plugin contract.
 */
export function testsRan(tests: TestRunSummary): boolean {
  return tests.passed + tests.failed > 0;
}

/** Why a run with no finished test is refused, in plain words. */
export function nothingToScoreSentence(tests: TestRunSummary): string {
  const see = 'Press "Show the log" to see the test run.';
  if (tests.errors > 0) {
    return `No test ran to the end, so there is nothing to score. ${plural(tests.errors, 'test')} could not run, usually because of a setup error such as a missing fixture or a database that is not running. ${see}`;
  }
  if (tests.skipped > 0) {
    return `No test ran, so there is nothing to score. ${tests.skipped === 1 ? 'The only test was' : `All ${tests.skipped} tests were`} skipped. ${see}`;
  }
  return `No test ran, so there is nothing to score. ${see}`;
}

/**
 * Why a run whose attribution has a hole in it is refused, or undefined when
 * the evidence holds. A test that finished and left no record means lines it
 * ran are credited to nobody, and a card drawn from that would call them
 * untested. A record with a broken boundary credits lines to a test that did
 * not run them alone. Both are the check not finishing, in the architecture's
 * sense: the reason is stated and the person gets the three controls.
 */
export function evidenceProblemSentence(evidence: Evidence): string | undefined {
  const see = 'Press "Show the log" to see the test run.';
  if (!evidence.reconcilable) {
    return undefined;
  }
  if (evidence.brokenBoundaries > 0) {
    return `${plural(evidence.brokenBoundaries, 'test')} ${evidence.brokenBoundaries === 1 ? 'was' : 'were'} cut off before ${evidence.brokenBoundaries === 1 ? 'it' : 'they'} ended, so what ${evidence.brokenBoundaries === 1 ? 'it' : 'they'} reached cannot be told apart from the next test. Nothing was scored. ${see}`;
  }
  if (evidence.testsRecorded < evidence.testsFinished) {
    const missing = evidence.testsFinished - evidence.testsRecorded;
    return `${plural(evidence.testsFinished, 'test')} finished but only ${evidence.testsRecorded} left a record of the lines ${evidence.testsRecorded === 1 ? 'it' : 'they'} reached, so ${plural(missing, 'test')} ${missing === 1 ? 'is' : 'are'} unaccounted for. Nothing was scored. ${see}`;
  }
  return undefined;
}

/** "3 files could not be measured." on the card, or an empty string. */
export function unmeasuredSentence(summary: Summary): string {
  const n = summary.unmeasuredFiles.length;
  if (n === 0) {
    return '';
  }
  return `${plural(n, 'file')} could not be measured, so ${n === 1 ? 'it is' : 'they are'} not in these numbers. ${n === 1 ? 'It is' : 'They are'} listed in the full report.`;
}

/** The line for one unmeasured file in the full report. */
export function unmeasuredFileSentence(file: { path: string; reason: string }): string {
  const reason = file.reason.trim().replace(/\.$/, '');
  return `${file.path} could not be measured. ${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
}

/** "2 decisions could not be counted." for a file, in the report, or an empty string. */
export function skippedSentence(skipped: Array<{ line: number; reason: string }>): string {
  if (skipped.length === 0) {
    return '';
  }
  const lines = skipped.map((s) => s.line).join(', ');
  return `${plural(skipped.length, 'decision')} on ${skipped.length === 1 ? 'line' : 'lines'} ${lines} could not be counted, so which way ${skipped.length === 1 ? 'it' : 'they'} went is unknown. The ${skipped.length === 1 ? 'line is' : 'lines are'} still counted as run or not run.`;
}

export function testsSentence(tests: TestRunSummary): string {
  const parts = [`${plural(tests.passed, 'test')} passed`];
  if (tests.failed) {
    parts.push(`${tests.failed} failed`);
  }
  if (tests.errors) {
    parts.push(`${tests.errors} could not run`);
  }
  if (tests.skipped) {
    parts.push(`${tests.skipped} skipped`);
  }
  return parts.join(', ');
}

export function hoverText(line: LineResult, filePath: string, state: DecisionState, reach: string, voice: Voice): string {
  const head = `**${PRODUCT}: ${findingSentence(line, voice)}**  \n_${filePath}, line ${line.line}_`;
  const parts = [head];
  if (line.status === 'declaration') {
    return `**${PRODUCT}:** this line runs when the program starts, not inside a test. It is not scored.  \n_${filePath}, line ${line.line}_`;
  }
  if (line.status === 'unreachable') {
    return `**${PRODUCT}: this line can never run.**  \nEvery path above it already left. Delete it rather than test around it.  \n_${filePath}, line ${line.line}_`;
  }
  const decision = decisionSentence(state);
  if (decision) {
    parts.push(decision);
  }
  if (line.gap > 0 && reach) {
    parts.push(reach);
  }
  if (line.tests.length > 0) {
    const shown = line.tests.slice(0, 20).map((t) => `- \`${t}\``);
    if (line.tests.length > 20) {
      shown.push(`- and ${line.tests.length - 20} more`);
    }
    parts.push(`Tests that reach this line:\n\n${shown.join('\n')}`);
  } else if (line.executed) {
    parts.push('It ran when the program started, but no test reached it.');
  }
  return parts.join('\n\n');
}

/**
 * Which way "Fix this on a function" goes. The refactor choice belongs to
 * UntangleIt when it is installed; every other case stays with DeepTest's
 * own brief. Pure, so the routing rule is pinned by a unit test.
 */
export type FunctionFixRoute = 'untangleit' | 'brief';

export function functionFixRoute(mode: 'test' | 'refactor', untangleItInstalled: boolean): FunctionFixRoute {
  return mode === 'refactor' && untangleItInstalled ? 'untangleit' : 'brief';
}

/** The description under "Break it into smaller pieces" in the quick pick. */
export function refactorChoiceDescription(name: string, limit: number, untangleItInstalled: boolean): string {
  return untangleItInstalled
    ? `UntangleIt takes ${name}() and splits it until it and every piece has at most ${limit} ways through. Behaviour stays the same. UntangleIt asks before anything changes.`
    : `Refactor ${name}() until it and every piece has at most ${limit} ways through. Behaviour stays the same.`;
}

/** What the person sees after the function has gone to UntangleIt. */
export function untangleSentSentence(name: string): string {
  return `${name}() is with UntangleIt. It will ask before anything changes. When it is done, press "Check my code again" and DeepTest will measure ${name}() again.`;
}

/** What the person sees when UntangleIt is installed but could not take the job. */
export function untangleFailedSentence(name: string): string {
  return `UntangleIt could not take ${name}(). Nothing was sent to the assistant. Open UntangleIt's log for the reason, or press "Fix this" again once UntangleIt is ready.`;
}

/** The setup screen's line about UntangleIt, installed or not. */
export function untangleItSetupHint(installed: boolean): string {
  return installed
    ? 'UntangleIt is installed. "Break it into smaller pieces" hands the function to it, and it asks before anything changes.'
    : '"Break it into smaller pieces" asks your AI assistant to refactor a function. DeepTest recommends UntangleIt, a separate extension that splits one method at a time, measures every piece afterwards, and reports the numbers. It is not installed.';
}
