import { SKILL_GOAL_COINS, streakMult } from '../core/save';

/** The same three-goal bonus ceiling used by skill-goal XP. */
export const MAX_REWARDED_SKILL_GOALS = 3;
export function skillGoalCoins(goals: number): number {
  return Number.isFinite(goals) ? Math.min(MAX_REWARDED_SKILL_GOALS, Math.max(0, Math.floor(goals))) * SKILL_GOAL_COINS : 0;
}

/** Fixed prizes and shop sales are paid once at face value; only the match fee earns multipliers. */
export function matchCoinPayout(
  reward: { coins: number; fixedCoins?: number },
  boosts: { streak: number; atmosphere: number; gradeBonus: number; doubler: boolean },
): { coins: number; matchCoins: number; fixedCoins: number; adBonus: number } {
  const whole = (n: number): number => Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const base = whole(reward.coins);
  const fixedCoins = Math.min(base, whole(reward.fixedCoins ?? 0));
  const fee = Math.round((base - fixedCoins) * (1 + Math.min(12, whole(boosts.atmosphere)) / 100));
  const grade = Number.isFinite(boosts.gradeBonus) ? Math.max(0, Math.min(0.1, boosts.gradeBonus)) : 0;
  const matchCoins = Math.round(fee * streakMult(whole(boosts.streak)) * (1 + grade) * (boosts.doubler ? 2 : 1));
  return { coins: matchCoins + fixedCoins, matchCoins, fixedCoins, adBonus: matchCoins };
}

/** Quick-match payouts: a result matters more than running up the score, and every completed loss still pays. */
export function standardCoinReward(my: number, their: number, difficulty: number): { coins: number; label: string } {
  const scored = Number.isFinite(my) ? Math.max(0, Math.floor(my)) : 0;
  const conceded = Number.isFinite(their) ? Math.max(0, Math.floor(their)) : 0;
  const factor = [0.8, 1, 1.25, 1.45][difficulty] ?? 1;
  const base = scored > conceded ? 110 : scored === conceded ? 60 : 35;
  return { coins: Math.round((base + Math.min(3, scored) * 12) * factor), label: scored > conceded ? 'WIN BONUS' : 'MATCH FEE' };
}
