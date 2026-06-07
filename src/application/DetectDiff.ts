import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { GitCli } from '../adapters/GitCli';
import type { FileSystemPort } from '../domain/ports/FileSystemPort';
import type { DiffFile, DiffHunk } from '../domain/Diff';
import { makeHunkId } from '../domain/Diff';
import type { UnifiedDiffParser } from '../domain/parser/UnifiedDiffParser';

export class DetectDiff {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly git: GitCli,
    private readonly parser: UnifiedDiffParser,
  ) {}

  /**
   * Builds the DiffFile that drives the diff view. Returns null when the
   * file is not under a git repository — the caller should fall back to
   * a no-op rather than show an empty view.
   */
  async run(uri: string): Promise<DiffFile | null> {
    const filePath = uriToFsPath(uri);
    const repoRoot = await this.git.findRepoRoot(filePath);
    if (!repoRoot) return null;
    // Both ends realpath'd so symlinked tmpdirs (e.g. /var → /private/var on
    // macOS) don't poison the relative path with leading "..".
    const realFilePath = await safeRealpath(filePath);
    const realRepoRoot = await safeRealpath(repoRoot);
    const repoRelativePath = toForwardSlashes(path.relative(realRepoRoot, realFilePath));

    // The display shows the CUMULATIVE diff between HEAD and the working
    // tree, so the user sees every change they could commit — staged or
    // not. The staged-status per hunk is computed separately by matching
    // each displayed hunk against `git diff --cached HEAD`, and the
    // checkbox reflects that flag.
    const [headRaw, workingRaw, headVsWorkingDiff, headShortHash] = await Promise.all([
      this.git.showHead(repoRoot, repoRelativePath),
      this.fs.read(uri),
      this.git.diffWorkingTreeAgainstHead(repoRoot, repoRelativePath),
      this.git.headShortHash(repoRoot),
    ]);

    const eol = detectEol(workingRaw);
    const workingLines = splitLines(workingRaw);
    const headLines = splitLines(headRaw);
    const workingUnified = this.parser.parse(headVsWorkingDiff);

    const hunks: DiffHunk[] = workingUnified.map((hunk) => ({
      id: makeHunkId(hunk.leftStartLine, hunk.rightStartLine),
      leftStartLine: hunk.leftStartLine,
      rightStartLine: hunk.rightStartLine,
      leftLines: hunk.leftLines,
      rightLines: hunk.rightLines,
    }));

    return {
      uri,
      repoRoot: realRepoRoot,
      repoRelativePath,
      headShortHash,
      headLines,
      workingLines,
      hunks,
      eol,
    };
  }

  /**
   * Returns the set of displayed-hunk ids that already exist in
   * `git diff --cached HEAD`. Match priority:
   *   1. Exact content (left + right) — fully-staged hunks.
   *   2. Same leftStartLine — partially staged hunks (working has more
   *      changes on top of what's in the index but the HEAD anchor matches).
   *      Treating these as "staged" makes the checkbox start checked so
   *      the user unchecks to unstage the existing index content first.
   */
  async initiallyStagedHunkIds(diffFile: DiffFile): Promise<Set<string>> {
    const stagedRaw = await this.git.diffStagedAgainstHead(
      diffFile.repoRoot,
      diffFile.repoRelativePath,
    );
    const stagedUnified = this.parser.parse(stagedRaw);
    const stagedIds = new Set<string>();
    for (const displayedHunk of diffFile.hunks) {
      for (const stagedHunk of stagedUnified) {
        const exactMatch =
          arraysEqual(stagedHunk.leftLines, displayedHunk.leftLines) &&
          arraysEqual(stagedHunk.rightLines, displayedHunk.rightLines);
        // Anchor-only fallback for partially-staged MODS: same HEAD line
        // anchor + both sides have actual content to anchor against.
        // Skipped for pure additions / deletions because their empty side
        // collides too easily with unrelated hunks at the same anchor.
        const anchorMatch =
          stagedHunk.leftStartLine === displayedHunk.leftStartLine &&
          stagedHunk.leftLines.length > 0 &&
          displayedHunk.leftLines.length > 0 &&
          stagedHunk.rightLines.length > 0 &&
          displayedHunk.rightLines.length > 0;
        if (exactMatch || anchorMatch) {
          stagedIds.add(displayedHunk.id);
          break;
        }
      }
    }
    return stagedIds;
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function safeRealpath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

function uriToFsPath(uri: string): string {
  if (uri.startsWith('file://')) {
    const withoutScheme = uri.slice('file://'.length);
    return decodeURIComponent(withoutScheme);
  }
  return uri;
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function detectEol(raw: string): string {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(raw: string): string[] {
  if (raw.length === 0) return [];
  const trimmed = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  return trimmed.split(/\r?\n/);
}
