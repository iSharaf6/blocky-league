/**
 * The career's GEM shortcuts (docs/ECONOMY.md, meta/gems.ts owns the wallet, the prices and the rules). Each is a
 * stated, guaranteed outcome, never a chance, and each has a free way to the same thing (waiting, playing):
 * - FINISH NOW: the part of the ground being built opens at once (GEM_PRICES.finishBuildPerMatchday a matchday left).
 * - HEAL NOW: an injured player is fit for the next match (GEM_PRICES.healPlayer).
 * - The SCOUTING NETWORK tiers (gems.ts SCOUT_NETWORKS): every academy intake from then on has a prospect of at
 *   least the tier's stars (meta/life.ts academyIntake reads the tier mirrored into the career by `syncNetwork`).
 * - REPLAY A LOST DECIDER lives in ui/career.ts (it needs the match that was just played).
 * Only meta/gems.ts's published API is called here.
 */
import type { SaveData } from '../core/save';
import { finishBuild, skipBuild, type CareerState } from './career';
import { addTimeline } from './events';
import { GEM_PRICES, buyScoutNetwork, finishBuildPrice, gems, scoutNetworkTier, spendGems, type GemBuyResult } from './gems';
import { partDef } from './ground';
import type { GrowPlayer } from './growth';

type GemSave = Pick<SaveData, 'gems'>;

/** Gems to open the part being built now (0 when nothing is going up). */
export function finishBuildCost(state: CareerState): number {
  const b = state.ground.building;
  return b ? finishBuildPrice(b.left) : 0;
}

/** FINISH NOW: pay the gems and the part opens at once. False (and nothing changes) when short, or nothing is building. */
export function finishBuildNow(state: CareerState, save: GemSave): boolean {
  const b = state.ground.building;
  if (!b) return false;
  const name = partDef(b.id).steps[b.level - 1]?.name ?? partDef(b.id).name;
  if (!spendGems(save, finishBuildPrice(b.left), 'finishBuild')) return false;
  finishBuild(state);
  addTimeline(state, `The ${name.toLowerCase()} was finished early`, 'flag', 'good');
  return true;
}

/** The free way (a rewarded ad, meta/loops.ts 'build'): one matchday off the build. Returns true when it helped. */
export function skipBuildMatchday(state: CareerState): boolean {
  return skipBuild(state);
}

/** HEAL NOW: the player is fit for the next match. False (and nothing changes) when short, or he isn't injured. */
export function healNow(state: CareerState, save: GemSave, playerId: string): boolean {
  const p = state.club?.squad.find((q) => q.id === playerId) as GrowPlayer | undefined;
  if (!p || !(p.inj && p.inj > 0)) return false;
  if (!spendGems(save, GEM_PRICES.healPlayer, 'healPlayer')) return false;
  p.inj = 0;
  addTimeline(state, `${p.name} was back on his feet at once`, 'medic', 'good');
  return true;
}

/** Bring the career's copy of the Scouting Network tier in step with the save's (gems.ts owns it). */
export function syncNetwork(state: CareerState, save: GemSave): void {
  state.staff.network = scoutNetworkTier(save);
}

/** Buy the next Scouting Network tier (gems.ts buyScoutNetwork), and tell the career. */
export function buyNetwork(state: CareerState, save: GemSave): GemBuyResult {
  const r = buyScoutNetwork(save);
  syncNetwork(state, save);
  return r;
}

/** The gem wallet, for the buttons. */
export function gemBalance(save: GemSave): number {
  return gems(save);
}
