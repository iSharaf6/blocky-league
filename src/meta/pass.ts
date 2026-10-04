/**
 * The Club Pass (docs/ECONOMY.md): a second track on the monthly season (meta/season.ts), sold in the app's store
 * ('bl.pass', platform/iap.ts) for the month it is bought in, or bought with gems (buyPassWithGems). About 5,500
 * coins and 150 gems over the 30 tiers plus that month's six-piece identity: player look, sprint trail, premium kit,
 * goal explosion, diamond nets and a welcome star ceremony. None are sold for coins; past themes are permanent gem
 * collections. Buying it late hands over every tier already reached; nothing reached
 * is ever lost (a month's unclaimed pass coins, gems and looks carry into the next). It is looks, coins and gems
 * only: nothing on the pitch, nothing random.
 */
import type { SaveData } from '../core/save';
import { GEM_PRICES, PASS_GEMS, SEASON_GEMS, addGems, gems, grantGemsOnce, spendGems, sumGems, type GemBuyResult } from './gems';
import { SEASON_TIERS, passReward, rollSeason, seasonOf, seasonTier, unclaimedPassTiers } from './season';
import { equipItem, grantItem, itemKey, owns, seasonPassItems, shopItem, shopOf, type ShopItem } from './shop';
import { SEASON_THEMES, passItemId } from './season';

/** Turn the pass on for the season running at `now` (a purchase). False if it was already on. */
export function activatePass(save: Pick<SaveData, 'season'> & Partial<Pick<SaveData, 'shop'>>, now: Date = new Date()): boolean {
  const s = seasonOf(save, now);
  rollSeason(s, now);
  if (s.pass) return false;
  s.pass = true;
  // The ceremony is a permanent welcome reward, available straight away rather than after a dozen matches.
  if (save.shop || 'settings' in save) grantItem(save, 'decor', `kick${passItemId(s.id)}`);
  return true;
}

/** The pass is on for the season running at `now`. */
export function passActive(save: Pick<SaveData, 'season'>, now: Date = new Date()): boolean {
  const s = seasonOf(save, now);
  rollSeason(s, now);
  return s.pass;
}

/**
 * The Club Pass for gems instead of money (GEM_PRICES.clubPass): the same pass, for the season running at `now`.
 * Gems are earned by playing, so a keen free player can earn the pass and its looks too.
 */
export function buyPassWithGems(save: Pick<SaveData, 'season' | 'gems'> & Partial<Pick<SaveData, 'shop'>>, now: Date = new Date()): GemBuyResult {
  if (passActive(save, now)) return { ok: false, reason: 'maxed', short: 0 };
  const price = GEM_PRICES.clubPass;
  if (!spendGems(save, price, 'clubPass')) return { ok: false, reason: 'no-gems', short: price - gems(save) };
  activatePass(save, now);
  return { ok: true, price, gems: gems(save) };
}

/**
 * The season's gems (economy v3): a few on free tiers 10, 20 and 30 (SEASON_GEMS), more on six pass tiers
 * (PASS_GEMS). Paid once per tier CLAIMED, whichever way it was claimed (one tier, CLAIM ALL), plus what a past
 * season's reached tiers never paid. Returns the gems paid now (0 nearly always): call it after any claim.
 */
export function syncSeasonGems(save: Pick<SaveData, 'season' | 'gems'> & Partial<Pick<SaveData, 'shop'>>): number {
  const s = seasonOf(save);
  let paid = 0;
  for (const t of s.claimed) {
    const n = SEASON_GEMS[t];
    if (n && grantGemsOnce(save, `season:${s.id}:f${t}`, n, 'season')) paid += n;
  }
  for (const t of s.passClaimed) {
    const n = PASS_GEMS[t];
    if (n && grantGemsOnce(save, `season:${s.id}:p${t}`, n, 'pass')) paid += n;
  }
  const carry = Math.max(0, Math.floor(s.carryGems ?? 0));
  if (carry > 0) {
    addGems(save, carry, 'season');
    paid += carry;
  }
  delete s.carryGems;
  if (save.shop || 'settings' in save) syncSignatureEntitlements(save as Pick<SaveData, 'season' | 'shop' | 'gems'>);
  return paid;
}

/** Gems the pass track pays over a month, and the free track's (the offer card's numbers). */
export const PASS_TRACK_GEMS = sumGems(PASS_GEMS);
export const FREE_TRACK_GEMS = sumGems(SEASON_GEMS);

/** Everything one season's pass gives: its coins, its gems and its looks (the offer card says so with real numbers). */
export function passTotals(id: string): { coins: number; gems: number; items: ShopItem[] } {
  let coins = 0;
  const items: ShopItem[] = [];
  for (let t = 1; t <= SEASON_TIERS; t++) {
    const rw = passReward(t, id);
    coins += rw.coins;
    const it = rw.item && shopItem(rw.item.cat, rw.item.id);
    if (it) items.push(it);
  }
  return { coins, gems: PASS_TRACK_GEMS, items };
}

/** The pass tiers worth calling out on the track (the looks and the big coin prizes). */
export const PASS_HIGHLIGHTS = [1, 5, 10, 15, 20, 25, 30];

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
    if ((cat === 'goalfx' || cat === 'trail' || cat === 'kit' || cat === 'look' || cat === 'decor') && grantItem(save, cat, id)) out.push(key);
  }
  s.carryItems = [];
  return out;
}

/** Claim every reached pass tier and any carried looks at once. */
export function claimAllPass(save: Pick<SaveData, 'season' | 'shop'>): { coins: number; items: string[] } {
  const items = [...syncSignatureEntitlements(save), ...claimCarryItems(save)];
  let coins = 0;
  for (const t of unclaimedPassTiers(seasonOf(save))) {
    const got = claimPassTier(save, t);
    coins += got.coins;
    items.push(...got.items);
  }
  return { coins, items };
}

/** Add new signature rewards to existing paid/earned passes, without replaying a coin or gem payout. */
export function syncSignatureEntitlements(save: Pick<SaveData, 'season' | 'shop'> & Partial<Pick<SaveData, 'gems'>>): string[] {
  const out: string[] = [];
  const grant = (id: string) => { if (grantItem(save, 'decor', id)) out.push(`decor:${id}`); };
  const s = seasonOf(save);
  if (s.pass) {
    grant(`kick${passItemId(s.id)}`);
    if (s.passClaimed.includes(25)) grant(`net${passItemId(s.id)}`);
  }
  for (const key of [...shopOf(save).owned]) {
    const m = /^(?:kit|look|trail|goalfx):(pass\d{2})$/.exec(key);
    if (m) grant(`kick${m[1]}`);
  }
  // Old passes that already reached tier 28 have a durable gem receipt even after their season rolled over.
  for (const key of save.gems?.claimed ?? []) {
    const m = /^season:(\d{4}-\d{2}):p28$/.exec(key);
    if (m) { grant(`kick${passItemId(m[1])}`); grant(`net${passItemId(m[1])}`); }
  }
  return out;
}

/** A guaranteed six-piece identity, never a random pack and never purchasable with coins. */
export const SIGNATURE_SET_GEMS = GEM_PRICES.signatureCollection;
export interface SignatureSet { id: string; name: string; colour: string; items: ShopItem[] }
export function signatureSets(): SignatureSet[] {
  return SEASON_THEMES.map((theme, m) => ({ id: `pass${String(m + 1).padStart(2, '0')}`, name: theme.name, colour: theme.color,
    items: Object.values(seasonPassItems(`2000-${String(m + 1).padStart(2, '0')}`)) }));
}
export function signatureSet(id: string): SignatureSet | undefined { return signatureSets().find((s) => s.id === id); }
export function signatureMissing(save: Pick<SaveData, 'shop' | 'progress'>, set: SignatureSet): ShopItem[] {
  return set.items.filter((it) => !owns(save, it.cat, it.id));
}
export function signaturePrice(save: Pick<SaveData, 'shop' | 'progress'>, set: SignatureSet): number {
  return Math.ceil(SIGNATURE_SET_GEMS * signatureMissing(save, set).length / set.items.length);
}
/** The current month belongs to its Club Pass; other themed identities are permanent, with no rotating countdown. */
export function buySignatureSet(save: Pick<SaveData, 'season' | 'shop' | 'progress' | 'gems'>, id: string, now: Date = new Date()): GemBuyResult & { items?: ShopItem[] } {
  const set = signatureSet(id);
  if (!set || id === passItemId(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)) return { ok: false, reason: 'unknown', short: 0 };
  const items = signatureMissing(save, set);
  if (!items.length) return { ok: false, reason: 'maxed', short: 0 };
  const price = signaturePrice(save, set);
  if (!spendGems(save, price, `signature:${id}`)) return { ok: false, reason: 'no-gems', short: price - gems(save) };
  for (const it of items) grantItem(save, it.cat, it.id);
  return { ok: true, price, gems: gems(save), items };
}
/** Apply the complete identity together, preserving unrelated crest, ball, club progress and match strength. */
export function equipSignatureSet(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, id: string): boolean {
  const set = signatureSet(id);
  if (!set || signatureMissing(save, set).length) return false;
  for (const it of set.items) equipItem(save, it.cat, it.id);
  return true;
}
