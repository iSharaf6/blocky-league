/** Friend rewards are permanent grants. Receipts travel with the wallet in local/cloud saves. */
export const FRIEND_REWARD = { coins: 1000, gems: 50 } as const;
export const FRIEND_LIMIT = 20;
export const FRIEND_WINDOW_DAYS = 30;
export const FRIEND_REWARD_LABEL = '1,000 coins + 50 gems';

export interface FriendReward { id: string; coins: number; gems: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A receipt is globally unique and cannot be reused when a different account signs in. */
export function normalizeFriendReceipts(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((s): s is string => typeof s === 'string' && UUID.test(s)).map((s) => s.toLowerCase()))] : [];
}

export function friendRewards(raw: unknown): FriendReward[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((r: unknown): FriendReward[] => {
    if (!r || typeof r !== 'object') return [];
    const grant = r as Partial<FriendReward>;
    if (typeof grant.id !== 'string' || !UUID.test(grant.id)) return [];
    const id = grant.id.toLowerCase();
    if (seen.has(id)) return [];
    if (!Number.isInteger(grant.coins) || grant.coins! < 0 || grant.coins! > FRIEND_REWARD.coins
      || !Number.isInteger(grant.gems) || grant.gems! < 0 || grant.gems! > FRIEND_REWARD.gems) return [];
    seen.add(id);
    return [{ id, coins: grant.coins!, gems: grant.gems! }];
  });
}
