/**
 * Cloud saves as the source of truth (src/platform/cloud.ts): the revision rule (a write from a stale copy is
 * refused and settled again, never an overwrite), a push whose answer was lost, sessions handed back by the edge
 * functions, sync at full time and on coming back, and forgetting a deleted account. tests/cloud.test.ts holds the
 * merge rules themselves (decideSync); this file drives them through the test double in tests/cloudFake.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSave, type SaveData } from '../src/core/save';
import {
  PUSH_DEBOUNCE_MS, RESUME_CHECK_MS, SYNC_MARK_KEY, SYNC_SENT_KEY, WATCH_MS, _debugState, _resetForTests, _setClientForTests, _setEnvForTests,
  accountsRequired, adoptSession, baseFor, cloudBoot, cloudEndpoint, cloudProfile, cloudSession, cloudStatus, cloudUser, flushNow, forgetAccount, isStale,
  ms, syncSoon,
} from '../src/platform/cloud';
import { ENV, fakeBackend, fakeSession, makeCtx, stubDom, stubStorage } from './cloudFake';

const T0 = '2026-09-27T10:00:00.000Z';
const T1 = '2026-09-27T11:00:00.000Z';
const T2 = '2026-09-27T12:00:00.000Z';

const at = (iso: string, o: Partial<SaveData> = {}): SaveData => ({ ...defaultSave(), ...o, updatedAt: iso });
/** A save with real progress: coins, XP, matches. */
const rich = (iso: string, o: Partial<SaveData> = {}): SaveData =>
  at(iso, { coins: 5000, progress: { ...defaultSave().progress, xp: 900 }, record: { ...defaultSave().record, played: 12, won: 8 }, ...o });

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

afterEach(() => {
  _resetForTests();
  _setEnvForTests(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A device that has already synced `save` with `uid`'s row. */
async function synced(save: SaveData, uid = 'user-1') {
  const be = fakeBackend();
  be.signIn(fakeSession(uid));
  be.rows.set(uid, { data: JSON.parse(JSON.stringify(save)) as SaveData, client_updated_at: save.updatedAt, updated_at: save.updatedAt, version: 1, rev: 1 });
  store.set(SYNC_MARK_KEY, JSON.stringify({ user: uid, synced: ms(save.updatedAt) }));
  _setClientForTests(be.client);
  const ctx = makeCtx(save);
  await cloudBoot(ctx);
  return { be, ctx };
}

describe('baseFor / isStale (pure)', () => {
  it('the marker is the agreed point, unless the cloud row is exactly the push whose answer was lost', () => {
    expect(baseFor(null, [], null)).toBeNull();
    expect(baseFor(ms(T0), [], ms(T1))).toBe(ms(T0));
    // The cloud carries a stamp this device sent: its own progress landed, so that is the agreed point.
    expect(baseFor(ms(T0), [ms(T1)], ms(T1))).toBe(ms(T1));
    expect(baseFor(null, [ms(T0), ms(T1)], ms(T1))).toBe(ms(T1));
    // The cloud carries something else (another device): the marker stands.
    expect(baseFor(ms(T0), [ms(T1)], ms(T2))).toBe(ms(T0));
    expect(baseFor(ms(T0), [ms(T1)], null)).toBe(ms(T0));
  });

  it('knows the server\'s refusal of a stale write', () => {
    expect(isStale({ message: 'stale_save', code: 'PT409' })).toBe(true);
    expect(isStale({ message: 'stale_save' })).toBe(true);
    expect(isStale({ message: 'boom' })).toBe(false);
    expect(isStale(null)).toBe(false);
  });
});

describe('the revision rule', () => {
  it('names the revision it last saw on every write (1 for the first)', async () => {
    const be = fakeBackend();
    be.signIn(fakeSession());
    _setClientForTests(be.client);
    const ctx = makeCtx(rich(T0));
    await cloudBoot(ctx);
    expect(be.calls.upserts).toHaveLength(1);
    expect(be.calls.upserts[0].rev).toBe(1);
    expect(be.rows.get('user-1')?.rev).toBe(1);

    ctx.save.coins = 5100;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    expect(be.calls.upserts[1].rev).toBe(1);
    expect(be.rows.get('user-1')?.rev).toBe(2);

    ctx.save.coins = 5200;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    expect(be.calls.upserts[2].rev).toBe(2);
    expect(be.rows.get('user-1')).toMatchObject({ rev: 3, data: { coins: 5200 } });
    expect(_debugState().dirty).toBe(false);
  });

  it('a write from a stale copy is refused and settled again: two real saves are never overwritten unasked', async () => {
    const { be, ctx } = await synced(rich(T0));
    expect(be.calls.upserts).toHaveLength(0);
    // Another device played on and synced.
    be.otherDevice('user-1', rich(T1, { coins: 4242 }));
    // This device plays too.
    ctx.save.coins = 5100;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    // Its write named revision 1; the row is at 2: refused, fetched, compared (both moved, both real: the player's call).
    expect(be.calls.upserts).toHaveLength(1);
    expect(be.calls.upserts[0].rev).toBe(1);
    expect(be.rows.get('user-1')).toMatchObject({ rev: 2, data: { coins: 4242 } });
    expect(ctx.save.coins).toBe(5100);
    expect(ctx.reloads).toHaveLength(0);
    // Nothing is lost and nothing loops: the device's progress still waits.
    expect(_debugState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(be.calls.upserts).toHaveLength(1);
    expect(cloudStatus().lastError).toBeNull();
  });

  it('a stale write from a device that has nothing of its own gives way to the cloud', async () => {
    // A barely-started device (no match, no XP) whose settings changed, against an account another device played on.
    const { be, ctx } = await synced(at(T0, { coins: 600 }));
    be.otherDevice('user-1', rich(T1, { coins: 4242 }));
    ctx.save.settings.music = false;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    expect(ctx.reloads).toHaveLength(1);
    expect(ctx.save.coins).toBe(4242);
    expect(be.rows.get('user-1')?.data.coins).toBe(4242);
  });

  it('a push whose answer was lost is recognised as this device\'s own: no question, the next change goes up', async () => {
    const { be, ctx } = await synced(rich(T0));
    be.loseAnswers(true);
    ctx.save.coins = 5100;
    ctx.persist();
    const sent = ctx.save.updatedAt;
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    // The write landed (revision 2) but the device never heard: its marker did not move, the stamp it sent is noted.
    expect(be.rows.get('user-1')).toMatchObject({ rev: 2, data: { coins: 5100 } });
    expect(JSON.parse(store.get(SYNC_MARK_KEY)!)).toEqual({ user: 'user-1', synced: ms(T0) });
    expect(JSON.parse(store.get(SYNC_SENT_KEY)!)).toEqual({ user: 'user-1', sent: [ms(sent)] });
    expect(cloudStatus().pending).toBe(true);

    be.loseAnswers(false);
    vi.setSystemTime(new Date(Date.now() + 1000));
    ctx.save.coins = 5300;
    ctx.persist();
    // The retry names the old revision, is refused, and the row turns out to be this device's own earlier push.
    await vi.advanceTimersByTimeAsync(30_000 + PUSH_DEBOUNCE_MS + 2000);
    expect(be.rows.get('user-1')).toMatchObject({ rev: 3, data: { coins: 5300 } });
    expect(ctx.reloads).toHaveLength(0);
    expect(_debugState()).toMatchObject({ dirty: false, holding: false });
    expect(store.has(SYNC_SENT_KEY)).toBe(false);
  });

  it('the keepalive write on hiding names the revision too, and notes what it sent until the answer is in', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', doc);
    let answer: (v: { ok: boolean; status: number }) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<{ ok: boolean; status: number }>((resolve) => (answer = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    const be = fakeBackend();
    be.signIn(fakeSession());
    be.rows.set('user-1', { data: rich(T0), client_updated_at: T0, updated_at: T0, version: 1, rev: 7 });
    store.set(SYNC_MARK_KEY, JSON.stringify({ user: 'user-1', synced: ms(T0) }));
    _setClientForTests(be.client);
    const ctx = makeCtx(rich(T0));
    await cloudBoot(ctx);
    ctx.save.coins = 6000;
    ctx.persist();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((JSON.parse(init.body as string) as { rev: number }).rev).toBe(7);
    expect(JSON.parse(store.get(SYNC_SENT_KEY)!)).toEqual({ user: 'user-1', sent: [ms(ctx.save.updatedAt)] });
    answer({ ok: true, status: 201 });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.has(SYNC_SENT_KEY)).toBe(false);
    expect(JSON.parse(store.get(SYNC_MARK_KEY)!)).toEqual({ user: 'user-1', synced: ms(ctx.save.updatedAt) });
    expect(_debugState().dirty).toBe(false);
  });
});

describe('sync at full time, and on coming back', () => {
  it('syncSoon sends a finished match at once instead of after the usual wait', async () => {
    const { be, ctx } = await synced(rich(T0));
    ctx.save.record.played = 13;
    ctx.persist();
    syncSoon();
    await vi.advanceTimersByTimeAsync(400);
    expect(be.calls.upserts).toHaveLength(1);
    expect(be.rows.get('user-1')?.data.record.played).toBe(13);
  });

  it('a match finished offline is kept and goes up when the connection is back', async () => {
    const { be, ctx } = await synced(rich(T0));
    dom.nav.onLine = false;
    ctx.save.record.played = 13;
    ctx.save.coins = 5250;
    ctx.persist();
    syncSoon();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(be.calls.upserts).toHaveLength(0);
    expect(cloudStatus()).toMatchObject({ offline: true, pending: true });
    expect(ctx.save.record.played).toBe(13);
    dom.nav.onLine = true;
    dom.win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(10);
    expect(be.rows.get('user-1')).toMatchObject({ rev: 2, data: { coins: 5250, record: { played: 13 } } });
    expect(cloudStatus().pending).toBe(false);
  });

  it('flushNow waits for the write', async () => {
    const { be, ctx } = await synced(rich(T0));
    ctx.save.coins = 5050;
    ctx.persist();
    expect(await flushNow()).toBe(true);
    expect(be.rows.get('user-1')?.data.coins).toBe(5050);
    // Nothing waiting: true at once, no write.
    expect(await flushNow()).toBe(true);
    expect(be.calls.upserts).toHaveLength(1);
  });

  it('back in the foreground after a while, progress made on another device is loaded', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    const { be, ctx } = await synced(rich(T0));
    be.otherDevice('user-1', rich(T1, { coins: 4242 }));
    // Back too soon: no second look.
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(ctx.reloads).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(RESUME_CHECK_MS + 1000);
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(ctx.reloads).toHaveLength(1);
    expect(ctx.save.coins).toBe(4242);
  });
});

describe('sessions from the edge functions', () => {
  it('adoptSession signs in and backs the save up; the account reads as made by the game', async () => {
    const be = fakeBackend();
    _setClientForTests(be.client);
    const ctx = makeCtx(rich(T0));
    await cloudBoot(ctx);
    expect(cloudUser()).toBeNull();
    expect(await adoptSession(be.issue(fakeSession('dev-1', 'device')))).toBe(true);
    expect(cloudSession()).toEqual({ userId: 'dev-1', accessToken: 'tok-dev-1' });
    expect(cloudUser()).toEqual({ name: 'This device', provider: 'device', guest: false, auto: true });
    expect(be.rows.get('dev-1')).toMatchObject({ rev: 1, data: { coins: 5000 } });
    // A Game Center account shows as one too, with no email.
    expect(await adoptSession(be.issue(fakeSession('gc-1', 'gamecenter')))).toBe(true);
    expect(cloudUser()).toEqual({ name: 'Game Center', provider: 'gamecenter', guest: false, auto: true });
  });

  it('refuses tokens the backend does not know', async () => {
    const be = fakeBackend();
    _setClientForTests(be.client);
    await cloudBoot(makeCtx(rich(T0)));
    expect(await adoptSession({ access_token: 'nope', refresh_token: 'nope' })).toBe(false);
    expect(cloudSession()).toBeNull();
  });

  it('moving to an account that has its own progress never overwrites it unasked', async () => {
    // A device account in sync, then Game Center turns out to belong to an account another device played on.
    const { be, ctx } = await synced(rich(T0, { coins: 9000 }), 'dev-1');
    be.rows.set('gc-1', { data: rich(T1, { coins: 100 }), client_updated_at: T1, updated_at: T1, version: 1, rev: 5 });
    expect(await adoptSession(be.issue(fakeSession('gc-1', 'gamecenter')))).toBe(true);
    expect(be.rows.get('gc-1')).toMatchObject({ rev: 5, data: { coins: 100 } });
    expect(ctx.save.coins).toBe(9000);
    expect(ctx.reloads).toHaveLength(0);
    // And a later local change does not sneak in under the old account's revision.
    ctx.save.coins = 9100;
    ctx.persist();
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 10);
    expect(be.rows.get('gc-1')).toMatchObject({ rev: 5, data: { coins: 100 } });
  });

  it('a new device signing in to an account with progress loads it silently', async () => {
    const be = fakeBackend();
    be.rows.set('gc-1', { data: rich(T1, { coins: 4242 }), client_updated_at: T1, updated_at: T1, version: 1, rev: 3 });
    _setClientForTests(be.client);
    const ctx = makeCtx(defaultSave());
    await cloudBoot(ctx);
    expect(await adoptSession(be.issue(fakeSession('gc-1', 'gamecenter')))).toBe(true);
    expect(ctx.save.coins).toBe(4242);
    expect(JSON.parse(store.get(SYNC_MARK_KEY)!)).toEqual({ user: 'gc-1', synced: ms(T1) });
  });

  it('the profile call stores the club name and returns the friend code', async () => {
    const { be } = await synced(rich(T0, { career: { club: { name: ' Voxel United ' }, season: { number: 1, matchday: 2 } } }));
    expect(await cloudProfile()).toEqual({ code: 'ABC2345', club: 'Voxel United' });
    expect(be.calls.rpcs).toEqual([{ fn: 'my_profile', args: { p_club: 'Voxel United' } }]);
  });

  it('cloudEndpoint is the project and the publishable key, and nothing on a portal build', () => {
    expect(cloudEndpoint()).toEqual({ url: ENV.url, key: ENV.key });
    expect(accountsRequired()).toBe(true);
    // A backend alone does not make accounts required: that takes the switch.
    _setEnvForTests({ url: ENV.url, key: ENV.key });
    expect(cloudEndpoint()).toEqual({ url: ENV.url, key: ENV.key });
    expect(accountsRequired()).toBe(false);
    expect(cloudStatus().required).toBe(false);
    _setEnvForTests({ ...ENV, portal: 'poki' });
    expect(cloudEndpoint()).toBeNull();
    expect(accountsRequired()).toBe(false);
  });
});

describe('forgetAccount (after DELETE ACCOUNT)', () => {
  it('drops the session and the markers, and nothing signs back in or syncs by itself', async () => {
    const { be, ctx } = await synced(rich(T0));
    ctx.save.coins = 1;
    ctx.persist();
    await forgetAccount();
    expect(be.calls.signOuts).toBe(1);
    expect(cloudSession()).toBeNull();
    expect(cloudStatus()).toMatchObject({ user: null, pending: false, signedOut: true });
    expect(store.has(SYNC_MARK_KEY)).toBe(false);
    expect(store.has(SYNC_SENT_KEY)).toBe(false);
    await vi.advanceTimersByTimeAsync(WATCH_MS + PUSH_DEBOUNCE_MS + 60_000);
    expect(be.calls.upserts).toHaveLength(0);
  });
});
