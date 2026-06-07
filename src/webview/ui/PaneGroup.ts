import type { MonacoModule } from '../monaco/loader';
import type { EditorFontConfig } from '../../shared/protocol';

export interface PaneSpec<PaneId extends string> {
  readonly id: PaneId;
  readonly monacoHostId: string;
  readonly readOnly: boolean;
}

export interface PaneGroupOptions<PaneId extends string> {
  readonly panes: readonly PaneSpec<PaneId>[];
  readonly font: EditorFontConfig;
  readonly language: string;
}

/**
 * Generic N-pane container of Monaco editors. Replaces PaneTrio and
 * PaneDuo by parameterising on the pane ids and host element ids — the
 * shared options block (no chrome, no native scrollbar) lives here so
 * both views render identically.
 */
export class PaneGroup<PaneId extends string> {
  readonly monaco: MonacoModule;
  readonly lineHeight: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly editorsById: Map<PaneId, any> = new Map();

  constructor(monaco: MonacoModule, options: PaneGroupOptions<PaneId>) {
    this.monaco = monaco;
    this.lineHeight = options.font.lineHeight > 0
      ? options.font.lineHeight
      : Math.round(options.font.fontSize * 1.5);
    const commonOptions = {
      language: options.language,
      automaticLayout: true,
      fontFamily: options.font.fontFamily,
      fontSize: options.font.fontSize,
      lineHeight: this.lineHeight,
      letterSpacing: options.font.letterSpacing,
      tabSize: options.font.tabSize,
      insertSpaces: options.font.insertSpaces,
      renderWhitespace: options.font.renderWhitespace,
      lineNumbers: 'off' as const,
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      minimap: { enabled: false },
      scrollbar: {
        vertical: 'auto' as const,
        horizontal: 'auto' as const,
        useShadows: false,
        verticalScrollbarSize: 10,
      },
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollBeyondLastLine: false,
      wordWrap: 'off' as const,
      contextmenu: true,
    };
    for (const pane of options.panes) {
      const hostElement = document.getElementById(pane.monacoHostId);
      if (!hostElement) throw new Error(`PaneGroup: host element missing: ${pane.monacoHostId}`);
      const editor = monaco.editor.create(hostElement, {
        ...commonOptions,
        value: '',
        readOnly: pane.readOnly,
      });
      this.editorsById.set(pane.id, editor);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor(paneId: PaneId): any {
    const editor = this.editorsById.get(paneId);
    if (!editor) throw new Error(`PaneGroup: unknown pane id ${paneId}`);
    return editor;
  }

  setContent(contentByPane: Partial<Record<PaneId, string>>): void {
    for (const [paneId, value] of Object.entries(contentByPane) as Array<[PaneId, string | undefined]>) {
      if (value === undefined) continue;
      const editor = this.editor(paneId);
      if (editor.getValue() !== value) editor.setValue(value);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allEditors(): any[] {
    return Array.from(this.editorsById.values());
  }

  paneIds(): PaneId[] {
    return Array.from(this.editorsById.keys());
  }
}
