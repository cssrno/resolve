export interface EditorPort {
  activeFileUri(): string | undefined;
  showInfo(message: string): void;
  showError(message: string): void;
}
