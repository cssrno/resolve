/**
 * Domain shape for the diff view. A `DiffFile` describes one file under a
 * git repo: its content at HEAD, its current working-tree content, and the
 * set of hunks that differ between the two sides. The hunks are produced
 * by `git diff --unified=0`, so each one is a tight change region with no
 * surrounding context — that's what lets us stage or revert them
 * individually via `git apply --unidiff-zero`.
 */
export interface DiffHunk {
  /** Stable identifier built from line positions, used by the UI for keying. */
  readonly id: string;
  /** 1-based start line on the HEAD ("left") side. */
  readonly leftStartLine: number;
  /** 1-based start line on the working ("right") side. */
  readonly rightStartLine: number;
  /** Lines removed from HEAD (left side). Empty for pure insertions. */
  readonly leftLines: readonly string[];
  /** Lines added on working (right side). Empty for pure deletions. */
  readonly rightLines: readonly string[];
}

export interface DiffFile {
  /** Original file URI as seen by VSCode (file://...). */
  readonly uri: string;
  /** Absolute path to the git repo root that owns this file. */
  readonly repoRoot: string;
  /** Path of the file relative to `repoRoot`, with forward slashes. */
  readonly repoRelativePath: string;
  /** Short HEAD commit hash for the repo (empty if HEAD doesn't resolve). */
  readonly headShortHash: string;
  /** `git show HEAD:<path>` split on newlines. */
  readonly headLines: readonly string[];
  /** Working-tree file content split on newlines. */
  readonly workingLines: readonly string[];
  /** Hunks computed from `git diff --unified=0 HEAD -- <path>`. */
  readonly hunks: readonly DiffHunk[];
  /** Line terminator detected on the working file ('\n' or '\r\n'). */
  readonly eol: string;
}

export function makeHunkId(leftStartLine: number, rightStartLine: number): string {
  return `hunk-${leftStartLine}-${rightStartLine}`;
}
