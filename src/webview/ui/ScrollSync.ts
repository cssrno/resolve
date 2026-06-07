import type { PaneTrio } from './PaneTrio';
import type { Section } from './Sections';
import { GenericScrollSync } from './GenericScrollSync';

type MergePaneId = 'local' | 'result' | 'remote';

const GUTTER_CELLS_BY_SIDE: Record<MergePaneId, readonly string[]> = {
  local:  ['space-l1', 'actions-left', 'ln-local'],
  result: ['ln-result-l', 'space-l2', 'space-r1', 'ln-result-r'],
  remote: ['ln-remote', 'actions-right', 'space-r2'],
};

/**
 * Merge view scroll sync. Thin wrapper around GenericScrollSync that
 * adapts merge sections (paneLineCount) into the generic per-pane line
 * count contract.
 */
export class ScrollSync {
  private readonly engine: GenericScrollSync<MergePaneId>;

  constructor(
    private readonly trio: PaneTrio,
    private readonly lineHeight: number,
    onAfterScroll: () => void,
  ) {
    this.engine = new GenericScrollSync<MergePaneId>(
      trio.group,
      GUTTER_CELLS_BY_SIDE,
      lineHeight,
      onAfterScroll,
    );
  }

  setSections(sections: Section[]): void {
    this.engine.setSections(sections, (section) => ({
      local: section.paneLineCount.local,
      result: section.paneLineCount.result,
      remote: section.paneLineCount.remote,
    }));
  }

  recommit(): void {
    this.engine.recommit();
  }

  attach(): void {
    this.engine.attach();
  }

  setSyncEnabled(enabled: boolean): void {
    this.engine.setSyncEnabled(enabled);
  }

  scrollToSection(sectionIndex: number): void {
    const virtualY = this.engine.virtualStartOfSection(sectionIndex);
    if (virtualY === null) return;
    this.engine.scrollToVirtualY(virtualY);
  }

  currentSectionIndex(): number {
    return this.engine.currentSectionIndexForPane('result');
  }
}
