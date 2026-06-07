import type { PaneGroup } from './PaneGroup';

interface SectionPlanEntry<PaneId extends string> {
  readonly virtualStart: number;
  readonly virtualHeight: number;
  readonly starts: Record<PaneId, number>;
  readonly heights: Record<PaneId, number>;
}

/**
 * Virtual scroll engine shared by merge view and diff view. Walks a
 * section list whose per-pane line counts may differ and maps a single
 * virtual scroll cursor to a per-pane actual scrollTop. Each pane scrolls
 * at its own rate within a section so context lines stay visually
 * aligned even when neighbouring hunks have asymmetric pane heights.
 *
 * Gutter columns are kept in sync via CSS transforms — they sit outside
 * the editor DOM so we mirror the editor scrollTop ourselves.
 */
export class GenericScrollSync<PaneId extends string> {
  private virtualY = 0;
  private hOffset = 0;
  private pending = false;
  private sectionPlan: SectionPlanEntry<PaneId>[] = [];
  private virtualHeight = 0;
  private syncEnabled = true;

  constructor(
    private readonly group: PaneGroup<PaneId>,
    private readonly columnIdsByPane: Record<PaneId, readonly string[]>,
    private readonly lineHeight: number,
    private readonly onAfterScroll: () => void,
  ) {}

  setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled;
  }

  /**
   * Recompute the section plan from a fresh section list. `extractHeights`
   * is the only mode-specific hook — each section type maps to a
   * per-pane line count its own way.
   */
  setSections<Section>(
    sections: readonly Section[],
    extractHeights: (section: Section) => Record<PaneId, number>,
  ): void {
    const paneIds = this.group.paneIds();
    const plan: SectionPlanEntry<PaneId>[] = [];
    const cursor: Record<PaneId, number> = emptyRecord(paneIds);
    let virtualStart = 0;
    for (const section of sections) {
      const lineCounts = extractHeights(section);
      const heights: Record<PaneId, number> = emptyRecord(paneIds);
      let virtualHeight = 0;
      for (const paneId of paneIds) {
        const height = lineCounts[paneId] * this.lineHeight;
        heights[paneId] = height;
        if (height > virtualHeight) virtualHeight = height;
      }
      const starts: Record<PaneId, number> = {} as Record<PaneId, number>;
      for (const paneId of paneIds) starts[paneId] = cursor[paneId];
      plan.push({ virtualStart, virtualHeight, starts, heights });
      virtualStart += virtualHeight;
      for (const paneId of paneIds) cursor[paneId] += heights[paneId];
    }
    this.sectionPlan = plan;
    this.virtualHeight = virtualStart;
  }

  recommit(): void {
    this.applyScroll(this.virtualY);
  }

  /** Programmatic jump — used by toolbar prev/next-diff buttons. */
  scrollToVirtualY(virtualY: number): void {
    this.applyScroll(virtualY);
  }

  /**
   * Looks up the virtual Y at which the given section starts. Returns
   * null when the index is out of range.
   */
  virtualStartOfSection(sectionIndex: number): number | null {
    if (sectionIndex < 0 || sectionIndex >= this.sectionPlan.length) return null;
    return this.sectionPlan[sectionIndex]!.virtualStart;
  }

  /**
   * Returns the index of the section currently at the viewport top of
   * the given pane. Looks at the pane's actual scrollTop, which is
   * correct whether sync is on (driven by virtual scroll) or off (each
   * pane scrolling natively).
   */
  currentSectionIndexForPane(paneId: PaneId): number {
    if (this.sectionPlan.length === 0) return -1;
    const scrollTop = this.group.editor(paneId).getScrollTop();
    for (let index = this.sectionPlan.length - 1; index >= 0; index--) {
      if (this.sectionPlan[index]!.starts[paneId] <= scrollTop) return index;
    }
    return 0;
  }

  attach(): void {
    const app = document.getElementById('app');
    if (!app) return;
    let hPending = false;
    app.addEventListener(
      'wheel',
      (rawEvent) => {
        const wheelEvent = rawEvent as WheelEvent;
        if (!this.syncEnabled) return;
        if (wheelEvent.deltaY !== 0) {
          wheelEvent.preventDefault();
          this.applyScroll(this.virtualY + wheelEvent.deltaY);
        }
        if (wheelEvent.deltaX !== 0) {
          wheelEvent.preventDefault();
          this.hOffset += wheelEvent.deltaX;
          if (!hPending) {
            hPending = true;
            requestAnimationFrame(() => {
              hPending = false;
              const next = Math.max(0, this.hOffset);
              for (const editor of this.group.allEditors()) editor.setScrollLeft(next, 1);
              this.hOffset = next;
            });
          }
        }
      },
      { passive: false, capture: true },
    );
    window.addEventListener('keydown', (event) => {
      if (!this.syncEnabled) return;
      const allowed = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];
      if (!allowed.includes(event.key)) return;
      const step = this.lineHeight;
      const page = window.innerHeight * 0.85;
      if (event.key === 'ArrowDown') this.applyScroll(this.virtualY + step);
      else if (event.key === 'ArrowUp') this.applyScroll(this.virtualY - step);
      else if (event.key === 'PageDown') this.applyScroll(this.virtualY + page);
      else if (event.key === 'PageUp') this.applyScroll(this.virtualY - page);
      else if (event.key === 'Home') this.applyScroll(0);
      else if (event.key === 'End') this.applyScroll(1e9);
      event.preventDefault();
    });
    // When sync is OFF, each Monaco pane scrolls itself via its own
    // wheel handler. We piggyback on `onDidScrollChange` to (a) keep the
    // gutter columns of that pane glued to its content via the same
    // transform we apply in sync mode, and (b) re-trigger the bezier
    // overlay so the corridor follows the per-pane positions.
    for (const paneId of this.group.paneIds()) {
      const editor = this.group.editor(paneId);
      editor.onDidScrollChange((event: { scrollTop: number }) => {
        if (this.syncEnabled) return;
        this.transformGuttersForPane(paneId, event.scrollTop);
        this.onAfterScroll();
      });
    }
  }

  private applyScroll(nextVirtualY: number): void {
    const maxVirtual = this.computeMaxVirtual();
    this.virtualY = Math.max(0, Math.min(maxVirtual, nextVirtualY));
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.commit();
    });
  }

  private computeMaxVirtual(): number {
    if (this.sectionPlan.length === 0) return 0;
    let maxOverPanes = 0;
    for (const paneId of this.group.paneIds()) {
      const editor = this.group.editor(paneId);
      const paneMaxScroll = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height);
      let stoppedAtSection = false;
      for (const section of this.sectionPlan) {
        const height = section.heights[paneId];
        const start = section.starts[paneId];
        if (start + height >= paneMaxScroll) {
          const candidate = section.virtualStart + (paneMaxScroll - start);
          if (candidate > maxOverPanes) maxOverPanes = candidate;
          stoppedAtSection = true;
          break;
        }
      }
      if (!stoppedAtSection) {
        const last = this.sectionPlan[this.sectionPlan.length - 1]!;
        const candidate = last.virtualStart + last.virtualHeight;
        if (candidate > maxOverPanes) maxOverPanes = candidate;
      }
    }
    return Math.max(0, maxOverPanes);
  }

  private commit(): void {
    for (const paneId of this.group.paneIds()) {
      const actualY = this.actualYFor(paneId, this.virtualY);
      const editor = this.group.editor(paneId);
      const paneMaxScroll = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height);
      const clampedActualY = Math.min(actualY, paneMaxScroll);
      editor.setScrollTop(clampedActualY, 1);
      this.transformGuttersForPane(paneId, clampedActualY);
    }
    this.onAfterScroll();
  }

  private transformGuttersForPane(paneId: PaneId, scrollTop: number): void {
    const transformValue = `translateY(${-scrollTop}px)`;
    for (const cellId of this.columnIdsByPane[paneId]) {
      const cellContent = document.querySelector(`#${cellId} .gutter-content`) as HTMLElement | null;
      if (cellContent) cellContent.style.transform = transformValue;
    }
  }

  private actualYFor(paneId: PaneId, virtualY: number): number {
    if (this.sectionPlan.length === 0) return 0;
    for (const section of this.sectionPlan) {
      if (virtualY < section.virtualStart + section.virtualHeight) {
        const delta = virtualY - section.virtualStart;
        return section.starts[paneId] + Math.min(delta, section.heights[paneId]);
      }
    }
    const last = this.sectionPlan[this.sectionPlan.length - 1]!;
    return last.starts[paneId] + last.heights[paneId];
  }
}

function emptyRecord<PaneId extends string>(paneIds: readonly PaneId[]): Record<PaneId, number> {
  const out: Record<PaneId, number> = {} as Record<PaneId, number>;
  for (const paneId of paneIds) out[paneId] = 0;
  return out;
}
