import type { PaneTrio } from './PaneTrio';
import type { Section } from './Sections';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const STROKE_COLOR = 'rgba(190, 190, 190, 0.40)';
const STROKE_WIDTH = 1.0;
const AMPLITUDE_PX = 3;
const HALF_CYCLE_PX = 8;

type PaneIdLike = 'local' | 'result' | 'remote';

/**
 * For every ctx-collapsed section, draws ONE continuous path covering
 * the full merge view at the placeholder row's mid Y. The path is a
 * piecewise composition:
 *   - wavy stroke across each Monaco pane (Local / Result / Remote)
 *   - wavy stroke across the gutter columns flanking each pipes column
 *   - smooth cubic Bezier curve INSIDE each pipes column
 * Baseline Y can differ per pane (when sections have asymmetric line
 * counts); transitions in the inter-pane zones smoothstep between Ys
 * so the band reads as one continuous ribbon.
 */
export class CollapsedBandOverlay {
  private readonly svg: SVGSVGElement;
  private sections: Section[] = [];

  constructor(private readonly paneTrio: PaneTrio) {
    this.svg = document.getElementById('collapsed-band-overlay') as unknown as SVGSVGElement;
  }

  setSections(sections: Section[]): void {
    this.sections = sections;
  }

  render(): void {
    if (!this.svg) return;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const appEl = document.getElementById('app');
    if (!appEl) return;
    const appRect = appEl.getBoundingClientRect();
    this.svg.setAttribute('viewBox', `0 0 ${appRect.width} ${appRect.height}`);

    const layout = this.collectLayout(appRect);
    if (!layout) return;

    const lineCursors: Record<PaneIdLike, number> = { local: 1, result: 1, remote: 1 };
    for (const section of this.sections) {
      if (section.kind === 'ctx-collapsed') {
        const yLocal  = this.placeholderViewportY('local',  lineCursors.local,  appRect);
        const yResult = this.placeholderViewportY('result', lineCursors.result, appRect);
        const yRemote = this.placeholderViewportY('remote', lineCursors.remote, appRect);
        const key = `${section.collapsedStartLine}-${section.collapsedEndLine}`;
        this.appendBandPath(layout, yLocal, yResult, yRemote, key);
      }
      lineCursors.local  += section.paneLineCount.local;
      lineCursors.result += section.paneLineCount.result;
      lineCursors.remote += section.paneLineCount.remote;
    }
  }

  private collectLayout(appRect: DOMRect): {
    appWidth: number;
    localPane:  { start: number; end: number };
    resultPane: { start: number; end: number };
    remotePane: { start: number; end: number };
    pipesLeft:  { start: number; end: number };
    pipesRight: { start: number; end: number };
  } | null {
    const xOf = (id: string): { start: number; end: number } | null => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { start: r.left - appRect.left, end: r.right - appRect.left };
    };
    const localPane  = xOf('pane-local');
    const resultPane = xOf('pane-result');
    const remotePane = xOf('pane-remote');
    const pipesLeft  = xOf('pipes-left');
    const pipesRight = xOf('pipes-right');
    if (!localPane || !resultPane || !remotePane || !pipesLeft || !pipesRight) return null;
    return { appWidth: appRect.width, localPane, resultPane, remotePane, pipesLeft, pipesRight };
  }

  private placeholderViewportY(
    paneId: PaneIdLike,
    lineNumber: number,
    appRect: DOMRect,
  ): number {
    const editor =
      paneId === 'local' ? this.paneTrio.local
      : paneId === 'remote' ? this.paneTrio.remote
      : this.paneTrio.result;
    const editorRect = editor.getDomNode().getBoundingClientRect();
    const topInEditor = editor.getTopForLineNumber(lineNumber) - editor.getScrollTop();
    return (editorRect.top - appRect.top) + topInEditor + this.paneTrio.lineHeight / 2;
  }

  private appendBandPath(
    layout: NonNullable<ReturnType<CollapsedBandOverlay['collectLayout']>>,
    yLocal: number,
    yResult: number,
    yRemote: number,
    key: string,
  ): void {
    // Baseline at any X:
    //   - left of pipes-left:   flat at yLocal  (wave Y stays put)
    //   - inside  pipes-left:   smooth transition yLocal → yResult (the bezier alone bends)
    //   - between pipes:        flat at yResult
    //   - inside  pipes-right:  smooth transition yResult → yRemote
    //   - right of pipes-right: flat at yRemote
    // The wave Y is therefore CONSTANT outside the pipes columns — only
    // the cubic curve INSIDE each pipes column moves the line from one
    // pane's Y to the next.
    const baselineY = (x: number): number => {
      if (x <= layout.pipesLeft.start) return yLocal;
      if (x < layout.pipesLeft.end) {
        const t = clamp01((x - layout.pipesLeft.start) /
          Math.max(1, layout.pipesLeft.end - layout.pipesLeft.start));
        return yLocal + (yResult - yLocal) * smoothstep(t);
      }
      if (x <= layout.pipesRight.start) return yResult;
      if (x < layout.pipesRight.end) {
        const t = clamp01((x - layout.pipesRight.start) /
          Math.max(1, layout.pipesRight.end - layout.pipesRight.start));
        return yResult + (yRemote - yResult) * smoothstep(t);
      }
      return yRemote;
    };

    // Build the SVG path piecewise from left to right across `appWidth`.
    // Inside pipes columns we emit one smooth cubic Bezier (`C`) instead
    // of the chained wave segments. Outside, we chain quadratic half-
    // cycles alternating peak direction.
    const segments: Array<{ start: number; end: number; kind: 'wave' | 'curve' }> = [
      { start: 0,                       end: layout.pipesLeft.start, kind: 'wave' },
      { start: layout.pipesLeft.start,  end: layout.pipesLeft.end,   kind: 'curve' },
      { start: layout.pipesLeft.end,    end: layout.pipesRight.start, kind: 'wave' },
      { start: layout.pipesRight.start, end: layout.pipesRight.end,   kind: 'curve' },
      { start: layout.pipesRight.end,   end: layout.appWidth,         kind: 'wave' },
    ];

    let pathData = `M 0 ${baselineY(0).toFixed(2)}`;
    let halfCyclePhase = 0;
    for (const segment of segments) {
      const segmentWidth = segment.end - segment.start;
      if (segmentWidth <= 0) continue;
      if (segment.kind === 'curve') {
        const startY = baselineY(segment.start);
        const endY = baselineY(segment.end);
        // When the two pane Ys match (= adjacent unchanged ranges
        // collapse on the same visual line), the curve has nothing to
        // bend toward — keep the wave running through the pipes column
        // for visual continuity.
        if (Math.abs(startY - endY) < 0.5) {
          const halfCycleCount = Math.max(2, Math.round(segmentWidth / HALF_CYCLE_PX));
          const halfCycleWidth = segmentWidth / halfCycleCount;
          for (let segmentIndex = 0; segmentIndex < halfCycleCount; segmentIndex++) {
            const xStart = segment.start + segmentIndex * halfCycleWidth;
            const xEnd = xStart + halfCycleWidth;
            const xMid = (xStart + xEnd) / 2;
            const isUp = halfCyclePhase % 2 === 0;
            halfCyclePhase++;
            const peakY = startY + (isUp ? -AMPLITUDE_PX : AMPLITUDE_PX);
            pathData += ` Q ${xMid.toFixed(2)} ${peakY.toFixed(2)} ${xEnd.toFixed(2)} ${startY.toFixed(2)}`;
          }
          continue;
        }
        const midX = (segment.start + segment.end) / 2;
        pathData += ` C ${midX.toFixed(2)} ${startY.toFixed(2)},`;
        pathData += ` ${midX.toFixed(2)} ${endY.toFixed(2)},`;
        pathData += ` ${segment.end.toFixed(2)} ${endY.toFixed(2)}`;
        continue;
      }
      const halfCycleCount = Math.max(2, Math.round(segmentWidth / HALF_CYCLE_PX));
      const halfCycleWidth = segmentWidth / halfCycleCount;
      for (let segmentIndex = 0; segmentIndex < halfCycleCount; segmentIndex++) {
        const xStart = segment.start + segmentIndex * halfCycleWidth;
        const xEnd = xStart + halfCycleWidth;
        const xMid = (xStart + xEnd) / 2;
        const isUp = halfCyclePhase % 2 === 0;
        halfCyclePhase++;
        const peakY = baselineY(xMid) + (isUp ? -AMPLITUDE_PX : AMPLITUDE_PX);
        const yEnd = baselineY(xEnd);
        pathData += ` Q ${xMid.toFixed(2)} ${peakY.toFixed(2)} ${xEnd.toFixed(2)} ${yEnd.toFixed(2)}`;
      }
    }

    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', STROKE_COLOR);
    path.setAttribute('stroke-width', String(STROKE_WIDTH));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('data-collapsed-key', key);
    // Hover-on-the-stroke handlers — symmetric with the chip hover so
    // touching the wave / bezier from any side highlights the same band.
    path.addEventListener('mouseenter', () => setBandHoverByKey(key, true));
    path.addEventListener('mouseleave', () => setBandHoverByKey(key, false));
    this.svg.appendChild(path);
  }
}

const BAND_NORMAL_STROKE = 'rgba(190, 190, 190, 0.40)';
const BAND_HOVER_STROKE = 'rgba(170, 170, 170, 0.80)';
const BAND_NORMAL_WIDTH = '1.0';
const BAND_HOVER_WIDTH = '1.8';

/**
 * Sets the visual hover state for every SVG path AND every breadcrumb
 * chip sharing the collapsed key. Exposed at module scope so both the
 * chip overlay and the band paths can call it without circular imports.
 */
export function setBandHoverByKey(key: string, hovered: boolean): void {
  const overlay = document.getElementById('collapsed-band-overlay');
  if (overlay) {
    overlay
      .querySelectorAll<SVGPathElement>(`path[data-collapsed-key="${key}"]`)
      .forEach((path) => {
        path.setAttribute('stroke-width', hovered ? BAND_HOVER_WIDTH : BAND_NORMAL_WIDTH);
        path.setAttribute('stroke', hovered ? BAND_HOVER_STROKE : BAND_NORMAL_STROKE);
      });
  }
  document
    .querySelectorAll<HTMLElement>(`.ctx-breadcrumb-chip[data-collapsed-key="${key}"]`)
    .forEach((chip) => chip.classList.toggle('is-hover', hovered));
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
