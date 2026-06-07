import type { MonacoModule } from '../monaco/loader';
import type { HostBridge } from '../ipc/HostBridge';
import type {
  DiffFileDTO,
  EditorFontConfig,
  GrammarConfig,
  KeybindingDTO,
  ThemeConfig,
} from '../../shared/protocol';
import { applyTheme } from '../monaco/ThemeApplier';
import { ActiveLinePerPane, bootMonacoLanguage, registerUndoRedoCommands } from './AppBoot';
import { PaneDuo } from './PaneDuo';
import { DiffGutterPainter } from './DiffGutterPainter';
import { DiffBezierOverlay } from './DiffBezierOverlay';
import { DiffActionButtons } from './DiffActionButtons';
import { DiffScrollSync } from './DiffScrollSync';
import {
  allHunksStaged,
  buildDiffSections,
  collapsedKey,
  DEFAULT_COLLAPSE_THRESHOLD,
  diffPaneTexts,
  nextHunkSectionIndex,
  previousHunkSectionIndex,
  sectionIndexAtWorkingLine,
  stagedHunkCount,
  workingLineOfSection,
  type DiffSection,
} from './DiffSections';

interface MonacoLineRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface MonacoDecoration {
  range: MonacoLineRange;
  options: { isWholeLine: boolean; className: string };
}

export interface DiffInitPayload {
  file: DiffFileDTO;
  font: EditorFontConfig;
  theme: ThemeConfig;
  keybindings: KeybindingDTO[];
  grammar: GrammarConfig | null;
  monacoBaseUri: string;
}

export async function mountDiffApp(
  monaco: MonacoModule,
  bridge: HostBridge,
  payload: DiffInitPayload,
): Promise<void> {
  installDiffLayout(bridge);
  setIndexHeader(payload.file.headShortHash, payload.file.repoRelativePath);
  setStageAllVisible(payload.file.hunks.length > 0);

  const monacoLang = await bootMonacoLanguage(
    monaco,
    payload.file.languageId,
    payload.grammar,
    payload.theme,
    payload.monacoBaseUri,
  );

  const duo = new PaneDuo(monaco, {
    hostHeadId: 'diff-host-head',
    hostWorkingId: 'diff-host-working',
    font: payload.font,
    language: monacoLang,
  });

  let currentFile = payload.file;
  let stagedHunkIds = new Set(payload.file.initiallyStagedHunkIds);
  let sections: DiffSection[] = [];
  // Collapse-unchanged toggle + per-context-section "user expanded"
  // override. Keys are stable identifiers (workingStart-workingEnd) so
  // toggling stage / unstage doesn't drop the user's expansion state.
  let collapseUnchangedEnabled = false;
  const expandedContextKeys = new Set<string>();
  wireStageAllCheckbox(bridge);
  const painter = new DiffGutterPainter([], duo.lineHeight);
  const overlay = new DiffBezierOverlay(duo, []);
  const actions = new DiffActionButtons(bridge);
  const scroll = new DiffScrollSync(duo, duo.lineHeight, () => {
    overlay.render();
    onScrollUpdateNav();
  });
  const activeLine = new ActiveLinePerPane(duo.group, {
    head:    ['diff-ln-head'],
    working: ['diff-ln-working'],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let headDecorations: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let workingDecorations: any = null;
  // Last working content the host saved. While the user is mid-typing
  // (Monaco buffer ≠ this value), incoming diffRefreshed messages MUST
  // NOT touch the working pane — they were generated from an earlier
  // snapshot and would overwrite the user's in-flight characters.
  let lastSavedWorkingContent: string | null = null;

  function refresh(): void {
    sections = buildDiffSections(currentFile, stagedHunkIds, {
      collapseUnchanged: collapseUnchangedEnabled,
      expandedContextKeys,
      collapseThreshold: DEFAULT_COLLAPSE_THRESHOLD,
    });
    const texts = diffPaneTexts(currentFile, sections);
    const monacoWorking = duo.working.getValue();
    const workingMatchesSave =
      lastSavedWorkingContent === null || monacoWorking === lastSavedWorkingContent;
    duo.setContent(workingMatchesSave ? texts : { head: texts.head });
    (painter as unknown as { sections: DiffSection[] }).sections = sections;
    (overlay as unknown as { sections: DiffSection[] }).sections = sections;
    painter.paint();
    actions.render(sections);
    applyPaneDecorations();
    scroll.setSections(sections);
    scroll.recommit();
    overlay.render();
    activeLine.refreshAll();
    syncStageAllCheckbox(currentFile, stagedHunkIds);
    setStatus(formatStatus(currentFile, stagedHunkIds));
  }

  function applyPaneDecorations(): void {
    if (headDecorations) headDecorations.clear();
    if (workingDecorations) workingDecorations.clear();
    headDecorations = duo.head.createDecorationsCollection(decorationsForPane('head'));
    workingDecorations = duo.working.createDecorationsCollection(decorationsForPane('working'));
  }

  function decorationsForPane(pane: 'head' | 'working'): MonacoDecoration[] {
    const decorations: MonacoDecoration[] = [];
    let currentLine = 1;
    for (const section of sections) {
      if (section.kind === 'ctx-collapsed') {
        decorations.push({
          range: wholeLine(currentLine, currentLine),
          options: { isWholeLine: true, className: 'ctx-collapsed-line' },
        });
        currentLine += 1;
        continue;
      }
      const realCount = pane === 'head' ? section.headLineCount : section.workingLineCount;
      if (section.kind === 'hunk') {
        if (realCount > 0) {
          decorations.push({
            range: wholeLine(currentLine, currentLine + realCount - 1),
            options: { isWholeLine: true, className: paneTintClass(section, pane) },
          });
        } else if (currentLine > 1) {
          // Zero-line hunk on this side: paint a 2px stroke at the BOTTOM
          // of the previous line so the deletion / insertion anchor is
          // visible without faking an empty row.
          const markerClass = pane === 'head' ? 'diff-marker-added' : 'diff-marker-removed';
          decorations.push({
            range: wholeLine(currentLine - 1, currentLine - 1),
            options: { isWholeLine: true, className: markerClass },
          });
        }
      }
      currentLine += realCount;
    }
    return decorations;
  }

  refresh();
  scroll.attach();
  wireSyncScrollToggle(scroll);
  let currentSectionIndex = -1;
  const refreshNavState = (): void => {
    setDiffNavDisabledState(sections, currentSectionIndex);
  };
  // Called after every scroll (sync ON via virtual engine, sync OFF via
  // Monaco onDidScrollChange) — keeps the current section cursor in
  // sync with what the user is actually looking at so prev/next anchor
  // correctly.
  function onScrollUpdateNav(): void {
    if (sections.length === 0) return;
    const idx = scroll.currentSectionIndex();
    // Only auto-track when the user's viewport is on a HUNK section.
    // Scrolling through ctx (or being stuck at top because the editor
    // content fits its viewport and getScrollTop returns 0) must NOT
    // reset the cursor to ctx 0 — that would clobber the position the
    // last click set.
    if (idx === -1 || sections[idx]?.kind !== 'hunk') return;
    currentSectionIndex = idx;
    refreshNavState();
  }
  function navigateTo(targetIndex: number): void {
    if (targetIndex === -1) return;
    currentSectionIndex = targetIndex;
    scroll.scrollToSection(targetIndex);
    const workingLine = workingLineOfSection(sections, targetIndex);
    duo.working.setPosition({ lineNumber: workingLine, column: 1 });
    duo.working.focus();
    refreshNavState();
  }
  wireDiffNavigation({
    onPrev: () => {
      navigateTo(
        previousHunkSectionIndex(
          sections,
          currentSectionIndex >= 0 ? currentSectionIndex : sections.length,
        ),
      );
    },
    onNext: () => {
      navigateTo(nextHunkSectionIndex(sections, currentSectionIndex));
    },
  });
  // Live-edit pipeline: every keystroke on the working pane debounces
  // a `workingTreeEdited` message. The host writes the buffer to disk
  // and pushes a fresh diff back, which re-tints the bands. The
  // debounce avoids saving on every keystroke; 300ms is fast enough to
  // feel live.
  const WORKING_SAVE_DEBOUNCE_MS = 300;
  let workingSaveTimer: number | null = null;
  duo.working.onDidChangeModelContent(() => {
    if (workingSaveTimer !== null) window.clearTimeout(workingSaveTimer);
    workingSaveTimer = window.setTimeout(() => {
      workingSaveTimer = null;
      const content = duo.working.getValue();
      lastSavedWorkingContent = content;
      bridge.send({ kind: 'workingTreeEdited', content });
    }, WORKING_SAVE_DEBOUNCE_MS);
  });
  // Cursor-aware tracking: when the user clicks inside a hunk line on
  // the working pane, snap currentSectionIndex onto that hunk. Lets
  // prev/next anchor on whatever the user is reading, not just on
  // explicit toolbar clicks. ctx focus is ignored — clicking around in
  // context shouldn't reset the diff cursor.
  duo.working.onDidChangeCursorPosition(
    (event: { position: { lineNumber: number } }) => {
      if (sections.length === 0) return;
      const idx = sectionIndexAtWorkingLine(sections, event.position.lineNumber);
      if (idx === -1 || sections[idx]?.kind !== 'hunk') return;
      if (idx === currentSectionIndex) return;
      currentSectionIndex = idx;
      refreshNavState();
    },
  );
  refreshNavState();
  wireCollapseUnchangedToggle({
    isEnabled: () => collapseUnchangedEnabled,
    setEnabled: (enabled) => {
      collapseUnchangedEnabled = enabled;
      // Flipping the toggle resets per-section expansions — the user can
      // re-expand any sections they want to inspect after toggling.
      if (!enabled) expandedContextKeys.clear();
      refresh();
    },
  });
  // Click anywhere on a collapsed-context row expands that specific
  // section. Delegated on document since gutter rows are rebuilt every
  // refresh and listeners would otherwise need to be re-attached. Match
  // both the gutter cells (data-collapsed-key) and the Monaco line
  // overlay (we map screen-line back to section via the working pane).
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const gutterRow = target.closest<HTMLElement>('[data-collapsed-key]');
    if (gutterRow) {
      const key = gutterRow.getAttribute('data-collapsed-key');
      if (key) {
        expandedContextKeys.add(key);
        refresh();
      }
      return;
    }
    // Monaco click: figure out the section under the clicked view line.
    // Skip when click isn't inside a Monaco overflow-guard.
    const monacoLine = target.closest<HTMLElement>('.view-line');
    if (!monacoLine || sections.length === 0) return;
    const editor = monacoLine.closest('#diff-host-working') ? duo.working : duo.head;
    const lineNumber = editor.getPosition()?.lineNumber;
    if (!lineNumber) return;
    const sectionIndex = sectionIndexAtWorkingLine(sections, lineNumber);
    if (sectionIndex === -1) return;
    const section = sections[sectionIndex];
    if (!section || section.kind !== 'ctx-collapsed') return;
    expandedContextKeys.add(collapsedKey(section));
    refresh();
  });
  registerUndoRedoCommands(monaco, duo.group, bridge);

  bridge.on((msg) => {
    if (msg.kind === 'hunkStateChanged') {
      if (msg.staged) stagedHunkIds.add(msg.hunkId);
      else stagedHunkIds.delete(msg.hunkId);
      refresh();
    } else if (msg.kind === 'diffRefreshed') {
      currentFile = msg.file;
      stagedHunkIds = new Set(msg.file.initiallyStagedHunkIds);
      refresh();
      setIndexHeader(currentFile.headShortHash, currentFile.repoRelativePath);
      setStageAllVisible(currentFile.hunks.length > 0);
      // File replaced — the previously-cursored hunk may not exist any
      // more. Reset and refresh button states.
      currentSectionIndex = -1;
      refreshNavState();
    } else if (msg.kind === 'themeChanged') {
      applyTheme(monaco, msg.theme);
    }
  });

  window.addEventListener('resize', () => {
    overlay.render();
    actions.render(sections);
  });
}

/**
 * Swaps the merge-view layout out of `#app` and drops in the 2-pane diff
 * layout. Reusing the same root div lets `index.html` stay merge-shaped
 * while the diff view paints over it once the host requests it.
 */
const PENCIL_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M11.5 1.5 L14.5 4.5 L5 14 L1.5 14.5 L2 11 Z"/>' +
  '<line x1="10.5" y1="2.5" x2="13.5" y2="5.5"/>' +
  '</svg>';

const SYNC_SCROLL_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="miter">' +
  '<line x1="2.5" y1="2.5" x2="2.5" y2="13.5"/>' +
  '<polyline points="0.7,4.3 2.5,2.5 4.3,4.3"/>' +
  '<polyline points="0.7,11.7 2.5,13.5 4.3,11.7"/>' +
  '<line x1="13.5" y1="2.5" x2="13.5" y2="6"/>' +
  '<polyline points="11.7,4.3 13.5,2.5 15.3,4.3"/>' +
  '</svg>' +
  '<svg class="sync-loop-badge" viewBox="0 0 24 24" fill="none" stroke="#3794ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="miter">' +
  '<path d="M7.3 10.3 A5 5 0 0 1 16.7 10.3"/>' +
  '<polyline points="14.89,9.45 16.7,10.3 17.55,8.49"/>' +
  '<path d="M16.7 13.7 A5 5 0 0 1 7.3 13.7"/>' +
  '<polyline points="9.11,14.55 7.3,13.7 6.45,15.51"/>' +
  '</svg>';

const ARROW_UP_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="3,8 8,3 13,8"/>' +
  '<line x1="8" y1="3" x2="8" y2="14"/>' +
  '</svg>';

const ARROW_DOWN_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="3,8 8,13 13,8"/>' +
  '<line x1="8" y1="2" x2="8" y2="13"/>' +
  '</svg>';

// Two SVGs stacked: collapse chevrons (point inward) when the toggle
// is fully active, expand chevrons (point outward) otherwise. CSS in
// index.html swaps which one displays based on the button's
// `.is-active` class.
const COLLAPSE_UNCHANGED_ICON =
  '<svg class="icon-collapse" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="3,2 8,6 13,2"/>' +
  '<polyline points="3,14 8,10 13,14"/>' +
  '<line x1="2" y1="8" x2="14" y2="8"/>' +
  '</svg>' +
  '<svg class="icon-expand" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="3,5 8,1 13,5"/>' +
  '<polyline points="3,11 8,15 13,11"/>' +
  '<line x1="2" y1="8" x2="14" y2="8"/>' +
  '</svg>';

function installDiffLayout(bridge: HostBridge): void {
  const app = document.getElementById('app')!;
  // Tighter than the merge view's grid because the diff has only one
  // gutter corridor in the middle. Each fixed column is sized close to its
  // visible content (action button = 18px chevron, checkbox = 14px tick)
  // so we don't waste horizontal pixels.
  app.style.gridTemplateColumns = '1fr 12px 22px 30px 44px 30px 22px 12px 1fr';
  app.innerHTML = DIFF_LAYOUT_HTML;
  const toolbar = document.getElementById('toolbar');
  if (toolbar) {
    toolbar.innerHTML =
      `<button id="btn-prev-diff" class="toolbar-icon-btn" title="Previous difference">${ARROW_UP_ICON}</button>` +
      `<button id="btn-next-diff" class="toolbar-icon-btn" title="Next difference">${ARROW_DOWN_ICON}</button>` +
      '<span class="toolbar-sep"></span>' +
      `<button id="btn-jump-to-source" class="toolbar-icon-btn" title="Jump to source">${PENCIL_ICON}<span>Jump to source</span></button>` +
      '<span class="toolbar-sep"></span>' +
      `<button id="btn-collapse-unchanged" class="toolbar-icon-btn toolbar-toggle" title="Collapse unchanged fragments" aria-pressed="false">${COLLAPSE_UNCHANGED_ICON}</button>` +
      `<button id="btn-sync-scroll" class="toolbar-icon-btn toolbar-toggle is-active" title="Synchronize scrolling between panes" aria-pressed="true">${SYNC_SCROLL_ICON}</button>` +
      '<span class="spacer-fill"></span>' +
      '<span class="status" id="status">Loading…</span>';
    const jumpButton = document.getElementById('btn-jump-to-source');
    if (jumpButton) {
      jumpButton.addEventListener('click', () => bridge.send({ kind: 'jumpToSource' }));
    }
  }
}

function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function formatStatus(file: DiffFileDTO, stagedHunkIds: ReadonlySet<string>): string {
  const total = file.hunks.length;
  const included = stagedHunkCount(file, stagedHunkIds);
  return `${total} difference${total === 1 ? '' : 's'}, ${included} included`;
}

function setIndexHeader(headShortHash: string, repoRelativePath: string): void {
  const hashEl = document.getElementById('diff-index-hash');
  const pathEl = document.getElementById('diff-index-path');
  if (hashEl) hashEl.textContent = headShortHash || '(no HEAD)';
  if (pathEl) pathEl.textContent = repoRelativePath;
}

/**
 * Bulk stage trigger in the working-tree column header. Sends ONE
 * `stageAll` message — the host loops through the hunks serially so the
 * git index lock can't race against itself. The checkbox is one-way
 * (uncheck does nothing) because after staging every visible hunk the
 * diff display is empty; to undo a bulk stage, use cmd+z per hunk.
 */
/**
 * Toolbar toggle that flips the GenericScrollSync engine on / off. When
 * disabled, each Monaco pane scrolls independently via its own native
 * wheel handler (we let the wheel events propagate). When enabled, the
 * virtual scroll engine reclaims them and keeps the panes locked.
 */
/**
 * Wires the prev/next-diff arrow buttons in the toolbar. The handlers
 * are passed in so the DiffApp owns the current-hunk index state — this
 * function only translates DOM clicks into callbacks.
 */
function wireDiffNavigation(handlers: { onPrev(): void; onNext(): void }): void {
  document.getElementById('btn-prev-diff')?.addEventListener('click', handlers.onPrev);
  document.getElementById('btn-next-diff')?.addEventListener('click', handlers.onNext);
}

/**
 * Toggles the toolbar prev/next-diff arrow `disabled` attribute based on
 * whether a target hunk exists in each direction. Centralises the DOM
 * mutation so the navigation logic stays small and the on/off decision
 * stays in {@link nextHunkSectionIndex} / {@link previousHunkSectionIndex}.
 */
function setDiffNavDisabledState(
  sections: readonly DiffSection[],
  currentSectionIndex: number,
): void {
  const prev = previousHunkSectionIndex(
    sections,
    currentSectionIndex >= 0 ? currentSectionIndex : sections.length,
  );
  const next = nextHunkSectionIndex(sections, currentSectionIndex);
  const prevButton = document.getElementById('btn-prev-diff') as HTMLButtonElement | null;
  const nextButton = document.getElementById('btn-next-diff') as HTMLButtonElement | null;
  if (prevButton) prevButton.disabled = prev === -1;
  if (nextButton) nextButton.disabled = next === -1;
}


function wireCollapseUnchangedToggle(handlers: {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}): void {
  const button = document.getElementById('btn-collapse-unchanged');
  if (!button) return;
  button.addEventListener('click', () => {
    const next = !handlers.isEnabled();
    handlers.setEnabled(next);
    button.classList.toggle('is-active', next);
    button.setAttribute('aria-pressed', String(next));
  });
}

function wireSyncScrollToggle(scroll: { setSyncEnabled(enabled: boolean): void }): void {
  const button = document.getElementById('btn-sync-scroll');
  if (!button) return;
  let enabled = true;
  button.addEventListener('click', () => {
    enabled = !enabled;
    scroll.setSyncEnabled(enabled);
    button.classList.toggle('is-active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
  });
}

function wireStageAllCheckbox(bridge: HostBridge): void {
  const checkbox = document.getElementById('diff-stage-all') as HTMLInputElement | null;
  if (!checkbox) return;
  checkbox.addEventListener('change', () => {
    bridge.send({ kind: checkbox.checked ? 'stageAll' : 'unstageAll' });
  });
}

/**
 * Reflects the aggregate staged state onto the master checkbox. The
 * decision itself lives in {@link allHunksStaged} — this function only
 * mutates DOM.
 */
function syncStageAllCheckbox(file: DiffFileDTO, stagedHunkIds: ReadonlySet<string>): void {
  const checkbox = document.getElementById('diff-stage-all') as HTMLInputElement | null;
  if (!checkbox) return;
  checkbox.checked = allHunksStaged(file, stagedHunkIds);
}

/**
 * Toggles the master "stage all" checkbox's host visibility — it only
 * makes sense when the file has at least one hunk. Hiding it via the
 * parent col-header keeps the grid layout consistent (the cell remains,
 * just empty).
 */
function setStageAllVisible(visible: boolean): void {
  const header = document.querySelector<HTMLElement>('.col-header.diff-stage-all-header');
  if (!header) return;
  header.style.visibility = visible ? 'visible' : 'hidden';
}

function wholeLine(startLine: number, endLine: number): MonacoLineRange {
  return { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: 1 };
}

function paneTintClass(section: DiffSection, pane: 'head' | 'working'): string {
  // Both Monaco panes render at the staged-fill alpha unconditionally —
  // the bands are the user's anchor for "what changed", they don't dim
  // with the staged state. The dim transition belongs to the gutter band
  // + bezier corridor only.
  if (section.hunkClass === 'mod') return 'conflict-line-mod';
  if (section.hunkClass === 'add') return pane === 'working' ? 'conflict-line-add' : '';
  return pane === 'head' ? 'conflict-line-del' : '';
}

const PADLOCK_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="7" width="10" height="7" rx="1"/>' +
  '<path d="M5 7 V5 a3 3 0 0 1 6 0 V7"/>' +
  '</svg>';

const DIFF_LAYOUT_HTML = `
<div class="col-header diff-index-header" style="grid-column: 1">
  <span class="diff-index-lock">${PADLOCK_ICON}</span>
  <span class="diff-index-hash" id="diff-index-hash"></span>
  <span class="diff-index-path" id="diff-index-path"></span>
</div>
<div class="col-header" style="grid-column: 2 / span 5"></div>
<div class="col-header diff-stage-all-header" style="grid-column: 7" title="Stage every hunk in the file">
  <label class="stage-checkbox">
    <input type="checkbox" id="diff-stage-all" />
  </label>
</div>
<div class="col-header" style="grid-column: 8"></div>
<div class="col-header" style="grid-column: 9">Current version</div>

<div class="editor-pane" id="diff-pane-head" style="grid-column: 1"><div class="monaco-host" id="diff-host-head"></div></div>
<div class="gutter-cell spacer-cell"  id="diff-space-l"          style="grid-column: 2"><div class="gutter-content"></div></div>
<div class="gutter-cell actions-cell" id="diff-actions-revert"   style="grid-column: 3"><div class="gutter-content"></div></div>
<div class="gutter-cell"              id="diff-ln-head"          style="grid-column: 4"><div class="gutter-content"></div></div>
<div class="pipes-cell"               id="diff-pipes"            style="grid-column: 5"><svg></svg></div>
<div class="gutter-cell"              id="diff-ln-working"       style="grid-column: 6"><div class="gutter-content"></div></div>
<div class="gutter-cell actions-cell" id="diff-actions-stage"    style="grid-column: 7"><div class="gutter-content"></div></div>
<div class="gutter-cell spacer-cell"  id="diff-space-r"          style="grid-column: 8"><div class="gutter-content"></div></div>
<div class="editor-pane" id="diff-pane-working" style="grid-column: 9"><div class="monaco-host" id="diff-host-working"></div></div>
`.trim();
