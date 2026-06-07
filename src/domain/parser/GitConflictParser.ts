import type { ConflictBlock } from '../ConflictBlock';
import { createConflictBlock } from '../ConflictBlock';
import type { ConflictFile } from '../ConflictFile';

const START = /^<{7}\s?(.*)$/;
const BASE = /^\|{7}\s?(.*)$/;
const SEP = /^={7}\s*$/;
const END = /^>{7}\s?(.*)$/;

export class GitConflictParser {
  parse(uri: string, content: string): ConflictFile {
    const eol: '\n' | '\r\n' = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const blocks: ConflictBlock[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      const startMatch = START.exec(line);
      if (!startMatch) {
        i++;
        continue;
      }

      const startLine = i;
      const localLabel = startMatch[1]?.trim() ?? 'LOCAL';
      const localLines: string[] = [];
      const baseLines: string[] = [];
      const remoteLines: string[] = [];
      let remoteLabel = 'REMOTE';
      let hasBase = false;
      let phase: 'local' | 'base' | 'remote' = 'local';

      i++;
      while (i < lines.length) {
        const current = lines[i]!;

        if (BASE.test(current)) {
          phase = 'base';
          hasBase = true;
          i++;
          continue;
        }
        if (SEP.test(current)) {
          phase = 'remote';
          i++;
          continue;
        }
        const endMatch = END.exec(current);
        if (endMatch) {
          remoteLabel = endMatch[1]?.trim() ?? 'REMOTE';
          blocks.push(
            createConflictBlock({
              startLine,
              endLine: i,
              localLines,
              baseLines: hasBase ? baseLines : null,
              remoteLines,
              localLabel,
              remoteLabel,
            }),
          );
          i++;
          break;
        }

        if (phase === 'local') localLines.push(current);
        else if (phase === 'base') baseLines.push(current);
        else remoteLines.push(current);
        i++;
      }
    }

    return { uri, originalLines: lines, blocks, eol };
  }
}
