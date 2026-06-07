import type { HostBridge } from '../ipc/HostBridge';
import type { DiffSection } from './DiffSections';

/** Double chevron pointing right — revert the hunk into the working tree. */
const REVERT_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="3,3 8,8 3,13"/><polyline points="8,3 13,8 8,13"/></svg>';

/**
 * Renders one revert chevron per hunk in the left action column and one
 * stage/unstage checkbox per hunk in the right action column. Buttons are
 * anchored to the first ln-row of their hunk inside the gutter so they
 * scroll with the editor content.
 */
export class DiffActionButtons {
  constructor(private readonly bridge: HostBridge) {}

  render(sections: readonly DiffSection[]): void {
    document.querySelectorAll('.diff-zone-actions').forEach((el) => el.remove());
    this.placeOnEdge(sections, 'diff-actions-revert', (hunkId) => this.makeRevertButton(hunkId));
    this.placeOnEdge(sections, 'diff-actions-stage', (hunkId, section) =>
      this.makeStageCheckbox(hunkId, section.staged),
    );
  }

  private placeOnEdge(
    sections: readonly DiffSection[],
    columnId: string,
    factory: (hunkId: string, section: DiffSection) => HTMLElement,
  ): void {
    const anchorRows = document.querySelectorAll<HTMLElement>(
      `#${columnId} .gutter-content .ln-row[data-hunk-id]`,
    );
    const sectionByHunkId = new Map<string, DiffSection>();
    for (const section of sections) {
      if (section.hunkId) sectionByHunkId.set(section.hunkId, section);
    }
    anchorRows.forEach((anchorRow) => {
      const hunkId = anchorRow.dataset.hunkId!;
      const section = sectionByHunkId.get(hunkId);
      if (!section) return;
      anchorRow.style.position = 'relative';
      anchorRow.style.overflow = 'visible';
      const wrap = document.createElement('div');
      wrap.className = 'diff-zone-actions';
      wrap.style.top = '50%';
      wrap.style.transform = 'translate(-50%, -50%)';
      wrap.appendChild(factory(hunkId, section));
      anchorRow.appendChild(wrap);
    });
  }

  private makeRevertButton(hunkId: string): HTMLElement {
    const button = document.createElement('button');
    button.className = 'icon-btn';
    button.title = 'Revert this change';
    button.innerHTML = REVERT_ICON;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.bridge.send({ kind: 'revertHunk', hunkId });
    });
    return button;
  }

  private makeStageCheckbox(hunkId: string, staged: boolean): HTMLElement {
    const label = document.createElement('label');
    label.className = 'stage-checkbox';
    label.title = staged ? 'Unstage this change' : 'Stage this change';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = staged;
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('change', () => {
      this.bridge.send({
        kind: input.checked ? 'stageHunk' : 'unstageHunk',
        hunkId,
      });
    });
    label.appendChild(input);
    return label;
  }
}
