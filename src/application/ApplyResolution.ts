import type { ConflictBlock } from '../domain/ConflictBlock';
import type { MergeSession } from '../domain/MergeSession';
import type { Resolution, SideDecision } from '../domain/Resolution';

export class ApplyResolution {
  apply(session: MergeSession, blockId: string, resolution: Resolution): void {
    session.resolve(blockId, resolution);
  }

  reset(session: MergeSession, blockId: string): void {
    session.unresolve(blockId);
  }

  /**
   * Marks one side of a block as rejected. For conflict blocks this is a
   * granular update — the other side keeps its existing decision (or stays
   * pending). For non-conflict (one-sided) blocks the action fully resolves
   * the block, with the unchanged side accepted so the result keeps the base
   * content.
   */
  rejectSide(session: MergeSession, block: ConflictBlock, side: 'left' | 'right'): void {
    if (isConflictBlock(block)) {
      session.resolve(block.id, mergeSideDecision(session.getResolution(block.id), side, 'rejected'));
      return;
    }
    const localChanged = !arraysEqual(block.localLines, block.baseLines ?? []);
    const left: SideDecision = localChanged ? 'rejected' : 'accepted';
    const right: SideDecision = localChanged ? 'accepted' : 'rejected';
    session.resolve(block.id, { kind: 'sides', left, right });
  }

  /**
   * Marks one side of a block as accepted. For conflict blocks the update is
   * strictly granular — the other side keeps its previous decision (or stays
   * pending). This lets the user accept both sides successively
   * (chevron-left then chevron-right) without one click cancelling the
   * other. For non-conflict (one-sided) blocks the action fully resolves the
   * block: the changed side becomes 'accepted' and the unchanged side
   * 'rejected', so the result contains the change.
   */
  acceptSide(session: MergeSession, block: ConflictBlock, side: 'left' | 'right'): void {
    if (isConflictBlock(block)) {
      session.resolve(block.id, mergeSideDecision(session.getResolution(block.id), side, 'accepted'));
      return;
    }
    const localChanged = !arraysEqual(block.localLines, block.baseLines ?? []);
    const left: SideDecision = localChanged ? 'accepted' : 'rejected';
    const right: SideDecision = localChanged ? 'rejected' : 'accepted';
    session.resolve(block.id, { kind: 'sides', left, right });
  }
}

function mergeSideDecision(
  prev: Resolution | undefined,
  side: 'left' | 'right',
  decision: SideDecision,
): Resolution {
  const prevSides = prev && prev.kind === 'sides' ? prev : null;
  return {
    kind: 'sides',
    left: side === 'left' ? decision : prevSides?.left,
    right: side === 'right' ? decision : prevSides?.right,
  };
}

function isConflictBlock(block: ConflictBlock): boolean {
  if (block.baseLines === null) return true;
  const localChanged = !arraysEqual(block.localLines, block.baseLines);
  const remoteChanged = !arraysEqual(block.remoteLines, block.baseLines);
  return localChanged && remoteChanged;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
