/**
 * Plain-language wording for routes and lines. Deterministic: every
 * sentence here comes from the syntax, never from a guess. The raw
 * condition text always travels with the wording so nothing can hide
 * behind a paraphrase.
 */
import { RouteProgress, RouteProgressStep, RouteStep } from '../engine/types';

const KIND_NOUN: Record<RouteStep['kind'], string> = {
  if: 'the check',
  elif: 'the next check',
  else: 'the fallback',
  loop: 'the loop',
  except: 'the error handler for',
  case: 'the case',
  guard: 'the case guard',
  and: 'and also',
  or: 'or else',
  ternary: 'the inline choice',
  comprehension: 'the list filter',
  with: 'the context',
};

/** "the check `x > 0` is false" */
export function describeStep(step: RouteStep): string {
  const noun = KIND_NOUN[step.kind];
  const cond = step.condition ? `\`${step.condition}\`` : '';
  switch (step.kind) {
    case 'and':
      return `and also ${cond} ${step.outcome}`;
    case 'or':
      return `or else ${cond} ${step.outcome}`;
    case 'except':
      return `${noun} ${cond} ${step.outcome}`;
    case 'case':
      return `${cond} ${step.outcome === 'is true' ? 'holds' : 'does not hold'}`;
    default:
      return `${noun} ${cond} ${step.outcome}`.replace(/\s+/g, ' ').trim();
  }
}

/** "Your tests get past 3 of 18 decisions and stop at: the check `age > 30` is true." */
export function describeReach(route: RouteProgress): string {
  if (route.total === 0) {
    return 'No decision guards this line inside its function; it comes after the branches above it, not inside them. Still, no test reached it.';
  }
  if (route.reached >= route.total) {
    return `Tests get past every one of the ${route.total} decision${route.total === 1 ? '' : 's'} on the way here, but not enough of them do.`;
  }
  const stop = route.steps[route.reached];
  const past = route.reached === 0 ? 'none' : `${route.reached} of ${route.total}`;
  return `Your tests get past ${past} of the decisions on the way here. They stop at: ${describeStep(stop)}. No test has ever made that happen.`;
}

/** One line per step with a tick or a cross and the test count. */
export function describeRouteSteps(route: RouteProgress): string[] {
  return route.steps.map((step: RouteProgressStep, i: number) => {
    const ok = i < route.reached;
    const mark = ok ? '✓' : '✗';
    const count = ok ? `${step.testsPast} test${step.testsPast === 1 ? ' gets' : 's get'} past` : 'no test gets past';
    return `${mark} ${i + 1}. ${describeStep(step)} (line ${step.line}; ${count})`;
  });
}

export type Ending = 'returns' | 'raises' | 'calls' | 'assigns' | 'runs';

/** What the line does, from its own text. Python and C-family keywords both covered. */
export function classifyEnding(code: string): Ending {
  const t = code.trim();
  if (/^(return|yield)\b/.test(t)) {
    return 'returns';
  }
  if (/^(raise|throw)\b/.test(t)) {
    return 'raises';
  }
  if (/^[\w.\[\]]+\s*(=|\+=|-=|\*=|\/=)\s*[^=]/.test(t) && !/\(.*\)\s*$/.test(t)) {
    return 'assigns';
  }
  if (/\w\s*\(/.test(t)) {
    return 'calls';
  }
  return 'runs';
}

/** "What this means" without a model: from the ending alone. */
export function describeMeaning(code: string, untested: boolean, gap: number): string {
  const ending = classifyEnding(code);
  const never = untested ? 'has never run under a test' : `has run under too few tests (short by ${gap})`;
  const checked = untested ? 'has never been checked' : 'has been checked from too few directions';
  switch (ending) {
    case 'raises':
      return `This is an error path, and it ${never}. If it is wrong, the program fails in a way ${untested ? 'nobody has seen' : 'few tests have seen'}.`;
    case 'returns':
      return `This line hands back a result, and it ${never}. Whatever it returns ${checked}.`;
    case 'calls':
      return `This line does something (it calls \`${code.trim().slice(0, 60)}\`), and it ${never}. ${untested ? 'Nobody knows whether that call works from here.' : 'That call has been tried from too few directions.'}`;
    case 'assigns':
      return `This line sets a value, and it ${never}. Anything that depends on that value inherits the doubt.`;
    default:
      return `This line ${never}.`;
  }
}

/** A step phrased as a goal: "the check `x` is true" or, for an operand, "`b` is also true". */
function stepAsGoal(step: RouteStep): string {
  if (step.kind === 'and' || step.kind === 'or') {
    return `\`${step.condition}\` ${step.outcome}`;
  }
  return describeStep(step);
}

export function describeAction(route: RouteProgress, bar: number, density: number): string {
  const more = bar - density;
  if (route.total === 0) {
    return density === 0 ? 'Write one test that runs this line. Or accept the risk and record why.' : `Write ${more} more test${more === 1 ? '' : 's'} that run${more === 1 ? 's' : ''} this line by a different path. Or accept the risk and record why.`;
  }
  if (route.reached < route.total) {
    const stop = route.steps[route.reached];
    return `Write a test where ${stepAsGoal(stop)}, then keep going until the line runs. Or accept the risk and record why.`;
  }
  return more === 1
    ? 'Write 1 more test that reaches this line by taking one of the decisions above it differently. Or accept the risk and record why.'
    : `Write ${more} more tests that reach this line, each taking a different decision differently. Or accept the risk and record why.`;
}
