import { describe, expect, it } from 'vitest';

declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');

/**
 * Quick Match writes its options (difficulty, half length, kick-off time, weather, mode) into save.settings as they're
 * tapped; BACK used to go straight to the menu without saving them, so a reload lost them. main.ts (which can't be
 * imported outside a browser: it boots WebGL) now saves on BACK. This pins the wiring.
 */
describe('Quick Match BACK', () => {
  it('saves the options before going back to the menu', () => {
    const src = readFileSync('src/main.ts', 'utf8');
    const fn = src.slice(src.indexOf('function quickMatch('), src.indexOf('function pickTime('));
    expect(fn).toMatch(/const back = \(\): void => \{\s*persist\(\);\s*mainMenu\(\);\s*\};/);
    expect(fn).toMatch(/menus\.quickMatch\(save, back,/);
  });
});
