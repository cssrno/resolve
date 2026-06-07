import type {
  ConflictFileDTO,
  EditorFontConfig,
  GrammarConfig,
  HostToWebview,
  KeybindingDTO,
  ThemeConfig,
  WebviewToHost,
} from '../shared/protocol';
import { mountMergeApp } from './ui/MergeApp';
import { mountDiffApp } from './ui/DiffApp';
import { loadMonaco } from './monaco/loader';
import { HostBridge } from './ipc/HostBridge';

declare global {
  interface Window {
    MonacoEnvironment: { getWorkerUrl: (moduleId: string, label: string) => string };
  }
}

const bridge = new HostBridge();

bridge.on(async (msg: HostToWebview) => {
  if (msg.kind === 'init') {
    try {
      const monaco = await loadMonaco(msg.monacoBaseUri);
      await mountMergeApp(monaco, bridge, {
        file: msg.file,
        font: msg.font,
        theme: msg.theme,
        keybindings: msg.keybindings,
        grammar: msg.grammar,
        monacoBaseUri: msg.monacoBaseUri,
      });
    } catch (e) {
      showFatalError((e as Error).message);
    }
    return;
  }
  if (msg.kind === 'initDiff') {
    try {
      const monaco = await loadMonaco(msg.monacoBaseUri);
      await mountDiffApp(monaco, bridge, {
        file: msg.file,
        font: msg.font,
        theme: msg.theme,
        keybindings: msg.keybindings,
        grammar: msg.grammar,
        monacoBaseUri: msg.monacoBaseUri,
      });
    } catch (e) {
      showFatalError((e as Error).message);
    }
    return;
  }
});

function showFatalError(message: string): void {
  const status = document.getElementById('status');
  if (status) status.textContent = `Error: ${message}`;
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:80px 40px auto 40px;padding:16px;background:#3a0c0c;color:#ffb0b0;white-space:pre-wrap;font-family:monospace;font-size:12px;border-radius:4px;z-index:9999';
  box.textContent = message;
  document.body.appendChild(box);
}

bridge.send({ kind: 'ready' });

// Re-export init payload type for downstream modules
export interface InitPayload {
  file: ConflictFileDTO;
  font: EditorFontConfig;
  theme: ThemeConfig;
  keybindings: KeybindingDTO[];
  grammar: GrammarConfig | null;
  monacoBaseUri: string;
  symbols?: import('../shared/protocol').DocumentSymbolDTO[];
}

// Keep these symbols referenced so the bundler doesn't tree-shake the types
export type { WebviewToHost };
