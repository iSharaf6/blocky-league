import { describe, expect, it } from 'vitest';
import { LEGEND_STARS } from '../src/core/save';
import { difficultyLabels, playableDifficulty } from '../src/ui/difficulty';

declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');

const LABELS = ['EASY', 'NORMAL', 'HARD', 'LEGEND'];

describe('LEGEND is earned in Club Run, as in Quick Match', () => {
  it('until 10 match stars: LEGEND reads locked with the stars it takes, and a pick of it stays on HARD', () => {
    const p = { stars: LEGEND_STARS - 1 };
    const labels = difficultyLabels(LABELS, p);
    expect(labels.slice(0, 3)).toEqual(['EASY', 'NORMAL', 'HARD']);
    // A pixel lock (inline SVG), never an emoji, then the stars it takes.
    expect(labels[3]).toMatch(new RegExp(`^LEGEND <svg class="picon inl"[^>]*>.*</svg> ${LEGEND_STARS}★$`));
    expect(playableDifficulty(3, p)).toBe(2);
    for (const d of [0, 1, 2]) expect(playableDifficulty(d, p)).toBe(d);
  });

  it('earned: LEGEND reads plain and can be played', () => {
    const p = { stars: LEGEND_STARS };
    expect(difficultyLabels(LABELS, p)).toEqual(LABELS);
    expect(playableDifficulty(3, p)).toBe(3);
  });

  it('a damaged or out-of-range setting becomes a playable one', () => {
    expect(playableDifficulty(-2, { stars: 0 })).toBe(0);
    expect(playableDifficulty(9, { stars: 0 })).toBe(2);
    expect(playableDifficulty(9, { stars: 99 })).toBe(3);
    expect(playableDifficulty(Number.NaN, { stars: 0 })).toBe(0);
    expect(playableDifficulty(1.7, { stars: 0 })).toBe(1);
  });

  // (The BLOCKY CUP has no difficulty pick of its own any more: it is played inside ROAD TO GLORY, at the division's.)
  it('the run start card goes through the gate (and Quick Match words it the same way)', () => {
    for (const f of ['src/ui/run.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/difficultyLabels\(DIFFICULTIES, progress\)/);
      expect(src, f).toMatch(/let diff = playableDifficulty\(/);
      expect(src, f).toMatch(/if \(playableDifficulty\(i, progress\) !== i\) return;/);
    }
    expect(readFileSync('src/ui/menus.ts', 'utf8')).toContain("`${l} ${pixelIcon('lock', 'currentColor', 1.6, 'inl')} ${LEGEND_STARS}★`");
  });
});
