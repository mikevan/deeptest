import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** Workspace-relative path with forward slashes, or undefined when outside the workspace. */
export function relativePathOf(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder || uri.scheme !== 'file') {
    return undefined;
  }
  return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
}

export function absoluteUri(folder: vscode.WorkspaceFolder, relativePath: string): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, ...relativePath.split('/'));
}

/**
 * The workspace folder as the file system spells it. VS Code hands out
 * "c:\\workspace\\..." with a lower-case drive letter on Windows, while Node
 * and the test runners resolve files to "C:\\workspace\\...". Tools that key
 * maps by absolute path then disagree with each other about the same file,
 * so every path DeepTest passes to a runner starts from the real spelling.
 */
export function workspaceRootOf(folder: vscode.WorkspaceFolder): string {
  const raw = folder.uri.fsPath;
  try {
    return fs.realpathSync.native(raw);
  } catch {
    return raw;
  }
}
