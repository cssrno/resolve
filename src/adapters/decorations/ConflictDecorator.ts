import * as vscode from 'vscode';
import { GitConflictParser } from '../../domain/parser/GitConflictParser';

export class ConflictDecorator implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly parser: GitConflictParser) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('merge.conflictingContentBackground'),
      overviewRulerColor: new vscode.ThemeColor('merge.currentContentBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((e) => e && this.refresh(e)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const active = vscode.window.activeTextEditor;
        if (active && e.document === active.document) this.refresh(active);
      }),
    );

    if (vscode.window.activeTextEditor) this.refresh(vscode.window.activeTextEditor);
  }

  private refresh(editor: vscode.TextEditor): void {
    const file = this.parser.parse(editor.document.uri.toString(), editor.document.getText());
    const ranges = file.blocks.map(
      (b) => new vscode.Range(b.startLine, 0, b.endLine, Number.MAX_SAFE_INTEGER),
    );
    editor.setDecorations(this.decorationType, ranges);
  }

  dispose(): void {
    this.decorationType.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
