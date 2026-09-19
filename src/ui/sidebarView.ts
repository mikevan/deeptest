/**
 * The side panel, built for the person checking an AI's work.
 *
 * Top to bottom: the verdict, one button, what the tests say in three
 * lines, then the lines to look at, worst first, each with the choices
 * that belong to the human. No engineer's word on the front unless "Show
 * the numbers" is on.
 */
import * as vscode from 'vscode';
import { DecidedLine } from '../decisions/decisions';
import { LineResult } from '../engine/types';
import { describeReach } from '../report/plain';
import { ResultState } from '../state';
import { PRODUCT, Voice, badge, decisionSentence, findingSentence, functionDecisionSentence, summaryRows, testsSentence, verdict } from './words';

export interface SidebarMessage {
  type: 'run' | 'configure' | 'report' | 'output' | 'open' | 'fix' | 'accept' | 'undo' | 'decide' | 'fixFunction' | 'undoFunction' | 'toggleNumbers' | 'toggleOverlay';
  path?: string;
  line?: number;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s: string): string => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

export class SidebarView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'deeptest.sidebar';
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: ResultState,
    private readonly voice: () => Voice,
    private readonly readLine: () => (path: string, line: number) => string | undefined,
    private readonly onMessage: (msg: SidebarMessage) => void,
    /** The build number, shown at the foot of the panel so a screenshot says which build it came from. */
    private readonly version: string,
  ) {
    this.disposables.push(state.onDidChange(() => this.render()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // The panel header is the view container's title, set in package.json at
    // build time, and it already reads "DeepTest - Polyglot <version>".
    // Setting the view's own title here as well made VS Code render the two
    // joined by a colon, so the name and the build number each appeared twice.
    // One name, in one place.
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.onDidReceiveMessage((msg: SidebarMessage) => this.onMessage(msg));
    view.onDidDispose(() => {
      this.view = undefined;
    });
    this.render();
  }

  render(): void {
    if (this.view) {
      this.view.webview.html = this.html();
    }
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2);
    const voice = this.voice();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px 12px 24px; margin: 0; line-height: 1.4; }
  h2 { font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin: 18px 0 6px; font-weight: 600; }
  .verdict { padding: 10px 12px; border-radius: 6px; margin: 4px 0 10px; }
  .verdict.ready { background: rgba(46,160,67,0.16); border-left: 4px solid #2ea043; }
  .verdict.notready { background: rgba(248,81,73,0.16); border-left: 4px solid #f85149; }
  .verdict.neutral { background: var(--vscode-textBlockQuote-background); border-left: 4px solid var(--vscode-textBlockQuote-border); }
  .verdict strong { display: block; font-size: 1.05em; margin-bottom: 2px; }
  .muted { color: var(--vscode-descriptionForeground); }
  button { font-family: inherit; font-size: inherit; padding: 6px 12px; border: none; border-radius: 3px; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); width: 100%; padding: 9px; font-size: 1.05em; }
  button.small { padding: 3px 9px; font-size: 0.92em; }
  button.small.primary-ish { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { filter: brightness(1.12); }
  button:disabled { opacity: 0.6; cursor: default; }
  .links { display: flex; gap: 12px; margin: 8px 0 0; flex-wrap: wrap; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
  a:hover { text-decoration: underline; }
  .row { display: flex; gap: 8px; align-items: flex-start; margin: 5px 0; }
  .row .mark { flex: 0 0 1.2em; text-align: center; }
  .ok { color: #3fb950; } .bad { color: #f85149; } .warn { color: #d29922; }
  .card { border: 1px solid var(--vscode-widget-border, #444); border-radius: 6px; padding: 8px 10px; margin: 8px 0; }
  .card .where { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .card .where a { font-family: var(--vscode-editor-font-family); }
  .badge { font-size: 0.85em; padding: 1px 7px; border-radius: 10px; white-space: nowrap; }
  .badge.untested { background: rgba(248,81,73,0.22); }
  .badge.short { background: rgba(255,221,87,0.28); }
  .badge.unreachable { background: rgba(139,148,158,0.3); }
  pre { background: var(--vscode-textCodeBlock-background); padding: 5px 8px; border-radius: 3px; overflow-x: auto; margin: 6px 0; font-size: 0.92em; }
  code { font-family: var(--vscode-editor-font-family); }
  .actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  .decision { font-size: 0.92em; padding: 5px 8px; border-radius: 3px; margin-top: 6px; background: var(--vscode-textBlockQuote-background); }
  details { margin: 6px 0; }
  summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
  ul.rest { list-style: none; padding: 0; margin: 4px 0; }
  ul.rest li { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; border-bottom: 1px dashed var(--vscode-widget-border, #444); }
  label.switch { display: flex; align-items: center; gap: 6px; margin-top: 18px; color: var(--vscode-descriptionForeground); cursor: pointer; }
  .numbers { font-size: 0.88em; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
${this.body(voice)}
<p class="numbers" style="margin-top:24px">${PRODUCT} ${esc(this.version)}</p>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    e.preventDefault();
    vscode.postMessage({ type: el.getAttribute('data-act'), path: el.getAttribute('data-path') || undefined, line: el.getAttribute('data-line') ? Number(el.getAttribute('data-line')) : undefined });
  });
  const sw = document.getElementById('numbers');
  if (sw) sw.addEventListener('change', () => vscode.postMessage({ type: 'toggleNumbers' }));
  const ov = document.getElementById('overlay');
  if (ov) ov.addEventListener('change', () => vscode.postMessage({ type: 'toggleOverlay' }));
</script>
</body>
</html>`;
  }

  private body(voice: Voice): string {
    const s = this.state;
    switch (s.phase) {
      case 'running':
        return `<div class="verdict neutral"><strong>Checking your code.</strong><span class="muted">The tests are running, and DeepTest is watching which lines they reach.</span></div>
          <button class="primary" disabled>Checking.</button>
          <div class="links"><a data-act="output">Show the log</a></div>`;
      case 'noTests':
        return `<div class="verdict notready"><strong>No tests were found.</strong><span class="muted">DeepTest looked ${esc(s.message)}. Without tests there is nothing to check.</span></div>
          <button class="primary" data-act="configure">Tell me where the tests are</button>
          <div class="links"><a data-act="run">Try again</a><a data-act="output">Show the log</a></div>`;
      case 'error':
        return `<div class="verdict notready"><strong>The check did not finish.</strong><span class="muted">${esc(s.message)}</span></div>
          <button class="primary" data-act="run">Check my code again</button>
          <div class="links"><a data-act="output">Show the log</a><a data-act="configure">Change the setup</a></div>`;
      case 'results':
        return this.results(voice);
      default:
        return `<div class="verdict neutral"><strong>This project has not been checked yet.</strong><span class="muted">${PRODUCT} runs your tests, then shows which lines of code the tests never reached and how many tests each line needs.</span></div>
          <button class="primary" data-act="run">Check my code</button>
          <div class="links"><a data-act="configure">Tell me where the tests are</a></div>`;
    }
  }

  private results(voice: Voice): string {
    const s = this.state;
    const result = s.result;
    const run = s.run;
    if (!result || !run) {
      return '';
    }
    const open = s.decided.filter((d) => d.state.kind !== 'accepted');
    const accepted = s.decided.filter((d) => d.state.kind === 'accepted');
    const byKey = new Map(s.decided.map((d) => [`${d.path}:${d.line.line}`, d]));
    const ranked: DecidedLine[] = [];
    for (const sf of result.shortfalls) {
      const d = byKey.get(`${sf.path}:${sf.line}`);
      if (d && d.state.kind !== 'accepted') {
        ranked.push(d);
      }
    }
    const v = verdict(result.summary, run.tests, open.length, accepted.length);
    const rows = summaryRows(result.summary, voice);
    const stale = s.stale.size;
    const detailCount = Math.max(1, vscode.workspace.getConfiguration('deeptest').get<number>('report.detailedRoutes', 5));
    const top = ranked.slice(0, detailCount);
    const rest = ranked.slice(detailCount);
    const unreachable: Array<{ path: string; line: number }> = [];
    for (const f of result.files) {
      for (const l of f.unreachableLines) {
        unreachable.push({ path: f.path, line: l });
      }
    }
    const read = this.readLine();

    const parts: string[] = [];
    parts.push(`<div class="verdict ${v.ready ? 'ready' : 'notready'}"><strong>${esc(v.headline)}</strong><span class="muted">${esc(v.detail)}</span></div>`);
    parts.push(`<button class="primary" data-act="run">Check my code again</button>`);
    parts.push(`<div class="links"><a data-act="report">Full report</a><a data-act="configure">Change the setup</a><a data-act="output">Show the log</a></div>`);
    parts.push(`<p class="muted">${esc(testsSentence(run.tests))} in ${(run.durationMs / 1000).toFixed(1)} seconds, checked at ${esc(run.finishedAt.toLocaleTimeString())}.${stale ? ` <strong>${stale === 1 ? 'One file has' : `${stale} files have`} changed since then.</strong>` : ''}</p>`);

    parts.push('<h2>What the tests say</h2>');
    const hardest = result.summary.complexFunctions[0];
    for (const r of rows) {
      let extra = '';
      if (r.label === 'Hardest to test' && hardest) {
        const fnState = s.functionDecisionFor(hardest.path, hardest.startLine);
        const fnAttrs = `data-path="${esc(hardest.path)}" data-line="${hardest.startLine}"`;
        const sentence = functionDecisionSentence(fnState);
        extra = `${sentence ? `<br><span class="muted">${esc(sentence)}</span>` : ''}<div class="actions"><button class="small primary-ish" data-act="fixFunction" ${fnAttrs}>Fix this</button><button class="small" data-act="open" ${fnAttrs}>Open</button>${fnState.kind !== 'none' ? `<button class="small" data-act="undoFunction" ${fnAttrs}>Undo decision</button>` : ''}</div>`;
      }
      parts.push(`<div class="row"><span class="mark ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</span><span><strong>${esc(r.label)}:</strong> ${esc(r.value)}${r.numbers ? `<br><span class="numbers">${esc(r.numbers)}</span>` : ''}${extra}</span></div>`);
    }

    if (ranked.length === 0) {
      parts.push('<h2>Lines to look at</h2><p>There are none. Every line has the tests it needs.</p>');
    } else {
      parts.push(`<h2>Look at these first</h2>`);
      for (const d of top) {
        parts.push(this.card(d, read, voice));
      }
      if (rest.length > 0) {
        parts.push(`<details><summary>${rest.length} more line${rest.length === 1 ? '' : 's'} want${rest.length === 1 ? 's' : ''} attention.</summary><ul class="rest">${rest
          .map((d) => `<li><a data-act="open" data-path="${esc(d.path)}" data-line="${d.line.line}">${esc(d.path)} line ${d.line.line}</a><span><span class="badge ${d.line.status}">${esc(badge(d.line))}</span> <button class="small" data-act="decide" data-path="${esc(d.path)}" data-line="${d.line.line}">Decide</button></span></li>`)
          .join('')}</ul></details>`);
      }
    }

    if (accepted.length > 0) {
      parts.push(`<details><summary>Accepted by a person: ${accepted.length}.</summary><ul class="rest">${accepted
        .map((d) => `<li><span><a data-act="open" data-path="${esc(d.path)}" data-line="${d.line.line}">${esc(d.path)} line ${d.line.line}</a><br><span class="muted">${esc(decisionSentence(d.state))}</span></span><button class="small" data-act="undo" data-path="${esc(d.path)}" data-line="${d.line.line}">Undo</button></li>`)
        .join('')}</ul></details>`);
    }
    if (unreachable.length > 0) {
      parts.push(`<details><summary>Code that can never run: ${unreachable.length}.</summary><p class="muted">These lines sit after the function has already returned. No test can reach them, so the fix is to delete them.</p><ul class="rest">${unreachable
        .map((u) => `<li><a data-act="open" data-path="${esc(u.path)}" data-line="${u.line}">${esc(u.path)} line ${u.line}</a><code>${esc((read(u.path, u.line) ?? '').trim().slice(0, 40))}</code></li>`)
        .join('')}</ul></details>`);
    }
    parts.push(`<label class="switch"><input type="checkbox" id="overlay" ${s.overlayVisible ? 'checked' : ''}> Colour the lines in my files.</label>`);
    parts.push(`<label class="switch"><input type="checkbox" id="numbers" ${voice.showNumbers ? 'checked' : ''}> Show the engineer's numbers next to the plain words.</label>`);
    return parts.join('\n');
  }

  private card(d: DecidedLine, read: (p: string, l: number) => string | undefined, voice: Voice): string {
    const line: LineResult = d.line;
    const code = (read(d.path, line.line) ?? '').trim();
    const attrs = `data-path="${esc(d.path)}" data-line="${line.line}"`;
    const reach = line.route.total > 0 ? describeReach(line.route) : '';
    const decision = decisionSentence(d.state);
    return `<div class="card">
      <div class="where"><a data-act="open" ${attrs}>${esc(d.path)} line ${line.line}</a><span class="badge ${line.status}">${esc(badge(line))}</span></div>
      ${code ? `<pre><code>${esc(code)}</code></pre>` : ''}
      <div>${inline(findingSentence(line, voice))}</div>
      ${reach ? `<div class="muted">${inline(reach)}</div>` : ''}
      ${decision ? `<div class="decision">${esc(decision)}</div>` : ''}
      <div class="actions"><button class="small primary-ish" data-act="fix" ${attrs}>Fix this</button><button class="small" data-act="accept" ${attrs}>Accept as it is</button><button class="small" data-act="open" ${attrs}>Open</button>${d.state.kind !== 'none' ? `<button class="small" data-act="undo" ${attrs}>Undo decision</button>` : ''}</div>
    </div>`;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
