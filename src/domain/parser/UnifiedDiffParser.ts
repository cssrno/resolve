/**
 * Parses the unified diff format produced by `git diff --no-color -U0` into
 * structured hunks. Only the hunk header (`@@ -a,b +c,d @@`) and the body
 * lines starting with `-` / `+` are consumed — file headers and metadata
 * lines are ignored because the caller already knows which file is being
 * diffed.
 *
 * `-U0` means zero context lines, so each hunk contains only changed lines.
 * That's intentional: it gives us a precise per-change unit we can stage or
 * revert individually via `git apply --unidiff-zero`.
 */
export interface UnifiedHunk {
  /** 1-based line number in the left ("a") side where this hunk starts. */
  readonly leftStartLine: number;
  /** 1-based line number in the right ("b") side where this hunk starts. */
  readonly rightStartLine: number;
  /** Lines removed from the left side (without leading `-`). */
  readonly leftLines: readonly string[];
  /** Lines added to the right side (without leading `+`). */
  readonly rightLines: readonly string[];
}

export class UnifiedDiffParser {
  parse(rawDiff: string): UnifiedHunk[] {
    const hunks: UnifiedHunk[] = [];
    if (rawDiff.length === 0) return hunks;
    const lines = rawDiff.split(/\r?\n/);
    let lineIndex = 0;
    while (lineIndex < lines.length) {
      const header = lines[lineIndex]!;
      const parsedHeader = parseHunkHeader(header);
      if (!parsedHeader) {
        lineIndex++;
        continue;
      }
      const bodyStart = lineIndex + 1;
      const bodyEnd = nextHunkOrEnd(lines, bodyStart);
      const { leftLines, rightLines } = splitHunkBody(lines.slice(bodyStart, bodyEnd));
      hunks.push({
        leftStartLine: parsedHeader.leftStartLine,
        rightStartLine: parsedHeader.rightStartLine,
        leftLines,
        rightLines,
      });
      lineIndex = bodyEnd;
    }
    return hunks;
  }
}

interface ParsedHeader {
  readonly leftStartLine: number;
  readonly rightStartLine: number;
}

/**
 * `@@ -a,b +c,d @@` — `b` and `d` are optional (default 1 when omitted).
 * With `-U0` git emits `-a,0` when no lines are removed (pure insertion)
 * and `+c,0` when nothing is added (pure deletion). Both edge cases are
 * tolerated.
 */
function parseHunkHeader(header: string): ParsedHeader | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!match) return null;
  return {
    leftStartLine: Number(match[1]),
    rightStartLine: Number(match[3]),
  };
}

function nextHunkOrEnd(lines: readonly string[], startIndex: number): number {
  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex++) {
    if (lines[lineIndex]!.startsWith('@@')) return lineIndex;
  }
  return lines.length;
}

function splitHunkBody(bodyLines: readonly string[]): {
  leftLines: string[];
  rightLines: string[];
} {
  const leftLines: string[] = [];
  const rightLines: string[] = [];
  for (const bodyLine of bodyLines) {
    if (bodyLine.startsWith('-')) leftLines.push(bodyLine.slice(1));
    else if (bodyLine.startsWith('+')) rightLines.push(bodyLine.slice(1));
    // ' '-prefixed context lines never appear at -U0; \ no-newline-at-EOF
    // markers are ignored.
  }
  return { leftLines, rightLines };
}
