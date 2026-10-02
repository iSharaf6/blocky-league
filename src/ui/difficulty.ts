/**
 * LEGEND is earned (LEGEND_STARS match stars: core/save.ts legendUnlocked), wherever a difficulty is picked: Quick
 * Match (ui/menus.ts), the Blocky Cup entry (ui/cup.ts) and the Club Run start card (ui/run.ts) show it the same
 * way, "LEGEND 🔒 10★" until then, and a pick of it does nothing.
 */
import { LEGEND_STARS, legendUnlocked, type Progress } from '../core/save';

/** The index of LEGEND in DIFFICULTIES (EASY, NORMAL, HARD, LEGEND). */
export const LEGEND_IDX = 3;

/** The difficulty buttons' words: LEGEND carries its lock and the stars it takes until it's earned. */
export function difficultyLabels(labels: readonly string[], p: Pick<Progress, 'stars'>): string[] {
  const ok = legendUnlocked(p);
  return labels.map((l, i) => (i === LEGEND_IDX && !ok ? `${l} 🔒 ${LEGEND_STARS}★` : l));
}

/** A difficulty this save may play (0..3): LEGEND drops to HARD until it's earned (an old save sitting on it too). */
export function playableDifficulty(want: number, p: Pick<Progress, 'stars'>): number {
  const d = Math.max(0, Math.min(LEGEND_IDX, Math.floor(Number.isFinite(want) ? want : 0)));
  return d === LEGEND_IDX && !legendUnlocked(p) ? LEGEND_IDX - 1 : d;
}
