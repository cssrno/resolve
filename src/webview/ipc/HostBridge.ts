import type { HostToWebview, WebviewToHost } from '../../shared/protocol';

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export class HostBridge {
  private readonly api: VsCodeApi;
  private readonly handlers = new Set<(msg: HostToWebview) => void>();
  private nextId = 1;
  private readonly pending = new Map<string, (ok: boolean, error?: string) => void>();

  constructor() {
    this.api = acquireVsCodeApi();
    window.addEventListener('message', (e) => {
      const msg = e.data as HostToWebview;
      if (msg.kind === 'commandResult') {
        const pending = this.pending.get(msg.requestId);
        if (pending) {
          this.pending.delete(msg.requestId);
          pending(msg.ok, msg.error);
        }
        return;
      }
      this.handlers.forEach((h) => h(msg));
    });
  }

  send(msg: WebviewToHost): void {
    this.api.postMessage(msg);
  }

  on(handler: (msg: HostToWebview) => void): void {
    this.handlers.add(handler);
  }

  runCommand(command: string, args?: unknown[]): Promise<void> {
    const requestId = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, (ok, error) => {
        if (ok) resolve();
        else reject(new Error(error ?? 'command failed'));
      });
      this.api.postMessage({ kind: 'runCommand', requestId, command, args });
    });
  }
}
