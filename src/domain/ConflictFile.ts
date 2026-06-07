import type { ConflictBlock } from './ConflictBlock';

export interface ConflictFile {
  readonly uri: string;
  readonly originalLines: readonly string[];
  readonly blocks: readonly ConflictBlock[];
  readonly eol: '\n' | '\r\n';
}

export function createConflictFile(params: ConflictFile): ConflictFile {
  return params;
}

export function hasConflicts(file: ConflictFile): boolean {
  return file.blocks.length > 0;
}
