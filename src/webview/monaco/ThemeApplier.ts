import type { MonacoModule } from './loader';
import type { ThemeConfig } from '../../shared/protocol';

/**
 * Translates a VSCode color-theme JSON (tokenColors + workbench colors)
 * into a Monaco theme definition and registers it as 'conflict-user-theme'.
 */
export function applyTheme(monaco: MonacoModule, theme: ThemeConfig): void {
  const rules: Array<{ token: string; foreground?: string; background?: string; fontStyle?: string }> = [];
  for (const rule of theme.tokenColors) {
    if (!rule.settings) continue;
    const scopes = Array.isArray(rule.scope) ? rule.scope : rule.scope ? [rule.scope] : [];
    const fg = stripHash(rule.settings.foreground);
    const bg = stripHash(rule.settings.background);
    const fs = rule.settings.fontStyle;
    for (const scope of scopes) {
      for (const token of expandScope(scope)) {
        rules.push({
          token,
          ...(fg ? { foreground: fg } : {}),
          ...(bg ? { background: bg } : {}),
          ...(fs ? { fontStyle: fs } : {}),
        });
      }
    }
  }

  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors)) {
    if (typeof v === 'string') colors[k] = v;
  }

  // Pull chrome colors from VSCode's auto-injected CSS variables — guarantees
  // the editor background, selection, line numbers etc. exactly match the
  // active VSCode color theme even if our theme-file lookup failed.
  fillFromCssVar(colors, 'editor.background', '--vscode-editor-background');
  fillFromCssVar(colors, 'editor.foreground', '--vscode-editor-foreground');
  fillFromCssVar(colors, 'editor.selectionBackground', '--vscode-editor-selectionBackground');
  fillFromCssVar(colors, 'editor.inactiveSelectionBackground', '--vscode-editor-inactiveSelectionBackground');
  fillFromCssVar(colors, 'editor.lineHighlightBackground', '--vscode-editor-lineHighlightBackground');
  fillFromCssVar(colors, 'editorCursor.foreground', '--vscode-editorCursor-foreground');
  fillFromCssVar(colors, 'editorLineNumber.foreground', '--vscode-editorLineNumber-foreground');
  fillFromCssVar(colors, 'editorLineNumber.activeForeground', '--vscode-editorLineNumber-activeForeground');
  fillFromCssVar(colors, 'editorWhitespace.foreground', '--vscode-editorWhitespace-foreground');
  fillFromCssVar(colors, 'editorIndentGuide.background', '--vscode-editorIndentGuide-background');
  fillFromCssVar(colors, 'editorBracketMatch.background', '--vscode-editorBracketMatch-background');
  fillFromCssVar(colors, 'editorBracketMatch.border', '--vscode-editorBracketMatch-border');

  monaco.editor.defineTheme('conflict-user-theme', {
    base: theme.base,
    inherit: true,
    rules,
    colors,
  });
  monaco.editor.setTheme('conflict-user-theme');
}

function fillFromCssVar(target: Record<string, string>, key: string, cssVar: string): void {
  if (target[key]) return;
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  if (value) target[key] = normalizeColor(value);
}

function normalizeColor(value: string): string {
  // Monaco wants #RRGGBB or #RRGGBBAA. Convert rgb()/rgba() if needed.
  if (value.startsWith('#')) return value;
  const m = value.match(/rgba?\(([^)]+)\)/i);
  if (!m) return value;
  const parts = m[1]!.split(',').map((s) => s.trim());
  const [r, g, b, a] = parts;
  const hex = (n: string) => Math.round(parseFloat(n)).toString(16).padStart(2, '0');
  const base = `#${hex(r!)}${hex(g!)}${hex(b!)}`;
  if (a === undefined) return base;
  const alpha = Math.round(parseFloat(a) * 255).toString(16).padStart(2, '0');
  return `${base}${alpha}`;
}

function stripHash(c: string | undefined): string | undefined {
  if (!c) return undefined;
  return c.startsWith('#') ? c.slice(1) : c;
}

/** Monaco token rules take comma-less scopes; one scope per rule. */
function expandScope(scope: string): string[] {
  return scope
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
