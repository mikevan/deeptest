/**
 * Runs inside the Extension Development Host against test/fixtures/pyproject.
 * No mocha: a plain async function that throws on failure is all the test
 * runner needs, and one fewer dependency for anyone who clones this.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DeepTestApi } from '../../src/extension';

async function waitFor(check: () => boolean, ms: number, what: string): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('prs.deeptest');
  assert.ok(ext, 'extension not found');
  const api = (await ext.activate()) as DeepTestApi;
  assert.ok(api?.state, 'activate returned no api');

  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'no workspace folder');
  fs.rmSync(path.join(folder.uri.fsPath, '.deeptest'), { recursive: true, force: true });
  const cfg = vscode.workspace.getConfiguration('deeptest', folder);

  // First run with nothing configured opens the configuration screen instead of running.
  await cfg.update('language', undefined, vscode.ConfigurationTarget.Workspace);
  await api.run();
  const findConfigTab = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === 'DeepTest setup');
  await waitFor(() => findConfigTab() !== undefined, 5_000, 'configuration screen to open on first run');
  const configTab = findConfigTab()!;
  assert.equal(api.state.phase, 'idle');
  await vscode.window.tabGroups.close(configTab);

  await cfg.update('language', 'python', vscode.ConfigurationTarget.Workspace);
  await cfg.update('testsPath', 'tests', vscode.ConfigurationTarget.Workspace);
  await cfg.update('sourceRoot', 'src', vscode.ConfigurationTarget.Workspace);
  await cfg.update('languageSettings', { python: { interpreter: process.env.DEEPTEST_PYTHON ?? 'python3', pytestArgs: '' } }, vscode.ConfigurationTarget.Workspace);

  // Open the file under test so the overlay has an editor to paint.
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'src', 'calc.py'));
  await vscode.window.showTextDocument(doc);

  await api.run();
  await waitFor(() => api.state.phase === 'results' || api.state.phase === 'error', 60_000, 'run to finish');
  assert.equal(api.state.phase, 'results', `run ended in phase ${api.state.phase}: ${api.state.message}`);

  const result = api.state.result;
  assert.ok(result);
  assert.equal(api.state.run?.tests.passed, 3);
  const calc = result.files.find((f) => f.path === 'src/calc.py');
  assert.ok(calc, 'calc.py not measured');
  const byLine = new Map(calc.lines.map((l) => [l.line, l.status]));
  assert.equal(byLine.get(2), 'over');
  assert.equal(byLine.get(3), 'met');
  assert.equal(byLine.get(4), 'short');
  assert.equal(byLine.get(6), 'untested');
  assert.equal(byLine.get(15), 'unreachable');
  assert.equal(result.shortfalls[0].line, 6);

  // Sidebar tree renders the summary.
  const tree = await vscode.commands.executeCommand('deeptest.sidebar.focus').then(() => true, () => false);
  assert.ok(tree, 'sidebar view could not be focused');

  if (process.env.DEEPTEST_SCREENSHOT_PAUSE_MS) {
    // Leave the window up so a screenshot can be taken from outside.
    await vscode.window.showTextDocument(doc, { preserveFocus: true });
    const hover = new vscode.Position(5, 8);
    vscode.window.activeTextEditor!.selection = new vscode.Selection(hover, hover);
    await new Promise((r) => setTimeout(r, Number(process.env.DEEPTEST_SCREENSHOT_PAUSE_MS)));
    if (process.env.DEEPTEST_SCREENSHOT_REPORT) {
      await vscode.commands.executeCommand('deeptest.report');
      await new Promise((r) => setTimeout(r, Number(process.env.DEEPTEST_SCREENSHOT_PAUSE_MS)));
      await vscode.window.showTextDocument(doc, { preserveFocus: false });
    }
    if (process.env.DEEPTEST_SCREENSHOT_CONFIG) {
      await vscode.commands.executeCommand('deeptest.configure');
      await new Promise((r) => setTimeout(r, Number(process.env.DEEPTEST_SCREENSHOT_PAUSE_MS)));
      await vscode.window.showTextDocument(doc, { preserveFocus: false });
    }
  }

  // Editing marks the file stale, overlay stays.
  const editor = vscode.window.activeTextEditor;
  assert.ok(editor);
  await editor.edit((b) => b.insert(new vscode.Position(0, 0), '# edited\n'));
  await waitFor(() => api.state.stale.has('src/calc.py'), 5_000, 'stale flag');

  // Open a line from the ranked list.
  await vscode.commands.executeCommand('deeptest.openLine', 'src/calc.py', 6);
  assert.equal(vscode.window.activeTextEditor?.selection.active.line, 5);

  // Routes: line 6 is guarded by three decisions and no test gets past the first.
  const line6 = calc.lines.find((l) => l.line === 6)!;
  assert.equal(line6.route.total, 3);
  assert.equal(line6.route.reached, 0);

  // Report: worst first, five in full by default, the fixture has four shortfalls.
  const report = api.report();
  assert.ok(report, 'no report model');
  assert.equal(report.ready, false);
  assert.deepEqual(report.detailed.map((d) => d.line), [6, 7, 4, 8]);
  assert.equal(report.rest.length, 0);
  assert.match(report.detailed[0].reach, /stop at: the check `x > 0` is false/);
  await vscode.commands.executeCommand('deeptest.report');
  await waitFor(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.label === 'DeepTest report'), 5_000, 'report panel');

  // Put the buffer back as it is on disk; a decision is pinned to the line's text.
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await waitFor(() => !doc.isDirty, 5_000, 'revert');

  // Decisions: accepting a line takes it out of the open list and the report; the file on disk records it.
  const decisionsFile = path.join(folder.uri.fsPath, '.deeptest', 'decisions.json');
  fs.rmSync(decisionsFile, { force: true });
  const { recordDecision, emptyDecisionFile, hashLine, serializeDecisionFile } = await import('../../src/decisions/decisions');
  const lineText = fs.readFileSync(path.join(folder.uri.fsPath, 'src', 'calc.py'), 'utf8').split(/\r?\n/)[7 - 1];
  fs.mkdirSync(path.dirname(decisionsFile), { recursive: true });
  fs.writeFileSync(
    decisionsFile,
    serializeDecisionFile(
      recordDecision(emptyDecisionFile(), {
        path: 'src/calc.py', line: 7, lineHash: hashLine(lineText), kind: 'accept', reason: 'integration suite says so', by: 'suite', at: new Date().toISOString(), gapAtDecision: 3,
      }),
    ),
  );
  await api.run();
  await waitFor(() => api.state.phase === 'results', 60_000, 'second run');
  assert.equal(api.state.decisionFor('src/calc.py', 7).kind, 'accepted');
  const report2 = api.report()!;
  assert.deepEqual(report2.detailed.map((d) => d.line), [6, 4, 8]);
  assert.deepEqual(report2.accepted.map((d) => d.line), [7]);

  // Undo through the command; the decision file empties.
  await vscode.commands.executeCommand('deeptest.undoDecision', { path: 'src/calc.py', line: 7 });
  assert.equal(api.state.decisionFor('src/calc.py', 7).kind, 'none');
  assert.equal(JSON.parse(fs.readFileSync(decisionsFile, 'utf8')).decisions.length, 0);

  // Fix: records the decision and puts the brief on the clipboard. No retry, no auto-accept.
  await vscode.commands.executeCommand('deeptest.fix', { path: 'src/calc.py', line: 6 });
  await waitFor(() => api.state.decisionFor('src/calc.py', 6).kind === 'fix-pending', 5_000, 'fix decision');
  const clip = await vscode.env.clipboard.readText();
  assert.match(clip, /make src\/calc\.py line 6 meet its test bar/);
  assert.match(clip, /will not accept the fix on your behalf/);
  fs.rmSync(decisionsFile, { force: true });

  // No tests found path.
  await cfg.update('testsPath', 'src', vscode.ConfigurationTarget.Workspace);
  await api.run();
  await waitFor(() => api.state.phase === 'noTests', 10_000, 'noTests phase');

  // Clean the fixture's scratch output and settings.
  await cfg.update('testsPath', undefined, vscode.ConfigurationTarget.Workspace);
  await cfg.update('language', undefined, vscode.ConfigurationTarget.Workspace);
  await cfg.update('sourceRoot', undefined, vscode.ConfigurationTarget.Workspace);
  await cfg.update('languageSettings', undefined, vscode.ConfigurationTarget.Workspace);
  fs.rmSync(path.join(folder.uri.fsPath, '.deeptest'), { recursive: true, force: true });
  console.log('DeepTest integration suite passed');
}
