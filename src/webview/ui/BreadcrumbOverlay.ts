import type { PaneTrio } from './PaneTrio';
import type { PaneId, Section } from './Sections';
import type { DocumentSymbolDTO } from '../../shared/protocol';
import { setBandHoverByKey } from './CollapsedBandOverlay';

/**
 * Floats one breadcrumb chip per pane over every ctx-collapsed
 * placeholder row. The chip carries the gray pill + italic class/method
 * label and sits ABOVE the wavy stroke painted by BezierOverlay (the
 * chip's z-index in CSS dominates the wave). Re-renders on every paint
 * + scroll callback so chips track the editor's vertical motion.
 */
export class BreadcrumbOverlay {
  private sections: Section[] = [];
  private symbols: readonly DocumentSymbolDTO[] = [];

  constructor(private readonly paneTrio: PaneTrio) {}

  setSections(sections: Section[]): void {
    this.sections = sections;
  }

  setSymbols(symbols: readonly DocumentSymbolDTO[]): void {
    this.symbols = symbols;
  }

  render(): void {
    document.querySelectorAll('.ctx-breadcrumb-chip').forEach((node) => node.remove());
    for (const paneId of ['local', 'result', 'remote'] as const) {
      this.renderForPane(paneId);
    }
  }

  private renderForPane(paneId: PaneId): void {
    const editor = this.editorFor(paneId);
    const paneContainer = document.getElementById(`pane-${paneId}`);
    const appContainer = document.getElementById('app');
    if (!paneContainer || !appContainer) return;
    const paneRect = paneContainer.getBoundingClientRect();
    const appRect = appContainer.getBoundingClientRect();
    const lineHeight = this.paneTrio.lineHeight;
    let lineCursor = 1;
    for (const section of this.sections) {
      const rowCount = section.paneLineCount[paneId];
      if (section.kind === 'ctx-collapsed') {
        const topRelativeToEditor =
          editor.getTopForLineNumber(lineCursor) - editor.getScrollTop();
        const chip = document.createElement('div');
        chip.className = 'ctx-breadcrumb-chip';
        chip.textContent = 'unchanged';
        const key = `${section.collapsedStartLine}-${section.collapsedEndLine}`;
        chip.setAttribute('data-collapsed-key', key);
        chip.style.top = `${paneRect.top + topRelativeToEditor - appRect.top}px`;
        chip.style.left = `${paneRect.left + paneRect.width / 2 - appRect.left}px`;
        chip.style.transform = 'translateX(-50%)';
        chip.style.height = `${lineHeight}px`;
        chip.style.lineHeight = `${lineHeight}px`;
        // Clamp chip width to its host pane so long breadcrumb labels
        // don't bleed into neighbouring panes / gutters.
        chip.style.maxWidth = `${Math.max(60, paneRect.width - 16)}px`;
        chip.style.overflow = 'hidden';
        chip.style.textOverflow = 'ellipsis';
        chip.addEventListener('mouseenter', () => setBandHoverByKey(key, true));
        chip.addEventListener('mouseleave', () => setBandHoverByKey(key, false));
        appContainer.appendChild(chip);
      }
      lineCursor += rowCount;
    }
  }

  private editorFor(paneId: PaneId): PaneTrio['local'] {
    if (paneId === 'local') return this.paneTrio.local;
    if (paneId === 'remote') return this.paneTrio.remote;
    return this.paneTrio.result;
  }

  /**
   * Picks the breadcrumb text for a collapsed section. When the host
   * provided LSP-backed document symbols, use them: build a path of
   * the symbols whose ranges INTERSECT the collapsed range plus the
   * enclosing parent chain (e.g. `Class > method`). When no symbols
   * are available, fall back to the precomputed regex preview.
   */
  private labelForSection(section: Section): string {
    const symbolLabel = buildSymbolBreadcrumb(
      this.symbols,
      section.collapsedStartLine,
      section.collapsedEndLine,
    );
    const hiddenLineCount =
      section.collapsedEndLine - section.collapsedStartLine + 1;
    const hiddenSuffix = `  ·  ${hiddenLineCount} hidden lines`;
    if (symbolLabel) return `${symbolLabel}${hiddenSuffix}`;
    return section.collapsedPreview;
  }
}

/**
 * Builds an `Outer > Inner > member` breadcrumb from the symbols that
 * intersect [startLine, endLine]. Picks the innermost enclosing symbol
 * (whose range strictly contains the collapsed range) plus, if any,
 * the FIRST direct child symbol whose start falls inside the range.
 * Returns an empty string when no symbol matches.
 */
function buildSymbolBreadcrumb(
  symbols: readonly DocumentSymbolDTO[],
  startLine: number,
  endLine: number,
): string {
  if (symbols.length === 0) return '';
  const enclosing: DocumentSymbolDTO[] = symbols
    .filter((symbol) => symbol.startLine <= startLine && symbol.endLine >= endLine)
    .sort((leftSymbol, rightSymbol) => rightSymbol.depth - leftSymbol.depth);
  const intersecting = symbols
    .filter((symbol) => symbol.startLine >= startLine && symbol.startLine <= endLine)
    .sort((leftSymbol, rightSymbol) => leftSymbol.startLine - rightSymbol.startLine);
  const pathParts: string[] = [];
  if (enclosing.length > 0) {
    // Walk OUTWARD from the deepest enclosing symbol to the outermost
    // so the breadcrumb reads left-to-right (Outer > Inner).
    const orderedOutToIn = [...enclosing].reverse();
    for (const symbol of orderedOutToIn) pathParts.push(symbol.name);
  }
  if (intersecting.length > 0) {
    const first = intersecting[0]!;
    pathParts.push(intersecting.length > 1
      ? `${first.name} … ${intersecting[intersecting.length - 1]!.name}`
      : first.name);
  }
  return pathParts.join(' > ');
}
