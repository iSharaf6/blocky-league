/**
 * The transfer market's FOR YOU sort (docs/UX.md "Do it for me"): the signings that most improve your starting XI
 * that you can actually afford, the weakest position first. Pure rules over ClubState and the market's listings; the
 * screen (ui/market.ts) shows the order and each player's "+N OVR" against the starter he would replace.
 */
import { FORMATIONS } from '../sim/formations';
import { overall, type PlayerDef, type Role } from '../sim/types';
import { SQUAD_MAX, type CareerState, type ClubState } from './career';
import { committed, wageBudget, type Listing } from './market';

/** What you can spend right now: coins, weekly wage room under the budget, and whether the squad has a free place. */
export interface TransferBudget {
  coins: number;
  wageRoom: number;
  squadRoom: boolean;
}

export interface Upgrade {
  /** The starter he would replace: the weakest of your XI in his position (null when nobody starts there). */
  starter: PlayerDef | null;
  /** His OVR minus that starter's (his whole OVR when nobody starts there). */
  gain: number;
}

/** Your budget for a signing: coins in hand, wage room once live offers are counted, and squad room. */
export function transferBudget(state: CareerState, coins: number): TransferBudget {
  const c = committed(state);
  const budget = wageBudget(state.season?.division ?? 6, state.stadium);
  return { coins: Math.max(0, coins), wageRoom: budget - c.wages, squadRoom: c.players < SQUAD_MAX };
}

/** The XI players lined up in a `role` slot (formation slot order: the first 11 of the squad start). */
function startersAt(club: ClubState, role: Role): PlayerDef[] {
  const slots = FORMATIONS[club.formation] ?? [];
  const out: PlayerDef[] = [];
  slots.forEach((s, i) => {
    const p = club.squad[i];
    if (p && s.role === role) out.push(p);
  });
  return out;
}

/** The starter a `role` signing would replace: the weakest of the XI in that position (null when nobody starts there). */
export function replacedStarter(club: ClubState, role: Role): PlayerDef | null {
  let worst: PlayerDef | null = null;
  for (const p of startersAt(club, role)) if (!worst || overall(p) < overall(worst)) worst = p;
  return worst;
}

/** How much `p` would lift your XI: his OVR against the starter he would replace. */
export function upgradeOf(club: ClubState, p: PlayerDef): Upgrade {
  const starter = replacedStarter(club, p.role);
  return { starter, gain: overall(p) - (starter ? overall(starter) : 0) };
}

/** Can the club sign him at his asking price today (coins, wages and a squad place)? */
export function canAfford(l: Listing, b: TransferBudget): boolean {
  return b.squadRoom && l.asking <= b.coins && l.wage <= b.wageRoom;
}

/**
 * How far each position's weakest starter sits below the XI's average OVR (0 when at or above it). The weakest
 * position has the biggest gap.
 */
export function positionGaps(club: ClubState): Record<Role, number> {
  const xi = club.squad.slice(0, 11);
  const avg = xi.length ? xi.reduce((s, p) => s + overall(p), 0) / xi.length : 0;
  const gap = (r: Role) => {
    const s = replacedStarter(club, r);
    return s ? Math.max(0, avg - overall(s)) : avg;
  };
  return { GK: gap('GK'), DF: gap('DF'), MF: gap('MF'), FW: gap('FW') };
}

/**
 * FOR YOU: listings you can afford before those you can't; among them real upgrades first, scored by the OVR gained
 * over the starter he'd replace plus half the gap his position sits below your XI's average (so the weakest
 * position wins a close call); ties go to the cheaper player. Players who wouldn't start follow, best first.
 */
export function forYouSort(list: readonly Listing[], club: ClubState, budget: TransferBudget): Listing[] {
  const gaps = positionGaps(club);
  const rank = list.map((l) => {
    const up = upgradeOf(club, l.player);
    return { l, ok: canAfford(l, budget), better: up.gain > 0, score: up.gain + 0.5 * gaps[l.player.role], ovr: overall(l.player) };
  });
  rank.sort(
    (a, b) =>
      Number(b.ok) - Number(a.ok) ||
      Number(b.better) - Number(a.better) ||
      (a.better ? b.score - a.score : b.ovr - a.ovr) ||
      a.l.asking - b.l.asking ||
      (a.l.id < b.l.id ? -1 : a.l.id > b.l.id ? 1 : 0),
  );
  return rank.map((r) => r.l);
}
