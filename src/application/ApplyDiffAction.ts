import type { GitCli } from '../adapters/GitCli';
import type { DiffFile, DiffHunk } from '../domain/Diff';
import type { DiffSession } from '../domain/DiffSession';
import type { UnifiedDiffParser, UnifiedHunk } from '../domain/parser/UnifiedDiffParser';

/**
 * Bridges DiffSession state changes to git side-effects. Every operation
 * re-fetches a fresh diff and matches the user-clicked hunk by content
 * BEFORE running git. That's necessary because the index moves under us:
 * staging one hunk shifts every subsequent hunk's line numbers, so the
 * patch we stored at diff-view open time is stale by the second click.
 * Content-equality matching is index-state-agnostic — as long as the
 * working tree content hasn't moved, the patch always lines up.
 */
export class ApplyDiffAction {
  constructor(
    private readonly git: GitCli,
    private readonly parser: UnifiedDiffParser,
  ) {}

  async stageHunk(session: DiffSession, hunk: DiffHunk): Promise<void> {
    const unstagedRaw = await this.git.diffWorkingTreeAgainstIndex(
      session.file.repoRoot,
      session.file.repoRelativePath,
    );
    const candidate = findMatchingHunk(this.parser.parse(unstagedRaw), hunk);
    if (!candidate) {
      throw new Error('Hunk no longer in the unstaged diff — possibly already staged.');
    }
    const patch = buildSingleHunkPatchFromUnified(session.file.repoRelativePath, candidate);
    await this.git.stageHunkPatch(session.file.repoRoot, patch);
    session.setStaged(hunk.id, true);
  }

  async unstageHunk(session: DiffSession, hunk: DiffHunk): Promise<void> {
    const stagedRaw = await this.git.diffStagedAgainstHead(
      session.file.repoRoot,
      session.file.repoRelativePath,
    );
    // The staged hunk has the SAME leftLines (HEAD content) AND rightLines
    // (working content == INDEX content after stage). We match on both so
    // pure-deletion and pure-addition hunks aren't ambiguous when the file
    // has several of them.
    const candidate = findMatchingHunk(this.parser.parse(stagedRaw), hunk);
    if (!candidate) {
      throw new Error('Hunk is not currently in the index — nothing to unstage.');
    }
    const patch = buildSingleHunkPatchFromUnified(session.file.repoRelativePath, candidate);
    await this.git.unstageHunkPatch(session.file.repoRoot, patch);
    session.setStaged(hunk.id, false);
  }

  async revertHunk(session: DiffSession, hunk: DiffHunk): Promise<void> {
    const patch = buildSingleHunkPatch(session.file, hunk);
    await this.git.revertHunkPatchInWorkingTree(session.file.repoRoot, patch);
    session.recordRevert(hunk);
  }

  /**
   * Stages every hunk on the session sequentially. Failures are counted
   * but don't abort the loop — partially-staged regions or already-staged
   * hunks throw inside stageHunk and would just bump the counter.
   * Returns the totals so the caller can surface them to the user.
   */
  async stageAll(session: DiffSession): Promise<BulkResult> {
    return this.runBulk(session, (hunk) => this.stageHunk(session, hunk));
  }

  /** Symmetric counterpart to {@link stageAll}. */
  async unstageAll(session: DiffSession): Promise<BulkResult> {
    return this.runBulk(session, (hunk) => this.unstageHunk(session, hunk));
  }

  private async runBulk(
    session: DiffSession,
    operation: (hunk: DiffHunk) => Promise<void>,
  ): Promise<BulkResult> {
    const hunks = [...session.file.hunks];
    let successCount = 0;
    let failureCount = 0;
    for (const hunk of hunks) {
      try {
        await operation(hunk);
        successCount++;
      } catch {
        failureCount++;
      }
    }
    return { successCount, failureCount, total: hunks.length };
  }
}

export interface BulkResult {
  readonly successCount: number;
  readonly failureCount: number;
  readonly total: number;
}

/**
 * Reconstructs the unified-diff text for a single hunk in the same shape
 * `git apply --unidiff-zero` expects. The file header is required even
 * though we only emit one hunk; git uses it to locate the target file.
 */
export function buildSingleHunkPatch(file: DiffFile, hunk: DiffHunk): string {
  return buildSingleHunkPatchFromUnified(file.repoRelativePath, {
    leftStartLine: hunk.leftStartLine,
    rightStartLine: hunk.rightStartLine,
    leftLines: hunk.leftLines,
    rightLines: hunk.rightLines,
  });
}

function buildSingleHunkPatchFromUnified(repoRelativePath: string, hunk: UnifiedHunk): string {
  const headerLines = [
    `diff --git a/${repoRelativePath} b/${repoRelativePath}`,
    `--- a/${repoRelativePath}`,
    `+++ b/${repoRelativePath}`,
  ];
  const hunkHeader = `@@ -${hunk.leftStartLine},${hunk.leftLines.length} +${hunk.rightStartLine},${hunk.rightLines.length} @@`;
  const bodyLines = [
    ...hunk.leftLines.map((line) => `-${line}`),
    ...hunk.rightLines.map((line) => `+${line}`),
  ];
  return [...headerLines, hunkHeader, ...bodyLines, ''].join('\n');
}

function findUnifiedHunkMatchingRight(
  hunks: readonly UnifiedHunk[],
  rightLines: readonly string[],
): UnifiedHunk | null {
  for (const hunk of hunks) {
    if (arraysEqual(hunk.rightLines, rightLines)) return hunk;
  }
  return null;
}

/**
 * Locates the hunk in a freshly-fetched diff that corresponds to the one
 * the user clicked. Two-stage matching:
 *
 *   1. Exact content equality (left + right). The clean fully-staged or
 *      fully-unstaged case — picks the right hunk even when several share
 *      the same shape.
 *   2. Same `leftStartLine` anchor as a fallback. Partially-staged regions
 *      have different content between the cumulative diff and the
 *      unstaged-only diff, but they share the same HEAD anchor — staging
 *      the matching unstaged hunk stages whatever remains uncommitted at
 *      that location.
 */
function findMatchingHunk(
  hunks: readonly UnifiedHunk[],
  reference: { leftLines: readonly string[]; rightLines: readonly string[]; leftStartLine: number },
): UnifiedHunk | null {
  for (const hunk of hunks) {
    if (
      arraysEqual(hunk.leftLines, reference.leftLines) &&
      arraysEqual(hunk.rightLines, reference.rightLines)
    ) {
      return hunk;
    }
  }
  for (const hunk of hunks) {
    if (hunk.leftStartLine === reference.leftStartLine) return hunk;
  }
  return null;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
