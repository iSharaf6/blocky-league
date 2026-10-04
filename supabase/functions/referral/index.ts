/**
 * referral: friend codes. A new player enters a friend's code after their first win; both get coins, once.
 * Deployed with verify_jwt on (a signed-in player only). The server only records who is owed: the game adds the
 * coins to the save when `collect` answers, and each side of a referral is paid exactly once.
 *
 * POST { action: 'claim', code } -> { ok: true } or { error }
 *   error: unknown_code | own_code | already_used | win_first | too_late | friend_full | rate_limited
 * POST { action: 'collect' }     -> { coins, friends }   (coins to add now; friends = how many joined with your code)
 */
import { CORS, admin, caller, json, rateOk } from '../_shared/server.ts';

const REWARD = 100;
/** A code pays its owner for this many friends. */
const FRIEND_CAP = 20;
/** "New player": the account is at most this old. */
const NEW_PLAYER_DAYS = 30;
const CODE = /^[A-HJ-NP-Z2-9]{7}$/;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const db = admin();
    const user = await caller(db, req);
    if (!user) return json({ error: 'not_signed_in' }, 401);
    const uid = user.id;
    const body = (await req.json().catch(() => null)) as { action?: unknown; code?: unknown } | null;

    if (body?.action === 'collect') {
      const now = new Date().toISOString();
      const { data: mine, error: e1 } = await db.from('referrals').update({ referrer_collected_at: now }).eq('referrer', uid).is('referrer_collected_at', null).select('coins');
      const { data: theirs, error: e2 } = await db.from('referrals').update({ referee_collected_at: now }).eq('referee', uid).is('referee_collected_at', null).select('coins');
      if (e1 || e2) throw new Error((e1 ?? e2)?.message);
      const sum = (rows: unknown): number => (Array.isArray(rows) ? rows.reduce((n: number, r: { coins?: number }) => n + (r.coins ?? 0), 0) : 0);
      const { count } = await db.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer', uid);
      return json({ coins: sum(mine) + sum(theirs), friends: count ?? 0 });
    }

    if (body?.action !== 'claim') return json({ error: 'bad_request' }, 400);
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    // (Guessing codes is limited per account and per address.)
    if (!(await rateOk(db, 'refclaim', req, 10, 86400, uid)) || !(await rateOk(db, 'refclaim-ip', req, 30, 86400))) return json({ error: 'rate_limited' }, 429);
    if (!CODE.test(code)) return json({ error: 'unknown_code' }, 400);
    const { data: owner } = await db.from('profiles').select('user_id').eq('referral_code', code).maybeSingle();
    const referrer = (owner as { user_id?: string } | null)?.user_id;
    if (!referrer) return json({ error: 'unknown_code' }, 404);
    if (referrer === uid) return json({ error: 'own_code' }, 400);
    const { count: used } = await db.from('referrals').select('id', { count: 'exact', head: true }).eq('referee', uid);
    if (used) return json({ error: 'already_used' }, 409);
    // Two players cannot refer each other.
    const { count: mutual } = await db.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer', uid).eq('referee', referrer);
    if (mutual) return json({ error: 'own_code' }, 400);
    if (Date.now() - Date.parse(user.created_at) > NEW_PLAYER_DAYS * 86400_000) return json({ error: 'too_late' }, 400);
    // After the first win: read from the player's cloud save (the game syncs after every match).
    const { data: save } = await db.from('saves').select('won:data->record->won').eq('user_id', uid).maybeSingle();
    if (!(Number((save as { won?: unknown } | null)?.won) >= 1)) return json({ error: 'win_first' }, 400);
    const { count: friends } = await db.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer', referrer);
    if ((friends ?? 0) >= FRIEND_CAP) return json({ error: 'friend_full' }, 409);
    const { error } = await db.from('referrals').insert({ referrer, referee: uid, coins: REWARD });
    // (The unique key on `referee` settles two claims at once.)
    if (error) return json({ error: /duplicate|unique/i.test(error.message) ? 'already_used' : 'server' }, error.code === '23505' ? 409 : 500);
    return json({ ok: true, coins: REWARD });
  } catch (err) {
    console.error('referral failed:', err instanceof Error ? err.message : err);
    return json({ error: 'server' }, 500);
  }
});
