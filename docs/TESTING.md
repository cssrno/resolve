# Testing

## Unit + golden tests

```bash
npm run test:unit        # vitest, 29 tests, 11 snapshots
```

Located under `test/unit/`. Three categories:

### Domain tests

`GitConflictParser.test.ts`, `MergeSession.test.ts`, `ApplyResolution.test.ts`,
`SaveResolvedFile.test.ts` — pure domain behavior. Fast (≤10ms total).

### Golden — section/text pipeline

`Golden.test.ts` parses `fixtures/conflicts/golden.ts` through the full
domain pipeline (`GitConflictParser → toFileDTO → MergeSession`) and
snapshots:

- Block count (inline snapshot).
- Per-block classification + pane line counts + pane class.
- For each of 5 resolution scenarios (`unresolved`,
  `accept-left-everywhere`, `accept-right-everywhere`,
  `accept-both-everywhere`, `mixed-per-block`):
  - The full `Section[]` (`blockClass`, `resolved`, `resolvedSides`,
    `paneClass`, `paneLineCount`).
  - The line count produced for each pane by `paneTextsFromSections`.

### Golden — full HTML rendering

`Html.golden.test.ts` (`@vitest-environment jsdom`) mounts the production
DOM layout, runs the SAME renderers the webview runs in production
(`GutterPainter`, `ActionButtons`, `BezierOverlay`) with stubbed Monaco
editors, and snapshots `#app.outerHTML` per resolution scenario.

Layout reads (`offsetTop`, `offsetHeight`, `getBoundingClientRect`,
`getTopForLineNumber`) are stubbed with deterministic, fixture-driven
values so the snapshot stays reproducible across machines.

## The snapshot contract

The 11 snapshots in `test/unit/__snapshots__/` are the **load-bearing** part
of this test suite. They lock the visible merge-view behavior:

- which class lands on which row,
- which decoration lands on which Monaco line,
- which SVG path is emitted for which bezier,
- which button wrap is appended (or skipped) per gutter,
- which line numbers appear per pane in each scenario.

### Workflow on a snapshot failure

1. Read the diff. Vitest prints it; use `npx vitest run test/unit/Html.golden.test.ts --reporter=verbose` to see full context.
2. Decide:
   - **Unintended drift** (cosmetic, refactor changed whitespace, refactor
     altered class string order, etc.) → fix the **code** so it produces
     the same output as the recorded snapshot. Leave the `.snap` file
     alone.
   - **Intended behavior change** → update with `vitest -u` in a dedicated
     commit. The diff in that commit is the audit trail. Reviewers must
     read the snapshot diff before approving.
3. NEVER `rm .snap` to make CI green. The snapshot is the contract; if you
   delete it, you've deleted the contract.

See [`../CLAUDE.md`](../CLAUDE.md) for the project-wide rule.

## E2E tests

```bash
npm run test:e2e         # requires `npm run build` first
```

Uses `@vscode/test-electron` to launch a real VSCode and exercise the
extension commands end to end. The current suite is minimal (smoke test
that the extension loads and the `Conflict: Open Merge View` command is
registered). Extend as new commands are added.

## Manual testing

`fixtures/conflicts/` contains hand-crafted samples covering every case:

- `simple-2way.txt` — minimal 2-way conflict.
- `three-way.txt` — 2-way conflict with diff3 context.
- `multi-hunk.txt` — multiple adjacent blocks.
- `realistic.ts` — 2-way conflicts in a realistic TypeScript file.
- `diff3-realistic.ts` — same realistic file but with diff3 markers so
  every classification branch (`localAdd`, `remoteMod`, `localDel`, …) is
  exercised.
- `golden.ts` — the canonical fixture used by both golden test files.
  Adding a new BlockClass or visual rule MUST extend this file.

Workflow:

1. `npm run build`
2. Open the project folder in VSCode (or Cursor / VSCodium).
3. F5 → Extension Development Host opens.
4. In the dev host window, open one of the fixtures.
5. Cmd+Shift+P → `Conflict: Open Merge View`.

## Test infrastructure

- vitest with two environments: `node` (default) and `jsdom`
  (the `Html.golden.test.ts` file only). Set per-file via the
  `@vitest-environment jsdom` directive AND via
  `vitest.config.ts → environmentMatchGlobs`.
- `jsdom` doesn't compute real layout, so the HTML golden test installs
  stubs for `offsetTop`, `offsetHeight`, `Element#getBoundingClientRect`.
  Stubbing happens in `beforeAll` so it applies to every scenario.
- `PaneTrio` is stubbed because instantiating Monaco in jsdom requires the
  AMD loader + worker plumbing — too heavy for unit tests. The stub's
  `getTopForLineNumber(n)` returns `(n - 1) * 18` so coordinates are
  deterministic.
