/**
 * A test double for the backend (tests/cloudSync.test.ts, online.test.ts, signin.test.ts): the slice of supabase-js
 * that src/platform/cloud.ts calls, backed by one `saves` row per user that follows the real server's revision rule
 * (supabase/migrations/0002_accounts.sql saves_guard), plus sessions by access token and the edge functions through
 * a stubbed `fetch`. Not a test file itself.
 */
import { vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import type { SaveData } from '../src/core/save';
import type { CloudClient, CloudContext } from '../src/platform/cloud';

/** A build with a backend and accounts required (VITE_ONLINE_ACCOUNTS=on). */
export const ENV = { url: 'https://example.supabase.co', key: 'publishable-key', online: 'on' };

export function fakeSession(id = 'user-1', kind: 'device' | 'gamecenter' | 'google' = 'device'): Session {
  const app = kind === 'google' ? { provider: 'google' } : { provider: 'email', bl_kind: kind };
  const user = kind === 'google' ? { full_name: 'Sam Player' } : {};
  return {
    access_token: `tok-${id}`, refresh_token: `ref-${id}`, expires_in: 3600, token_type: 'bearer',
    user: { id, aud: 'authenticated', app_metadata: app, user_metadata: user, email: `${id}@players.blockyleague.invalid`, created_at: '2026-09-27T10:00:00.000Z' },
  } as unknown as Session;
}

export interface ServerRow {
  data: SaveData;
  client_updated_at: string | null;
  updated_at: string;
  version: number;
  rev: number;
}

export function fakeBackend() {
  const rows = new Map<string, ServerRow>();
  const sessions = new Map<string, Session>();
  const calls = { upserts: [] as Record<string, unknown>[], selects: 0, setSessions: 0, signOuts: 0, rpcs: [] as { fn: string; args?: Record<string, unknown> }[] };
  let current: Session | null = null;
  // Like the real library, sign-in and sign-out are announced to the listener while the call is still running.
  let announce: (event: string, session: Session | null) => void = () => {};
  let failUpserts = false;
  let loseAnswers = false;
  const snap = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  const client: CloudClient = {
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      onAuthStateChange: (cb) => {
        announce = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithOAuth: async () => ({ error: null }),
      signInWithOtp: async () => ({ error: null }),
      signInAnonymously: async () => ({ data: { session: null }, error: { message: 'anonymous sign-ins are off' } }),
      linkIdentity: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      signOut: async () => {
        calls.signOuts++;
        current = null;
        announce('SIGNED_OUT', null);
        await Promise.resolve();
        return { error: null };
      },
      setSession: async (t) => {
        calls.setSessions++;
        const s = sessions.get(t.access_token) ?? null;
        if (!s || s.refresh_token !== t.refresh_token) return { data: { session: null }, error: { message: 'invalid token' } };
        current = s;
        announce('SIGNED_IN', s);
        return { data: { session: s }, error: null };
      },
    },
    from: () => ({
      select: () => ({ eq: (_c: string, uid: string) => ({ maybeSingle: async () => {
        calls.selects++;
        const r = rows.get(uid);
        return { data: r ? snap(r) : null, error: null };
      } }) }),
      upsert: async (r) => {
        calls.upserts.push(snap(r));
        if (failUpserts) return { error: { message: 'boom' } };
        const uid = r.user_id as string;
        const old = rows.get(uid);
        // The server's rule: a write that names a revision other than the row's is refused; a write that names none passes.
        if (old && r.rev !== undefined && r.rev !== old.rev) return { error: { message: 'stale_save', code: 'PT409' } };
        rows.set(uid, {
          data: snap(r.data as SaveData), client_updated_at: (r.client_updated_at as string | undefined) ?? null, updated_at: new Date().toISOString(), version: 1,
          rev: old ? old.rev + 1 : Math.max(1, typeof r.rev === 'number' ? r.rev : 1),
        });
        // (The write landed but its answer never reached the device: a dropped connection, a closing app.)
        if (loseAnswers) return { error: { message: 'Failed to fetch' } };
        return { error: null };
      },
      delete: () => ({ eq: async (_c: string, uid: string) => {
        rows.delete(uid);
        return { error: null };
      } }),
    }),
    rpc: async (fn, args) => {
      calls.rpcs.push({ fn, args });
      if (fn === 'my_profile') return { data: { referral_code: 'ABC2345', club_name: (args?.p_club as string | null) ?? null }, error: null };
      return { data: null, error: { message: `no function ${fn}` } };
    },
  };

  return {
    client, rows, calls,
    /** A session the client already holds at boot (persisted from an earlier launch). */
    signIn(s: Session | null) {
      current = s;
      if (s) sessions.set(s.access_token, s);
    },
    /** A session an edge function may hand back (setSession accepts its tokens). */
    issue(s: Session): { access_token: string; refresh_token: string } {
      sessions.set(s.access_token, s);
      return { access_token: s.access_token, refresh_token: s.refresh_token };
    },
    /** Another device writes the row (the server bumps the revision). */
    otherDevice(uid: string, data: SaveData) {
      const old = rows.get(uid);
      rows.set(uid, { data: snap(data), client_updated_at: data.updatedAt, updated_at: data.updatedAt, version: 1, rev: (old?.rev ?? 0) + 1 });
    },
    fail(v: boolean) {
      failUpserts = v;
    },
    /** Writes land on the server but their answers are lost on the way back. */
    loseAnswers(v: boolean) {
      loseAnswers = v;
    },
    current: () => current,
  };
}

export function makeCtx(save: SaveData) {
  const ctx: CloudContext & { persists: number; reloads: SaveData[] } = {
    save, persists: 0, reloads: [],
    persist() {
      this.persists++;
      // writeSave stamps a fresh updatedAt on every persist (a real save.ts does this).
      this.save.updatedAt = new Date().toISOString();
    },
    reload(d) {
      this.reloads.push(d);
      for (const k of Object.keys(this.save)) delete (this.save as unknown as Record<string, unknown>)[k];
      Object.assign(this.save, d);
    },
  };
  return ctx;
}

export function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
}

/** `window` and `navigator` without a `document`: panels and toasts are DOM-only and skip themselves. */
export function stubDom(): { win: EventTarget; nav: { onLine: boolean } } {
  const win = new EventTarget();
  const nav = { onLine: true };
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', nav);
  return { win, nav };
}

export interface FunctionCall {
  name: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

type Handler = (call: FunctionCall) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>;

/** Edge functions through a stubbed `fetch`: `handlers[name]` answers POST <url>/functions/v1/<name>. */
export function stubFunctions(handlers: Record<string, Handler>) {
  const calls: FunctionCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const m = /\/functions\/v1\/([a-z-]+)$/.exec(String(url));
    if (!m) throw new TypeError(`unexpected fetch: ${url}`);
    const call: FunctionCall = { name: m[1], body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    const h = handlers[m[1]];
    if (!h) return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
    const r = await h(call);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.json };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}
