/**
 * @vitest-environment jsdom
 *
 * Golden snapshot of the merge-view's full rendered HTML. The fixture is
 * passed through the entire webview pipeline (Sections → GutterPainter →
 * BezierOverlay → ActionButtons) inside a jsdom DOM, then the resulting
 * `#app` innerHTML is captured per resolution scenario.
 *
 * Monaco itself is stubbed (it requires a real browser). Editor reads are
 * answered with deterministic mocks so getTopForLineNumber et al. produce
 * stable, fixture-driven coordinates.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitConflictParser } from '../../src/domain/parser/GitConflictParser';
import { toFileDTO } from '../../src/application/ConflictMapper';
import { MergeSession } from '../../src/domain/MergeSession';
import { buildSections, type Section } from '../../src/webview/ui/Sections';
import { GutterPainter } from '../../src/webview/ui/GutterPainter';
import { BezierOverlay } from '../../src/webview/ui/BezierOverlay';
import { ActionButtons } from '../../src/webview/ui/ActionButtons';
import type { PaneTrio } from '../../src/webview/ui/PaneTrio';
import type {
  ConflictBlockDTO,
  ConflictFileDTO,
  ResolutionDTO,
} from '../../src/shared/protocol';
import type { HostBridge } from '../../src/webview/ipc/HostBridge';

const LINE_HEIGHT = 18;

describe('Golden HTML: full webview rendering pipeline', () => {
  const fixturePath = path.resolve(__dirname, '../../fixtures/conflicts/golden.ts');
  const raw = fs.readFileSync(fixturePath, 'utf-8');
  const parser = new GitConflictParser();
  const file = parser.parse('file:///golden.ts', raw);
  const session = MergeSession.from(file);
  const baseDto = toFileDTO(file, session, 'typescript');

  beforeAll(() => {
    // Layout APIs aren't implemented in jsdom — stub them so renderers that
    // measure layout produce deterministic numbers based on row index.
    installLayoutStubs();
  });

  beforeEach(() => {
    document.body.innerHTML = APP_TEMPLATE;
  });

  for (const scenario of SCENARIOS) {
    it(`full #app innerHTML — ${scenario.name}`, () => {
      const dto = withResolution(baseDto, scenario.resolve);
      const sections = buildSections(dto);

      const trio = buildStubPaneTrio();
      const painter = new GutterPainter(sections, LINE_HEIGHT);
      painter.paint();
      const bridge = stubBridge();
      const actions = new ActionButtons(bridge);
      actions.render(sections);
      const overlay = new BezierOverlay(trio, sections);
      overlay.render();

      const html = serializeApp();
      expect(html).toMatchSnapshot(scenario.name);
    });
  }
});

const SCENARIOS: Array<{
  name: string;
  resolve: (block: ConflictBlockDTO, index: number) => ResolutionDTO | null;
}> = [
  { name: 'unresolved', resolve: () => null },
  { name: 'accept-left-everywhere', resolve: () => ({ kind: 'sides', left: 'accepted', right: 'rejected' }) },
  { name: 'accept-right-everywhere', resolve: () => ({ kind: 'sides', left: 'rejected', right: 'accepted' }) },
  { name: 'accept-both-everywhere', resolve: () => ({ kind: 'sides', left: 'accepted', right: 'accepted' }) },
  {
    name: 'mixed-per-block',
    resolve: (_b, i) => {
      const m = i % 5;
      if (m === 0) return null;
      if (m === 1) return { kind: 'sides', left: 'accepted', right: 'rejected' };
      if (m === 2) return { kind: 'sides', left: 'rejected', right: 'accepted' };
      if (m === 3) return { kind: 'sides', left: 'accepted', right: 'accepted' };
      return { kind: 'manual', lines: ['/* manually merged */'] };
    },
  },
];

/* --------------------------- DOM template ---------------------------- */

const APP_TEMPLATE = `
<div id="app">
  <div class="col-header" data-col="local">Local</div>
  <div class="col-header" data-col="result">Result</div>
  <div class="col-header" data-col="remote">Remote</div>

  <div class="editor-pane" id="pane-local"><div class="monaco-host" id="host-local"></div></div>
  <div class="gutter-cell spacer-cell" id="space-l1"><div class="gutter-content"></div></div>
  <div class="gutter-cell actions-cell" id="actions-left"><div class="gutter-content"></div></div>
  <div class="gutter-cell" id="ln-local"><div class="gutter-content"></div></div>
  <div class="pipes-cell" id="pipes-left"><svg></svg></div>
  <div class="gutter-cell" id="ln-result-l"><div class="gutter-content"></div></div>
  <div class="gutter-cell spacer-cell" id="space-l2"><div class="gutter-content"></div></div>
  <div class="editor-pane" id="pane-result"><div class="monaco-host" id="host-result"></div></div>
  <div class="gutter-cell spacer-cell" id="space-r1"><div class="gutter-content"></div></div>
  <div class="gutter-cell" id="ln-result-r"><div class="gutter-content"></div></div>
  <div class="pipes-cell" id="pipes-right"><svg></svg></div>
  <div class="gutter-cell" id="ln-remote"><div class="gutter-content"></div></div>
  <div class="gutter-cell actions-cell" id="actions-right"><div class="gutter-content"></div></div>
  <div class="gutter-cell spacer-cell" id="space-r2"><div class="gutter-content"></div></div>
  <div class="editor-pane" id="pane-remote"><div class="monaco-host" id="host-remote"></div></div>
</div>
`.trim();

/* ------------------------- Layout stubs ------------------------------ */

function installLayoutStubs(): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get() {
      // Derive a deterministic offset from the row's index inside its parent.
      const parent = this.parentElement;
      if (!parent) return 0;
      const idx = Array.from(parent.children).indexOf(this);
      return idx * LINE_HEIGHT;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return LINE_HEIGHT; },
  });
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    return new DOMRect(0, 0, 100, 100);
  };
}

/* ---------------------- Stubs for PaneTrio / Bridge ------------------ */

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

function buildStubPaneTrio(): PaneTrio {
  const local = makeStubEditor(document.getElementById('host-local')!);
  const result = makeStubEditor(document.getElementById('host-result')!);
  const remote = makeStubEditor(document.getElementById('host-remote')!);
  return {
    local, result, remote,
    lineHeight: LINE_HEIGHT,
    monaco: null,
    allEditors: () => [local, result, remote],
    setContent: () => {},
    // PaneTrio uses this private helper; the stub never needs to call it.
    setIfChanged: () => {},
  } as unknown as PaneTrio;
}

function stubBridge(): HostBridge {
  // ActionButtons only calls bridge.send when the user clicks a button;
  // during render() it's untouched. A bare object suffices.
  return { send: () => {}, on: () => {}, runCommand: () => Promise.resolve() } as unknown as HostBridge;
}

/* ------------------------- Serialization ----------------------------- */

function withResolution(
  dto: ConflictFileDTO,
  resolve: (block: ConflictBlockDTO, index: number) => ResolutionDTO | null,
): ConflictFileDTO {
  return {
    ...dto,
    blocks: dto.blocks.map((b, i) => ({ ...b, resolution: resolve(b, i) })),
  };
}

function serializeApp(): string {
  const app = document.getElementById('app')!;
  return prettify(app.outerHTML);
}

function prettify(html: string): string {
  // Insert a newline before every opening/closing tag boundary so diffs are
  // line-oriented; collapse trailing whitespace.
  return html
    .replace(/>(\s*)</g, '>\n<')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .filter((l) => l.length > 0)
    .join('\n');
}

// Type-only marker so this file is parsed even when no test runs
const _t: Section[] = [];
void _t;
