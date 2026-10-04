/**
 * gc-login: sign in with Apple Game Center. No password and no email: the app sends the identity verification
 * data from GKLocalPlayer.fetchItems(forIdentityVerificationSignature:), this checks Apple's signature
 * (../_shared/gc.ts), then finds or makes the account for that teamPlayerID and returns a session.
 * Deployed with verify_jwt off (nobody is signed in yet): Apple's signature is the credential.
 *
 * POST { publicKeyUrl, signature, salt, timestamp, teamPlayerId, bundleId, deviceSecret? }
 *   Authorization: Bearer <access token> (optional): a device account signed in on this device. A Game Center
 *   player with no account yet takes that account over (its progress stays), instead of starting a second one.
 * -> { access_token, refresh_token, expires_in, expires_at, user_id, kind: 'gamecenter', created, switched }
 */
import { appleKeyUrl, parseIdentity, verifyGameCenter } from '../_shared/gc.ts';
import { CORS, DEVICE_SECRET, accountEmail, admin, allowed, caller, ensureUser, json, linkDevice, rateOk, sessionFor, sha256Hex } from '../_shared/server.ts';

const BUNDLE_IDS = (Deno.env.get('GC_BUNDLE_IDS') ?? 'com.calynx.blockyleague').split(',').map((s) => s.trim()).filter(Boolean);
const CERT_MAX_BYTES = 16 * 1024;
const CERT_TTL_MS = 60 * 60 * 1000;
const certs = new Map<string, { bytes: Uint8Array; at: number }>();

/** Apple's certificate (kept for an hour per worker). The URL is validated before this is called; a redirect is refused. */
async function fetchCert(url: string): Promise<Uint8Array> {
  if (!appleKeyUrl(url)) throw new Error('not an Apple key URL');
  const hit = certs.get(url);
  if (hit && Date.now() - hit.at < CERT_TTL_MS) return hit.bytes;
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`certificate fetch ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > CERT_MAX_BYTES) throw new Error('certificate size');
  if (certs.size > 8) certs.clear();
  certs.set(url, { bytes, at: Date.now() });
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!allowed(req)) return json({ error: 'apikey' }, 401);
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const identity = parseIdentity(body);
    if (!identity) return json({ error: 'bad_request' }, 400);
    const db = admin();
    if (!(await rateOk(db, 'login', req, 60, 600))) return json({ error: 'rate_limited' }, 429);
    const checked = await verifyGameCenter(identity, { bundleIds: BUNDLE_IDS, now: Date.now(), fetchCert });
    if (!checked.ok) return json({ error: checked.reason }, checked.reason === 'key_fetch_failed' ? 502 : 401);
    const playerId = checked.teamPlayerId;
    const secret = typeof body?.deviceSecret === 'string' && DEVICE_SECRET.test(body.deviceSecret) ? body.deviceSecret : '';
    const secretHash = secret ? await sha256Hex(secret) : '';
    const current = await caller(db, req);

    const { data: link, error: linkError } = await db.from('gc_links').select('user_id').eq('team_player_id', playerId).maybeSingle();
    if (linkError) throw new Error(linkError.message);
    let uid = (link as { user_id?: string } | null)?.user_id ?? '';
    let created = false;
    let email: string | undefined;
    if (!uid) {
      // No account for this player yet. A device account already in use here becomes theirs (nothing to merge);
      // otherwise a new account is made.
      const free = async (id: string): Promise<boolean> => {
        const { count } = await db.from('gc_links').select('team_player_id', { count: 'exact', head: true }).eq('user_id', id);
        return count === 0;
      };
      if (current && (current.app_metadata as Record<string, unknown> | undefined)?.bl_kind === 'device' && (await free(current.id))) {
        uid = current.id;
      } else if (secretHash) {
        const { data: dev } = await db.from('device_links').select('user_id').eq('secret_hash', secretHash).maybeSingle();
        const owner = (dev as { user_id?: string } | null)?.user_id;
        if (owner && (await free(owner))) {
          const { data: u } = await db.auth.admin.getUserById(owner);
          if ((u.user?.app_metadata as Record<string, unknown> | undefined)?.bl_kind === 'device') uid = owner;
        }
      }
      if (uid) {
        await db.auth.admin.updateUserById(uid, { app_metadata: { bl_kind: 'gamecenter' } });
      } else {
        if (!(await rateOk(db, 'signup', req, 40, 3600))) return json({ error: 'rate_limited' }, 429);
        email = accountEmail('gamecenter', await sha256Hex(playerId));
        const made = await ensureUser(db, 'gamecenter', email);
        uid = made.id;
        created = made.created;
      }
      const { error } = await db.from('gc_links').upsert({ team_player_id: playerId, user_id: uid }, { onConflict: 'team_player_id', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      // (Two first logins at once: the row that landed first is the account.)
      const { data: now } = await db.from('gc_links').select('user_id').eq('team_player_id', playerId).maybeSingle();
      uid = (now as { user_id?: string } | null)?.user_id ?? uid;
    }
    // The device remembers this account, so a launch without Game Center still reaches it.
    if (secretHash) await linkDevice(db, secretHash, uid);
    return json({ ...(await sessionFor(db, uid, email)), kind: 'gamecenter', created, switched: !!current && current.id !== uid });
  } catch (err) {
    console.error('gc-login failed:', err instanceof Error ? err.message : err);
    return json({ error: 'server' }, 500);
  }
});
