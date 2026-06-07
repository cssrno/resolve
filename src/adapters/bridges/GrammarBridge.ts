import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GrammarConfig } from '../../shared/protocol';

/**
 * Finds the TextMate grammar contributed for a given languageId by walking
 * through every installed extension's `contributes.grammars` and
 * `contributes.languages.configuration`. Returns the raw grammar JSON so the
 * webview can hand it to `vscode-textmate` / Monaco's grammar registry.
 */
export class GrammarBridge {
  load(languageId: string): GrammarConfig | null {
    for (const ext of vscode.extensions.all) {
      const grammars = ext.packageJSON?.contributes?.grammars as
        | Array<{ language?: string; scopeName?: string; path?: string }>
        | undefined;
      if (!grammars) continue;
      const match = grammars.find((g) => g.language === languageId);
      if (!match || !match.scopeName || !match.path) continue;
      try {
        const grammarPath = path.join(ext.extensionPath, match.path);
        const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf-8'));
        return {
          scopeName: match.scopeName,
          grammar,
          configuration: this.loadLanguageConfig(languageId) ?? undefined,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  private loadLanguageConfig(languageId: string): GrammarConfig['configuration'] | null {
    for (const ext of vscode.extensions.all) {
      const languages = ext.packageJSON?.contributes?.languages as
        | Array<{ id?: string; configuration?: string }>
        | undefined;
      if (!languages) continue;
      const match = languages.find((l) => l.id === languageId);
      if (!match?.configuration) continue;
      try {
        const cfgPath = path.join(ext.extensionPath, match.configuration);
        const raw = fs.readFileSync(cfgPath, 'utf-8');
        const stripped = raw
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/,(\s*[}\]])/g, '$1');
        return JSON.parse(stripped) as GrammarConfig['configuration'];
      } catch {
        return null;
      }
    }
    return null;
  }
}
