import * as vscode from 'vscode';
import { DepthOptions, Thresholds } from './engine/types';
import { LanguageSettings } from './languages/types';

export interface DeepTestConfig {
  language: string;
  testsPath: string;
  sourceRoot: string;
  /** Per-plugin fields, keyed by plugin id: deeptest.languageSettings.<id>.<field>. */
  languageSettings: Record<string, Record<string, unknown>>;
  thresholds: Thresholds;
  depth: DepthOptions;
  overlay: { enabled: boolean; showInlineNumbers: boolean };
  showNumbers: boolean;
  /** Before "Fix this" hands work to an AI, offer a KeepSafe checkpoint when that extension is installed. */
  keepSafe: { offerCheckpoint: boolean };
  colors: { over: string; met: string; short: string; untested: string; unreachable: string };
}

export function readConfig(folder?: vscode.WorkspaceFolder): DeepTestConfig {
  const c = vscode.workspace.getConfiguration('deeptest', folder);
  return {
    language: c.get<string>('language', ''),
    testsPath: c.get<string>('testsPath', ''),
    sourceRoot: c.get<string>('sourceRoot', ''),
    languageSettings: c.get<Record<string, Record<string, unknown>>>('languageSettings', {}),
    thresholds: {
      maxFunctionComplexity: c.get<number>('thresholds.maxFunctionComplexity', 10),
      minCoverage: c.get<number>('thresholds.minCoverage', 80),
      minAverageDensity: c.get<number>('thresholds.minAverageDensity', 1),
      minDensityPassRate: c.get<number>('thresholds.minDensityPassRate', 90),
    },
    depth: {
      countShortCircuit: c.get<boolean>('depth.countShortCircuit', true),
      countTernary: c.get<boolean>('depth.countTernary', true),
      countComprehensions: c.get<boolean>('depth.countComprehensions', true),
      countExcept: c.get<boolean>('depth.countExcept', true),
    },
    overlay: {
      enabled: c.get<boolean>('overlay.enabled', true),
      showInlineNumbers: c.get<boolean>('overlay.showInlineNumbers', true),
    },
    showNumbers: c.get<boolean>('showNumbers', false),
    keepSafe: { offerCheckpoint: c.get<boolean>('keepSafe.offerCheckpoint', true) },
    colors: {
      over: c.get<string>('colors.over', 'rgba(46, 160, 67, 0.28)'),
      met: c.get<string>('colors.met', 'rgba(126, 231, 135, 0.22)'),
      short: c.get<string>('colors.short', 'rgba(255, 221, 87, 0.30)'),
      untested: c.get<string>('colors.untested', 'rgba(248, 81, 73, 0.30)'),
      unreachable: c.get<string>('colors.unreachable', 'rgba(139, 148, 158, 0.25)'),
    },
  };
}

/** The settings a plugin receives: the common fields plus its own block. */
export function settingsFor(config: DeepTestConfig, languageId: string): LanguageSettings {
  return {
    testsPath: config.testsPath,
    sourceRoot: config.sourceRoot,
    fields: config.languageSettings[languageId] ?? {},
  };
}

export async function writeConfig(values: Record<string, unknown>, folder?: vscode.WorkspaceFolder): Promise<void> {
  const c = vscode.workspace.getConfiguration('deeptest', folder);
  const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  for (const [key, value] of Object.entries(values)) {
    await c.update(key, value, target);
  }
}
