/**
 * Cloud saves and sign-in (Supabase, free tier). Off unless the build carries VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY: the web build and the iPhone / iPad app get them from .env.production (public values);
 * scripts/release.mjs blanks them for the crazygames / poki / itch zips (portals forbid accounts of our own).
 * In a build without them everything here is a no-op and the game is fully local.
 *
 * Who signs in, and how, is src/platform/signin.ts: Game Center in the app, else a device account (both silent,
 * through edge functions that hand back a session: `adoptSession`); Google / GitHub / email / guest stay on the
 * web. What needs a connection is src/platform/online.ts.
 *
 * Data: one row per user in `saves` (supabase/migrations), the save JSON as-is, under RLS. Each write names the
 * row's revision (`rev`) as this device last saw it: the server refuses a write from a stale copy ("stale_save"),
 * and the row is fetched and compared again instead of overwriting another device's progress.
 *
 * Sync: `cloudBoot` compares the cloud row with this device's save three ways. The last-synced marker
 * (SYNC_MARK_KEY, per user) records the timestamp both sides agreed on, so only the side that moved wins.
 * If both moved (or this device never synced with this account) the newer save wins when the older one has
 * nothing to lose (no more coins / XP / matches, no career or cup it would drop); otherwise the player picks
 * once (src/ui/account.ts). Afterwards local changes are noticed through SaveData.updatedAt (writeSave
 * stamps it on every persist; `markDirty()` is the explicit hook) and pushed 5 s after the last one, or at
 * once with a keepalive request when the tab hides. Offline pushes wait for `online`. Failures toast.
 */
import type { Session } from '@supabase/supabase-js';
import { defaultSave, levelOf, normalizeIap, normalizeProgress, normalizeSettings, normalizeShop, type SaveData } from '../core/save';

export interface CloudContext {
  save: SaveData;
  /** Write the local save (after a cloud load replaced it, or after a change worth syncing). */
  persist: () => void;
  /** Replace the running save with one loaded from the cloud (menus re-read from it). */
  reload: (d: SaveData) => void;
}

export interface CloudUser {
  name: string;
  /** 'google' | 'github' | 'email' | 'guest' (anonymous) | 'gamecenter' | 'device'. */
  provider: string;
  email?: string;
  guest?: boolean;
  /** An account the game made by itself (Game Center or this device): no email, nothing to type. */
  auto?: boolean;
}

export type OAuthProvider = 'google' | 'github';

export const SAVE_KEY = 'blocky-league-save-v1';
/** Side channel: JSON { user, synced } — the cloud client_updated_at (ms) this device last pushed or pulled. */
export const SYNC_MARK_KEY = 'blocky-league-save-v1:ts';
/** Side channel: JSON { user, sent: [] } — the stamps of pushes whose answers never arrived (a closing app, a dropped connection). */
export const SYNC_SENT_KEY = 'blocky-league-save-v1:sent';
/** Back in the foreground after this long: the cloud row is compared again (another device may have played). */
export const RESUME_CHECK_MS = 60_000;
/** Local changes are pushed this long after the last one. */
export const PUSH_DEBOUNCE_MS = 5000;
/** How often the save's updatedAt is checked for changes made by the game's own persist(). */
export const WATCH_MS = 1500;
const RETRY_MS = 30_000;
/** Fetch keepalive bodies are capped at 64 KB by the spec; bigger saves go the ordinary way. */
const KEEPALIVE_MAX_BYTES = 60_000;

// ------------------------------------------------------------------ availability

interface Env {
  url?: string;
  key?: string;
  portal?: string;
  query?: string;
  /** VITE_ONLINE_ACCOUNTS: 'on' switches on the silent sign-in and the online rule (see accountsRequired). */
  online?: string;
}
let envOverride: Env | null = null;

function env(): Env {
  if (envOverride) return envOverride;
  const m = import.meta.env as Record<string, string | undefined>;
  const dev = devEnv();
  return {
    url: m.VITE_SUPABASE_URL || dev?.url,
    key: m.VITE_SUPABASE_ANON_KEY || dev?.key,
    portal: m.VITE_PORTAL,
    query: typeof location === 'undefined' ? '' : location.search,
    // (The dev tab switch turns the whole feature on.)
    online: m.VITE_ONLINE_ACCOUNTS || (dev ? 'on' : undefined),
  };
}

/**
 * The dev server only: one tab switches the backend on without an .env file (which would switch it on for
 * everyone sharing the server): sessionStorage['bl-dev-cloud'] = '{"url":"...","key":"..."}', then reload.
 */
function devEnv(): { url?: string; key?: string } | null {
  if (!import.meta.env.DEV || typeof sessionStorage === 'undefined') return null;
  try {
    const o = JSON.parse(sessionStorage.getItem('bl-dev-cloud') ?? 'null') as { url?: unknown; key?: unknown } | null;
    return o && typeof o.url === 'string' && typeof o.key === 'string' ? { url: o.url, key: o.key } : null;
  } catch {
    return null;
  }
}

/** True when a backend is configured for this build (never on a portal build, or a dev ?portal= preview). */
export function cloudAvailable(): boolean {
  const e = env();
  if (!e.url || !e.key) return false;
  if (e.portal && e.portal !== 'none') return false;
  if (!e.portal && /[?&]portal=/.test(e.query ?? '')) return false;
  return true;
}

/**
 * Accounts are required in this build: the game signs the player in by itself (src/platform/signin.ts) and
 * progression needs a connection (src/platform/online.ts). It takes a backend AND VITE_ONLINE_ACCOUNTS=on. Off (the
 * default), a build with a backend has only what it always had: the optional ACCOUNT panel and cloud save, and
 * nothing is gated.
 */
export function accountsRequired(): boolean {
  return cloudAvailable() && env().online === 'on';
}

// ------------------------------------------------------------------ the client slice this module uses

type Err = { message: string; code?: string } | null;

/** The part of supabase-js this module calls (tests pass a fake). */
export interface CloudClient {
  auth: {
    getSession(): PromiseLike<{ data: { session: Session | null }; error: Err }>;
    onAuthStateChange(cb: (event: string, session: Session | null) => void): { data: { subscription: { unsubscribe(): void } } };
    signInWithOAuth(c: { provider: OAuthProvider; options?: { redirectTo?: string } }): PromiseLike<{ error: Err }>;
    signInWithOtp(c: { email: string; options?: { emailRedirectTo?: string } }): PromiseLike<{ error: Err }>;
    signInAnonymously(): PromiseLike<{ data: { session: Session | null }; error: Err }>;
    linkIdentity(c: { provider: OAuthProvider; options?: { redirectTo?: string } }): PromiseLike<{ error: Err }>;
    updateUser(a: { email: string }, o?: { emailRedirectTo?: string }): PromiseLike<{ error: Err }>;
    signOut(o?: { scope: 'local' | 'global' | 'others' }): PromiseLike<{ error: Err }>;
    /** A session an edge function handed back (Game Center / device sign-in: src/platform/signin.ts). */
    setSession?(t: { access_token: string; refresh_token: string }): PromiseLike<{ data: { session: Session | null }; error: Err }>;
  };
  from(table: 'saves'): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: Err }> } };
    upsert(row: Record<string, unknown>, opts?: { onConflict?: string }): PromiseLike<{ error: Err }>;
    delete(): { eq(column: string, value: string): PromiseLike<{ error: Err }> };
  };
  /** Database functions (my_profile: the friend code and the club name). */
  rpc?(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: Err }>;
}

let client: CloudClient | null = null;
let clientOverride: CloudClient | null = null;
let clientLoading: Promise<CloudClient | null> | null = null;
let session: Session | null = null;
let ctxRef: CloudContext | null = null;
/** The cloud row's revision as last seen: undefined = not known (the write is unconditional), null = no row yet. */
let cloudRev: number | null | undefined;
/** When the cloud row was last compared with this device's save (ms). */
let lastCheck = 0;
/** The player signed out himself (web): the silent sign-in leaves him signed out until he asks to connect. */
let signedOutByPlayer = false;
/**
 * Two real saves wait for the player's pick (WHICH SAVE?) and it has not been made: the panel could not open, or the
 * app was closed on it. Nothing is written to the cloud until it is settled, so neither save is lost.
 */
let unsettled = false;
/** ctx.save.updatedAt as last seen by the watcher. */
let seenUpdatedAt = '';
let dirty = false;
let holding = false;
let paused = false;
let busy = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let watchTimer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<boolean> | null = null;
let again = false;
let lastSynced: number | null = null;
let lastError: string | null = null;
let listenersOn = false;
const subs = new Set<() => void>();

async function getClient(): Promise<CloudClient | null> {
  if (client) return client;
  if (clientOverride) {
    client = clientOverride;
    hookAuth(client);
    return client;
  }
  if (!cloudAvailable()) return null;
  if (!clientLoading) clientLoading = loadClient();
  return clientLoading;
}

async function loadClient(): Promise<CloudClient | null> {
  const e = env();
  // The literal env check is deliberate: a build without the value compiles this to dead code, so
  // supabase-js is not even emitted as a chunk for the portal / itch zips. (DEV is a literal too: the dev
  // server may switch the backend on per tab, see devEnv.)
  if (!(import.meta.env.DEV || import.meta.env.VITE_SUPABASE_URL) || !e.url || !e.key) return null;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const c = createClient(e.url, e.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    }) as unknown as CloudClient;
    hookAuth(c);
    client = c;
    return c;
  } catch (err) {
    fail('Cloud sign-in could not start', err);
    return null;
  }
}

function hookAuth(c: CloudClient): void {
  try {
    c.auth.onAuthStateChange((event, s) => {
      if (s?.user.id !== session?.user.id) cloudRev = undefined;
      session = s;
      if (event === 'SIGNED_OUT') dirty = false;
      notify();
    });
  } catch {
    // A client without auth events (tests): the session is set by the calls themselves.
  }
}

/** Signed-in display name (or null). */
export function cloudUser(): CloudUser | null {
  const u = session?.user;
  if (!u) return null;
  const md = (u.user_metadata ?? {}) as Record<string, unknown>;
  const am = (u.app_metadata ?? {}) as Record<string, unknown>;
  // Accounts the game made by itself (the gc-login / device-login edge functions): no name, no email to show.
  if (am.bl_kind === 'gamecenter') return { name: 'Game Center', provider: 'gamecenter', guest: false, auto: true };
  if (am.bl_kind === 'device') return { name: 'This device', provider: 'device', guest: false, auto: true };
  const guest = u.is_anonymous === true;
  const pick = (k: string): string => (typeof md[k] === 'string' ? (md[k] as string).trim() : '');
  const provider = guest ? 'guest' : String(am.provider ?? 'email');
  const name = guest ? 'Guest' : pick('full_name') || pick('name') || pick('user_name') || pick('preferred_username') || u.email || 'Player';
  return { name, provider, email: u.email ?? undefined, guest };
}

/** The signed-in account's id and access token (the edge functions take the token), or null. */
export function cloudSession(): { userId: string; accessToken: string } | null {
  return session ? { userId: session.user.id, accessToken: session.access_token } : null;
}

/** Where the backend is (the project URL and the publishable key), or null in a build without one. */
export function cloudEndpoint(): { url: string; key: string } | null {
  if (!cloudAvailable()) return null;
  const e = env();
  return e.url && e.key ? { url: e.url.replace(/\/+$/, ''), key: e.key } : null;
}

export interface CloudStatus {
  available: boolean;
  user: CloudUser | null;
  /** A sync or an account action is in progress. */
  busy: boolean;
  /** Local changes not yet in the cloud. */
  pending: boolean;
  offline: boolean;
  /** Sync stopped after DELETE CLOUD SAVE until SYNC NOW or the next sign-in. */
  paused: boolean;
  lastSynced: number | null;
  lastError: string | null;
  /** The player pressed SIGN OUT: nothing signs him back in until he asks. */
  signedOut: boolean;
  /** Accounts are required in this build (accountsRequired): the online rule applies. */
  required: boolean;
}

export function cloudStatus(): CloudStatus {
  return {
    available: cloudAvailable(), user: cloudUser(), busy: busy || inflight !== null, pending: dirty, offline: offline(), paused, lastSynced, lastError,
    signedOut: signedOutByPlayer, required: accountsRequired(),
  };
}

/** Subscribe to status changes (the account panel re-renders). Returns the unsubscribe. */
export function onCloudChange(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}

function notify(): void {
  for (const fn of subs) {
    try {
      fn();
    } catch {
      // A listener's error must not stop the others.
    }
  }
}

// ------------------------------------------------------------------ pure rules (tests/cloud.test.ts)

export type SyncDecision = 'none' | 'push' | 'pull' | 'ask';

export interface CloudRow {
  data: SaveData;
  /** ms epoch of the pushing client's save.updatedAt (null on rows written by other tools). */
  clientUpdatedAt: number | null;
  /** ms epoch of the server-side write. */
  updatedAt: number | null;
  version: number;
  /** The row's revision (absent on a backend without the column: writes are then unconditional). */
  rev?: number;
}

/** ms epoch of an ISO / Postgres timestamp, 0 when missing or unreadable. */
export function ms(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1000;

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * The same progress (timestamps aside, key order aside). Both sides are made whole first: a brand-new save and
 * the same save read back from storage or the cloud differ only by defaults filled in on load, which is not progress.
 */
export function sameSave(a: SaveData, b: SaveData): boolean {
  return stable({ ...normalizeCloud(a), updatedAt: undefined }) === stable({ ...normalizeCloud(b), updatedAt: undefined });
}

interface CareerPeek {
  club?: { name?: unknown } | null;
  season?: { number?: number; matchday?: number } | null;
  history?: unknown[];
}

function peekCareer(d: SaveData): CareerPeek | null {
  const c = d.career as CareerPeek | null | undefined;
  return c && typeof c === 'object' && c.club ? c : null;
}

/** How far a career has come (-1 = none): seasons finished, then the current season and its matchday. */
export function careerScore(d: SaveData): number {
  const c = peekCareer(d);
  if (!c) return -1;
  const hist = Array.isArray(c.history) ? c.history.length : 0;
  const n = typeof c.season?.number === 'number' ? c.season.number : 0;
  const md = typeof c.season?.matchday === 'number' ? c.season.matchday : 0;
  return hist * 10_000 + n * 100 + md;
}

const hasCup = (d: SaveData): boolean => d.cup !== null && d.cup !== undefined && typeof d.cup === 'object';

/**
 * Barely started: no match played, no XP, no career, no cup (daily-gift coins don't count). Nothing a player
 * would miss, so the other side may replace it without asking. Coins alone are never compared: they go down
 * legitimately (transfers, upgrades), so "more coins" says nothing about which save is further along. A store
 * purchase is the exception: money was paid for it, so a save that holds one is never given away unasked.
 */
export function isSmall(d: SaveData): boolean {
  return !peekCareer(d) && !hasCup(d) && (d.record?.played ?? 0) === 0 && (d.progress?.xp ?? 0) === 0
    && (d.iap?.owned?.length ?? 0) === 0 && (d.iap?.applied?.length ?? 0) === 0;
}

/**
 * What to do with this device's save and the cloud row. `base` is the marker: the cloud timestamp (ms) this
 * device last agreed on with this account, or null if it never has.
 */
export function decideSync(local: SaveData, cloud: CloudRow | null, base: number | null): SyncDecision {
  if (!cloud) return 'push';
  if (sameSave(local, cloud.data)) return 'none';
  const localTs = ms(local.updatedAt);
  const cloudTs = cloud.clientUpdatedAt ?? cloud.updatedAt ?? 0;
  if (base !== null) {
    const localMoved = !near(localTs, base);
    const cloudMoved = !near(cloudTs, base);
    // Neither moved but the data differs (a normalisation drift): the running copy refreshes the cloud.
    if (!cloudMoved) return 'push';
    if (!localMoved) return 'pull';
  }
  // Both moved, or a device that never synced with this account: a barely-started save gives way to the
  // other one (the newer wins when both are barely started); two real saves are the player's call.
  const localSmall = isSmall(local);
  const cloudSmall = isSmall(cloud.data);
  if (localSmall && cloudSmall) return cloudTs > localTs ? 'pull' : 'push';
  if (localSmall) return 'pull';
  if (cloudSmall) return 'push';
  return 'ask';
}

/**
 * The agreed point to compare from. `synced` is the marker (the last push or pull this device saw confirmed);
 * `sent` are the stamps of pushes whose answers never came back (the app was closed, the connection dropped). When
 * the cloud row carries exactly one of those stamps that push did land: the cloud holds this device's own progress,
 * so it has not moved, and nobody is asked which save to keep.
 */
export function baseFor(synced: number | null, sent: readonly number[], cloudTs: number | null): number | null {
  if (cloudTs !== null) for (const s of sent) if (near(s, cloudTs)) return s;
  return synced;
}

/** The server refused a write made from a stale copy of the row (saves_guard in supabase/migrations/0002_accounts.sql). */
export function isStale(err: { message?: string; code?: string } | null | undefined): boolean {
  return !!err && (err.code === 'PT409' || /stale_save/.test(err.message ?? ''));
}

/** A cloud payload (any build, any tampering) made whole the way loadSave does for storage. */
export function normalizeCloud(raw: unknown): SaveData {
  const base = defaultSave();
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<SaveData>;
  return {
    ...base,
    ...d,
    version: 1,
    coins: typeof d.coins === 'number' && Number.isFinite(d.coins) ? Math.max(0, Math.floor(d.coins)) : base.coins,
    settings: normalizeSettings(d.settings),
    record: { ...base.record, ...(d.record ?? {}) },
    cup: typeof d.cup === 'object' ? d.cup : null,
    progress: normalizeProgress(d.progress),
    // (The SHOP's purchases: an older copy has none, a damaged one is made whole.)
    shop: normalizeShop(d.shop),
    // (Store purchases follow the account: an older copy has none, a damaged one is made whole.)
    iap: normalizeIap(d.iap),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : base.updatedAt,
  } as SaveData;
}

export interface SaveSummary {
  level: number;
  coins: number;
  played: number;
  career: string;
  /** ms epoch the save was last changed, or null. */
  when: number | null;
}

/** The lines the choice panel shows for one save. */
export function summarize(d: SaveData, when: number | null): SaveSummary {
  const c = peekCareer(d);
  let career = 'No Road to Glory yet';
  if (c) {
    const name = typeof c.club?.name === 'string' && c.club.name.trim() ? c.club.name.trim() : 'Your club';
    career = c.season
      ? `${name}: season ${typeof c.season.number === 'number' ? c.season.number : 1}, ${typeof c.season.matchday === 'number' ? c.season.matchday : 0} played`
      : `${name}: between seasons`;
  }
  return { level: levelOf(d.progress?.xp ?? 0).level, coins: d.coins ?? 0, played: d.record?.played ?? 0, career, when };
}

// ------------------------------------------------------------------ marker + rows

function readMark(uid: string): number | null {
  try {
    const raw = localStorage.getItem(SYNC_MARK_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as { user?: unknown; synced?: unknown };
    return m.user === uid && typeof m.synced === 'number' ? m.synced : null;
  } catch {
    return null;
  }
}

function writeMark(uid: string, synced: number): void {
  try {
    localStorage.setItem(SYNC_MARK_KEY, JSON.stringify({ user: uid, synced }));
  } catch {
    // Storage unavailable: the next boot falls back to the two-way rule.
  }
}

function clearMark(): void {
  try {
    localStorage.removeItem(SYNC_MARK_KEY);
    localStorage.removeItem(SYNC_SENT_KEY);
  } catch {
    // ignore
  }
}

/** How many unanswered pushes are remembered (the newest). */
const SENT_MAX = 6;

function readSent(uid: string): number[] {
  try {
    const raw = localStorage.getItem(SYNC_SENT_KEY);
    if (!raw) return [];
    const m = JSON.parse(raw) as { user?: unknown; sent?: unknown };
    return m.user === uid && Array.isArray(m.sent) ? m.sent.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

function storeSent(uid: string, list: number[]): void {
  try {
    if (!list.length) localStorage.removeItem(SYNC_SENT_KEY);
    else localStorage.setItem(SYNC_SENT_KEY, JSON.stringify({ user: uid, sent: list.slice(-SENT_MAX) }));
  } catch {
    // Storage unavailable: the next boot may ask which save to keep, which is safe.
  }
}

/** A push is leaving with this stamp: remembered until an answer says whether it landed. */
function noteSent(uid: string, stamp: number): void {
  const list = readSent(uid);
  if (!list.includes(stamp)) storeSent(uid, [...list, stamp]);
}

/** That push was refused (nothing was written): there is no answer to wait for. */
function dropSent(uid: string, stamp: number): void {
  storeSent(uid, readSent(uid).filter((x) => x !== stamp));
}

/** A write is confirmed, or the two sides are known to agree: nothing is in doubt any more. */
function clearSent(uid: string): void {
  if (readSent(uid).length) storeSent(uid, []);
}

async function fetchRow(c: CloudClient, uid: string): Promise<CloudRow | null> {
  const { data, error } = await c.from('saves').select('data,updated_at,client_updated_at,version,rev').eq('user_id', uid).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') {
    cloudRev = null;
    return null;
  }
  const r = data as { data?: unknown; updated_at?: string | null; client_updated_at?: string | null; version?: number; rev?: unknown };
  cloudRev = typeof r.rev === 'number' ? r.rev : undefined;
  return {
    data: normalizeCloud(r.data),
    clientUpdatedAt: r.client_updated_at ? ms(r.client_updated_at) : null,
    updatedAt: r.updated_at ? ms(r.updated_at) : null,
    version: typeof r.version === 'number' ? r.version : 1,
    rev: cloudRev,
  };
}

// (A type alias, not an interface: the client takes any plain record.)
type SaveRow = {
  user_id: string;
  data: SaveData;
  client_updated_at: string;
  version: number;
  /** The revision this write is based on (1 for the first write); left out when it is not known. */
  rev?: number;
};

function rowOf(ctx: CloudContext, uid: string): SaveRow {
  const stamp = ctx.save.updatedAt || new Date().toISOString();
  const row: SaveRow = { user_id: uid, data: ctx.save, client_updated_at: stamp, version: 1 };
  if (cloudRev !== undefined) row.rev = cloudRev ?? 1;
  return row;
}

/** The write landed: the row's revision is now one past the base (a first write keeps the 1 it was given). */
function bumpRev(row: SaveRow): void {
  if (row.rev !== undefined) cloudRev = cloudRev === null ? row.rev : row.rev + 1;
}

/** A write was refused because another device moved the row: the caller fetches it and decides again. */
class StaleSave extends Error {}

async function push(): Promise<boolean> {
  const c = await getClient();
  const s = session;
  const ctx = ctxRef;
  if (!c || !s || !ctx) return false;
  const row = rowOf(ctx, s.user.id);
  const stamp = ms(row.client_updated_at);
  noteSent(s.user.id, stamp);
  const { error } = await c.from('saves').upsert(row, { onConflict: 'user_id' });
  if (error) {
    // (A refused write changed nothing. Any other failure may still have landed: its stamp stays noted.)
    if (isStale(error)) {
      dropSent(s.user.id, stamp);
      throw new StaleSave(error.message);
    }
    throw new Error(error.message);
  }
  // (The account changed while the write was on its way: its marker is not this session's business any more.)
  if (session?.user.id !== s.user.id) return false;
  bumpRev(row);
  clearSent(s.user.id);
  writeMark(s.user.id, stamp);
  seenUpdatedAt = ctx.save.updatedAt ?? '';
  // A persist during the request leaves it dirty; the queue pushes again.
  if ((ctx.save.updatedAt ?? '') === row.client_updated_at) dirty = false;
  if (lastError) toast('Cloud sync is back', 'good');
  lastError = null;
  lastSynced = Date.now();
  paused = false;
  return true;
}

function applyRow(ctx: CloudContext, row: CloudRow): void {
  unsettled = false;
  ctx.reload(row.data);
  ctx.persist();
  seenUpdatedAt = ctx.save.updatedAt ?? '';
  if (session) writeMark(session.user.id, row.clientUpdatedAt ?? row.updatedAt ?? 0);
  lastSynced = Date.now();
  // The re-stamped local copy goes back up so both sides carry the same timestamp from here on.
  dirty = true;
  paused = false;
  schedulePush();
}

// ------------------------------------------------------------------ queue

const offline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

function schedulePush(delay = PUSH_DEBOUNCE_MS): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void flush();
  }, delay);
}

function scheduleRetry(fn: () => void, delay = RETRY_MS): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    fn();
  }, delay);
}

async function flush(): Promise<boolean> {
  if (!dirty || holding || paused || unsettled || !session || !ctxRef) return false;
  if (offline()) {
    notify();
    return false;
  }
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      return await push();
    } catch (err) {
      if (err instanceof StaleSave) {
        // Another device wrote the row since this one last looked: fetch it and decide again (nothing is lost:
        // the local save is untouched and still marked as waiting).
        if (ctxRef) void resync();
        return false;
      }
      // One toast per outage, not one per retry.
      if (!lastError) fail('Cloud sync failed, will keep trying', err);
      lastError = message(err);
      scheduleRetry(() => void flush());
      return false;
    } finally {
      inflight = null;
      notify();
      if (again) {
        again = false;
        schedulePush(0);
      }
    }
  })();
  notify();
  return inflight;
}

/** The save changed (the game's own persist() is noticed anyway; call this for an immediate note). */
export function markDirty(): void {
  if (!session || !ctxRef) return;
  // Acknowledge the current stamp so the watcher doesn't note the same change again and restart the debounce.
  seenUpdatedAt = ctxRef.save.updatedAt ?? '';
  dirty = true;
  schedulePush();
  notify();
}

function checkLocal(): void {
  if (!ctxRef) return;
  const u = ctxRef.save.updatedAt ?? '';
  if (u !== seenUpdatedAt) {
    seenUpdatedAt = u;
    markDirty();
  }
}

/**
 * A moment worth syncing at once (full time): whatever the save moved goes up now instead of after the usual
 * wait. Offline it stays queued and goes up with the `online` event, so a played match is never lost.
 */
export function syncSoon(): void {
  if (!session || !ctxRef) return;
  checkLocal();
  if (dirty) schedulePush(300);
}

/** Push whatever is waiting and wait for the answer (true: the cloud row is up to date). Quiet: no toast. */
export async function flushNow(): Promise<boolean> {
  if (!session || !ctxRef) return false;
  checkLocal();
  if (!dirty) return true;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  return flush();
}

/** Compare this device's save with the cloud row again (back in the foreground, or after a refused write). */
export async function resync(): Promise<void> {
  if (!ctxRef || !session || busy || holding) return;
  await syncAfterSignIn(ctxRef, false, true);
}

/** Tab hiding / closing: one keepalive upsert straight to PostgREST (supabase-js can't keepalive). */
function flushOnHide(): void {
  checkLocal();
  const s = session;
  const ctx = ctxRef;
  if (!dirty || holding || paused || unsettled || !s || !ctx || offline()) return;
  const e = env();
  const token = s.access_token;
  if (!e.url || !e.key || !token || typeof fetch === 'undefined') return;
  const row = rowOf(ctx, s.user.id);
  const body = JSON.stringify(row);
  if (body.length > KEEPALIVE_MAX_BYTES) {
    void flush();
    return;
  }
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  // (Noted first: if the app is closed before the answer, the next launch knows the cloud row may be this push.)
  const stamp = ms(row.client_updated_at);
  noteSent(s.user.id, stamp);
  try {
    void fetch(`${e.url.replace(/\/+$/, '')}/rest/v1/saves?on_conflict=user_id`, {
      method: 'POST',
      keepalive: true,
      body,
      headers: {
        apikey: e.key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
    })
      .then((r) => {
        // Only a confirmed write advances the marker: an unconfirmed one stays dirty, so the next boot's
        // three-way compare pushes it again instead of pulling the older cloud copy over it.
        if (!r.ok) {
          // Refused as stale (another device moved the row): nothing was written, so there is no answer to wait for.
          if (r.status === 409) dropSent(s.user.id, stamp);
          return;
        }
        bumpRev(row);
        clearSent(s.user.id);
        writeMark(s.user.id, stamp);
        if ((ctx.save.updatedAt ?? '') === row.client_updated_at) dirty = false;
        lastSynced = Date.now();
        notify();
      })
      .catch(() => {});
  } catch {
    // Leave it dirty.
  }
}

/** Back in the foreground: push what waited, and after a while away look at the cloud row again. */
function onResume(): void {
  if (!session || !ctxRef) return;
  if (dirty) schedulePush(0);
  if (!offline() && Date.now() - lastCheck > RESUME_CHECK_MS) void resync();
}

function installListeners(): void {
  if (listenersOn || typeof window === 'undefined') return;
  listenersOn = true;
  watchTimer = setInterval(checkLocal, WATCH_MS);
  window.addEventListener('online', () => {
    if (dirty) schedulePush(0);
    notify();
  });
  window.addEventListener('offline', () => notify());
  window.addEventListener('pagehide', flushOnHide);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushOnHide();
      else onResume();
    });
  }
}

// ------------------------------------------------------------------ boot + sign-in sync

/** True when the page is an auth callback (code / tokens in the URL); strips them and reports errors. */
function cleanCallbackUrl(): boolean {
  if (typeof location === 'undefined' || typeof history === 'undefined') return false;
  try {
    const u = new URL(location.href);
    let changed = false;
    let wasCallback = false;
    const desc = u.searchParams.get('error_description') ?? new URLSearchParams(u.hash.replace(/^#/, '')).get('error_description');
    for (const k of ['code', 'error', 'error_code', 'error_description']) {
      if (u.searchParams.has(k)) {
        if (k === 'code') wasCallback = true;
        u.searchParams.delete(k);
        changed = true;
      }
    }
    if (/(^|[#&])(access_token|refresh_token|error_description|type)=/.test(u.hash)) {
      wasCallback = wasCallback || /access_token=/.test(u.hash);
      u.hash = '';
      changed = true;
    }
    if (changed) history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`);
    if (desc) toast(`Sign-in failed: ${desc.replace(/\+/g, ' ')}`, 'bad');
    return wasCallback;
  } catch {
    return false;
  }
}

/** On boot: if signed in, pull the newer of local/cloud; afterwards push local changes (debounced). */
export async function cloudBoot(ctx: CloudContext): Promise<void> {
  ctxRef = ctx;
  seenUpdatedAt = ctx.save.updatedAt ?? '';
  if (!cloudAvailable()) return;
  installListeners();
  try {
    const c = await getClient();
    if (!c) return;
    const { data, error } = await c.auth.getSession();
    if (error) throw new Error(error.message);
    session = data.session;
    notify();
    const returned = cleanCallbackUrl();
    if (!session) return;
    await syncAfterSignIn(ctx, returned);
  } catch (err) {
    fail('Cloud sync is unavailable right now', err);
  }
}

/**
 * Compare this device's save with the account's cloud row and settle it: push, pull, nothing, or (two real saves
 * that both moved) ask the player once. `quiet`: a silent sign-in or a re-check, so the first backup is not announced.
 */
async function syncAfterSignIn(ctx: CloudContext, announce: boolean, quiet = false): Promise<void> {
  const c = await getClient();
  const s = session;
  // A "which save?" panel is already up: its answer settles everything; a second pass would stack another.
  if (!c || !s || holding) return;
  const uid = s.user.id;
  busy = true;
  paused = false;
  notify();
  try {
    const row = await fetchRow(c, uid);
    lastCheck = Date.now();
    const cloudTs = row ? row.clientUpdatedAt ?? row.updatedAt ?? 0 : null;
    const decision = decideSync(ctx.save, row, baseFor(readMark(uid), readSent(uid), cloudTs));
    if (announce) toast(`Signed in as ${cloudUser()?.name ?? 'player'}`, 'good');
    unsettled = decision === 'ask';
    if (decision === 'push' || !row) {
      dirty = true;
      await push();
      if (!row && !quiet) toast('Progress backed up to the cloud', 'good');
    } else if (decision === 'none') {
      writeMark(uid, row.clientUpdatedAt ?? row.updatedAt ?? ms(ctx.save.updatedAt));
      clearSent(uid);
      lastSynced = Date.now();
    } else if (decision === 'pull') {
      applyRow(ctx, row);
      toast('Loaded your cloud save', 'good');
    } else {
      await askPlayer(ctx, row);
    }
    lastError = null;
  } catch (err) {
    if (err instanceof StaleSave) {
      // The row moved between the read and the write (two devices at once): look again shortly.
      scheduleRetry(() => void syncAfterSignIn(ctx, false, true), 1500);
    } else {
      lastError = message(err);
      fail('Cloud sync failed, will keep trying', err);
      scheduleRetry(() => void syncAfterSignIn(ctx, false, quiet));
    }
  } finally {
    busy = false;
    notify();
  }
}

/**
 * Take a session an edge function handed back (Game Center or device sign-in: src/platform/signin.ts), then
 * settle the save as after any sign-in. A different account than before compares against its own marker, so a
 * device that moves to another account never overwrites that account's progress unasked.
 */
export async function adoptSession(t: { access_token: string; refresh_token: string }): Promise<boolean> {
  const c = await getClient();
  if (!c?.auth.setSession) return false;
  try {
    const { data, error } = await c.auth.setSession(t);
    if (error || !data.session) {
      console.warn('[cloud] could not take the session:', error?.message ?? 'no session');
      return false;
    }
    if (data.session.user.id !== session?.user.id) {
      cloudRev = undefined;
      unsettled = false;
    }
    session = data.session;
    signedOutByPlayer = false;
    notify();
    if (ctxRef) await syncAfterSignIn(ctxRef, false, true);
    return true;
  } catch (err) {
    console.warn('[cloud] could not take the session:', err);
    return false;
  }
}

export interface FunctionResult<T> {
  ok: boolean;
  /** HTTP status (0: the request never got there). */
  status: number;
  data: T | null;
  /** The function's own error word ('rate_limited', 'bad_signature', ...), 'network', or 'unavailable'. */
  error: string | null;
}

/**
 * Call an edge function (supabase/functions). The publishable key always goes in `apikey`; the player's access
 * token goes in Authorization when he is signed in (`auth: false` leaves it out).
 */
export async function callFunction<T = Record<string, unknown>>(name: string, body: unknown, opts: { auth?: boolean; timeoutMs?: number } = {}): Promise<FunctionResult<T>> {
  const ep = cloudEndpoint();
  if (!ep || typeof fetch === 'undefined') return { ok: false, status: 0, data: null, error: 'unavailable' };
  const headers: Record<string, string> = { apikey: ep.key, 'Content-Type': 'application/json' };
  if (opts.auth !== false && session) {
    // (getSession refreshes a token that ran out while the app slept.)
    try {
      const fresh = (await (await getClient())?.auth.getSession())?.data.session;
      if (fresh) session = fresh;
    } catch {
      // The token in hand is tried as it is.
    }
    if (session) headers.Authorization = `Bearer ${session.access_token}`;
  }
  const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000) : null;
  try {
    const r = await fetch(`${ep.url}/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}), signal: ctl?.signal });
    const data = (await r.json().catch(() => null)) as (T & { error?: unknown }) | null;
    if (r.ok) return { ok: true, status: r.status, data, error: null };
    return { ok: false, status: r.status, data: null, error: typeof data?.error === 'string' ? data.error : String(r.status) };
  } catch {
    return { ok: false, status: 0, data: null, error: 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CloudProfile {
  /** The friend code to share. */
  code: string;
  club: string | null;
}

/** The player's profile row (made on first use): the friend code; the club's name is stored with it. */
export async function cloudProfile(): Promise<CloudProfile | null> {
  const c = await getClient();
  if (!c?.rpc || !session) return null;
  const name = ctxRef ? peekCareer(ctxRef.save)?.club?.name : null;
  try {
    const { data, error } = await c.rpc('my_profile', { p_club: typeof name === 'string' && name.trim() ? name.trim() : null });
    const p = data as { referral_code?: unknown; club_name?: unknown } | null;
    if (error || !p || typeof p.referral_code !== 'string') return null;
    return { code: p.referral_code, club: typeof p.club_name === 'string' ? p.club_name : null };
  } catch {
    return null;
  }
}

/** The auth library's own stored session (its key is `sb-<project ref>-auth-token`), removed by hand. */
function dropStoredSession(): void {
  try {
    const ref = new URL(env().url ?? '').hostname.split('.')[0];
    if (ref) localStorage.removeItem(`sb-${ref}-auth-token`);
  } catch {
    // No URL or no storage: nothing is stored.
  }
}

/**
 * The account is gone on the server (DELETE ACCOUNT): drop the session and every trace of it on this device. The
 * caller resets the save itself.
 */
export async function forgetAccount(): Promise<void> {
  if (pushTimer) clearTimeout(pushTimer);
  if (retryTimer) clearTimeout(retryTimer);
  pushTimer = retryTimer = null;
  // Nothing signs him back in by itself this session: a new account is made only when he asks to connect again (or
  // on the next launch). Set first: the auth library announces the sign-out during the call, and the silent sign-in
  // is listening.
  signedOutByPlayer = true;
  const uid = session?.user.id;
  try {
    const { error } = (await (await getClient())?.auth.signOut({ scope: 'local' })) ?? { error: null };
    // (The account is gone, so the server may refuse the call: the stored session must not outlive it.)
    if (error) dropStoredSession();
  } catch {
    dropStoredSession();
  }
  session = null;
  if (uid) storeSent(uid, []);
  dirty = false;
  paused = false;
  unsettled = false;
  lastSynced = null;
  lastError = null;
  cloudRev = undefined;
  clearMark();
  notify();
}

async function panelModule(): Promise<typeof import('../ui/account') | null> {
  if (typeof document === 'undefined') return null;
  // (The literal check lets the bundler drop the account screens, and the sign-in code they use, from a portal build.)
  if (import.meta.env.VITE_PORTAL && import.meta.env.VITE_PORTAL !== 'none') return null;
  try {
    return await import('../ui/account');
  } catch (err) {
    fail('Could not open the account panel', err);
    return null;
  }
}

async function askPlayer(ctx: CloudContext, row: CloudRow): Promise<void> {
  const ui = await panelModule();
  if (!ui) return;
  holding = true;
  notify();
  try {
    const choice = await new Promise<'cloud' | 'device'>((resolve) =>
      ui.openSyncChoice(summarize(row.data, row.clientUpdatedAt ?? row.updatedAt), summarize(ctx.save, ms(ctx.save.updatedAt)), resolve),
    );
    holding = false;
    unsettled = false;
    if (choice === 'cloud') {
      applyRow(ctx, row);
      toast('Loaded your cloud save', 'good');
    } else {
      dirty = true;
      await push();
      toast("Keeping this device's save", 'good');
    }
  } finally {
    holding = false;
  }
}

// ------------------------------------------------------------------ account actions (src/ui/account.ts)

const NOT_SET_UP = 'Cloud saves are not set up in this build';

function pageUrl(): string {
  return typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`;
}

export const PROVIDER_LABEL: { readonly [k in OAuthProvider]: string } = { google: 'Google', github: 'GitHub' };

/** Send the browser to Google / GitHub; the session arrives on the way back (cloudBoot handles it). */
export async function signInWith(provider: OAuthProvider): Promise<boolean> {
  const c = await getClient();
  if (!c) {
    toast(NOT_SET_UP, 'bad');
    return false;
  }
  const { error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo: pageUrl() } });
  if (error) {
    fail(`${PROVIDER_LABEL[provider]} sign-in failed`, error);
    return false;
  }
  return true;
}

/** Email a one-tap sign-in link. */
export async function signInWithEmail(email: string): Promise<boolean> {
  const c = await getClient();
  if (!c) {
    toast(NOT_SET_UP, 'bad');
    return false;
  }
  const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: pageUrl() } });
  if (error) {
    fail('Could not send the link', error);
    return false;
  }
  toast('Check your email for the sign-in link', 'good');
  return true;
}

/** An anonymous account: progress is protected now; a provider can be added later. */
export async function signInAsGuest(): Promise<boolean> {
  const c = await getClient();
  if (!c) {
    toast(NOT_SET_UP, 'bad');
    return false;
  }
  const { data, error } = await c.auth.signInAnonymously();
  if (error || !data.session) {
    fail('Guest sign-in failed', error ?? new Error('no session'));
    return false;
  }
  session = data.session;
  signedOutByPlayer = false;
  cloudRev = undefined;
  notify();
  if (ctxRef) await syncAfterSignIn(ctxRef, false);
  toast('Guest account ready: progress is backed up', 'good');
  return true;
}

/** Guest -> Google / GitHub (the project must allow manual linking; see supabase/README.md). */
export async function upgradeGuest(provider: OAuthProvider): Promise<boolean> {
  const c = await getClient();
  if (!c || !session) return false;
  const { error } = await c.auth.linkIdentity({ provider, options: { redirectTo: pageUrl() } });
  if (error) {
    fail(`Could not add ${PROVIDER_LABEL[provider]}`, error);
    return false;
  }
  return true;
}

/** Guest -> email: a confirmation link makes the account permanent. */
export async function upgradeGuestEmail(email: string): Promise<boolean> {
  const c = await getClient();
  if (!c || !session) return false;
  const { error } = await c.auth.updateUser({ email: email.trim() }, { emailRedirectTo: pageUrl() });
  if (error) {
    fail('Could not add that email', error);
    return false;
  }
  toast('Confirm the link in your email to keep this account', 'good');
  return true;
}

/** Sign out on this device only; the local save stays. */
export async function signOutCloud(): Promise<boolean> {
  const c = await getClient();
  if (!c) return false;
  if (dirty && !offline()) {
    try {
      await flush();
    } catch {
      // Best effort: the local save is kept either way.
    }
  }
  // (Set first: the auth library announces the sign-out during the call, and the silent sign-in is listening.)
  signedOutByPlayer = true;
  const { error } = await c.auth.signOut({ scope: 'local' });
  if (error) {
    signedOutByPlayer = false;
    fail('Sign-out failed', error);
    return false;
  }
  // The marker stays (it is per user): signing back in on this device compares three ways, no question asked.
  session = null;
  cloudRev = undefined;
  unsettled = false;
  dirty = false;
  paused = false;
  lastSynced = null;
  lastError = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  notify();
  toast('Signed out: your progress stays on this device');
  return true;
}

/** Push this device's save now. */
export async function syncNow(ctx: CloudContext): Promise<boolean> {
  ctxRef = ctx;
  if (!session) return false;
  if (offline()) {
    toast('You are offline: it will sync when you are back', 'bad');
    return false;
  }
  busy = true;
  paused = false;
  // (SYNC NOW is the player's own word: this device's save goes up.)
  unsettled = false;
  notify();
  try {
    dirty = true;
    const ok = await push();
    if (ok) toast('Synced', 'good');
    return ok;
  } catch (err) {
    lastError = message(err);
    fail('Sync failed', err);
    return false;
  } finally {
    busy = false;
    notify();
  }
}

/** Replace this device's save with the cloud copy (the panel confirms first). */
export async function loadFromCloud(ctx: CloudContext): Promise<boolean> {
  ctxRef = ctx;
  const c = await getClient();
  const s = session;
  if (!c || !s) return false;
  busy = true;
  notify();
  try {
    const row = await fetchRow(c, s.user.id);
    if (!row) {
      toast('No cloud save yet', 'bad');
      return false;
    }
    applyRow(ctx, row);
    toast('Loaded your cloud save', 'good');
    return true;
  } catch (err) {
    fail('Could not load the cloud save', err);
    return false;
  } finally {
    busy = false;
    notify();
  }
}

/** Delete the cloud row; sync pauses until SYNC NOW or the next sign-in (the panel confirms first). */
export async function deleteCloudSave(): Promise<boolean> {
  const c = await getClient();
  const s = session;
  if (!c || !s) return false;
  busy = true;
  notify();
  try {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    const { error } = await c.from('saves').delete().eq('user_id', s.user.id);
    if (error) throw new Error(error.message);
    cloudRev = null;
    dirty = false;
    paused = true;
    clearMark();
    lastSynced = null;
    toast('Cloud save deleted; sync is paused until SYNC NOW');
    return true;
  } catch (err) {
    fail('Could not delete the cloud save', err);
    return false;
  } finally {
    busy = false;
    notify();
  }
}

/** Open the account / cloud-sync panel (sign in, sync status, sign out). */
export function openAccount(ctx: CloudContext, onClose: () => void): void {
  ctxRef = ctx;
  if (typeof document === 'undefined') {
    onClose();
    return;
  }
  void panelModule()
    .then((m) => {
      if (m) m.openAccountPanel(ctx, onClose);
      else onClose();
    })
    .catch((err) => {
      fail('Could not open the account panel', err);
      onClose();
    });
}

// ------------------------------------------------------------------ toasts

export type CloudToastKind = 'info' | 'good' | 'bad';

function toast(msg: string, kind: CloudToastKind = 'info'): void {
  void panelModule()
    .then((m) => m?.cloudToast(msg, kind))
    .catch(() => {});
}

/** A small line at the top of the screen (for src/platform/signin.ts: a friend joined, and the like). */
export function cloudNotice(msg: string, kind: CloudToastKind = 'info'): void {
  toast(msg, kind);
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

function fail(msg: string, err: unknown): void {
  console.warn(`[cloud] ${msg}:`, err);
  toast(msg, 'bad');
}

// ------------------------------------------------------------------ test hooks

export function _setEnvForTests(e: Env | null): void {
  envOverride = e;
}

export function _setClientForTests(c: CloudClient | null): void {
  clientOverride = c;
  client = null;
  clientLoading = null;
}

export function _resetForTests(): void {
  if (pushTimer) clearTimeout(pushTimer);
  if (retryTimer) clearTimeout(retryTimer);
  if (watchTimer) clearInterval(watchTimer);
  pushTimer = retryTimer = watchTimer = null;
  client = clientOverride = null;
  clientLoading = null;
  session = null;
  ctxRef = null;
  seenUpdatedAt = '';
  cloudRev = undefined;
  lastCheck = 0;
  signedOutByPlayer = false;
  unsettled = false;
  dirty = holding = paused = busy = false;
  inflight = null;
  again = false;
  lastSynced = null;
  lastError = null;
  listenersOn = false;
  subs.clear();
}

export function _debugState(): { dirty: boolean; timer: boolean; holding: boolean; paused: boolean; signedIn: boolean; unsettled: boolean } {
  return { dirty, timer: pushTimer !== null, holding, paused, signedIn: session !== null, unsettled };
}
