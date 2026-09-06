/**
 * Same extension, a JavaScript workspace with Jest. Proves the contract:
 * nothing above it changed between the Python run and this one.
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
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'no workspace folder');
  fs.rmSync(path.join(folder.uri.fsPath, '.deeptest'), { recursive: true, force: true });

  const cfg = vscode.workspace.getConfiguration('deeptest', folder);
  await cfg.update('language', 'typescript', vscode.ConfigurationTarget.Workspace);
  await cfg.update('testsPath', 'test', vscode.ConfigurationTarget.Workspace);
  await cfg.update('sourceRoot', 'src', vscode.ConfigurationTarget.Workspace);
  await cfg.update('languageSettings', { typescript: { runner: 'auto', extraArgs: '' } }, vscode.ConfigurationTarget.Workspace);

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'src', 'calc.js'));
  await vscode.window.showTextDocument(doc);

  await api.run();
  await waitFor(() => api.state.phase === 'results' || api.state.phase === 'error', 120_000, 'run to finish');
  assert.equal(api.state.phase, 'results', `run ended in phase ${api.state.phase}: ${api.state.message}`);
  assert.equal(api.state.run?.tests.passed, 3);
  assert.equal(api.state.run?.language, 'TypeScript / JavaScript');

  const calc = api.state.result?.files.find((f) => f.path === 'src/calc.js');
  assert.ok(calc, 'calc.js not measured');
  const byLine = new Map(calc.lines.map((l) => [l.line, l.status]));
  assert.equal(byLine.get(2), 'over');
  assert.equal(byLine.get(3), 'met');
  assert.equal(byLine.get(4), 'short');
  assert.equal(byLine.get(7), 'untested');
  assert.equal(byLine.get(22), 'unreachable');
  assert.equal(byLine.get(25), 'declaration');

  const report = api.report();
  assert.ok(report);
  assert.equal(report.detailed[0].line, 7);
  assert.equal(report.detailed[0].route.total, 3);
  assert.match(report.detailed[0].reach, /stop at: the check `x > 0` is false/);

  if (process.env.DEEPTEST_SCREENSHOT_PAUSE_MS) {
    await vscode.commands.executeCommand('deeptest.sidebar.focus');
    await vscode.window.showTextDocument(doc, { preserveFocus: true });
    await new Promise((r) => setTimeout(r, Number(process.env.DEEPTEST_SCREENSHOT_PAUSE_MS)));
  }

  await cfg.update('testsPath', undefined, vscode.ConfigurationTarget.Workspace);
  await cfg.update('language', undefined, vscode.ConfigurationTarget.Workspace);
  await cfg.update('sourceRoot', undefined, vscode.ConfigurationTarget.Workspace);
  await cfg.update('languageSettings', undefined, vscode.ConfigurationTarget.Workspace);
  fs.rmSync(path.join(folder.uri.fsPath, '.deeptest'), { recursive: true, force: true });
  console.log('DeepTest integration suite (TypeScript / JavaScript) passed');
}
