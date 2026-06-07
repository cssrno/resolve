import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ThemeConfig } from '../../shared/protocol';

/**
 * Locates and reads the user's active color theme so it can be replayed in
 * Monaco. Tries every plausible field (label, id, theme-name shape) before
 * giving up, because there is no first-party VSCode API to retrieve the
 * active theme's underlying JSON.
 */
export class ThemeBridge {
  read(): ThemeConfig {
    const label = vscode.workspace
      .getConfiguration('workbench')
      .get<string>('colorTheme', 'Default Dark+');
    const themePath = this.locateThemePath(label);
    const themeJson = themePath ? this.loadJsonWithIncludes(themePath) : null;
    const kind = vscode.window.activeColorTheme?.kind ?? vscode.ColorThemeKind.Dark;

    if (themePath && !themeJson) {
      void vscode.window.showWarningMessage(
        `Conflict Merge: could not parse theme file at ${themePath}`,
      );
    } else if (!themePath) {
      void vscode.window.showWarningMessage(
        `Conflict Merge: could not locate theme "${label}" on disk; falling back to Monaco base`,
      );
    }

    return {
      base: this.mapBase(kind),
      colors: (themeJson?.colors as Record<string, string>) ?? {},
      tokenColors: (themeJson?.tokenColors as ThemeConfig['tokenColors']) ?? [],
      name: label,
    };
  }

  watch(onChange: (next: ThemeConfig) => void): vscode.Disposable {
    return vscode.window.onDidChangeActiveColorTheme(() => onChange(this.read()));
  }

  private mapBase(kind: vscode.ColorThemeKind): ThemeConfig['base'] {
    switch (kind) {
      case vscode.ColorThemeKind.Light:
        return 'vs';
      case vscode.ColorThemeKind.Dark:
        return 'vs-dark';
      case vscode.ColorThemeKind.HighContrast:
        return 'hc-black';
      case vscode.ColorThemeKind.HighContrastLight:
        return 'hc-light';
      default:
        return 'vs-dark';
    }
  }

  private locateThemePath(label: string): string | null {
    const normalize = (s: string | undefined) =>
      (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = normalize(label);

    for (const ext of vscode.extensions.all) {
      const contributes = ext.packageJSON?.contributes;
      const themes = contributes?.themes as
        | Array<{ label?: string; id?: string; path?: string }>
        | undefined;
      if (!themes) continue;
      const match = themes.find(
        (t) =>
          normalize(t.label) === target ||
          normalize(t.id) === target ||
          t.label === label ||
          t.id === label,
      );
      if (match?.path) return path.join(ext.extensionPath, match.path);
    }
    return null;
  }

  private loadJsonWithIncludes(themePath: string, depth = 0): Record<string, unknown> | null {
    if (depth > 4) return null;
    try {
      const raw = fs.readFileSync(themePath, 'utf-8');
      const stripped = this.stripJsonComments(raw);
      const json = JSON.parse(stripped) as Record<string, unknown>;
      if (typeof json.include === 'string') {
        const includePath = path.resolve(path.dirname(themePath), json.include);
        const parent = this.loadJsonWithIncludes(includePath, depth + 1);
        if (parent) {
          return {
            ...parent,
            ...json,
            colors: { ...(parent.colors as object), ...(json.colors as object) },
            tokenColors: [
              ...((parent.tokenColors as unknown[]) ?? []),
              ...((json.tokenColors as unknown[]) ?? []),
            ],
          };
        }
      }
      return json;
    } catch {
      return null;
    }
  }

  private stripJsonComments(input: string): string {
    return input
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1');
  }
}
