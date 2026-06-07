import * as vscode from 'vscode';
import type { EditorPort } from '../domain/ports/EditorPort';

export class VSCodeEditor implements EditorPort {
  activeFileUri(): string | undefined {
    return vscode.window.activeTextEditor?.document.uri.toString();
  }

  showInfo(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  showError(message: string): void {
    void vscode.window.showErrorMessage(message);
  }
}
