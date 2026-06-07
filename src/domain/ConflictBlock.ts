export type ConflictSide = 'left' | 'right' | 'both';

export interface ConflictBlock {
  readonly id: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly localLines: readonly string[];
  readonly baseLines: readonly string[] | null;
  readonly remoteLines: readonly string[];
  readonly localLabel: string;
  readonly remoteLabel: string;
}

export function createConflictBlock(params: Omit<ConflictBlock, 'id'> & { id?: string }): ConflictBlock {
  return {
    id: params.id ?? `block-${params.startLine}-${params.endLine}`,
    startLine: params.startLine,
    endLine: params.endLine,
    localLines: params.localLines,
    baseLines: params.baseLines,
    remoteLines: params.remoteLines,
    localLabel: params.localLabel,
    remoteLabel: params.remoteLabel,
  };
}
