/**
 * Status bar: the worst shortfall in the active file. Never a percentage.
 */
import * as vscode from 'vscode';
import { ResultState } from '../state';
import { relativePathOf } from './paths';
import { PRODUCT, badge } from './words';

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly state: ResultState) {
    this.item = vscode.window.createStatusBarItem('deeptest', vscode.StatusBarAlignment.Left, 50);
    this.item.name = 'DeepTest';
    this.item.command = 'workbench.view.extension.deeptest';
    this.disposables.push(
      state.onDidChange(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
    );
    this.refresh();
  }

  refresh(): void {
    if (this.state.phase === 'running') {
      this.item.text = `$(sync~spin) ${PRODUCT}: checking`;
      this.item.tooltip = 'Running the tests and watching which lines they reach';
      this.item.show();
      return;
    }
    if (this.state.phase !== 'results' || !this.state.result) {
      this.item.hide();
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const rel = editor ? relativePathOf(editor.document.uri) : undefined;
    const file = rel ? this.state.fileResult(rel) : undefined;
    if (!file) {
      const total = this.state.decided.filter((d) => d.state.kind !== 'accepted').length;
      this.item.text = total === 0 ? `$(pass) ${PRODUCT}: every line has its tests` : `$(warning) ${PRODUCT}: ${total} line${total === 1 ? '' : 's'} to look at`;
      this.item.tooltip = 'Open a checked file to see its worst line';
      this.item.show();
      return;
    }
    const open = file.lines.filter((l) => l.gap > 0 && this.state.decisionFor(file.path, l.line).kind !== 'accepted');
    const worst = open.sort((a, b) => b.gap - a.gap || b.bar - a.bar || a.line - b.line)[0];
    const stale = rel && this.state.stale.has(rel) ? ' (file changed)' : '';
    if (!worst) {
      this.item.text = `$(pass) ${PRODUCT}: this file is fine${stale}`;
      this.item.tooltip = file.unreachableLines.length ? `${file.unreachableLines.length} line(s) can never run` : 'Every line has the tests it needs';
    } else {
      this.item.text = `$(warning) ${PRODUCT}: line ${worst.line} ${badge(worst)}${stale}`;
      this.item.tooltip = `${open.length} line(s) in this file still need your decision`;
    }
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
