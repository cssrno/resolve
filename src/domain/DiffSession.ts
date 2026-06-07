import type { DiffFile, DiffHunk } from './Diff';

/**
 * Tracks per-hunk staged flags plus an undo/redo history. Two kinds of
 * actions live on the stack:
 *
 *   - `toggle` (stage / unstage): undo flips the staged flag back.
 *   - `revert`: undo re-applies the hunk's patch onto the working tree
 *     so the change reappears in the file. The hunk's full data is
 *     captured at the moment of revert so the replay doesn't depend on
 *     whatever the diff currently looks like.
 */
export type HistoryEntry =
  | { kind: 'toggle'; hunkId: string; previousStaged: boolean }
  | { kind: 'revert'; hunk: DiffHunk; previousStaged: boolean };

export class DiffSession {
  private readonly stagedHunkIds = new Set<string>();
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private currentFile: DiffFile;

  constructor(file: DiffFile) {
    this.currentFile = file;
  }

  /** Current view of the file — refreshed every time the host pulls a new diff. */
  get file(): DiffFile {
    return this.currentFile;
  }

  /**
   * Replaces the session's file reference with a freshly-detected one.
   * Called after every git op that mutates HEAD-vs-working state (revert,
   * stage all, …) so subsequent hunk lookups by id reference the latest
   * snapshot.
   */
  updateFile(file: DiffFile): void {
    this.currentFile = file;
  }

  static from(file: DiffFile, initialStagedIds: Iterable<string> = []): DiffSession {
    const session = new DiffSession(file);
    for (const hunkId of initialStagedIds) session.stagedHunkIds.add(hunkId);
    return session;
  }

  hunkById(hunkId: string): DiffHunk | undefined {
    return this.currentFile.hunks.find((h) => h.id === hunkId);
  }

  isStaged(hunkId: string): boolean {
    return this.stagedHunkIds.has(hunkId);
  }

  setStaged(hunkId: string, staged: boolean): void {
    this.undoStack.push({ kind: 'toggle', hunkId, previousStaged: this.stagedHunkIds.has(hunkId) });
    this.redoStack.length = 0;
    this.applyStagedFlag(hunkId, staged);
  }

  recordRevert(hunk: DiffHunk): void {
    this.undoStack.push({
      kind: 'revert',
      hunk: cloneHunk(hunk),
      previousStaged: this.stagedHunkIds.has(hunk.id),
    });
    this.redoStack.length = 0;
    this.stagedHunkIds.delete(hunk.id);
  }

  undo(): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(this.snapshotForOpposite(entry));
    this.applyEntry(entry);
    return entry;
  }

  redo(): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(this.snapshotForOpposite(entry));
    this.applyEntry(entry);
    return entry;
  }

  private snapshotForOpposite(entry: HistoryEntry): HistoryEntry {
    if (entry.kind === 'toggle') {
      return { kind: 'toggle', hunkId: entry.hunkId, previousStaged: this.stagedHunkIds.has(entry.hunkId) };
    }
    return { kind: 'revert', hunk: entry.hunk, previousStaged: this.stagedHunkIds.has(entry.hunk.id) };
  }

  private applyEntry(entry: HistoryEntry): void {
    if (entry.kind === 'toggle') {
      this.applyStagedFlag(entry.hunkId, entry.previousStaged);
      return;
    }
    this.applyStagedFlag(entry.hunk.id, entry.previousStaged);
  }

  private applyStagedFlag(hunkId: string, staged: boolean): void {
    if (staged) this.stagedHunkIds.add(hunkId);
    else this.stagedHunkIds.delete(hunkId);
  }
}

function cloneHunk(hunk: DiffHunk): DiffHunk {
  return {
    id: hunk.id,
    leftStartLine: hunk.leftStartLine,
    rightStartLine: hunk.rightStartLine,
    leftLines: [...hunk.leftLines],
    rightLines: [...hunk.rightLines],
  };
}
