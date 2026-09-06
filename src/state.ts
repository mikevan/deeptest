/**
 * The one place results live. Everything in the UI reads from here and
 * listens for changes; the runner writes here.
 */
import * as vscode from 'vscode';
import { DecidedFunction, DecidedLine, DecisionFile, DecisionState, applyDecisions, applyFunctionDecisions, emptyDecisionFile } from './decisions/decisions';
import { AnalysisResult, FileResult } from './engine/types';
import { TestRunSummary } from './languages/types';

export type Phase = 'idle' | 'running' | 'results' | 'noTests' | 'error';

export interface RunInfo {
  tests: TestRunSummary;
  environment: string;
  language: string;
  testsPath: string;
  finishedAt: Date;
  durationMs: number;
}

export class ResultState implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  phase: Phase = 'idle';
  result: AnalysisResult | undefined;
  run: RunInfo | undefined;
  message = '';
  /** Files edited since the last run. Their overlay is still shown but flagged. */
  readonly stale = new Set<string>();
  overlayVisible = true;

  /** Human decisions, loaded from .deeptest/decisions.json before each run and after each change. */
  decisions: DecisionFile = emptyDecisionFile();
  /** Every shortfall joined with its decision state, recomputed whenever results or decisions change. */
  decided: DecidedLine[] = [];
  /** Functions that carry a fix decision, with what it means now. */
  decidedFunctions: DecidedFunction[] = [];
  private readLine: (path: string, line: number) => string | undefined = () => undefined;

  private readonly byPath = new Map<string, FileResult>();

  setDecisions(decisions: DecisionFile, readLine: (path: string, line: number) => string | undefined): void {
    this.decisions = decisions;
    this.readLine = readLine;
    this.recomputeDecided();
    this.fire();
  }

  private recomputeDecided(): void {
    this.decided = this.result ? applyDecisions(this.result, this.decisions, this.readLine) : [];
    this.decidedFunctions = this.result ? applyFunctionDecisions(this.result, this.decisions, this.readLine) : [];
  }

  functionDecisionFor(path: string, startLine: number): DecisionState {
    return this.decidedFunctions.find((d) => d.path === path && d.fn.startLine === startLine)?.state ?? { kind: 'none' };
  }

  decisionFor(path: string, line: number): DecisionState {
    return this.decided.find((d) => d.path === path && d.line.line === line)?.state ?? { kind: 'none' };
  }

  setRunning(): void {
    this.phase = 'running';
    this.message = '';
    this.fire();
  }

  setResults(result: AnalysisResult, run: RunInfo): void {
    this.phase = 'results';
    this.result = result;
    this.run = run;
    this.stale.clear();
    this.byPath.clear();
    for (const file of result.files) {
      this.byPath.set(file.path, file);
    }
    this.recomputeDecided();
    this.fire();
  }

  setNoTests(message: string): void {
    this.phase = 'noTests';
    this.message = message;
    this.fire();
  }

  setError(message: string): void {
    this.phase = 'error';
    this.message = message;
    this.fire();
  }

  clear(): void {
    this.phase = 'idle';
    this.result = undefined;
    this.run = undefined;
    this.message = '';
    this.stale.clear();
    this.byPath.clear();
    this.decided = [];
    this.decidedFunctions = [];
    this.fire();
  }

  fileResult(relativePath: string): FileResult | undefined {
    return this.byPath.get(relativePath);
  }

  markStale(relativePath: string): void {
    if (this.byPath.has(relativePath) && !this.stale.has(relativePath)) {
      this.stale.add(relativePath);
      this.fire();
    }
  }

  toggleOverlay(): void {
    this.overlayVisible = !this.overlayVisible;
    this.fire();
  }

  fire(): void {
    void vscode.commands.executeCommand('setContext', 'deeptest.hasResults', this.phase === 'results');
    void vscode.commands.executeCommand('setContext', 'deeptest.phase', this.phase);
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
