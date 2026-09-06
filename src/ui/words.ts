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
import { LineResult, Summary } from '../engine/types';
import { DecisionState } from '../decisions/decisions';
import { TestRunSummary } from '../languages/types';

export interface Voice {
  /** Append the technical form for people who want it. */
  showNumbers: boolean;
}

export const PRODUCT = 'DeepTest';

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
  const belowBar = !summary.coverageOk || !summary.densityPassRateOk || !summary.averageDensityOk || !summary.complexityOk || failing > 0;
  if (!belowBar) {
    const tail = openCount > 0 ? ` ${plural(openCount, 'line')} still ${openCount === 1 ? 'wants' : 'want'} more tests; your limits allow that.` : ' Every line has the tests it needs.';
    const acc = acceptedCount > 0 ? ` ${plural(acceptedCount, 'line')} accepted by a person.` : '';
    return { ready: true, headline: 'This looks ready.', detail: `It meets the limits you set.${tail}${acc}` };
  }
  const headline = failing > 0 ? 'This is not ready: tests fail.' : summary.untestedLines > 0 ? `This is not ready: ${plural(summary.untestedLines, 'line')} ${summary.untestedLines === 1 ? 'was' : 'were'} never tested.` : 'This is not ready.';
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
        ? `${hardest.name}() has ${hardest.complexity} ways through it. Your limit is ${t.maxFunctionComplexity}.`
        : summary.functions === 0
          ? 'No functions measured.'
          : `Every function is within your limit of ${t.maxFunctionComplexity} ways through.`,
      ok: summary.complexityOk,
      numbers: `cyclomatic complexity total ${summary.totalComplexity}, average ${summary.averageComplexity.toFixed(1)}, max ${summary.maxComplexity}`,
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
