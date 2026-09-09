/**
 * The report a non-programmer reads to decide whether to ship. Five stories
 * in full (configurable), one line for everything else, the whole thing on
 * one screen. Pure: builds a model from the analysis and the decisions, and
 * renders it to Markdown. The webview wraps the same model.
 *
 * "Worst" is the engine's ranking: gap first, then bar. Nothing else.
 */
import { DecidedFunction, DecidedLine, DecisionState } from '../decisions/decisions';
import { functionDecisionSentence, threeNumbers } from '../ui/words';
import { AnalysisResult, FunctionComplexity, RouteProgress, Summary } from '../engine/types';
import { RunInfoLike } from './types';
import { describeAction, describeMeaning, describeReach, describeRouteSteps } from './plain';

export interface ReportShortfall {
  path: string;
  line: number;
  code: string;
  density: number;
  bar: number;
  gap: number;
  untested: boolean;
  route: RouteProgress;
  /** "Your tests get past 3 of 18 decisions..." */
  reach: string;
  /** One line per decision with tick or cross. */
  steps: string[];
  meaning: string;
  action: string;
  state: DecisionState;
}

export interface ReportModel {
  generatedAt: string;
  language: string;
  testsLine: string;
  verdict: string;
  ready: boolean;
  summary: Summary;
  /** The worst N, explained in full. */
  detailed: ReportShortfall[];
  /** Everything else still open, one line each. */
  rest: ReportShortfall[];
  /** Accepted by a person, with their reason. */
  accepted: ReportShortfall[];
  unreachable: Array<{ path: string; line: number; code: string }>;
  /** Functions that carry a fix decision, as one sentence each. */
  functionDecisions: Array<{ path: string; startLine: number; sentence: string }>;
  detailCount: number;
  /**
   * The functions with the most ways through, with all three numbers, for
   * the comparison table. Capped at COMPARE_COUNT so a large project does
   * not turn the report into a phone book.
   */
  compared: Array<FunctionComplexity & { path: string }>;
}

/** How many functions the comparison table shows. */
export const COMPARE_COUNT = 30;

export interface ReportInput {
  result: AnalysisResult;
  decided: DecidedLine[];
  /** Functions that carry a fix decision; optional because a report can be built from results alone. */
  decidedFunctions?: DecidedFunction[];
  run: RunInfoLike;
  readLine: (path: string, line: number) => string | undefined;
  detailCount: number;
}

function toShortfall(d: DecidedLine, readLine: ReportInput['readLine']): ReportShortfall {
  const code = readLine(d.path, d.line.line) ?? '';
  const untested = d.line.status === 'untested';
  return {
    path: d.path,
    line: d.line.line,
    code: code.trim(),
    density: d.line.density,
    bar: d.line.bar,
    gap: d.line.gap,
    untested,
    route: d.line.route,
    reach: describeReach(d.line.route),
    steps: describeRouteSteps(d.line.route),
    meaning: describeMeaning(code, untested, d.line.gap),
    action: describeAction(d.line.route, d.line.bar, d.line.density),
    state: d.state,
  };
}

export function verdictFor(summary: Summary, openCount: number, run: RunInfoLike): { ready: boolean; verdict: string } {
  const failing = run.tests.failed + run.tests.errors;
  const problems: string[] = [];
  if (failing > 0) {
    problems.push(`${failing} test${failing === 1 ? '' : 's'} fail`);
  }
  if (!summary.coverageOk) {
    problems.push(`tests reach ${summary.coveragePercent}% of the code and you asked for ${summary.thresholds.minCoverage}%`);
  }
  if (!summary.densityPassRateOk) {
    problems.push(`${summary.densityPassRate}% of lines have enough tests and you asked for ${summary.thresholds.minDensityPassRate}%`);
  }
  if (!summary.averageDensityOk) {
    problems.push(`on average lines have ${summary.averageDensity.toFixed(2)} tests per condition and you asked for ${summary.thresholds.minAverageDensity.toFixed(2)}`);
  }
  if (!summary.complexityOk) {
    problems.push(`${summary.complexFunctions.length} function${summary.complexFunctions.length === 1 ? ' is' : 's are'} harder to test than your limit of ${summary.thresholds.maxFunctionComplexity} ways through`);
  }
  if (problems.length === 0) {
    const tail = openCount > 0 ? ` ${openCount} line${openCount === 1 ? '' : 's'} still want${openCount === 1 ? 's' : ''} more tests; your limits allow that.` : ' Every line has the tests it needs.';
    return { ready: true, verdict: `It meets the limits you set.${tail}` };
  }
  const first = problems[0].charAt(0).toUpperCase() + problems[0].slice(1);
  return { ready: false, verdict: `This is not ready. ${[first, ...problems.slice(1)].join('; ')}.` };
}

export function buildReport(input: ReportInput): ReportModel {
  const { result, decided, run, readLine, detailCount } = input;
  const functionDecisions = (input.decidedFunctions ?? []).filter((d) => d.state.kind !== 'none').map((d) => ({ path: d.path, startLine: d.fn.startLine, sentence: functionDecisionSentence(d.state) }));
  const byKey = new Map(decided.map((d) => [`${d.path}:${d.line.line}`, d]));
  const open: ReportShortfall[] = [];
  const accepted: ReportShortfall[] = [];
  // Walk the engine's ranking so the order is the metric's order.
  for (const s of result.shortfalls) {
    const d = byKey.get(`${s.path}:${s.line}`);
    if (!d) {
      continue;
    }
    const item = toShortfall(d, readLine);
    if (d.state.kind === 'accepted') {
      accepted.push(item);
    } else {
      open.push(item);
    }
  }
  const unreachable: ReportModel['unreachable'] = [];
  for (const f of result.files) {
    for (const line of f.unreachableLines) {
      unreachable.push({ path: f.path, line, code: (readLine(f.path, line) ?? '').trim() });
    }
  }
  const { ready, verdict } = verdictFor(result.summary, open.length, run);
  const t = run.tests;
  const testsLine = `${t.passed} passed${t.failed ? `, ${t.failed} failed` : ''}${t.errors ? `, ${t.errors} errors` : ''}${t.skipped ? `, ${t.skipped} skipped` : ''}`;
  return {
    generatedAt: run.finishedAt.toISOString(),
    language: run.language,
    testsLine,
    verdict,
    ready,
    summary: result.summary,
    detailed: open.slice(0, detailCount),
    rest: open.slice(detailCount),
    accepted,
    unreachable,
    functionDecisions,
    detailCount,
    compared: result.summary.measuredFunctions.slice(0, COMPARE_COUNT),
  };
}

function stateText(state: DecisionState): string {
  switch (state.kind) {
    case 'accepted':
      return `Accepted by ${state.decision.by} on ${state.decision.at.slice(0, 10)}: ${state.decision.reason}`;
    case 'fix-pending':
      return `A fix was requested on ${state.decision.at.slice(0, 10)}; still ${state.stillShortBy} test${state.stillShortBy === 1 ? '' : 's'} short${state.moved ? ' (was ' + state.decision.gapAtDecision + ')' : ', nothing changed'}.`;
    case 'fixed':
      return `Fixed after the request on ${state.decision.at.slice(0, 10)}.`;
    case 'stale':
      return `A decision was recorded on ${state.decision.at.slice(0, 10)} but the line has changed since, so it no longer applies. Decide again.`;
    default:
      return '';
  }
}

export function renderMarkdown(m: ReportModel): string {
  const s = m.summary;
  const out: string[] = [];
  out.push(`# DeepTest report`);
  out.push('');
  out.push(`${m.language}, ${m.generatedAt.slice(0, 16).replace('T', ' ')} UTC. Tests: ${m.testsLine}.`);
  out.push('');
  out.push(`## ${m.ready ? 'This looks ready.' : 'This is not ready.'}`);
  out.push('');
  out.push(m.verdict);
  out.push('');
  out.push('| What the tests say | Now | You want | |');
  out.push('|---|---|---|---|');
  out.push(`| How much of the code the tests reach | ${s.coveragePercent}% | ${s.thresholds.minCoverage}% | ${s.coverageOk ? 'ok' : 'below' } |`);
  out.push(`| Lines that have enough tests | ${s.densityPassRate}% | ${s.thresholds.minDensityPassRate}% | ${s.densityPassRateOk ? 'ok' : 'below'} |`);
  out.push(`| Ways through the hardest function | ${s.maxComplexity} | ${s.thresholds.maxFunctionComplexity} | ${s.complexityOk ? 'ok' : 'over'} |`);
  out.push('');
  out.push(`${s.untestedLines} line${s.untestedLines === 1 ? '' : 's'} never ran under a test, ${s.shortLines} ran under too few, ${m.accepted.length} accepted by a person, ${s.unreachableLines} can never run.`);
  out.push('');
  if (m.detailed.length > 0) {
    out.push(`## The ${m.detailed.length} worst, in full`);
    out.push('');
    m.detailed.forEach((d, i) => {
      out.push(`### ${i + 1}. ${d.path}, line ${d.line}: ${d.untested ? 'never tested' : `needs ${d.gap} more test${d.gap === 1 ? '' : 's'}`}`);
      out.push('');
      out.push('```');
      out.push(d.code);
      out.push('```');
      out.push('');
      out.push(`${d.density === 0 ? 'No test reaches it' : `${d.density} of the ${d.bar} tests it needs`}${d.bar > 1 && d.route.total > 0 ? `, one for each of the ${d.route.total} condition${d.route.total === 1 ? '' : 's'} on the way` : ''}. ${d.reach}`);
      out.push('');
      for (const step of d.steps) {
        out.push(`- ${step}`);
      }
      if (d.steps.length > 0) {
        out.push('');
      }
      out.push(`**What this means:** ${d.meaning}`);
      out.push('');
      out.push(`**What to do:** ${d.action}`);
      const st = stateText(d.state);
      if (st) {
        out.push('');
        out.push(`**Decision:** ${st}`);
      }
      out.push('');
    });
  }
  if (m.rest.length > 0) {
    out.push(`## ${m.rest.length} more that need attention`);
    out.push('');
    out.push('| File | Line | Tests it has / needs | Conditions the tests get past | Decision |');
    out.push('|---|---|---|---|---|');
    for (const r of m.rest) {
      out.push(`| ${r.path} | ${r.line} | ${r.density} / ${r.bar} | ${r.route.total === 0 ? 'no decisions' : `${r.route.reached} of ${r.route.total}`} | ${stateText(r.state) || ''} |`);
    }
    out.push('');
  }
  if (m.accepted.length > 0) {
    out.push(`## Accepted by a person (${m.accepted.length})`);
    out.push('');
    for (const a of m.accepted) {
      out.push(`- ${a.path} line ${a.line} (${a.density} / ${a.bar}): ${stateText(a.state)}`);
    }
    out.push('');
  }
  if (m.unreachable.length > 0) {
    out.push(`## Code that can never run (${m.unreachable.length})`);
    out.push('');
    out.push('These lines sit after a return, raise, break, or continue on every path. No test can reach them. The fix is to delete them.');
    out.push('');
    for (const u of m.unreachable) {
      out.push(`- ${u.path} line ${u.line}: \`${u.code}\``);
    }
    out.push('');
  }
  if (s.complexFunctions.length > 0) {
    out.push(`## Functions harder to test than your limit (${s.complexFunctions.length})`);
    out.push('');
    out.push(`The first number is how many different ways there are through the function. Over ${s.thresholds.maxFunctionComplexity}, it is hard to test fully and hard to change safely. The tangle is how hard the function is to follow: it charges every break in straight-line flow, and charges more the deeper it is nested. Where two tangle numbers appear, the first is Campbell's published Cognitive Complexity and the second is MikeVan's Better Cognitive Complexity (MBCC), which charges a chain of and/or one per operand when the order of the operands carries meaning.`);
    out.push('');
    for (const fn of s.complexFunctions) {
      const state = m.functionDecisions.find((d) => d.path === fn.path && d.startLine === fn.startLine);
      out.push(`- \`${fn.name}()\` in ${fn.path} line ${fn.startLine}: ${threeNumbers(fn)}${state ? ` (${state.sentence})` : ''}`);
    }
    out.push('');
  }
  if (m.compared.length > 0) {
    out.push(`## Ways through against tangle (${m.compared.length} of ${s.functions} functions)`);
    out.push('');
    out.push('The functions with the most ways through, with all three numbers side by side. A high count of ways through and a low tangle is a flat list of choices, such as a switch: long, but not hard to follow. A high tangle with few ways through is deep nesting. Where the Campbell and MBCC numbers differ, the function has boolean conditions whose order carries meaning. A function\'s tangle includes everything nested inside it, callbacks included, each one level deeper, so a short function that registers many handlers can carry a large tangle.');
    out.push('');
    out.push('| Function | Where | Ways through | Tangle (Campbell) | Tangle (MBCC) |');
    out.push('|---|---|---|---|---|');
    for (const fn of m.compared) {
      out.push(`| \`${fn.name}()\` | ${fn.path} line ${fn.startLine} | ${fn.complexity} | ${fn.campbell} | ${fn.mbcc} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
