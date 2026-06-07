# Project rules — conflict-vscode

## Golden snapshot tests

**NEVER delete `test/unit/__snapshots__/*.snap` files.**

NEVER run `vitest -u` / `--update` either, unless I have FIRST inspected the
diff and confirmed (in writing, in the commit message or PR description) that
the semantic change is intentional and acceptable.

The golden test exists to lock the merge view's domain behavior. Mutating
the snapshot to make a failing test pass = breaking the contract = the test
no longer protects anything.

Correct workflow when a golden test fails:

1. Read the diff. Understand WHY the new output differs from the recorded one.
2. If the diff is unintended (whitespace, refactor changed formatting,
   accidental class rename, etc.) → fix the **code** so it produces the same
   output as the recorded snapshot. Do NOT touch `.snap`.
3. If the diff is a deliberate behavior change → update the snapshot
   explicitly with `vitest -u` AND commit it as a dedicated change with a
   message describing what changed and why. The snapshot diff in that commit
   is the audit trail.

If a test failure puzzles you, leave the snapshot alone and surface the diff
to the user.

## Domain as source of truth

All visual behavior of the merge view is derived from `src/webview/ui/Sections.ts`.
No renderer is allowed to reinvent rules — they call the exported predicates
(`isPaneOutlined`, `shouldShowActionButtons`, `shouldBezierBeDashed`,
`resolvedAccentFor`, `interlineMarkerFor`) and consume the `Section` objects.

If a visual rule needs to change:

1. Update `Sections.ts` (the domain).
2. Run goldens; review the diff.
3. Update goldens with explicit commit.

## Clean code

- No single-letter variables anywhere in `src/` or `test/`. Descriptive names
  even for loop indices (`lineIndexInSection`, `columnIndex`, etc.).
- Every constant has a name that explains it; raw magic numbers must be
  attached to a named CSS variable or a `const FOO_PX = …` declaration.
- Helper functions are extracted whenever a block of logic would otherwise
  need a comment to explain itself.
