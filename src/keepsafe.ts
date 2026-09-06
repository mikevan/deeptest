/**
 * KeepSafe is a separate VS Code extension (publisher KeepSafe, id
 * KeepSafe.keepsafe) that takes a checkpoint of the whole workspace and
 * restores it on demand: an undo button for everything an AI assistant
 * changes. DeepTest's "Fix this" is the one place DeepTest hands work to an
 * AI, so it is the one place a checkpoint matters.
 *
 * The contract with KeepSafe is its public command `keepsafe.quickCheckpoint`
 * (read from keepsafe-extension/package.json, v0.1.1): it takes no
 * arguments, checkpoints the first workspace folder under a timestamped
 * name, and shows its own confirmation. Executing the command activates
 * the extension if it is installed but not yet running.
 *
 * When KeepSafe is not installed, DeepTest recommends it once, in the text
 * of the setup screen, and does nothing else: no prompt, no download, no
 * mention of it anywhere else in the interface.
 */
import * as vscode from 'vscode';

export const KEEPSAFE_EXTENSION_ID = 'KeepSafe.keepsafe';
export const KEEPSAFE_CHECKPOINT_COMMAND = 'keepsafe.quickCheckpoint';
export const KEEPSAFE_MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=KeepSafe.keepsafe';

export function keepSafeInstalled(): boolean {
  return vscode.extensions.getExtension(KEEPSAFE_EXTENSION_ID) !== undefined;
}

export type CheckpointOutcome = 'created' | 'skipped' | 'failed';

/**
 * Asks, in a notification, whether to take a KeepSafe checkpoint now, and
 * takes it when the answer is yes. Closing the notification without
 * answering counts as "Skip": the confirmation that follows in the Fix
 * flow is the gate on the hand-off itself, and it is modal.
 */
export async function offerCheckpoint(log: (line: string) => void): Promise<CheckpointOutcome> {
  const answer = await vscode.window.showInformationMessage(
    'Create a KeepSafe checkpoint before the AI changes your code? You can restore it if the change goes wrong.',
    'Create a checkpoint',
    'Skip',
  );
  if (answer !== 'Create a checkpoint') {
    log('KeepSafe checkpoint skipped.');
    return 'skipped';
  }
  try {
    await vscode.commands.executeCommand(KEEPSAFE_CHECKPOINT_COMMAND);
    log('KeepSafe checkpoint requested.');
    return 'created';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`KeepSafe checkpoint failed: ${message}`);
    return 'failed';
  }
}

/** Opens KeepSafe's page in the Extensions view, where the Install button is. */
export async function showKeepSafeInExtensionsView(): Promise<void> {
  try {
    await vscode.commands.executeCommand('extension.open', KEEPSAFE_EXTENSION_ID);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(KEEPSAFE_MARKETPLACE_URL));
  }
}
