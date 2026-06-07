import { describe, it, expect } from 'vitest';
import { GitConflictParser } from '../../src/domain/parser/GitConflictParser';
import { MergeSession } from '../../src/domain/MergeSession';
import { acceptLeft, acceptRight, acceptBoth, manual } from '../../src/domain/Resolution';

const parser = new GitConflictParser();

function load(content: string): MergeSession {
  return MergeSession.from(parser.parse('mem://t', content));
}

const SIMPLE = [
  'a',
  '<<<<<<< HEAD',
  'L1',
  'L2',
  '=======',
  'R1',
  '>>>>>>> br',
  'z',
].join('\n');

describe('MergeSession', () => {
  it('renders unresolved blocks verbatim', () => {
    const s = load(SIMPLE);
    expect(s.render()).toBe(SIMPLE);
  });

  it('accept left writes only local lines', () => {
    const s = load(SIMPLE);
    const id = parser.parse('mem://t', SIMPLE).blocks[0]!.id;
    s.resolve(id, acceptLeft());
    expect(s.render()).toBe(['a', 'L1', 'L2', 'z'].join('\n'));
    expect(s.isFullyResolved()).toBe(true);
  });

  it('accept right writes only remote lines', () => {
    const s = load(SIMPLE);
    const id = parser.parse('mem://t', SIMPLE).blocks[0]!.id;
    s.resolve(id, acceptRight());
    expect(s.render()).toBe(['a', 'R1', 'z'].join('\n'));
  });

  it('accept both concatenates local then remote', () => {
    const s = load(SIMPLE);
    const id = parser.parse('mem://t', SIMPLE).blocks[0]!.id;
    s.resolve(id, acceptBoth());
    expect(s.render()).toBe(['a', 'L1', 'L2', 'R1', 'z'].join('\n'));
  });

  it('manual resolution replaces with custom lines', () => {
    const s = load(SIMPLE);
    const id = parser.parse('mem://t', SIMPLE).blocks[0]!.id;
    s.resolve(id, manual(['X', 'Y']));
    expect(s.render()).toBe(['a', 'X', 'Y', 'z'].join('\n'));
  });

  it('throws on unknown block id', () => {
    const s = load(SIMPLE);
    expect(() => s.resolve('bogus', acceptLeft())).toThrow();
  });

  it('unresolve removes a previous resolution', () => {
    const s = load(SIMPLE);
    const id = parser.parse('mem://t', SIMPLE).blocks[0]!.id;
    s.resolve(id, acceptLeft());
    s.unresolve(id);
    expect(s.isFullyResolved()).toBe(false);
  });
});
