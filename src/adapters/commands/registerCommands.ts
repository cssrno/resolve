import * as vscode from 'vscode';
import type { OpenMergeView } from '../../application/OpenMergeView';
import type { OpenDiffView } from '../../application/OpenDiffView';
import type { EditorPort } from '../../domain/ports/EditorPort';

export function registerCommands(
  context: vscode.ExtensionContext,
  openMergeView: OpenMergeView,
  openDiffView: OpenDiffView,
  editor: EditorPort,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('conflict.openMergeView', async () => {
      const uri = editor.activeFileUri();
      if (!uri) {
        editor.showError('No active editor.');
        return;
      }
      await openMergeView.run(uri);
    }),
    vscode.commands.registerCommand('conflict.openDiff', async (resource?: vscode.Uri) => {
      const uri = resource?.toString() ?? editor.activeFileUri();
      if (!uri) {
        editor.showError('No file to diff.');
        return;
      }
      await openDiffView.run(uri);
    }),
  );
}
