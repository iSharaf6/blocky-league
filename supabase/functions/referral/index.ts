/**
 * Referral protocol 2: a qualified friend earns BOTH players 1,000 coins + 50 gems.
 * Claims are atomic and idempotent in Postgres; collections return immutable grants, never consume them.
 * The client saves receipt IDs with its wallet so retrying a dropped response cannot lose or duplicate rewards.
 */
import { CORS, admin, caller, json, rateOk } from '../_shared/server.ts';
import { referralRequest, type ReferralResult } from '../_shared/referral.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const db = admin();
    const user = await caller(db, req);
    const response = await referralRequest(await req.json().catch(() => null), user?.id ?? null, {
      async collect(uid) {
        const [{ data: rewards, error }, { count: friends, error: countError }, { count: used, error: usedError }] = await Promise.all([
          db.from('referral_rewards').select('id,coins,gems').eq('user_id', uid).order('created_at'),
          db.from('referral_rewards').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'inviter'),
          db.from('referral_rewards').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'welcome'),
        ]);
        if (error || countError || usedError) throw new Error((error ?? countError ?? usedError)?.message);
        return { rewards: rewards ?? [], friends: friends ?? 0, claimed: (used ?? 0) > 0 };
      },
      async rate(uid) {
        return await rateOk(db, 'refclaim', req, 10, 86400, uid) && await rateOk(db, 'refclaim-ip', req, 30, 86400);
      },
      async claim(uid, code) {
        // SQL locks both accounts and checks first win, age, self/mutual referrals and the invite cap atomically.
        const { data, error } = await db.rpc('claim_referral_reward', { p_user: uid, p_code: code });
        if (error || !data) throw new Error(error?.message ?? 'empty claim result');
        return data as ReferralResult;
      },
    });
    return json(response.body, response.status);
  } catch (err) {
    console.error('referral failed:', err instanceof Error ? err.message : err);
    return json({ error: 'server' }, 500);
  }
});
