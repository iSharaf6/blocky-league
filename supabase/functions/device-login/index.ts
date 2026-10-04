/**
 * device-login: the account for players without Game Center (and the web game). The device keeps a random secret;
 * this finds the account that secret belongs to, or makes one, and returns a session. No password, no email, no
 * personal data: only a hash of the secret is stored. Deployed with verify_jwt off (nobody is signed in yet): the
 * secret is the credential, the publishable key is checked, and calls are rate limited per address.
 *
 * POST { secret } -> { access_token, refresh_token, expires_in, expires_at, user_id, kind, created }
 */
import { CORS, DEVICE_SECRET, accountEmail, admin, allowed, ensureUser, json, rateOk, sessionFor, sha256Hex } from '../_shared/server.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!allowed(req)) return json({ error: 'apikey' }, 401);
  try {
    const body = (await req.json().catch(() => null)) as { secret?: unknown } | null;
    const secret = typeof body?.secret === 'string' ? body.secret : '';
    if (!DEVICE_SECRET.test(secret)) return json({ error: 'bad_request' }, 400);
    const db = admin();
    if (!(await rateOk(db, 'login', req, 60, 600))) return json({ error: 'rate_limited' }, 429);
    const hash = await sha256Hex(secret);
    const { data: link, error: linkError } = await db.from('device_links').select('user_id').eq('secret_hash', hash).maybeSingle();
    if (linkError) throw new Error(linkError.message);
    let uid = (link as { user_id?: string } | null)?.user_id ?? '';
    let created = false;
    let email: string | undefined;
    if (!uid) {
      // New accounts are the costly part: a tighter limit per address.
      if (!(await rateOk(db, 'signup', req, 40, 3600))) return json({ error: 'rate_limited' }, 429);
      email = accountEmail('device', hash);
      const made = await ensureUser(db, 'device', email);
      uid = made.id;
      created = made.created;
      const { error } = await db.from('device_links').upsert({ secret_hash: hash, user_id: uid }, { onConflict: 'secret_hash' });
      if (error) throw new Error(error.message);
    } else {
      await db.from('device_links').update({ last_seen_at: new Date().toISOString() }).eq('secret_hash', hash);
    }
    const { count } = await db.from('gc_links').select('team_player_id', { count: 'exact', head: true }).eq('user_id', uid);
    return json({ ...(await sessionFor(db, uid, email)), kind: count ? 'gamecenter' : 'device', created });
  } catch (err) {
    console.error('device-login failed:', err instanceof Error ? err.message : err);
    return json({ error: 'server' }, 500);
  }
});
