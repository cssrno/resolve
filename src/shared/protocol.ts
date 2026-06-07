export interface ConflictBlockDTO {
  id: string;
  startLine: number;
  endLine: number;
  localLines: string[];
  baseLines: string[] | null;
  remoteLines: string[];
  localLabel: string;
  remoteLabel: string;
  resolution: ResolutionDTO | null;
}

export type SideDecisionDTO = 'accepted' | 'rejected';

export type ResolutionDTO =
  | { kind: 'sides'; left?: SideDecisionDTO; right?: SideDecisionDTO }
  | { kind: 'manual'; lines: string[] };

export interface ConflictFileDTO {
  uri: string;
  blocks: ConflictBlockDTO[];
  originalLines: string[];
  languageId: string;
  mergeContext?: MergeContextDTO;
}

export interface MergeContextDTO {
  /** What git operation triggered this conflict. */
  readonly operation: 'merge' | 'rebase';
  /** Symbolic name of the side that owns HEAD (= local pane). */
  readonly localRef: string;
  /** Short hash of HEAD (when available). */
  readonly localHash: string;
  /** Symbolic name of the incoming side (= remote pane). */
  readonly incomingRef: string;
  /** Short hash of the incoming commit / onto target. */
  readonly incomingHash: string;
}

export interface DiffHunkDTO {
  id: string;
  leftStartLine: number;
  rightStartLine: number;
  leftLines: string[];
  rightLines: string[];
}

export interface DiffFileDTO {
  uri: string;
  languageId: string;
  repoRoot: string;
  repoRelativePath: string;
  headShortHash: string;
  headLines: string[];
  workingLines: string[];
  hunks: DiffHunkDTO[];
  initiallyStagedHunkIds: string[];
}

export interface EditorFontConfig {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  tabSize: number;
  insertSpaces: boolean;
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
}

export interface ThemeConfig {
  /** e.g. 'vs-dark', 'vs', 'hc-black', 'hc-light' — Monaco base theme */
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  /** raw colors map from VSCode theme JSON (workbench colors) */
  colors: Record<string, string>;
  /** raw tokenColors array from VSCode theme JSON (TextMate token rules) */
  tokenColors: Array<{
    name?: string;
    scope?: string | string[];
    settings: { foreground?: string; background?: string; fontStyle?: string };
  }>;
  /** theme display name */
  name: string;
}

export interface KeybindingDTO {
  /** Raw VSCode key string e.g. "cmd+s", "ctrl+shift+p" */
  key: string;
  /** Monaco-translated keybinding (number from KeyMod | KeyCode) or null if unmappable */
  monacoKey: number | null;
  /** VSCode command id */
  command: string;
  /** Optional when clause */
  when?: string;
}

export interface GrammarConfig {
  /** TextMate scope name, e.g. "source.ts" */
  scopeName: string;
  /** raw .tmLanguage.json content */
  grammar: unknown;
  /** language config (brackets, comments, etc.) */
  configuration?: {
    comments?: { lineComment?: string; blockComment?: [string, string] };
    brackets?: Array<[string, string]>;
  };
}

/**
 * Flattened document symbol entry. We only need name/kind + 1-based
 * line range, not the full nested tree — the breadcrumb extractor
 * picks the innermost symbol that covers a collapsed range.
 */
export interface DocumentSymbolDTO {
  readonly name: string;
  /** Numeric vscode.SymbolKind value (e.g. 5 = Class, 6 = Method, 11 = Function). */
  readonly kind: number;
  /** Optional secondary detail (e.g. signature). */
  readonly detail?: string;
  /** 1-based, inclusive line range of the symbol's full body. */
  readonly startLine: number;
  readonly endLine: number;
  /** Depth in the original symbol tree (0 = top level). Lets the
   *  consumer build `Outer > Inner` paths without rehydrating the
   *  whole tree. */
  readonly depth: number;
}

export type HostToWebview =
  | {
      kind: 'init';
      file: ConflictFileDTO;
      font: EditorFontConfig;
      theme: ThemeConfig;
      keybindings: KeybindingDTO[];
      grammar: GrammarConfig | null;
      monacoBaseUri: string;
      symbols?: DocumentSymbolDTO[];
    }
  | {
      kind: 'initDiff';
      file: DiffFileDTO;
      font: EditorFontConfig;
      theme: ThemeConfig;
      keybindings: KeybindingDTO[];
      grammar: GrammarConfig | null;
      monacoBaseUri: string;
      symbols?: DocumentSymbolDTO[];
    }
  | { kind: 'blockResolved'; blockId: string; resolution: ResolutionDTO | null }
  | { kind: 'hunkStateChanged'; hunkId: string; staged: boolean }
  | { kind: 'diffRefreshed'; file: DiffFileDTO }
  | { kind: 'saved' }
  | { kind: 'themeChanged'; theme: ThemeConfig }
  | { kind: 'commandResult'; requestId: string; ok: boolean; error?: string };

export type WebviewToHost =
  | { kind: 'ready' }
  | { kind: 'accept'; blockId: string; side: 'left' | 'right' | 'both' }
  | { kind: 'acceptSide'; blockId: string; side: 'left' | 'right' }
  | { kind: 'reset'; blockId: string }
  | { kind: 'reject'; blockId: string; side: 'left' | 'right' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'revertHunk'; hunkId: string }
  | { kind: 'stageHunk'; hunkId: string }
  | { kind: 'unstageHunk'; hunkId: string }
  | { kind: 'stageAll' }
  | { kind: 'unstageAll' }
  | { kind: 'workingTreeEdited'; content: string }
  | { kind: 'jumpToSource' }
  | { kind: 'editResult'; blockId: string; lines: string[] }
  | { kind: 'save' }
  | {
      /** Forward an arbitrary VSCode command from a webview keybinding to the host */
      kind: 'runCommand';
      requestId: string;
      command: string;
      args?: unknown[];
    };
