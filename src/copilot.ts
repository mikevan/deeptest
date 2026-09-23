/**
 * The hand-off to the editor's assistant.
 *
 * The same pattern UntangleIt uses, deliberately: one way of putting a brief
 * in front of an assistant across the whole toolkit, rather than a second
 * agent interface per product. Putting the brief on the clipboard as well as
 * into the chat is not belt and braces. A person whose editor has no chat
 * still gets the text, and a person whose chat swallowed it can paste it
 * somewhere else.
 *
 * Nothing here decides what to say. The brief arrives built, from Witness,
 * and this only carries it.
 */
import * as vscode from 'vscode';

/** Puts a brief in front of the assistant, and says where it went. */
export async function handOff(brief: string): Promise<string> {
  await vscode.env.clipboard.writeText(brief);
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: brief });
    return 'The brief is in the editor chat and on your clipboard.';
  } catch {
    return 'The brief is on your clipboard. Paste it into the assistant you use.';
  }
}
