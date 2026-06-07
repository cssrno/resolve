import { describe, it, expect } from 'vitest';
import { UnifiedDiffParser } from '../../src/domain/parser/UnifiedDiffParser';

const parser = new UnifiedDiffParser();

describe('UnifiedDiffParser', () => {
  it('returns empty array on empty input', () => {
    expect(parser.parse('')).toEqual([]);
  });

  it('parses a single modification hunk', () => {
    const raw = [
      'diff --git a/x.ts b/x.ts',
      'index abc..def 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -3,1 +3,1 @@',
      '-old line',
      '+new line',
    ].join('\n');
    expect(parser.parse(raw)).toEqual([
      {
        leftStartLine: 3,
        rightStartLine: 3,
        leftLines: ['old line'],
        rightLines: ['new line'],
      },
    ]);
  });

  it('parses pure insertion at -U0 (left count = 0)', () => {
    const raw = ['@@ -5,0 +6,2 @@', '+added one', '+added two'].join('\n');
    expect(parser.parse(raw)).toEqual([
      {
        leftStartLine: 5,
        rightStartLine: 6,
        leftLines: [],
        rightLines: ['added one', 'added two'],
      },
    ]);
  });

  it('parses pure deletion at -U0 (right count = 0)', () => {
    const raw = ['@@ -10,2 +9,0 @@', '-gone one', '-gone two'].join('\n');
    expect(parser.parse(raw)).toEqual([
      {
        leftStartLine: 10,
        rightStartLine: 9,
        leftLines: ['gone one', 'gone two'],
        rightLines: [],
      },
    ]);
  });

  it('parses several hunks in one diff', () => {
    const raw = [
      '@@ -1,1 +1,1 @@',
      '-a',
      '+A',
      '@@ -5,0 +6,1 @@',
      '+added',
      '@@ -20,1 +21,0 @@',
      '-removed',
    ].join('\n');
    const hunks = parser.parse(raw);
    expect(hunks.length).toBe(3);
    expect(hunks[0]!.leftLines).toEqual(['a']);
    expect(hunks[0]!.rightLines).toEqual(['A']);
    expect(hunks[1]!.leftLines).toEqual([]);
    expect(hunks[1]!.rightLines).toEqual(['added']);
    expect(hunks[2]!.leftLines).toEqual(['removed']);
    expect(hunks[2]!.rightLines).toEqual([]);
  });

  it('omits count when 1 (default in unified diff)', () => {
    const raw = ['@@ -3 +3 @@', '-x', '+y'].join('\n');
    const hunks = parser.parse(raw);
    expect(hunks[0]).toEqual({
      leftStartLine: 3,
      rightStartLine: 3,
      leftLines: ['x'],
      rightLines: ['y'],
    });
  });

  it('skips file header noise before the first hunk', () => {
    const raw = [
      'diff --git a/a b/a',
      'similarity index 50%',
      '--- a/a',
      '+++ b/a',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    expect(parser.parse(raw).length).toBe(1);
  });
});
