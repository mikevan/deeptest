/**
 * Reads and writes <workspace>/.deeptest/decisions.json and reads source
 * lines for hashing and display. The only file in the decisions folder
 * that touches the disk or the editor.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DecisionFile, emptyDecisionFile, parseDecisionFile, serializeDecisionFile } from './decisions';

export function decisionsPath(folder: vscode.WorkspaceFolder): string {
  return path.join(folder.uri.fsPath, '.deeptest', 'decisions.json');
}

export function loadDecisions(folder: vscode.WorkspaceFolder, log?: (line: string) => void): DecisionFile {
  const file = decisionsPath(folder);
  if (!fs.existsSync(file)) {
    return emptyDecisionFile();
  }
  try {
    return parseDecisionFile(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    log?.(`DeepTest: could not read ${file}: ${(err as Error).message}. Starting with no decisions; the file is left untouched.`);
    return emptyDecisionFile();
  }
}

export function saveDecisions(folder: vscode.WorkspaceFolder, decisions: DecisionFile): void {
  const file = decisionsPath(folder);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeDecisionFile(decisions), 'utf8');
}

export function whoAmI(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}

/** Line reader that prefers the open (possibly unsaved) editor buffer. */
export function lineReader(folder: vscode.WorkspaceFolder): (relativePath: string, line: number) => string | undefined {
  const cache = new Map<string, string[] | undefined>();
  return (relativePath, line) => {
    let lines = cache.get(relativePath);
    if (!cache.has(relativePath)) {
      const abs = path.join(folder.uri.fsPath, ...relativePath.split('/'));
      const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
      try {
        lines = (open ? open.getText() : fs.readFileSync(abs, 'utf8')).split(/\r?\n/);
      } catch {
        lines = undefined;
      }
      cache.set(relativePath, lines);
    }
    return lines?.[line - 1];
  };
}
