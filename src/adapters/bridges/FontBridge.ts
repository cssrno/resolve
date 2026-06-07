import * as vscode from 'vscode';
import type { EditorFontConfig } from '../../shared/protocol';

export class FontBridge {
  read(): EditorFontConfig {
    const cfg = vscode.workspace.getConfiguration('editor');
    return {
      fontFamily: cfg.get<string>('fontFamily', 'Menlo, Monaco, monospace'),
      fontSize: cfg.get<number>('fontSize', 13),
      lineHeight: cfg.get<number>('lineHeight', 0) || 0,
      letterSpacing: cfg.get<number>('letterSpacing', 0),
      tabSize: cfg.get<number>('tabSize', 4),
      insertSpaces: cfg.get<boolean>('insertSpaces', true),
      renderWhitespace: cfg.get<EditorFontConfig['renderWhitespace']>('renderWhitespace', 'selection'),
    };
  }
}
