import type { HostToWebview, WebviewToHost } from '../../shared/protocol';

export interface WebviewHandle {
  postMessage(msg: HostToWebview): void;
  onMessage(handler: (msg: WebviewToHost) => void): void;
  resolveAssetUri(relPath: string[]): string;
  /** Fires whenever the panel gains or loses active (focused) state, so
   *  the host can route palette commands to the merge view the user is
   *  currently looking at. */
  onDidChangeActive(handler: (active: boolean) => void): void;
  /** Fires once when the panel is closed. */
  onDidDispose(handler: () => void): void;
  dispose(): void;
}

export interface WebviewPort {
  open(title: string): WebviewHandle;
}
