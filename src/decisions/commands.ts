/**
 * The three choices on a shortfall, and the hand-off. The person picks;
 * the tool records and hands over. It never picks, and it never retries.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DeepTestConfig } from '../config';
import { KEEPSAFE_EXTENSION_ID, keepSafeInstalled, offerCheckpoint } from '../keepsafe';
import { UNTANGLEIT_EXTENSION_ID, handToUntangleIt, untangleItInstalled } from '../untangleit';
import { functionFixRoute, refactorChoiceDescription, untangleFailedSentence, untangleSentSentence } from '../ui/words';
import { FunctionFixMode, buildBrief, buildFunctionBrief } from '../report/brief';
import { ResultState } from '../state';
import { hashLine, recordDecision, removeDecision } from './decisions';
import { lineReader, loadDecisions, saveDecisions, whoAmI } from './store';

export interface DecisionDeps {
  state: ResultState;
  output: vscode.OutputChannel;
  folder: () => vscode.WorkspaceFolder | undefined;
  config: () => DeepTestConfig;
}

function reload(deps: DecisionDeps, folder: vscode.WorkspaceFolder): void {
  deps.state.setDecisions(loadDecisions(folder, (l) => deps.output.appendLine(l)), lineReader(folder));
}

export function briefFor(deps: DecisionDeps, folder: vscode.WorkspaceFolder, relativePath: string, lineNo: number): string | undefined {
  const file = deps.state.fileResult(relativePath);
  const line = file?.lines.find((l) => l.line === lineNo);
  if (!file || !line) {
    return undefined;
  }
  const read = lineReader(folder);
  const context: Array<{ line: number; text: string }> = [];
  for (let n = Math.max(1, lineNo - 6); n <= lineNo + 3; n += 1) {
    const text = read(relativePath, n);
    if (text !== undefined) {
      context.push({ line: n, text });
    }
  }
  return buildBrief({
    path: relativePath,
    line,
    file,
    context,
    testsPath: deps.config().testsPath,
    language: deps.state.run?.language ?? deps.config().language,
  });
}

/**
 * Hands the brief to whatever assistant the editor has. Tries the built-in
 * chat surface first; whether or not that exists, the brief lands on the
 * clipboard so it can be pasted anywhere. DeepTest carries no model and
 * no key of its own.
 */
async function handOff(brief: string): Promise<string> {
  await vscode.env.clipboard.writeText(brief);
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: brief });
    return 'The brief is in the editor chat and on your clipboard.';
  } catch {
    return 'The brief is on your clipboard. Paste it into the assistant you use.';
  }
}

interface GateResult {
  proceed: boolean;
  checkpointNote: string;
}

/**
 * The two gates in front of every hand-off to an AI, in this order: the
 * KeepSafe checkpoint offer (only when KeepSafe is installed), because it
 * is the undo; then the decision itself, modal, in one sentence that says
 * what is about to happen. Nothing is recorded and nothing is sent until
 * "Yes, send it". `task` completes the sentence "asking it to ...".
 */
async function gates(deps: DecisionDeps, task: string, logName: string): Promise<GateResult> {
  let checkpointNote = '';
  const installed = keepSafeInstalled();
  const offer = deps.config().keepSafe.offerCheckpoint;
  deps.output.appendLine(`KeepSafe (${KEEPSAFE_EXTENSION_ID}) is ${installed ? 'installed' : 'not installed'}; the checkpoint offer is ${offer ? 'on' : 'off'}.`);
  if (installed && offer) {
    const outcome = await offerCheckpoint((l) => deps.output.appendLine(l));
    if (outcome === 'failed') {
      void vscode.window.showWarningMessage('KeepSafe could not create the checkpoint. Nothing was sent to the assistant. Press "Fix this" again when KeepSafe is ready, or press "Skip" next time to go on without one.');
      return { proceed: false, checkpointNote };
    }
    checkpointNote = outcome === 'created' ? ' A KeepSafe checkpoint was taken first; "KeepSafe: Restore Latest Checkpoint" undoes everything the assistant changes.' : '';
  }
  // The integration suite cannot press a modal button, so the harness sets
  // this variable in the test host only. Nothing else sets it, and the
  // check is on the process environment, not on a setting a user could flip.
  const confirmed =
    process.env.DEEPTEST_TEST_HOST === '1'
      ? 'Yes, send it'
      : await vscode.window.showWarningMessage(
          'Send this to your AI assistant?',
          {
            modal: true,
            detail: `DeepTest will hand your assistant a brief asking it to ${task}. The assistant may change your code and your tests. DeepTest will measure the result when you press "Check my code again"; it will not accept the result for you.`,
          },
          'Yes, send it',
        );
  if (confirmed !== 'Yes, send it') {
    deps.output.appendLine(`Fix for ${logName} not sent; the confirmation was declined.`);
    return { proceed: false, checkpointNote };
  }
  return { proceed: true, checkpointNote };
}

export async function fixShortfall(deps: DecisionDeps, relativePath: string, lineNo: number): Promise<void> {
  const folder = deps.folder();
  if (!folder) {
    return;
  }
  const brief = briefFor(deps, folder, relativePath, lineNo);
  const line = deps.state.fileResult(relativePath)?.lines.find((l) => l.line === lineNo);
  if (!brief || !line) {
    void vscode.window.showErrorMessage('Check your code first, and then decide about its lines.');
    return;
  }
  const gate = await gates(deps, `add tests until ${path.basename(relativePath)} line ${lineNo} is reached`, `${relativePath}:${lineNo}`);
  if (!gate.proceed) {
    return;
  }
  const checkpointNote = gate.checkpointNote;
  const read = lineReader(folder);
  const decisions = recordDecision(loadDecisions(folder), {
    path: relativePath,
    line: lineNo,
    lineHash: hashLine(read(relativePath, lineNo) ?? ''),
    kind: 'fix',
    reason: '',
    by: whoAmI(),
    at: new Date().toISOString(),
    gapAtDecision: line.gap,
  });
  saveDecisions(folder, decisions);
  reload(deps, folder);
  const how = await handOff(brief);
  deps.output.appendLine(`Fix requested for ${relativePath}:${lineNo}. ${how}`);
  void vscode.window.showInformationMessage(`${how} When the assistant is done, press "Check my code again". The line stays red until it has the tests it needs.${checkpointNote}`);
}

/** How many lines of a function the brief quotes before cutting. */
const FUNCTION_SOURCE_LIMIT = 120;

/**
 * "Fix this" on a function that is harder to test than the limit. The
 * person picks which of the two honest answers they want, then the same
 * gates and hand-off as for a line. The decision is pinned to the line the
 * function starts on.
 */
export async function fixFunction(deps: DecisionDeps, relativePath: string, startLine: number): Promise<void> {
  const folder = deps.folder();
  if (!folder) {
    return;
  }
  const file = deps.state.fileResult(relativePath);
  const fn = file?.functions.find((f) => f.startLine === startLine);
  const limit = deps.state.result?.summary.thresholds.maxFunctionComplexity;
  if (!file || !fn || limit === undefined) {
    void vscode.window.showErrorMessage('Check your code first, and then decide about its functions.');
    return;
  }
  const over = fn.complexity - limit;
  const untangler = untangleItInstalled();
  deps.output.appendLine(`UntangleIt (${UNTANGLEIT_EXTENSION_ID}) is ${untangler ? 'installed' : 'not installed'}.`);
  const pick = await vscode.window.showQuickPick<vscode.QuickPickItem & { mode: FunctionFixMode }>(
    [
      {
        label: 'Break it into smaller pieces',
        description: refactorChoiceDescription(fn.name, limit, untangler),
        mode: 'refactor',
      },
      {
        label: 'Test every way through it as it is',
        description: `Leave ${fn.name}() alone and write tests for each of its ${fn.complexity} ways through.`,
        mode: 'test',
      },
    ],
    {
      title: `${fn.name}() has ${fn.complexity} ways through it; your limit is ${limit}.`,
      placeHolder: 'What should the assistant do? This is your call.',
    },
  );
  if (!pick) {
    return;
  }
  if (functionFixRoute(pick.mode, untangler) === 'untangleit') {
    // UntangleIt runs its own gates (the KeepSafe offer, then its modal)
    // and keeps its own record of the run, so DeepTest records no decision
    // here: the person has not yet said yes to anything. DeepTest judges
    // the pieces on the next check like any other change.
    const outcome = await handToUntangleIt(relativePath, fn.startLine, (l) => deps.output.appendLine(l));
    if (outcome === 'sent') {
      void vscode.window.showInformationMessage(untangleSentSentence(fn.name));
    } else {
      void vscode.window.showWarningMessage(untangleFailedSentence(fn.name));
    }
    return;
  }
  const task = pick.mode === 'refactor' ? `break ${fn.name}() into pieces that each have at most ${limit} ways through, without changing what it does` : `write tests for every way through ${fn.name}()`;
  const gate = await gates(deps, task, `${relativePath}:${fn.name}()`);
  if (!gate.proceed) {
    return;
  }
  const read = lineReader(folder);
  const source: Array<{ line: number; text: string }> = [];
  const last = Math.min(fn.endLine, fn.startLine + FUNCTION_SOURCE_LIMIT - 1);
  for (let n = fn.startLine; n <= last; n += 1) {
    const text = read(relativePath, n);
    if (text !== undefined) {
      source.push({ line: n, text });
    }
  }
  const brief = buildFunctionBrief({
    path: relativePath,
    fn,
    file,
    source,
    sourceTruncated: last < fn.endLine,
    limit,
    testsPath: deps.config().testsPath,
    language: deps.state.run?.language ?? deps.config().language,
    mode: pick.mode,
  });
  const decisions = recordDecision(loadDecisions(folder), {
    path: relativePath,
    line: fn.startLine,
    lineHash: hashLine(read(relativePath, fn.startLine) ?? ''),
    kind: 'fix',
    reason: pick.mode === 'refactor' ? `refactor to at most ${limit} ways through` : 'tests for every way through',
    by: whoAmI(),
    at: new Date().toISOString(),
    gapAtDecision: over,
    scope: 'function',
    functionName: fn.name,
  });
  saveDecisions(folder, decisions);
  reload(deps, folder);
  const how = await handOff(brief);
  deps.output.appendLine(`Fix requested for ${relativePath} ${fn.name}() (${pick.mode}). ${how}`);
  void vscode.window.showInformationMessage(`${how} When the assistant is done, press "Check my code again". DeepTest will measure ${fn.name}() again and say whether it is within your limit.${gate.checkpointNote}`);
}

export async function undoFunctionDecision(deps: DecisionDeps, relativePath: string, startLine: number): Promise<void> {
  const folder = deps.folder();
  if (!folder) {
    return;
  }
  saveDecisions(folder, removeDecision(loadDecisions(folder), relativePath, startLine, 'function'));
  reload(deps, folder);
  deps.output.appendLine(`Function decision removed for ${relativePath}:${startLine}.`);
}

export async function acceptShortfall(deps: DecisionDeps, relativePath: string, lineNo: number): Promise<void> {
  const folder = deps.folder();
  if (!folder) {
    return;
  }
  const line = deps.state.fileResult(relativePath)?.lines.find((l) => l.line === lineNo);
  if (!line) {
    void vscode.window.showErrorMessage('Check your code first, and then decide about its lines.');
    return;
  }
  const reason = await vscode.window.showInputBox({
    title: `Accept ${path.basename(relativePath)} line ${lineNo} as it is`,
    prompt: 'Why is it acceptable for this line to keep fewer tests than it needs? Your name and the date will be recorded next to your answer.',
    placeHolder: 'For example: the nightly integration run exercises this path, and unit tests cannot reach it without a live device.',
    validateInput: (v) => (v.trim().length < 8 ? 'Please give a reason that someone else could read later.' : undefined),
  });
  if (!reason) {
    return;
  }
  const read = lineReader(folder);
  const decisions = recordDecision(loadDecisions(folder), {
    path: relativePath,
    line: lineNo,
    lineHash: hashLine(read(relativePath, lineNo) ?? ''),
    kind: 'accept',
    reason: reason.trim(),
    by: whoAmI(),
    at: new Date().toISOString(),
    gapAtDecision: line.gap,
  });
  saveDecisions(folder, decisions);
  reload(deps, folder);
  deps.output.appendLine(`Accepted ${relativePath}:${lineNo}: ${reason.trim()}`);
}

export async function undoDecision(deps: DecisionDeps, relativePath: string, lineNo: number): Promise<void> {
  const folder = deps.folder();
  if (!folder) {
    return;
  }
  saveDecisions(folder, removeDecision(loadDecisions(folder), relativePath, lineNo));
  reload(deps, folder);
  deps.output.appendLine(`Decision removed for ${relativePath}:${lineNo}.`);
}

/** The single entry point: Fix, Accept, or Leave. */
export async function decide(deps: DecisionDeps, relativePath: string, lineNo: number): Promise<void> {
  const line = deps.state.fileResult(relativePath)?.lines.find((l) => l.line === lineNo);
  if (!line) {
    void vscode.window.showErrorMessage('Check your code first, and then decide about its lines.');
    return;
  }
  const current = deps.state.decisionFor(relativePath, lineNo);
  const items: Array<vscode.QuickPickItem & { action: 'fix' | 'accept' | 'undo' | 'leave' }> = [
    { label: '$(tools) Fix this', description: 'Hand a precise brief to your assistant. DeepTest checks the result; it does not accept it for you.', action: 'fix' },
    { label: '$(check) Accept as it is', description: 'Record why this line may stay as it is, in your name.', action: 'accept' },
    { label: '$(clock) Leave for now', description: 'Decide later; the line stays in the list.', action: 'leave' },
  ];
  if (current.kind !== 'none') {
    items.push({ label: '$(discard) Remove the earlier decision', description: `Currently: ${current.kind}`, action: 'undo' });
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: `${relativePath} line ${lineNo}: ${line.status === 'untested' ? 'never tested' : `${line.density} of the ${line.bar} tests it needs`}`,
    placeHolder: 'This is your call. DeepTest reports; you decide.',
  });
  switch (pick?.action) {
    case 'fix':
      await fixShortfall(deps, relativePath, lineNo);
      break;
    case 'accept':
      await acceptShortfall(deps, relativePath, lineNo);
      break;
    case 'undo':
      await undoDecision(deps, relativePath, lineNo);
      break;
    default:
      break;
  }
}

export function loadDecisionsIntoState(deps: DecisionDeps): void {
  const folder = deps.folder();
  if (folder) {
    reload(deps, folder);
  }
}
