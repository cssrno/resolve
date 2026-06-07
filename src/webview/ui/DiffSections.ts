import type { DiffFileDTO, DiffHunkDTO } from '../../shared/protocol';

export type DiffSectionKind = 'ctx' | 'ctx-collapsed' | 'hunk';
export type HunkClass = 'add' | 'mod' | 'del';

export interface DiffSection {
  readonly kind: DiffSectionKind;
  /** Hunk id when kind = 'hunk', null otherwise. */
  readonly hunkId: string | null;
  readonly hunkClass: HunkClass | null;
  /** Whether this hunk is currently staged in the index. */
  readonly staged: boolean;
  /**
   * How many lines each pane really represents in this section. For a
   * collapsed context section this is the FULL original count (so line
   * number gutters keep aligned), even though the pane only renders 1
   * placeholder row.
   */
  readonly headLineCount: number;
  readonly workingLineCount: number;
  /**
   * Visible row count (= what Monaco / the gutter renders). Equals
   * headLineCount/workingLineCount for ctx + hunk; equals 1 for ctx-collapsed.
   */
  readonly visualRowCount: number;
  /**
   * Preview text shown inside the gray placeholder bar of a collapsed
   * context section — typically the first line of the unchanged range.
   * Empty string for non-collapsed sections.
   */
  readonly collapsedPreview: string;
  /**
   * Line number range (1-based, inclusive, working pane) of the original
   * unchanged region. Lets the click-to-expand handler re-key sections
   * across refreshes by content position rather than array index.
   */
  readonly collapsedWorkingStart: number;
  readonly collapsedWorkingEnd: number;
}

export interface BuildDiffSectionsOptions {
  /** When true, ctx > threshold lines collapse to a single placeholder row. */
  readonly collapseUnchanged: boolean;
  /**
   * Context sections (keyed by `${workingStart}-${workingEnd}`) the user
   * has explicitly expanded — these stay full-height even when
   * `collapseUnchanged` is on.
   */
  readonly expandedContextKeys: ReadonlySet<string>;
  /** Minimum line count for a ctx range to be eligible for collapsing. */
  readonly collapseThreshold: number;
}

export const DEFAULT_COLLAPSE_THRESHOLD = 6;

export function collapsedKey(section: DiffSection): string {
  return `${section.collapsedWorkingStart}-${section.collapsedWorkingEnd}`;
}

export interface DiffPaneTexts {
  head: string;
  working: string;
}

/**
 * Walks the diff file's hunks (1-based line positions on both sides) and
 * emits context sections for unchanged ranges plus one hunk section per
 * change. Hunks that grow or shrink the file pad the shorter pane with
 * empty rows so both Monaco editors stay vertically aligned line-for-line.
 */
export function buildDiffSections(
  file: DiffFileDTO,
  stagedHunkIds: ReadonlySet<string>,
  options: BuildDiffSectionsOptions = {
    collapseUnchanged: false,
    expandedContextKeys: new Set(),
    collapseThreshold: DEFAULT_COLLAPSE_THRESHOLD,
  },
): DiffSection[] {
  const sections: DiffSection[] = [];
  const sortedHunks = [...file.hunks].sort((leftHunk, rightHunk) =>
    leftHunk.leftStartLine - rightHunk.leftStartLine,
  );
  let headCursor = 1;
  let workingCursor = 1;
  for (const hunk of sortedHunks) {
    if (hunk.leftStartLine > headCursor) {
      const contextLineCount = hunk.leftStartLine - headCursor;
      sections.push(
        buildContextSection(
          contextLineCount,
          workingCursor,
          file.workingLines[workingCursor - 1] ?? '',
          options,
        ),
      );
      headCursor += contextLineCount;
      workingCursor += contextLineCount;
    }
    sections.push(buildHunkSection(hunk, stagedHunkIds.has(hunk.id)));
    headCursor += hunk.leftLines.length;
    workingCursor += hunk.rightLines.length;
  }
  const trailingHead = file.headLines.length - (headCursor - 1);
  if (trailingHead > 0) {
    sections.push(
      buildContextSection(
        trailingHead,
        workingCursor,
        file.workingLines[workingCursor - 1] ?? '',
        options,
      ),
    );
  }
  return sections;
}

function buildContextSection(
  lineCount: number,
  workingStart: number,
  firstLineContent: string,
  options: BuildDiffSectionsOptions,
): DiffSection {
  const workingEnd = workingStart + lineCount - 1;
  const key = `${workingStart}-${workingEnd}`;
  const eligible = options.collapseUnchanged && lineCount >= options.collapseThreshold;
  const userExpanded = options.expandedContextKeys.has(key);
  const collapsed = eligible && !userExpanded;
  return {
    kind: collapsed ? 'ctx-collapsed' : 'ctx',
    hunkId: null,
    hunkClass: null,
    staged: false,
    headLineCount: lineCount,
    workingLineCount: lineCount,
    visualRowCount: collapsed ? 1 : lineCount,
    collapsedPreview: collapsed ? firstLineContent : '',
    collapsedWorkingStart: workingStart,
    collapsedWorkingEnd: workingEnd,
  };
}

function buildHunkSection(hunk: DiffHunkDTO, staged: boolean): DiffSection {
  return {
    kind: 'hunk',
    hunkId: hunk.id,
    hunkClass: classifyHunk(hunk),
    staged,
    headLineCount: hunk.leftLines.length,
    workingLineCount: hunk.rightLines.length,
    visualRowCount: Math.max(hunk.leftLines.length, hunk.rightLines.length, 1),
    collapsedPreview: '',
    collapsedWorkingStart: 0,
    collapsedWorkingEnd: 0,
  };
}

function classifyHunk(hunk: DiffHunkDTO): HunkClass {
  if (hunk.leftLines.length === 0) return 'add';
  if (hunk.rightLines.length === 0) return 'del';
  return 'mod';
}

/**
 * Returns the two strings Monaco renders. Each pane gets its actual file
 * content — no padding. The shorter side simply has fewer rows; vertical
 * alignment is handled by the virtual scroll sync, and zero-line hunks
 * are signalled by inter-line markers (a colored 2px stroke at the
 * boundary), exactly like the merge view does for one-sided changes.
 */
export function diffPaneTexts(file: DiffFileDTO, sections: readonly DiffSection[]): DiffPaneTexts {
  // Fast path: no collapsed sections → emit the original file content
  // verbatim, no per-line concat work.
  if (!sections.some((section) => section.kind === 'ctx-collapsed')) {
    return {
      head: file.headLines.join('\n'),
      working: file.workingLines.join('\n'),
    };
  }
  const headOut: string[] = [];
  const workingOut: string[] = [];
  let headCursor = 0;
  let workingCursor = 0;
  for (const section of sections) {
    if (section.kind === 'ctx-collapsed') {
      // Render one placeholder line on each pane carrying the first
      // unchanged line as a hint; advance the source cursors past the
      // full collapsed range so subsequent sections pick up where the
      // original content actually continues.
      const headPreview = file.headLines[headCursor] ?? '';
      const workingPreview = file.workingLines[workingCursor] ?? '';
      headOut.push(headPreview);
      workingOut.push(workingPreview);
      headCursor += section.headLineCount;
      workingCursor += section.workingLineCount;
      continue;
    }
    const headSlice = file.headLines.slice(headCursor, headCursor + section.headLineCount);
    const workingSlice = file.workingLines.slice(
      workingCursor,
      workingCursor + section.workingLineCount,
    );
    headOut.push(...headSlice);
    workingOut.push(...workingSlice);
    headCursor += section.headLineCount;
    workingCursor += section.workingLineCount;
  }
  return { head: headOut.join('\n'), working: workingOut.join('\n') };
}

/* ============================================================================
 * Selection predicates — pure aggregations over the file + staged set.
 * Webview UI calls these to drive the master checkbox state; tests pin
 * the rules in isolation so DOM doesn't need to be in scope.
 * ========================================================================== */

/**
 * True when every displayed hunk is in the staged set. An empty file
 * returns false — there is nothing to mark as "all staged", so the
 * master checkbox stays off. Hunks the staged set doesn't know about
 * count as unstaged.
 */
export function allHunksStaged(
  file: DiffFileDTO,
  stagedHunkIds: ReadonlySet<string>,
): boolean {
  if (file.hunks.length === 0) return false;
  return file.hunks.every((hunk) => stagedHunkIds.has(hunk.id));
}

/**
 * Returns the count of displayed hunks that are in the staged set —
 * i.e. how many would be part of the next commit. Ids in the set that
 * don't correspond to a displayed hunk are ignored.
 */
export function stagedHunkCount(
  file: DiffFileDTO,
  stagedHunkIds: ReadonlySet<string>,
): number {
  let count = 0;
  for (const hunk of file.hunks) {
    if (stagedHunkIds.has(hunk.id)) count++;
  }
  return count;
}

/**
 * Returns the index of the next hunk section strictly after `fromIndex`.
 * `-1` means no further hunk exists; the caller can choose to wrap
 * around or no-op. Used by the toolbar's "next diff" arrow.
 */
export function nextHunkSectionIndex(
  sections: readonly DiffSection[],
  fromIndex: number,
): number {
  for (let index = fromIndex + 1; index < sections.length; index++) {
    if (sections[index]!.kind === 'hunk') return index;
  }
  return -1;
}

/**
 * Returns the index of the previous hunk section strictly before
 * `fromIndex`. `-1` means none exists.
 */
export function previousHunkSectionIndex(
  sections: readonly DiffSection[],
  fromIndex: number,
): number {
  for (let index = fromIndex - 1; index >= 0; index--) {
    if (sections[index]!.kind === 'hunk') return index;
  }
  return -1;
}

/**
 * Returns the 1-based line number in the working pane at which the
 * given section starts. Sum of all preceding sections' working-line
 * counts, plus one — `0` would be invalid for Monaco's setPosition.
 * Returns 1 for indexes that are out of range so the caller can pass
 * the result to Monaco without a guard.
 */
function workingPaneRowCount(section: DiffSection): number {
  // The working Monaco pane only renders 1 line per collapsed ctx
  // placeholder; otherwise it carries one line per real working-side row.
  if (section.kind === 'ctx-collapsed') return 1;
  return section.workingLineCount;
}

export function workingLineOfSection(
  sections: readonly DiffSection[],
  sectionIndex: number,
): number {
  if (sectionIndex <= 0) return 1;
  let workingLine = 1;
  for (let index = 0; index < sectionIndex && index < sections.length; index++) {
    workingLine += workingPaneRowCount(sections[index]!);
  }
  return workingLine;
}

/**
 * Computes the human-facing hunk ordinal (1-based) for a section index.
 * Returns 0 when the index isn't on a hunk section (e.g. ctx or out of
 * range). Used by the toolbar's debug counter.
 */
export function hunkOrdinalAtSection(
  sections: readonly DiffSection[],
  sectionIndex: number,
): number {
  if (sectionIndex < 0 || sectionIndex >= sections.length) return 0;
  if (sections[sectionIndex]!.kind !== 'hunk') return 0;
  let ordinal = 0;
  for (let index = 0; index <= sectionIndex; index++) {
    if (sections[index]!.kind === 'hunk') ordinal++;
  }
  return ordinal;
}

/** Total number of hunk sections in the section list. */
export function totalHunks(sections: readonly DiffSection[]): number {
  let count = 0;
  for (const section of sections) {
    if (section.kind === 'hunk') count++;
  }
  return count;
}

/**
 * Maps a 1-based working-pane line number to the section index that
 * owns it. Returns -1 when the line is outside the file. Used by the
 * cursor-aware navigation tracker: when the user clicks somewhere in
 * the working pane, we figure out which hunk (or ctx) they landed on
 * and update the current-section cursor accordingly.
 */
export function sectionIndexAtWorkingLine(
  sections: readonly DiffSection[],
  lineNumber: number,
): number {
  if (lineNumber < 1) return -1;
  let cursor = 1;
  for (let index = 0; index < sections.length; index++) {
    const count = workingPaneRowCount(sections[index]!);
    if (count === 0) continue;
    if (lineNumber < cursor + count) return index;
    cursor += count;
  }
  return -1;
}
