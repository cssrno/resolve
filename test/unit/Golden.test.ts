import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitConflictParser } from '../../src/domain/parser/GitConflictParser';
import { toFileDTO } from '../../src/application/ConflictMapper';
import { MergeSession } from '../../src/domain/MergeSession';
import {
  buildSections,
  paneTextsFromSections,
  type Section,
} from '../../src/webview/ui/Sections';
import type {
  ConflictBlockDTO,
  ConflictFileDTO,
  ResolutionDTO,
} from '../../src/shared/protocol';

const FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/conflicts/golden.ts');

/**
 * Golden snapshot covering every classification and every resolution kind on
 * a single fixture. If you change Sections behavior, run vitest with
 * `--update` and review the diff carefully — the snapshot is the source of
 * truth for the merge-view domain semantics.
 */
describe('Golden: Sections pipeline over fixtures/conflicts/golden.ts', () => {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  const parser = new GitConflictParser();
  const file = parser.parse('file:///golden.ts', raw);
  const session = MergeSession.from(file);
  const baseDto = toFileDTO(file, session, 'typescript');

  it('parses the expected number of conflict blocks', () => {
    expect(baseDto.blocks.length).toMatchInlineSnapshot('19');
  });

  it('classifies every block to a stable BlockClass', () => {
    const dtoUnresolved = withResolution(baseDto, () => null);
    const summary = buildSections(dtoUnresolved)
      .filter((s) => s.kind === 'conflict')
      .map((s, i) => ({
        idx: i + 1,
        blockId: s.blockId,
        blockClass: s.blockClass,
        localLines: s.paneLineCount.local,
        resultLines: s.paneLineCount.result,
        remoteLines: s.paneLineCount.remote,
        paneClass: s.paneClass,
      }));
    expect(summary).toMatchSnapshot('classification');
  });

  for (const scenario of SCENARIOS) {
    it(`pane texts + states under ${scenario.name}`, () => {
      const dto = withResolution(baseDto, scenario.resolve);
      const sections = buildSections(dto);
      const panes = paneTextsFromSections(dto, sections);
      const blocks = sections
        .filter((s) => s.kind === 'conflict')
        .map((s) => ({
          blockId: s.blockId,
          blockClass: s.blockClass,
          resolved: s.resolved,
          resolvedSides: s.resolvedSides,
          paneClass: s.paneClass,
          paneLineCount: s.paneLineCount,
        }));
      expect({ blocks, panes: linesPerPane(panes) }).toMatchSnapshot(scenario.name);
    });
  }

  it('round-trip: every block can be resolved every supported way without throwing', () => {
    const scenarios: ResolutionDTO[] = [
      { kind: 'sides', left: 'accepted', right: 'rejected' },
      { kind: 'sides', left: 'rejected', right: 'accepted' },
      { kind: 'sides', left: 'accepted', right: 'accepted' },
    ];
    for (const resolution of scenarios) {
      const dto = withResolution(baseDto, () => resolution);
      const sections = buildSections(dto);
      // Spot-check: each conflict section is now marked resolved
      const conflicts = sections.filter((s) => s.kind === 'conflict');
      for (const s of conflicts) expect(s.resolved).toBe(true);
    }
  });
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
    // Cycle through resolution kinds: 0→unresolved, 1→left, 2→right, 3→both, 4→manual
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

function withResolution(
  dto: ConflictFileDTO,
  resolve: (block: ConflictBlockDTO, index: number) => ResolutionDTO | null,
): ConflictFileDTO {
  return {
    ...dto,
    blocks: dto.blocks.map((b, i) => ({ ...b, resolution: resolve(b, i) })),
  };
}

function linesPerPane(panes: { local: string; result: string; remote: string }): {
  local: number;
  result: number;
  remote: number;
} {
  return {
    local: panes.local.split('\n').length,
    result: panes.result.split('\n').length,
    remote: panes.remote.split('\n').length,
  };
}

// Type-only sanity check
const _typeCheck: Section[] = [];
void _typeCheck;
