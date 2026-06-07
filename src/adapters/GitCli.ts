import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export interface MergeContextResult {
  readonly operation: 'merge' | 'rebase';
  readonly localRef: string;
  readonly localHash: string;
  readonly incomingRef: string;
  readonly incomingHash: string;
}
import { promisify } from 'node:util';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

/** ~10 MB cap on git stdout — generous for source files, avoids unbounded RSS. */
const MAX_GIT_STDOUT_BYTES = 10 * 1024 * 1024;

/**
 * Thin wrapper over the git CLI for the diff view. Every public method is
 * scoped to a single file inside a repo and shells out via spawn / execFile
 * with explicit argv (no shell interpolation). Patches are piped to git's
 * stdin so we never write temp files.
 */
export class GitCli {
  /**
   * Resolves the absolute repo root that owns a given file path. Returns
   * null if the file is not inside a git repository, instead of throwing,
   * so the caller can decide whether to fall back gracefully.
   */
  async findRepoRoot(filePath: string): Promise<string | null> {
    const dir = path.dirname(filePath);
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dir,
        maxBuffer: MAX_GIT_STDOUT_BYTES,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Returns the merge / rebase context active in the repo, if any.
   * Used by the merge view to label its Local / Remote columns with
   * the actual refs (e.g. `Rebasing abc1234 from feature/foo`).
   * Returns null when no merge / rebase is in progress.
   */
  async mergeContext(repoRoot: string): Promise<MergeContextResult | null> {
    const readGitFile = async (relative: string): Promise<string | null> => {
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['rev-parse', '--git-path', relative],
          { cwd: repoRoot, maxBuffer: MAX_GIT_STDOUT_BYTES },
        );
        const path = stdout.trim();
        const content = await readFile(path, 'utf8');
        return content.trim();
      } catch {
        return null;
      }
    };
    const shortHash = async (revision: string): Promise<string> => {
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['rev-parse', '--short', revision],
          { cwd: repoRoot, maxBuffer: MAX_GIT_STDOUT_BYTES },
        );
        return stdout.trim();
      } catch {
        return '';
      }
    };
    const localBranch = await (async () => {
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['symbolic-ref', '--short', '-q', 'HEAD'],
          { cwd: repoRoot, maxBuffer: MAX_GIT_STDOUT_BYTES },
        );
        return stdout.trim();
      } catch {
        return '';
      }
    })();
    const localHash = await shortHash('HEAD');

    // Rebase in progress: .git/rebase-merge/ or .git/rebase-apply/.
    const rebaseHeadName = await readGitFile('rebase-merge/head-name');
    const rebaseOnto = await readGitFile('rebase-merge/onto');
    if (rebaseHeadName !== null) {
      const ontoBranch = await (async () => {
        if (!rebaseOnto) return '';
        try {
          const { stdout } = await execFileAsync(
            'git',
            ['name-rev', '--name-only', '--no-undefined', rebaseOnto],
            { cwd: repoRoot, maxBuffer: MAX_GIT_STDOUT_BYTES },
          );
          return stdout.trim();
        } catch {
          return '';
        }
      })();
      return {
        operation: 'rebase',
        localRef: rebaseHeadName.replace(/^refs\/heads\//, ''),
        localHash,
        incomingRef: ontoBranch || 'onto',
        incomingHash: rebaseOnto ? await shortHash(rebaseOnto) : '',
      };
    }

    // Merge in progress: .git/MERGE_HEAD holds the incoming SHA;
    // .git/MERGE_MSG's first line typically names the branch.
    const mergeHead = await readGitFile('MERGE_HEAD');
    if (mergeHead !== null) {
      const incomingHash = await shortHash(mergeHead);
      const mergeMsg = await readGitFile('MERGE_MSG');
      const incomingRefMatch = mergeMsg?.match(/Merge branch '([^']+)'/);
      const incomingRef = incomingRefMatch ? incomingRefMatch[1]! : mergeHead.slice(0, 12);
      return {
        operation: 'merge',
        localRef: localBranch,
        localHash,
        incomingRef,
        incomingHash,
      };
    }

    return null;
  }

  /** Short HEAD commit hash for the repo. Empty string if HEAD can't be resolved. */
  async headShortHash(repoRoot: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: repoRoot,
        maxBuffer: MAX_GIT_STDOUT_BYTES,
      });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  /** Returns the file's contents at HEAD as a single string (empty if file is untracked at HEAD). */
  async showHead(repoRoot: string, repoRelativePath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', `HEAD:${repoRelativePath}`],
        { cwd: repoRoot, maxBuffer: MAX_GIT_STDOUT_BYTES },
      );
      return stdout;
    } catch {
      return '';
    }
  }

  /**
   * Returns the file's contents in the index (= staging area). Equivalent
   * to `git show :path`. Differs from HEAD whenever the user has staged
   * partial changes to the file.
   */
  async showIndex(repoRoot: string, repoRelativePath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', `:${repoRelativePath}`],
        { cwd: repoRoot, maxBuffer: MAX_GIT_STDOUT_BYTES },
      );
      return stdout;
    } catch {
      return '';
    }
  }

  /** Unified diff (zero context) between HEAD and the working tree for one file. */
  async diffWorkingTreeAgainstHead(repoRoot: string, repoRelativePath: string): Promise<string> {
    return this.runGitCapture(repoRoot, [
      'diff',
      '--no-color',
      '--unified=0',
      'HEAD',
      '--',
      repoRelativePath,
    ]);
  }

  /** Unified diff (zero context) between HEAD and the index for one file. */
  async diffStagedAgainstHead(repoRoot: string, repoRelativePath: string): Promise<string> {
    return this.runGitCapture(repoRoot, [
      'diff',
      '--no-color',
      '--unified=0',
      '--cached',
      'HEAD',
      '--',
      repoRelativePath,
    ]);
  }

  /** Unified diff (zero context) between the index and the working tree (= unstaged hunks). */
  async diffWorkingTreeAgainstIndex(repoRoot: string, repoRelativePath: string): Promise<string> {
    return this.runGitCapture(repoRoot, [
      'diff',
      '--no-color',
      '--unified=0',
      '--',
      repoRelativePath,
    ]);
  }

  /**
   * Resets the index for a single file back to HEAD — equivalent to
   * `git reset HEAD -- <path>`. Used when the user has reverted the
   * working tree back to HEAD via live edits; we drop the lingering
   * staged content so the file leaves the SCM "Staged Changes" list.
   */
  async resetIndexToHead(repoRoot: string, repoRelativePath: string): Promise<void> {
    await execFileAsync('git', ['reset', '-q', 'HEAD', '--', repoRelativePath], {
      cwd: repoRoot,
      maxBuffer: MAX_GIT_STDOUT_BYTES,
    });
  }

  /** Stages a single hunk by piping its unified-diff patch to `git apply --cached`. */
  async stageHunkPatch(repoRoot: string, patch: string): Promise<void> {
    await this.runGitWithStdin(
      repoRoot,
      ['apply', '--cached', '--unidiff-zero', '--whitespace=nowarn', '-'],
      patch,
    );
  }

  /** Unstages a single hunk by reverse-applying its patch to the index. */
  async unstageHunkPatch(repoRoot: string, patch: string): Promise<void> {
    await this.runGitWithStdin(
      repoRoot,
      ['apply', '--cached', '--reverse', '--unidiff-zero', '--whitespace=nowarn', '-'],
      patch,
    );
  }

  /** Reverts a single hunk in the working tree by reverse-applying its patch. */
  async revertHunkPatchInWorkingTree(repoRoot: string, patch: string): Promise<void> {
    await this.runGitWithStdin(
      repoRoot,
      ['apply', '--reverse', '--unidiff-zero', '--whitespace=nowarn', '-'],
      patch,
    );
  }

  /**
   * Re-applies a hunk to the working tree (forward direction). Used to
   * undo a previously-performed revert by replaying the original change.
   */
  async applyHunkPatchToWorkingTree(repoRoot: string, patch: string): Promise<void> {
    await this.runGitWithStdin(
      repoRoot,
      ['apply', '--unidiff-zero', '--whitespace=nowarn', '-'],
      patch,
    );
  }

  private async runGitCapture(cwd: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd,
      maxBuffer: MAX_GIT_STDOUT_BYTES,
    });
    return stdout;
  }

  private runGitWithStdin(cwd: string, args: readonly string[], stdinPayload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', [...args], { cwd });
      let stderrBuffer = '';
      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git ${args.join(' ')} exited ${code}: ${stderrBuffer.trim()}`));
      });
      child.stdin.end(stdinPayload);
    });
  }
}
