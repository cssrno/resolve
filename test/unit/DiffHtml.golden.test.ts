/**
 * @vitest-environment jsdom
 *
 * Full DOM snapshot of the diff view pipeline. Runs DiffGutterPainter,
 * DiffBezierOverlay and DiffActionButtons against jsdom with stubbed
 * Monaco/PaneDuo so the serialized #app innerHTML is deterministic.
 *
 * The point is to lock the visual contract BEFORE any cross-cutting
 * refactor — if a future change drifts gutter classes, marker positions
 * or bezier coords, these snapshots catch it.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { buildDiffSections, type DiffSection } from '../../src/webview/ui/DiffSections';
import { DiffGutterPainter } from '../../src/webview/ui/DiffGutterPainter';
import { DiffBezierOverlay } from '../../src/webview/ui/DiffBezierOverlay';
import { DiffActionButtons } from '../../src/webview/ui/DiffActionButtons';
import { makeHunkId } from '../../src/domain/Diff';
import type { PaneDuo } from '../../src/webview/ui/PaneDuo';
import type { HostBridge } from '../../src/webview/ipc/HostBridge';
import type { DiffFileDTO, DiffHunkDTO } from '../../src/shared/protocol';

const LINE_HEIGHT = 18;

interface Scenario {
  readonly name: string;
  readonly file: DiffFileDTO;
  readonly stagedHunkIds: ReadonlySet<string>;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'single-mod-hunk',
    file: buildFile(
      ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'],
      ['line 1', 'line 2', 'LINE 3 MODIFIED', 'line 4', 'line 5'],
      [hunk(3, 3, ['line 3'], ['LINE 3 MODIFIED'])],
    ),
    stagedHunkIds: new Set(),
  },
  {
    name: 'single-add-hunk',
    file: buildFile(
      ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'],
      ['line 1', 'line 2', 'line 3', 'NEW LINE', 'line 4', 'line 5'],
      [hunk(4, 4, [], ['NEW LINE'])],
    ),
    stagedHunkIds: new Set(),
  },
  {
    name: 'single-del-hunk',
    file: buildFile(
      ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'],
      ['line 1', 'line 5'],
      [hunk(2, 2, ['line 2', 'line 3', 'line 4'], [])],
    ),
    stagedHunkIds: new Set(),
  },
  {
    name: 'mixed-with-staged',
    file: buildFile(
      ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'],
      ['line 1', 'LINE 2 MOD', 'line 3', 'INSERTED', 'line 4', 'line 5', 'line 6'],
      [
        hunk(2, 2, ['line 2'], ['LINE 2 MOD']),
        hunk(4, 4, [], ['INSERTED']),
      ],
    ),
    stagedHunkIds: new Set([makeHunkId(4, 4)]),
  },
];

describe('Golden HTML: diff view rendering pipeline', () => {
  beforeAll(() => {
    installLayoutStubs();
  });

  beforeEach(() => {
    document.body.innerHTML = APP_TEMPLATE;
  });

  for (const scenario of SCENARIOS) {
    it(`full #app innerHTML — ${scenario.name}`, () => {
      const sections = buildDiffSections(scenario.file, scenario.stagedHunkIds);
      const duo = buildStubPaneDuo();
      const painter = new DiffGutterPainter(sections, LINE_HEIGHT);
      painter.paint();
      const bridge = stubBridge();
      const actions = new DiffActionButtons(bridge);
      actions.render(sections);
      const overlay = new DiffBezierOverlay(duo, sections);
      overlay.render();
      const html = serializeApp();
      expect(html).toMatchSnapshot(scenario.name);
    });
  }
});

/* --------------------------- DOM template ---------------------------- */

const APP_TEMPLATE = `
<div id="app">
  <div class="col-header" data-col="head">Index</div>
  <div class="col-header" data-col="working">Working tree</div>

  <div class="editor-pane" id="diff-pane-head"><div class="monaco-host" id="diff-host-head"></div></div>
  <div class="gutter-cell spacer-cell"  id="diff-space-l"        ><div class="gutter-content"></div></div>
  <div class="gutter-cell actions-cell" id="diff-actions-revert" ><div class="gutter-content"></div></div>
  <div class="gutter-cell"              id="diff-ln-head"        ><div class="gutter-content"></div></div>
  <div class="pipes-cell"               id="diff-pipes"          ><svg></svg></div>
  <div class="gutter-cell"              id="diff-ln-working"     ><div class="gutter-content"></div></div>
  <div class="gutter-cell actions-cell" id="diff-actions-stage"  ><div class="gutter-content"></div></div>
  <div class="gutter-cell spacer-cell"  id="diff-space-r"        ><div class="gutter-content"></div></div>
  <div class="editor-pane" id="diff-pane-working"><div class="monaco-host" id="diff-host-working"></div></div>
</div>
`.trim();

/* ------------------------- Layout stubs ------------------------------ */

function installLayoutStubs(): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get() {
      const parent = this.parentElement;
      if (!parent) return 0;
      const idx = Array.from(parent.children).indexOf(this);
      return idx * LINE_HEIGHT;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return LINE_HEIGHT;
    },
  });
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    return new DOMRect(0, 0, 100, 100);
  };
}

/* ---------------------- Stubs for PaneDuo / Bridge ------------------- */

interface StubEditor {
  getDomNode(): HTMLElement;
  getTopForLineNumber(n: number): number;
  getScrollTop(): number;
}

function makeStubEditor(host: HTMLElement): StubEditor {
  return {
    getDomNode: () => host,
    getTopForLineNumber: (n: number) => (n - 1) * LINE_HEIGHT,
    getScrollTop: () => 0,
  };
}

function buildStubPaneDuo(): PaneDuo {
  const head = makeStubEditor(document.getElementById('diff-host-head')!);
  const working = makeStubEditor(document.getElementById('diff-host-working')!);
  return {
    head,
    working,
    lineHeight: LINE_HEIGHT,
    monaco: null,
    allEditors: () => [head, working],
    setContent: () => {},
  } as unknown as PaneDuo;
}

function stubBridge(): HostBridge {
  return { send: () => {}, on: () => {}, runCommand: () => Promise.resolve() } as unknown as HostBridge;
}

/* ------------------------- Serialization ----------------------------- */

function serializeApp(): string {
  const app = document.getElementById('app')!;
  return prettify(app.outerHTML);
}

function prettify(html: string): string {
  return html
    .replace(/>(\s*)</g, '>\n<')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .filter((l) => l.length > 0)
    .join('\n');
}

/* ------------------------- DTO helpers ------------------------------- */

function buildFile(
  headLines: readonly string[],
  workingLines: readonly string[],
  hunks: DiffHunkDTO[],
): DiffFileDTO {
  return {
    uri: 'file:///fixture.txt',
    languageId: 'plaintext',
    repoRoot: '/fixture',
    repoRelativePath: 'fixture.txt',
    headShortHash: 'deadbee',
    headLines: [...headLines],
    workingLines: [...workingLines],
    hunks,
    initiallyStagedHunkIds: [],
  };
}

function hunk(
  leftStart: number,
  rightStart: number,
  leftLines: string[],
  rightLines: string[],
): DiffHunkDTO {
  return {
    id: makeHunkId(leftStart, rightStart),
    leftStartLine: leftStart,
    rightStartLine: rightStart,
    leftLines,
    rightLines,
  };
}
