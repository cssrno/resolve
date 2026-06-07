import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { WebviewHandle, WebviewPort } from '../domain/ports/WebviewPort';
import type { HostToWebview, WebviewToHost } from '../shared/protocol';

export class VSCodeWebview implements WebviewPort {
  constructor(private readonly extensionUri: vscode.Uri) {}

  open(title: string): WebviewHandle {
    const monacoRoot = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'monaco');
    const panel = vscode.window.createWebviewPanel(
      'conflictMerge',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'), monacoRoot],
      },
    );

    panel.webview.html = this.renderHtml(panel.webview);

    return {
      postMessage: (msg: HostToWebview) => void panel.webview.postMessage(msg),
      onMessage: (handler: (msg: WebviewToHost) => void) => {
        panel.webview.onDidReceiveMessage((m) => handler(m as WebviewToHost));
      },
      resolveAssetUri: (relPath: string[]) =>
        panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', ...relPath)).toString(),
      dispose: () => panel.dispose(),
    };
  }

  private renderHtml(webview: vscode.Webview): string {
    const root = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview');
    const htmlPath = path.join(root.fsPath, 'index.html');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js'));

    // Monaco loads workers + AMD modules at runtime; we need a relaxed CSP.
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src ${webview.cspSource} 'unsafe-eval' blob:`,
      `worker-src ${webview.cspSource} blob:`,
      `connect-src ${webview.cspSource}`,
    ].join('; ');

    const template = fs.readFileSync(htmlPath, 'utf-8');
    return template
      .replace('{{CSP}}', csp)
      .replace('{{SCRIPT_URI}}', scriptUri.toString())
      .replace('{{CSP_SOURCE}}', webview.cspSource);
  }
}
