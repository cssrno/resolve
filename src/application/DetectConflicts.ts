import type { FileSystemPort } from '../domain/ports/FileSystemPort';
import { GitConflictParser } from '../domain/parser/GitConflictParser';
import type { ConflictFile } from '../domain/ConflictFile';

export class DetectConflicts {
  constructor(private readonly fs: FileSystemPort, private readonly parser: GitConflictParser) {}

  async run(uri: string): Promise<ConflictFile> {
    const content = await this.fs.read(uri);
    return this.parser.parse(uri, content);
  }
}
