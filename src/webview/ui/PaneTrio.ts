import type { MonacoModule } from '../monaco/loader';
import type { EditorFontConfig } from '../../shared/protocol';
import { PaneGroup } from './PaneGroup';

export interface PaneTrioOptions {
  hostLocalId: string;
  hostResultId: string;
  hostRemoteId: string;
  font: EditorFontConfig;
  language: string;
}

export interface TrioContent {
  local: string;
  result: string;
  remote: string;
}

type TrioPaneId = 'local' | 'result' | 'remote';

/** 3 Monaco editors for the merge view. Local + Remote are readonly; Result accepts manual edits. */
export class PaneTrio {
  readonly group: PaneGroup<TrioPaneId>;
  readonly monaco: MonacoModule;
  readonly lineHeight: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly local: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly result: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly remote: any;

  constructor(monaco: MonacoModule, opts: PaneTrioOptions) {
    this.group = new PaneGroup<TrioPaneId>(monaco, {
      panes: [
        { id: 'local',  monacoHostId: opts.hostLocalId,  readOnly: true },
        { id: 'result', monacoHostId: opts.hostResultId, readOnly: false },
        { id: 'remote', monacoHostId: opts.hostRemoteId, readOnly: true },
      ],
      font: opts.font,
      language: opts.language,
    });
    this.monaco = this.group.monaco;
    this.lineHeight = this.group.lineHeight;
    this.local = this.group.editor('local');
    this.result = this.group.editor('result');
    this.remote = this.group.editor('remote');
  }

  setContent(content: TrioContent): void {
    this.group.setContent(content);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allEditors(): any[] {
    return this.group.allEditors();
  }
}
