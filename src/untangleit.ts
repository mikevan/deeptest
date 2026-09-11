/**
 * UntangleIt is the sibling that untangles one method at a time
 * (publisher prs, id prs.untangleit). DeepTest asks the question ("this
 * function has 48 ways through it") and offers the door ("Break it into
 * smaller pieces"); when UntangleIt is installed, that door leads to it.
 *
 * The contract is UntangleIt's public command `untangleit.method`, which
 * takes `{ path, startLine }` with the path relative to the workspace
 * folder, runs its own gates (the KeepSafe offer and its own modal), hands
 * its own brief to the assistant, and keeps its own record. DeepTest sends
 * the method and stops; it judges the result on the next check, as it
 * would for any other change. This is the same one-directional pattern as
 * src/keepsafe.ts: DeepTest depends on UntangleIt's published contract and
 * UntangleIt knows nothing about DeepTest's insides.
 *
 * When UntangleIt is not installed, "Break it into smaller pieces" keeps
 * working the old way: DeepTest builds the refactor brief itself and hands
 * it to the assistant behind its own gates. The setup screen recommends
 * UntangleIt once, with a link, and nothing else mentions it.
 */
import * as vscode from 'vscode';

export const UNTANGLEIT_EXTENSION_ID = 'prs.untangleit';
export const UNTANGLEIT_METHOD_COMMAND = 'untangleit.method';
export const UNTANGLEIT_MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=prs.untangleit';

export function untangleItInstalled(): boolean {
  return vscode.extensions.getExtension(UNTANGLEIT_EXTENSION_ID) !== undefined;
}

export type UntangleOutcome = 'sent' | 'failed';

/**
 * Hands one function to UntangleIt. Executing the command activates
 * UntangleIt if it is installed but not yet running. A thrown error means
 * UntangleIt could not take the job; the caller says so in plain words and
 * does nothing else, per the toolkit rule that a failing sibling stops the
 * caller rather than being retried or worked around.
 */
export async function handToUntangleIt(relativePath: string, startLine: number, log: (line: string) => void): Promise<UntangleOutcome> {
  try {
    await vscode.commands.executeCommand(UNTANGLEIT_METHOD_COMMAND, { path: relativePath, startLine });
    log(`Handed ${relativePath}:${startLine} to UntangleIt (${UNTANGLEIT_METHOD_COMMAND}).`);
    return 'sent';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`UntangleIt could not take ${relativePath}:${startLine}: ${message}`);
    return 'failed';
  }
}

/** Opens UntangleIt's page in the Extensions view, where the Install button is. */
export async function showUntangleItInExtensionsView(): Promise<void> {
  try {
    await vscode.commands.executeCommand('extension.open', UNTANGLEIT_EXTENSION_ID);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(UNTANGLEIT_MARKETPLACE_URL));
  }
}
