import type { EditorPort } from '../domain/ports/EditorPort';
import type { FileSystemPort } from '../domain/ports/FileSystemPort';
import type { WebviewHandle, WebviewPort } from '../domain/ports/WebviewPort';
import type { HistoryEntry } from '../domain/DiffSession';
import { DiffSession } from '../domain/DiffSession';
import type { GitCli } from '../adapters/GitCli';
import { ApplyDiffAction, buildSingleHunkPatch } from './ApplyDiffAction';
import { DetectDiff } from './DetectDiff';
import { toDiffFileDTO } from './DiffMapper';
import type { InitContextProvider } from './OpenMergeView';
import type { WebviewToHost } from '../shared/protocol';

export class OpenDiffView {
  /**
   * Serialises every git side-effect from a single webview channel. Git
   * locks `.git/index.lock` per command — running two `git apply --cached`
   * concurrently makes the second one fail with "File exists". The mutex
   * keeps each action awaiting the previous so a "stage all" loop or a
   * rapid-fire user can never race against itself.
   */
  private gitMutex: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly detect: DetectDiff,
    private readonly apply: ApplyDiffAction,
    private readonly git: GitCli,
    private readonly fs: FileSystemPort,
    private readonly webview: WebviewPort,
    private readonly editor: EditorPort,
    private readonly initCtx: InitContextProvider,
    private readonly resolveLanguageId: (uri: string) => Promise<string>,
  ) {}

  /**
   * Resets the file's index entry back to HEAD when the working tree is
   * fully aligned with HEAD. No-op when there are still working-tree
   * diffs or no staged content for this file.
   */
  private async unstageIfWorkingMatchesHead(session: DiffSession): Promise<void> {
    const cumulative = await this.git.diffWorkingTreeAgainstHead(
      session.file.repoRoot,
      session.file.repoRelativePath,
    );
    if (cumulative.trim().length > 0) return;
    const staged = await this.git.diffStagedAgainstHead(
      session.file.repoRoot,
      session.file.repoRelativePath,
    );
    if (staged.trim().length === 0) return;
    try {
      await this.git.resetIndexToHead(session.file.repoRoot, session.file.repoRelativePath);
    } catch (error) {
      this.editor.showError(`Auto-unstage failed: ${(error as Error).message}`);
    }
  }

  /**
   * Re-fetches the diff and posts the fresh state back to the webview.
   * Used after a failed git op to resync the UI with what's actually in
   * the index — for instance when the user toggled a hunk that turned
   * out to be partially staged or already removed from the unstaged
   * diff.
   */
  private async pushFreshDiffState(
    session: DiffSession,
    handle: WebviewHandle,
    languageId: string,
  ): Promise<void> {
    const refreshed = await this.detect.run(session.file.uri);
    if (!refreshed) return;
    const stagedIds = await this.detect.initiallyStagedHunkIds(refreshed);
    session.updateFile(refreshed);
    handle.postMessage({
      kind: 'diffRefreshed',
      file: toDiffFileDTO(refreshed, stagedIds, languageId),
    });
  }

  private runSerial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.gitMutex.then(() => operation());
    // Swallow rejections in the mutex chain so one failure doesn't poison
    // the next caller — each caller still gets its own rejection through
    // `next` and can handle it normally.
    this.gitMutex = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async run(uri: string): Promise<void> {
    const file = await this.detect.run(uri);
    if (!file) {
      this.editor.showInfo('File is not inside a git repository.');
      return;
    }
    if (file.hunks.length === 0) {
      this.editor.showInfo('No working tree changes against HEAD.');
      return;
    }

    const stagedIds = await this.detect.initiallyStagedHunkIds(file);
    const session = DiffSession.from(file, stagedIds);
    const handle = this.webview.open(`Diff: ${shortName(uri)}`);
    const languageId = await this.resolveLanguageId(uri);

    const initPayload = {
      kind: 'initDiff' as const,
      file: toDiffFileDTO(file, stagedIds, languageId),
      font: this.initCtx.font(),
      theme: this.initCtx.theme(),
      keybindings: this.initCtx.keybindings(),
      grammar: this.initCtx.grammarFor(languageId),
      monacoBaseUri: handle.resolveAssetUri(['monaco', 'vs']),
    };

    let initSent = false;
    handle.onMessage((msg) => {
      if (msg.kind === 'ready' && !initSent) {
        initSent = true;
        handle.postMessage(initPayload);
        return;
      }
      void this.handleMessage(msg, session, handle, languageId);
    });
  }

  private async handleMessage(
    msg: WebviewToHost,
    session: DiffSession,
    handle: WebviewHandle,
    languageId: string,
  ): Promise<void> {
    switch (msg.kind) {
      case 'ready':
        return;
      case 'stageHunk': {
        const hunk = session.hunkById(msg.hunkId);
        if (!hunk) return;
        await this.runSerial(async () => {
          try {
            await this.apply.stageHunk(session, hunk);
            handle.postMessage({ kind: 'hunkStateChanged', hunkId: hunk.id, staged: true });
          } catch (error) {
            this.editor.showError(`Stage failed: ${(error as Error).message}`);
            await this.pushFreshDiffState(session, handle, languageId);
          }
        });
        return;
      }
      case 'unstageHunk': {
        const hunk = session.hunkById(msg.hunkId);
        if (!hunk) return;
        await this.runSerial(async () => {
          try {
            await this.apply.unstageHunk(session, hunk);
            handle.postMessage({ kind: 'hunkStateChanged', hunkId: hunk.id, staged: false });
          } catch (error) {
            this.editor.showError(`Unstage failed: ${(error as Error).message}`);
            await this.pushFreshDiffState(session, handle, languageId);
          }
        });
        return;
      }
      case 'stageAll': {
        await this.runSerial(async () => {
          const result = await this.apply.stageAll(session);
          if (result.failureCount > 0) {
            this.editor.showError(`Stage all: ${result.failureCount} hunk(s) could not be staged.`);
          }
          await this.pushFreshDiffState(session, handle, languageId);
        });
        return;
      }
      case 'unstageAll': {
        await this.runSerial(async () => {
          const result = await this.apply.unstageAll(session);
          if (result.failureCount > 0) {
            this.editor.showError(`Unstage all: ${result.failureCount} hunk(s) could not be unstaged.`);
          }
          await this.pushFreshDiffState(session, handle, languageId);
        });
        return;
      }
      case 'revertHunk': {
        const hunk = session.hunkById(msg.hunkId);
        if (!hunk) return;
        await this.runSerial(async () => {
          try {
            await this.apply.revertHunk(session, hunk);
          } catch (error) {
            this.editor.showError(`Revert failed: ${(error as Error).message}`);
            return;
          }
          // Working tree changed — push a refresh so the webview picks
          // up the new hunk list AND the session sees the new file ids.
          await this.pushFreshDiffState(session, handle, languageId);
        });
        return;
      }
      case 'undo': {
        const entry = session.undo();
        if (!entry) return;
        await this.replayHistoryEntry(entry, session, handle, languageId);
        return;
      }
      case 'redo': {
        const entry = session.redo();
        if (!entry) return;
        await this.replayHistoryEntry(entry, session, handle, languageId);
        return;
      }
      case 'runCommand':
        try {
          await this.initCtx.runCommand(msg.command, msg.args);
          handle.postMessage({ kind: 'commandResult', requestId: msg.requestId, ok: true });
        } catch (error) {
          handle.postMessage({
            kind: 'commandResult',
            requestId: msg.requestId,
            ok: false,
            error: (error as Error).message,
          });
        }
        return;
      case 'jumpToSource': {
        try {
          await this.initCtx.runCommand('conflict.jumpToWorkingFile', [session.file.uri]);
        } catch (error) {
          this.editor.showError(`Failed to open source file: ${(error as Error).message}`);
        }
        return;
      }
      case 'workingTreeEdited': {
        // Persist the buffer to disk so `git diff` sees it, then refresh
        // the displayed diff. Mutex so concurrent edits + stage/unstage
        // operations don't race on the file. Monaco's getValue strips
        // the trailing newline; we re-add it so the file on disk keeps
        // its terminator and git doesn't report a phantom "no newline
        // at end of file" hunk.
        const eol = session.file.eol;
        const contentToWrite = msg.content.endsWith(eol)
          ? msg.content
          : msg.content + eol;
        await this.runSerial(async () => {
          try {
            await this.fs.write(session.file.uri, contentToWrite);
          } catch (error) {
            this.editor.showError(`Failed to save edits: ${(error as Error).message}`);
            return;
          }
          // If the user's edits brought working all the way back to HEAD
          // (cumulative diff empty), also clear the index for this file
          // so it leaves both "Changes" and "Staged Changes" — matches
          // the user's mental model of "I undid everything visible".
          await this.unstageIfWorkingMatchesHead(session);
          await this.pushFreshDiffState(session, handle, languageId);
        });
        return;
      }
      default:
        // Diff view ignores merge-flow messages.
        return;
    }
  }

  /**
   * Dispatches a popped history entry to the matching git side-effect and
   * the matching webview message. Toggle entries flip the index; revert
   * entries either re-apply or re-reverse the hunk on the working tree
   * depending on whether they are being undone or redone (the session has
   * already swapped its internal state at this point — we just synchronise
   * git and the UI).
   */
  private async replayHistoryEntry(
    entry: HistoryEntry,
    session: DiffSession,
    handle: WebviewHandle,
    languageId: string,
  ): Promise<void> {
    if (entry.kind === 'toggle') {
      const targetStaged = session.isStaged(entry.hunkId);
      const hunk = session.hunkById(entry.hunkId);
      if (!hunk) return;
      const patch = buildSingleHunkPatch(session.file, hunk);
      try {
        if (targetStaged) await this.git.stageHunkPatch(session.file.repoRoot, patch);
        else await this.git.unstageHunkPatch(session.file.repoRoot, patch);
      } catch (error) {
        this.editor.showError(`Sync failed: ${(error as Error).message}`);
      }
      handle.postMessage({ kind: 'hunkStateChanged', hunkId: entry.hunkId, staged: targetStaged });
      return;
    }
    // Revert entry: the user is asking us to put the change back on the
    // working tree (undo of an earlier revert) or reapply the revert
    // (redo). We detect direction by asking the session whether the hunk
    // currently exists in the latest diff — if it doesn't, we're undoing
    // (need to re-apply); if it does, we're redoing (need to re-reverse).
    const patch = buildSingleHunkPatch(session.file, entry.hunk);
    const fresh = await this.detect.run(session.file.uri);
    const hunkAlreadyPresent = !!fresh && fresh.hunks.some((h) => h.id === entry.hunk.id);
    try {
      if (hunkAlreadyPresent) {
        await this.git.revertHunkPatchInWorkingTree(session.file.repoRoot, patch);
      } else {
        await this.git.applyHunkPatchToWorkingTree(session.file.repoRoot, patch);
      }
    } catch (error) {
      this.editor.showError(`Replay failed: ${(error as Error).message}`);
      return;
    }
    const refreshed = await this.detect.run(session.file.uri);
    if (!refreshed) return;
    const stagedIds = await this.detect.initiallyStagedHunkIds(refreshed);
    handle.postMessage({
      kind: 'diffRefreshed',
      file: toDiffFileDTO(refreshed, stagedIds, languageId),
    });
  }
}

function shortName(uri: string): string {
  const parts = uri.split(/[\\/]/);
  return parts[parts.length - 1] ?? uri;
}
