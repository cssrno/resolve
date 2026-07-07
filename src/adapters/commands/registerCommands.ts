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
    vscode.commands.registerCommand('resolve.openMergeView', async () => {
      const uri = editor.activeFileUri();
      if (!uri) {
        editor.showError('No active editor.');
        return;
      }
      await openMergeView.run(uri);
    }),
    vscode.commands.registerCommand('resolve.openDiff', async (resource?: vscode.Uri) => {
      const uri = resource?.toString() ?? editor.activeFileUri();
      if (!uri) {
        editor.showError('No file to diff.');
        return;
      }
      await openDiffView.run(uri);
    }),
    // Palette / keybinding entry points that act on the conflict currently
    // selected in the focused merge view. The view itself owns the cursor
    // state, so these just forward the intent.
    vscode.commands.registerCommand('resolve.acceptLeft', () => openMergeView.dispatch('acceptLeft')),
    vscode.commands.registerCommand('resolve.acceptRight', () => openMergeView.dispatch('acceptRight')),
    vscode.commands.registerCommand('resolve.acceptBoth', () => openMergeView.dispatch('acceptBoth')),
    vscode.commands.registerCommand('resolve.save', () => openMergeView.dispatch('save')),
  );
}
