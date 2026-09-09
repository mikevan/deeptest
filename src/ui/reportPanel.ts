/**
 * The report as a webview: the same model as the Markdown export, with a
 * button per shortfall so the person can open, fix, or accept from the
 * page. Buttons post messages to the extension; nothing runs on its own.
 */
import * as vscode from 'vscode';
import { DecisionState } from '../decisions/decisions';
import { ReportModel, ReportShortfall, renderMarkdown } from '../report/report';
import { threeNumbers } from './words';

export interface ReportMessage {
  type: 'open' | 'fix' | 'accept' | 'undo' | 'decide' | 'export' | 'run' | 'fixFunction' | 'undoFunction';
  path?: string;
  line?: number;
}

export class ReportPanel {
  private static current: ReportPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private model: ReportModel | undefined;

  static show(extensionUri: vscode.Uri, model: ReportModel, onMessage: (msg: ReportMessage) => void): void {
    if (ReportPanel.current) {
      ReportPanel.current.panel.reveal();
      ReportPanel.current.render(model);
      return;
    }
    ReportPanel.current = new ReportPanel(extensionUri, model, onMessage);
  }

  static update(model: ReportModel): void {
    ReportPanel.current?.render(model);
  }

  static get isOpen(): boolean {
    return ReportPanel.current !== undefined;
  }

  private constructor(extensionUri: vscode.Uri, model: ReportModel, onMessage: (msg: ReportMessage) => void) {
    this.panel = vscode.window.createWebviewPanel('deeptest.report', 'DeepTest report', vscode.ViewColumn.Beside, {
      enableScripts: true,
      localResourceRoots: [extensionUri],
      retainContextWhenHidden: true,
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'deeptest.svg');
    this.panel.onDidDispose(() => {
      ReportPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((msg: ReportMessage) => {
      if (msg.type === 'export' && this.model) {
        void exportMarkdown(this.model);
        return;
      }
      onMessage(msg);
    });
    this.render(model);
  }

  render(model: ReportModel): void {
    this.model = model;
    this.panel.webview.html = html(model);
  }
}

async function exportMarkdown(model: ReportModel): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const target = await vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder.uri, 'deeptest-report.md') : undefined,
    filters: { Markdown: ['md'] },
    title: 'Save the report',
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(renderMarkdown(model), 'utf8'));
  void vscode.window.showInformationMessage(`Report saved to ${target.fsPath}`, 'Open').then((c) => {
    if (c === 'Open') {
      void vscode.window.showTextDocument(target);
    }
  });
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Turns `code` spans into <code>. The only Markdown the plain-language text uses. */
function inline(s: string): string {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function stateHtml(state: DecisionState): string {
  switch (state.kind) {
    case 'accepted':
      return `<p class="decision accepted">Accepted by ${esc(state.decision.by)} on ${esc(state.decision.at.slice(0, 10))}: ${esc(state.decision.reason)}</p>`;
    case 'fix-pending':
      return `<p class="decision pending">A fix was requested on ${esc(state.decision.at.slice(0, 10))}; still ${state.stillShortBy} test${state.stillShortBy === 1 ? '' : 's'} short${state.moved ? ` (was ${state.decision.gapAtDecision})` : ', nothing changed'}. Your call again.</p>`;
    case 'fixed':
      return `<p class="decision fixed">Fixed after the decision on ${esc(state.decision.at.slice(0, 10))}.</p>`;
    case 'stale':
      return `<p class="decision stale">A decision from ${esc(state.decision.at.slice(0, 10))} no longer applies: the line has changed since.</p>`;
    default:
      return '';
  }
}

function buttons(d: ReportShortfall): string {
  const attrs = `data-path="${esc(d.path)}" data-line="${d.line}"`;
  const undo = d.state.kind !== 'none' ? `<button class="act" data-act="undo" ${attrs}>Remove decision</button>` : '';
  return `<div class="actions"><button class="act" data-act="open" ${attrs}>Open</button><button class="act primary" data-act="fix" ${attrs}>Fix this</button><button class="act" data-act="accept" ${attrs}>Accept as it is</button>${undo}</div>`;
}

function detailed(d: ReportShortfall, index: number): string {
  const steps = d.steps.length
    ? `<ol class="route">${d.steps
        .map((s) => {
          const ok = s.startsWith('✓');
          return `<li class="${ok ? 'ok' : 'stop'}">${inline(s.replace(/^[✓✗] \d+\. /, ''))}</li>`;
        })
        .join('')}</ol>`
    : '';
  return `<section class="shortfall">
    <h3>${index + 1}. <span class="path">${esc(d.path)}</span>, line ${d.line}: ${d.untested ? 'never tested' : `needs ${d.gap} more test${d.gap === 1 ? '' : 's'}`}</h3>
    <pre><code>${esc(d.code)}</code></pre>
    <p>${d.density === 0 ? 'No test reaches it' : `${d.density} of the ${d.bar} test${d.bar === 1 ? '' : 's'} it needs`}${d.bar > 1 && d.route.total > 0 ? `, one for each of the ${d.route.total} condition${d.route.total === 1 ? '' : 's'} on the way` : ''}. ${inline(d.reach)}</p>
    ${steps}
    <p><strong>What this means:</strong> ${inline(d.meaning)}</p>
    <p><strong>What to do:</strong> ${inline(d.action)}</p>
    ${stateHtml(d.state)}
    ${buttons(d)}
  </section>`;
}

function row(r: ReportShortfall): string {
  const attrs = `data-path="${esc(r.path)}" data-line="${r.line}"`;
  const past = r.route.total === 0 ? 'no decisions' : `${r.route.reached} of ${r.route.total}`;
  const state = r.state.kind === 'none' ? '' : r.state.kind === 'fix-pending' ? `fix requested, still ${r.state.stillShortBy} short` : r.state.kind;
  return `<tr><td><a href="#" class="act" data-act="open" ${attrs}>${esc(r.path)}</a></td><td>${r.line}</td><td>${r.density} / ${r.bar}</td><td>${past}</td><td>${esc(state)}</td><td><button class="act small" data-act="decide" ${attrs}>Decide</button></td></tr>`;
}

function html(m: ReportModel): string {
  const s = m.summary;
  const nonce = Math.random().toString(36).slice(2);
  const ok = (v: boolean): string => (v ? '<span class="ok">ok</span>' : '<span class="bad">below</span>');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 24px 40px; max-width: 820px; line-height: 1.45; }
  h1 { font-size: 1.4em; margin: 20px 0 2px; }
  h2 { font-size: 1.1em; margin: 28px 0 8px; border-bottom: 1px solid var(--vscode-widget-border, #444); padding-bottom: 4px; }
  h3 { font-size: 1em; margin: 18px 0 6px; }
  .muted { color: var(--vscode-descriptionForeground); }
  .verdict { padding: 12px 16px; border-radius: 4px; margin: 12px 0; font-size: 1.05em; }
  .verdict.ready { background: rgba(46,160,67,0.18); border-left: 4px solid #2ea043; }
  .verdict.notready { background: rgba(248,81,73,0.18); border-left: 4px solid #f85149; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-widget-border, #444); }
  th { color: var(--vscode-descriptionForeground); font-weight: 500; }
  .ok { color: #3fb950; } .bad { color: #f85149; }
  pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 3px; overflow-x: auto; margin: 6px 0; }
  code { font-family: var(--vscode-editor-font-family); }
  .shortfall { padding: 4px 0 12px; border-bottom: 1px dashed var(--vscode-widget-border, #444); }
  .path { font-family: var(--vscode-editor-font-family); }
  ol.route { margin: 6px 0 10px; padding-left: 26px; }
  ol.route li.ok::marker { color: #3fb950; }
  ol.route li.stop { color: var(--vscode-foreground); }
  ol.route li.stop::marker { color: #f85149; }
  ol.route li.stop:first-of-type, ol.route li.ok + li.stop { font-weight: 600; }
  .decision { padding: 6px 10px; border-radius: 3px; font-size: 0.95em; }
  .decision.accepted { background: rgba(126,231,135,0.15); }
  .decision.pending { background: rgba(255,221,87,0.18); }
  .decision.fixed { background: rgba(46,160,67,0.18); }
  .decision.stale { background: rgba(139,148,158,0.2); }
  .actions { display: flex; gap: 8px; margin-top: 8px; }
  button { padding: 5px 12px; border: none; border-radius: 2px; cursor: pointer; font-family: inherit; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.small { padding: 2px 8px; font-size: 0.9em; }
  button:hover { filter: brightness(1.1); }
  a { color: var(--vscode-textLink-foreground); }
  .toolbar { display: flex; gap: 8px; margin: 10px 0 0; }
</style>
</head>
<body>
  <h1>DeepTest report</h1>
  <p class="muted">${esc(m.language)}, ${esc(m.generatedAt.slice(0, 16).replace('T', ' '))} UTC. Tests: ${esc(m.testsLine)}.</p>
  <div class="toolbar"><button id="run">Check my code again</button><button id="export">Save as Markdown</button></div>

  <div class="verdict ${m.ready ? 'ready' : 'notready'}"><strong>${m.ready ? 'This looks ready.' : 'This is not ready.'}</strong> ${esc(m.verdict.replace(/^(It meets the limits you set\.|This is not ready\.)\s*/, ''))}</div>

  <table>
    <tr><th>What the tests say</th><th>Now</th><th>You want</th><th></th></tr>
    <tr><td>How much of the code the tests reach</td><td>${s.coveragePercent}%</td><td>${s.thresholds.minCoverage}%</td><td>${ok(s.coverageOk)}</td></tr>
    <tr><td>Lines that have enough tests</td><td>${s.densityPassRate}%</td><td>${s.thresholds.minDensityPassRate}%</td><td>${ok(s.densityPassRateOk)}</td></tr>
    
    <tr><td>Ways through the hardest function</td><td>${s.maxComplexity}</td><td>${s.thresholds.maxFunctionComplexity}</td><td>${s.complexityOk ? '<span class="ok">ok</span>' : '<span class="bad">over</span>'}</td></tr>
  </table>
  <p class="muted">${s.untestedLines} line${s.untestedLines === 1 ? '' : 's'} never ran under a test, ${s.shortLines} ran under too few, ${m.accepted.length} accepted by a person, ${s.unreachableLines} can never run.</p>

  ${m.detailed.length ? `<h2>The ${m.detailed.length} worst, in full</h2><p class="muted">The lines whose tests fall furthest short of what they need.</p>${m.detailed.map(detailed).join('')}` : '<h2>Nothing below its bar</h2><p>Every scored line has at least as many tests as decisions guarding it.</p>'}

  ${m.rest.length ? `<h2>${m.rest.length} more that need attention</h2><table><tr><th>File</th><th>Line</th><th>Tests it has / needs</th><th>Conditions the tests get past</th><th>Decision</th><th></th></tr>${m.rest.map(row).join('')}</table>` : ''}

  ${m.accepted.length ? `<h2>Accepted by a person (${m.accepted.length})</h2><table><tr><th>File</th><th>Line</th><th>Tests it has / needs</th><th>Reason</th><th></th></tr>${m.accepted
    .map((a) => {
      const attrs = `data-path="${esc(a.path)}" data-line="${a.line}"`;
      const st = a.state.kind === 'accepted' ? `${esc(a.state.decision.by)}, ${esc(a.state.decision.at.slice(0, 10))}: ${esc(a.state.decision.reason)}` : '';
      return `<tr><td><a href="#" class="act" data-act="open" ${attrs}>${esc(a.path)}</a></td><td>${a.line}</td><td>${a.density} / ${a.bar}</td><td>${st}</td><td><button class="act small" data-act="undo" ${attrs}>Remove</button></td></tr>`;
    })
    .join('')}</table>` : ''}

  ${m.unreachable.length ? `<h2>Code that can never run (${m.unreachable.length})</h2><p>These lines sit after a return, raise, break, or continue on every path. No test can reach them. The fix is to delete them.</p><ul>${m.unreachable
    .map((u) => `<li><a href="#" class="act" data-act="open" data-path="${esc(u.path)}" data-line="${u.line}">${esc(u.path)} line ${u.line}</a>: <code>${esc(u.code)}</code></li>`)
    .join('')}</ul>` : ''}

  ${s.complexFunctions.length ? `<h2>Functions harder to test than your limit (${s.complexFunctions.length})</h2><p>The first number is how many different ways there are through the function. Over ${s.thresholds.maxFunctionComplexity}, it is hard to test fully and hard to change safely. The tangle is how hard the function is to follow: it charges every break in straight-line flow, and charges more the deeper it is nested. Where two tangle numbers appear, the first is Campbell's published Cognitive Complexity and the second is MikeVan's Better Cognitive Complexity (MBCC), which charges a chain of and/or one per operand when the order of the operands carries meaning.</p><ul>${s.complexFunctions
    .map((fn) => {
      const state = m.functionDecisions.find((d) => d.path === fn.path && d.startLine === fn.startLine);
      return `<li><a href="#" class="act" data-act="open" data-path="${esc(fn.path)}" data-line="${fn.startLine}"><code>${esc(fn.name)}()</code> in ${esc(fn.path)} line ${fn.startLine}</a>: ${esc(threeNumbers(fn))}${state ? ` <span class="muted">${esc(state.sentence)}</span>` : ''} <button class="act small" data-act="fixFunction" data-path="${esc(fn.path)}" data-line="${fn.startLine}">Fix this</button>${state ? ` <button class="act small" data-act="undoFunction" data-path="${esc(fn.path)}" data-line="${fn.startLine}">Undo decision</button>` : ''}</li>`;
    })
    .join('')}</ul>` : ''}

  ${m.compared.length ? `<h2>Ways through against tangle (${m.compared.length} of ${s.functions} functions)</h2><p>The functions with the most ways through, with all three numbers side by side. A high count of ways through and a low tangle is a flat list of choices, such as a switch: long, but not hard to follow. A high tangle with few ways through is deep nesting. Where the Campbell and MBCC numbers differ, the function has boolean conditions whose order carries meaning. A function's tangle includes everything nested inside it, callbacks included, each one level deeper, so a short function that registers many handlers can carry a large tangle.</p><table>
    <tr><th>Function</th><th>Where</th><th>Ways through</th><th>Tangle (Campbell)</th><th>Tangle (MBCC)</th></tr>
    ${m.compared
      .map((fn) => `<tr><td><code>${esc(fn.name)}()</code></td><td><a href="#" class="act" data-act="open" data-path="${esc(fn.path)}" data-line="${fn.startLine}">${esc(fn.path)} line ${fn.startLine}</a></td><td>${fn.complexity}</td><td>${fn.campbell}</td><td>${fn.mbcc}</td></tr>`)
      .join('')}
  </table>` : ''}

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.act');
    if (!el) return;
    e.preventDefault();
    vscode.postMessage({ type: el.getAttribute('data-act'), path: el.getAttribute('data-path'), line: Number(el.getAttribute('data-line')) });
  });
  document.getElementById('export').addEventListener('click', () => vscode.postMessage({ type: 'export' }));
  document.getElementById('run').addEventListener('click', () => vscode.postMessage({ type: 'run' }));
</script>
</body>
</html>`;
}
