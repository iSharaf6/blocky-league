/**
 * The online rule (src/platform/online.ts): progression needs a connection and a signed-in account; exhibition
 * (QUICK MATCH, the first match, the basics) always plays; a connection that drops mid-session is forgiven for a
 * short grace; a build with no backend (portals, itch) is never gated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSave } from '../src/core/save';
import { _resetForTests, _setClientForTests, _setEnvForTests, cloudBoot, forgetAccount, signOutCloud } from '../src/platform/cloud';
import { OFFLINE_GRACE_MS, _resetOnlineForTests, canStart, exhibition, gateNow, gateOf, gateWhy, onGateChange, setConnecting, type Gate, type GateFacts } from '../src/platform/online';
import { ENV, fakeBackend, fakeSession, makeCtx, stubDom, stubStorage } from './cloudFake';

const NOW = 1_800_000_000_000;
const facts = (o: Partial<GateFacts> = {}): GateFacts => ({ required: true, online: true, signedIn: true, connecting: false, droppedAt: null, now: NOW, ...o });

describe('gateOf (pure)', () => {
  it('is open when connected and signed in', () => {
    expect(gateOf(facts())).toBe('open');
  });

  it('is always open in a build with no backend (CrazyGames, Poki, itch): those stay fully local', () => {
    expect(gateOf(facts({ required: false, online: false, signedIn: false }))).toBe('open');
    expect(gateOf(facts({ required: false, signedIn: false }))).toBe('open');
  });

  it('needs both the connection and the account', () => {
    expect(gateOf(facts({ online: false }))).toBe('connect');
    expect(gateOf(facts({ signedIn: false }))).toBe('connect');
    expect(gateOf(facts({ online: false, signedIn: false }))).toBe('connect');
  });

  it('says connecting while a sign-in is under way', () => {
    expect(gateOf(facts({ signedIn: false, connecting: true }))).toBe('connecting');
    // Connected already: the attempt does not shut anything.
    expect(gateOf(facts({ connecting: true }))).toBe('open');
  });

  it('forgives a connection dropped mid-session for the grace, then shuts', () => {
    const droppedAt = NOW - 1000;
    expect(gateOf(facts({ online: false, droppedAt }))).toBe('open');
    expect(gateOf(facts({ online: false, droppedAt: NOW - OFFLINE_GRACE_MS + 1 }))).toBe('open');
    expect(gateOf(facts({ online: false, droppedAt: NOW - OFFLINE_GRACE_MS }))).toBe('connect');
    expect(gateOf(facts({ online: false, droppedAt: NOW - OFFLINE_GRACE_MS * 10 }))).toBe('connect');
    // The grace is short: minutes, not hours.
    expect(OFFLINE_GRACE_MS).toBeGreaterThanOrEqual(60_000);
    expect(OFFLINE_GRACE_MS).toBeLessThanOrEqual(10 * 60_000);
  });

  it('gives no grace to a launch that never connected', () => {
    expect(gateOf(facts({ online: false, signedIn: false, droppedAt: null }))).toBe('connect');
  });
});

describe('exhibition', () => {
  it('QUICK MATCH, the first match, the basics and a plain friendly play offline', () => {
    for (const kind of ['quick', 'playnow', 'basics', undefined]) expect(exhibition(kind)).toBe(true);
  });

  it('ROAD TO GLORY, its cups, CLUB RUN and MOMENTS do not', () => {
    for (const kind of ['career', 'cup', 'run', 'moment']) expect(exhibition(kind)).toBe(false);
  });
});

describe('the running gate', () => {
  let dom: ReturnType<typeof stubDom>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    _resetForTests();
    _resetOnlineForTests();
    _setEnvForTests({ ...ENV });
    stubStorage();
    dom = stubDom();
  });

  afterEach(() => {
    _resetForTests();
    _resetOnlineForTests();
    _setEnvForTests(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function boot(signedIn: boolean) {
    const be = fakeBackend();
    if (signedIn) be.signIn(fakeSession());
    _setClientForTests(be.client);
    await cloudBoot(makeCtx(defaultSave()));
    return be;
  }

  it('signed in and online: everything plays', async () => {
    await boot(true);
    expect(gateNow()).toBe('open');
    expect(canStart('career')).toBe(true);
    expect(canStart('quick')).toBe(true);
  });

  it('no account yet: only exhibition plays; a sign-in under way reads as connecting', async () => {
    await boot(false);
    expect(gateNow()).toBe('connect');
    expect(gateWhy()).toBe('account');
    for (const kind of ['career', 'cup', 'run', 'moment']) expect(canStart(kind)).toBe(false);
    for (const kind of ['quick', 'playnow', 'basics', undefined]) expect(canStart(kind)).toBe(true);
    setConnecting(true);
    expect(gateNow()).toBe('connecting');
    expect(canStart('career')).toBe(false);
    setConnecting(false);
    expect(gateNow()).toBe('connect');
  });

  it('launched offline with a stored session: CONNECT TO PLAY, and why', async () => {
    dom.nav.onLine = false;
    await boot(true);
    expect(gateNow()).toBe('connect');
    expect(gateWhy()).toBe('offline');
    expect(canStart('career')).toBe(false);
    expect(canStart('quick')).toBe(true);
  });

  it('switched off (a backend, but accounts not required): nothing is gated, as it always was', async () => {
    _setEnvForTests({ url: ENV.url, key: ENV.key });
    dom.nav.onLine = false;
    await boot(false);
    expect(gateNow()).toBe('open');
    for (const kind of ['career', 'cup', 'run', 'moment', 'quick']) expect(canStart(kind)).toBe(true);
  });

  it('a build with no backend is never gated, offline or not', async () => {
    _setEnvForTests({});
    dom.nav.onLine = false;
    await boot(false);
    expect(gateNow()).toBe('open');
    expect(canStart('career')).toBe(true);
    _setEnvForTests({ ...ENV, portal: 'crazygames' });
    expect(gateNow()).toBe('open');
  });

  it('a drop mid-session keeps everything open for the grace, shuts after it, and opens again when the connection is back', async () => {
    await boot(true);
    const seen: Gate[] = [];
    onGateChange((g) => seen.push(g));
    expect(gateNow()).toBe('open');

    dom.nav.onLine = false;
    dom.win.dispatchEvent(new Event('offline'));
    // Inside the grace: a match in progress finishes, the next one may still start.
    expect(gateNow()).toBe('open');
    expect(canStart('career')).toBe(true);
    await vi.advanceTimersByTimeAsync(OFFLINE_GRACE_MS - 5000);
    expect(gateNow()).toBe('open');
    expect(seen).toEqual([]);

    await vi.advanceTimersByTimeAsync(6000);
    expect(gateNow()).toBe('connect');
    expect(canStart('career')).toBe(false);
    expect(canStart('quick')).toBe(true);
    // The listener heard it by itself (the hub marks its tiles).
    expect(seen).toEqual(['connect']);

    dom.nav.onLine = true;
    dom.win.dispatchEvent(new Event('online'));
    expect(gateNow()).toBe('open');
    expect(seen).toEqual(['connect', 'open']);
  });

  it('a blip shorter than the grace changes nothing', async () => {
    await boot(true);
    const seen: Gate[] = [];
    onGateChange((g) => seen.push(g));
    dom.nav.onLine = false;
    dom.win.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(20_000);
    dom.nav.onLine = true;
    dom.win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(OFFLINE_GRACE_MS * 2);
    expect(seen).toEqual([]);
    expect(gateNow()).toBe('open');
  });

  it('signing out, or deleting the account, is not a dropped connection: no grace', async () => {
    await boot(true);
    onGateChange(() => {});
    expect(gateNow()).toBe('open');
    await signOutCloud();
    expect(gateNow()).toBe('connect');
    expect(canStart('career')).toBe(false);

    _resetForTests();
    _resetOnlineForTests();
    _setEnvForTests({ ...ENV });
    await boot(true);
    expect(gateNow()).toBe('open');
    await forgetAccount();
    expect(gateNow()).toBe('connect');
  });
});
