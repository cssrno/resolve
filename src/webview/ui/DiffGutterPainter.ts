import { collapsedKey, type DiffSection, type HunkClass } from './DiffSections';
import { appendLnRow, clearAndGetGutterContent } from './GutterRowEmit';

type DiffPaneId = 'head' | 'working';

const GUTTER_COLUMN_IDS_BY_PANE: Record<DiffPaneId, string[]> = {
  head:    ['diff-space-l', 'diff-actions-revert', 'diff-ln-head'],
  working: ['diff-ln-working', 'diff-actions-stage', 'diff-space-r'],
};

/**
 * Paints colored bands per pane row plus inter-line markers at the
 * boundary of zero-line hunks. Adopts the merge-view convention: the
 * pane keeps real file lines, so each row in the gutter maps 1:1 to a
 * Monaco editor line. When a hunk has zero rows on one side (pure
 * insertion / deletion), the gutter draws a 2px stroke on the BOTTOM of
 * the previous row instead of materialising an empty row.
 */
export class DiffGutterPainter {
  constructor(
    private readonly sections: DiffSection[],
    private readonly lineHeightPx: number,
  ) {}

  paint(): void {
    for (const paneId of ['head', 'working'] as const) {
      const columnIds = GUTTER_COLUMN_IDS_BY_PANE[paneId];
      const columnContents = columnIds.map((columnId) => clearAndGetGutterContent(columnId));
      const columnShowsLineNumbers = columnIds.map((columnId) => columnId.startsWith('diff-ln-'));
      let realLineNumber = 0;
      const lastEmittedRowPerColumn: (HTMLElement | null)[] = columnContents.map(() => null);
      // When a zero-line hunk is encountered we paint the colored stroke
      // on the LAST emitted row (= "marker-bottom" above the gap), but
      // defer the data-hunkId to the NEXT row that will be emitted. This
      // places the action chevron BELOW the band on the side that has no
      // content, matching the user's visual expectation.
      let pendingHunkIdForNextEmit: string | null = null;
      for (let sectionIndex = 0; sectionIndex < this.sections.length; sectionIndex++) {
        const section = this.sections[sectionIndex]!;
        if (section.kind === 'ctx-collapsed') {
          // One placeholder row standing in for `headLineCount` real
          // unchanged lines. The line-number counter jumps past the whole
          // collapsed range so subsequent sections stay aligned with the
          // file's real numbering.
          realLineNumber += paneId === 'head' ? section.headLineCount : section.workingLineCount;
          columnContents.forEach((columnContent, columnIndex) => {
            const row = appendLnRow(columnContent, {
              classNames: ['ctx-collapsed'],
              // Line-number column is intentionally blank — there's no
              // single number that describes the collapsed range.
              text: '',
              lineHeightPx: this.lineHeightPx,
            });
            row.setAttribute('data-collapsed-key', collapsedKey(section));
            lastEmittedRowPerColumn[columnIndex] = row;
            void columnIndex;
          });
          continue;
        }
        const realRowCount =
          paneId === 'head' ? section.headLineCount : section.workingLineCount;
        const sectionClass = paneRowClass(section, paneId);
        if (realRowCount === 0 && section.kind === 'hunk') {
          const markerColor = interLineMarkerColor(section, paneId);
          if (markerColor) {
            lastEmittedRowPerColumn.forEach((previousRow) => {
              if (!previousRow) return;
              previousRow.classList.add(`marker-bottom-${markerColor}`);
            });
          }
          if (section.hunkId) pendingHunkIdForNextEmit = section.hunkId;
          continue;
        }
        for (let rowIndex = 0; rowIndex < realRowCount; rowIndex++) {
          realLineNumber++;
          const isFirstHunkRow = section.kind === 'hunk' && rowIndex === 0;
          const isLastHunkRow = section.kind === 'hunk' && rowIndex === realRowCount - 1;
          columnContents.forEach((columnContent, columnIndex) => {
            const classNames: string[] = [];
            if (sectionClass) classNames.push(sectionClass);
            // Edge classes carry the 1px horizontal trait at the band's top
            // and bottom, extending the bezier outline across the full
            // gutter width.
            if (isFirstHunkRow) classNames.push('hunk-edge-top');
            if (isLastHunkRow) classNames.push('hunk-edge-bottom');
            // Both gutters dim when the hunk isn't staged — the only
            // always-opaque element is the Monaco line band on the working
            // pane (= the current version's text), which is handled by
            // the decoration code, not here.
            if (section.kind === 'hunk' && !section.staged) {
              classNames.push('is-unstaged');
            }
            // First row of an actual hunk gets its own id; otherwise the
            // first row of a section RIGHT AFTER a zero-line hunk inherits
            // that hunk's id so the chevron lands below the gap.
            const hunkId =
              isFirstHunkRow && section.hunkId
                ? section.hunkId
                : rowIndex === 0 && pendingHunkIdForNextEmit
                  ? pendingHunkIdForNextEmit
                  : undefined;
            const row = appendLnRow(columnContent, {
              classNames,
              text: columnShowsLineNumbers[columnIndex] ? String(realLineNumber) : '',
              lineHeightPx: this.lineHeightPx,
              hunkId,
            });
            lastEmittedRowPerColumn[columnIndex] = row;
          });
          if (rowIndex === 0 && pendingHunkIdForNextEmit) {
            pendingHunkIdForNextEmit = null;
          }
        }
      }
    }
  }
}

function paneRowClass(section: DiffSection, paneId: DiffPaneId): string {
  if (section.kind !== 'hunk' || !section.hunkClass) return '';
  if (section.hunkClass === 'mod') return 'mod';
  if (section.hunkClass === 'add') return paneId === 'working' ? 'add' : '';
  return paneId === 'head' ? 'del' : '';
}

/**
 * Picks the marker color for a zero-line hunk side. From the working
 * pane's perspective a missing row means a HEAD line was removed
 * (red/del); from the HEAD pane's perspective it means working added
 * a row (green/add). For modifications we'd never have a zero side, so
 * the marker only ever encodes one direction.
 */
function interLineMarkerColor(
  section: DiffSection,
  paneId: DiffPaneId,
): 'add' | 'del' | 'mod' | null {
  if (!section.hunkClass) return null;
  if (section.hunkClass === 'add') return paneId === 'head' ? 'add' : null;
  if (section.hunkClass === 'del') return paneId === 'working' ? 'del' : null;
  // Mod hunks shouldn't normally hit this path (both sides non-zero).
  return paneId === 'head' ? 'add' : 'del';
}

// Re-export so the test bundler doesn't tree-shake it (not used at runtime).
export type { HunkClass };
