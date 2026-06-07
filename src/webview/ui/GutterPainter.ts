import {
  interlineMarkerFor,
  resolvedAccentFor,
  type PaneId,
  type Section,
} from './Sections';
import { appendLnRow, clearAndGetGutterContent } from './GutterRowEmit';

/**
 * Maps each pane to the gutter column ids it controls. Walking ANY column in
 * one of these lists produces the same row sequence (heights, classes), so
 * scroll synchronization and decoration look identical across all of them.
 */
const GUTTER_COLUMN_IDS_BY_PANE: Record<PaneId, string[]> = {
  local:  ['space-l1', 'actions-left', 'ln-local'],
  result: ['ln-result-l', 'space-l2', 'space-r1', 'ln-result-r'],
  remote: ['ln-remote', 'actions-right', 'space-r2'],
};

const LINE_NUMBER_COLUMN_PREFIX = 'ln-';

/**
 * Paints colored rows into the gutter columns adjacent to each Monaco pane.
 * Each row in the gutter corresponds 1:1 to a code line in the Monaco pane
 * (line numbers shown only in the dedicated ln-* columns).
 *
 * Heights are driven by Monaco's effective line height so rows stay aligned
 * with the editor's rendered lines.
 */
export class GutterPainter {
  constructor(
    private readonly sections: Section[],
    private readonly lineHeightPx: number,
  ) {}

  paint(): void {
    for (const paneId of ['local', 'result', 'remote'] as const) {
      const columnIds = GUTTER_COLUMN_IDS_BY_PANE[paneId];
      const columnContents = columnIds.map((columnId) => clearAndGetGutterContent(columnId));
      const columnShowsLineNumbers = columnIds.map((columnId) =>
        columnId.startsWith(LINE_NUMBER_COLUMN_PREFIX),
      );

      let lineNumber = 0;
      let previousPaneClass = '';
      const lastEmittedRowPerColumn: (HTMLElement | null)[] = columnContents.map(() => null);
      // For zero-line sections we paint the marker on the previous row
      // (visual continuity with the colored band) but defer the
      // data-blockId to the NEXT emitted row so the action chevron lands
      // BELOW the gap, vertically aligned with the band on the opposite
      // pane.
      let pendingBlockIdForNextEmit: string | null = null;
      for (const section of this.sections) {
        if (section.kind === 'ctx-collapsed') {
          // One gray placeholder row standing in for N unchanged lines.
          // The line-number counter jumps past the WHOLE original range so
          // subsequent sections show their real file line numbers
          // (otherwise the gutter would lie about how many lines were
          // hidden). Placeholder itself has no number visible.
          const originalLineCount =
            section.collapsedEndLine - section.collapsedStartLine + 1;
          lineNumber += originalLineCount;
          columnContents.forEach((columnContent) => {
            appendLnRow(columnContent, {
              classNames: ['ctx-collapsed'],
              text: '',
              lineHeightPx: this.lineHeightPx,
            });
          });
          previousPaneClass = '';
          continue;
        }
        const sectionLineCount = section.paneLineCount[paneId];
        const sectionPaneClass = section.paneClass[paneId];
        const sectionBlockId = section.blockId;

        if (sectionLineCount === 0 && section.blockClass) {
          const markerColorClass = interlineMarkerFor(section.blockClass);
          if (markerColorClass) {
            lastEmittedRowPerColumn.forEach((previousRow) => {
              if (previousRow) previousRow.classList.add(`marker-bottom-${markerColorClass}`);
            });
          }
          if (sectionBlockId) pendingBlockIdForNextEmit = sectionBlockId;
        }

        const isSideOutlined = section.resolvedSides[paneId];
        for (let lineIndexInSection = 0; lineIndexInSection < sectionLineCount; lineIndexInSection++) {
          lineNumber++;
          const isAdjacentDivider =
            lineIndexInSection === 0 && sectionPaneClass !== '' && sectionPaneClass === previousPaneClass;
          const outlineEdgeClass = computeOutlineEdgeClass(
            isSideOutlined,
            lineIndexInSection,
            sectionLineCount,
          );
          const blockIdForRow =
            lineIndexInSection === 0
              ? sectionBlockId ?? pendingBlockIdForNextEmit
              : null;
          if (lineIndexInSection === 0 && pendingBlockIdForNextEmit) {
            pendingBlockIdForNextEmit = null;
          }
          const emittedRows = this.emitRowToEveryColumn(
            columnContents,
            columnShowsLineNumbers,
            lineNumber,
            sectionPaneClass,
            blockIdForRow,
            isAdjacentDivider,
            outlineEdgeClass,
          );
          if (isSideOutlined && outlineEdgeClass) {
            const accentColor = resolvedAccentFor(section.blockClass);
            emittedRows.forEach((emittedRow) =>
              emittedRow.setAttribute('data-resolved-color', accentColor),
            );
          }
          emittedRows.forEach((emittedRow, columnIndex) => {
            lastEmittedRowPerColumn[columnIndex] = emittedRow;
          });
        }
        if (sectionLineCount > 0 && sectionPaneClass) previousPaneClass = sectionPaneClass;
        else if (sectionLineCount > 0) previousPaneClass = '';
      }
    }
  }

  private emitRowToEveryColumn(
    columnContents: HTMLElement[],
    columnShowsLineNumbers: boolean[],
    lineNumber: number,
    paneClass: string,
    blockId: string | null,
    isAdjacentDivider: boolean,
    outlineEdgeClass: string,
  ): HTMLElement[] {
    return columnContents.map((columnContent, columnIndex) => {
      const classNames: string[] = [];
      if (paneClass) classNames.push(paneClass);
      if (isAdjacentDivider) classNames.push('block-divider');
      if (outlineEdgeClass) classNames.push(outlineEdgeClass);
      return appendLnRow(columnContent, {
        classNames,
        text: columnShowsLineNumbers[columnIndex] ? String(lineNumber) : '',
        lineHeightPx: this.lineHeightPx,
        dataAttributes: blockId ? { blockId } : undefined,
      });
    });
  }
}

function computeOutlineEdgeClass(
  isSideOutlined: boolean,
  lineIndexInSection: number,
  sectionLineCount: number,
): string {
  if (!isSideOutlined) return '';
  if (sectionLineCount === 1) return 'resolved-outline-single';
  if (lineIndexInSection === 0) return 'resolved-outline-top';
  if (lineIndexInSection === sectionLineCount - 1) return 'resolved-outline-bottom';
  return '';
}
