import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { GitCli } from '../../src/adapters/GitCli';
import { UnifiedDiffParser } from '../../src/domain/parser/UnifiedDiffParser';

const exec = promisify(execFile);

const INITIAL_CONTENT = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n') + '\n';

/**
 * Integration tests for GitCli. Each test spins up a real git repo in a
 * tmpdir, commits a known file, and exercises the wrapper end-to-end so
 * the patch piping, argv quoting, and exit-code handling are validated
 * against actual git rather than a mock.
 */
describe('GitCli (integration, real git binary)', () => {
  const cli = new GitCli();
  const parser = new UnifiedDiffParser();
  let repoRoot: string;
  let filePath: string;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gitcli-'));
    filePath = path.join(repoRoot, 'sample.txt');
    await exec('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
    await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot });
    await fs.writeFile(filePath, INITIAL_CONTENT, 'utf-8');
    await exec('git', ['add', 'sample.txt'], { cwd: repoRoot });
    await exec('git', ['commit', '-q', '-m', 'initial'], { cwd: repoRoot });
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it('findRepoRoot returns the toplevel for files inside the repo', async () => {
    const detected = await cli.findRepoRoot(filePath);
    expect(detected).toBeTruthy();
    expect(await fs.realpath(detected!)).toBe(await fs.realpath(repoRoot));
  });

  it('findRepoRoot returns null for paths outside any repo', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'norepo-'));
    try {
      expect(await cli.findRepoRoot(path.join(outside, 'x.txt'))).toBeNull();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('showHead returns the committed content', async () => {
    expect(await cli.showHead(repoRoot, 'sample.txt')).toBe(INITIAL_CONTENT);
  });

  it('diffWorkingTreeAgainstHead is empty when no working changes', async () => {
    expect(await cli.diffWorkingTreeAgainstHead(repoRoot, 'sample.txt')).toBe('');
  });

  it('diffWorkingTreeAgainstHead exposes line modifications', async () => {
    const modified = INITIAL_CONTENT.replace('beta', 'BETA').replace('delta', 'DELTA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const raw = await cli.diffWorkingTreeAgainstHead(repoRoot, 'sample.txt');
    const hunks = parser.parse(raw);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.leftLines).toEqual(['beta']);
    expect(hunks[0]!.rightLines).toEqual(['BETA']);
    expect(hunks[1]!.leftLines).toEqual(['delta']);
    expect(hunks[1]!.rightLines).toEqual(['DELTA']);
  });

  it('stageHunkPatch stages a single hunk and the rest stays unstaged', async () => {
    const modified = INITIAL_CONTENT.replace('beta', 'BETA').replace('delta', 'DELTA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const fullDiff = await cli.diffWorkingTreeAgainstHead(repoRoot, 'sample.txt');
    const firstHunkPatch = buildSingleHunkPatch('sample.txt', fullDiff, 0);

    await cli.stageHunkPatch(repoRoot, firstHunkPatch);

    const stagedDiff = await cli.diffStagedAgainstHead(repoRoot, 'sample.txt');
    const stagedHunks = parser.parse(stagedDiff);
    expect(stagedHunks).toHaveLength(1);
    expect(stagedHunks[0]!.rightLines).toEqual(['BETA']);

    const unstagedDiff = await cli.diffWorkingTreeAgainstHead(repoRoot, 'sample.txt');
    const remaining = parser.parse(unstagedDiff);
    // Working tree still differs from HEAD on both lines, but the BETA change
    // has been moved into the index. With `--cached` excluded we still see
    // both diffs versus HEAD.
    expect(remaining).toHaveLength(2);
  });

  it('unstageHunkPatch reverses a previously staged hunk', async () => {
    const modified = INITIAL_CONTENT.replace('beta', 'BETA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const fullDiff = await cli.diffWorkingTreeAgainstHead(repoRoot, 'sample.txt');
    const hunkPatch = buildSingleHunkPatch('sample.txt', fullDiff, 0);

    await cli.stageHunkPatch(repoRoot, hunkPatch);
    expect(parser.parse(await cli.diffStagedAgainstHead(repoRoot, 'sample.txt'))).toHaveLength(1);

    await cli.unstageHunkPatch(repoRoot, hunkPatch);
    expect(await cli.diffStagedAgainstHead(repoRoot, 'sample.txt')).toBe('');
  });

  it('revertHunkPatchInWorkingTree rolls a hunk back to HEAD content', async () => {
    const modified = INITIAL_CONTENT.replace('beta', 'BETA').replace('delta', 'DELTA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const fullDiff = await cli.diffWorkingTreeAgainstHead(repoRoot, 'sample.txt');
    const firstHunkPatch = buildSingleHunkPatch('sample.txt', fullDiff, 0);

    await cli.revertHunkPatchInWorkingTree(repoRoot, firstHunkPatch);

    const fileAfter = await fs.readFile(filePath, 'utf-8');
    expect(fileAfter).toContain('beta'); // first hunk reverted
    expect(fileAfter).toContain('DELTA'); // second hunk still applied
    expect(fileAfter).not.toContain('BETA');
  });
});

/**
 * Builds a patch string containing only the Nth hunk of a multi-hunk diff,
 * preserving the file header that `git apply` requires.
 */
function buildSingleHunkPatch(repoRelativePath: string, fullDiff: string, hunkIndex: number): string {
  const lines = fullDiff.split('\n');
  const hunkHeaderIndices: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith('@@ ')) hunkHeaderIndices.push(index);
  });
  if (hunkIndex >= hunkHeaderIndices.length) {
    throw new Error(`hunk ${hunkIndex} out of range (${hunkHeaderIndices.length} total)`);
  }
  const start = hunkHeaderIndices[hunkIndex]!;
  const end = hunkHeaderIndices[hunkIndex + 1] ?? lines.length;
  const hunkBody = lines.slice(start, end).join('\n');
  const header = [
    `diff --git a/${repoRelativePath} b/${repoRelativePath}`,
    `--- a/${repoRelativePath}`,
    `+++ b/${repoRelativePath}`,
  ].join('\n');
  return `${header}\n${hunkBody}\n`;
}
