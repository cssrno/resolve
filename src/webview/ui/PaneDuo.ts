import type { MonacoModule } from '../monaco/loader';
import type { EditorFontConfig } from '../../shared/protocol';
import { PaneGroup } from './PaneGroup';

export interface PaneDuoOptions {
  hostHeadId: string;
  hostWorkingId: string;
  font: EditorFontConfig;
  language: string;
}

export interface DuoContent {
  head: string;
  working: string;
}

type DuoPaneId = 'head' | 'working';

/** 2 Monaco editors for the diff view. HEAD readonly; working editable. */
export class PaneDuo {
  readonly group: PaneGroup<DuoPaneId>;
  readonly monaco: MonacoModule;
  readonly lineHeight: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly head: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly working: any;

  constructor(monaco: MonacoModule, opts: PaneDuoOptions) {
    this.group = new PaneGroup<DuoPaneId>(monaco, {
      panes: [
        { id: 'head',    monacoHostId: opts.hostHeadId,    readOnly: true  },
        { id: 'working', monacoHostId: opts.hostWorkingId, readOnly: false },
      ],
      font: opts.font,
      language: opts.language,
    });
    this.monaco = this.group.monaco;
    this.lineHeight = this.group.lineHeight;
    this.head = this.group.editor('head');
    this.working = this.group.editor('working');
  }

  setContent(content: Partial<DuoContent>): void {
    this.group.setContent(content);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allEditors(): any[] {
    return this.group.allEditors();
  }
}
