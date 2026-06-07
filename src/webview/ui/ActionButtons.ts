import type { HostBridge } from '../ipc/HostBridge';
import type { Section, BlockClass } from './Sections';

const ICONS = {
  chevronRight: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,3 8,8 3,13"/><polyline points="8,3 13,8 8,13"/></svg>',
  chevronLeft:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="13,3 8,8 13,13"/><polyline points="8,3 3,8 8,13"/></svg>',
  cross:        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',
};

type GutterEdge = 'left' | 'right';

/**
 * Attaches action button wraps (accept + reset) to the first ln-row of each
 * conflict block in `actions-left` / `actions-right`. Buttons inherit the
 * gutter-content transform, so they scroll with the rows naturally.
 *
 * Visibility rule (must mirror Sections.shouldShowActionButtons):
 *   - hidden once the corresponding pane has been consumed by the resolution
 *   - hidden on the gutter that doesn't correspond to a one-sided change
 *     (e.g. localAdd shows only on the left gutter)
 */
export class ActionButtons {
  constructor(private readonly bridge: HostBridge) {}

  render(sections: Section[]): void {
    document.querySelectorAll('.zone-actions').forEach((wrap) => wrap.remove());
    const blockClassById = new Map<string, BlockClass | null>();
    const consumedBlockIdsByEdge: Record<GutterEdge, Set<string>> = {
      left: new Set(),
      right: new Set(),
    };
    for (const section of sections) {
      if (!section.blockId) continue;
      blockClassById.set(section.blockId, section.blockClass);
      if (section.resolvedSides.local) consumedBlockIdsByEdge.left.add(section.blockId);
      if (section.resolvedSides.remote) consumedBlockIdsByEdge.right.add(section.blockId);
    }
    this.placeButtonsForEdge('actions-left', 'left', blockClassById, consumedBlockIdsByEdge.left);
    this.placeButtonsForEdge('actions-right', 'right', blockClassById, consumedBlockIdsByEdge.right);
  }

  private placeButtonsForEdge(
    actionColumnId: string,
    edge: GutterEdge,
    blockClassById: Map<string, BlockClass | null>,
    consumedBlockIds: Set<string>,
  ): void {
    const blockAnchorRows = document.querySelectorAll<HTMLElement>(
      `#${actionColumnId} .gutter-content .ln-row[data-block-id]`,
    );
    blockAnchorRows.forEach((anchorRow) => {
      const blockId = anchorRow.dataset.blockId!;
      if (consumedBlockIds.has(blockId)) return;
      const blockClass = blockClassById.get(blockId);
      if (blockClass && blockClass !== 'conflict') {
        const blockBelongsToLocalSide =
          blockClass === 'localAdd' || blockClass === 'localMod' || blockClass === 'localDel';
        if (edge === 'left'  && !blockBelongsToLocalSide) return;
        if (edge === 'right' &&  blockBelongsToLocalSide) return;
      }
      anchorRow.style.position = 'relative';
      anchorRow.style.overflow = 'visible';
      const buttonWrap = document.createElement('div');
      buttonWrap.className = 'zone-actions';
      buttonWrap.style.top = '50%';
      buttonWrap.style.transform = 'translate(-50%, -50%)';

      const acceptButton = this.makeIconButton(
        edge === 'left' ? ICONS.chevronRight : ICONS.chevronLeft,
        edge === 'left' ? 'Accept local' : 'Accept remote',
        () => this.bridge.send({ kind: 'acceptSide', blockId, side: edge }),
      );
      const rejectButton = this.makeIconButton(ICONS.cross, 'Reject', () =>
        this.bridge.send({ kind: 'reject', blockId, side: edge }),
      );
      // Chevron always sits closest to the Result column (center pane).
      if (edge === 'left') buttonWrap.append(rejectButton, acceptButton);
      else buttonWrap.append(acceptButton, rejectButton);
      anchorRow.appendChild(buttonWrap);
    });
  }

  private makeIconButton(svg: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'icon-btn';
    button.title = title;
    button.innerHTML = svg;
    button.addEventListener('click', (clickEvent) => {
      clickEvent.stopPropagation();
      onClick();
    });
    return button;
  }
}
