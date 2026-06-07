import type { ConflictFile } from '../domain/ConflictFile';
import type { Resolution } from '../domain/Resolution';
import type { MergeSession } from '../domain/MergeSession';
import type { ConflictBlockDTO, ConflictFileDTO, ResolutionDTO } from '../shared/protocol';

export function toFileDTO(file: ConflictFile, session: MergeSession, languageId = ''): ConflictFileDTO {
  return {
    uri: file.uri,
    originalLines: [...file.originalLines],
    languageId,
    blocks: file.blocks.map<ConflictBlockDTO>((b) => ({
      id: b.id,
      startLine: b.startLine,
      endLine: b.endLine,
      localLines: [...b.localLines],
      baseLines: b.baseLines ? [...b.baseLines] : null,
      remoteLines: [...b.remoteLines],
      localLabel: b.localLabel,
      remoteLabel: b.remoteLabel,
      resolution: toResolutionDTO(session.getResolution(b.id)),
    })),
  };
}

export function toResolutionDTO(resolution: Resolution | undefined): ResolutionDTO | null {
  if (!resolution) return null;
  if (resolution.kind === 'manual') return { kind: 'manual', lines: [...resolution.lines] };
  return { kind: 'sides', left: resolution.left, right: resolution.right };
}

export function fromResolutionDTO(dto: ResolutionDTO): Resolution {
  if (dto.kind === 'manual') return { kind: 'manual', lines: dto.lines };
  return { kind: 'sides', left: dto.left, right: dto.right };
}
