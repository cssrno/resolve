import { describe, it, expect } from 'vitest';
import { GitConflictParser } from '../../src/domain/parser/GitConflictParser';

describe('GitConflictParser', () => {
  const parser = new GitConflictParser();

  it('parses a simple 2-way conflict', () => {
    const content = [
      'function f() {',
      '<<<<<<< HEAD',
      '  return 1;',
      '=======',
      '  return 2;',
      '>>>>>>> branch',
      '}',
    ].join('\n');

    const file = parser.parse('mem://a', content);
    expect(file.blocks).toHaveLength(1);
    const block = file.blocks[0]!;
    expect(block.localLines).toEqual(['  return 1;']);
    expect(block.remoteLines).toEqual(['  return 2;']);
    expect(block.baseLines).toBeNull();
    expect(block.localLabel).toBe('HEAD');
    expect(block.remoteLabel).toBe('branch');
    expect(block.startLine).toBe(1);
    expect(block.endLine).toBe(5);
  });

  it('parses a 3-way diff3-style conflict with base section', () => {
    const content = [
      'a',
      '<<<<<<< HEAD',
      'local',
      '||||||| ancestor',
      'base',
      '=======',
      'remote',
      '>>>>>>> feature',
    ].join('\n');

    const file = parser.parse('mem://b', content);
    const block = file.blocks[0]!;
    expect(block.localLines).toEqual(['local']);
    expect(block.baseLines).toEqual(['base']);
    expect(block.remoteLines).toEqual(['remote']);
  });

  it('parses multiple blocks', () => {
    const content = [
      'h',
      '<<<<<<< HEAD',
      'A1',
      '=======',
      'B1',
      '>>>>>>> br',
      'm',
      '<<<<<<< HEAD',
      'A2',
      '=======',
      'B2',
      '>>>>>>> br',
      'f',
    ].join('\n');

    const file = parser.parse('mem://c', content);
    expect(file.blocks).toHaveLength(2);
    expect(file.blocks[0]!.localLines).toEqual(['A1']);
    expect(file.blocks[1]!.remoteLines).toEqual(['B2']);
  });

  it('returns empty blocks list for clean file', () => {
    const file = parser.parse('mem://d', 'no conflicts here\n');
    expect(file.blocks).toHaveLength(0);
  });

  it('detects CRLF EOL', () => {
    const file = parser.parse('mem://e', 'a\r\n<<<<<<< h\r\nx\r\n=======\r\ny\r\n>>>>>>> b\r\n');
    expect(file.eol).toBe('\r\n');
  });
});
