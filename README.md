# Resolve — IntelliJ-style merge & diff for VSCode

> 3-way conflict resolution with bezier pipes, 2-pane diff viewer
> with per-hunk staging, IntelliJ-style "collapse unchanged
> fragments", live edits, breadcrumb chips, and rebase / merge
> context headers. All rendered inside a Monaco-backed webview.

## Demo

<video src="https://github.com/cssrno/resolve/raw/main/media/demo.mp4" controls width="800"></video>

> 90-second walkthrough of every feature — auto-opening merge view,
> bezier ribbons, smart-merge buttons, collapse-unchanged with the
> continuous wave, hover-to-thicken bands, hunk staging, live edits.

## Why

VSCode's stock merge editor handles the basics but stops short of
what JetBrains users get out of the box. This extension brings the
parts that matter most for real-world merges: **bezier ribbons
connecting matched ranges**, **per-side accept / reject chevrons**,
**collapsed unchanged blocks with hover-able breadcrumbs**, and
**actual rebase / merge context** in the column headers.

## Features

### 3-pane merge view

![Merge view](media/screenshot-merge.png)

- IntelliJ-style Local / Result / Remote layout with bezier
  ribbons connecting matched ranges.
- Auto-opens on any file containing `<<<<<<<` markers; replaces
  VSCode's `merge-conflict` CodeLenses.
- Per-side accept chevron (`>>`) and reject chevron (`×`),
  scoped to the conflicting side only.
- Toolbar `Left` / `All` / `Right` buttons apply every
  non-conflicting block from one or both sides at once.
- Synchronized scroll across the three panes with cursor-aware
  prev / next navigation.

### 2-pane diff view

![Diff view](media/screenshot-diff.png)

- HEAD ↔ working tree with the same bezier ribbons.
- Per-hunk revert chevron + stage / unstage checkbox.
- Master "stage-all" checkbox in the working column header.
- Live edits: typing in the working pane debounce-saves to disk
  and re-runs `git diff` (auto-unstages when the file matches
  HEAD again).
- Replaces VSCode's text diff editor when invoked from the SCM
  panel (toggle via the `conflict.diffViewer.mode` setting).

### Collapse unchanged fragments

![Collapse unchanged](media/screenshot-collapse.png)

- Toolbar toggle collapses every long unchanged context range
  into a single placeholder row crossed by a continuous wave
  that traverses all panes.
- Hover any segment of the wave (or the breadcrumb chip) to
  thicken the stroke; click the chip to expand that range.
- Re-arms the toggle automatically once the user has expanded
  every range; icon chevrons flip direction to reflect state.

### Symbol-aware breadcrumbs

The collapsed-range chip pulls labels from VSCode's
`DocumentSymbolProvider` (= the active language server) when
available — no custom parser, no false positives. Falls back to
a generic chip when the document is mid-merge or no language
extension is loaded.

### Git context headers

Local / Remote columns label the active rebase or merge,
straight from the working tree state:

- **Rebase:** `Rebasing abc1234` / `from feature/foo` on the
  local side, `Already rebased commits` / `and commits from
  origin/dev` on the remote.
- **Merge:** `Merging into <branch>` / `<hash>` vs.
  `Incoming <branch>` / `<hash>`.

## Install

From a packaged VSIX:

```bash
npm install
npm run build
npm run package   # outputs resolve-<version>.vsix
code --install-extension resolve-*.vsix
```

## Usage

- **Resolve a merge / rebase conflict:** open any file with
  `<<<<<<<` markers — the merge view opens automatically.
- **Inspect working-tree changes:** click a changed file in the
  SCM panel — the bezier diff view opens instead of VSCode's
  text diff (unless you set `conflict.diffViewer.mode` to
  `native`).
- **Stage / unstage hunks:** check the hunk's checkbox in the
  working column; the master checkbox toggles every hunk at
  once.
- **Collapse / expand unchanged ranges:** click the
  collapse toggle in the diff or merge toolbar; click a chip
  to re-expand a specific range.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `conflict.diffViewer.mode` | `side-by-side` | `side-by-side` = this extension's bezier diff; `native` = VSCode's built-in text diff editor. |

## Development

```bash
npm install
npm run build         # bundles host + webview
npm run test:unit     # vitest (parser, sections, goldens)
npm run typecheck     # tsc --noEmit
F5 in VSCode          # launches Extension Development Host
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/MERGE-VIEW.md](docs/MERGE-VIEW.md),
[docs/TESTING.md](docs/TESTING.md) for the internal layout, and
[docs/VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md) for the marketplace
demo walkthrough.

## License

MIT — see [LICENSE](LICENSE).
