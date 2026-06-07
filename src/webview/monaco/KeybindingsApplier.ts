import type { MonacoModule } from './loader';
import type { KeybindingDTO } from '../../shared/protocol';
import type { HostBridge } from '../ipc/HostBridge';

/**
 * Registers every keybinding the host parsed from the user's keybindings.json
 * on the given Monaco editor instance.
 *
 *  - If the bound command starts with `editor.` / `cursor` etc. (Monaco-native),
 *    Monaco's built-in trigger handles it.
 *  - Otherwise the action is relayed to the extension host via runCommand,
 *    which dispatches `vscode.commands.executeCommand(...)`.
 *
 * `when` clauses are mostly ignored in v1 — we let Monaco's own context apply
 * for native commands, and unconditionally relay the rest.
 */
export function applyKeybindings(
  monaco: MonacoModule,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  bindings: KeybindingDTO[],
  bridge: HostBridge,
): void {
  for (const kb of bindings) {
    if (!kb.monacoKey) continue;
    editor.addCommand(kb.monacoKey, () => {
      if (isMonacoNativeCommand(kb.command)) {
        editor.trigger('keyboard', kb.command, null);
      } else {
        bridge.runCommand(kb.command).catch(() => {
          // Silently swallow — most VSCode commands need an active TextEditor
          // and will reject; this is expected and not user-actionable.
        });
      }
    });
  }
}

function isMonacoNativeCommand(command: string): boolean {
  return (
    command.startsWith('editor.') ||
    command.startsWith('cursor') ||
    command.startsWith('undo') ||
    command.startsWith('redo') ||
    command.startsWith('selectAll') ||
    command === 'tab' ||
    command === 'outdent'
  );
}
