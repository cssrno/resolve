import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

suite('Merge flow e2e', () => {
  test('opens fixture and surfaces conflict command', async () => {
    const fixture = path.resolve(__dirname, '../../../fixtures/conflicts/simple-2way.txt');
    const doc = await vscode.workspace.openTextDocument(fixture);
    await vscode.window.showTextDocument(doc);
    assert.ok(doc.getText().includes('<<<<<<<'));

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('conflict.openMergeView'));
  });
});
