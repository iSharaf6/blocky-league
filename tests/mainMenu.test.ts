import { describe, expect, it } from 'vitest';

// This game typechecks against browser types; these checks read the source with Node 22+.
declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');

/** The main menu, most important first (ui/menus.ts main(), src/style.css "round 14"). */
const ORDER = ['playnow', 'career', 'quick', 'club', 'cup', 'moments', 'run', 'blitz', 'online', 'settings'];
/** The grid-area name each tile is given in the stylesheet. */
const AREA: Record<string, string> = {
  playnow: 'play', career: 'road', quick: 'quick', club: 'club', cup: 'cup', moments: 'mom', run: 'run', blitz: 'blitz', online: 'online', settings: 'set',
};

describe('main menu: the most important things first', () => {
  it('draws PLAY NOW, ROAD TO GLORY, QUICK MATCH, MY CLUB, BLOCKY CUP, MOMENTS, CLUB RUN, BLITZ, ONLINE, SETTINGS in that order', () => {
    const src = readFileSync('src/ui/menus.ts', 'utf8');
    const start = src.indexOf('class="tiles t14');
    const end = src.indexOf('${daily}', start);
    expect(start).toBeGreaterThan(0);
    const order = [...src.slice(start, end).matchAll(/data-a="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(ORDER);
    // The two big tiles are the wide ones.
    const wide = [...src.slice(start, end).matchAll(/tile-wide[^"]*"[^>]*data-a="(\w+)"/g)].map((m) => m[1]);
    expect(wide).toEqual(['playnow', 'career']);
  });

  it('every grid shape of the stylesheet reads them in the same order, row by row', () => {
    const css = readFileSync('src/style.css', 'utf8');
    const from = css.indexOf('round 14: pixel icons');
    expect(from).toBeGreaterThan(0);
    const shapes = [...css.slice(from).matchAll(/\.tiles\.t14[^{]*\{[^}]*grid-template-areas:\s*((?:"[^"]*"\s*)+);/g)].map((m) => m[1]);
    expect(shapes.length).toBeGreaterThanOrEqual(4);
    for (const shape of shapes) {
      const seen: string[] = [];
      for (const tok of shape.match(/[a-z]+/g) ?? []) if (!seen.includes(tok)) seen.push(tok);
      const want = ORDER.map((k) => AREA[k]).filter((a) => seen.includes(a));
      expect(seen, shape).toEqual(want);
      // PLAY NOW and ROAD TO GLORY always lead; SETTINGS always closes.
      expect(seen.slice(0, 2)).toEqual(['play', 'road']);
      expect(seen[seen.length - 1]).toBe('set');
    }
  });

  it('keeps the lock logic, the daily card, HOW TO PLAY, the level bar, SHOP / coins and DAILY GIFT', () => {
    const src = readFileSync('src/ui/menus.ts', 'utf8');
    for (const part of ["lockable('career'", "lockable('moments'", "lockable('run'", "lockable('blitz'", 'data-a="howto"', 'data-a="gift"', 'data-a="shop"', 'lvl-bar', 'class="daily']) {
      expect(src, part).toContain(part);
    }
  });
});
