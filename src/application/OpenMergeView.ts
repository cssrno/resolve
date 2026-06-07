import type { ConflictFile } from '../domain/ConflictFile';
import { MergeSession } from '../domain/MergeSession';
import type { EditorPort } from '../domain/ports/EditorPort';
import type { WebviewHandle, WebviewPort } from '../domain/ports/WebviewPort';
import { ApplyResolution } from './ApplyResolution';
import { DetectConflicts } from './DetectConflicts';
import { SaveResolvedFile } from './SaveResolvedFile';
import { fromResolutionDTO, toFileDTO, toResolutionDTO } from './ConflictMapper';
import type {
  DocumentSymbolDTO,
  EditorFontConfig,
  GrammarConfig,
  KeybindingDTO,
  MergeContextDTO,
  ThemeConfig,
  WebviewToHost,
} from '../shared/protocol';
import { acceptBoth, acceptLeft, acceptRight, manual } from '../domain/Resolution';

export interface InitContextProvider {
  font(): EditorFontConfig;
  theme(): ThemeConfig;
  keybindings(): KeybindingDTO[];
  grammarFor(languageId: string): GrammarConfig | null;
  runCommand(command: string, args?: unknown[]): Promise<void>;
  /** Fetches the file's outline via VS Code's document symbol provider.
   *  Returns an empty array when no language extension contributed one
   *  (or the file is in an unparseable state like a merge conflict). */
  fetchSymbols?(uri: string): Promise<DocumentSymbolDTO[]>;
  /** Returns the active git merge / rebase context for the file's repo,
   *  if any. Lets the merge view label its Local / Remote columns with
   *  the actual refs. Optional — returns undefined when no operation
   *  is in progress or git isn't available. */
  fetchMergeContext?(uri: string): Promise<MergeContextDTO | undefined>;
}

export class OpenMergeView {
  constructor(
    private readonly detect: DetectConflicts,
    private readonly apply: ApplyResolution,
    private readonly save: SaveResolvedFile,
    private readonly webview: WebviewPort,
    private readonly editor: EditorPort,
    private readonly initCtx: InitContextProvider,
    private readonly resolveLanguageId: (uri: string) => Promise<string>,
  ) {}

  async run(uri: string): Promise<void> {
    const file = await this.detect.run(uri);
    if (file.blocks.length === 0) {
      this.editor.showInfo('No conflicts detected in this file.');
      return;
    }

    const session = MergeSession.from(file);
    const handle = this.webview.open(`Merge: ${shortName(uri)}`);
    const languageId = await this.resolveLanguageId(uri);

    const symbols = this.initCtx.fetchSymbols
      ? await this.initCtx.fetchSymbols(uri).catch(() => [])
      : [];
    const mergeContext = this.initCtx.fetchMergeContext
      ? await this.initCtx.fetchMergeContext(uri).catch(() => undefined)
      : undefined;
    const fileDto = toFileDTO(file, session, languageId);
    if (mergeContext) fileDto.mergeContext = mergeContext;
    const initPayload = {
      kind: 'init' as const,
      file: fileDto,
      font: this.initCtx.font(),
      theme: this.initCtx.theme(),
      keybindings: this.initCtx.keybindings(),
      grammar: this.initCtx.grammarFor(languageId),
      monacoBaseUri: handle.resolveAssetUri(['monaco', 'vs']),
      symbols,
    };

    let initSent = false;
    handle.onMessage((msg) => {
      // Defer init until the webview signals it's ready so the message isn't
      // dropped before its message listener is attached.
      if (msg.kind === 'ready' && !initSent) {
        initSent = true;
        handle.postMessage(initPayload);
        return;
      }
      this.handleMessage(msg, file, session, handle, uri);
    });
  }

  private async handleMessage(
    msg: WebviewToHost,
    file: ConflictFile,
    session: MergeSession,
    handle: WebviewHandle,
    uri: string,
  ): Promise<void> {
    switch (msg.kind) {
      case 'ready':
        return;
      case 'accept': {
        // Toolbar "Accept all X" — full block resolve (other side auto-rejected).
        const resolution =
          msg.side === 'left'
            ? acceptLeft()
            : msg.side === 'right'
              ? acceptRight()
              : acceptBoth();
        this.apply.apply(session, msg.blockId, resolution);
        handle.postMessage({
          kind: 'blockResolved',
          blockId: msg.blockId,
          resolution: toResolutionDTO(session.getResolution(msg.blockId)),
        });
        return;
      }
      case 'acceptSide': {
        const block = file.blocks.find((b) => b.id === msg.blockId);
        if (!block) return;
        this.apply.acceptSide(session, block, msg.side);
        handle.postMessage({
          kind: 'blockResolved',
          blockId: msg.blockId,
          resolution: toResolutionDTO(session.getResolution(msg.blockId)),
        });
        return;
      }
      case 'reset':
        this.apply.reset(session, msg.blockId);
        handle.postMessage({ kind: 'blockResolved', blockId: msg.blockId, resolution: null });
        return;
      case 'reject': {
        const block = file.blocks.find((b) => b.id === msg.blockId);
        if (!block) return;
        this.apply.rejectSide(session, block, msg.side);
        handle.postMessage({
          kind: 'blockResolved',
          blockId: msg.blockId,
          resolution: toResolutionDTO(session.getResolution(msg.blockId)),
        });
        return;
      }
      case 'editResult':
        this.apply.apply(session, msg.blockId, manual(msg.lines));
        handle.postMessage({
          kind: 'blockResolved',
          blockId: msg.blockId,
          resolution: toResolutionDTO(session.getResolution(msg.blockId)),
        });
        return;
      case 'undo': {
        const result = session.undo();
        if (!result) return;
        handle.postMessage({
          kind: 'blockResolved',
          blockId: result.blockId,
          resolution: toResolutionDTO(result.resolution),
        });
        return;
      }
      case 'redo': {
        const result = session.redo();
        if (!result) return;
        handle.postMessage({
          kind: 'blockResolved',
          blockId: result.blockId,
          resolution: toResolutionDTO(result.resolution),
        });
        return;
      }
      case 'save':
        try {
          await this.save.run(uri, session);
          handle.postMessage({ kind: 'saved' });
          this.editor.showInfo('File saved without conflict markers.');
        } catch (e) {
          this.editor.showError((e as Error).message);
        }
        return;
      case 'runCommand':
        try {
          await this.initCtx.runCommand(msg.command, msg.args);
          handle.postMessage({ kind: 'commandResult', requestId: msg.requestId, ok: true });
        } catch (e) {
          handle.postMessage({
            kind: 'commandResult',
            requestId: msg.requestId,
            ok: false,
            error: (e as Error).message,
          });
        }
        return;
    }
  }
}

function shortName(uri: string): string {
  const parts = uri.split(/[\\/]/);
  return parts[parts.length - 1] ?? uri;
}

// Re-export for tests that previously imported fromResolutionDTO indirectly.
export { fromResolutionDTO };
