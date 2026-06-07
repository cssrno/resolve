import type { PaneDuo } from './PaneDuo';
import type { DiffSection, HunkClass } from './DiffSections';
import { appendPath, lineTopRelativeToGutter, straightCurvePath, straightTrapezoidPath } from './BezierMath';

const INTER_LINE_THICKNESS_PX = 3;

/**
 * Draws filled bezier trapezoids in the single gutter corridor between the
 * HEAD pane and the working pane, one per hunk. Colors follow the hunk
 * class. Staged hunks get an outline tint so the user can tell from the
 * pipe that the change is in the index.
 */
export class DiffBezierOverlay {
  private readonly svg: SVGSVGElement;

  constructor(
    private readonly paneDuo: PaneDuo,
    private readonly sections: DiffSection[],
  ) {
    this.svg = document.querySelector('#diff-pipes svg') as unknown as SVGSVGElement;
  }

  render(): void {
    const gutterRect = this.svg.parentElement!.getBoundingClientRect();
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.svg.setAttribute('viewBox', `0 0 ${gutterRect.width} ${gutterRect.height}`);
    // Each pane tracks its own real-file line counter — the merge-view
    // convention. Panes have asymmetric heights when one side of a hunk
    // is empty; the bezier collapses to a 2px sliver on that side so it
    // anchors at the deletion landing point.
    let headLine = 1;
    let workingLine = 1;
    for (const section of this.sections) {
      if (section.kind === 'ctx') {
        headLine += section.headLineCount;
        workingLine += section.workingLineCount;
        continue;
      }
      const headCount = section.headLineCount;
      const workingCount = section.workingLineCount;
      let headYStart = this.lineTop('head', headLine, gutterRect.top);
      let headYEnd = this.lineTop('head', headLine + headCount, gutterRect.top);
      let workingYStart = this.lineTop('working', workingLine, gutterRect.top);
      let workingYEnd = this.lineTop('working', workingLine + workingCount, gutterRect.top);
      if (headCount === 0) headYStart = headYEnd - INTER_LINE_THICKNESS_PX;
      if (workingCount === 0) workingYStart = workingYEnd - INTER_LINE_THICKNESS_PX;
      appendTrapezoid(
        this.svg,
        gutterRect.width,
        headYStart,
        workingYStart,
        headYEnd,
        workingYEnd,
        section.hunkClass!,
        section.staged,
      );
      headLine += headCount;
      workingLine += workingCount;
    }
  }

  private lineTop(pane: 'head' | 'working', lineNumber: number, gutterScreenTop: number): number {
    const editor = pane === 'head' ? this.paneDuo.head : this.paneDuo.working;
    return lineTopRelativeToGutter(editor, lineNumber, gutterScreenTop);
  }
}

function appendTrapezoid(
  svg: SVGSVGElement,
  width: number,
  headYStart: number,
  workingYStart: number,
  headYEnd: number,
  workingYEnd: number,
  hunkClass: HunkClass,
  staged: boolean,
): void {
  appendPath(
    svg,
    straightTrapezoidPath({ width, fromYStart: headYStart, toYStart: workingYStart, fromYEnd: headYEnd, toYEnd: workingYEnd }),
    { fill: fillForClass(hunkClass, staged) },
  );
  const strokeColor = strokeForClass(hunkClass, staged);
  appendPath(svg, straightCurvePath(width, headYStart, workingYStart), {
    stroke: strokeColor, strokeWidth: 1.25, strokeLinecap: 'butt',
  });
  appendPath(svg, straightCurvePath(width, headYEnd, workingYEnd), {
    stroke: strokeColor, strokeWidth: 1.25, strokeLinecap: 'butt',
  });
}

function fillForClass(hunkClass: HunkClass, staged: boolean): string {
  switch (hunkClass) {
    case 'add': return staged ? 'rgba(60, 200, 100, 0.26)'  : 'rgba(60, 200, 100, 0.13)';
    case 'del': return staged ? 'rgba(160, 160, 160, 0.40)' : 'rgba(160, 160, 160, 0.20)';
    case 'mod': return staged ? 'rgba(80, 150, 240, 0.26)'  : 'rgba(80, 150, 240, 0.13)';
  }
}

function strokeForClass(hunkClass: HunkClass, staged: boolean): string {
  // No outline when staged — the band's own fill matches its surroundings
  // so any stroke on top composites brighter and reads as a visible
  // contour. Unstaged hunks still get the outline at full staged alpha so
  // the band frame stays legible against the dimmer fill.
  if (staged) return 'rgba(0, 0, 0, 0)';
  switch (hunkClass) {
    case 'add': return 'rgba(60, 200, 100, 0.26)';
    case 'del': return 'rgba(160, 160, 160, 0.40)';
    case 'mod': return 'rgba(80, 150, 240, 0.26)';
  }
}
