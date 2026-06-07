import * as vscode from 'vscode';
import type { FileSystemPort } from '../domain/ports/FileSystemPort';

export class VSCodeFileSystem implements FileSystemPort {
  async read(uri: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
    return new TextDecoder('utf-8').decode(bytes);
  }

  async write(uri: string, content: string): Promise<void> {
    const bytes = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(vscode.Uri.parse(uri), bytes);
  }
}
