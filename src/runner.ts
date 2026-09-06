/**
 * Orchestrates one run through the language contract: look the plugin up,
 * check its environment, discover tests, run them with per-test coverage,
 * parse structure for every measured file, join in the engine, publish.
 *
 * This file must never name a language. A grep for any plugin id here
 * returning anything is a bug.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DeepTestConfig, settingsFor } from './config';
import { analyze } from './engine/density';
import { FileStructure } from './engine/types';
import { pluginById } from './languages/registry';
import { runProcess } from './languages/shared/process';
import { runtimeEnvironment } from './languages/shared/runtime';
import { LanguagePlugin, LanguageSettings } from './languages/types';
import { ResultState } from './state';
import { workspaceRootOf } from './ui/paths';

export interface RunnerDeps {
  extensionUri: vscode.Uri;
  output: vscode.OutputChannel;
  state: ResultState;
}

async function parseStructures(
  deps: RunnerDeps,
  plugin: LanguagePlugin,
  folder: vscode.WorkspaceFolder,
  files: string[],
  config: DeepTestConfig,
): Promise<FileStructure[]> {
  const source = await plugin.createStructureSource({ wasmDir: runtimeEnvironment().wasmDir });
  const out: FileStructure[] = [];
  try {
    for (const rel of files) {
      const abs = path.join(workspaceRootOf(folder), ...rel.split('/'));
      let text: string;
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch (err) {
        deps.output.appendLine(`Could not read ${rel}: ${(err as Error).message}`);
        continue;
      }
      try {
        out.push(source.analyze(rel, text, config.depth));
      } catch (err) {
        deps.output.appendLine(`Could not read the structure of ${rel}: ${(err as Error).message}`);
      }
    }
  } finally {
    source.dispose();
  }
  return out;
}

export async function runAnalysis(deps: RunnerDeps, folder: vscode.WorkspaceFolder, config: DeepTestConfig, token: vscode.CancellationToken): Promise<void> {
  const { output, state } = deps;
  const log = (line: string): void => output.appendLine(line);
  const started = Date.now();
  const abort = new AbortController();
  token.onCancellationRequested(() => abort.abort());

  const plugin = pluginById(config.language);
  if (!plugin) {
    state.setError(`DeepTest cannot check ${config.language || 'this language'} yet. Press "Change the setup" to pick a language it can.`);
    return;
  }
  const settings: LanguageSettings = settingsFor(config, plugin.id);
  const workspaceRoot = workspaceRootOf(folder);

  output.appendLine(`\n=== DeepTest check: ${new Date().toISOString()} (${plugin.displayName}) ===`);
  state.setRunning();

  const coverage = plugin.createCoverageSource();
  const tests = await coverage.discoverTests({ workspaceRoot, settings });
  if (tests.length === 0) {
    const where = settings.testsPath ? `in the folder "${settings.testsPath}"` : 'in the whole project';
    state.setNoTests(where);
    log(`No unit tests found ${where}.`);
    return;
  }
  log(`Found ${tests.length} test file(s).`);

  const env = await coverage.checkEnvironment({ workspaceRoot, settings, log });
  log(env.summary);
  if (!env.ok) {
    for (const p of env.problems) {
      log(p);
    }
    if (env.fix) {
      const choice = await vscode.window.showWarningMessage(`DeepTest needs one more thing before it can check this project. ${env.problems.join(' ')}`, env.fix.title, 'Change the setup');
      if (choice === env.fix.title) {
        log(`$ ${env.fix.command} ${env.fix.args.join(' ')}`);
        const install = await runProcess(env.fix.command, env.fix.args, { cwd: workspaceRoot, log, signal: abort.signal });
        if (install.exitCode !== 0) {
          state.setError('The install did not finish. Press "Show the log" to see why.');
          return;
        }
        const again = await coverage.checkEnvironment({ workspaceRoot, settings, log });
        if (!again.ok) {
          state.setError(again.problems.join(' '));
          return;
        }
      } else {
        if (choice === 'Change the setup') {
          void vscode.commands.executeCommand('deeptest.configure');
        }
        state.setError(env.problems.join(' '));
        return;
      }
    } else {
      state.setError(env.problems.join(' '));
      void vscode.window.showErrorMessage(`DeepTest cannot check this project yet. ${env.problems.join(' ')}`, 'Change the setup').then((c) => {
        if (c) {
          void vscode.commands.executeCommand('deeptest.configure');
        }
      });
      return;
    }
  }

  let run;
  try {
    run = await coverage.run({ workspaceRoot, settings, log, signal: abort.signal });
  } catch (err) {
    const message = (err as Error).message;
    log(message);
    state.setError(message);
    return;
  }
  if (token.isCancellationRequested) {
    state.clear();
    return;
  }

  const structures = await parseStructures(deps, plugin, folder, run.measuredFiles, config);
  const result = analyze(run.coverages, structures, config.thresholds);
  const s = result.summary;
  log(
    `Result: ${run.tests.passed} passed, ${run.tests.failed} failed; coverage ${s.coveragePercent}%, density pass rate ${s.densityPassRate}%, average density ${s.averageDensity}, ${result.shortfalls.length} shortfalls, ${s.unreachableLines} unreachable.`,
  );
  state.setResults(result, {
    tests: run.tests,
    environment: env.summary,
    language: plugin.displayName,
    testsPath: settings.testsPath,
    finishedAt: new Date(),
    durationMs: Date.now() - started,
  });
}
