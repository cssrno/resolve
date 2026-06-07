import { describe, it, expect } from 'vitest';
import { GitConflictParser } from '../../src/domain/parser/GitConflictParser';
import { MergeSession } from '../../src/domain/MergeSession';
import { SaveResolvedFile } from '../../src/application/SaveResolvedFile';
import { acceptLeft } from '../../src/domain/Resolution';
import type { FileSystemPort } from '../../src/domain/ports/FileSystemPort';

class InMemoryFs implements FileSystemPort {
  private store = new Map<string, string>();
  set(uri: string, content: string) { this.store.set(uri, content); }
  async read(uri: string) { return this.store.get(uri) ?? ''; }
  async write(uri: string, content: string) { this.store.set(uri, content); }
  get(uri: string) { return this.store.get(uri); }
}

describe('SaveResolvedFile', () => {
  it('rejects when blocks remain unresolved', async () => {
    const fs = new InMemoryFs();
    const parser = new GitConflictParser();
    const file = parser.parse('mem://x', '<<<<<<< h\nA\n=======\nB\n>>>>>>> b');
    const session = MergeSession.from(file);
    await expect(new SaveResolvedFile(fs).run('mem://x', session)).rejects.toThrow(/unresolved/);
  });

  it('writes rendered text when fully resolved', async () => {
    const fs = new InMemoryFs();
    const parser = new GitConflictParser();
    const content = '<<<<<<< h\nA\n=======\nB\n>>>>>>> b';
    const file = parser.parse('mem://x', content);
    const session = MergeSession.from(file);
    session.resolve(file.blocks[0]!.id, acceptLeft());
    await new SaveResolvedFile(fs).run('mem://x', session);
    expect(fs.get('mem://x')).toBe('A');
  });
});
