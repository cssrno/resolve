import type { HostToWebview, WebviewToHost } from '../../shared/protocol';

export interface WebviewHandle {
  postMessage(msg: HostToWebview): void;
  onMessage(handler: (msg: WebviewToHost) => void): void;
  resolveAssetUri(relPath: string[]): string;
  dispose(): void;
}

export interface WebviewPort {
  open(title: string): WebviewHandle;
}
