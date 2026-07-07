# Changelog

All notable changes to the Resolve extension are tracked here. The format
is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project follows [Semantic Versioning](https://semver.org/).

## [0.1.5] — 2026-07-07

### Changed

- **README & marketplace wording clarified.** The tagline is now
  "IntelliJ-style merge & diff tools for VSCode — an independent
  reimplementation of IntelliJ's merge & diff experience" (previously "The
  IntelliJ merge & diff tools, ported to VSCode"), and a trademark notice
  was added: this is an independent project, not affiliated with or endorsed
  by JetBrains s.r.o.; "IntelliJ" is used descriptively only.

## [0.1.4] — 2026-07-07

### Added

- **Palette / keybinding merge commands now act on the selected conflict.**
  `Resolve: Accept Left`, `Accept Right`, `Accept Both` and `Save Resolved
  File` were previously declared but unhandled; they now dispatch to the
  focused merge view and resolve the conflict block the cursor is in
  (falling back to the first conflict when none is selected).

### Changed

- **Command & setting namespace renamed** `conflict.*` → `resolve.*` so the
  command palette, context menus and settings match the extension's name.
  Commands are now `Resolve: Open Merge View`, `Resolve: Open Diff View`,
  etc.; the diff-viewer preference is `resolve.diffViewer.mode` (previously
  `conflict.diffViewer.mode`).
- Marketplace category narrowed to **SCM Providers** and a dark gallery
  banner added.

### Fixed

- Excluded local tooling files (`.claude/`, `.vscode-test.mjs`) from the
  published VSIX.
- Resolved `prefer-const` lint errors in the bezier overlays.

## [0.1.3] — 2026-06-07

### Changed

- Renamed the extension to **Resolve**, set the `cssrno` publisher, added
  the marketplace icon, screenshots and gallery metadata.
- Rewrote the README around the three headline surfaces (merge view, diff
  view, collapsed ranges).

## [0.1.1] — 2026-06-07

### Changed

- Pointed `repository`, `bugs` and `homepage` at the public GitHub repo.

## [0.1.0] — 2026-06-07

Initial public release.

### Added

- **3-pane merge view** (Local / Result / Remote) — IntelliJ-style conflict
  editor. Auto-opens on any file containing `<<<<<<<` / `=======` /
  `>>>>>>>` markers and supersedes VSCode's built-in `merge-conflict`
  CodeLenses. Bezier ribbons connect matched lines; per-side accept
  (chevron) + reject (cross) chevrons appear only on conflicting sides.
- **2-pane diff view** (HEAD ↔ working tree) — replaces VSCode's text
  diff editor when invoked from the SCM panel. Per-hunk revert + stage
  checkboxes; master "stage all" checkbox in the working column header;
  per-hunk debounced live save back to disk.
- **Collapse unchanged fragments** — toolbar toggle wraps every long
  unchanged context range into a single placeholder row with a "wave"
  band crossing the panes. Click a chip to expand that range. Detects
  when the user has expanded everything and re-arms the toggle.
- **Breadcrumb chips** — placeholder rows show `unchanged` chips that
  thicken the wave on hover and serve as the click target for expansion.
  Symbol-aware via VSCode's `DocumentSymbolProvider` when available.
- **Per-block actions** — `>>` accept-this-side chevron + `×` reject
  chevron, scoped to the conflicting side (no chevrons on already-
  resolved sides).
- **Smart-merge toolbar buttons** — "`Left`" / "`All`" / "`Right`"
  apply every non-conflicting block from one or both sides at once.
- **Live edit pipeline** (diff view) — typing in the working pane
  debounce-saves (300 ms) to disk and refreshes the diff; auto-unstages
  the file when the working tree returns to HEAD.
- **Synchronized scroll** with virtual section plan (toggleable).
- **Cursor-aware navigation** — clicking inside a conflict / hunk
  updates the prev / next anchor so the arrow buttons step from where
  the user is reading.
- **Git context header** — Local / Remote columns label the active
  rebase or merge (`Rebasing abc1234 from feature/foo` /
  `Already rebased commits and commits from origin/dev`).
- **Collapse-unchanged toggle icon** — chevrons flip direction (inward
  when fully collapsed, outward when one or more ranges are expanded).
- **Symbol-aware breadcrumb extraction** via VSCode's document symbol
  provider with a regex fallback for files in a non-parseable state
  (e.g. mid-merge).
