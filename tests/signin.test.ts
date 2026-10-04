/**
 * Silent sign-in (src/platform/signin.ts): the plan (Game Center, else the device's own account), the device
 * secret, the calls to the edge functions (through a stubbed fetch) and what happens to the session and the save;
 * DELETE ACCOUNT; friend codes. Outside the app there is no Game Center, so these run the device path end to end;
 * the Game Center branch is covered by the plan and by tests/gcVerify.test.ts (the server's check).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSave, type SaveData } from '../src/core/save';
import { SYNC_MARK_KEY, _resetForTests, _setClientForTests, _setEnvForTests, cloudBoot, cloudSession, cloudStatus, cloudUser, signOutCloud } from '../src/platform/cloud';
import { _resetOnlineForTests, gateNow } from '../src/platform/online';
import {
  DEVICE_SECRET_KEY, _resetSigninForTests, claimFriendCode, collectFriendCoins, connect, connectError, deleteAccount, deviceSecret, newSecret, planSignIn,
  watchConnection, type SignInFacts,
} from '../src/platform/signin';
import { ENV, fakeBackend, fakeSession, makeCtx, stubDom, stubFunctions, stubStorage } from './cloudFake';

const T0 = '2026-09-27T10:00:00.000Z';
const T2 = '2026-09-27T12:00:00.000Z';
const rich = (o: Partial<SaveData> = {}): SaveData =>
  ({ ...defaultSave(), coins: 5000, progress: { ...defaultSave().progress, xp: 900 }, record: { ...defaultSave().record, played: 12, won: 8 }, ...o, updatedAt: T0 });

const plan = (o: Partial<SignInFacts> = {}): SignInFacts => ({
  available: true, signedIn: false, kind: null, gameCenter: false, gameCenterChanged: false, signedOutByPlayer: false, explicit: false, ...o,
});

describe('planSignIn (pure)', () => {
  it('does nothing in a build with no backend', () => {
    expect(planSignIn(plan({ available: false }))).toBe('none');
    expect(planSignIn(plan({ available: false, gameCenter: true }))).toBe('none');
  });

  it('Game Center when the player is in it, else the device account: nobody is locked out', () => {
    expect(planSignIn(plan({ gameCenter: true }))).toBe('gamecenter');
    expect(planSignIn(plan())).toBe('device');
  });

  it('leaves a signed-in player alone', () => {
    expect(planSignIn(plan({ signedIn: true, kind: 'device' }))).toBe('none');
    expect(planSignIn(plan({ signedIn: true, kind: 'gamecenter', gameCenter: true }))).toBe('none');
    // An account the player chose himself (the web game) is never replaced.
    for (const kind of ['google', 'github', 'email', 'guest']) {
      expect(planSignIn(plan({ signedIn: true, kind }))).toBe('none');
      expect(planSignIn(plan({ signedIn: true, kind, gameCenter: true }))).toBe('none');
    }
  });

  it('moves a device account under Game Center once the player signs in to it', () => {
    expect(planSignIn(plan({ signedIn: true, kind: 'device', gameCenter: true }))).toBe('gamecenter');
  });

  it('gives another Game Center player on the same device his own account', () => {
    expect(planSignIn(plan({ signedIn: true, kind: 'gamecenter', gameCenter: true, gameCenterChanged: true }))).toBe('gamecenter');
  });

  it('never signs a player back in behind his back after SIGN OUT or DELETE ACCOUNT, only when he asks', () => {
    expect(planSignIn(plan({ signedOutByPlayer: true }))).toBe('none');
    expect(planSignIn(plan({ signedOutByPlayer: true, gameCenter: true }))).toBe('none');
    expect(planSignIn(plan({ signedOutByPlayer: true, explicit: true }))).toBe('device');
    expect(planSignIn(plan({ signedOutByPlayer: true, explicit: true, gameCenter: true }))).toBe('gamecenter');
  });
});

describe('the device secret', () => {
  beforeEach(() => void stubStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('is long, random, URL-safe, and kept', () => {
    const a = newSecret();
    const b = newSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(a).not.toBe(b);
    const kept = deviceSecret();
    expect(kept).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(deviceSecret()).toBe(kept);
    expect(localStorage.getItem(DEVICE_SECRET_KEY)).toBe(kept);
  });

  it('replaces a damaged one', () => {
    localStorage.setItem(DEVICE_SECRET_KEY, 'short');
    expect(deviceSecret()).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });
});

describe('connect, delete account, friend codes (stubbed backend)', () => {
  let store: Map<string, string>;
  let dom: ReturnType<typeof stubDom>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T2));
    _resetForTests();
    _resetOnlineForTests();
    _resetSigninForTests();
    _setEnvForTests({ ...ENV });
    store = stubStorage();
    dom = stubDom();
  });

  afterEach(() => {
    _resetForTests();
    _resetOnlineForTests();
    _resetSigninForTests();
    _setEnvForTests(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function boot(save: SaveData) {
    const be = fakeBackend();
    _setClientForTests(be.client);
    const ctx = makeCtx(save);
    await cloudBoot(ctx);
    return { be, ctx };
  }

  it('signs in with the device account: the secret goes to device-login, the session is taken, the save is backed up', async () => {
    const { be, ctx } = await boot(rich());
    const fn = stubFunctions({ 'device-login': () => ({ json: { ...be.issue(fakeSession('dev-1')), kind: 'device', created: true } }) });
    expect(gateNow()).toBe('connect');
    expect(await connect()).toBe(true);
    expect(fn.calls).toHaveLength(1);
    expect(fn.calls[0].name).toBe('device-login');
    expect(fn.calls[0].body).toEqual({ secret: store.get(DEVICE_SECRET_KEY) });
    // The publishable key identifies the game; nobody is signed in yet, so there is no bearer token.
    expect(fn.calls[0].headers.apikey).toBe(ENV.key);
    expect(fn.calls[0].headers.Authorization).toBeUndefined();
    expect(fn.fetchMock.mock.calls[0][0]).toBe(`${ENV.url}/functions/v1/device-login`);
    expect(cloudUser()).toMatchObject({ provider: 'device', auto: true });
    expect(be.rows.get('dev-1')?.data.coins).toBe(ctx.save.coins);
    expect(gateNow()).toBe('open');
    expect(connectError()).toBeNull();
    // Already in: a second call asks nothing of the server.
    expect(await connect()).toBe(true);
    expect(fn.calls).toHaveLength(1);
  });

  it('optional accounts: never signs in automatically, but an explicit request backs up the club', async () => {
    _setEnvForTests({ url: ENV.url, key: ENV.key });
    const { be, ctx } = await boot(rich());
    const fn = stubFunctions({ 'device-login': () => ({ json: be.issue(fakeSession('dev-1')) }) });
    expect(await connect()).toBe(false);
    watchConnection(ctx);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fn.calls).toHaveLength(0);
    expect(cloudSession()).toBeNull();
    expect(gateNow()).toBe('open');
    expect(await connect(true)).toBe(true);
    expect(fn.calls).toHaveLength(1);
    expect(be.rows.get('dev-1')?.data.coins).toBe(ctx.save.coins);
    expect(gateNow()).toBe('open');
  });

  it('two callers share one attempt', async () => {
    const { be } = await boot(rich());
    const fn = stubFunctions({ 'device-login': () => ({ json: be.issue(fakeSession('dev-1')) }) });
    const [a, b] = await Promise.all([connect(), connect()]);
    expect([a, b]).toEqual([true, true]);
    expect(fn.calls).toHaveLength(1);
  });

  it('a new device loads the account\'s progress instead of pushing its fresh save over it', async () => {
    const { be, ctx } = await boot(defaultSave());
    be.rows.set('dev-1', { data: rich({ coins: 4242 }), client_updated_at: T0, updated_at: T0, version: 1, rev: 3 });
    stubFunctions({ 'device-login': () => ({ json: be.issue(fakeSession('dev-1')) }) });
    expect(await connect()).toBe(true);
    expect(ctx.save.coins).toBe(4242);
    expect(be.rows.get('dev-1')?.data.coins).toBe(4242);
  });

  it('fails softly: offline, a refusal, a bad answer; the game stays playable and says why', async () => {
    await boot(rich());
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    expect(await connect()).toBe(false);
    expect(connectError()).toBe('network');
    expect(cloudSession()).toBeNull();
    expect(gateNow()).toBe('connect');

    stubFunctions({ 'device-login': () => ({ status: 429, json: { error: 'rate_limited' } }) });
    expect(await connect()).toBe(false);
    expect(connectError()).toBe('rate_limited');

    // Tokens the auth server does not know (or a garbled answer) are not a session.
    stubFunctions({ 'device-login': () => ({ json: { access_token: 'x', refresh_token: 'y' } }) });
    expect(await connect()).toBe(false);
    stubFunctions({ 'device-login': () => ({ json: { hello: 'world' } }) });
    expect(await connect()).toBe(false);
    expect(cloudSession()).toBeNull();
  });

  it('SIGN OUT sticks until the player asks to connect again', async () => {
    const { be } = await boot(rich());
    const fn = stubFunctions({ 'device-login': () => ({ json: be.issue(fakeSession('dev-1')) }) });
    expect(await connect()).toBe(true);
    await signOutCloud();
    expect(cloudStatus().signedOut).toBe(true);
    // The silent attempt leaves him out.
    expect(await connect()).toBe(false);
    expect(fn.calls).toHaveLength(1);
    // RETRY brings him back.
    expect(await connect(true)).toBe(true);
    expect(fn.calls).toHaveLength(2);
    expect(cloudStatus().signedOut).toBe(false);
  });

  it('DELETE ACCOUNT: the server deletes, then the device forgets the session, the secret and the progress', async () => {
    const { be, ctx } = await boot(rich());
    const fn = stubFunctions({
      'device-login': () => ({ json: be.issue(fakeSession('dev-1')) }),
      'delete-account': () => {
        be.rows.delete('dev-1');
        return { json: { ok: true } };
      },
    });
    expect(await connect()).toBe(true);
    const secret = store.get(DEVICE_SECRET_KEY);
    expect(be.rows.has('dev-1')).toBe(true);

    expect(await deleteAccount(ctx)).toBe('ok');
    const call = fn.calls.find((c) => c.name === 'delete-account')!;
    // Only the signed-in player can ask, and only for himself: his own token goes with it.
    expect(call.headers.Authorization).toBe('Bearer tok-dev-1');
    expect(call.headers.apikey).toBe(ENV.key);
    expect(be.rows.has('dev-1')).toBe(false);
    expect(cloudSession()).toBeNull();
    expect(store.has(DEVICE_SECRET_KEY)).toBe(false);
    expect(store.has(SYNC_MARK_KEY)).toBe(false);
    // The progress on the device went with the account: a fresh save.
    expect(ctx.save.coins).toBe(defaultSave().coins);
    expect(ctx.save.record.played).toBe(0);
    expect(ctx.reloads).toHaveLength(1);
    // Nothing recreates the account by itself, and nothing is pushed.
    expect(await connect()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(be.rows.size).toBe(0);
    expect(gateNow()).toBe('connect');
    // Asking to connect makes a NEW account: a new secret, not the deleted one.
    expect(await connect(true)).toBe(true);
    expect(store.get(DEVICE_SECRET_KEY)).not.toBe(secret);
  });

  it('with the watcher running: it signs in at launch, and neither SIGN OUT nor DELETE ACCOUNT is undone behind the player\'s back', async () => {
    const { be, ctx } = await boot(rich());
    let n = 0;
    const fn = stubFunctions({
      'device-login': () => ({ json: be.issue(fakeSession(`dev-${++n}`)) }),
      'delete-account': (c) => {
        be.rows.delete(String(c.headers.Authorization).replace('Bearer tok-', ''));
        return { json: { ok: true } };
      },
    });
    const logins = (): number => fn.calls.filter((c) => c.name === 'device-login').length;
    watchConnection(ctx);
    await vi.advanceTimersByTimeAsync(50);
    expect(cloudSession()?.userId).toBe('dev-1');
    expect(logins()).toBe(1);

    // The auth library announces the sign-out while the call is still running: the watcher must not answer it.
    await signOutCloud();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(cloudSession()).toBeNull();
    expect(logins()).toBe(1);

    expect(await connect(true)).toBe(true);
    expect(logins()).toBe(2);
    expect(await deleteAccount(ctx)).toBe('ok');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // No new account appears, and nothing of the deleted one is left on the server.
    expect(cloudSession()).toBeNull();
    expect(logins()).toBe(2);
    expect(be.rows.has('dev-2')).toBe(false);
    // Coming back online or to the foreground changes nothing either.
    dom.win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(logins()).toBe(2);
  });

  it('DELETE ACCOUNT keeps everything when the server could not do it', async () => {
    const { be, ctx } = await boot(rich());
    stubFunctions({ 'device-login': () => ({ json: be.issue(fakeSession('dev-1')) }), 'delete-account': () => ({ status: 500, json: { error: 'server' } }) });
    expect(await connect()).toBe(true);
    expect(await deleteAccount(ctx)).toBe('failed');
    expect(cloudSession()).not.toBeNull();
    expect(ctx.save.coins).toBe(5000);
    expect(store.has(DEVICE_SECRET_KEY)).toBe(true);
    dom.nav.onLine = false;
    expect(await deleteAccount(ctx)).toBe('offline');
    expect(ctx.save.coins).toBe(5000);
  });

  it('DELETE ACCOUNT with nobody signed in does nothing', async () => {
    const { ctx } = await boot(rich());
    const fn = stubFunctions({});
    expect(await deleteAccount(ctx)).toBe('failed');
    expect(fn.calls).toHaveLength(0);
    expect(ctx.save.coins).toBe(5000);
  });

  it('a friend code pays once: the claim, then exactly the coins the server says', async () => {
    const { be, ctx } = await boot(rich());
    let owed = 0;
    const fn = stubFunctions({
      'device-login': () => ({ json: be.issue(fakeSession('dev-1')) }),
      referral: (c) => {
        if (c.body.action === 'claim') {
          if (c.body.code !== 'ABC2345') return { status: 404, json: { error: 'unknown_code' } };
          owed = 100;
          return { json: { ok: true, coins: 100 } };
        }
        const coins = owed;
        owed = 0;
        return { json: { coins, friends: 0 } };
      },
    });
    expect(await connect()).toBe(true);

    expect(await claimFriendCode(ctx, 'zzzzzzz')).toEqual({ result: 'unknown_code', coins: 0 });
    expect(ctx.save.coins).toBe(5000);

    // (Typed in lower case with spaces: sent tidy.)
    expect(await claimFriendCode(ctx, ' abc2345 ')).toEqual({ result: 'ok', coins: 100 });
    expect(fn.calls.filter((c) => c.name === 'referral' && c.body.action === 'claim').pop()?.body.code).toBe('ABC2345');
    expect(ctx.save.coins).toBe(5100);
    // Nothing more is owed: collecting again adds nothing.
    expect(await collectFriendCoins(ctx)).toEqual({ coins: 0, friends: 0 });
    expect(ctx.save.coins).toBe(5100);
    // The reward reaches the cloud save.
    await vi.advanceTimersByTimeAsync(1000);
    expect(be.rows.get('dev-1')?.data.coins).toBe(5100);
  });

  it('a friend code needs an account, and the server\'s refusals come back as they are', async () => {
    const { be, ctx } = await boot(rich());
    expect(await claimFriendCode(ctx, 'ABC2345')).toEqual({ result: 'failed', coins: 0 });
    stubFunctions({
      'device-login': () => ({ json: be.issue(fakeSession('dev-1')) }),
      referral: () => ({ status: 400, json: { error: 'win_first' } }),
    });
    expect(await connect()).toBe(true);
    expect(await claimFriendCode(ctx, 'ABC2345')).toEqual({ result: 'win_first', coins: 0 });
    expect(ctx.save.coins).toBe(5000);
  });
});
