import type { FileSystemPort } from '../domain/ports/FileSystemPort';
import type { MergeSession } from '../domain/MergeSession';

export class SaveResolvedFile {
  constructor(private readonly fs: FileSystemPort) {}

  async run(uri: string, session: MergeSession): Promise<void> {
    if (!session.isFullyResolved()) {
      throw new Error(`Cannot save: ${session.unresolvedBlocks().length} unresolved block(s)`);
    }
    await this.fs.write(uri, session.render());
  }
}
