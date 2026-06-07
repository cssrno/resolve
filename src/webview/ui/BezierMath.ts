/**
 * Shared SVG bezier helpers for the merge view and diff view overlays.
 * Both views draw the same trapezoidal pipe between two columns, with the
 * same curve math; only the stroke / fill / visibility rules differ.
 */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export interface BezierGeometry {
  readonly width: number;
  readonly fromYStart: number;
  readonly toYStart: number;
  readonly fromYEnd: number;
  readonly toYEnd: number;
}

/** Closed trapezoid path (top curve + right edge + bottom curve + left edge). */
export function trapezoidPath(geometry: BezierGeometry): string {
  const { width, fromYStart, toYStart, fromYEnd, toYEnd } = geometry;
  const halfWidth = width / 2;
  return (
    `M 0 ${fromYStart} C ${halfWidth} ${fromYStart}, ${halfWidth} ${toYStart}, ${width} ${toYStart}` +
    ` L ${width} ${toYEnd} C ${halfWidth} ${toYEnd}, ${halfWidth} ${fromYEnd}, 0 ${fromYEnd} Z`
  );
}

/** Single cubic curve between two Y points on the left and right edges. */
export function curvePath(width: number, leftY: number, rightY: number): string {
  const halfWidth = width / 2;
  return `M 0 ${leftY} C ${halfWidth} ${leftY}, ${halfWidth} ${rightY}, ${width} ${rightY}`;
}

/**
 * Shoulder + bezier variant: horizontal trait on entry, smooth bezier
 * curve through the middle, horizontal trait on exit. The "shoulder"
 * controls how much of the gutter width stays horizontal on each end —
 * the remaining middle band carries the curve.
 */
/** Fraction of the gutter width kept horizontal at each end before the
 * cubic bezier takes over. Lower = curve dominates; higher = more
 * horizontal "tail". Tuned so the rightShoulder stretch doesn't read as
 * a thicker block when one side of the hunk is a 3-pixel stub. */
const STRAIGHT_SHOULDER_RATIO = 0.15;

export function straightTrapezoidPath(geometry: BezierGeometry): string {
  const { width, fromYStart, toYStart, fromYEnd, toYEnd } = geometry;
  const leftShoulder = width * STRAIGHT_SHOULDER_RATIO;
  const rightShoulder = width * (1 - STRAIGHT_SHOULDER_RATIO);
  const controlX = width / 2;
  return (
    `M 0 ${fromYStart} L ${leftShoulder} ${fromYStart}` +
    ` C ${controlX} ${fromYStart}, ${controlX} ${toYStart}, ${rightShoulder} ${toYStart}` +
    ` L ${width} ${toYStart} L ${width} ${toYEnd} L ${rightShoulder} ${toYEnd}` +
    ` C ${controlX} ${toYEnd}, ${controlX} ${fromYEnd}, ${leftShoulder} ${fromYEnd}` +
    ` L 0 ${fromYEnd} Z`
  );
}

export function straightCurvePath(width: number, leftY: number, rightY: number): string {
  const leftShoulder = width * STRAIGHT_SHOULDER_RATIO;
  const rightShoulder = width * (1 - STRAIGHT_SHOULDER_RATIO);
  const controlX = width / 2;
  return (
    `M 0 ${leftY} L ${leftShoulder} ${leftY}` +
    ` C ${controlX} ${leftY}, ${controlX} ${rightY}, ${rightShoulder} ${rightY}` +
    ` L ${width} ${rightY}`
  );
}

export interface PathStyle {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeDasharray?: string;
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
}

export function appendPath(svg: SVGSVGElement, d: string, style: PathStyle): SVGPathElement {
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', style.fill ?? 'none');
  if (style.stroke) {
    path.setAttribute('stroke', style.stroke);
    if (style.strokeWidth !== undefined) path.setAttribute('stroke-width', String(style.strokeWidth));
    if (style.strokeDasharray) path.setAttribute('stroke-dasharray', style.strokeDasharray);
    if (style.strokeLinecap) path.setAttribute('stroke-linecap', style.strokeLinecap);
  } else {
    path.setAttribute('stroke', 'none');
  }
  svg.appendChild(path);
  return path;
}

/**
 * Translates an editor line number into its top-Y coordinate relative to
 * the gutter SVG. Common to every overlay because Monaco exposes the same
 * line-to-pixel hook on every editor.
 */
export function lineTopRelativeToGutter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  lineNumber: number,
  gutterScreenTop: number,
): number {
  const editorScreenTop = editor.getDomNode().getBoundingClientRect().top;
  const lineTopRelativeToEditor = editor.getTopForLineNumber(lineNumber) - editor.getScrollTop();
  return editorScreenTop + lineTopRelativeToEditor - gutterScreenTop;
}
