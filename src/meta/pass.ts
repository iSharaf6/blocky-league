/**
 * The Club Pass (docs/ECONOMY.md): a second track on the monthly season (meta/season.ts), sold in the app's store
 * ('bl.pass', platform/iap.ts) for the month it is bought in. About 6,000 coins over the 30 tiers plus that month's
 * own sprint trail (tier 10) and goal explosion (tier 20), looks no one can buy with coins. Buying it late hands
 * over every tier already reached; nothing reached is ever lost (a month's unclaimed pass coins and looks carry
 * into the next). It is looks and coins only: nothing on the pitch, nothing random.
 */
import type { SaveData } from '../core/save';
import { PASS_BIG_COINS, SEASON_TIERS, passReward, rollSeason, seasonOf, seasonTier, unclaimedPassTiers } from './season';
import { grantItem, itemKey, shopItem, type ShopItem } from './shop';

/** Turn the pass on for the season running at `now` (a purchase). False if it was already on. */
export function activatePass(save: Pick<SaveData, 'season'>, now: Date = new Date()): boolean {
  const s = seasonOf(save, now);
  rollSeason(s, now);
  if (s.pass) return false;
  s.pass = true;
  return true;
}

/** The pass is on for the season running at `now`. */
export function passActive(save: Pick<SaveData, 'season'>, now: Date = new Date()): boolean {
  const s = seasonOf(save, now);
  rollSeason(s, now);
  return s.pass;
}

/** Everything one season's pass gives: its coins and its two looks (the offer card says so with real numbers). */
export function passTotals(id: string): { coins: number; items: ShopItem[] } {
  let coins = 0;
  const items: ShopItem[] = [];
  for (let t = 1; t <= SEASON_TIERS; t++) {
    const rw = passReward(t, id);
    coins += rw.coins;
    const it = rw.item && shopItem(rw.item.cat, rw.item.id);
    if (it) items.push(it);
  }
  return { coins, items };
}

/** The pass tiers worth calling out on the track (the looks and the big coin prizes). */
export const PASS_HIGHLIGHTS = [5, 10, 15, 20, 25, 30].filter((t) => t === 10 || t === 20 || PASS_BIG_COINS[t]);

/**
 * Claim pass tier t: its look is handed over now, its coins are returned for the caller to pay (as the free
 * track's claims are). Nothing when the pass is off, the tier isn't reached, or it was claimed.
 */
export function claimPassTier(save: Pick<SaveData, 'season' | 'shop'>, t: number): { coins: number; items: string[] } {
  const s = seasonOf(save);
  if (!s.pass || !Number.isInteger(t) || t < 1 || t > seasonTier(s.xp) || s.passClaimed.includes(t)) return { coins: 0, items: [] };
  s.passClaimed.push(t);
  s.passClaimed.sort((a, b) => a - b);
  const rw = passReward(t, s.id);
  const items = rw.item && grantItem(save, rw.item.cat, rw.item.id) ? [itemKey(rw.item.cat, rw.item.id)] : [];
  return { coins: rw.coins, items };
}

/** A past season's unclaimed pass looks, handed over now. */
export function claimCarryItems(save: Pick<SaveData, 'season' | 'shop'>): string[] {
  const s = seasonOf(save);
  const out: string[] = [];
  for (const key of s.carryItems) {
    const [cat, id] = key.split(':');
    if ((cat === 'goalfx' || cat === 'trail') && grantItem(save, cat, id)) out.push(key);
  }
  s.carryItems = [];
  return out;
}

/** Claim every reached pass tier and any carried looks at once. */
export function claimAllPass(save: Pick<SaveData, 'season' | 'shop'>): { coins: number; items: string[] } {
  const items = claimCarryItems(save);
  let coins = 0;
  for (const t of unclaimedPassTiers(seasonOf(save))) {
    const got = claimPassTier(save, t);
    coins += got.coins;
    items.push(...got.items);
  }
  return { coins, items };
}
