/**
 * delete-account: the DELETE ACCOUNT button (the App Store requires in-app deletion wherever an account exists).
 * Deletes the caller's rows (save, profile, Game Center and device links, referrals) and then the account itself.
 * Deployed with verify_jwt on: only a signed-in player can call it, and only for themselves.
 *
 * POST {} with Authorization: Bearer <access token> -> { ok: true }
 */
import { CORS, admin, caller, json } from '../_shared/server.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const db = admin();
    const user = await caller(db, req);
    if (!user) return json({ error: 'not_signed_in' }, 401);
    const uid = user.id;
    // Every table references auth.users with ON DELETE CASCADE; the rows are also removed by hand first, so a
    // failure is reported instead of leaving data behind.
    for (const [table, column] of [['saves', 'user_id'], ['profiles', 'user_id'], ['gc_links', 'user_id'], ['device_links', 'user_id'], ['referrals', 'referrer'], ['referrals', 'referee']] as const) {
      const { error } = await db.from(table).delete().eq(column, uid);
      if (error) throw new Error(`${table}: ${error.message}`);
    }
    const { error } = await db.auth.admin.deleteUser(uid);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    console.error('delete-account failed:', err instanceof Error ? err.message : err);
    return json({ error: 'server' }, 500);
  }
});
