import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { GitCli } from '../../src/adapters/GitCli';
import { UnifiedDiffParser } from '../../src/domain/parser/UnifiedDiffParser';
import { DetectDiff } from '../../src/application/DetectDiff';
import { ApplyDiffAction } from '../../src/application/ApplyDiffAction';
import { DiffSession } from '../../src/domain/DiffSession';
import type { FileSystemPort } from '../../src/domain/ports/FileSystemPort';

const exec = promisify(execFile);

const INITIAL = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n') + '\n';

class NodeFs implements FileSystemPort {
  async read(uri: string): Promise<string> {
    return fs.readFile(uriToFsPath(uri), 'utf-8');
  }
  async write(uri: string, content: string): Promise<void> {
    await fs.writeFile(uriToFsPath(uri), content, 'utf-8');
  }
}

function uriToFsPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function fsPathToUri(fsPath: string): string {
  return `file://${encodeURI(fsPath).replace(/%2F/g, '/')}`;
}

describe('Diff pipeline (DetectDiff + DiffSession + ApplyDiffAction)', () => {
  const git = new GitCli();
  const parser = new UnifiedDiffParser();
  const fsPort = new NodeFs();
  const detect = new DetectDiff(fsPort, git, parser);
  const apply = new ApplyDiffAction(git, parser);

  let repoRoot: string;
  let filePath: string;
  let uri: string;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'diffpipe-'));
    filePath = path.join(repoRoot, 'sample.txt');
    uri = fsPathToUri(filePath);
    await exec('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
    await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot });
    await fs.writeFile(filePath, INITIAL, 'utf-8');
    await exec('git', ['add', 'sample.txt'], { cwd: repoRoot });
    await exec('git', ['commit', '-q', '-m', 'initial'], { cwd: repoRoot });
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it('DetectDiff returns null for files outside any repo', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'norepo-'));
    try {
      const outsideUri = fsPathToUri(path.join(outside, 'x.txt'));
      await fs.writeFile(uriToFsPath(outsideUri), 'noop', 'utf-8');
      expect(await detect.run(outsideUri)).toBeNull();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('DetectDiff exposes hunks and head/working content', async () => {
    const modified = INITIAL.replace('beta', 'BETA').replace('delta', 'DELTA');
    await fs.writeFile(filePath, modified, 'utf-8');

    const diff = await detect.run(uri);
    expect(diff).not.toBeNull();
    expect(diff!.repoRelativePath).toBe('sample.txt');
    expect(diff!.headLines).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon']);
    expect(diff!.workingLines).toEqual(['alpha', 'BETA', 'gamma', 'DELTA', 'epsilon']);
    expect(diff!.hunks).toHaveLength(2);
    expect(diff!.hunks[0]!.leftLines).toEqual(['beta']);
    expect(diff!.hunks[0]!.rightLines).toEqual(['BETA']);
    expect(diff!.hunks[1]!.leftLines).toEqual(['delta']);
    expect(diff!.hunks[1]!.rightLines).toEqual(['DELTA']);
  });

  it('ApplyDiffAction.stageHunk + unstageHunk round-trip via git index', async () => {
    const modified = INITIAL.replace('beta', 'BETA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const diff = await detect.run(uri);
    const session = DiffSession.from(diff!);
    const [hunk] = session.file.hunks;

    await apply.stageHunk(session, hunk!);
    expect(session.isStaged(hunk!.id)).toBe(true);
    expect(parser.parse(await git.diffStagedAgainstHead(diff!.repoRoot, diff!.repoRelativePath))).toHaveLength(1);

    await apply.unstageHunk(session, hunk!);
    expect(session.isStaged(hunk!.id)).toBe(false);
    expect(await git.diffStagedAgainstHead(diff!.repoRoot, diff!.repoRelativePath)).toBe('');
  });

  it('ApplyDiffAction.stageAll stages every displayed hunk and reports totals', async () => {
    const modified = INITIAL.replace('beta', 'BETA').replace('delta', 'DELTA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const diff = await detect.run(uri);
    const session = DiffSession.from(diff!);
    expect(session.file.hunks).toHaveLength(2);

    const result = await apply.stageAll(session);
    expect(result.total).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);

    // After stage all, the unstaged diff is empty — everything moved to index.
    expect(await git.diffWorkingTreeAgainstIndex(repoRoot, 'sample.txt')).toBe('');
    // And the staged diff (HEAD vs index) carries both modifications.
    const stagedHunks = parser.parse(await git.diffStagedAgainstHead(repoRoot, 'sample.txt'));
    expect(stagedHunks).toHaveLength(2);
  });

  it('ApplyDiffAction.unstageAll reverses every previously-staged hunk', async () => {
    const modified = INITIAL.replace('beta', 'BETA').replace('delta', 'DELTA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const diff = await detect.run(uri);
    const session = DiffSession.from(diff!);

    await apply.stageAll(session);
    expect(parser.parse(await git.diffStagedAgainstHead(repoRoot, 'sample.txt'))).toHaveLength(2);

    const result = await apply.unstageAll(session);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
    // After unstage all, the staged diff is empty again.
    expect(await git.diffStagedAgainstHead(repoRoot, 'sample.txt')).toBe('');
  });

  it('GitCli.resetIndexToHead clears a single file from the staging area', async () => {
    const modified = INITIAL.replace('beta', 'BETA');
    await fs.writeFile(filePath, modified, 'utf-8');
    // Stage the change so the file is in --cached HEAD.
    const fullDiff = await git.diffWorkingTreeAgainstIndex(repoRoot, 'sample.txt');
    const firstHunkPatch = onlyFirstHunkPatch('sample.txt', fullDiff);
    await git.stageHunkPatch(repoRoot, firstHunkPatch);
    expect(parser.parse(await git.diffStagedAgainstHead(repoRoot, 'sample.txt'))).toHaveLength(1);

    await git.resetIndexToHead(repoRoot, 'sample.txt');
    expect(await git.diffStagedAgainstHead(repoRoot, 'sample.txt')).toBe('');
    // Working tree still has the BETA change — reset doesn't touch it.
    expect(await fs.readFile(filePath, 'utf-8')).toContain('BETA');
  });

  it('DiffSession.updateFile lets hunkById find the freshly-detected hunks', async () => {
    const modified = INITIAL.replace('beta', 'BETA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const diff = await detect.run(uri);
    const session = DiffSession.from(diff!);
    const originalHunkIds = new Set(session.file.hunks.map((h) => h.id));

    // Touch the file in a way that shifts line numbers (and therefore the
    // hunk ids derived from them). Refresh detect, push to session.
    const reshaped = INITIAL.replace('alpha', 'ALPHA').replace('beta', 'BETA');
    await fs.writeFile(filePath, reshaped, 'utf-8');
    const refreshed = await detect.run(uri);
    session.updateFile(refreshed!);

    expect(session.file.hunks.length).toBeGreaterThan(0);
    for (const hunk of session.file.hunks) {
      expect(session.hunkById(hunk.id)).toBeDefined();
    }
    // The new ids are distinct from the originals (positions shifted).
    expect(session.file.hunks.some((h) => !originalHunkIds.has(h.id))).toBe(true);
  });

  it('ApplyDiffAction.stageAll on an empty diff is a no-op', async () => {
    // Working tree matches HEAD → no hunks to stage.
    const diff = await detect.run(uri);
    const session = DiffSession.from(diff!);
    expect(session.file.hunks).toHaveLength(0);

    const result = await apply.stageAll(session);
    expect(result).toEqual({ total: 0, successCount: 0, failureCount: 0 });
  });

  it('ApplyDiffAction.revertHunk removes the change from the working tree', async () => {
    const modified = INITIAL.replace('beta', 'BETA').replace('delta', 'DELTA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const diff = await detect.run(uri);
    const session = DiffSession.from(diff!);
    const firstHunk = session.file.hunks[0]!;

    await apply.revertHunk(session, firstHunk);
    const after = await fs.readFile(filePath, 'utf-8');
    expect(after).toContain('beta');
    expect(after).toContain('DELTA');
    expect(after).not.toContain('BETA');
  });

  it('DetectDiff shows both staged and unstaged hunks after partial staging', async () => {
    const modified = INITIAL.replace('beta', 'BETA').replace('delta', 'DELTA');
    await fs.writeFile(filePath, modified, 'utf-8');
    // Stage only the first hunk via a hand-built patch (BETA mod).
    const fullDiff = await git.diffWorkingTreeAgainstIndex(repoRoot, 'sample.txt');
    const firstHunkPatch = onlyFirstHunkPatch('sample.txt', fullDiff);
    await git.stageHunkPatch(repoRoot, firstHunkPatch);

    // The cumulative diff (HEAD vs working) shows BOTH hunks; the staged
    // one is tagged via initiallyStagedHunkIds.
    const diff = await detect.run(uri);
    expect(diff!.hunks).toHaveLength(2);
    const rightLines = diff!.hunks.map((h) => h.rightLines.join(','));
    expect(rightLines).toEqual(expect.arrayContaining(['BETA', 'DELTA']));
    const stagedIds = await detect.initiallyStagedHunkIds(diff!);
    expect(stagedIds.size).toBe(1);
    const stagedHunk = diff!.hunks.find((h) => stagedIds.has(h.id));
    expect(stagedHunk!.rightLines).toEqual(['BETA']);
  });

  it('DiffSession.undo reverts a staged toggle', async () => {
    const modified = INITIAL.replace('beta', 'BETA');
    await fs.writeFile(filePath, modified, 'utf-8');
    const diff = await detect.run(uri);
    const session = DiffSession.from(diff!);
    const [hunk] = session.file.hunks;

    session.setStaged(hunk!.id, true);
    expect(session.isStaged(hunk!.id)).toBe(true);
    const undo = session.undo();
    expect(undo).toMatchObject({ kind: 'toggle', hunkId: hunk!.id, previousStaged: false });
    expect(session.isStaged(hunk!.id)).toBe(false);
    const redo = session.redo();
    expect(redo).toMatchObject({ kind: 'toggle', hunkId: hunk!.id, previousStaged: true });
    expect(session.isStaged(hunk!.id)).toBe(true);
  });
});

function onlyFirstHunkPatch(repoRelativePath: string, fullDiff: string): string {
  const lines = fullDiff.split('\n');
  const headers: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith('@@ ')) headers.push(index);
  });
  const start = headers[0]!;
  const end = headers[1] ?? lines.length;
  const hunk = lines.slice(start, end).join('\n');
  return [
    `diff --git a/${repoRelativePath} b/${repoRelativePath}`,
    `--- a/${repoRelativePath}`,
    `+++ b/${repoRelativePath}`,
    hunk,
    '',
  ].join('\n');
}
