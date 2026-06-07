import { describe, it, expect } from 'vitest';
import {
  buildDiffSections,
  collapsedKey,
  diffPaneTexts,
  type BuildDiffSectionsOptions,
  type DiffSection,
} from '../../src/webview/ui/DiffSections';
import { makeHunkId } from '../../src/domain/Diff';
import type { DiffFileDTO, DiffHunkDTO } from '../../src/shared/protocol';

const HEAD_LINES = [
  'line 1',
  'line 2',
  'line 3',
  'line 4',
  'line 5',
  'line 6',
  'line 7',
  'line 8',
  'line 9',
  'line 10',
];

interface Scenario {
  readonly name: string;
  readonly file: DiffFileDTO;
  readonly stagedHunkIds: ReadonlySet<string>;
  readonly buildOptions?: BuildDiffSectionsOptions;
}

// 25-line file with one tiny hunk in the middle and big unchanged
// ranges on both sides — exactly the shape the collapse feature is
// meant to compress.
const LONG_HEAD = Array.from({ length: 25 }, (_, index) => `original line ${index + 1}`);
const LONG_WORKING = LONG_HEAD.map((line, index) =>
  index === 12 ? 'CHANGED line 13' : line,
);

const SCENARIOS: Scenario[] = [
  {
    name: 'no-changes',
    file: buildFile(HEAD_LINES, HEAD_LINES, []),
    stagedHunkIds: new Set(),
  },
  {
    name: 'single-mod-hunk',
    file: buildFile(
      HEAD_LINES,
      ['line 1', 'line 2', 'LINE 3 MODIFIED', 'line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10'],
      [hunk(3, 3, ['line 3'], ['LINE 3 MODIFIED'])],
    ),
    stagedHunkIds: new Set(),
  },
  {
    name: 'single-add-hunk',
    file: buildFile(
      HEAD_LINES,
      ['line 1', 'line 2', 'line 3', 'NEW LINE A', 'NEW LINE B', 'line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10'],
      [hunk(4, 4, [], ['NEW LINE A', 'NEW LINE B'])],
    ),
    stagedHunkIds: new Set(),
  },
  {
    name: 'single-del-hunk',
    file: buildFile(
      HEAD_LINES,
      ['line 1', 'line 2', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10'],
      [hunk(3, 3, ['line 3', 'line 4', 'line 5'], [])],
    ),
    stagedHunkIds: new Set(),
  },
  {
    name: 'mixed-hunks',
    file: buildFile(
      HEAD_LINES,
      ['line 1', 'LINE 2 MOD', 'line 3', 'INSERTED', 'line 4', 'line 5', 'line 8', 'line 9', 'line 10'],
      [
        hunk(2, 2, ['line 2'], ['LINE 2 MOD']),
        hunk(4, 4, [], ['INSERTED']),
        hunk(6, 7, ['line 6', 'line 7'], []),
      ],
    ),
    stagedHunkIds: new Set(),
  },
  {
    name: 'mixed-hunks-some-staged',
    file: buildFile(
      HEAD_LINES,
      ['line 1', 'LINE 2 MOD', 'line 3', 'INSERTED', 'line 4', 'line 5', 'line 8', 'line 9', 'line 10'],
      [
        hunk(2, 2, ['line 2'], ['LINE 2 MOD']),
        hunk(4, 4, [], ['INSERTED']),
        hunk(6, 7, ['line 6', 'line 7'], []),
      ],
    ),
    stagedHunkIds: new Set([makeHunkId(2, 2), makeHunkId(6, 7)]),
  },
  {
    name: 'long-context-collapse-disabled',
    file: buildFile(
      LONG_HEAD,
      LONG_WORKING,
      [hunk(13, 13, ['original line 13'], ['CHANGED line 13'])],
    ),
    stagedHunkIds: new Set(),
  },
  {
    name: 'long-context-collapse-enabled',
    file: buildFile(
      LONG_HEAD,
      LONG_WORKING,
      [hunk(13, 13, ['original line 13'], ['CHANGED line 13'])],
    ),
    stagedHunkIds: new Set(),
    buildOptions: {
      collapseUnchanged: true,
      collapseThreshold: 6,
      expandedContextKeys: new Set(),
    },
  },
  {
    name: 'long-context-collapse-enabled-with-one-expanded',
    file: buildFile(
      LONG_HEAD,
      LONG_WORKING,
      [hunk(13, 13, ['original line 13'], ['CHANGED line 13'])],
    ),
    stagedHunkIds: new Set(),
    // Manually mark the trailing context (working lines 14-25) as
    // expanded so the test pins the click-to-expand behaviour: the
    // leading context (lines 1-12) collapses, the trailing one stays
    // full-height.
    buildOptions: {
      collapseUnchanged: true,
      collapseThreshold: 6,
      expandedContextKeys: new Set(['14-25']),
    },
  },
];

describe('Golden: Diff Sections pipeline', () => {
  for (const scenario of SCENARIOS) {
    it(`sections + pane texts under ${scenario.name}`, () => {
      const sections = scenario.buildOptions
        ? buildDiffSections(scenario.file, scenario.stagedHunkIds, scenario.buildOptions)
        : buildDiffSections(scenario.file, scenario.stagedHunkIds);
      const panes = diffPaneTexts(scenario.file, sections);
      expect({
        sections: serializeSections(sections),
        panes: {
          head: countLines(panes.head),
          working: countLines(panes.working),
        },
      }).toMatchSnapshot(scenario.name);
    });
  }
});

function serializeSections(sections: readonly DiffSection[]): unknown[] {
  return sections.map((section) => {
    const base = {
      kind: section.kind,
      hunkId: section.hunkId,
      hunkClass: section.hunkClass,
      staged: section.staged,
      headLineCount: section.headLineCount,
      workingLineCount: section.workingLineCount,
      visualRowCount: section.visualRowCount,
    };
    if (section.kind === 'ctx-collapsed') {
      return {
        ...base,
        collapsedKey: collapsedKey(section),
        collapsedPreview: section.collapsedPreview,
      };
    }
    return base;
  });
}

function countLines(text: string): number {
  return text === '' ? 0 : text.split('\n').length;
}

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
