import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { defaultSave, type SaveData } from '../src/core/save';
import {
  PUSH_DEBOUNCE_MS, SYNC_MARK_KEY, WATCH_MS, _debugState, _resetForTests, _setClientForTests, _setEnvForTests, careerScore, cloudAvailable,
  cloudBoot, cloudStatus, cloudUser, decideSync, deleteCloudSave, isSmall, markDirty, ms, normalizeCloud, openAccount, sameSave, signOutCloud,
  summarize, syncNow, type CloudClient, type CloudContext, type CloudRow,
} from '../src/platform/cloud';

const ENV = { url: 'https://example.supabase.co', key: 'anon-key' };

// ------------------------------------------------------------------ fixtures

const T0 = '2026-09-27T10:00:00.000Z';
const T1 = '2026-09-27T11:00:00.000Z';
const T2 = '2026-09-27T12:00:00.000Z';

const at = (iso: string, o: Partial<SaveData> = {}): SaveData => ({ ...defaultSave(), ...o, updatedAt: iso });

/** A save with real progress: coins, XP, matches. */
const rich = (iso: string, o: Partial<SaveData> = {}): SaveData =>
  at(iso, { coins: 5000, progress: { ...defaultSave().progress, xp: 900 }, record: { ...defaultSave().record, played: 12, won: 8 }, ...o });

const career = (season: number, matchday: number, history = 0): unknown => ({
  version: 1, seed: 1, club: { name: 'Voxel United' }, season: { number: season, matchday }, history: new Array(history).fill({}), stadium: 0,
});

const row = (data: SaveData, iso: string | null = data.updatedAt): CloudRow => ({ data, clientUpdatedAt: iso ? ms(iso) : null, updatedAt: iso ? ms(iso) : null, version: 1 });

function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
}

function stubDom(): { win: EventTarget; nav: { onLine: boolean } } {
  const win = new EventTarget();
  const nav = { onLine: true };
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', nav);
  // No `document` unless a test stubs it: panels and toasts are DOM-only and must be skipped cleanly.
  return { win, nav };
}

function fakeSession(id = 'user-1', user: Record<string, unknown> = {}): Session {
  return {
    access_token: 'tok', refresh_token: 'r', expires_in: 3600, token_type: 'bearer',
    user: { id, aud: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Sam Player' }, email: 'sam@example.com', created_at: T0, ...user },
  } as unknown as Session;
}

interface FakeOpts {
  session?: Session | null;
  row?: Record<string, unknown> | null;
}

/** The slice of supabase-js cloud.ts uses, with call counters. */
function fakeClient(opts: FakeOpts = {}) {
  const calls = { upserts: [] as Record<string, unknown>[], selects: 0, deletes: 0, signOuts: 0 };
  let row: Record<string, unknown> | null = opts.row ?? null;
  let failUpserts = false;
  const client: CloudClient = {
    auth: {
      getSession: async () => ({ data: { session: opts.session ?? null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ error: null }),
      signInWithOtp: async () => ({ error: null }),
      signInAnonymously: async () => ({ data: { session: opts.session ?? null }, error: null }),
      linkIdentity: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      signOut: async () => {
        calls.signOuts++;
        return { error: null };
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => {
        calls.selects++;
        return { data: row, error: null };
      } }) }),
      upsert: async (r) => {
        calls.upserts.push(r);
        if (failUpserts) return { error: { message: 'boom' } };
        row = { data: r.data, client_updated_at: r.client_updated_at, updated_at: new Date().toISOString(), version: 1 };
        return { error: null };
      },
      delete: () => ({ eq: async () => {
        calls.deletes++;
        row = null;
        return { error: null };
      } }),
    }),
  };
  return { client, calls, get row() { return row; }, fail(v: boolean) { failUpserts = v; } };
}

function makeCtx(save: SaveData) {
  const ctx: CloudContext & { persists: number; reloads: SaveData[] } = {
    save, persists: 0, reloads: [],
    persist() {
      this.persists++;
      // writeSave stamps a fresh updatedAt on every persist (a real save.ts does this).
      this.save.updatedAt = new Date().toISOString();
    },
    reload(d) {
      this.reloads.push(d);
      Object.assign(this.save, d);
    },
  };
  return ctx;
}

afterEach(() => {
  _resetForTests();
  _setEnvForTests(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ------------------------------------------------------------------ availability

describe('cloudAvailable', () => {
  it('is false without the two env values (the test env has none)', () => {
    expect(cloudAvailable()).toBe(false);
    _setEnvForTests({});
    expect(cloudAvailable()).toBe(false);
    _setEnvForTests({ url: ENV.url });
    expect(cloudAvailable()).toBe(false);
    _setEnvForTests({ key: ENV.key });
    expect(cloudAvailable()).toBe(false);
  });

  it('is true with both values on the web build, false on every portal build', () => {
    _setEnvForTests({ ...ENV });
    expect(cloudAvailable()).toBe(true);
    _setEnvForTests({ ...ENV, portal: 'none' });
    expect(cloudAvailable()).toBe(true);
    for (const portal of ['crazygames', 'poki']) {
      _setEnvForTests({ ...ENV, portal });
      expect(cloudAvailable()).toBe(false);
    }
  });

  it('is false in dev when ?portal= previews a portal build', () => {
    _setEnvForTests({ ...ENV, query: '?portal=poki' });
    expect(cloudAvailable()).toBe(false);
    _setEnvForTests({ ...ENV, query: '?quick=1' });
    expect(cloudAvailable()).toBe(true);
  });
});

// ------------------------------------------------------------------ the exported API (the UI wires against exactly this)

describe('API shape', () => {
  it('matches the skeleton signatures', () => {
    const api: {
      cloudAvailable: () => boolean;
      cloudUser: () => { name: string; provider: string } | null;
      openAccount: (ctx: CloudContext, onClose: () => void) => void;
      cloudBoot: (ctx: CloudContext) => Promise<void>;
    } = { cloudAvailable, cloudUser, openAccount, cloudBoot };
    expect(typeof api.cloudAvailable()).toBe('boolean');
    expect(api.cloudUser()).toBeNull();
    expect(api.cloudBoot.length).toBe(1);
    expect(api.openAccount.length).toBe(2);
  });

  it('openAccount without a DOM closes at once; cloudBoot is a no-op when unavailable', async () => {
    const ctx = makeCtx(at(T0));
    const onClose = vi.fn();
    openAccount(ctx, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
    const fake = fakeClient({ session: fakeSession() });
    _setClientForTests(fake.client);
    await cloudBoot(ctx);
    expect(fake.calls.selects).toBe(0);
    expect(cloudUser()).toBeNull();
  });
});

// ------------------------------------------------------------------ merge rules

describe('decideSync', () => {
  it('pushes when the cloud has no row yet', () => {
    expect(decideSync(at(T0), null, null)).toBe('push');
  });

  it('does nothing when both hold the same progress, whatever the timestamps', () => {
    expect(decideSync(rich(T0), row(rich(T2)), null)).toBe('none');
    expect(sameSave(rich(T0), rich(T2))).toBe(true);
    expect(sameSave(rich(T0), rich(T0, { coins: 1 }))).toBe(false);
  });

  it('three-way: only the side that moved since the marker wins', () => {
    const base = ms(T0);
    // Local moved, cloud did not -> push.
    expect(decideSync(rich(T1, { coins: 9 }), row(rich(T0)), base)).toBe('push');
    // Cloud moved, local did not -> pull.
    expect(decideSync(rich(T0), row(rich(T1, { coins: 9 })), base)).toBe('pull');
    // Neither moved but the data differs (normalisation drift): the running copy refreshes the cloud.
    expect(decideSync(rich(T0, { coins: 9 }), row(rich(T0)), base)).toBe('push');
  });

  it('three-way conflict (both moved): a barely-started side gives way, two real saves ask', () => {
    const base = ms(T0);
    // Both moved; the device has not played yet -> the cloud wins (even though the device is "newer" is irrelevant).
    expect(decideSync(at(T1, { coins: 600 }), row(rich(T2)), base)).toBe('pull');
    expect(decideSync(at(T2, { coins: 600 }), row(rich(T1)), base)).toBe('pull');
    // Both moved; the cloud row has not played yet -> the device goes up.
    expect(decideSync(rich(T2, { coins: 9000 }), row(at(T1, { coins: 600 })), base)).toBe('push');
    expect(decideSync(rich(T1, { coins: 9000 }), row(at(T2, { coins: 600 })), base)).toBe('push');
    // Both moved and both real (the newer cloud has fewer coins: it may have spent them) -> ask.
    expect(decideSync(rich(T1, { coins: 9000 }), row(rich(T2, { coins: 100 })), base)).toBe('ask');
  });

  it('first sync on a device (no marker): a fresh save is replaced by the cloud silently, whatever the dates', () => {
    expect(decideSync(defaultSave(), row(rich(T2)), null)).toBe('pull');
    expect(decideSync(at(T2), row(rich(T0)), null)).toBe('pull');
    // Daily-gift coins with no match played are still "barely started".
    expect(decideSync(at(T2, { coins: 900 }), row(rich(T0)), null)).toBe('pull');
    // A fresh cloud row next to a rich local save: the local one goes up.
    expect(decideSync(rich(T2), row(defaultSave(), T0), null)).toBe('push');
    expect(decideSync(rich(T0), row(defaultSave(), T2), null)).toBe('push');
    // Both barely started (settings changed on both, say): the newer wins.
    expect(decideSync(at(T1, { coins: 600 }), row(at(T2, { coins: 700 })), null)).toBe('pull');
    expect(decideSync(at(T2, { coins: 600 }), row(at(T1, { coins: 700 })), null)).toBe('push');
  });

  it('asks whenever both saves have real progress, however they compare', () => {
    // Different XP.
    expect(decideSync(rich(T2, { progress: { ...defaultSave().progress, xp: 10 } }), row(rich(T1)), null)).toBe('ask');
    // A career on one side only.
    expect(decideSync(rich(T1, { career: career(1, 3) }), row(rich(T2)), null)).toBe('ask');
    // A cup on one side only.
    expect(decideSync(rich(T2), row(rich(T1, { cup: { round: 2 } })), null)).toBe('ask');
    // Careers at different points.
    expect(decideSync(rich(T2, { career: career(1, 2) }), row(rich(T1, { career: career(2, 0) })), null)).toBe('ask');
    // Even when one is ahead on every count: coins can be spent, the career blob is opaque, so the player decides.
    expect(decideSync(rich(T2, { career: career(2, 1), cup: { round: 1 } }), row(rich(T1, { career: career(1, 6), cup: { round: 3 } })), null)).toBe('ask');
    // One match played is real progress.
    expect(decideSync(at(T2, { record: { ...defaultSave().record, played: 1 } }), row(rich(T1)), null)).toBe('ask');
  });

  it('isSmall / careerScore', () => {
    expect(isSmall(defaultSave())).toBe(true);
    expect(isSmall(at(T0, { coins: 9000 }))).toBe(true);
    expect(isSmall(rich(T0))).toBe(false);
    expect(isSmall(at(T0, { record: { ...defaultSave().record, played: 1 } }))).toBe(false);
    expect(isSmall(at(T0, { progress: { ...defaultSave().progress, xp: 40 } }))).toBe(false);
    expect(isSmall(at(T0, { career: career(1, 0) }))).toBe(false);
    expect(isSmall(at(T0, { career: { club: null } }))).toBe(true);
    expect(isSmall(at(T0, { cup: { round: 1 } }))).toBe(false);
    expect(careerScore(at(T0))).toBe(-1);
    expect(careerScore(at(T0, { career: { club: null } }))).toBe(-1);
    expect(careerScore(at(T0, { career: career(1, 4) }))).toBe(104);
    expect(careerScore(at(T0, { career: career(3, 0, 2) }))).toBe(20_300);
  });

  it('treats an unreadable timestamp as the oldest', () => {
    expect(ms(undefined)).toBe(0);
    expect(ms('nonsense')).toBe(0);
    expect(ms('2026-09-27 12:00:00+00')).toBe(ms(T2));
    expect(decideSync(at('', { coins: 600 }), row(rich(T2)), null)).toBe('pull');
  });
});

describe('normalizeCloud / summarize', () => {
  it('makes any payload a whole save (defaults for missing or damaged fields, version pinned)', () => {
    const d = normalizeCloud({ coins: -5, settings: { camZoom: 'huge', music: false }, progress: { xp: 'lots' }, cup: 'no', version: 7 });
    expect(d.version).toBe(1);
    expect(d.coins).toBe(0); // a negative count floors at 0; a non-number falls back to the default
    expect(normalizeCloud({ coins: 'lots' }).coins).toBe(defaultSave().coins);
    expect(d.settings.camZoom).toBe('normal');
    expect(d.settings.music).toBe(false);
    expect(d.progress.xp).toBe(0);
    expect(d.cup).toBeNull();
    expect(normalizeCloud(null).record.played).toBe(0);
    expect(normalizeCloud('junk').settings.sfx).toBe(true);
  });

  it('summarises level, coins, matches and the career line', () => {
    const s = summarize(rich(T1, { career: career(2, 5) }), ms(T1));
    expect(s.level).toBeGreaterThan(1);
    expect(s.coins).toBe(5000);
    expect(s.played).toBe(12);
    expect(s.career).toBe('Voxel United: season 2, 5 played');
    expect(s.when).toBe(ms(T1));
    expect(summarize(at(T0), null).career).toBe('No Road to Glory yet');
  });
});

// ------------------------------------------------------------------ boot, debounce and the queue (mocked client)

describe('cloudBoot + push queue', () => {
  let store: Map<string, string>;
  let dom: ReturnType<typeof stubDom>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T2));
    _resetForTests();
    _setEnvForTests({ ...ENV });
    store = stubStorage();
    dom = stubDom();
  });

  it('signed out: touches nothing', async () => {
    const fake = fakeClient({ session: null });
    _setClientForTests(fake.client);
    await cloudBoot(makeCtx(rich(T0)));
    expect(fake.calls.selects).toBe(0);
    expect(fake.calls.upserts).toHaveLength(0);
    expect(cloudUser()).toBeNull();
    expect(cloudStatus().available).toBe(true);
  });

  it('signed in with no cloud row: pushes the local save once and remembers the marker', async () => {
    const fake = fakeClient({ session: fakeSession() });
    _setClientForTests(fake.client);
    const ctx = makeCtx(rich(T0));
    await cloudBoot(ctx);
    expect(fake.calls.selects).toBe(1);
    expect(fake.calls.upserts).toHaveLength(1);
    expect(fake.calls.upserts[0]).toMatchObject({ user_id: 'user-1', client_updated_at: T0, version: 1 });
    expect(JSON.parse(store.get(SYNC_MARK_KEY)!)).toEqual({ user: 'user-1', synced: ms(T0) });
    expect(cloudUser()).toEqual({ name: 'Sam Player', provider: 'google', email: 'sam@example.com', guest: false });
    expect(_debugState().dirty).toBe(false);
  });

  it('a guest session reads as a guest', async () => {
    const fake = fakeClient({ session: fakeSession('anon-1', { is_anonymous: true, app_metadata: {}, user_metadata: {}, email: undefined }) });
    _setClientForTests(fake.client);
    await cloudBoot(makeCtx(rich(T0)));
    expect(cloudUser()).toMatchObject({ name: 'Guest', provider: 'guest', guest: true });
  });

  it('pushes 5 s after the last local change, once, however many changes came in between', async () => {
    const local = rich(T0);
    const fake = fakeClient({ session: fakeSession(), row: { data: local, client_updated_at: T0, updated_at: T0, version: 1 } });
    _setClientForTests(fake.client);
    const ctx = makeCtx(rich(T0));
    await cloudBoot(ctx);
    expect(fake.calls.upserts).toHaveLength(0); // identical: nothing to do

    // The game persists (writeSave stamps updatedAt); the watcher notices within WATCH_MS (t = 1.5 s).
    ctx.save.coins = 5100;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS);
    expect(_debugState()).toMatchObject({ dirty: true, timer: true });
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS - 1000); // t = 5.5 s: 4 s after the note, nothing yet
    expect(fake.calls.upserts).toHaveLength(0);

    // Another change (persist + the explicit hook) restarts the 5 s; the watcher must not restart it again.
    ctx.save.coins = 5200;
    ctx.persist();
    markDirty();
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS - 100); // t = 10.4 s
    expect(fake.calls.upserts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200); // t = 10.6 s: one push, with the latest data
    expect(fake.calls.upserts).toHaveLength(1);
    expect((fake.calls.upserts[0].data as SaveData).coins).toBe(5200);
    expect(_debugState().dirty).toBe(false);
    expect(cloudStatus().lastSynced).not.toBeNull();

    // Quiet afterwards: the watcher has nothing new to note.
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS * 2);
    expect(fake.calls.upserts).toHaveLength(1);

    // A change noticed by the watcher alone.
    ctx.save.coins = 5300;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    expect(fake.calls.upserts).toHaveLength(2);
    expect((fake.calls.upserts[1].data as SaveData).coins).toBe(5300);
  });

  it('offline: queues, then pushes on the online event', async () => {
    const fake = fakeClient({ session: fakeSession(), row: { data: rich(T0), client_updated_at: T0, updated_at: T0, version: 1 } });
    _setClientForTests(fake.client);
    const ctx = makeCtx(rich(T0));
    await cloudBoot(ctx);
    dom.nav.onLine = false;
    ctx.save.coins = 7000;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    expect(fake.calls.upserts).toHaveLength(0);
    expect(cloudStatus()).toMatchObject({ offline: true, pending: true });
    dom.nav.onLine = true;
    dom.win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(10);
    expect(fake.calls.upserts).toHaveLength(1);
    expect(cloudStatus().pending).toBe(false);
  });

  it('a failed push is retried after 30 s and clears the error once it lands', async () => {
    const fake = fakeClient({ session: fakeSession(), row: { data: rich(T0), client_updated_at: T0, updated_at: T0, version: 1 } });
    _setClientForTests(fake.client);
    const ctx = makeCtx(rich(T0));
    await cloudBoot(ctx);
    fake.fail(true);
    ctx.save.coins = 8000;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    expect(fake.calls.upserts).toHaveLength(1);
    expect(cloudStatus()).toMatchObject({ pending: true, lastError: 'boom' });
    fake.fail(false);
    await vi.advanceTimersByTimeAsync(30_000 + 10);
    expect(fake.calls.upserts).toHaveLength(2);
    expect(cloudStatus()).toMatchObject({ pending: false, lastError: null });
  });

  it('a fresh device with a richer cloud row loads it silently, persists, and syncs the re-stamped copy back', async () => {
    const cloud = rich(T1, { coins: 4242 });
    const fake = fakeClient({ session: fakeSession(), row: { data: cloud, client_updated_at: T1, updated_at: T1, version: 1 } });
    _setClientForTests(fake.client);
    const ctx = makeCtx(defaultSave());
    await cloudBoot(ctx);
    expect(ctx.reloads).toHaveLength(1);
    expect(ctx.reloads[0].coins).toBe(4242);
    expect(ctx.persists).toBe(1);
    expect(ctx.save.coins).toBe(4242);
    expect(JSON.parse(store.get(SYNC_MARK_KEY)!)).toEqual({ user: 'user-1', synced: ms(T1) });
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS + 10);
    expect(fake.calls.upserts).toHaveLength(1);
    expect((fake.calls.upserts[0].data as SaveData).coins).toBe(4242);
  });

  it('a device the account has synced with before pulls only when the cloud moved', async () => {
    store.set(SYNC_MARK_KEY, JSON.stringify({ user: 'user-1', synced: ms(T0) }));
    const fake = fakeClient({ session: fakeSession(), row: { data: rich(T1, { coins: 1 }), client_updated_at: T1, updated_at: T1, version: 1 } });
    _setClientForTests(fake.client);
    // Local has more coins but did not move since the marker: the cloud (moved) wins without asking.
    const ctx = makeCtx(rich(T0, { coins: 9999 }));
    await cloudBoot(ctx);
    expect(ctx.reloads).toHaveLength(1);
    expect(ctx.save.coins).toBe(1);
  });

  it('a conflict nobody can settle is left to the player; without a DOM nothing is pushed or pulled', async () => {
    const fake = fakeClient({ session: fakeSession(), row: { data: rich(T2, { coins: 100 }), client_updated_at: T2, updated_at: T2, version: 1 } });
    _setClientForTests(fake.client);
    const ctx = makeCtx(rich(T1, { coins: 9000 }));
    await cloudBoot(ctx);
    expect(ctx.reloads).toHaveLength(0);
    expect(fake.calls.upserts).toHaveLength(0);
    expect(_debugState()).toMatchObject({ dirty: false, holding: false });
    expect(store.has(SYNC_MARK_KEY)).toBe(false);
  });

  it('hiding the tab sends one keepalive upsert straight to PostgREST', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', doc);
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const fake = fakeClient({ session: fakeSession(), row: { data: rich(T0), client_updated_at: T0, updated_at: T0, version: 1 } });
    _setClientForTests(fake.client);
    const ctx = makeCtx(rich(T0));
    await cloudBoot(ctx);
    ctx.save.coins = 6000;
    ctx.persist();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://example.supabase.co/rest/v1/saves?on_conflict=user_id');
    expect(init.keepalive).toBe(true);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers.apikey).toBe('anon-key');
    expect(init.headers.Prefer).toContain('merge-duplicates');
    expect((JSON.parse(init.body as string) as { data: SaveData }).data.coins).toBe(6000);
    await vi.advanceTimersByTimeAsync(0);
    expect(_debugState().dirty).toBe(false);
    // The ordinary debounce was cancelled: no second upsert through the client.
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS + WATCH_MS);
    expect(fake.calls.upserts).toHaveLength(0);
  });

  it('SYNC NOW pushes; DELETE pauses sync until SYNC NOW; SIGN OUT keeps the local save and the marker', async () => {
    const fake = fakeClient({ session: fakeSession(), row: { data: rich(T0), client_updated_at: T0, updated_at: T0, version: 1 } });
    _setClientForTests(fake.client);
    const ctx = makeCtx(rich(T0));
    await cloudBoot(ctx);

    expect(await syncNow(ctx)).toBe(true);
    expect(fake.calls.upserts).toHaveLength(1);

    expect(await deleteCloudSave()).toBe(true);
    expect(fake.calls.deletes).toBe(1);
    expect(fake.row).toBeNull();
    expect(cloudStatus().paused).toBe(true);
    ctx.save.coins = 1;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    expect(fake.calls.upserts).toHaveLength(1); // paused: nothing went up

    expect(await syncNow(ctx)).toBe(true);
    expect(fake.calls.upserts).toHaveLength(2);
    expect(cloudStatus().paused).toBe(false);

    const coinsBefore = ctx.save.coins;
    expect(await signOutCloud()).toBe(true);
    expect(fake.calls.signOuts).toBe(1);
    expect(cloudUser()).toBeNull();
    expect(ctx.save.coins).toBe(coinsBefore);
    // Kept on purpose: signing back in on this device compares three ways instead of asking.
    expect(JSON.parse(store.get(SYNC_MARK_KEY)!)).toMatchObject({ user: 'user-1' });
  });
});
