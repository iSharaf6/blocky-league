import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptPortalStore, defaultSave, hasProgress, loadSave, portalSaveSwapped, saveBaseline, writeSave, type SaveData } from '../src/core/save';

const KEY = 'blocky-league-save-v1';

/** CrazyGames' Data Module (platform/ads.ts portalStore): the save follows a signed-in player between devices. */
function fakeStore(seed?: string) {
  const m = new Map<string, string>();
  if (seed !== undefined) m.set(KEY, seed);
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

/** This browser's own storage, as the save module uses it. */
let browser: Map<string, string>;
beforeEach(() => {
  browser = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => browser.get(k) ?? null,
    setItem: (k: string, v: string) => void browser.set(k, v),
    removeItem: (k: string) => void browser.delete(k),
  });
});
afterEach(() => {
  // (The hold on writes is the module's: no test leaves it on for the next.)
  portalSaveSwapped();
  vi.unstubAllGlobals();
});

/** A save a player has really played on: `matches` matches and their XP, last written at `at`. */
function played(matches: number, at: string, coins = 500 + 120 * matches): SaveData {
  const d = defaultSave();
  d.record.played = matches;
  d.record.won = matches;
  d.progress.xp = 90 * matches;
  d.coins = coins;
  d.onboarding = { basics: 3, firstGoal: true, unlockSeen: true };
  d.updatedAt = at;
  return d;
}

const stored = (m: Map<string, string>): SaveData => JSON.parse(m.get(KEY)!) as SaveData;

describe('the save in a portal store', () => {
  it('a newer copy in the store wins (he played on another device)', () => {
    const local = defaultSave();
    local.coins = 100;
    local.updatedAt = '2026-10-01T10:00:00.000Z';
    const theirs = { ...defaultSave(), coins: 900, updatedAt: '2026-10-02T10:00:00.000Z' };
    const got = adoptPortalStore(fakeStore(JSON.stringify(theirs)), local);
    expect(got?.coins).toBe(900);
  });

  it('an older or missing copy: the browser\'s is kept and written to the store at once, and every save after', () => {
    const local = defaultSave();
    local.coins = 321;
    local.updatedAt = '2026-10-03T10:00:00.000Z';
    const old = { ...defaultSave(), coins: 5, updatedAt: '2026-09-01T10:00:00.000Z' };
    const store = fakeStore(JSON.stringify(old));
    expect(adoptPortalStore(store, local)).toBeNull();
    expect(JSON.parse(store.m.get('blocky-league-save-v1')!).coins).toBe(321);
    local.coins = 400;
    writeSave(local);
    expect(JSON.parse(store.m.get('blocky-league-save-v1')!).coins).toBe(400);
    const empty = fakeStore();
    expect(adoptPortalStore(empty, local)).toBeNull();
    expect(JSON.parse(empty.m.get('blocky-league-save-v1')!).coins).toBe(400);
  });

  it('a broken copy in the store is ignored', () => {
    const local = defaultSave();
    expect(adoptPortalStore(fakeStore('{not json'), local)).toBeNull();
    expect(adoptPortalStore(fakeStore(JSON.stringify({ version: 9 })), local)).toBeNull();
  });
});

describe('a brand-new browser copy never beats the player\'s own', () => {
  it('what counts as progress: playing, earning or buying, never settings alone', () => {
    const d = defaultSave();
    expect(hasProgress(d)).toBe(false);
    d.settings.music = false;
    d.settings.difficulty = 3;
    d.clubIdx = 2;
    expect(hasProgress(d)).toBe(false);
    for (const earn of [
      (s: SaveData) => { s.record.played = 1; },
      (s: SaveData) => { s.progress.xp = 30; },
      (s: SaveData) => { s.onboarding = { basics: 1, firstGoal: false, unlockSeen: false }; },
      (s: SaveData) => { s.coins += 80; },
      (s: SaveData) => { s.gift = { last: '2026-10-10', streak: 1 }; },
      (s: SaveData) => { s.moments = { 'last-minute': 2 }; },
      (s: SaveData) => { s.career = { club: {} }; },
      (s: SaveData) => { s.shop!.owned.push('ball:gold'); },
      (s: SaveData) => { s.gems!.balance += 5; },
    ]) {
      const s = defaultSave();
      earn(s);
      expect(hasProgress(s)).toBe(true);
    }
  });

  it('a first visit on this browser (a blank save, stamped just now) against his account\'s older copy: his copy wins', () => {
    // The bug: defaultSave stamps "now", so the blank save looked newer and was written over the account's copy.
    const local = defaultSave();
    const theirs = played(40, '2026-09-20T18:00:00.000Z');
    const store = fakeStore(JSON.stringify(theirs));
    const setItem = vi.spyOn(store, 'setItem');
    const got = adoptPortalStore(store, local);
    expect(got?.record.played).toBe(40);
    expect(got?.progress.xp).toBe(3600);
    // Nothing was written over it, and it is in this browser's storage at once (a closed tab loses nothing).
    expect(setItem).not.toHaveBeenCalled();
    expect(stored(store.m).record.played).toBe(40);
    expect(stored(browser).record.played).toBe(40);
    expect(stored(browser).updatedAt).toBe('2026-09-20T18:00:00.000Z');
    expect(loadSave().record.played).toBe(40);
  });

  it('until his copy is swapped in, nothing the outgoing save does is stored anywhere; after, saves are mirrored', () => {
    const local = defaultSave();
    const store = fakeStore(JSON.stringify(played(40, '2026-09-20T18:00:00.000Z')));
    const got = adoptPortalStore(store, local)!;
    // A drill finished on the blank save while a match was still on: held, here and in the store.
    local.progress.xp = 30;
    expect(writeSave(local)).toBe(false);
    expect(stored(store.m).progress.xp).toBe(3600);
    expect(stored(browser).progress.xp).toBe(3600);
    // main.ts swaps it in at the next safe point (reload), and saving carries on with it.
    portalSaveSwapped();
    got.coins += 250;
    expect(writeSave(got)).toBe(true);
    expect(stored(store.m).coins).toBe(got.coins);
    expect(stored(store.m).record.played).toBe(40);
    expect(stored(browser).coins).toBe(got.coins);
  });

  it('a blank copy in the store (he only opened the game on another device) never beats real progress here', () => {
    const local = played(12, '2026-10-01T10:00:00.000Z');
    const blank = { ...defaultSave(), updatedAt: '2026-10-09T10:00:00.000Z' };
    const store = fakeStore(JSON.stringify(blank));
    expect(adoptPortalStore(store, local)).toBeNull();
    expect(stored(store.m).record.played).toBe(12);
  });

  it('real progress here against an older copy in the store: this one wins and is pushed', () => {
    const local = played(12, '2026-10-08T10:00:00.000Z');
    const old = played(9, '2026-10-01T10:00:00.000Z');
    const store = fakeStore(JSON.stringify(old));
    expect(adoptPortalStore(store, local)).toBeNull();
    expect(stored(store.m).record.played).toBe(12);
    expect(stored(store.m).progress.xp).toBe(1080);
    expect(stored(browser).record.played).toBe(12);
    // And every save after it.
    local.coins += 75;
    expect(writeSave(local)).toBe(true);
    expect(stored(store.m).coins).toBe(local.coins);
  });

  it('a few minutes as a guest, then signed in to an account with far more: the account is kept, however new the guest save', () => {
    const guest = played(1, '2026-10-12T20:00:00.000Z');
    const account = played(60, '2026-10-05T09:00:00.000Z');
    const store = fakeStore(JSON.stringify(account));
    expect(adoptPortalStore(store, guest)?.record.played).toBe(60);
    expect(stored(store.m).record.played).toBe(60);
  });

  it('the same line of play, further on in the store (he played on another device since): that copy wins', () => {
    const local = played(12, '2026-10-01T10:00:00.000Z');
    const store = fakeStore(JSON.stringify(played(15, '2026-10-06T10:00:00.000Z')));
    expect(adoptPortalStore(store, local)?.record.played).toBe(15);
  });

  it('level on XP and matches: something earned beats nothing earned, then the later stamp', () => {
    const shopper = { ...defaultSave(), coins: 300, updatedAt: '2026-10-01T10:00:00.000Z' };
    const blankLater = { ...defaultSave(), updatedAt: '2026-10-09T10:00:00.000Z' };
    expect(adoptPortalStore(fakeStore(JSON.stringify(blankLater)), shopper)).toBeNull();
    portalSaveSwapped();
    expect(adoptPortalStore(fakeStore(JSON.stringify(shopper)), { ...defaultSave() })?.coins).toBe(300);
    portalSaveSwapped();
    // Nothing earned on either: the store's settings are kept (this browser's copy was only just made).
    const quiet = defaultSave();
    quiet.settings.music = false;
    quiet.updatedAt = '2026-10-01T10:00:00.000Z';
    expect(adoptPortalStore(fakeStore(JSON.stringify(quiet)), defaultSave())?.settings.music).toBe(false);
  });
});

describe('the store arrives late (a slow SDK): the copies are measured as the visit began', () => {
  it('a blank browser copy at load stays blank for the comparison, whatever was played before the SDK came up', () => {
    const local = defaultSave();
    const atLoad = saveBaseline(local);
    expect(atLoad).toEqual({ xp: 0, played: 0, progress: false, updatedAt: '' });
    // The first drill is done and saved while the SDK is still coming up.
    local.progress.xp = 30;
    local.onboarding = { basics: 1, firstGoal: false, unlockSeen: false };
    expect(writeSave(local)).toBe(true);
    const store = fakeStore(JSON.stringify(played(40, '2026-09-20T18:00:00.000Z')));
    const got = adoptPortalStore(store, local, atLoad);
    expect(got?.record.played).toBe(40);
    expect(stored(store.m).record.played).toBe(40);
    expect(stored(browser).record.played).toBe(40);
  });

  it('without the measure taken at load, the same thirty XP would have been compared as real progress (and still lost to more)', () => {
    const local = defaultSave();
    local.progress.xp = 30;
    const store = fakeStore(JSON.stringify(played(40, '2026-09-20T18:00:00.000Z')));
    expect(adoptPortalStore(store, local)?.record.played).toBe(40);
  });

  it('a stale browser copy, saved again on this visit, does not pass for newer than the store\'s', () => {
    // Twelve matches here a fortnight ago; fifteen on the account since. This visit opened the hub (which saves)
    // before the SDK came up, so the browser copy's stamp is "now".
    const local = played(12, '2026-09-28T10:00:00.000Z');
    const atLoad = saveBaseline(local);
    expect(writeSave(local)).toBe(true);
    expect(local.updatedAt > '2026-10-06T10:00:00.000Z').toBe(true);
    const store = fakeStore(JSON.stringify(played(12, '2026-10-06T10:00:00.000Z', 9000)));
    const got = adoptPortalStore(store, local, atLoad);
    expect(got?.coins).toBe(9000);
    expect(stored(store.m).coins).toBe(9000);
  });

  it('this browser\'s copy was the one to keep at load: what was played since goes up with it', () => {
    const local = played(12, '2026-10-08T10:00:00.000Z');
    const atLoad = saveBaseline(local);
    local.record.played = 13;
    local.progress.xp += 90;
    writeSave(local);
    const store = fakeStore(JSON.stringify(played(9, '2026-10-01T10:00:00.000Z')));
    expect(adoptPortalStore(store, local, atLoad)).toBeNull();
    expect(stored(store.m).record.played).toBe(13);
    // Mirrored from now on, though the store came late.
    local.coins += 40;
    writeSave(local);
    expect(stored(store.m).coins).toBe(local.coins);
  });

  it('no store at all (the SDK never came up): saving is local, as on any other build', () => {
    const local = played(3, '2026-10-08T10:00:00.000Z');
    expect(writeSave(local)).toBe(true);
    expect(stored(browser).record.played).toBe(3);
  });
});

describe('a store that throws', () => {
  it('cannot be read: nothing is taken from it, nothing is written over it, and the game saves locally', () => {
    const local = played(5, '2026-10-08T10:00:00.000Z');
    const setItem = vi.fn();
    const store = { getItem: () => { throw new Error('data module down'); }, setItem };
    expect(() => adoptPortalStore(store, local)).not.toThrow();
    expect(adoptPortalStore(store, local)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    local.coins += 10;
    expect(writeSave(local)).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
    expect(stored(browser).coins).toBe(local.coins);
  });

  it('cannot be written: the browser\'s copy still saves, now and after', () => {
    const local = played(5, '2026-10-08T10:00:00.000Z');
    const setItem = vi.fn(() => { throw new Error('quota'); });
    const store = { getItem: () => null, setItem };
    expect(adoptPortalStore(store, local)).toBeNull();
    expect(setItem).toHaveBeenCalledTimes(1);
    local.coins += 10;
    expect(writeSave(local)).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(stored(browser).coins).toBe(local.coins);
  });

  it('his copy wins but this browser has no storage: it is still handed over, and saving carries on once swapped in', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('private mode'); } });
    const store = fakeStore(JSON.stringify(played(40, '2026-09-20T18:00:00.000Z')));
    const got = adoptPortalStore(store, defaultSave())!;
    expect(got.record.played).toBe(40);
    portalSaveSwapped();
    got.coins += 1;
    expect(writeSave(got)).toBe(false);
    expect(stored(store.m).coins).toBe(got.coins);
  });
});
