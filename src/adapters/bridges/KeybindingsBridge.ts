import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { KeybindingDTO } from '../../shared/protocol';

/**
 * Loads the user's keybindings.json (Code, Code - Insiders, VSCodium, Cursor)
 * and translates each entry's `key` into a Monaco keycode so the webview can
 * register them directly on every Monaco editor instance.
 *
 * NOTE: Monaco numeric keycodes are intentionally duplicated here as constants
 * to keep this module decoupled from the monaco-editor package — the host
 * never imports monaco.
 */
export class KeybindingsBridge {
  read(): KeybindingDTO[] {
    const file = this.locateUserKeybindingsFile();
    if (!file) return [];
    let entries: Array<{ key: string; command: string; when?: string }>;
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const stripped = this.stripJsonComments(raw);
      entries = JSON.parse(stripped);
    } catch {
      return [];
    }
    if (!Array.isArray(entries)) return [];

    return entries
      .filter((e) => typeof e.key === 'string' && typeof e.command === 'string')
      .map<KeybindingDTO>((e) => ({
        key: e.key,
        command: e.command,
        when: e.when,
        monacoKey: this.translate(e.key),
      }));
  }

  private locateUserKeybindingsFile(): string | null {
    const home = os.homedir();
    const candidates =
      process.platform === 'darwin'
        ? [
            path.join(home, 'Library/Application Support/Code/User/keybindings.json'),
            path.join(home, 'Library/Application Support/Code - Insiders/User/keybindings.json'),
            path.join(home, 'Library/Application Support/Cursor/User/keybindings.json'),
            path.join(home, 'Library/Application Support/VSCodium/User/keybindings.json'),
          ]
        : process.platform === 'win32'
          ? [
              path.join(process.env.APPDATA ?? '', 'Code/User/keybindings.json'),
              path.join(process.env.APPDATA ?? '', 'Code - Insiders/User/keybindings.json'),
              path.join(process.env.APPDATA ?? '', 'Cursor/User/keybindings.json'),
              path.join(process.env.APPDATA ?? '', 'VSCodium/User/keybindings.json'),
            ]
          : [
              path.join(home, '.config/Code/User/keybindings.json'),
              path.join(home, '.config/Code - Insiders/User/keybindings.json'),
              path.join(home, '.config/Cursor/User/keybindings.json'),
              path.join(home, '.config/VSCodium/User/keybindings.json'),
            ];
    return candidates.find((p) => fs.existsSync(p)) ?? null;
  }

  /**
   * Translate a VSCode-style key string (e.g. "cmd+shift+p") into a Monaco
   * numeric keycode (KeyMod | KeyCode bitfield). Returns null when any part
   * of the chord can't be mapped (chord sequences "X Y" are also rejected for
   * the v1; they require Monaco's chord API).
   */
  private translate(key: string): number | null {
    if (key.includes(' ')) return null; // chord — handled separately, skip for v1
    const tokens = key.toLowerCase().split('+').map((s) => s.trim());
    let mods = 0;
    let code = 0;
    for (const tok of tokens) {
      const mod = MOD_MAP[tok];
      if (mod !== undefined) {
        mods |= mod;
        continue;
      }
      const c = KEY_MAP[tok];
      if (c === undefined) return null;
      code = c;
    }
    if (!code) return null;
    return mods | code;
  }

  private stripJsonComments(input: string): string {
    return input
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1');
  }
}

// Monaco KeyMod (bit flags) — duplicated here to avoid pulling monaco into host.
// Reference: monaco-editor/esm/vs/editor/editor.api.d.ts
const MOD_MAP: Record<string, number> = {
  ctrl: 1 << 11, // CtrlCmd on mac is duplicated below
  cmd: 1 << 11, // CtrlCmd
  meta: 1 << 11,
  shift: 1 << 10,
  alt: 1 << 9,
  win: 1 << 8,
};

// Monaco KeyCode subset — covers the keys VSCode keybindings typically reference.
const KEY_MAP: Record<string, number> = {
  backspace: 1,
  tab: 2,
  enter: 3,
  shift: 4,
  ctrl: 5,
  alt: 6,
  pausebreak: 7,
  capslock: 8,
  escape: 9,
  space: 10,
  pageup: 11,
  pagedown: 12,
  end: 13,
  home: 14,
  left: 15,
  up: 16,
  right: 17,
  down: 18,
  insert: 19,
  delete: 20,
  '0': 21, '1': 22, '2': 23, '3': 24, '4': 25, '5': 26, '6': 27, '7': 28, '8': 29, '9': 30,
  a: 31, b: 32, c: 33, d: 34, e: 35, f: 36, g: 37, h: 38, i: 39, j: 40, k: 41, l: 42,
  m: 43, n: 44, o: 45, p: 46, q: 47, r: 48, s: 49, t: 50, u: 51, v: 52, w: 53, x: 54, y: 55, z: 56,
  meta: 57,
  contextmenu: 58,
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64, f7: 65, f8: 66, f9: 67, f10: 68, f11: 69, f12: 70,
  numlock: 78,
  scrolllock: 79,
  ';': 80,
  '=': 81,
  ',': 82,
  '-': 83,
  '.': 84,
  '/': 85,
  '`': 86,
  '[': 87,
  '\\': 88,
  ']': 89,
  "'": 90,
};
