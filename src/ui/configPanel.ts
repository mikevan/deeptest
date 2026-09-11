/**
 * The configuration screen. Opens before the first run (and on demand),
 * pre-filled by the language plugin's detection so the correct action for
 * most users is to press "Save and run tests" without touching a field.
 * The common fields are the same for every language; the plugin's own
 * block is rendered from its FieldSpec list, so this file knows no language.
 */
import * as vscode from 'vscode';
import { DeepTestConfig, writeConfig } from '../config';
import { LanguageGuess } from '../detect/language';
import { allPlugins } from '../languages/registry';
import { showKeepSafeInExtensionsView, KEEPSAFE_MARKETPLACE_URL } from '../keepsafe';
import { showUntangleItInExtensionsView, UNTANGLEIT_MARKETPLACE_URL } from '../untangleit';
import { untangleItSetupHint } from './words';
import { Detection, FieldSpec } from '../languages/types';

export interface ConfigDefaults {
  /** Every language seen in the workspace, most files first. */
  detected: LanguageGuess[];
  /** How many worst lines the report tells in full. */
  detailedRoutes: number;
  /** The plugin id pre-selected: saved setting, else the detected one. */
  languageId: string;
  /** What that plugin worked out, when it exists. */
  detection?: Detection;
  /** Whether the KeepSafe extension is installed in this editor. */
  keepSafeInstalled: boolean;
  /** Whether the UntangleIt extension is installed in this editor. */
  untangleItInstalled: boolean;
}

interface PanelMessage {
  type: 'save' | 'saveAndRun' | 'redetect' | 'showKeepSafe' | 'showUntangleIt';
  values?: Record<string, unknown>;
  languageId?: string;
}

export class ConfigPanel {
  private static current: ConfigPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static show(
    extensionUri: vscode.Uri,
    config: DeepTestConfig,
    defaults: ConfigDefaults,
    onSaved: (run: boolean) => void,
    redetect: (languageId: string) => Promise<ConfigDefaults>,
  ): void {
    if (ConfigPanel.current) {
      ConfigPanel.current.panel.reveal();
      ConfigPanel.current.render(config, defaults);
      return;
    }
    ConfigPanel.current = new ConfigPanel(extensionUri, config, defaults, onSaved, redetect);
  }

  private constructor(
    extensionUri: vscode.Uri,
    private config: DeepTestConfig,
    private defaults: ConfigDefaults,
    onSaved: (run: boolean) => void,
    redetect: (languageId: string) => Promise<ConfigDefaults>,
  ) {
    this.panel = vscode.window.createWebviewPanel('deeptest.config', 'DeepTest setup', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [extensionUri],
      retainContextWhenHidden: true,
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'deeptest.svg');
    this.panel.onDidDispose(() => {
      ConfigPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (msg: PanelMessage) => {
      if (msg.type === 'showUntangleIt') {
        await showUntangleItInExtensionsView();
        return;
      }
      if (msg.type === 'showKeepSafe') {
        await showKeepSafeInExtensionsView();
        return;
      }
      if (msg.type === 'redetect') {
        this.defaults = await redetect(msg.languageId ?? this.defaults.languageId);
        this.render(this.config, this.defaults);
        return;
      }
      if (msg.values) {
        await writeConfig(msg.values);
        vscode.window.setStatusBarMessage('Setup saved', 3000);
        onSaved(msg.type === 'saveAndRun');
        if (msg.type === 'saveAndRun') {
          this.panel.dispose();
        }
      }
    });
    this.render(config, defaults);
  }

  render(config: DeepTestConfig, defaults: ConfigDefaults): void {
    this.config = config;
    this.defaults = defaults;
    this.panel.webview.html = this.html();
  }

  private html(): string {
    const c = this.config;
    const d = this.defaults;
    const nonce = Math.random().toString(36).slice(2);
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const plugins = allPlugins();
    const language = d.languageId;
    const plugin = plugins.find((p) => p.id === language);
    const detectedList = d.detected.length
      ? d.detected.map((g) => `${g.language} (${g.files} file${g.files === 1 ? '' : 's'})`).join(', ')
      : 'no code I recognise';
    const unsupported = d.detected.map((g) => g.language).filter((id) => !plugins.some((p) => p.id === id || p.vscodeLanguageIds.includes(id)));
    const languageOptions = [
      ...plugins.map((p) => `<option value="${esc(p.id)}" ${p.id === language ? 'selected' : ''}>${esc(p.displayName)}</option>`),
      ...Array.from(new Set(unsupported)).map((id) => `<option value="${esc(id)}" ${id === language ? 'selected' : ''}>${esc(id)} (not yet)</option>`),
    ].join('');
    const testsPath = c.testsPath || d.detection?.testsPath || '';
    const sourceRoot = c.sourceRoot || d.detection?.sourceRoot || '';
    const testsFound = d.detection?.testFiles.length ?? 0;
    const notes = d.detection?.notes ?? [];
    const saved = c.languageSettings[language] ?? {};
    const num = (v: number): string => String(v);
    const fieldValue = (f: FieldSpec): unknown => (saved[f.key] !== undefined && saved[f.key] !== '' ? saved[f.key] : d.detection?.fields[f.key]);
    const renderField = (f: FieldSpec): string => {
      const id = `lang_${f.key}`;
      const value = fieldValue(f);
      const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : '';
      switch (f.kind) {
        case 'checkbox':
          return `<label class="check"><input type="checkbox" id="${id}" data-key="${esc(f.key)}" data-kind="checkbox" ${value ? 'checked' : ''}> ${esc(f.label)}</label>${hint}`;
        case 'select':
          return `<label for="${id}">${esc(f.label)}</label><select id="${id}" data-key="${esc(f.key)}" data-kind="select">${(f.options ?? [])
            .map((o) => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`)
            .join('')}</select>${hint}`;
        case 'number':
          return `<label for="${id}">${esc(f.label)}</label><input type="number" id="${id}" data-key="${esc(f.key)}" data-kind="number" value="${esc(String(value ?? ''))}">${hint}`;
        default:
          return `<label for="${id}">${esc(f.label)}</label><input type="text" id="${id}" data-key="${esc(f.key)}" data-kind="text" value="${esc(String(value ?? ''))}" placeholder="${esc(f.placeholder ?? '')}">${hint}`;
      }
    };
    const languageBlock = plugin
      ? `<h2>${esc(plugin.displayName)}</h2>${plugin.configFields.map(renderField).join('')}`
      : `<h2>Language</h2><div class="note">I cannot check <code>${esc(language || 'this language')}</code> yet. I can check: ${plugins.map((p) => esc(p.displayName)).join(', ')}. Pick one of those above if it fits, or watch for the next release.</div>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 24px 24px; max-width: 760px; }
  h1 { font-size: 1.3em; font-weight: 600; margin: 20px 0 4px; }
  h2 { font-size: 1em; font-weight: 600; margin: 24px 0 8px; border-bottom: 1px solid var(--vscode-widget-border, #444); padding-bottom: 4px; }
  p.hint { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
  label { display: block; margin: 10px 0 4px; font-weight: 500; }
  input[type=text], input[type=number], select { width: 100%; box-sizing: border-box; padding: 5px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; font-family: inherit; }
  input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .check { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-weight: normal; }
  .check input { width: auto; }
  .actions { margin-top: 24px; display: flex; gap: 8px; }
  button { padding: 6px 14px; border: none; border-radius: 2px; cursor: pointer; font-family: inherit; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { filter: brightness(1.1); }
  .note { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); padding: 8px 12px; margin: 8px 0; }
  code { font-family: var(--vscode-editor-font-family); }
  details { margin: 18px 0 0; }
  summary { cursor: pointer; font-weight: 600; margin-bottom: 6px; }
</style>
</head>
<body>
  <h1>DeepTest setup</h1>
  <p class="hint">These fields were filled in from what DeepTest found in your project. If they look right, press "Save and check my code". Everything here is also an ordinary setting under <code>deeptest.*</code>.</p>

  <h2>Your project</h2>
  <div class="note">Found in this project: ${esc(detectedList)}.
    ${testsFound > 0 ? `Found ${testsFound} test file${testsFound === 1 ? '' : 's'} under <code>${esc(testsPath || 'the project folder')}</code>.` : 'No test files were found yet. Enter the folder that holds them below.'}
    ${notes.map((n) => `<br>${esc(n)}`).join('')}
    <button id="redetect" style="margin-left:8px">Look again</button>
  </div>
  <div class="row">
    <div>
      <label for="language">Language</label>
      <select id="language">${languageOptions}</select>
    </div>
    <div>
      <label for="testsPath">Folder with the tests</label>
      <input type="text" id="testsPath" value="${esc(testsPath)}" placeholder="tests">
    </div>
  </div>
  <label for="sourceRoot">Folder with the code being checked (leave empty for the whole project apart from the tests)</label>
  <input type="text" id="sourceRoot" value="${esc(sourceRoot)}" placeholder="src">

  ${languageBlock}

  <h2>What counts as ready</h2>
  <div class="row">
    <div><label for="minCoverage">Tests must reach at least this much of the code (%)</label><input type="number" id="minCoverage" min="0" max="100" step="1" value="${num(c.thresholds.minCoverage)}"></div>
    <div><label for="minDensityPassRate">At least this many lines must have enough tests (%)</label><input type="number" id="minDensityPassRate" min="0" max="100" step="1" value="${num(c.thresholds.minDensityPassRate)}"></div>
    <div><label for="maxFunctionComplexity">Most ways through one function before it is too hard to test</label><input type="number" id="maxFunctionComplexity" min="1" step="1" value="${num(c.thresholds.maxFunctionComplexity)}"></div>
    <div><label for="detailedRoutes">How many of the worst lines get the full story</label><input type="number" id="detailedRoutes" min="1" step="1" value="${num(d.detailedRoutes)}"></div>
  </div>

  <h2>In my files</h2>
  <label class="check"><input type="checkbox" id="showInlineNumbers" ${c.overlay.showInlineNumbers ? 'checked' : ''}> Write "Never tested. Needs 3 tests." at the end of lines that fall short.</label>
  <label class="check"><input type="checkbox" id="showNumbers" ${c.showNumbers ? 'checked' : ''}> Show the engineer's numbers next to the plain words.</label>

  <h2>Before the AI changes your code</h2>
  ${
    d.keepSafeInstalled
      ? `<p class="hint">KeepSafe is installed. It takes a checkpoint of your whole project and can put everything back the way it was.</p>
  <label class="check"><input type="checkbox" id="offerCheckpoint" ${c.keepSafe.offerCheckpoint ? 'checked' : ''}> Before "Fix this" hands work to your AI assistant, ask me whether to create a KeepSafe checkpoint.</label>`
      : `<p class="hint">"Fix this" hands work to your AI assistant, and the assistant may change your code. DeepTest recommends KeepSafe, a separate extension that takes a checkpoint of your whole project first and puts everything back if the change goes wrong. It is not installed. <a href="${KEEPSAFE_MARKETPLACE_URL}">KeepSafe on the VS Code Marketplace</a>.</p>
  <button id="showKeepSafe">Show KeepSafe in the Extensions view</button>`
  }

  <h2>When a function is too tangled</h2>
  ${
    d.untangleItInstalled
      ? `<p class="hint">${untangleItSetupHint(true)}</p>`
      : `<p class="hint">${untangleItSetupHint(false)} <a href="${UNTANGLEIT_MARKETPLACE_URL}">UntangleIt on the VS Code Marketplace</a>.</p>
  <button id="showUntangleIt">Show UntangleIt in the Extensions view</button>`
  }

  <details>
    <summary>Advanced: what counts as a condition</summary>
    <p class="hint">A line needs one test for each condition that guards it. These settings decide what counts as a condition. Leave them alone unless you know why you are changing them.</p>
    <label class="check"><input type="checkbox" id="countShortCircuit" ${c.depth.countShortCircuit ? 'checked' : ''}> Each part of an <code>and</code> or <code>or</code> is its own condition.</label>
    <label class="check"><input type="checkbox" id="countTernary" ${c.depth.countTernary ? 'checked' : ''}> An inline choice, such as <code>x if c else y</code> or <code>c ? x : y</code>, is a condition.</label>
    <label class="check"><input type="checkbox" id="countComprehensions" ${c.depth.countComprehensions ? 'checked' : ''}> Filters inside list comprehensions are conditions. (Python only.)</label>
    <label class="check"><input type="checkbox" id="countExcept" ${c.depth.countExcept ? 'checked' : ''}> Each error handler, <code>except</code> or <code>catch</code>, guards its lines.</label>
    <label for="minAverageDensity">Minimum average of tests per condition</label>
    <input type="number" id="minAverageDensity" min="0" step="0.05" value="${num(c.thresholds.minAverageDensity)}">
  </details>

  <div class="actions">
    <button class="primary" id="saveRun">Save and check my code</button>
    <button id="save">Save</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const v = (id) => document.getElementById(id).value;
  const n = (id) => Number(document.getElementById(id).value);
  const b = (id) => document.getElementById(id).checked;
  function collect() {
    const fields = {};
    for (const el of document.querySelectorAll('[data-key]')) {
      const kind = el.getAttribute('data-kind');
      fields[el.getAttribute('data-key')] = kind === 'checkbox' ? el.checked : kind === 'number' ? Number(el.value) : el.value.trim();
    }
    const languageSettings = Object.assign({}, ${JSON.stringify(c.languageSettings).replace(/</g, '\\u003c')});
    languageSettings[v('language')] = fields;
    return {
      'language': v('language'),
      'testsPath': v('testsPath').trim(),
      'sourceRoot': v('sourceRoot').trim(),
      'languageSettings': languageSettings,
      'thresholds.minCoverage': n('minCoverage'),
      'thresholds.minDensityPassRate': n('minDensityPassRate'),
      'thresholds.minAverageDensity': n('minAverageDensity'),
      'thresholds.maxFunctionComplexity': n('maxFunctionComplexity'),
      'report.detailedRoutes': n('detailedRoutes'),
      'showNumbers': b('showNumbers'),
      ...(document.getElementById('offerCheckpoint') ? { 'keepSafe.offerCheckpoint': b('offerCheckpoint') } : {}),
      'depth.countShortCircuit': b('countShortCircuit'),
      'depth.countTernary': b('countTernary'),
      'depth.countComprehensions': b('countComprehensions'),
      'depth.countExcept': b('countExcept'),
      'overlay.showInlineNumbers': b('showInlineNumbers'),
    };
  }
  document.getElementById('save').addEventListener('click', () => vscode.postMessage({ type: 'save', values: collect() }));
  document.getElementById('saveRun').addEventListener('click', () => vscode.postMessage({ type: 'saveAndRun', values: collect() }));
  const showUntangleIt = document.getElementById('showUntangleIt');
  if (showUntangleIt) {
    showUntangleIt.addEventListener('click', () => vscode.postMessage({ type: 'showUntangleIt' }));
  }
  const showKeepSafe = document.getElementById('showKeepSafe');
  if (showKeepSafe) {
    showKeepSafe.addEventListener('click', () => vscode.postMessage({ type: 'showKeepSafe' }));
  }
  document.getElementById('redetect').addEventListener('click', () => vscode.postMessage({ type: 'redetect', languageId: v('language') }));
  document.getElementById('language').addEventListener('change', () => vscode.postMessage({ type: 'redetect', languageId: v('language') }));
</script>
</body>
</html>`;
  }
}
