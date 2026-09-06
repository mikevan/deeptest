/**
 * The per-line overlay. Four scored states plus unreachable, each with a
 * background tint, a gutter glyph that works without colour, an inline
 * "tests / bar" readout, and a hover that names the tests.
 *
 * Decorations are attached to the document with ClosedClosed range behaviour
 * and VS Code moves them as the user edits, so the overlay stays put while
 * typing. Edited files are flagged stale until the next run.
 */
import * as vscode from 'vscode';
import { DeepTestConfig } from '../config';
import { LineResult, LineStatus } from '../engine/types';
import { describeReach } from '../report/plain';
import { ResultState } from '../state';
import { relativePathOf } from './paths';
import { PRODUCT, hoverText, lineCaption } from './words';

const GLYPHS: Record<LineStatus, { path: string; stroke: string; title: string }> = {
  over: { path: 'M2 8l3 3 5-6M6 8l3 3 5-6', stroke: '#2ea043', title: 'Over the bar' },
  met: { path: 'M3 8l3.5 3.5L13 5', stroke: '#3fb950', title: 'Met the bar' },
  short: { path: 'M8 2.5L14 13H2z', stroke: '#d29922', title: 'Short of the bar' },
  untested: { path: 'M4 4l8 8M12 4l-8 8', stroke: '#f85149', title: 'Untested' },
  unreachable: { path: 'M3 8h10', stroke: '#8b949e', title: 'Unreachable' },
  declaration: { path: '', stroke: 'transparent', title: 'Declaration' },
};

function gutterIcon(status: LineStatus): vscode.Uri {
  const g = GLYPHS[status];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="${g.path}" fill="none" stroke="${g.stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

export class OverlayManager implements vscode.Disposable {
  private types = new Map<LineStatus, vscode.TextEditorDecorationType>();
  private staleType: vscode.TextEditorDecorationType | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly state: ResultState, private config: DeepTestConfig) {
    this.createTypes();
    this.disposables.push(
      state.onDidChange(() => this.refreshAll()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const rel = relativePathOf(e.document.uri);
        if (rel && e.contentChanges.length > 0) {
          state.markStale(rel);
        }
      }),
    );
  }

  updateConfig(config: DeepTestConfig): void {
    this.config = config;
    this.createTypes();
    this.refreshAll();
  }

  private createTypes(): void {
    for (const type of this.types.values()) {
      type.dispose();
    }
    this.staleType?.dispose();
    this.types.clear();
    const colors = this.config.colors;
    const make = (status: LineStatus, background: string | undefined): vscode.TextEditorDecorationType =>
      vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: background,
        gutterIconPath: GLYPHS[status].path ? gutterIcon(status) : undefined,
        gutterIconSize: 'contain',
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        overviewRulerColor: background,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
      });
    this.types.set('over', make('over', colors.over));
    this.types.set('met', make('met', colors.met));
    this.types.set('short', make('short', colors.short));
    this.types.set('untested', make('untested', colors.untested));
    this.types.set('unreachable', make('unreachable', colors.unreachable));
    this.types.set('declaration', make('declaration', undefined));
    this.staleType = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: `  ${PRODUCT}: this file changed since the last check`,
        color: new vscode.ThemeColor('descriptionForeground'),
        fontStyle: 'italic',
      },
      isWholeLine: true,
    });
  }

  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.refresh(editor);
    }
  }

  private clearEditor(editor: vscode.TextEditor): void {
    for (const type of this.types.values()) {
      editor.setDecorations(type, []);
    }
    if (this.staleType) {
      editor.setDecorations(this.staleType, []);
    }
  }

  refresh(editor: vscode.TextEditor): void {
    const rel = relativePathOf(editor.document.uri);
    const file = rel ? this.state.fileResult(rel) : undefined;
    if (!file || !this.state.overlayVisible || !this.config.overlay.enabled || this.state.phase !== 'results') {
      this.clearEditor(editor);
      return;
    }
    const buckets = new Map<LineStatus, vscode.DecorationOptions[]>();
    for (const status of this.types.keys()) {
      buckets.set(status, []);
    }
    const lineCount = editor.document.lineCount;
    for (const line of file.lines) {
      if (line.line < 1 || line.line > lineCount) {
        continue;
      }
      const textLine = editor.document.lineAt(line.line - 1);
      buckets.get(line.status)?.push({
        range: textLine.range,
        hoverMessage: this.hover(line, file.path),
        renderOptions: this.config.overlay.showInlineNumbers ? { after: this.inline(line) } : undefined,
      });
    }
    for (const [status, options] of buckets) {
      const type = this.types.get(status);
      if (type) {
        editor.setDecorations(type, options);
      }
    }
    if (this.staleType) {
      const stale = rel && this.state.stale.has(rel);
      editor.setDecorations(this.staleType, stale ? [{ range: editor.document.lineAt(0).range }] : []);
    }
  }

  private inline(line: LineResult): vscode.ThemableDecorationAttachmentRenderOptions | undefined {
    const text = lineCaption(line, { showNumbers: this.config.showNumbers });
    if (!text) {
      return undefined;
    }
    return {
      contentText: `  ${text}`,
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      margin: '0 0 0 2em',
      fontStyle: 'italic',
    };
  }

  private hover(line: LineResult, filePath: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    const reach = line.gap > 0 && line.route.total > 0 ? describeReach(line.route) : '';
    md.appendMarkdown(hoverText(line, filePath, this.state.decisionFor(filePath, line.line), reach, { showNumbers: this.config.showNumbers }));
    if (line.gap > 0) {
      const args = encodeURIComponent(JSON.stringify([filePath, line.line]));
      md.appendMarkdown(`\n\n[Decide: fix, accept, or leave](command:deeptest.decide?${args})  ·  [Full report](command:deeptest.report)`);
    }
    return md;
  }

  dispose(): void {
    for (const type of this.types.values()) {
      type.dispose();
    }
    this.staleType?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
