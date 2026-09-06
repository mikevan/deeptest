/**
 * Human decisions about shortfalls. The tool finds and explains; the person
 * who is accountable decides. Nothing here is ever written without a person
 * choosing it, and nothing here is ever acted on by the tool.
 *
 * Two kinds of decision:
 *   accept  - "I know, and here is why." The shortfall leaves the ranked
 *             list and sits in its own section with the reason beside it.
 *   fix     - "Hand this to my AI." The brief was handed over; the next
 *             run reports whether the line cleared its bar, and if not,
 *             says "attempted, still short by N". No retry on the tool's
 *             initiative. The human decides again.
 *
 * A decision is pinned to the text of the line it was made about. When the
 * line changes, the decision no longer applies and says so, because a
 * reason written about one line must not silently cover a different one.
 *
 * Stored in <workspace>/.deeptest/decisions.json, plain JSON, human
 * readable, meant to be committed so the reasons travel with the code.
 */
import { createHash } from 'node:crypto';
import { AnalysisResult, FunctionComplexity, LineResult } from '../engine/types';

export type DecisionKind = 'accept' | 'fix';

export interface Decision {
  path: string;
  line: number;
  /** Hash of the trimmed line text at decision time. */
  lineHash: string;
  kind: DecisionKind;
  /** Required for accept. Free text for fix (which assistant, if the person wants to note it). */
  reason: string;
  by: string;
  at: string;
  /** The gap when the decision was made, so "still short by N" can say whether anything moved. */
  gapAtDecision: number;
  /**
   * Present when the decision is about a whole function rather than one
   * line: `line` is then the line the function starts on, and the hash pins
   * that line. gapAtDecision is how many ways through the function was over
   * the limit.
   */
  scope?: 'function';
  functionName?: string;
}

export interface DecisionFile {
  version: 1;
  decisions: Decision[];
}

export type DecisionState =
  | { kind: 'none' }
  | { kind: 'accepted'; decision: Decision }
  | { kind: 'fix-pending'; decision: Decision; stillShortBy: number; moved: boolean }
  | { kind: 'fixed'; decision: Decision }
  | { kind: 'stale'; decision: Decision };

export function hashLine(text: string): string {
  return createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
}

export function emptyDecisionFile(): DecisionFile {
  return { version: 1, decisions: [] };
}

export function parseDecisionFile(json: string): DecisionFile {
  const parsed = JSON.parse(json) as Partial<DecisionFile>;
  if (parsed.version !== 1 || !Array.isArray(parsed.decisions)) {
    throw new Error('decisions.json is not a DeepTest decisions file');
  }
  return { version: 1, decisions: parsed.decisions };
}

export function serializeDecisionFile(file: DecisionFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Replaces any earlier decision about the same line. One line, one current decision. */
export function recordDecision(file: DecisionFile, decision: Decision): DecisionFile {
  const others = file.decisions.filter((d) => !(d.path === decision.path && d.line === decision.line && (d.scope ?? 'line') === (decision.scope ?? 'line')));
  return { version: 1, decisions: [...others, decision] };
}

export function removeDecision(file: DecisionFile, path: string, line: number, scope: 'line' | 'function' = 'line'): DecisionFile {
  return { version: 1, decisions: file.decisions.filter((d) => !(d.path === path && d.line === line && (d.scope ?? 'line') === scope)) };
}

export function findDecision(file: DecisionFile, path: string, line: number): Decision | undefined {
  return file.decisions.find((d) => d.path === path && d.line === line && d.scope !== 'function');
}

/**
 * What a decision means for a line as it stands now. `currentLineText` is
 * the line's text today; undefined when the file could not be read.
 */
export function decisionState(decision: Decision | undefined, line: LineResult, currentLineText: string | undefined): DecisionState {
  if (!decision) {
    return { kind: 'none' };
  }
  if (currentLineText !== undefined && hashLine(currentLineText) !== decision.lineHash) {
    return { kind: 'stale', decision };
  }
  if (decision.kind === 'accept') {
    return { kind: 'accepted', decision };
  }
  if (line.gap === 0) {
    return { kind: 'fixed', decision };
  }
  return { kind: 'fix-pending', decision, stillShortBy: line.gap, moved: line.gap < decision.gapAtDecision };
}

/**
 * What a function-level fix decision means for a function as it stands
 * now. "Short" here is ways through above the limit, not tests.
 */
export function functionDecisionState(decision: Decision | undefined, fn: FunctionComplexity, limit: number, currentStartLineText: string | undefined): DecisionState {
  if (!decision || decision.scope !== 'function') {
    return { kind: 'none' };
  }
  if (currentStartLineText !== undefined && hashLine(currentStartLineText) !== decision.lineHash) {
    return { kind: 'stale', decision };
  }
  const over = fn.complexity - limit;
  if (over <= 0) {
    return { kind: 'fixed', decision };
  }
  return { kind: 'fix-pending', decision, stillShortBy: over, moved: over < decision.gapAtDecision };
}

export interface DecidedFunction {
  path: string;
  fn: FunctionComplexity;
  state: DecisionState;
}

/** Every function that carries a decision, with what it means now. */
export function applyFunctionDecisions(result: AnalysisResult, file: DecisionFile, readLine: (path: string, line: number) => string | undefined): DecidedFunction[] {
  const out: DecidedFunction[] = [];
  const limit = result.summary.thresholds.maxFunctionComplexity;
  for (const f of result.files) {
    for (const fn of f.functions) {
      const decision = file.decisions.find((d) => d.scope === 'function' && d.path === f.path && d.line === fn.startLine);
      if (decision) {
        out.push({ path: f.path, fn, state: functionDecisionState(decision, fn, limit, readLine(f.path, fn.startLine)) });
      }
    }
  }
  return out;
}

export interface DecidedLine {
  path: string;
  line: LineResult;
  state: DecisionState;
}

/**
 * Joins a result with the decision file. Returns every shortfall with its
 * decision state, so callers can split "open" from "accepted" without
 * re-deriving the rule.
 */
export function applyDecisions(result: AnalysisResult, file: DecisionFile, readLine: (path: string, line: number) => string | undefined): DecidedLine[] {
  const out: DecidedLine[] = [];
  for (const f of result.files) {
    for (const line of f.lines) {
      if (line.status !== 'short' && line.status !== 'untested') {
        continue;
      }
      const decision = findDecision(file, f.path, line.line);
      out.push({ path: f.path, line, state: decisionState(decision, line, decision ? readLine(f.path, line.line) : undefined) });
    }
  }
  return out;
}

/** Shortfalls a person still has to decide on, worst first by the engine's ranking. */
export function openShortfalls(decided: DecidedLine[], ranking: AnalysisResult['shortfalls']): DecidedLine[] {
  const key = (p: string, l: number): string => `${p}:${l}`;
  const byKey = new Map(decided.map((d) => [key(d.path, d.line.line), d]));
  const out: DecidedLine[] = [];
  for (const s of ranking) {
    const d = byKey.get(key(s.path, s.line));
    if (d && d.state.kind !== 'accepted') {
      out.push(d);
    }
  }
  return out;
}
