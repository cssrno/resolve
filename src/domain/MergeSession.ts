import type { ConflictBlock } from './ConflictBlock';
import type { ConflictFile } from './ConflictFile';
import type { Resolution } from './Resolution';
import { isFullySidedResolution } from './Resolution';

interface HistoryEntry {
  readonly blockId: string;
  readonly previous: Resolution | undefined;
}

export interface UndoResult {
  readonly blockId: string;
  readonly resolution: Resolution | undefined;
}

export class MergeSession {
  private readonly resolutions = new Map<string, Resolution>();
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];

  constructor(private readonly file: ConflictFile) {}

  static from(file: ConflictFile): MergeSession {
    return new MergeSession(file);
  }

  resolve(blockId: string, resolution: Resolution): void {
    if (!this.file.blocks.some((b) => b.id === blockId)) {
      throw new Error(`Unknown block id: ${blockId}`);
    }
    this.pushUndo(blockId);
    this.resolutions.set(blockId, resolution);
  }

  unresolve(blockId: string): void {
    this.pushUndo(blockId);
    this.resolutions.delete(blockId);
  }

  undo(): UndoResult | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const current = this.resolutions.get(entry.blockId);
    this.redoStack.push({ blockId: entry.blockId, previous: current });
    if (entry.previous === undefined) this.resolutions.delete(entry.blockId);
    else this.resolutions.set(entry.blockId, entry.previous);
    return { blockId: entry.blockId, resolution: entry.previous };
  }

  redo(): UndoResult | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const current = this.resolutions.get(entry.blockId);
    this.undoStack.push({ blockId: entry.blockId, previous: current });
    if (entry.previous === undefined) this.resolutions.delete(entry.blockId);
    else this.resolutions.set(entry.blockId, entry.previous);
    return { blockId: entry.blockId, resolution: entry.previous };
  }

  private pushUndo(blockId: string): void {
    this.undoStack.push({ blockId, previous: this.resolutions.get(blockId) });
    this.redoStack.length = 0;
  }

  getResolution(blockId: string): Resolution | undefined {
    return this.resolutions.get(blockId);
  }

  isFullyResolved(): boolean {
    return this.file.blocks.every((b) => {
      const resolution = this.resolutions.get(b.id);
      return resolution !== undefined && isFullySidedResolution(resolution);
    });
  }

  unresolvedBlocks(): readonly ConflictBlock[] {
    return this.file.blocks.filter((b) => {
      const resolution = this.resolutions.get(b.id);
      return resolution === undefined || !isFullySidedResolution(resolution);
    });
  }

  render(): string {
    const out: string[] = [];
    const lines = this.file.originalLines;
    let cursor = 0;

    for (const block of this.file.blocks) {
      for (let i = cursor; i < block.startLine; i++) out.push(lines[i]!);
      const resolution = this.resolutions.get(block.id);
      out.push(...this.resolvedLines(block, resolution));
      cursor = block.endLine + 1;
    }
    for (let i = cursor; i < lines.length; i++) out.push(lines[i]!);

    return out.join(this.file.eol);
  }

  private resolvedLines(block: ConflictBlock, resolution: Resolution | undefined): readonly string[] {
    if (!resolution) return this.rawBlockLines(block);
    if (resolution.kind === 'manual') return resolution.lines;
    const out: string[] = [];
    if (resolution.left === 'accepted') out.push(...block.localLines);
    if (resolution.right === 'accepted') out.push(...block.remoteLines);
    return out;
  }

  private rawBlockLines(block: ConflictBlock): readonly string[] {
    return this.file.originalLines.slice(block.startLine, block.endLine + 1);
  }
}
