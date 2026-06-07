import type {
  ConflictBlockDTO,
  ConflictFileDTO,
  ResolutionDTO,
} from '../../shared/protocol';

/* ============================================================================
 * Section model — the merge view's domain rules.
 *
 * Every visual behavior in the webview (gutter row colors, Monaco line
 * decorations, bezier strokes, action-button visibility) is derived from the
 * `Section[]` produced here. No renderer is allowed to invent rules; if a
 * pixel changes, this file changes. The golden snapshot tests pin every rule.
 *
 * Vocabulary:
 *   - "side"           = one of the three panes (local | result | remote)
 *   - "block"          = a Git conflict region (<<<<<<<…>>>>>>>) in the file
 *   - "block class"    = our domain classification of a block (add / mod / del / conflict)
 *   - "consumed side"  = a side whose content ended up in Result via the user resolution
 *   - "fully resolved" = the block is no longer pending (no red zone anywhere)
 *
 * The rules below are intentionally redundant against the renderers — both
 * read this file. The golden test diffs catch any drift.
 * ========================================================================== */

export type PaneId = 'local' | 'result' | 'remote';
export type SectionKind = 'ctx' | 'ctx-collapsed' | 'conflict';

/**
 * A `ChangeType` is the CSS-class-shaped tag attached to a pane row. It tells
 * the renderer which colored band to paint (or which lack thereof, for an
 * accepted side which is conveyed via the separate outline flag).
 */
export type ChangeType =
  | ''                    // no band
  | 'add'                 // green tint
  | 'mod'                 // blue tint
  | 'del'                 // gray tint
  | 'conflict'            // red tint, both sides changed (pending)
  | 'result-resolved'     // light green — manual or accept-both succeeded
  | 'result-unresolved'   // red — conflict not yet fully resolved
  | 'resolved-outline';   // legacy alias, kept for type completeness

/**
 * Domain classification of a conflict block. Computed once from the raw
 * `ConflictBlockDTO` (= what Git emits + a parsed base section).
 */
export type BlockClass =
  | 'conflict'   // both sides diverge from base; user must choose
  | 'localAdd'   // base empty,  local has new lines, remote unchanged
  | 'remoteAdd'  // base empty,  remote has new lines, local unchanged
  | 'localMod'   // local rewrote base lines, remote unchanged
  | 'remoteMod'  // remote rewrote base lines, local unchanged
  | 'localDel'   // local removed base lines, remote kept them
  | 'remoteDel'; // remote removed base lines, local kept them

export interface Section {
  kind: SectionKind;
  blockId: string | null;
  blockClass: BlockClass | null;
  /** True as soon as the user picked any resolution (used by renderers that
   *  don't need the per-side detail, e.g. bezier styling). */
  resolved: boolean;
  /** Per-pane outline flag — a pane is outlined ONLY if its content actively
   *  contributed to the resolution. */
  resolvedSides: Record<PaneId, boolean>;
  /** Number of VISIBLE editor rows in each pane (= 1 for a collapsed ctx,
   *  even though the section stands in for many real unchanged lines). */
  paneLineCount: Record<PaneId, number>;
  /** ChangeType applied to the pane's band background. */
  paneClass: Record<PaneId, ChangeType>;
  /** First unchanged line shown as a preview inside a collapsed ctx
   *  placeholder. Empty for non-collapsed sections. */
  collapsedPreview: string;
  /** 1-based original-line range (in `file.originalLines`) that the
   *  collapsed section stands in for. Zero for non-ctx-collapsed. */
  collapsedStartLine: number;
  collapsedEndLine: number;
}

export interface BuildSectionsOptions {
  readonly collapseUnchanged: boolean;
  /** Per-section identity keys (`${start}-${end}`) the user has explicitly
   *  expanded — these stay full-height even with the toggle ON. */
  readonly expandedContextKeys: ReadonlySet<string>;
  readonly collapseThreshold: number;
}

export const DEFAULT_COLLAPSE_THRESHOLD = 6;

export function collapsedKey(section: Section): string {
  return `${section.collapsedStartLine}-${section.collapsedEndLine}`;
}

/* ============================================================================
 * Rule book — every visual decision is a named, exported predicate so the
 * renderers (GutterPainter, ConflictDecorations, BezierOverlay, ActionButtons)
 * can call it instead of reimplementing logic inline.
 * ========================================================================== */

/** A pane is "outlined" if and only if it was consumed by the resolution. */
export function isPaneOutlined(section: Section, pane: PaneId): boolean {
  return section.resolvedSides[pane];
}

/** A block is "fully resolved" only when every pending side has been handled.
 *  For a conflict that means BOTH local and remote must be consumed. */
export function isBlockFullyResolved(section: Section): boolean {
  if (section.kind !== 'conflict') return false;
  return section.resolvedSides.local && section.resolvedSides.remote
    || section.blockClass !== 'conflict' && section.resolved;
}

/** Action buttons are visible on a gutter side ONLY while that side is still
 *  pending (= not yet consumed by a resolution). Once accepted, the buttons
 *  disappear; the reset (cross) flow comes from a different control. */
export function shouldShowActionButtons(section: Section, gutterEdge: 'left' | 'right'): boolean {
  if (section.kind !== 'conflict' || !section.blockId) return false;
  const pane: PaneId = gutterEdge === 'left' ? 'local' : 'remote';
  return !section.resolvedSides[pane];
}

/** The bezier on a given gutter goes dashed (no fill) iff the pane on that
 *  side has been consumed — visually says "this change has been applied". */
export function shouldBezierBeDashed(section: Section, gutterEdge: 'left' | 'right'): boolean {
  if (section.kind !== 'conflict') return false;
  const pane: PaneId = gutterEdge === 'left' ? 'local' : 'remote';
  return section.resolvedSides[pane];
}

/** Resolved CSS color family — top/bottom dashes use this hue. */
export function resolvedAccentFor(blockClass: BlockClass | null): 'add' | 'mod' | 'del' | 'conflict' {
  if (!blockClass) return 'conflict';
  if (blockClass === 'conflict') return 'conflict';
  if (blockClass.endsWith('Add')) return 'add';
  if (blockClass.endsWith('Mod')) return 'mod';
  return 'del';
}

/** Returns the index of the next conflict-block section strictly after
 *  `fromIndex`. `-1` when nothing follows. Used by the toolbar's
 *  next-block arrow in the merge view. */
export function nextBlockSectionIndex(
  sections: readonly Section[],
  fromIndex: number,
): number {
  for (let index = fromIndex + 1; index < sections.length; index++) {
    if (sections[index]!.kind === 'conflict') return index;
  }
  return -1;
}

/** Symmetric counterpart — index of the previous conflict-block
 *  section strictly before `fromIndex`. */
export function previousBlockSectionIndex(
  sections: readonly Section[],
  fromIndex: number,
): number {
  for (let index = fromIndex - 1; index >= 0; index--) {
    if (sections[index]!.kind === 'conflict') return index;
  }
  return -1;
}

/** 1-based line number in the result pane at which the given section
 *  starts. Used to position Monaco's cursor when navigating between
 *  blocks. */
export function resultLineOfSection(
  sections: readonly Section[],
  sectionIndex: number,
): number {
  if (sectionIndex <= 0) return 1;
  let resultLine = 1;
  for (let index = 0; index < sectionIndex && index < sections.length; index++) {
    resultLine += sections[index]!.paneLineCount.result;
  }
  return resultLine;
}

/** Marker class painted at the bottom of the previous line when a side has
 *  ZERO lines for a non-context section (deletion landing point). */
export function interlineMarkerFor(blockClass: BlockClass | null): 'add' | 'mod' | 'del' | 'conflict' | null {
  if (!blockClass) return null;
  return resolvedAccentFor(blockClass);
}

/* ============================================================================
 * Section construction — buildSections walks every block in the file and
 * emits one `ctx` section per gap of unchanged code plus one `conflict`
 * section per merge block, applying the rules above.
 * ========================================================================== */

export function buildSections(
  file: ConflictFileDTO,
  options: BuildSectionsOptions = {
    collapseUnchanged: false,
    expandedContextKeys: new Set(),
    collapseThreshold: DEFAULT_COLLAPSE_THRESHOLD,
  },
): Section[] {
  const sections: Section[] = [];
  let cursor = 0;
  for (const block of file.blocks) {
    if (cursor < block.startLine) {
      pushCtxRange(sections, cursor, block.startLine - cursor, file.originalLines, options);
    }
    sections.push(buildBlockSection(block));
    cursor = block.endLine + 1;
  }
  if (cursor < file.originalLines.length) {
    pushCtxRange(sections, cursor, file.originalLines.length - cursor, file.originalLines, options);
  }
  return sections;
}

const CTX_PADDING_LINES = 5;

/**
 * Push one or three sections for a context range. When collapsing is
 * enabled and the range is wide enough to leave at least one collapsed
 * middle line on top of the padding (CTX_PADDING_LINES on each side
 * = real unchanged lines kept visible), we split:
 *   - head:   CTX_PADDING_LINES uncollapsed real lines
 *   - middle: ctx-collapsed (lineCount - 2 * CTX_PADDING_LINES)
 *   - tail:   CTX_PADDING_LINES uncollapsed real lines
 * Otherwise we push a single normal ctx section with every line.
 */
function pushCtxRange(
  sections: Section[],
  zeroBasedStart: number,
  lineCount: number,
  originalLines: readonly string[],
  options: BuildSectionsOptions,
): void {
  const minToSplit = 2 * CTX_PADDING_LINES + options.collapseThreshold;
  const eligible = options.collapseUnchanged && lineCount >= minToSplit;
  if (!eligible) {
    sections.push(buildCtxSection(lineCount, zeroBasedStart, originalLines, options));
    return;
  }
  sections.push(
    buildCtxSection(CTX_PADDING_LINES, zeroBasedStart, originalLines, options),
  );
  const middleCount = lineCount - 2 * CTX_PADDING_LINES;
  sections.push(
    buildCtxSection(
      middleCount,
      zeroBasedStart + CTX_PADDING_LINES,
      originalLines,
      options,
    ),
  );
  sections.push(
    buildCtxSection(
      CTX_PADDING_LINES,
      zeroBasedStart + CTX_PADDING_LINES + middleCount,
      originalLines,
      options,
    ),
  );
}

function buildCtxSection(
  lineCount: number,
  zeroBasedStart: number,
  originalLines: readonly string[],
  options: BuildSectionsOptions,
): Section {
  const startLine = zeroBasedStart + 1;
  const endLine = startLine + lineCount - 1;
  const key = `${startLine}-${endLine}`;
  const eligible = options.collapseUnchanged && lineCount >= options.collapseThreshold;
  const userExpanded = options.expandedContextKeys.has(key);
  const collapsed = eligible && !userExpanded;
  // Use the first NON-BLANK line in the range as preview; empty lines
  // would render as a featureless gray bar and lose the breadcrumb hint.
  const preview = collapsed
    ? extractBreadcrumb(originalLines, zeroBasedStart, lineCount)
    : '';
  const visibleRowCount = collapsed ? 1 : lineCount;
  return {
    kind: collapsed ? 'ctx-collapsed' : 'ctx',
    blockId: null,
    blockClass: null,
    resolved: false,
    resolvedSides: { local: false, result: false, remote: false },
    paneLineCount: {
      local: visibleRowCount,
      result: visibleRowCount,
      remote: visibleRowCount,
    },
    paneClass: { local: '', result: '', remote: '' },
    collapsedPreview: preview,
    collapsedStartLine: startLine,
    collapsedEndLine: endLine,
  };
}

function firstNonBlankLine(
  lines: readonly string[],
  startIndex: number,
  count: number,
): string {
  for (let offset = 0; offset < count; offset++) {
    const line = lines[startIndex + offset] ?? '';
    if (line.trim().length > 0) return line;
  }
  return lines[startIndex] ?? '';
}

/**
 * Breadcrumb label for a collapsed range. Surfaces the FIRST and LAST
 * declaration-looking lines (function/class/method signatures) so the
 * user sees concrete code that bookends the collapsed region rather
 * than a synthesized `Name()` label. Falls back to "N hidden lines"
 * with the first non-blank line trimmed when no declarations match.
 */
function extractBreadcrumb(
  lines: readonly string[],
  startIndex: number,
  count: number,
): string {
  const DECL_PATTERN =
    /\b(?:class|interface|trait|function|def|fn|public function|private function|protected function|static function)\b/;
  const declLines: string[] = [];
  for (let offset = 0; offset < count; offset++) {
    const trimmed = (lines[startIndex + offset] ?? '').trim().replace(/\s*\{?\s*$/, '');
    if (!trimmed) continue;
    if (DECL_PATTERN.test(trimmed)) declLines.push(trimmed);
  }
  const truncate = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;
  if (declLines.length >= 2) {
    const first = truncate(declLines[0]!, 36);
    const last = truncate(declLines[declLines.length - 1]!, 36);
    return `${first}  …  ${last}     (${count} hidden lines)`;
  }
  if (declLines.length === 1) {
    return `${truncate(declLines[0]!, 70)}     (${count} hidden lines)`;
  }
  const firstNonBlank = firstNonBlankLine(lines, startIndex, count).trim();
  return `${truncate(firstNonBlank, 60)}     (${count} hidden lines)`;
}

function buildBlockSection(block: ConflictBlockDTO): Section {
  const blockClass = classifyBlock(block);
  const isResolved = block.resolution !== null;
  const consumed = consumedSidesFor(block.resolution);
  const baseLineCount = block.baseLines?.length ?? 0;

  const paneLineCount = computePaneLineCounts(block, blockClass, baseLineCount);
  const sideColors = computeSidePaneClasses(blockClass, consumed);
  const fullyResolved = blockClass === 'conflict'
    ? consumed.local && consumed.remote
    : isResolved;
  const resultClass = computeResultPaneClass(blockClass, fullyResolved);

  return {
    kind: 'conflict',
    blockId: block.id,
    blockClass,
    resolved: isResolved,
    resolvedSides: {
      local: isResolved && consumed.local,
      result: fullyResolved,
      remote: isResolved && consumed.remote,
    },
    paneLineCount,
    paneClass: {
      local: sideColors.local,
      result: resultClass,
      remote: sideColors.remote,
    },
    collapsedPreview: '',
    collapsedStartLine: 0,
    collapsedEndLine: 0,
  };
}

/* ============================================================================
 * Classification — decides whether a block is a true conflict or a one-sided
 * add/mod/del. Without a base section (`|||||||`) we can never tell, so 2-way
 * markers default to `conflict`.
 * ========================================================================== */

export function classifyBlock(block: ConflictBlockDTO): BlockClass {
  if (block.baseLines === null) return 'conflict';
  const base = block.baseLines;
  const localChanged = !areLineArraysEqual(block.localLines, base);
  const remoteChanged = !areLineArraysEqual(block.remoteLines, base);
  if (localChanged && remoteChanged) return 'conflict';
  if (localChanged) return classifyOneSidedChange('local', block.localLines.length, base.length);
  if (remoteChanged) return classifyOneSidedChange('remote', block.remoteLines.length, base.length);
  return 'conflict'; // no change vs base on either side — unexpected, treat as conflict
}

function classifyOneSidedChange(
  side: 'local' | 'remote',
  changedLineCount: number,
  baseLineCount: number,
): BlockClass {
  if (baseLineCount === 0) return side === 'local' ? 'localAdd' : 'remoteAdd';
  if (changedLineCount === 0) return side === 'local' ? 'localDel' : 'remoteDel';
  return side === 'local' ? 'localMod' : 'remoteMod';
}

function areLineArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/* ============================================================================
 * Resolution → consumed-sides table. Every resolution kind maps to a fixed
 * pair of booleans; this is the single source of truth for "which side did
 * the user accept".
 * ========================================================================== */

interface ConsumedSides { local: boolean; remote: boolean }

function consumedSidesFor(resolution: ResolutionDTO | null): ConsumedSides {
  if (resolution === null) return { local: false, remote: false };
  if (resolution.kind === 'manual') return { local: true, remote: true };
  return {
    local: resolution.left !== undefined,
    remote: resolution.right !== undefined,
  };
}

/* ============================================================================
 * Per-pane width (= number of editor lines) per (BlockClass, side) cell.
 *
 * - Unchanged side of a one-sided change displays the BASE content so the
 *   panes stay vertically aligned with the changed pane.
 * - The side that DELETED shows 0 rows; renderers paint an inter-line marker
 *   at the boundary so the user still sees where the deletion lands.
 * ========================================================================== */

function computePaneLineCounts(
  block: ConflictBlockDTO,
  blockClass: BlockClass,
  baseLineCount: number,
): Record<PaneId, number> {
  const resultLineCount = resolvedResultLines(block, blockClass).length;
  let local = block.localLines.length;
  let remote = block.remoteLines.length;
  switch (blockClass) {
    case 'remoteAdd':
    case 'remoteMod':
      local = baseLineCount;
      break;
    case 'localAdd':
    case 'localMod':
      remote = baseLineCount;
      break;
    case 'localDel':
      local = 0;
      remote = baseLineCount;
      break;
    case 'remoteDel':
      local = baseLineCount;
      remote = 0;
      break;
    case 'conflict':
      // local/remote already correct from raw block lines
      break;
  }
  return { local, result: resultLineCount, remote };
}

/* ============================================================================
 * Color classes — every pane's band is derived from (BlockClass, consumed).
 * Consumed sides drop their color (the dashed outline replaces it). Pending
 * sides keep the colored fill.
 * ========================================================================== */

const PANE_COLOR_BY_BLOCK_CLASS: Record<BlockClass, { local: ChangeType; remote: ChangeType }> = {
  conflict:  { local: 'conflict', remote: 'conflict' },
  localAdd:  { local: 'add',      remote: ''        },
  remoteAdd: { local: '',         remote: 'add'     },
  localMod:  { local: 'mod',      remote: ''        },
  remoteMod: { local: '',         remote: 'mod'     },
  localDel:  { local: '',         remote: ''        },
  remoteDel: { local: '',         remote: ''        },
};

function computeSidePaneClasses(
  blockClass: BlockClass,
  consumed: ConsumedSides,
): { local: ChangeType; remote: ChangeType } {
  const base = PANE_COLOR_BY_BLOCK_CLASS[blockClass];
  return {
    local:  consumed.local  ? '' : base.local,
    remote: consumed.remote ? '' : base.remote,
  };
}

function computeResultPaneClass(blockClass: BlockClass, fullyResolved: boolean): ChangeType {
  if (fullyResolved) return '';
  if (blockClass === 'conflict') return 'result-unresolved';
  return autoResultChangeType(blockClass);
}

function autoResultChangeType(blockClass: BlockClass): ChangeType {
  switch (blockClass) {
    case 'localAdd':
    case 'remoteAdd': return 'add';
    case 'localMod':
    case 'remoteMod': return 'mod';
    case 'localDel':
    case 'remoteDel': return 'del';
    default:          return 'result-resolved';
  }
}

/* ============================================================================
 * Resolved-result text — what lines actually appear in the Result pane.
 *
 * Until the user accepts, Result mirrors the BASE content tinted with the
 * change type. Once accepted, Result reflects the chosen side(s).
 * ========================================================================== */

function resolvedResultLines(block: ConflictBlockDTO, blockClass: BlockClass): string[] {
  const isOneSidedPending = blockClass !== 'conflict' && block.resolution === null;
  if (isOneSidedPending) {
    return [...(block.baseLines ?? [])];
  }
  const resolution = block.resolution;
  if (resolution === null) {
    const unresolvedRowCount = Math.max(block.localLines.length, block.remoteLines.length, 1);
    return Array(unresolvedRowCount).fill('');
  }
  if (resolution.kind === 'manual') return resolution.lines;
  const out: string[] = [];
  if (resolution.left === 'accepted') out.push(...block.localLines);
  if (resolution.right === 'accepted') out.push(...block.remoteLines);
  if (out.length === 0) {
    // Both sides decided as rejected, or partial state with no acceptances yet.
    // Keep at least one placeholder row so pane heights don't collapse to zero.
    const fallbackRowCount = Math.max(block.localLines.length, block.remoteLines.length, 1);
    return Array(fallbackRowCount).fill('');
  }
  return out;
}

/* ============================================================================
 * Pane text composition — joins context lines and per-block content into the
 * three strings fed into the Monaco editors.
 * ========================================================================== */

export interface PaneTexts {
  local: string;
  result: string;
  remote: string;
}

export function paneTextsFromSections(
  file: ConflictFileDTO,
  sections: Section[],
): PaneTexts {
  const localLines: string[] = [];
  const resultLines: string[] = [];
  const remoteLines: string[] = [];
  let cursor = 0;

  for (const section of sections) {
    if (section.kind === 'ctx') {
      const ctxLines = file.originalLines.slice(cursor, cursor + section.paneLineCount.local);
      localLines.push(...ctxLines);
      resultLines.push(...ctxLines);
      remoteLines.push(...ctxLines);
      cursor += section.paneLineCount.local;
      continue;
    }
    if (section.kind === 'ctx-collapsed') {
      // Pane content for the placeholder row is empty; the breadcrumb
      // chip overlay (rendered by BreadcrumbOverlay) hovers over each
      // pane at this row's Y with the actual label. Keeps the Monaco
      // line free of text so the wavy stroke + chip read cleanly.
      const originalLineCount =
        section.collapsedEndLine - section.collapsedStartLine + 1;
      localLines.push('');
      resultLines.push('');
      remoteLines.push('');
      cursor += originalLineCount;
      continue;
    }
    const block = lookupBlock(file, section.blockId!);
    const base = block.baseLines ?? [];
    appendSidePaneContent(section.blockClass!, block, base, localLines, remoteLines);
    resultLines.push(...resolvedResultLines(block, section.blockClass!));
    cursor = block.endLine + 1;
  }
  return {
    local:  localLines.join('\n'),
    result: resultLines.join('\n'),
    remote: remoteLines.join('\n'),
  };
}

function appendSidePaneContent(
  blockClass: BlockClass,
  block: ConflictBlockDTO,
  base: readonly string[],
  localOut: string[],
  remoteOut: string[],
): void {
  switch (blockClass) {
    case 'localAdd':
    case 'localMod':
      localOut.push(...block.localLines);
      remoteOut.push(...base);
      return;
    case 'localDel':
      remoteOut.push(...base);
      return;
    case 'remoteAdd':
    case 'remoteMod':
      localOut.push(...base);
      remoteOut.push(...block.remoteLines);
      return;
    case 'remoteDel':
      localOut.push(...base);
      return;
    case 'conflict':
      localOut.push(...block.localLines);
      remoteOut.push(...block.remoteLines);
      return;
  }
}

function lookupBlock(file: ConflictFileDTO, blockId: string): ConflictBlockDTO {
  const found = file.blocks.find((candidate) => candidate.id === blockId);
  if (!found) throw new Error(`Section references unknown block id: ${blockId}`);
  return found;
}
