export interface FileSystemPort {
  read(uri: string): Promise<string>;
  write(uri: string, content: string): Promise<void>;
}
