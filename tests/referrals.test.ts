import { describe, expect, it, vi } from 'vitest';
import { defaultSave, importSave } from '../src/core/save';
import { normalizeCloud } from '../src/platform/cloud';
import { FRIEND_REWARD, friendRewards, normalizeFriendReceipts } from '../src/meta/referrals';
import { inviteMessage } from '../src/platform/invite';
import { referralRequest, type ReferralServices } from '../supabase/functions/_shared/referral';

const id = '12a99bde-a1bc-4a2e-b197-e304dcba9855';
const reward = { id, ...FRIEND_REWARD };
const services = () => ({
  collect: vi.fn<ReferralServices['collect']>(async () => ({ rewards: [reward], friends: 1, claimed: false })),
  claim: vi.fn<ReferralServices['claim']>(async () => ({ ok: true })),
  rate: vi.fn<ReferralServices['rate']>(async () => true),
});

describe('durable friend reward protocol', () => {
  it('rejects unauthenticated and legacy calls before any reward or rate-limit operation', async () => {
    const api = services();
    expect(await referralRequest({ protocol: 2, action: 'collect' }, null, api)).toMatchObject({ status: 401 });
    for (const action of ['claim', 'collect']) {
      expect(await referralRequest({ action, code: 'ABC2345' }, 'player', api)).toEqual({ status: 409, body: { error: 'update_required' } });
    }
    expect(api.collect).not.toHaveBeenCalled();
    expect(api.claim).not.toHaveBeenCalled();
    expect(api.rate).not.toHaveBeenCalled();
  });
  it('uses the verified user, never an injected identity or reward amount', async () => {
    const api = services();
    await referralRequest({ action: 'collect', protocol: 2, userId: 'victim' }, 'player', api);
    expect(api.collect).toHaveBeenCalledWith('player');
    await referralRequest({ action: 'claim', protocol: 2, userId: 'victim', code: ' abc2345 ', coins: 100000 }, 'player', api);
    expect(api.claim).toHaveBeenCalledWith('player', 'ABC2345');
  });
  it('rate limits claims before looking up a code and rejects malformed codes', async () => {
    const api = services();
    api.rate.mockResolvedValueOnce(false);
    expect(await referralRequest({ action: 'claim', protocol: 2, code: 'ABC2345' }, 'player', api)).toMatchObject({ status: 429 });
    for (const code of ['ABC0123', 'ZZ', {}, null]) {
      expect(await referralRequest({ action: 'claim', protocol: 2, code }, 'player', api)).toMatchObject({ status: 404 });
    }
    expect(api.claim).not.toHaveBeenCalled();
  });
  it('returns existing claims as success so an interrupted claim can recover', async () => {
    const api = services();
    api.claim.mockResolvedValue({ ok: true, existing: true });
    expect(await referralRequest({ action: 'claim', protocol: 2, code: 'ABC2345' }, 'player', api)).toMatchObject({ status: 200, body: { existing: true } });
    api.claim.mockResolvedValue({ error: 'already_used' });
    expect(await referralRequest({ action: 'claim', protocol: 2, code: 'DEF2345' }, 'player', api)).toMatchObject({ status: 409, body: { error: 'already_used' } });
  });
});

describe('referral wallet receipts and invitation', () => {
  it('retains only valid unique receipt IDs through local and cloud imports', () => {
    const raw = [id, id.toUpperCase(), 'bad-id', 123, null];
    expect(normalizeFriendReceipts(raw)).toEqual([id]);
    const save = { ...defaultSave(), friendReceipts: raw };
    expect(importSave(save)?.friendReceipts).toEqual([id]);
    expect(normalizeCloud(save).friendReceipts).toEqual([id]);
    expect(importSave(defaultSave())?.friendReceipts).toEqual([]);
  });
  it('rejects malformed, duplicate and out-of-policy awards, including non-finite amounts', () => {
    expect(friendRewards([reward, reward, { ...reward, id: 'bad' }, { ...reward, coins: NaN }, { ...reward, gems: 51 }, { ...reward, coins: -1 }, { ...reward, coins: 1000.5 }])).toEqual([reward]);
    expect(friendRewards([{ ...reward, coins: 100, gems: 0 }])).toEqual([{ ...reward, coins: 100, gems: 0 }]);
  });
  it('shares accurate rewards and qualification rather than promising a reward for a bare link', () => {
    const text = inviteMessage('ABC2345').text;
    expect(text).toContain('1,000 coins + 50 gems');
    expect(text).toContain('first win');
    expect(text).toContain('first 30 days');
    expect(inviteMessage().text).not.toContain('gems');
  });
});
