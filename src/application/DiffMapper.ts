import type { DiffFile } from '../domain/Diff';
import type { DiffFileDTO } from '../shared/protocol';

export function toDiffFileDTO(
  file: DiffFile,
  initiallyStagedHunkIds: Iterable<string>,
  languageId: string,
): DiffFileDTO {
  return {
    uri: file.uri,
    languageId,
    repoRoot: file.repoRoot,
    repoRelativePath: file.repoRelativePath,
    headShortHash: file.headShortHash,
    headLines: [...file.headLines],
    workingLines: [...file.workingLines],
    hunks: file.hunks.map((h) => ({
      id: h.id,
      leftStartLine: h.leftStartLine,
      rightStartLine: h.rightStartLine,
      leftLines: [...h.leftLines],
      rightLines: [...h.rightLines],
    })),
    initiallyStagedHunkIds: [...initiallyStagedHunkIds],
  };
}
