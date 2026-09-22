import * as vscode from 'vscode';
import { DeepTestConfig, readConfig } from './config';
import { countLanguages } from './detect/language';
import { pluginById, pluginForExtension, pluginForLanguageId } from './languages/registry';
import { HostServices } from './languages/types';
import { setRuntimeEnvironment } from './languages/shared/runtime';
import { acceptShortfall, decide, fixFunction, fixShortfall, loadDecisionsIntoState, undoDecision, undoFunctionDecision } from './decisions/commands';
import { lineReader } from './decisions/store';
import { buildReport } from './report/report';
import { runAnalysis } from './runner';
import { ResultState } from './state';
import { ReportMessage, ReportPanel } from './ui/reportPanel';
import { keepSafeInstalled } from './keepsafe';
import { untangleItInstalled } from './untangleit';
import { ConfigDefaults, ConfigPanel } from './ui/configPanel';
import { OverlayManager } from './ui/decorations';
import { absoluteUri, workspaceRootOf } from './ui/paths';
import { SidebarMessage, SidebarView } from './ui/sidebarView';
import { StatusBar } from './ui/statusBar';

let running: vscode.CancellationTokenSource | undefined;

function workspaceFolder(): vscode.WorkspaceFolder | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const owner = vscode.workspace.getWorkspaceFolder(active);
    if (owner) {
      return owner;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

const host: HostServices = {
  get activeLanguageId(): string | undefined {
    return vscode.window.activeTextEditor?.document.languageId;
  },
  async extensionApi(extensionId: string): Promise<unknown> {
    const ext = vscode.extensions.getExtension(extensionId);
    if (!ext) {
      return undefined;
    }
    return ext.isActive ? ext.exports : ext.activate();
  },
};

/**
 * Pre-fills the configuration screen. The plugin is chosen from the saved
 * setting, else the active editor's language, else the language with the
 * most files in the workspace. The chosen plugin then detects everything
 * else it can.
 */
async function detectDefaults(folder: vscode.WorkspaceFolder, config: DeepTestConfig, languageId?: string): Promise<ConfigDefaults> {
  const detected = countLanguages(workspaceRootOf(folder));
  let id = languageId ?? config.language;
  if (!id) {
    const active = host.activeLanguageId ? pluginForLanguageId(host.activeLanguageId) : undefined;
    if (active) {
      id = active.id;
    }
  }
  if (!id) {
    for (const guess of detected) {
      const plugin = pluginForLanguageId(guess.language) ?? pluginForExtension(`.${guess.language}`);
      if (plugin) {
        id = plugin.id;
        break;
      }
    }
  }
  if (!id && detected.length > 0) {
    id = detected[0].language;
  }
  const plugin = pluginById(id);
  const detection = plugin ? await plugin.detect(workspaceRootOf(folder), host) : undefined;
  const detailedRoutes = vscode.workspace.getConfiguration('deeptest', folder).get<number>('report.detailedRoutes', 5);
  return { detected, languageId: id, detection, detailedRoutes, keepSafeInstalled: keepSafeInstalled(), untangleItInstalled: untangleItInstalled() };
}

/** Exposed for integration tests and for other extensions that want the numbers. */
export interface DeepTestApi {
  state: ResultState;
  run(): Promise<void>;
  /** The current report model, or undefined before the first run. */
  report(): ReturnType<typeof buildReport> | undefined;
}

export function activate(context: vscode.ExtensionContext): DeepTestApi {
  setRuntimeEnvironment({
    wasmDir: vscode.Uri.joinPath(context.extensionUri, 'dist').fsPath,
  });
  const output = vscode.window.createOutputChannel('DeepTest');
  const state = new ResultState();
  let config = readConfig(workspaceFolder());
  const overlay = new OverlayManager(state, config);
  const statusBar = new StatusBar(state);

  const decisionDeps = { state, output, folder: workspaceFolder, config: () => config };
  const onSidebarMessage = (msg: SidebarMessage): void => {
    const { path: p, line } = msg;
    switch (msg.type) {
      case 'run':
        void vscode.commands.executeCommand('deeptest.run');
        break;
      case 'configure':
        void vscode.commands.executeCommand('deeptest.configure');
        break;
      case 'report':
        void vscode.commands.executeCommand('deeptest.report');
        break;
      case 'output':
        output.show(true);
        break;
      case 'toggleNumbers':
        void vscode.commands.executeCommand('deeptest.toggleNumbers');
        break;
      case 'toggleOverlay':
        state.toggleOverlay();
        break;
      case 'open':
        if (p && line) {
          void vscode.commands.executeCommand('deeptest.openLine', p, line);
        }
        break;
      case 'fix':
        if (p && line) {
          void fixShortfall(decisionDeps, p, line);
        }
        break;
      case 'accept':
        if (p && line) {
          void acceptShortfall(decisionDeps, p, line);
        }
        break;
      case 'undo':
        if (p && line) {
          void undoDecision(decisionDeps, p, line);
        }
        break;
      case 'fixFunction':
        if (p && line) {
          void fixFunction(decisionDeps, p, line);
        }
        break;
      case 'undoFunction':
        if (p && line) {
          void undoFunctionDecision(decisionDeps, p, line);
        }
        break;
      case 'decide':
        if (p && line) {
          void decide(decisionDeps, p, line);
        }
        break;
      default:
        break;
    }
  };
  const sidebar = new SidebarView(
    context.extensionUri,
    state,
    () => ({ showNumbers: config.showNumbers }),
    () => {
      const folder = workspaceFolder();
      return folder ? lineReader(folder) : () => undefined;
    },
    onSidebarMessage,
    String((context.extension.packageJSON as { version?: string }).version ?? ''),
  );
  loadDecisionsIntoState(decisionDeps);
  state.fire();

  const reportModel = () => {
    const folder = workspaceFolder();
    if (!folder || !state.result || !state.run) {
      return undefined;
    }
    return buildReport({
      result: state.result,
      decided: state.decided,
      decidedFunctions: state.decidedFunctions,
      run: state.run,
      readLine: lineReader(folder),
      detailCount: Math.max(1, vscode.workspace.getConfiguration('deeptest', folder).get<number>('report.detailedRoutes', 5)),
    });
  };

  const onReportMessage = (msg: ReportMessage): void => {
    const { path: p, line } = msg;
    switch (msg.type) {
      case 'open':
        if (p && line) {
          void vscode.commands.executeCommand('deeptest.openLine', p, line);
        }
        break;
      case 'fix':
        if (p && line) {
          void fixShortfall(decisionDeps, p, line);
        }
        break;
      case 'accept':
        if (p && line) {
          void acceptShortfall(decisionDeps, p, line);
        }
        break;
      case 'undo':
        if (p && line) {
          void undoDecision(decisionDeps, p, line);
        }
        break;
      case 'fixFunction':
        if (p && line) {
          void fixFunction(decisionDeps, p, line);
        }
        break;
      case 'undoFunction':
        if (p && line) {
          void undoFunctionDecision(decisionDeps, p, line);
        }
        break;
      case 'decide':
        if (p && line) {
          void decide(decisionDeps, p, line);
        }
        break;
      case 'run':
        void vscode.commands.executeCommand('deeptest.run');
        break;
      default:
        break;
    }
  };

  const openReport = (): void => {
    const model = reportModel();
    if (!model) {
      void vscode.window.showInformationMessage('Check your code first, and then the report will have something to say.', 'Check my code').then((c) => {
        if (c) {
          void vscode.commands.executeCommand('deeptest.run');
        }
      });
      return;
    }
    ReportPanel.show(context.extensionUri, model, onReportMessage);
  };

  // Keep an open report current as results and decisions change.
  context.subscriptions.push(
    state.onDidChange(() => {
      if (ReportPanel.isOpen) {
        const model = reportModel();
        if (model) {
          ReportPanel.update(model);
        }
      }
    }),
  );

  const openConfig = async (): Promise<void> => {
    const folder = workspaceFolder();
    if (!folder) {
      void vscode.window.showErrorMessage('DeepTest needs an open folder to check.');
      return;
    }
    config = readConfig(folder);
    const defaults = await detectDefaults(folder, config);
    ConfigPanel.show(
      context.extensionUri,
      config,
      defaults,
      (run) => {
        config = readConfig(folder);
        overlay.updateConfig(config);
        if (run) {
          void vscode.commands.executeCommand('deeptest.run');
        }
      },
      (languageId) => detectDefaults(folder, readConfig(folder), languageId),
    );
  };

  const run = async (): Promise<void> => {
    const folder = workspaceFolder();
    if (!folder) {
      void vscode.window.showErrorMessage('DeepTest needs an open folder to check.');
      return;
    }
    config = readConfig(folder);
    overlay.updateConfig(config);

    if (!config.language) {
      // First run: show the configuration screen, pre-filled from what the
      // workspace looks like. "Save and run tests" comes back through here.
      await openConfig();
      return;
    }

    if (running) {
      running.cancel();
    }
    running = new vscode.CancellationTokenSource();
    const token = running.token;
    loadDecisionsIntoState(decisionDeps);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'DeepTest: checking your code', cancellable: true },
      async (_progress, progressToken) => {
        progressToken.onCancellationRequested(() => running?.cancel());
        try {
          await runAnalysis({ extensionUri: context.extensionUri, output, state }, folder, config, token);
        } catch (err) {
          const message = (err as Error).message ?? String(err);
          output.appendLine(`The check did not finish: ${message}`);
          state.setError(message);
        }
      },
    );
    if (state.phase === 'noTests') {
      void vscode.window.showInformationMessage(`DeepTest could not find any tests ${state.message}.`, 'Tell me where the tests are').then((c) => {
        if (c) {
          void openConfig();
        }
      });
    }
  };

  context.subscriptions.push(
    output,
    state,
    overlay,
    sidebar,
    statusBar,
    vscode.window.registerWebviewViewProvider(SidebarView.viewId, sidebar, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('deeptest.toggleNumbers', async () => {
      const folder = workspaceFolder();
      const current = vscode.workspace.getConfiguration('deeptest', folder).get<boolean>('showNumbers', false);
      await vscode.workspace.getConfiguration('deeptest', folder).update('showNumbers', !current, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('deeptest.run', run),
    vscode.commands.registerCommand('deeptest.configure', openConfig),
    vscode.commands.registerCommand('deeptest.clear', () => state.clear()),
    vscode.commands.registerCommand('deeptest.toggleOverlay', () => state.toggleOverlay()),
    vscode.commands.registerCommand('deeptest.showOutput', () => output.show(true)),
    vscode.commands.registerCommand('deeptest.report', openReport),
    vscode.commands.registerCommand('deeptest.decide', (p?: string | { path: string; line: number }, line?: number) => {
      const target = typeof p === 'object' ? p : p && line ? { path: p, line } : undefined;
      if (target) {
        void decide(decisionDeps, target.path, target.line);
      }
    }),
    vscode.commands.registerCommand('deeptest.fix', (node?: { path: string; line: number }) => node && fixShortfall(decisionDeps, node.path, node.line)),
    vscode.commands.registerCommand('deeptest.fixFunction', (node?: { path: string; line: number }) => node && fixFunction(decisionDeps, node.path, node.line)),
    vscode.commands.registerCommand('deeptest.undoFunctionDecision', (node?: { path: string; line: number }) => node && undoFunctionDecision(decisionDeps, node.path, node.line)),
    vscode.commands.registerCommand('deeptest.accept', (node?: { path: string; line: number }) => node && acceptShortfall(decisionDeps, node.path, node.line)),
    vscode.commands.registerCommand('deeptest.undoDecision', (node?: { path: string; line: number }) => node && undoDecision(decisionDeps, node.path, node.line)),
    vscode.commands.registerCommand('deeptest.openLine', async (relativePath: string, line: number) => {
      const folder = workspaceFolder();
      if (!folder) {
        return;
      }
      const doc = await vscode.workspace.openTextDocument(absoluteUri(folder, relativePath));
      const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('deeptest')) {
        config = readConfig(workspaceFolder());
        overlay.updateConfig(config);
        sidebar.render();
      }
    }),
  );

  return { state, run, report: reportModel };
}

export function deactivate(): void {
  running?.cancel();
}
