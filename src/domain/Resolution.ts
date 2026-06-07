export type SideDecision = 'accepted' | 'rejected';

export type Resolution =
  | { kind: 'sides'; left?: SideDecision; right?: SideDecision }
  | { kind: 'manual'; lines: readonly string[] };

export const acceptLeft = (): Resolution => ({ kind: 'sides', left: 'accepted', right: 'rejected' });
export const acceptRight = (): Resolution => ({ kind: 'sides', left: 'rejected', right: 'accepted' });
export const acceptBoth = (): Resolution => ({ kind: 'sides', left: 'accepted', right: 'accepted' });
export const manual = (lines: readonly string[]): Resolution => ({ kind: 'manual', lines });

export function isFullySidedResolution(resolution: Resolution): boolean {
  if (resolution.kind === 'manual') return true;
  return resolution.left !== undefined && resolution.right !== undefined;
}
