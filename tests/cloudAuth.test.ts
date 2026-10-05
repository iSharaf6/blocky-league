import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSave } from '../src/core/save';
import { _debugState, _resetForTests, _setClientForTests, _setEnvForTests, authProviders, cloudBoot, cloudUser, completeNativeAuthUrl, flushNow, refreshAuthProviders, signInWith, upgradeGuest } from '../src/platform/cloud';
import { _resetNativeAuthForTests, authCallback, bootNativeAuth, NATIVE_AUTH_REDIRECT } from '../src/platform/nativeAuth';
import { inviteMessage, PLAY_URL, shareInvite } from '../src/platform/invite';
import { ENV, fakeBackend, fakeSession, makeCtx, stubDom, stubStorage } from './cloudFake';

const bridges = vi.hoisted(() => ({
  appListener: vi.fn(), launch: vi.fn(), open: vi.fn(), close: vi.fn(), apple: vi.fn(), share: vi.fn(), remove: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: bridges.appListener, getLaunchUrl: bridges.launch } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: bridges.open, close: bridges.close } }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ signInWithApple: bridges.apple }) }));
vi.mock('@capacitor/share', () => ({ Share: { share: bridges.share } }));

beforeEach(async () => {
  await _resetNativeAuthForTests();
  vi.clearAllMocks();
  _resetForTests();
  _setEnvForTests({ ...ENV, online: '' });
  stubStorage();
  const dom = stubDom();
  Object.assign(dom.win, { Capacitor: { isNativePlatform: () => true } });
  bridges.appListener.mockResolvedValue({ remove: bridges.remove });
  bridges.launch.mockResolvedValue(undefined);
  bridges.open.mockResolvedValue(undefined);
  bridges.close.mockResolvedValue(undefined);
  bridges.share.mockResolvedValue({ activityType: 'messages' });
  bridges.apple.mockResolvedValue({ idToken: 'apple-test-token', fullName: 'Sam Player' });
});
afterEach(async () => {
  await _resetNativeAuthForTests();
  _resetForTests();
  _setEnvForTests(null);
  vi.unstubAllGlobals();
});

describe('native OAuth return', () => {
  it('accepts only the exact callback with a code, rejecting token fragments and unrelated links', () => {
    expect(authCallback(`${NATIVE_AUTH_REDIRECT}?code=once`)).toEqual({ code: 'once', error: null });
    for (const url of ['https://auth/callback?code=x', 'com.calynx.blockyleague://other/callback?code=x', 'com.calynx.blockyleague://auth/else?code=x', `${NATIVE_AUTH_REDIRECT}?code=x#access_token=fake`, `${NATIVE_AUTH_REDIRECT}?code=x&code=y`, 'com.calynx.blockyleague://user@auth/callback?code=x', NATIVE_AUTH_REDIRECT]) expect(authCallback(url)).toBeNull();
  });

  it('handles a cold launch and a later warm return without registering duplicate listeners', async () => {
    bridges.launch.mockResolvedValue({ url: `${NATIVE_AUTH_REDIRECT}?code=cold` });
    const receive = vi.fn().mockResolvedValue(true);
    await bootNativeAuth(receive);
    await bootNativeAuth(receive);
    expect(receive).toHaveBeenCalledWith(`${NATIVE_AUTH_REDIRECT}?code=cold`);
    expect(bridges.appListener).toHaveBeenCalledTimes(1);
    const warm = bridges.appListener.mock.calls[0][1] as (e: { url: string }) => void;
    warm({ url: `${NATIVE_AUTH_REDIRECT}?code=warm` });
    expect(receive).toHaveBeenLastCalledWith(`${NATIVE_AUTH_REDIRECT}?code=warm`);
  });

  it('opens Google in the native browser and backs up existing local progress once after a PKCE return', async () => {
    const be = fakeBackend();
    const oauth = vi.fn().mockResolvedValue({ data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=google' }, error: null });
    be.client.auth.signInWithOAuth = oauth;
    const tokens = be.issue(fakeSession('google-user', 'google'));
    const exchange = vi.fn(async () => be.client.auth.setSession!(tokens));
    be.client.auth.exchangeCodeForSession = exchange;
    _setClientForTests(be.client);
    const save = defaultSave(); save.record.played = 9; save.record.won = 4; save.coins = 4321;
    const ctx = makeCtx(save);
    await cloudBoot(ctx);
    expect(await signInWith('google')).toBe(true);
    expect(oauth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true } });
    expect(bridges.open).toHaveBeenCalledTimes(1);
    expect(be.calls.upserts).toHaveLength(0);
    expect(await completeNativeAuthUrl(`${NATIVE_AUTH_REDIRECT}?code=one-use`)).toBe(true);
    expect(be.rows.get('google-user')?.data.record.played).toBe(9);
    expect(be.rows.get('google-user')?.data.coins).toBe(4321);
    expect(await completeNativeAuthUrl(`${NATIVE_AUTH_REDIRECT}?code=one-use`)).toBe(false);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(be.calls.upserts).toHaveLength(1);
  });

  it('keeps two established clubs untouched until the save conflict is answered', async () => {
    const be = fakeBackend();
    const tokens = be.issue(fakeSession('existing-user', 'google'));
    be.client.auth.exchangeCodeForSession = async () => be.client.auth.setSession!(tokens);
    const cloud = defaultSave(); cloud.record.played = 50; cloud.progress.xp = 2000; cloud.coins = 9876;
    be.otherDevice('existing-user', cloud);
    _setClientForTests(be.client);
    const local = defaultSave(); local.record.played = 12; local.progress.xp = 600; local.coins = 1234;
    const ctx = makeCtx(local);
    await cloudBoot(ctx);
    await completeNativeAuthUrl(`${NATIVE_AUTH_REDIRECT}?code=choose-save`);
    expect(_debugState().unsettled).toBe(true);
    expect(ctx.reloads).toHaveLength(0);
    ctx.persist();
    expect(await flushNow()).toBe(false);
    expect(local.coins).toBe(1234);
    expect(be.rows.get('existing-user')?.data.coins).toBe(9876);
    expect(be.calls.upserts).toHaveLength(0);
  });

  it('uses Apple identity + raw nonce, stores first-sign-in name and preserves the local club', async () => {
    const be = fakeBackend();
    const apple = fakeSession('apple-user', 'google'); apple.user.app_metadata = { provider: 'apple' };
    const tokens = be.issue(apple);
    const idToken = vi.fn(async (_request: { provider: 'apple'; token: string; nonce: string }) => be.client.auth.setSession!(tokens));
    const update = vi.fn().mockResolvedValue({ error: null });
    be.client.auth.signInWithIdToken = idToken;
    be.client.auth.updateUser = update;
    _setClientForTests(be.client);
    const local = defaultSave(); local.coins = 3333; local.record.played = 7;
    await cloudBoot(makeCtx(local));
    expect(await signInWith('apple')).toBe(true);
    const request = idToken.mock.calls[0][0] as unknown as { provider: string; token: string; nonce: string };
    expect(request.provider).toBe('apple');
    expect(request.token).toBe('apple-test-token');
    expect(request.nonce).toHaveLength(64);
    expect(bridges.apple.mock.calls[0][0].nonce).toHaveLength(64);
    expect(bridges.apple.mock.calls[0][0].nonce).not.toBe(request.nonce);
    expect(update).toHaveBeenCalledWith({ data: { full_name: 'Sam Player' } });
    expect(bridges.open).not.toHaveBeenCalled();
    expect(be.rows.get('apple-user')?.data.coins).toBe(3333);
  });

  it('does not alter the save on cancel or a provider error, and links Google on the existing device account', async () => {
    const be = fakeBackend(); be.signIn(fakeSession());
    const link = vi.fn().mockResolvedValue({ data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=google' }, error: null });
    be.client.auth.linkIdentity = link;
    _setClientForTests(be.client);
    const local = defaultSave(); local.coins = 2222;
    await cloudBoot(makeCtx(local));
    bridges.apple.mockRejectedValue({ code: 'CANCELED' });
    expect(await signInWith('apple')).toBe(false);
    expect(local.coins).toBe(2222);
    expect(await completeNativeAuthUrl(`${NATIVE_AUTH_REDIRECT}?error=access_denied`)).toBe(false);
    expect(await upgradeGuest('google')).toBe(true);
    expect(link).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true } });
    expect(cloudUser()?.provider).toBe('device');
  });
});

describe('inviting a friend', () => {
  it('always shares the public game URL, with a reward claim only for a valid friend code', () => {
    expect(inviteMessage('ABC2345')).toEqual(expect.objectContaining({ url: PLAY_URL, text: expect.stringContaining('ABC2345') }));
    expect(inviteMessage()).toEqual(expect.objectContaining({ url: PLAY_URL }));
    expect(inviteMessage('bad-code').text).not.toContain('100 coins');
    expect(PLAY_URL).not.toContain('localhost');
  });
  it('uses the iOS share sheet and includes the actual play link', async () => {
    expect(await shareInvite('ABC2345')).toBe('shared');
    expect(bridges.share).toHaveBeenCalledWith(expect.objectContaining({ url: PLAY_URL, text: expect.stringContaining('ABC2345') }));
  });
  it('treats dismissing the iOS sheet as cancellation', async () => {
    bridges.share.mockRejectedValue(new Error('Share canceled'));
    expect(await shareInvite()).toBe('canceled');
  });
});

describe('live sign-in availability', () => {
  it('keeps native-only Apple off in the browser, including before the provider check has completed', async () => {
    Object.assign((globalThis as unknown as { window: object }).window, { Capacitor: { isNativePlatform: () => false } });
    const be = fakeBackend(); be.signIn(fakeSession());
    const oauth = vi.fn().mockResolvedValue({ error: null });
    const link = vi.fn().mockResolvedValue({ error: null });
    be.client.auth.signInWithOAuth = oauth;
    be.client.auth.linkIdentity = link;
    _setClientForTests(be.client);
    await cloudBoot(makeCtx(defaultSave()));
    expect(authProviders()).toEqual({ apple: false });
    expect(await signInWith('apple')).toBe(false);
    expect(await upgradeGuest('apple')).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ external: { google: true, apple: true, github: false } }))));
    expect(await refreshAuthProviders()).toEqual({ google: true, apple: false, github: false });
    expect(await signInWith('apple')).toBe(false);
    expect(oauth).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
    expect(bridges.apple).not.toHaveBeenCalled();
  });

  it('enables web Apple OAuth only with the explicit web flag and an enabled provider', async () => {
    Object.assign((globalThis as unknown as { window: object }).window, { Capacitor: { isNativePlatform: () => false } });
    _setEnvForTests({ ...ENV, online: '', appleWeb: 'on' });
    const be = fakeBackend();
    const oauth = vi.fn().mockResolvedValue({ error: null });
    be.client.auth.signInWithOAuth = oauth;
    _setClientForTests(be.client);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ external: { google: true, apple: true, github: false } }))));
    expect(await refreshAuthProviders()).toEqual({ google: true, apple: true, github: false });
    expect(await signInWith('apple')).toBe(true);
    expect(oauth).toHaveBeenCalledWith({ provider: 'apple', options: { redirectTo: '' } });
    expect(bridges.apple).not.toHaveBeenCalled();
    expect(bridges.open).not.toHaveBeenCalled();
  });

  it('does not open an unconfigured provider or create an account, then picks up server activation', async () => {
    const be = fakeBackend(); be.signIn(fakeSession());
    const oauth = vi.fn().mockResolvedValue({ data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=google' }, error: null });
    be.client.auth.signInWithOAuth = oauth;
    _setClientForTests(be.client);
    const local = defaultSave(); local.coins = 6543;
    await cloudBoot(makeCtx(local));
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ external: { google: false, apple: false, github: false } })));
    vi.stubGlobal('fetch', fetch);
    expect(await refreshAuthProviders()).toEqual({ google: false, apple: false, github: false });
    expect(fetch).toHaveBeenCalledWith(`${ENV.url}/auth/v1/settings`, expect.objectContaining({ headers: { apikey: ENV.key } }));
    expect(await signInWith('apple')).toBe(false);
    expect(await signInWith('google')).toBe(false);
    expect(await upgradeGuest('google')).toBe(false);
    expect(bridges.apple).not.toHaveBeenCalled();
    expect(bridges.open).not.toHaveBeenCalled();
    expect(oauth).not.toHaveBeenCalled();
    expect(local.coins).toBe(6543);
    fetch.mockResolvedValue(new Response(JSON.stringify({ external: { google: true, apple: true, github: false } })));
    expect(await refreshAuthProviders()).toEqual({ google: true, apple: true, github: false });
    expect(await signInWith('google')).toBe(true);
    expect(bridges.open).toHaveBeenCalledTimes(1);
  });

  it('keeps availability unknown on malformed/offline settings and never invents enabled providers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ external: { google: 'true' } })));
    vi.stubGlobal('fetch', fetch);
    expect(await refreshAuthProviders()).toBeNull();
    expect(authProviders()).toBeNull();
    fetch.mockRejectedValue(new Error('offline'));
    expect(await refreshAuthProviders()).toBeNull();
  });

  it('does not request cloud settings from a portal build', async () => {
    _setEnvForTests({ ...ENV, portal: 'poki' });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await refreshAuthProviders()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
