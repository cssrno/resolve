import { describe, it, expect } from 'vitest';
import {
  allHunksStaged,
  hunkOrdinalAtSection,
  nextHunkSectionIndex,
  previousHunkSectionIndex,
  sectionIndexAtWorkingLine,
  stagedHunkCount,
  totalHunks,
  workingLineOfSection,
  type DiffSection,
} from '../../src/webview/ui/DiffSections';
import { makeHunkId } from '../../src/domain/Diff';
import type { DiffFileDTO, DiffHunkDTO } from '../../src/shared/protocol';

describe('allHunksStaged (pure decision behind the master checkbox)', () => {
  it('returns false when the file has no hunks at all', () => {
    expect(allHunksStaged(buildFile([]), new Set())).toBe(false);
  });

  it('returns false when at least one hunk is unstaged', () => {
    const file = buildFile([hunkAt(2, 2), hunkAt(5, 5)]);
    const stagedIds = new Set([file.hunks[0]!.id]);
    expect(allHunksStaged(file, stagedIds)).toBe(false);
  });

  it('returns true when every hunk id is in the staged set', () => {
    const file = buildFile([hunkAt(2, 2), hunkAt(5, 5), hunkAt(9, 9)]);
    const stagedIds = new Set(file.hunks.map((h) => h.id));
    expect(allHunksStaged(file, stagedIds)).toBe(true);
  });

  it('ignores staged ids that do not correspond to displayed hunks', () => {
    const file = buildFile([hunkAt(2, 2)]);
    const stagedIds = new Set([file.hunks[0]!.id, 'phantom-hunk-id']);
    expect(allHunksStaged(file, stagedIds)).toBe(true);
  });

  it('partial selection — only some hunks staged — reads as unchecked', () => {
    const file = buildFile([hunkAt(2, 2), hunkAt(5, 5), hunkAt(9, 9)]);
    const stagedIds = new Set([file.hunks[0]!.id, file.hunks[2]!.id]);
    expect(allHunksStaged(file, stagedIds)).toBe(false);
  });
});

describe('stagedHunkCount (powers the "X included" status line)', () => {
  it('returns zero on an empty file', () => {
    expect(stagedHunkCount(buildFile([]), new Set())).toBe(0);
  });

  it('counts only ids that match a displayed hunk', () => {
    const file = buildFile([hunkAt(2, 2), hunkAt(5, 5), hunkAt(9, 9)]);
    const stagedIds = new Set([file.hunks[0]!.id, file.hunks[2]!.id, 'phantom-id']);
    expect(stagedHunkCount(file, stagedIds)).toBe(2);
  });

  it('matches the total when every hunk is staged', () => {
    const file = buildFile([hunkAt(2, 2), hunkAt(5, 5)]);
    const stagedIds = new Set(file.hunks.map((h) => h.id));
    expect(stagedHunkCount(file, stagedIds)).toBe(2);
  });

  it('returns zero when none are staged', () => {
    const file = buildFile([hunkAt(2, 2), hunkAt(5, 5)]);
    expect(stagedHunkCount(file, new Set())).toBe(0);
  });
});

describe('next/previousHunkSectionIndex (powers the toolbar prev/next-diff arrows)', () => {
  const sections: DiffSection[] = [
    section('ctx'),    // 0
    section('hunk'),   // 1
    section('ctx'),    // 2
    section('hunk'),   // 3
    section('hunk'),   // 4
    section('ctx'),    // 5
    section('hunk'),   // 6
  ];

  it('next from -1 lands on the first hunk', () => {
    expect(nextHunkSectionIndex(sections, -1)).toBe(1);
  });

  it('next from the current hunk skips to the following hunk', () => {
    expect(nextHunkSectionIndex(sections, 1)).toBe(3);
    expect(nextHunkSectionIndex(sections, 3)).toBe(4);
    expect(nextHunkSectionIndex(sections, 4)).toBe(6);
  });

  it('next returns -1 once past the last hunk', () => {
    expect(nextHunkSectionIndex(sections, 6)).toBe(-1);
  });

  it('previous from past-the-end lands on the last hunk', () => {
    expect(previousHunkSectionIndex(sections, sections.length)).toBe(6);
  });

  it('previous from the current hunk skips to the prior hunk', () => {
    expect(previousHunkSectionIndex(sections, 6)).toBe(4);
    expect(previousHunkSectionIndex(sections, 4)).toBe(3);
    expect(previousHunkSectionIndex(sections, 3)).toBe(1);
  });

  it('previous returns -1 once before the first hunk', () => {
    expect(previousHunkSectionIndex(sections, 1)).toBe(-1);
  });

  it('returns -1 on an all-ctx section list', () => {
    const onlyContext: DiffSection[] = [section('ctx'), section('ctx')];
    expect(nextHunkSectionIndex(onlyContext, -1)).toBe(-1);
    expect(previousHunkSectionIndex(onlyContext, onlyContext.length)).toBe(-1);
  });
});

function section(kind: 'ctx' | 'hunk'): DiffSection {
  return {
    kind,
    hunkId: kind === 'hunk' ? 'h' : null,
    hunkClass: kind === 'hunk' ? 'mod' : null,
    staged: false,
    headLineCount: 1,
    workingLineCount: 1,
    visualRowCount: 1,
    collapsedPreview: '',
    collapsedWorkingStart: 0,
    collapsedWorkingEnd: 0,
  };
}

describe('workingLineOfSection (powers the cursor placement on navigation)', () => {
  it('returns 1 for the first section', () => {
    const sections = [section('ctx'), section('hunk')];
    expect(workingLineOfSection(sections, 0)).toBe(1);
  });

  it('accumulates the workingLineCount of preceding sections', () => {
    const sections: DiffSection[] = [
      { ...section('ctx'), workingLineCount: 5 },
      { ...section('hunk'), workingLineCount: 3 },
      { ...section('ctx'), workingLineCount: 4 },
      section('hunk'),
    ];
    // Up to (not including) index 3 → 5 + 3 + 4 = 12 ; +1 starting line = 13
    expect(workingLineOfSection(sections, 3)).toBe(13);
  });

  it('returns 1 for negative indexes (defensive)', () => {
    expect(workingLineOfSection([section('ctx'), section('hunk')], -1)).toBe(1);
  });

  it('clamps to the end of the list when the index overshoots', () => {
    const sections: DiffSection[] = [
      { ...section('ctx'), workingLineCount: 2 },
      { ...section('hunk'), workingLineCount: 4 },
    ];
    expect(workingLineOfSection(sections, 99)).toBe(2 + 4 + 1);
  });
});

describe('hunkOrdinalAtSection / totalHunks (toolbar debug counter)', () => {
  const sections: DiffSection[] = [
    section('ctx'),    // 0
    section('hunk'),   // 1  → ordinal 1
    section('ctx'),    // 2
    section('hunk'),   // 3  → ordinal 2
    section('hunk'),   // 4  → ordinal 3
    section('ctx'),    // 5
    section('hunk'),   // 6  → ordinal 4
  ];

  it('counts every hunk section in the list', () => {
    expect(totalHunks(sections)).toBe(4);
  });

  it('returns the 1-based ordinal at each hunk index', () => {
    expect(hunkOrdinalAtSection(sections, 1)).toBe(1);
    expect(hunkOrdinalAtSection(sections, 3)).toBe(2);
    expect(hunkOrdinalAtSection(sections, 4)).toBe(3);
    expect(hunkOrdinalAtSection(sections, 6)).toBe(4);
  });

  it('returns 0 when the index points to a context section', () => {
    expect(hunkOrdinalAtSection(sections, 0)).toBe(0);
    expect(hunkOrdinalAtSection(sections, 2)).toBe(0);
    expect(hunkOrdinalAtSection(sections, 5)).toBe(0);
  });

  it('returns 0 for out-of-range indexes (defensive)', () => {
    expect(hunkOrdinalAtSection(sections, -1)).toBe(0);
    expect(hunkOrdinalAtSection(sections, 99)).toBe(0);
  });
});

describe('sectionIndexAtWorkingLine (cursor-aware navigation)', () => {
  // Layout (working line ranges):
  //   section 0 (ctx)  workingCount=5  → lines 1..5
  //   section 1 (hunk) workingCount=3  → lines 6..8
  //   section 2 (ctx)  workingCount=2  → lines 9..10
  //   section 3 (hunk) workingCount=0  → no working line at all (pure del)
  //   section 4 (ctx)  workingCount=4  → lines 11..14
  //   section 5 (hunk) workingCount=1  → line 15
  const sections: DiffSection[] = [
    { ...section('ctx'), workingLineCount: 5 },
    { ...section('hunk'), workingLineCount: 3 },
    { ...section('ctx'), workingLineCount: 2 },
    { ...section('hunk'), workingLineCount: 0 },
    { ...section('ctx'), workingLineCount: 4 },
    { ...section('hunk'), workingLineCount: 1 },
  ];

  it('maps the first line to section 0', () => {
    expect(sectionIndexAtWorkingLine(sections, 1)).toBe(0);
  });

  it('maps lines inside a hunk section to that hunk', () => {
    expect(sectionIndexAtWorkingLine(sections, 6)).toBe(1);
    expect(sectionIndexAtWorkingLine(sections, 8)).toBe(1);
    expect(sectionIndexAtWorkingLine(sections, 15)).toBe(5);
  });

  it('maps the boundary line to the next section, not the previous', () => {
    // Line 9 is the first line of section 2 (ctx after the first hunk).
    expect(sectionIndexAtWorkingLine(sections, 9)).toBe(2);
    // Line 11 is the first line of section 4 (ctx after the zero-line hunk).
    expect(sectionIndexAtWorkingLine(sections, 11)).toBe(4);
  });

  it('skips zero-working-line sections', () => {
    // Line 10 still belongs to section 2 (which has 2 working lines).
    expect(sectionIndexAtWorkingLine(sections, 10)).toBe(2);
  });

  it('returns -1 for out-of-range line numbers', () => {
    expect(sectionIndexAtWorkingLine(sections, 0)).toBe(-1);
    expect(sectionIndexAtWorkingLine(sections, -3)).toBe(-1);
    expect(sectionIndexAtWorkingLine(sections, 9999)).toBe(-1);
  });
});

function buildFile(hunks: DiffHunkDTO[]): DiffFileDTO {
  return {
    uri: 'file:///fixture.txt',
    languageId: 'plaintext',
    repoRoot: '/fixture',
    repoRelativePath: 'fixture.txt',
    headShortHash: 'deadbee',
    headLines: [],
    workingLines: [],
    hunks,
    initiallyStagedHunkIds: [],
  };
}

function hunkAt(leftStart: number, rightStart: number): DiffHunkDTO {
  return {
    id: makeHunkId(leftStart, rightStart),
    leftStartLine: leftStart,
    rightStartLine: rightStart,
    leftLines: ['old line'],
    rightLines: ['new line'],
  };
}
