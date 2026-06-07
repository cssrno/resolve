import type { MonacoModule } from '../monaco/loader';
import type { HostBridge } from '../ipc/HostBridge';
import type { GrammarConfig, ThemeConfig } from '../../shared/protocol';
import { applyTheme } from '../monaco/ThemeApplier';
import { applyGrammar, vscodeToMonacoLanguage } from '../monaco/GrammarApplier';
import type { PaneGroup } from './PaneGroup';

/**
 * Shared boot routine for any view that needs Monaco grammar + theme set
 * before mounting editors. Both merge view and diff view call this so the
 * order (grammar BEFORE theme) and the wasm-URL derivation stay locked in
 * one place.
 */
export async function bootMonacoLanguage(
  monaco: MonacoModule,
  languageId: string,
  grammar: GrammarConfig | null,
  theme: ThemeConfig,
  monacoBaseUri: string,
): Promise<string> {
  const monacoLanguage = vscodeToMonacoLanguage(languageId);
  const onigWasmUrl = monacoBaseUri.replace(/\/vs\/?$/, '/onig.wasm');
  await applyGrammar(monaco, monacoLanguage, grammar, onigWasmUrl);
  applyTheme(monaco, theme);
  return monacoLanguage;
}

/**
 * Registers cmd/ctrl+z (undo), cmd/ctrl+shift+z and cmd/ctrl+y (redo) on
 * every editor in the group. If the focused pane's Monaco model has a
 * pending text edit to undo / redo, that one wins (so typing in an
 * editable pane behaves like a normal editor). Once Monaco's stack is
 * empty for that pane, the shortcut falls through to the host action
 * undo / redo (stage, unstage, revert, accept, etc.).
 */
export function registerUndoRedoCommands<PaneId extends string>(
  monaco: MonacoModule,
  group: PaneGroup<PaneId>,
  bridge: HostBridge,
): void {
  const { KeyMod, KeyCode } = monaco;
  const undoCombo = KeyMod.CtrlCmd | KeyCode.KeyZ;
  const redoComboShift = KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyZ;
  const redoComboY = KeyMod.CtrlCmd | KeyCode.KeyY;
  for (const editor of group.allEditors()) {
    editor.addCommand(undoCombo, () => {
      if (tryMonacoTextCommand(editor, 'undo')) return;
      bridge.send({ kind: 'undo' });
    });
    const redoHandler = (): void => {
      if (tryMonacoTextCommand(editor, 'redo')) return;
      bridge.send({ kind: 'redo' });
    };
    editor.addCommand(redoComboShift, redoHandler);
    editor.addCommand(redoComboY, redoHandler);
  }
  installGlobalUndoRedoFallback(bridge);
}

/**
 * Catches cmd/ctrl+z (and friends) at the window level so the host
 * action undo fires even when focus isn't inside a Monaco pane —
 * clicking a toolbar button or an action checkbox steals focus away
 * from the editor, but the user still expects cmd+z to work. When a
 * Monaco editor IS focused, we let the editor's own addCommand handler
 * take it instead (Monaco-first → host fallback inside its handler).
 */
function installGlobalUndoRedoFallback(bridge: HostBridge): void {
  window.addEventListener('keydown', (event) => {
    const isPrimary = event.metaKey || event.ctrlKey;
    if (!isPrimary || event.altKey) return;
    const key = event.key.toLowerCase();
    const isUndo = key === 'z' && !event.shiftKey;
    const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
    if (!isUndo && !isRedo) return;
    if (focusedInsideMonacoEditor()) return;
    event.preventDefault();
    bridge.send({ kind: isUndo ? 'undo' : 'redo' });
  });
}

function focusedInsideMonacoEditor(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  return active.closest('.monaco-editor') !== null;
}

/**
 * Triggers Monaco's native undo / redo iff there's something on the
 * editor's own text stack. Returns true when Monaco actually consumed the
 * event so the caller can skip the host fallback.
 */
function tryMonacoTextCommand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  kind: 'undo' | 'redo',
): boolean {
  const model = editor.getModel?.();
  if (!model) return false;
  const probe = kind === 'undo' ? model.canUndo?.bind(model) : model.canRedo?.bind(model);
  if (typeof probe !== 'function' || !probe()) return false;
  editor.trigger('keyboard', kind, null);
  return true;
}

/**
 * Mirrors each pane's Monaco cursor onto its line-number gutter column(s)
 * by toggling an `ln-active` class on the matching row. Each pane is
 * independent — moving the cursor in one editor never affects the others.
 *
 * The active row class is wiped whenever the gutter is re-painted, so the
 * returned `refreshAll()` must be called after every gutter rebuild to
 * reapply highlights for the current cursor positions.
 */
export class ActiveLinePerPane<PaneId extends string> {
  private readonly lastActiveByColumn = new Map<string, HTMLElement>();
  private readonly perPaneColumnIds: Array<{ paneId: PaneId; columnIds: readonly string[] }>;

  constructor(
    private readonly group: PaneGroup<PaneId>,
    columnIdsByPane: Record<PaneId, readonly string[]>,
  ) {
    this.perPaneColumnIds = group.paneIds().map((paneId) => ({
      paneId,
      columnIds: columnIdsByPane[paneId] ?? [],
    }));
    for (const { paneId, columnIds } of this.perPaneColumnIds) {
      const editor = group.editor(paneId);
      editor.onDidChangeCursorPosition((event: { position: { lineNumber: number } }) => {
        this.applyForPane(columnIds, event.position.lineNumber);
      });
    }
  }

  refreshAll(): void {
    this.lastActiveByColumn.clear();
    for (const { paneId, columnIds } of this.perPaneColumnIds) {
      const editor = this.group.editor(paneId);
      const position = editor.getPosition?.();
      if (position) this.applyForPane(columnIds, position.lineNumber);
    }
  }

  private applyForPane(columnIds: readonly string[], lineNumber: number): void {
    for (const columnId of columnIds) {
      const previousActive = this.lastActiveByColumn.get(columnId);
      if (previousActive) previousActive.classList.remove('ln-active');
      const container = document.querySelector(`#${columnId} .gutter-content`);
      if (!container) {
        this.lastActiveByColumn.delete(columnId);
        continue;
      }
      const targetRow = container.children[lineNumber - 1] as HTMLElement | undefined;
      if (targetRow) {
        targetRow.classList.add('ln-active');
        this.lastActiveByColumn.set(columnId, targetRow);
      } else {
        this.lastActiveByColumn.delete(columnId);
      }
    }
  }
}
