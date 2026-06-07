import { describe, it, expect } from 'vitest';
import { GitConflictParser } from '../../src/domain/parser/GitConflictParser';
import { MergeSession } from '../../src/domain/MergeSession';
import { ApplyResolution } from '../../src/application/ApplyResolution';
import { acceptLeft } from '../../src/domain/Resolution';

describe('ApplyResolution', () => {
  it('writes resolution into session', () => {
    const parser = new GitConflictParser();
    const file = parser.parse(
      'mem://t',
      ['<<<<<<< h', 'A', '=======', 'B', '>>>>>>> b'].join('\n'),
    );
    const session = MergeSession.from(file);
    new ApplyResolution().apply(session, file.blocks[0]!.id, acceptLeft());
    expect(session.isFullyResolved()).toBe(true);
    expect(session.render()).toBe('A');
  });

  it('reset removes resolution', () => {
    const parser = new GitConflictParser();
    const file = parser.parse(
      'mem://t',
      ['<<<<<<< h', 'A', '=======', 'B', '>>>>>>> b'].join('\n'),
    );
    const session = MergeSession.from(file);
    const apply = new ApplyResolution();
    apply.apply(session, file.blocks[0]!.id, acceptLeft());
    apply.reset(session, file.blocks[0]!.id);
    expect(session.isFullyResolved()).toBe(false);
  });
});
