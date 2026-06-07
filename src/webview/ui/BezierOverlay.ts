import type { PaneTrio } from './PaneTrio';
import type { BlockClass, PaneId, Section } from './Sections';
import { appendPath, curvePath, lineTopRelativeToGutter, trapezoidPath } from './BezierMath';

/**
 * Smoothstep eased baseline-Y for the collapsed wave. Returns the
 * y-coordinate of the wave's mid-line at x (in pipes-cell coords —
 * negative x = left-flanking gutter zone, x > pipesWidth = right
 * flanking zone). The transition is concentrated in the central
 * pipes-column slice; the flanking extents are flat at their pane Y.
 */
function smoothInterpolateY(x: number, pipesWidth: number, leftY: number, rightY: number): number {
  if (x <= 0) return leftY;
  if (x >= pipesWidth) return rightY;
  const t = x / pipesWidth;
  const eased = t * t * (3 - 2 * t);
  return leftY + (rightY - leftY) * eased;
}

/**
 * Flat-baseline wave from `startX` to `endX` at constant `y`. Used for
 * the post-column wave that picks up on the right side of pipes-right
 * (no Y interpolation needed since both ends share the same Y).
 */
function buildFlatWaveSegment(startX: number, endX: number, y: number): string {
  const AMPLITUDE_PX = 3;
  const HALF_CYCLE_PX = 8;
  const totalWidth = endX - startX;
  const halfCycleCount = Math.max(2, Math.round(totalWidth / HALF_CYCLE_PX));
  const halfCycleWidth = totalWidth / halfCycleCount;
  let pathData = `M ${startX.toFixed(2)} ${y.toFixed(2)}`;
  for (let segmentIndex = 0; segmentIndex < halfCycleCount; segmentIndex++) {
    const xStart = startX + segmentIndex * halfCycleWidth;
    const xEnd = xStart + halfCycleWidth;
    const isUp = segmentIndex % 2 === 0;
    const peakY = y + (isUp ? -AMPLITUDE_PX : AMPLITUDE_PX);
    const xMid = (xStart + xEnd) / 2;
    pathData += ` Q ${xMid.toFixed(2)} ${peakY.toFixed(2)} ${xEnd.toFixed(2)} ${y.toFixed(2)}`;
  }
  return pathData;
}

/**
 * Continuous wavy stroke from `-leftExtent` through the pipes column
 * (width `pipesWidth`) to `pipesWidth + rightExtent`. Drawn as one
 * single SVG path — chained quadratic half-cycles alternating peak
 * direction — so neighbouring grid cells don't show tile seams.
 */
function buildContinuousWavyPath(
  pipesWidth: number,
  leftY: number,
  rightY: number,
  leftExtent: number,
  rightExtent: number,
): string {
  const AMPLITUDE_PX = 3;
  const HALF_CYCLE_PX = 8;
  const totalWidth = leftExtent + pipesWidth + rightExtent;
  const halfCycleCount = Math.max(4, Math.round(totalWidth / HALF_CYCLE_PX));
  const halfCycleWidth = totalWidth / halfCycleCount;
  const startX = -leftExtent;
  let pathData = `M ${startX.toFixed(2)} ${leftY.toFixed(2)}`;
  for (let segmentIndex = 0; segmentIndex < halfCycleCount; segmentIndex++) {
    const xStart = startX + segmentIndex * halfCycleWidth;
    const xEnd = xStart + halfCycleWidth;
    const yEnd = smoothInterpolateY(xEnd, pipesWidth, leftY, rightY);
    const xMid = (xStart + xEnd) / 2;
    const yMidBase = smoothInterpolateY(xMid, pipesWidth, leftY, rightY);
    const isUp = segmentIndex % 2 === 0;
    const peakY = yMidBase + (isUp ? -AMPLITUDE_PX : AMPLITUDE_PX);
    pathData += ` Q ${xMid.toFixed(2)} ${peakY.toFixed(2)} ${xEnd.toFixed(2)} ${yEnd.toFixed(2)}`;
  }
  return pathData;
}

/**
 * Per-gutter extent the collapsed wave overflows into the flanking
 * grid columns (in CSS pixels). Mirrors the merge view's grid
 * template — the wave reaches from where the pane's text stops to
 * where the next pane's text begins.
 */
// The collapsed wave is meant to traverse the WHOLE merge view — past
// the gutter columns and INTO each Monaco pane. Use a generous extent
// (well beyond typical pane width) so the wave reaches both panes'
// far edges; pipes-cell has overflow: visible + a high z-index so the
// path renders over Monaco's content.
// Per-gutter wave extents. Each wave covers its own zone only — they
// must NOT overlap on the Result pane. pipesLeft extends LEFT into the
// Local pane (until the breadcrumb chip on that pane covers it) and
// stops RIGHT just before the Result pane content (= covers
// ln-result-l + space-l2 = 48px). pipesRight is the mirror.
// Only the left pipes column draws the collapsed wave (the right one
// would otherwise paint a second wave overlapping the same row).
// Extents are generous enough to traverse local pane (left) all the
// way past the right pipes column into remote pane (right).
const GUTTER_WAVE_EXTENTS = {
  pipesLeft:  { left: 2000, right: 5000 },
  pipesRight: { left: 0, right: 0 },
} as const;

/** Thickness (in CSS pixels) of the inter-line marker that signals an empty
 *  side; the bezier endpoint is clamped to this height so the curve actually
 *  touches the trait rather than tapering to a degenerate point. */
const INTER_LINE_MARKER_THICKNESS_PX = 3;

/**
 * Draws either:
 *   - a filled trapezoidal bezier per conflict block (pending state), or
 *   - two thin dashed curves matching the resolved-block outline (consumed).
 *
 * One overlay per gutter (left = local↔result, right = result↔remote).
 */
export class BezierOverlay {
  private readonly leftGutterSvg: SVGSVGElement;
  private readonly rightGutterSvg: SVGSVGElement;

  constructor(
    private readonly paneTrio: PaneTrio,
    private readonly sections: Section[],
  ) {
    this.leftGutterSvg  = document.querySelector('#pipes-left svg')  as unknown as SVGSVGElement;
    this.rightGutterSvg = document.querySelector('#pipes-right svg') as unknown as SVGSVGElement;
  }

  render(): void {
    this.drawGutter(this.leftGutterSvg,  'local',  'result');
    this.drawGutter(this.rightGutterSvg, 'result', 'remote');
  }

  private drawGutter(svg: SVGSVGElement, fromSide: PaneId, toSide: PaneId): void {
    const gutterRect = svg.parentElement!.getBoundingClientRect();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${gutterRect.width} ${gutterRect.height}`);
    // Force overflow visible so the collapsed wave can render beyond
    // the pipes-cell's own bounds into the adjacent panes' areas.
    svg.setAttribute('overflow', 'visible');
    svg.style.overflow = 'visible';

    let fromPaneLine = 1;
    let toPaneLine = 1;
    for (const section of this.sections) {
      if (section.kind === 'ctx') {
        fromPaneLine += section.paneLineCount[fromSide];
        toPaneLine   += section.paneLineCount[toSide];
        continue;
      }
      if (section.kind === 'ctx-collapsed') {
        // Handled by CollapsedBandOverlay (a single full-width path
        // covering panes + gutters + pipes with wave + bezier segments).
        fromPaneLine += section.paneLineCount[fromSide];
        toPaneLine   += section.paneLineCount[toSide];
        continue;
      }
      if (!isBlockVisibleOnGutter(section.blockClass, fromSide)) {
        fromPaneLine += section.paneLineCount[fromSide];
        toPaneLine   += section.paneLineCount[toSide];
        continue;
      }
      const fromLineCount = section.paneLineCount[fromSide];
      const toLineCount   = section.paneLineCount[toSide];
      let fromYStart = this.lineTopY(fromSide, fromPaneLine, gutterRect.top);
      let fromYEnd   = this.lineTopY(fromSide, fromPaneLine + fromLineCount, gutterRect.top);
      let toYStart   = this.lineTopY(toSide,   toPaneLine, gutterRect.top);
      let toYEnd     = this.lineTopY(toSide,   toPaneLine + toLineCount, gutterRect.top);
      if (fromLineCount === 0) fromYStart = fromYEnd - INTER_LINE_MARKER_THICKNESS_PX;
      if (toLineCount === 0)   toYStart   = toYEnd   - INTER_LINE_MARKER_THICKNESS_PX;

      const gutterWidth = gutterRect.width;
      const isGutterConsumed = isBezierDashedFor(section, fromSide);
      if (isGutterConsumed) {
        appendDashedBezierEdges(svg, gutterWidth, fromYStart, toYStart, fromYEnd, toYEnd, section.blockClass);
      } else {
        appendFilledBezierTrapezoid(svg, gutterWidth, fromYStart, toYStart, fromYEnd, toYEnd, section.blockClass);
      }

      fromPaneLine += fromLineCount;
      toPaneLine   += toLineCount;
    }
  }

  private lineTopY(paneId: PaneId, lineNumber: number, gutterScreenTop: number): number {
    const editor = paneId === 'local'
      ? this.paneTrio.local
      : paneId === 'result'
        ? this.paneTrio.result
        : this.paneTrio.remote;
    return lineTopRelativeToGutter(editor, lineNumber, gutterScreenTop);
  }

  /**
   * Distance from the given pipes-left SVG's right edge to pipes-right's
   * left edge — used to stop the pipes-left collapsed wave just before
   * pipes-right so the bezier curve drawn THERE doesn't get doubled by
   * the wave.
   */
  private distanceToNextPipesColumnLeft(pipesLeftSvg: SVGSVGElement): number {
    const leftHostRect = pipesLeftSvg.parentElement?.getBoundingClientRect();
    const rightHost = document.getElementById('pipes-right');
    if (!leftHostRect || !rightHost) return 0;
    const rightHostRect = rightHost.getBoundingClientRect();
    return Math.max(0, rightHostRect.left - leftHostRect.right);
  }
}

/** A block is rendered on the LEFT gutter iff its change touches the local
 *  side; on the RIGHT gutter iff it touches the remote side. Conflicts touch
 *  both. */
function isBlockVisibleOnGutter(blockClass: BlockClass | null, fromSide: PaneId): boolean {
  if (blockClass === 'conflict') return true;
  const isLeftGutter = fromSide === 'local';
  if (isLeftGutter) {
    return blockClass === 'localAdd' || blockClass === 'localMod' || blockClass === 'localDel';
  }
  return blockClass === 'remoteAdd' || blockClass === 'remoteMod' || blockClass === 'remoteDel';
}

/** Dashed bezier iff the pane on this gutter's source side has been
 *  consumed — visually says "this change has been applied to Result". */
function isBezierDashedFor(section: Section, fromSide: PaneId): boolean {
  return fromSide === 'local' ? section.resolvedSides.local : section.resolvedSides.remote;
}

function appendFilledBezierTrapezoid(
  svg: SVGSVGElement,
  width: number,
  fromYStart: number,
  toYStart: number,
  fromYEnd: number,
  toYEnd: number,
  blockClass: BlockClass | null,
): void {
  appendPath(svg, trapezoidPath({ width, fromYStart, toYStart, fromYEnd, toYEnd }), {
    fill: BAND_FILL_COLOR_FOR_CLASS(blockClass),
  });
}

function appendDashedBezierEdges(
  svg: SVGSVGElement,
  width: number,
  fromYStart: number,
  toYStart: number,
  fromYEnd: number,
  toYEnd: number,
  blockClass: BlockClass | null,
): void {
  const strokeColor = BAND_STROKE_COLOR_FOR_CLASS(blockClass);
  appendPath(svg, curvePath(width, fromYStart, toYStart), {
    stroke: strokeColor, strokeWidth: 2, strokeDasharray: '2 2', strokeLinecap: 'butt',
  });
  appendPath(svg, curvePath(width, fromYEnd, toYEnd), {
    stroke: strokeColor, strokeWidth: 2, strokeDasharray: '2 2', strokeLinecap: 'butt',
  });
}

function BAND_FILL_COLOR_FOR_CLASS(blockClass: BlockClass | null): string {
  switch (blockClass) {
    case 'localAdd':
    case 'remoteAdd':  return 'rgba(60, 200, 100, 0.38)';
    case 'localMod':
    case 'remoteMod':  return 'rgba(80, 150, 240, 0.38)';
    case 'localDel':
    case 'remoteDel':  return 'rgba(160, 160, 160, 0.45)';
    default:            return 'rgba(230, 80, 80, 0.38)';
  }
}

function BAND_STROKE_COLOR_FOR_CLASS(blockClass: BlockClass | null): string {
  switch (blockClass) {
    case 'localAdd':
    case 'remoteAdd':  return 'rgba(60, 200, 100, 0.75)';
    case 'localMod':
    case 'remoteMod':  return 'rgba(80, 150, 240, 0.75)';
    case 'localDel':
    case 'remoteDel':  return 'rgba(160, 160, 160, 0.75)';
    default:            return 'rgba(230, 80, 80, 0.75)';
  }
}
