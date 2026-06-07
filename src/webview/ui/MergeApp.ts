import type { MonacoModule } from '../monaco/loader';
import type { HostBridge } from '../ipc/HostBridge';
import type { InitPayload } from '../main';
import { applyTheme } from '../monaco/ThemeApplier';
import { applyKeybindings } from '../monaco/KeybindingsApplier';
import { ActiveLinePerPane, bootMonacoLanguage, registerUndoRedoCommands } from './AppBoot';
import { PaneTrio } from './PaneTrio';
import { BezierOverlay } from './BezierOverlay';
import { BreadcrumbOverlay } from './BreadcrumbOverlay';
import { CollapsedBandOverlay } from './CollapsedBandOverlay';
import { ActionButtons } from './ActionButtons';
import { ScrollSync } from './ScrollSync';
import { GutterPainter } from './GutterPainter';
import { ConflictDecorations } from './ConflictDecorations';
import {
  buildSections,
  classifyBlock,
  DEFAULT_COLLAPSE_THRESHOLD,
  nextBlockSectionIndex,
  paneTextsFromSections,
  previousBlockSectionIndex,
  resultLineOfSection,
  type Section,
} from './Sections';

export async function mountMergeApp(
  monaco: MonacoModule,
  bridge: HostBridge,
  payload: InitPayload,
): Promise<void> {
  const monacoLang = await bootMonacoLanguage(
    monaco,
    payload.file.languageId,
    payload.grammar,
    payload.theme,
    payload.monacoBaseUri,
  );

  const trio = new PaneTrio(monaco, {
    hostLocalId: 'host-local',
    hostResultId: 'host-result',
    hostRemoteId: 'host-remote',
    font: payload.font,
    language: monacoLang,
  });

  let currentFile = payload.file;
  let sections: Section[] = [];
  // Collapse-unchanged toolbar state. Same model as the diff view:
  // `expandedContextKeys` overrides individual collapsed ranges after
  // the user clicked the gray placeholder to peek inside.
  let collapseUnchangedEnabled = false;
  const expandedContextKeys = new Set<string>();
  const painter = new GutterPainter([], trio.lineHeight);
  const overlay = new BezierOverlay(trio, []);
  const breadcrumbOverlay = new BreadcrumbOverlay(trio);
  breadcrumbOverlay.setSymbols(payload.symbols ?? []);
  const bandOverlay = new CollapsedBandOverlay(trio);
  const decorations = new ConflictDecorations(trio);
  const actions = new ActionButtons(bridge);
  const scroll = new ScrollSync(trio, trio.lineHeight, () => {
    overlay.render();
    bandOverlay.render();
    breadcrumbOverlay.render();
  });
  const activeLine = new ActiveLinePerPane(trio.group, {
    local:  ['ln-local'],
    result: ['ln-result-l', 'ln-result-r'],
    remote: ['ln-remote'],
  });

  function refresh(): void {
    sections = buildSections(currentFile, {
      collapseUnchanged: collapseUnchangedEnabled,
      expandedContextKeys,
      collapseThreshold: DEFAULT_COLLAPSE_THRESHOLD,
    });
    const texts = paneTextsFromSections(currentFile, sections);
    trio.setContent(texts);
    // Replace the existing painter/overlay's section ref by reconstructing
    (painter as unknown as { sections: Section[] }).sections = sections;
    (overlay as unknown as { sections: Section[] }).sections = sections;
    breadcrumbOverlay.setSections(sections);
    bandOverlay.setSections(sections);
    painter.paint();
    decorations.apply(sections);
    scroll.setSections(sections);
    // Monaco's setValue resets scroll to 0 — replay the current virtual scroll
    // so editors + gutters stay aligned with where the user was looking.
    scroll.recommit();
    overlay.render();
    bandOverlay.render();
    breadcrumbOverlay.render();
    syncCollapseToggleState();
    actions.render(sections);
    activeLine.refreshAll();
  }

  refresh();
  populateMergeHeaders(currentFile.uri, currentFile.mergeContext);

  for (const editor of trio.allEditors()) {
    applyKeybindings(monaco, editor, payload.keybindings, bridge);
  }

  scroll.attach();

  trio.result.onDidChangeModelContent(() => {
    const lines = trio.result.getModel()?.getValue().split(/\r?\n/) ?? [];
    bridge.send({ kind: 'editResult', blockId: '__whole', lines });
  });

  bridge.on((msg) => {
    if (msg.kind === 'blockResolved') {
      currentFile = {
        ...currentFile,
        blocks: currentFile.blocks.map((b) =>
          b.id === msg.blockId ? { ...b, resolution: msg.resolution } : b,
        ),
      };
      refresh();
    } else if (msg.kind === 'themeChanged') {
      applyTheme(monaco, msg.theme);
    } else if (msg.kind === 'saved') {
      setStatus('Saved.');
    }
  });

  wireToolbar(bridge, currentFile);
  let currentSectionIndex = -1;
  function navigateToBlock(targetIndex: number): void {
    if (targetIndex === -1) return;
    currentSectionIndex = targetIndex;
    scroll.scrollToSection(targetIndex);
    const resultLine = resultLineOfSection(sections, targetIndex);
    trio.result.setPosition({ lineNumber: resultLine, column: 1 });
    trio.result.focus();
    setBlockNavDisabledState(sections, currentSectionIndex);
  }
  document.getElementById('btn-prev-block')?.addEventListener('click', () => {
    navigateToBlock(
      previousBlockSectionIndex(
        sections,
        currentSectionIndex >= 0 ? currentSectionIndex : sections.length,
      ),
    );
  });
  document.getElementById('btn-next-block')?.addEventListener('click', () => {
    navigateToBlock(nextBlockSectionIndex(sections, currentSectionIndex));
  });
  // The toolbar button reads as ACTIVE only when every eligible
  // unchanged range is currently wrapped — i.e. the toggle is on AND
  // the user hasn't expanded a single chip. As soon as ANY chip is
  // expanded, the button flips visually off so the user can see at a
  // glance that the view is no longer "fully collapsed".
  function syncCollapseToggleState(): void {
    const button = document.getElementById('btn-collapse-unchanged');
    if (!button) return;
    const fullyCollapsed =
      collapseUnchangedEnabled && expandedContextKeys.size === 0;
    button.classList.toggle('is-active', fullyCollapsed);
    button.setAttribute('aria-pressed', String(fullyCollapsed));
  }

  // "Collapse unchanged fragments" toggle. ON → ctx ≥ threshold lines
  // collapse to 1 placeholder row. OFF → clear per-section expansions so
  // toggling ON again starts from a clean slate.
  const collapseButton = document.getElementById('btn-collapse-unchanged');
  if (collapseButton) {
    collapseButton.addEventListener('click', () => {
      // Toggle cycles between "fully collapsed" and "fully expanded".
      // Visible state ON  → user wants OFF: clear keys, disable.
      // Visible state OFF → user wants ON : re-collapse everything by
      // dropping any per-chip overrides and re-enabling the flag.
      const fullyCollapsed =
        collapseUnchangedEnabled && expandedContextKeys.size === 0;
      collapseUnchangedEnabled = !fullyCollapsed;
      expandedContextKeys.clear();
      refresh();
    });
  }
  // Delegated click → expand a specific collapsed ctx section. The chip
  // overlay is the ONLY click target (it carries the data-collapsed-key
  // attribute). Gutter rows and Monaco placeholder lines are passive.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const chip = target.closest<HTMLElement>('.ctx-breadcrumb-chip[data-collapsed-key]');
    if (!chip) return;
    const key = chip.getAttribute('data-collapsed-key');
    if (!key) return;
    expandedContextKeys.add(key);
    refresh();
  });
  const syncButton = document.getElementById('btn-sync-scroll');
  if (syncButton) {
    let syncEnabled = true;
    syncButton.addEventListener('click', () => {
      syncEnabled = !syncEnabled;
      scroll.setSyncEnabled(syncEnabled);
      syncButton.classList.toggle('is-active', syncEnabled);
      syncButton.setAttribute('aria-pressed', String(syncEnabled));
    });
  }
  trio.result.onDidChangeCursorPosition?.(
    (event: { position: { lineNumber: number } }) => {
      if (sections.length === 0) return;
      // Walk sections to find the one containing the cursor line on the
      // result pane — only update if it's a conflict block, otherwise
      // context clicks would reset the cursor.
      let cursor = 1;
      for (let index = 0; index < sections.length; index++) {
        const count = sections[index]!.paneLineCount.result;
        if (count === 0) continue;
        if (event.position.lineNumber < cursor + count) {
          if (sections[index]!.kind === 'conflict' && index !== currentSectionIndex) {
            currentSectionIndex = index;
            setBlockNavDisabledState(sections, currentSectionIndex);
          }
          break;
        }
        cursor += count;
      }
    },
  );
  setBlockNavDisabledState(sections, currentSectionIndex);
  registerUndoRedoCommands(monaco, trio.group, bridge);
  setStatus(`${currentFile.blocks.length} conflict(s)`);
  window.addEventListener('resize', () => {
    overlay.render();
    actions.render(sections);
  });
}

function setBlockNavDisabledState(
  sections: readonly Section[],
  currentSectionIndex: number,
): void {
  const prev = previousBlockSectionIndex(
    sections,
    currentSectionIndex >= 0 ? currentSectionIndex : sections.length,
  );
  const next = nextBlockSectionIndex(sections, currentSectionIndex);
  const prevButton = document.getElementById('btn-prev-block') as HTMLButtonElement | null;
  const nextButton = document.getElementById('btn-next-block') as HTMLButtonElement | null;
  if (prevButton) prevButton.disabled = prev === -1;
  if (nextButton) nextButton.disabled = next === -1;
}

function wireToolbar(bridge: HostBridge, file: InitPayload['file']): void {
  document.getElementById('btn-save')!.addEventListener('click', () => bridge.send({ kind: 'save' }));
  // "Apply non-conflicting changes: Left" — accept every block where ONLY
  // the local side has a change. Conflicts and remote-only changes stay
  // untouched. Matches IntelliJ's ">> Left" semantics.
  document.getElementById('btn-accept-all-left')!.addEventListener('click', () => {
    for (const block of file.blocks) {
      const blockClass = classifyBlock(block);
      if (blockClass === 'localAdd' || blockClass === 'localMod' || blockClass === 'localDel') {
        bridge.send({ kind: 'accept', blockId: block.id, side: 'left' });
      }
    }
  });
  document.getElementById('btn-accept-all-right')!.addEventListener('click', () => {
    for (const block of file.blocks) {
      const blockClass = classifyBlock(block);
      if (blockClass === 'remoteAdd' || blockClass === 'remoteMod' || blockClass === 'remoteDel') {
        bridge.send({ kind: 'accept', blockId: block.id, side: 'right' });
      }
    }
  });
  // "Apply non-conflicting changes: All" — both sides at once. True
  // conflicts still need the user.
  document.getElementById('btn-accept-all-both')!.addEventListener('click', () => {
    for (const block of file.blocks) {
      const blockClass = classifyBlock(block);
      if (blockClass === 'conflict') continue;
      const isLocalSide =
        blockClass === 'localAdd' || blockClass === 'localMod' || blockClass === 'localDel';
      bridge.send({ kind: 'accept', blockId: block.id, side: isLocalSide ? 'left' : 'right' });
    }
  });
  document.getElementById('btn-smart-merge')!.addEventListener('click', () => {
    document.getElementById('btn-accept-all-both')!.dispatchEvent(new Event('click'));
  });
}

function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

/**
 * Populates the IntelliJ-style merge view headers. When the host
 * provides a git merge / rebase context, the Local/Remote labels read
 * `Rebasing abc1234 from feature/foo` / `Already rebased commits and
 * commits from origin/dev` (operation-aware). Without context, falls
 * back to the file's shortened path on both sides.
 */
function populateMergeHeaders(
  uri: string,
  mergeContext: InitPayload['file']['mergeContext'],
): void {
  const setPrimary = (id: string, text: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const setSecondary = (id: string, text: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const resultSecondary = shortenUriForHeader(uri);
  setSecondary('merge-header-result-secondary', resultSecondary);
  if (!mergeContext) {
    setSecondary('merge-header-local-secondary', resultSecondary);
    setSecondary('merge-header-remote-secondary', resultSecondary);
    return;
  }
  if (mergeContext.operation === 'rebase') {
    setPrimary(
      'merge-header-local-primary',
      `Rebasing ${mergeContext.localHash}`,
    );
    setSecondary(
      'merge-header-local-secondary',
      `from ${mergeContext.localRef}`,
    );
    setPrimary(
      'merge-header-remote-primary',
      'Already rebased commits',
    );
    setSecondary(
      'merge-header-remote-secondary',
      `and commits from ${mergeContext.incomingRef}`,
    );
    return;
  }
  setPrimary(
    'merge-header-local-primary',
    `Merging into ${mergeContext.localRef || 'HEAD'}`,
  );
  setSecondary('merge-header-local-secondary', mergeContext.localHash);
  setPrimary(
    'merge-header-remote-primary',
    `Incoming ${mergeContext.incomingRef}`,
  );
  setSecondary('merge-header-remote-secondary', mergeContext.incomingHash);
}

function shortenUriForHeader(uri: string): string {
  try {
    const pathLike = uri.replace(/^[a-z]+:\/\//, '');
    const segments = pathLike.split('/').filter(Boolean);
    if (segments.length <= 4) return pathLike;
    return `${segments.slice(0, 2).join('/')}/…/${segments.slice(-2).join('/')}`;
  } catch {
    return uri;
  }
}
