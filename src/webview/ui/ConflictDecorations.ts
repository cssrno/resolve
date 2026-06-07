import type { PaneTrio } from './PaneTrio';
import {
  interlineMarkerFor,
  resolvedAccentFor,
  type PaneId,
  type Section,
} from './Sections';

interface MonacoLineRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface MonacoDecoration {
  range: MonacoLineRange;
  options: {
    isWholeLine: boolean;
    className: string;
    inlineClassName?: string;
  };
}

/**
 * Highlights conflict blocks inside each Monaco editor using whole-line
 * decorations. CSS classes (declared in index.html) tint the line background
 * with the same color used by the gutter ln-rows and the bezier overlay,
 * giving us the cross-column color continuity the demo HTML enforced.
 */
export class ConflictDecorations {
  // Monaco's decoration collection type isn't exported from our loader stub.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private activeDecorationCollections: any[] = [];

  constructor(private readonly paneTrio: PaneTrio) {}

  apply(sections: Section[]): void {
    for (const collection of this.activeDecorationCollections) collection.clear();
    this.activeDecorationCollections = [];

    for (const paneId of ['local', 'result', 'remote'] as const) {
      const editor = this.editorFor(paneId);
      const decorations = this.computeDecorationsForPane(sections, paneId);
      this.activeDecorationCollections.push(editor.createDecorationsCollection(decorations));
    }
  }

  private editorFor(paneId: PaneId): PaneTrio['local'] {
    switch (paneId) {
      case 'local':  return this.paneTrio.local;
      case 'result': return this.paneTrio.result;
      case 'remote': return this.paneTrio.remote;
    }
  }

  private computeDecorationsForPane(sections: Section[], paneId: PaneId): MonacoDecoration[] {
    const decorations: MonacoDecoration[] = [];
    let currentEditorLine = 1;
    let previousPaneClass = '';

    for (const section of sections) {
      if (section.kind === 'ctx-collapsed') {
        decorations.push({
          range: wholeLineRange(currentEditorLine, currentEditorLine),
          options: {
            isWholeLine: true,
            className: 'ctx-collapsed-line',
            inlineClassName: 'ctx-collapsed-text',
          },
        });
        currentEditorLine += section.paneLineCount[paneId];
        previousPaneClass = '';
        continue;
      }
      const sectionLineCount = section.paneLineCount[paneId];
      const sectionPaneClass = section.paneClass[paneId];

      // Zero-line section on this side: a 2px colored stroke at the bottom of
      // the previous line marks the deletion landing point.
      if (sectionLineCount === 0 && section.blockClass && currentEditorLine > 1) {
        const markerColor = interlineMarkerFor(section.blockClass);
        if (markerColor) {
          decorations.push({
            range: wholeLineRange(currentEditorLine - 1, currentEditorLine - 1),
            options: { isWholeLine: true, className: `conflict-marker-${markerColor}` },
          });
        }
      }

      if (sectionLineCount > 0 && sectionPaneClass) {
        const isAdjacentSameColorBlock = previousPaneClass === sectionPaneClass;
        if (isAdjacentSameColorBlock) {
          // First line of the next same-color block gets a "divided" overlay
          // (a 2px bg-color top strip) so the boundary is visible.
          decorations.push({
            range: wholeLineRange(currentEditorLine, currentEditorLine),
            options: {
              isWholeLine: true,
              className: `conflict-line-${sectionPaneClass} conflict-line-divided`,
            },
          });
          if (sectionLineCount > 1) {
            decorations.push({
              range: wholeLineRange(currentEditorLine + 1, currentEditorLine + sectionLineCount - 1),
              options: { isWholeLine: true, className: `conflict-line-${sectionPaneClass}` },
            });
          }
        } else {
          decorations.push({
            range: wholeLineRange(currentEditorLine, currentEditorLine + sectionLineCount - 1),
            options: { isWholeLine: true, className: `conflict-line-${sectionPaneClass}` },
          });
        }
      }

      if (section.resolvedSides[paneId] && sectionLineCount > 0) {
        const accentColor = resolvedAccentFor(section.blockClass);
        for (let lineIndexInSection = 0; lineIndexInSection < sectionLineCount; lineIndexInSection++) {
          const edgeClass = computeMonacoOutlineEdgeClass(lineIndexInSection, sectionLineCount);
          if (!edgeClass) continue;
          decorations.push({
            range: wholeLineRange(
              currentEditorLine + lineIndexInSection,
              currentEditorLine + lineIndexInSection,
            ),
            options: {
              isWholeLine: true,
              className: `conflict-line-${edgeClass} ${accentColor}`,
            },
          });
        }
      }
      previousPaneClass = sectionLineCount > 0 ? sectionPaneClass : previousPaneClass;
      currentEditorLine += sectionLineCount;
    }
    return decorations;
  }
}

function wholeLineRange(startLine: number, endLine: number): MonacoLineRange {
  return { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: 1 };
}

function computeMonacoOutlineEdgeClass(lineIndexInSection: number, sectionLineCount: number): string {
  if (sectionLineCount === 1) return 'resolved-outline-single';
  if (lineIndexInSection === 0) return 'resolved-outline-top';
  if (lineIndexInSection === sectionLineCount - 1) return 'resolved-outline-bottom';
  return '';
}
