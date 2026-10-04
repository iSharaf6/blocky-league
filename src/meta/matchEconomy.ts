/** Quick-match payouts: a result matters more than running up the score, and every completed loss still pays. */
export function standardCoinReward(my: number, their: number, difficulty: number): { coins: number; label: string } {
  const scored = Number.isFinite(my) ? Math.max(0, Math.floor(my)) : 0;
  const conceded = Number.isFinite(their) ? Math.max(0, Math.floor(their)) : 0;
  const factor = [0.8, 1, 1.25, 1.45][difficulty] ?? 1;
  const base = scored > conceded ? 110 : scored === conceded ? 60 : 35;
  return { coins: Math.round((base + Math.min(3, scored) * 12) * factor), label: scored > conceded ? 'WIN BONUS' : 'MATCH FEE' };
}
