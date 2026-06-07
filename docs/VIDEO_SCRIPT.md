# Marketplace demo script

Single uninterrupted screen recording, no narration. Target length:
**80–100 seconds**. Resolution: 1920×1200 minimum, 30 fps, MP4 / H.264.
Each scene runs ~10 s; the cursor should hover briefly before each click
so the viewer can follow what's being clicked.

## Setup (one-off)

1. Clone a real-world repo with a long file (e.g. a WordPress plugin
   class with ~600 lines) into `/tmp/demo-repo` and make 3 commits.
2. Create a feature branch, change 5 small spots scattered across the
   file (one rename, one signature change, one body change, one
   addition, one deletion), commit.
3. From `main`, edit the same spots differently to force conflicts.
4. Run `git merge feature` so the file lands in a conflicted state.
5. Open VSCode against `/tmp/demo-repo` with the extension installed.
6. Settings → `conflict.diffViewer.mode: side-by-side`.

## Scenes

### Scene 1 — entry (0:00–0:10) — "It opens itself"

- Open the conflicted file from the file tree.
- The 3-pane merge view auto-mounts (no command palette needed).
- The Local / Result / Remote headers populate with the actual
  rebase / merge context (`Rebasing abc1234 from feature/...`).

### Scene 2 — conflict ribbons (0:10–0:25)

- Scroll through the file, showing the bezier ribbons connecting
  matched ranges across the three panes.
- Hover the `>>` chevron on one block; the cursor changes.
- Click `>>` on the Local side of a `localMod` block — Result
  pane snaps to that side; the chevron disappears.
- Click `<<` on a `remoteAdd` block — Remote content lands.

### Scene 3 — Smart-merge buttons (0:25–0:35)

- Open the toolbar: `Left` / `All` / `Right`.
- Hover each button; tooltips appear.
- Click `All` — every non-conflicting block resolves at once;
  remaining red trapezoids = true 3-way conflicts.

### Scene 4 — Collapse unchanged (0:35–0:55)

- Click the collapse toggle in the toolbar; chevrons flip inward.
- The continuous wave appears, traversing all three panes; long
  unchanged regions collapse into single placeholder rows.
- Hover a chip — wave thickens; tooltip shows `unchanged`.
- Click one chip — that range re-expands; the toggle icon
  switches to outward chevrons (no longer fully collapsed).
- Click the toggle again — everything re-collapses cleanly.

### Scene 5 — Switch to diff view (0:55–1:15)

- Open the SCM panel; click a modified-but-uncommitted file.
- The 2-pane diff view loads (instead of VSCode's text diff).
- Stage one hunk via the checkbox; the band's opacity changes.
- Click the master checkbox in the working column header — every
  hunk stages at once.
- Edit a line in the working pane; after 300 ms the diff
  refreshes (live edit pipeline).
- Click the `Jump to source` icon in the toolbar — the underlying
  file opens in a regular editor at the right line.

### Scene 6 — Outro (1:15–1:25)

- Return to the merge view.
- Resolve the last remaining conflict.
- Hit Save (or Cmd-S) — Result content writes back to disk;
  `Saved.` flashes in the status line.

## Assets needed

The marketplace listing expects the following media files in
`media/`. Replace the placeholders with real captures before
publishing:

| File | Purpose | Size |
|---|---|---|
| `media/icon.png` | Extension icon. | **128 × 128 PNG**, transparent background. |
| `media/banner.png` | README hero. | 1280 × 320 PNG. |
| `media/screenshot-merge.png` | 3-pane merge view, mid-resolution. | ≥ 1920 × 1080 PNG. |
| `media/screenshot-diff.png` | 2-pane diff with one staged + one unstaged hunk. | ≥ 1920 × 1080 PNG. |
| `media/screenshot-collapse.png` | Collapsed unchanged ranges with wave + chips. | ≥ 1920 × 1080 PNG. |
| `media/demo.mp4` | The full 80–100 s walkthrough. | H.264 MP4, ≤ 10 MB. |

The marketplace ignores anything not referenced from `README.md`,
so additional close-ups (e.g. a hover-state animation GIF) can be
added freely.
