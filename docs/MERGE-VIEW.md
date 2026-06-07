# Merge view — visual rules

Every pixel in the merge view is derived from a `Section[]`. This document
describes the rules in human language; for the machine-readable source of
truth, read [`src/webview/ui/Sections.ts`](../src/webview/ui/Sections.ts).

## Layout

The webview is a 15-column CSS grid:

```
┌──────────────┬─┬───┬──┬──┬──┬──┬──────────────┬──┬──┬──┬──┬───┬─┬──────────────┐
│              │ │   │  │  │  │  │              │  │  │  │  │   │ │              │
│  pane-local  │S│ A │L │P │L │S │  pane-result │S │L │P │L │ A │S│  pane-remote │
│              │1│   │  │  │  │2 │              │1 │  │  │  │   │2│              │
│              │ │   │  │  │  │  │              │  │  │  │  │   │ │              │
└──────────────┴─┴───┴──┴──┴──┴──┴──────────────┴──┴──┴──┴──┴───┴─┴──────────────┘
   1fr  32 36 24 36 24 48     1fr   48 24 36 24 36 32   1fr
```

| Column        | id              | Role                                      |
|---------------|-----------------|-------------------------------------------|
| pane-local    | `#pane-local`   | Monaco editor for the local version       |
| S1            | `#space-l1`     | spacer (separator + color continuity)     |
| A             | `#actions-left` | × / » buttons                             |
| L             | `#ln-local`     | line numbers for local                    |
| P             | `#pipes-left`   | SVG bezier curves (local ↔ result)        |
| L             | `#ln-result-l`  | line numbers for result (left edge)       |
| S2            | `#space-l2`     | spacer (separator + color continuity)     |
| pane-result   | `#pane-result`  | Monaco editor for the merge result        |
| …mirrored…    |                 |                                           |
| pane-remote   | `#pane-remote`  | Monaco editor for the remote version      |

Column widths are deliberate multiples of 4px so the resolved-outline dotted
pattern (period 2px or 4px) stays aligned across cells.

## Vertical scroll

Each conflict section has a "virtual height" = `max(localH, resultH, remoteH)`.
The scroll model is virtual: every wheel event advances a `virtualY` counter
that is then mapped to per-pane `actualY` values. Panes with fewer rows in
a given section reach their content end earlier (and stay there) while panes
with more rows continue revealing content.

This is why the bezier curves slope: between two sections, the panes have
diverged by their height differential, and the bezier visualizes that
divergence.

## Color rules

| Block class   | Local pane     | Result pane (unresolved) | Remote pane    |
|---------------|----------------|--------------------------|----------------|
| `localAdd`    | green band     | green band               | empty          |
| `remoteAdd`   | empty          | green band               | green band     |
| `localMod`    | blue band      | blue band                | base content   |
| `remoteMod`   | base content   | blue band                | blue band      |
| `localDel`    | empty (trait)  | gray band                | base content   |
| `remoteDel`   | base content   | gray band                | empty (trait)  |
| `conflict`    | red band       | red band                 | red band       |

`empty` ⇒ the section contributes zero rows to that pane; renderers paint
an inter-line marker (a 3px colored stroke at the boundary between the rows
above and below) so the user sees WHERE the deletion / non-addition lands.

`base content` ⇒ the BASE lines (the common ancestor) are rendered without
tint — they remain visible because the unchanged side still has them.

## Resolution states

Pressing `»` sends an `accept-left` or `accept-right` resolution. Pressing
`×` sends a `reset`. There is no separate "manual" button yet — manual
resolutions arrive via direct edits to the Result pane.

### Single-state model

The domain stores ONE `Resolution` per block:
- `accept-left` ⇒ consumed sides = `{ local: true, remote: false }`
- `accept-right` ⇒ consumed sides = `{ local: false, remote: true }`
- `accept-both` ⇒ consumed sides = `{ local: true, remote: true }`
- `manual { lines }` ⇒ consumed sides = `{ local: true, remote: true }`

The visualization then derives:

- `isPaneOutlined(section, pane) = section.resolvedSides[pane]`
- `isBlockFullyResolved(section)`:
  - one-sided change → any accept suffices
  - conflict → BOTH sides must be consumed

A conflict in `accept-left` is therefore "half-resolved": Local switches to
dashed outline, Result still red, Remote still red. The user must click `»`
on Remote to commit the resolution (which currently flips the single
resolution to `accept-right`, conceptually replacing the previous choice
— see Limitations in the README).

### Pending vs accepted

| State          | Pane                  | Filled bg   | Dashed outline | Action buttons    |
|----------------|-----------------------|-------------|----------------|-------------------|
| Pending        | non-empty colored side | yes         | no             | shown on that gutter |
| Accepted       | consumed side          | no          | yes (color of block) | hidden       |
| Pending        | Result (unresolved)    | yes (red or change color) | no | n/a            |
| Fully resolved | Result                 | no          | yes            | n/a               |

### Bezier shape per state

- Pending block → filled trapezoid in the block's color.
- Accepted block side → two dashed curves (top + bottom edges, no fill).

## Inter-line marker

When a section contributes ZERO rows to a side (deletion, or the "empty"
half of a one-sided add / mod), the gutter row above gets a 3px colored
stroke at its bottom, and the Monaco line above gets a matching
`box-shadow inset 0 -3px 0 var(--*-fill)`. Both strokes sit at the same Y,
so they look like one continuous inter-line trait running across all
columns of the merge view.

The bezier endpoint on the zero-line side is clamped to the same 3px so the
wedge actually MEETS the trait rather than collapsing to a degenerate
point.

## Dashed outline (resolved blocks)

A resolved block's contribution to its consumed pane(s):

- ln-rows: top stroke on the first row, bottom stroke on the last row.
  Both via pseudo-elements with `background: repeating-linear-gradient(...)`
  in the block's accent color (green / blue / gray / red).
- Monaco line decorations: same idea via `box-shadow inset 0 ±2px 0 var(--*-fill)`.
- Bezier: two dashed SVG curves following the same Y as the top/bottom rows.

No vertical sides — the dashed marker is "horizontal frame" only.

When two adjacent same-color blocks are accepted, each block gets its own
top+bottom outline; their boundary is separated by a 2px CSS gap painted
over the start of the next block via `conflict-line-divided`.

## Action buttons

Each conflict block exposes two icons inside the `actions-*` columns:
- `»` chevron pointing toward Result → accept-left or accept-right.
- `×` cross → reset (remove the resolution).

The chevron always sits closer to the Result column. Buttons are placed at
the vertical center of the FIRST row of the block (the row carrying
`data-block-id`). They scroll with the rows because the wrap is appended
INSIDE the row.

A button is hidden when its corresponding side has been consumed
(`section.resolvedSides[pane] === true`), or when the block is a one-sided
change unrelated to that gutter (e.g. `localAdd` only shows actions on the
LEFT gutter).

## Color reference

| Token name           | Light intent       | Used in                                       |
|----------------------|--------------------|-----------------------------------------------|
| `--add-fill`         | rgba(60,200,100,0.16)  | green band on add / accept-(left or right) |
| `--mod-fill`         | rgba(80,150,240,0.16)  | blue band on mod                           |
| `--del-fill`         | rgba(160,160,160,0.32) | gray band on del                           |
| `--conflict-fill`    | rgba(230,80,80,0.18)   | red band on conflicts and unresolved Result|
| `--result-resolved-fill` | rgba(120,200,120,0.10) | currently unused — kept for type completeness |

Strokes (for dashed outlines and inter-line markers) use opacity 0.65–0.85
versions of the same hue so the trait sits above the band but in the same
color family.

All color values flow from `var(--*-fill)` in `index.html` so the user's
VSCode theme can override them (the host doesn't currently push theme
colors into our merge variables — the next step is to map them from
`editor.diff.add/remove.background` and similar VSCode color tokens).
