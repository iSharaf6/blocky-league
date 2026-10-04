/**
 * What the Blocky League edge functions share: the service-role client, CORS, the caller checks, the rate limiter
 * and turning an account into a session. Runs in Supabase's Deno runtime; the keys come from the function's
 * environment (never from the repo or the client).
 */
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Every key in a `{ name: key }` environment value (SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS), `default` first. */
function named(env: string): string[] {
  try {
    const o = JSON.parse(Deno.env.get(env) ?? 'null') as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') return [];
    const all = Object.entries(o).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0);
    all.sort((a, b) => Number(b[0] === 'default') - Number(a[0] === 'default'));
    return all.map((e) => e[1]);
  } catch {
    return [];
  }
}

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
// The newer secret key when the project has one, else the legacy service_role key.
const SECRET = named('SUPABASE_SECRET_KEYS')[0] ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLIC_KEYS = [...named('SUPABASE_PUBLISHABLE_KEYS'), Deno.env.get('SUPABASE_ANON_KEY') ?? ''].filter(Boolean);
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** The service-role client: it bypasses row level security, so every caller is checked first. */
export function admin(): SupabaseClient {
  return createClient(URL_, SECRET, NO_SESSION);
}

/** The functions take the game's publishable (or legacy anon) key in the `apikey` header. */
export function allowed(req: Request): boolean {
  if (!PUBLIC_KEYS.length) return true;
  const key = req.headers.get('apikey') ?? '';
  return key.length > 0 && PUBLIC_KEYS.includes(key);
}

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** One hit against `action` for this caller's address (hashed with the server's key, never stored raw). */
export async function rateOk(db: SupabaseClient, action: string, req: Request, limit: number, windowSeconds: number, who?: string): Promise<boolean> {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  const bucket = `${action}:${(await sha256Hex(`${who ?? ip}|${SECRET}`)).slice(0, 32)}`;
  const { data, error } = await db.rpc('rate_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  // (The limiter failing must not lock every player out.)
  if (error) {
    console.error('rate_hit failed:', error.message);
    return true;
  }
  return data !== false;
}

/** The signed-in user behind `Authorization: Bearer <access token>`, or null. */
export async function caller(db: SupabaseClient, req: Request): Promise<User | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  // (A publishable key in the header is not a user token.)
  if (!m || m[1].split('.').length !== 3) return null;
  const { data, error } = await db.auth.getUser(m[1]);
  return error ? null : data.user;
}

export type AccountKind = 'gamecenter' | 'device';

/** Accounts made here have no real address: `.invalid` is reserved (RFC 2606), so it can never receive mail, and it names nobody. */
const EMAIL_DOMAIN = 'players.blockyleague.invalid';

export const accountEmail = (kind: AccountKind, key: string): string => `${kind === 'gamecenter' ? 'gc' : 'dev'}-${key.slice(0, 40)}@${EMAIL_DOMAIN}`;

/** Find or make the account for `email`. `created` is false when it was already there (a login that raced this one). */
export async function ensureUser(db: SupabaseClient, kind: AccountKind, email: string): Promise<{ id: string; created: boolean }> {
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, app_metadata: { bl_kind: kind } });
  if (data?.user) return { id: data.user.id, created: true };
  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (link?.user) return { id: link.user.id, created: false };
  throw new Error(`could not create the account: ${error?.message ?? 'unknown'}`);
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number | null;
  user_id: string;
}

/**
 * A session for an account, with no password and no email sent: the admin API makes a one-time sign-in token and
 * it is redeemed here, server-side. The game then calls auth.setSession with the two tokens.
 */
export async function sessionFor(db: SupabaseClient, uid: string, email?: string): Promise<Tokens> {
  let address = email;
  if (!address) {
    const { data, error } = await db.auth.admin.getUserById(uid);
    if (error || !data.user?.email) throw new Error(`account not found: ${error?.message ?? 'no address'}`);
    address = data.user.email;
  }
  const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email: address });
  const hash = link?.properties?.hashed_token;
  if (linkError || !hash) throw new Error(`could not start the session: ${linkError?.message ?? 'no token'}`);
  const visitor = createClient(URL_, PUBLIC_KEYS[0] ?? SECRET, NO_SESSION);
  const { data, error } = await visitor.auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
  if (error || !data.session) throw new Error(`could not open the session: ${error?.message ?? 'no session'}`);
  const s = data.session;
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at ?? null, user_id: s.user.id };
}

/** A device secret as the game makes it: 32 to 128 URL-safe characters. */
export const DEVICE_SECRET = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * This device now belongs to `uid`. If it pointed at another account that nothing else can reach (a device
 * account with no Game Center link and no other device), that account is deleted: its progress is the save on the
 * device, which the game keeps and offers against the new account's.
 */
export async function linkDevice(db: SupabaseClient, secretHash: string, uid: string): Promise<void> {
  const { data: old } = await db.from('device_links').select('user_id').eq('secret_hash', secretHash).maybeSingle();
  const before = (old as { user_id?: string } | null)?.user_id;
  const { error } = await db.from('device_links').upsert({ secret_hash: secretHash, user_id: uid, last_seen_at: new Date().toISOString() }, { onConflict: 'secret_hash' });
  if (error) throw new Error(`device link failed: ${error.message}`);
  if (!before || before === uid) return;
  const [{ count: devices }, { count: gc }, { data: prev }] = await Promise.all([
    db.from('device_links').select('secret_hash', { count: 'exact', head: true }).eq('user_id', before),
    db.from('gc_links').select('team_player_id', { count: 'exact', head: true }).eq('user_id', before),
    db.auth.admin.getUserById(before),
  ]);
  const kind = (prev.user?.app_metadata as Record<string, unknown> | undefined)?.bl_kind;
  if (devices === 0 && gc === 0 && kind === 'device') {
    const { error: gone } = await db.auth.admin.deleteUser(before);
    if (gone) console.error('orphan account not deleted:', gone.message);
  }
}
