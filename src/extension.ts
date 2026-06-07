import * as vscode from 'vscode';
import { GitConflictParser } from './domain/parser/GitConflictParser';
import { UnifiedDiffParser } from './domain/parser/UnifiedDiffParser';
import { DetectConflicts } from './application/DetectConflicts';
import { DetectDiff } from './application/DetectDiff';
import { ApplyResolution } from './application/ApplyResolution';
import { ApplyDiffAction } from './application/ApplyDiffAction';
import { SaveResolvedFile } from './application/SaveResolvedFile';
import { OpenMergeView, type InitContextProvider } from './application/OpenMergeView';
import { OpenDiffView } from './application/OpenDiffView';
import { VSCodeFileSystem } from './adapters/VSCodeFileSystem';
import { VSCodeEditor } from './adapters/VSCodeEditor';
import { VSCodeWebview } from './adapters/VSCodeWebview';
import { ConflictDecorator } from './adapters/decorations/ConflictDecorator';
import { GitCli } from './adapters/GitCli';
import { registerCommands } from './adapters/commands/registerCommands';
import { FontBridge } from './adapters/bridges/FontBridge';
import { ThemeBridge } from './adapters/bridges/ThemeBridge';
import { KeybindingsBridge } from './adapters/bridges/KeybindingsBridge';
import { GrammarBridge } from './adapters/bridges/GrammarBridge';

export function activate(context: vscode.ExtensionContext): void {
  const parser = new GitConflictParser();
  const fs = new VSCodeFileSystem();
  const editor = new VSCodeEditor();
  const webview = new VSCodeWebview(context.extensionUri);

  const fontBridge = new FontBridge();
  const themeBridge = new ThemeBridge();
  const keybindingsBridge = new KeybindingsBridge();
  const grammarBridge = new GrammarBridge();
  const git = new GitCli();

  const initCtx: InitContextProvider = {
    font: () => fontBridge.read(),
    theme: () => themeBridge.read(),
    keybindings: () => keybindingsBridge.read(),
    grammarFor: (languageId) => grammarBridge.load(languageId),
    runCommand: async (command, args) => {
      await vscode.commands.executeCommand(command, ...(args ?? []));
    },
    fetchSymbols: async (uri) => fetchDocumentSymbols(uri),
    fetchMergeContext: async (uri) => {
      const fsPath = vscode.Uri.parse(uri).fsPath;
      const repoRoot = await git.findRepoRoot(fsPath);
      if (!repoRoot) return undefined;
      const ctx = await git.mergeContext(repoRoot);
      return ctx ?? undefined;
    },
  };

  const detect = new DetectConflicts(fs, parser);
  const apply = new ApplyResolution();
  const save = new SaveResolvedFile(fs);
  const openMergeView = new OpenMergeView(
    detect,
    apply,
    save,
    webview,
    editor,
    initCtx,
    resolveLanguageId,
  );

  const unifiedDiffParser = new UnifiedDiffParser();
  const detectDiff = new DetectDiff(fs, git, unifiedDiffParser);
  const applyDiff = new ApplyDiffAction(git, unifiedDiffParser);
  const openDiffView = new OpenDiffView(
    detectDiff,
    applyDiff,
    git,
    fs,
    webview,
    editor,
    initCtx,
    resolveLanguageId,
  );

  registerCommands(context, openMergeView, openDiffView, editor);
  context.subscriptions.push(new ConflictDecorator(parser));
  wireAutoDetect(context, openMergeView);
  wireGitDiffInterception(context, openDiffView);
  registerDiffViewerModeCommands(context);
}

/**
 * Registers the two helper commands the side-by-side viewer needs to
 * collaborate with VSCode's built-in diff editor: `setDiffViewerMode`
 * flips the workspace config, `openNativeDiff` opens VSCode's standard
 * 2-pane text diff for a given file URI (HEAD vs working tree).
 */
function registerDiffViewerModeCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'conflict.setDiffViewerMode',
      async (mode: 'side-by-side' | 'native') => {
        await vscode.workspace
          .getConfiguration('conflict.diffViewer')
          .update('mode', mode, vscode.ConfigurationTarget.Global);
      },
    ),
    vscode.commands.registerCommand('conflict.openNativeDiff', async (workingUriString: string) => {
      const workingUri = vscode.Uri.parse(workingUriString);
      // Built-in git extension exposes its head content via the `git:` URI
      // scheme with a query string. Mirrors what the SCM panel does
      // internally when staging a file's diff editor.
      const headUri = workingUri.with({ scheme: 'git', query: '{"ref":"HEAD"}' });
      const filename = workingUri.path.split('/').pop() ?? workingUri.path;
      await vscode.commands.executeCommand(
        'vscode.diff',
        headUri,
        workingUri,
        `${filename} (Working tree ↔ HEAD)`,
      );
    }),
    vscode.commands.registerCommand('conflict.jumpToWorkingFile', async (workingUriString: string) => {
      const workingUri = vscode.Uri.parse(workingUriString);
      const document = await vscode.workspace.openTextDocument(workingUri);
      await vscode.window.showTextDocument(document, { preview: false });
    }),
  );
}

/**
 * Watches for the built-in git extension opening a text-diff tab (Source
 * Control panel click). Closes it and routes the user to our diff view so
 * the SCM click flow lands on the IntelliJ-style 2-pane instead of
 * VSCode's default side-by-side editor.
 */
function wireGitDiffInterception(
  context: vscode.ExtensionContext,
  openDiffView: OpenDiffView,
): void {
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      // Honor the user's viewer preference — when set to 'native', let
      // VSCode's built-in diff editor render its own tab unmodified.
      const viewerMode = vscode.workspace
        .getConfiguration('conflict.diffViewer')
        .get<'side-by-side' | 'native'>('mode', 'side-by-side');
      if (viewerMode === 'native') return;
      for (const tab of event.opened) {
        const input = tab.input;
        if (!(input instanceof vscode.TabInputTextDiff)) continue;
        // Working-tree diff: modified is a normal file: URI.
        // Staged-changes diff: both sides are git: URIs but the path is
        // still the repo-relative path of the same file. We resolve it
        // to a file: URI before routing.
        const fileUri = resolveDiffFileUri(input.original, input.modified);
        if (!fileUri) continue;
        void vscode.window.tabGroups.close(tab).then(() => {
          void openDiffView.run(fileUri.toString());
        });
      }
    }),
  );
}

/**
 * Picks the underlying working-tree URI out of a TabInputTextDiff. Two
 * supported cases:
 *  - Working-tree diff: modified is `file:` (returned as-is).
 *  - Staged-changes diff: both sides are `git:`; the path already maps
 *    to the absolute file path, so swapping the scheme to `file` and
 *    stripping the query gives the working file URI.
 */
function resolveDiffFileUri(original: vscode.Uri, modified: vscode.Uri): vscode.Uri | null {
  if (modified.scheme === 'file' && original.scheme === 'git') return modified;
  if (original.scheme === 'git' && modified.scheme === 'git') {
    return modified.with({ scheme: 'file', query: '' });
  }
  return null;
}

/**
 * Scans every text document VSCode opens for git conflict markers. The
 * first time a conflicting file appears, the merge view is opened
 * automatically so the user doesn't have to invoke the command manually.
 * Tracks already-handled documents per session to avoid re-triggering when
 * the user switches tabs or saves.
 */
function wireAutoDetect(
  context: vscode.ExtensionContext,
  openMergeView: OpenMergeView,
): void {
  const handled = new Set<string>();
  const tryOpen = (document: vscode.TextDocument): void => {
    if (document.uri.scheme !== 'file') return;
    const key = document.uri.toString();
    if (handled.has(key)) return;
    if (!documentHasConflictMarkers(document)) return;
    handled.add(key);
    void openMergeView.run(key);
  };
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(tryOpen),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) tryOpen(editor.document);
    }),
  );
  // Scan already-open documents on activation so a conflict file that was
  // open before the extension loaded still triggers the merge view.
  vscode.workspace.textDocuments.forEach(tryOpen);
}

function documentHasConflictMarkers(document: vscode.TextDocument): boolean {
  const lineCount = document.lineCount;
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    if (document.lineAt(lineIndex).text.startsWith('<<<<<<<')) return true;
  }
  return false;
}

export function deactivate(): void {}

async function resolveLanguageId(uri: string): Promise<string> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    return doc.languageId;
  } catch {
    return 'plaintext';
  }
}

/**
 * Fetches the file's outline via VS Code's document symbol provider.
 * The provider returns either DocumentSymbol[] (nested) or
 * SymbolInformation[] (flat). Both shapes are normalized to a flat
 * array with explicit depth so the webview can render breadcrumbs
 * without rehydrating the tree.
 */
async function fetchDocumentSymbols(
  uri: string,
): Promise<import('./shared/protocol').DocumentSymbolDTO[]> {
  try {
    const parsed = vscode.Uri.parse(uri);
    const raw = await vscode.commands.executeCommand<unknown>(
      'vscode.executeDocumentSymbolProvider',
      parsed,
    );
    if (!Array.isArray(raw)) return [];
    const flat: import('./shared/protocol').DocumentSymbolDTO[] = [];
    const visit = (node: unknown, depth: number): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name : '';
      const kind = typeof record.kind === 'number' ? record.kind : 0;
      const detail = typeof record.detail === 'string' ? record.detail : undefined;
      // DocumentSymbol exposes .range (full body); SymbolInformation
      // exposes .location.range (definition only). Prefer the body
      // range so the breadcrumb knows the symbol's full footprint.
      const range = (record.range ?? (record.location as { range?: unknown })?.range) as
        | { start: { line: number }; end: { line: number } }
        | undefined;
      if (range) {
        flat.push({
          name,
          kind,
          detail,
          startLine: range.start.line + 1,
          endLine: range.end.line + 1,
          depth,
        });
      }
      const children = record.children;
      if (Array.isArray(children)) {
        for (const child of children) visit(child, depth + 1);
      }
    };
    for (const top of raw) visit(top, 0);
    return flat;
  } catch {
    return [];
  }
}
