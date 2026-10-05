/**
 * The owner: "i'm not happy with the half time menu, looks weird asf and out of place". Half time is now full time's
 * sibling on the same shell: the score with both crests, the best player, four key numbers as two-sided bars, one
 * row of quick actions and the big SECOND HALF. (tests/presentation.test.ts keeps every function working.)
 */
import { describe, expect, it } from 'vitest';

declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');

const menus = readFileSync('src/ui/menus.ts', 'utf8');
const css = readFileSync('src/ui/menus.css', 'utf8');
const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  expect(i, a).toBeGreaterThanOrEqual(0);
  return s.slice(i, j < 0 ? undefined : j);
};

describe('the half time screen', () => {
  const half = between(menus, '  halftime(m: Match', '  fulltime(\n');
  const bars = between(menus, '  private halfStats(', '  private scoreHeader(');

  it('is built like full time: the same shell, the score header, a dark best player block', () => {
    expect(half).toContain('panel mc shell ft-panel ht-panel');
    expect(half).toContain('this.scoreHeader(m, kits)');
    expect(half).toContain('ft-motm ht-best');
    expect(half).toContain('BEST PLAYER');
    expect(half).toContain('class="mc-body ft-body ht-body"');
  });

  it('shows four key numbers as two-sided bars, each side in its shirt colour', () => {
    for (const k of ['POSSESSION', 'SHOTS', 'ON TARGET', 'PASSES']) expect(bars, k).toContain(`'${k}'`);
    expect((bars.match(/\brow\('/g) ?? []).length).toBe(4);
    expect(bars).toContain('kits[0].shirt');
    expect(bars).toContain('kits[1].shirt');
  });

  it('keeps the quick actions in one row, SECOND HALF the only big button', () => {
    expect(half).toMatch(/<div class="hf-quick">\$\{quick\}<\/div>\s*<button class="btn btn-go btn-lg" data-a="go">SECOND HALF/);
    for (const a of ['tactics', 'howto', 'settings', 'quit']) expect(half, a).toContain(`data-a="${a}"`);
    expect(css).toContain('.hf-quick');
  });

  it('draws no dots, dashes or emojis in its words', () => {
    const text = half + bars;
    for (const bad of ['·', '●', '—', '–']) expect(text.includes(bad), bad).toBe(false);
  });
});
