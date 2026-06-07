import type { MonacoModule } from './loader';
import type { GrammarConfig } from '../../shared/protocol';

/**
 * Wires a TextMate grammar (the same one VSCode ships) into Monaco so the
 * tokenizer emits the exact scope chains the user's color-theme JSON expects.
 * Without this, Monaco's built-in tokenizer produces generic tokens
 * ("keyword", "string") that One Dark Pro et al. don't have rules for, and
 * the editor falls back to vs-dark colors.
 */
export async function applyGrammar(
  monaco: MonacoModule,
  monacoLanguageId: string,
  grammar: GrammarConfig | null,
  onigWasmUrl: string,
): Promise<void> {
  const langs = monaco.languages.getLanguages().map((l: { id: string }) => l.id);
  if (!langs.includes(monacoLanguageId)) {
    monaco.languages.register({ id: monacoLanguageId });
  }
  if (!grammar) return;

  const [vsctm, vsoni] = await Promise.all([
    import('vscode-textmate'),
    import('vscode-oniguruma'),
  ]);

  const wasmBuffer = await fetch(onigWasmUrl).then((r) => r.arrayBuffer());
  await vsoni.loadWASM(wasmBuffer);

  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources: string[]) => new vsoni.OnigScanner(sources),
      createOnigString: (s: string) => new vsoni.OnigString(s),
    }),
    loadGrammar: async (scopeName) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scopeName === grammar.scopeName ? (grammar.grammar as any) : null,
  });

  const tmGrammar = await registry.loadGrammar(grammar.scopeName);
  if (!tmGrammar) return;

  monaco.languages.setTokensProvider(monacoLanguageId, {
    getInitialState: () => new TMState(vsctm.INITIAL),
    tokenize: (line: string, state: TMState) => {
      const res = tmGrammar.tokenizeLine(line, state.stack);
      return {
        tokens: res.tokens.map((t) => ({
          startIndex: t.startIndex,
          // Monaco prefix-matches `scopes` against theme rules' tokens.
          // We join the textmate scope chain with spaces; Monaco picks
          // the most specific matching rule.
          scopes: t.scopes.slice().reverse().join('.'),
        })),
        endState: new TMState(res.ruleStack),
      };
    },
  });

  if (grammar.configuration) {
    monaco.languages.setLanguageConfiguration(monacoLanguageId, {
      comments: grammar.configuration.comments,
      brackets: grammar.configuration.brackets,
    });
  }
}

class TMState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public readonly stack: any) {}
  clone(): TMState { return new TMState(this.stack); }
  equals(other: TMState): boolean { return other.stack === this.stack; }
}

export function vscodeToMonacoLanguage(languageId: string): string {
  const aliases: Record<string, string> = {
    typescriptreact: 'typescript',
    javascriptreact: 'javascript',
  };
  return aliases[languageId] ?? languageId;
}
