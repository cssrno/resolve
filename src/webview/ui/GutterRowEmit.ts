/**
 * Shared DOM helpers used by both gutter painters. The merge view and the
 * diff view each have their own loop (different section model, different
 * outline / marker logic) but the per-row DOM emission is identical: a
 * `.ln-row` div, fixed height, optional class names, optional dataset.
 */
export function clearAndGetGutterContent(columnId: string): HTMLElement {
  const gutterContent = document.querySelector(`#${columnId} .gutter-content`) as HTMLElement;
  gutterContent.innerHTML = '';
  return gutterContent;
}

export interface LnRowSpec {
  readonly classNames: readonly string[];
  readonly text: string;
  readonly lineHeightPx: number;
  readonly hunkId?: string;
  readonly dataAttributes?: Record<string, string>;
}

export function appendLnRow(parent: HTMLElement, spec: LnRowSpec): HTMLElement {
  const row = document.createElement('div');
  row.className = ['ln-row', ...spec.classNames].join(' ');
  row.style.height = `${spec.lineHeightPx}px`;
  row.style.lineHeight = `${spec.lineHeightPx}px`;
  row.textContent = spec.text;
  if (spec.hunkId) row.dataset.hunkId = spec.hunkId;
  if (spec.dataAttributes) {
    for (const [key, value] of Object.entries(spec.dataAttributes)) row.dataset[key] = value;
  }
  parent.appendChild(row);
  return row;
}
