# Architecture

## Process model

Two distinct JS contexts:

- **Extension host** (Node.js, `src/extension.ts` → `out/extension.js`):
  imports `vscode`, owns the `vscode.ExtensionContext`, reads the user's
  config / theme / keybindings, opens webview panels, dispatches commands.
- **Webview** (Chromium iframe, `src/webview/main.ts` → `out/webview/main.js`):
  loads Monaco, renders the merge UI, listens to user input, sends back
  messages over `postMessage`.

They never share memory. Communication is a discriminated union of messages
declared once in [`src/shared/protocol.ts`](../src/shared/protocol.ts).

```
┌─ Extension host ──────────────────────────────────────────────┐
│   GitConflictParser → DetectConflicts → MergeSession          │
│        ↑                                       ↓              │
│   VSCodeFileSystem    OpenMergeView      VSCodeWebview        │
│        ↑                    ↓               (postMessage)     │
│       fs                ApplyResolution         │             │
│                            ↓                    │             │
│                       SaveResolvedFile          │             │
│   Bridges: FontBridge, ThemeBridge,             │             │
│            KeybindingsBridge, GrammarBridge     │             │
└──────────────────────────────────────────────── │ ────────────┘
                                                   │
            ┌──────────────────────────────────────┘
            ▼
┌─ Webview ─────────────────────────────────────────────────────┐
│   HostBridge ↔ MergeApp                                       │
│                  ├─ ThemeApplier → Monaco.editor.defineTheme  │
│                  ├─ GrammarApplier → vscode-textmate → Monaco │
│                  ├─ KeybindingsApplier → editor.addCommand    │
│                  ├─ PaneTrio (3 Monaco editors)               │
│                  ├─ Sections (domain rules)                   │
│                  ├─ GutterPainter (ln-rows)                   │
│                  ├─ ConflictDecorations (Monaco overlays)     │
│                  ├─ BezierOverlay (SVG curves)                │
│                  ├─ ActionButtons (× / »)                     │
│                  └─ ScrollSync (virtual scroll)               │
└───────────────────────────────────────────────────────────────┘
```

## Layering (hexagonal)

```
extension.ts (composition root)
    │
    ├─ adapters/   ◄── concrete, depend on vscode + Monaco
    │     │
    │     └─ application/   ◄── use cases, depend only on domain ports
    │            │
    │            └─ domain/   ◄── pure, depends on nothing
```

### Rules

- `domain/` imports neither `vscode` nor DOM globals nor Monaco. Every domain
  module is unit-testable in plain Node without mocks.
- `application/` types its dependencies as **ports** (interfaces in
  `domain/ports/`). It receives concrete adapters from the composition root.
- `adapters/` implement ports. They are allowed to import `vscode`, talk to
  disk, etc.
- The composition root (`extension.ts`) wires concrete adapters to use
  cases. It is the only place that instantiates either.

### Why?

- Domain rules can evolve without touching VSCode plumbing.
- Adapters can be swapped (a CLI variant could ship a `NodeFileSystem`
  adapter instead of `VSCodeFileSystem`).
- Tests target the domain directly; the webview is exercised via the same
  data structures the renderers consume in production.

## Webview composition

`src/webview/ui/MergeApp.ts` is the composition root inside the webview.
Given a `MonacoModule`, a `HostBridge` and the `init` payload, it:

1. Applies the user's theme to Monaco.
2. Plugs the user's TextMate grammar into Monaco's tokenizer.
3. Creates a `PaneTrio` (three Monaco editors with line numbers, scrollbars
   and minimap disabled).
4. Registers every user keybinding on every editor.
5. Builds the `Section[]` for the current file via
   `Sections.buildSections()`.
6. Hands the sections to:
   - `GutterPainter.paint()` (rows in ln-cols, spacers, actions cells)
   - `ConflictDecorations.apply()` (Monaco whole-line decorations)
   - `BezierOverlay.render()` (SVG curves in pipes-cells)
   - `ActionButtons.render()` (× / » wraps)
7. Wires `ScrollSync` for shared vertical/horizontal scroll across the three
   editors + the gutter columns.

When the host sends `blockResolved`, MergeApp re-runs `buildSections()` from
the updated `ConflictFileDTO`, re-paints everything, and re-commits the
current scroll so editors and gutters stay aligned.

## Sections — the domain of the merge view

[`src/webview/ui/Sections.ts`](../src/webview/ui/Sections.ts) owns every
visual rule. Renderers don't reimplement logic; they query the section's
state via exported predicates.

### Public types

```ts
type PaneId      = 'local' | 'result' | 'remote';
type SectionKind = 'ctx' | 'conflict';
type ChangeType  = '' | 'add' | 'mod' | 'del' | 'conflict'
                 | 'result-resolved' | 'result-unresolved'
                 | 'resolved-outline';
type BlockClass  = 'conflict' | 'localAdd' | 'remoteAdd'
                 | 'localMod' | 'remoteMod' | 'localDel' | 'remoteDel';

interface Section {
  kind: SectionKind;
  blockId: string | null;
  blockClass: BlockClass | null;
  resolved: boolean;
  resolvedSides: Record<PaneId, boolean>;
  paneLineCount: Record<PaneId, number>;
  paneClass: Record<PaneId, ChangeType>;
}
```

### Public predicates

| Function                                           | What it answers                                 |
|----------------------------------------------------|--------------------------------------------------|
| `isPaneOutlined(section, pane)`                    | should a side render as dashed outline?         |
| `isBlockFullyResolved(section)`                    | has every pending side been handled?            |
| `shouldShowActionButtons(section, gutterEdge)`     | should the × / » wrap appear on this gutter?    |
| `shouldBezierBeDashed(section, gutterEdge)`        | should the bezier be dashed instead of filled?  |
| `resolvedAccentFor(blockClass)`                    | which color family for the dashed outline?      |
| `interlineMarkerFor(blockClass)`                   | color of the inter-line marker (deletion etc.)  |

### Classification

`classifyBlock(block)` reads `localLines`, `remoteLines` and `baseLines`:

| Conditions                                                          | BlockClass    |
|---------------------------------------------------------------------|---------------|
| `baseLines === null`                                                | `conflict`    |
| `local !== base && remote !== base`                                 | `conflict`    |
| `local !== base && base.length === 0`                               | `localAdd`    |
| `local !== base && local.length === 0`                              | `localDel`    |
| `local !== base` (otherwise)                                        | `localMod`    |
| `remote !== base && base.length === 0`                              | `remoteAdd`   |
| `remote !== base && remote.length === 0`                            | `remoteDel`   |
| `remote !== base` (otherwise)                                       | `remoteMod`   |

### Consumed-sides table

From `block.resolution`:

| Resolution kind                  | local consumed | remote consumed |
|----------------------------------|----------------|-----------------|
| `null`                           | false          | false           |
| `accept-left`                    | true           | false           |
| `accept-right`                   | false          | true            |
| `accept-both`                    | true           | true            |
| `manual`                         | true           | true            |

### Pane line counts

Computed by `computePaneLineCounts(block, blockClass, baseLineCount)`. The
non-changing side of a one-sided change shows the BASE content (so panes
stay vertically aligned with the changed side). Deletion's emptying side
shows zero rows; renderers paint an inter-line marker at the boundary.

### Pane color classes (`paneClass`)

`computeSidePaneClasses(blockClass, consumed)` looks up
`PANE_COLOR_BY_BLOCK_CLASS[blockClass]` and strips the color of any side
that has been consumed. The accepted side becomes transparent → the dashed
outline conveys the "accepted" state.

`computeResultPaneClass(blockClass, fullyResolved)` decides Result's tint:

- One-sided block unresolved → `add`/`mod`/`del` (pending colored band).
- Conflict unresolved → `result-unresolved` (red).
- Fully resolved → `''` (transparent + dashed outline).
- A conflict block is fully resolved only when BOTH sides are consumed
  (accept-both or manual). Accept-left alone leaves Result red.

## Renderers — how each one calls Sections

### GutterPainter

Walks `sections` per pane; emits one `<div class="ln-row">` per code line
into each of the gutter columns associated with that pane. Edge classes
(`resolved-outline-top` / `-bottom` / `-single`) come from a small helper
that reads `section.resolvedSides[pane]`. Inter-line markers
(`marker-bottom-*`) come from `interlineMarkerFor(section.blockClass)`
applied to the LAST emitted row before a zero-line section.

### ConflictDecorations

Generates Monaco `whole-line` decorations from the same `Section[]`. For
each pane and each section, it pushes:

- A color decoration `conflict-line-${paneClass}` covering the section's
  rows (with a `conflict-line-divided` variant on the first row of an
  adjacent same-color block).
- A marker decoration `conflict-marker-${interlineMarkerFor(blockClass)}`
  on the previous editor line when this section has zero rows.
- An outline decoration `conflict-line-resolved-outline-(top|bottom|single)`
  on each consumed-side row.

### BezierOverlay

Renders `<svg>` paths in `#pipes-left` and `#pipes-right`. For each conflict
section visible on that gutter:

- `isBezierDashedFor(section, fromSide)` decides whether to draw a filled
  trapezoid (pending) or two dashed curves (consumed).
- Zero-line sides are clamped to the inter-line marker thickness so the
  curve actually touches the trait rather than collapsing to a point.

### ActionButtons

Queries `[data-block-id]` on rows inside `actions-left` / `actions-right`,
then for each row decides whether to append a button wrap via
`shouldShowActionButtons(section, edge)` (which itself reads
`section.resolvedSides`).

## Scroll model

`ScrollSync` runs a **virtual scroll** across the three Monaco panes plus
the four gutter columns. Each conflict section has a virtual height equal
to the maximum of the per-pane heights. As the user wheels:

1. Compute `virtualY ← virtualY + deltaY`, clamp to `max(scrollHeight - viewportH)`
   across all panes.
2. For each pane, walk the section plan and produce the per-pane
   `actualY = sec.starts[pane] + min(delta, sec.heights[pane])`.
3. Apply `editor.setScrollTop(actualY)` to each Monaco editor and
   `transform: translateY(-actualY)` to each gutter column's `.gutter-content`.

This is the same insight IntelliJ uses: panes drift apart at change zones
(different line counts per side) but realign whenever the sections share a
common context boundary. The bezier visualizes the drift.

Horizontal scroll is synced separately via `editor.setScrollLeft` on all
three editors when a wheel event has `deltaX`.

## Theme & grammar bridges

### ThemeBridge

1. Reads `workbench.colorTheme` to get the theme label.
2. Walks `vscode.extensions.all` looking for a theme contribution whose
   `label` or `id` matches (case-insensitive, non-alphanumeric stripped).
3. Reads the theme JSON, follows `include` chains, parses with a JSONC
   stripper.
4. Returns `{ base, colors, tokenColors, name }` to the webview.

In the webview, `ThemeApplier`:

- Maps `tokenColors[].scope` to Monaco `rules[].token`.
- Pulls workbench colors from the JSON `colors` map AND from the CSS
  variables VSCode auto-injects into the webview (`--vscode-editor-*`).
- Calls `monaco.editor.defineTheme('conflict-user-theme', { … })` then
  `monaco.editor.setTheme('conflict-user-theme')`.

### GrammarBridge / GrammarApplier

The host finds the `.tmLanguage.json` file shipped by whichever extension
contributes the language. The webview pipes it through `vscode-textmate`
(with `vscode-oniguruma`'s WASM regex engine) and registers a custom
`monaco.languages.setTokensProvider` whose tokens carry the full TextMate
scope chain. This makes the user's theme `tokenColors` actually match
because Monaco prefix-matches `rule.token` against the scope chain.

### KeybindingsBridge / KeybindingsApplier

The host parses `~/.vscode/keybindings.json` (or the Code-Insiders / Cursor
/ VSCodium equivalents on Mac, Linux, Windows). Each entry's key string
(e.g. `cmd+shift+p`) is translated into a Monaco numeric keycode
(`KeyMod | KeyCode`). The webview registers an `editor.addCommand` on every
editor. Native Monaco commands fire locally; everything else is relayed to
the host as `runCommand` and dispatched via `vscode.commands.executeCommand`.

## File layout

```
fixtures/conflicts/           sample files for manual testing + golden
test/unit/                    vitest unit + golden tests
test/unit/__snapshots__/      DO NOT delete (see CLAUDE.md)
test/e2e/                     @vscode/test-electron suite
scripts/                      build helpers (Monaco / wasm asset copy)
out/                          esbuild output (host + webview + Monaco assets)
```

## Build pipeline

```
src/extension.ts          ──► esbuild ──► out/extension.js          (CJS, node18)
src/webview/main.ts       ──► esbuild ──► out/webview/main.js       (IIFE, browser)
src/webview/index.html    ──► copy   ──► out/webview/index.html
node_modules/monaco-editor/min/vs       ──► copy ──► out/webview/monaco/vs
node_modules/vscode-oniguruma/release/onig.wasm
                                        ──► copy ──► out/webview/monaco/onig.wasm
```

Run `npm run build` after pulling. The webview talks to the asset paths
through `webview.asWebviewUri()` resolved at the time the panel opens.
