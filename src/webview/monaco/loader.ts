// Loads Monaco at runtime via its AMD loader. We deliberately avoid bundling
// Monaco into our webview bundle so workers/web-workers resolve correctly
// against the same asset root the host served from `out/webview/monaco/vs`.

export interface MonacoModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  languages: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  KeyCode: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  KeyMod: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Uri: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Range: any;
}

interface AmdRequire {
  (deps: string[], cb: (...mods: unknown[]) => void): void;
  config(opts: { paths: Record<string, string>; 'vs/nls'?: { availableLanguages?: Record<string, string> } }): void;
}

declare global {
  // The monaco AMD module is exposed on window after the loader resolves.
  interface Window {
    require?: AmdRequire;
    monaco?: MonacoModule;
  }
}

export async function loadMonaco(baseUri: string): Promise<MonacoModule> {
  if (window.monaco) return window.monaco;

  await injectScript(`${baseUri}/loader.js`);
  const req = window.require;
  if (!req) throw new Error('Monaco AMD loader did not register window.require');
  req.config({ paths: { vs: baseUri } });

  // Workers need a same-origin trampoline. We embed a small JS in a Blob URL
  // that imports the Monaco worker scripts from our webview asset root.
  window.MonacoEnvironment = {
    getWorkerUrl: (_moduleId: string, label: string) => {
      const workerPath = label === 'json'
        ? `${baseUri}/language/json/json.worker.js`
        : label === 'css' || label === 'scss' || label === 'less'
          ? `${baseUri}/language/css/css.worker.js`
          : label === 'html' || label === 'handlebars' || label === 'razor'
            ? `${baseUri}/language/html/html.worker.js`
            : label === 'typescript' || label === 'javascript'
              ? `${baseUri}/language/typescript/ts.worker.js`
              : `${baseUri}/editor/editor.worker.js`;
      const blob = new Blob(
        [
          `self.MonacoEnvironment = { baseUrl: '${baseUri}/' };` +
            `importScripts('${workerPath}');`,
        ],
        { type: 'application/javascript' },
      );
      return URL.createObjectURL(blob);
    },
  };

  return new Promise<MonacoModule>((resolve, reject) => {
    req(['vs/editor/editor.main'], () => {
      if (window.monaco) resolve(window.monaco);
      else reject(new Error('Monaco failed to load'));
    });
  });
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}
