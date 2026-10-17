import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptPortalStore, defaultSave, hasProgress, holdPortalWrites, loadSave, portalSaveSwapped, portalTagCurrent, saveBaseline, writeSave, type SaveData } from '../src/core/save';

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

// ------------------------------------------------------------------ whose save it is (CrazyGames accounts)

const ASIDE = `${KEY}:set-aside`;

/** A played save that is recognisably one player's: his club and his coins. */
function club(owner: 'A' | 'B' | 'guest', matches: number, tag?: string): SaveData {
  const d = played(matches, '2026-10-01T10:00:00.000Z', owner === 'A' ? 11_111 : owner === 'B' ? 22_222 : 33_333);
  d.clubIdx = owner === 'A' ? 1 : owner === 'B' ? 2 : 3;
  if (tag !== undefined) d.portalUid = tag;
  return d;
}

/**
 * One visit, as main.ts runs it: load this browser's copy, settle it with the store for whoever is playing, swap the
 * store's copy in if it won. Returns the save the visit plays on.
 */
function visit(store: ReturnType<typeof fakeStore>, uid: string | null): SaveData {
  const local = loadSave();
  const theirs = adoptPortalStore(store, local, saveBaseline(local), uid);
  if (theirs) portalSaveSwapped();
  return theirs ?? local;
}

function playOn(d: SaveData, matches: number): void {
  d.record.played += matches;
  d.progress.xp += 90 * matches;
  expect(writeSave(d)).toBe(true);
}

describe('the portal cannot say who is playing (no User module, or no answer): exactly as before', () => {
  it('nothing is tagged, in the browser or in the store, whichever copy is kept', () => {
    const local = club('A', 12);
    const store = fakeStore(JSON.stringify(club('A', 9)));
    expect(adoptPortalStore(store, local)).toBeNull();
    expect(adoptPortalStore(store, local, saveBaseline(local), null)).toBeNull();
    expect('portalUid' in stored(store.m)).toBe(false);
    expect('portalUid' in stored(browser)).toBe(false);
    const fuller = fakeStore(JSON.stringify(club('A', 40)));
    const got = adoptPortalStore(fuller, local, saveBaseline(local), null)!;
    expect(got.record.played).toBe(40);
    expect('portalUid' in got).toBe(false);
    expect('portalUid' in stored(browser)).toBe(false);
  });

  it('a tagged copy is still measured the old way, and keeps the tag it had', () => {
    const local = club('A', 12, 'name:ana');
    const store = fakeStore(JSON.stringify(club('B', 3)));
    expect(adoptPortalStore(store, local, saveBaseline(local), null)).toBeNull();
    expect(stored(store.m).portalUid).toBe('name:ana');
    expect(browser.has(ASIDE)).toBe(false);
  });
});

describe('an untagged browser copy (every save made before the tag): the fuller copy wins, then it is tagged', () => {
  it('this browser\'s copy is the fuller one: kept, tagged for the player, and pushed', () => {
    const local = club('A', 12);
    const store = fakeStore(JSON.stringify(club('A', 9)));
    expect(adoptPortalStore(store, local, saveBaseline(local), 'name:ana')).toBeNull();
    expect(local.portalUid).toBe('name:ana');
    expect(stored(store.m)).toMatchObject({ portalUid: 'name:ana', record: { played: 12 } });
    expect(stored(browser).portalUid).toBe('name:ana');
    expect(browser.has(ASIDE)).toBe(false);
  });

  it('the account\'s copy is the fuller one: it comes in, tagged for the player', () => {
    const local = club('A', 3);
    const store = fakeStore(JSON.stringify(club('A', 40)));
    const got = adoptPortalStore(store, local, saveBaseline(local), 'name:ana')!;
    expect(got.record.played).toBe(40);
    expect(got.portalUid).toBe('name:ana');
    expect(stored(browser)).toMatchObject({ portalUid: 'name:ana', record: { played: 40 } });
    portalSaveSwapped();
    playOn(got, 1);
    expect(stored(store.m)).toMatchObject({ portalUid: 'name:ana', record: { played: 41 } });
  });

  it('a guest\'s untagged copy is tagged as a guest\'s (\'\'), which is not the same as untagged', () => {
    const local = club('guest', 5);
    const store = fakeStore();
    expect(adoptPortalStore(store, local, saveBaseline(local), '')).toBeNull();
    expect(local.portalUid).toBe('');
    expect(stored(store.m).portalUid).toBe('');
    expect(stored(browser).portalUid).toBe('');
  });
});

describe('the same player on a second device', () => {
  it('a new browser, his account further on: his copy comes in', () => {
    const store = fakeStore(JSON.stringify(club('A', 40, 'name:ana')));
    const run = visit(store, 'name:ana');
    expect(run).toMatchObject({ clubIdx: 1, coins: 11_111, portalUid: 'name:ana', record: { played: 40 } });
  });

  it('both tagged for him: further on in the account wins; further on here is pushed', () => {
    browser.set(KEY, JSON.stringify(club('A', 12, 'name:ana')));
    const ahead = fakeStore(JSON.stringify(club('A', 15, 'name:ana')));
    expect(visit(ahead, 'name:ana').record.played).toBe(15);
    browser.set(KEY, JSON.stringify(club('A', 20, 'name:ana')));
    const behind = fakeStore(JSON.stringify(club('A', 15, 'name:ana')));
    expect(visit(behind, 'name:ana').record.played).toBe(20);
    expect(stored(behind.m).record.played).toBe(20);
    expect(browser.has(ASIDE)).toBe(false);
  });
});

describe('a browser copy tagged for someone else is never this player\'s, however full it is', () => {
  it('account B on a browser holding A\'s fuller save: B\'s own copy wins outright, and nothing of A\'s reaches B\'s account', () => {
    const local = club('A', 60, 'name:ana');
    const store = fakeStore(JSON.stringify(club('B', 3, 'name:bob')));
    const setItem = vi.spyOn(store, 'setItem');
    const got = adoptPortalStore(store, local, saveBaseline(local), 'name:bob')!;
    expect(got).toMatchObject({ clubIdx: 2, coins: 22_222, portalUid: 'name:bob', record: { played: 3 } });
    expect(setItem).not.toHaveBeenCalled();
    expect(stored(browser)).toMatchObject({ clubIdx: 2, portalUid: 'name:bob' });
    // A's copy gave way: it is set aside in this browser, not destroyed (and it is still in A's account).
    expect(JSON.parse(browser.get(ASIDE)!)).toMatchObject({ clubIdx: 1, coins: 11_111, portalUid: 'name:ana' });
    // Whatever A's outgoing save does before the swap is written nowhere.
    local.coins += 500;
    expect(writeSave(local)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(stored(browser).clubIdx).toBe(2);
  });

  it('B\'s account has no copy: B starts on a new save (A\'s is never pushed into it)', () => {
    const local = club('A', 60, 'name:ana');
    const store = fakeStore();
    const setItem = vi.spyOn(store, 'setItem');
    const got = adoptPortalStore(store, local, saveBaseline(local), 'name:bob')!;
    expect(hasProgress(got)).toBe(false);
    expect(got).toMatchObject({ portalUid: 'name:bob', coins: defaultSave().coins, record: { played: 0 } });
    expect(setItem).not.toHaveBeenCalled();
    expect(stored(browser)).toMatchObject({ portalUid: 'name:bob', record: { played: 0 } });
    portalSaveSwapped();
    playOn(got, 1);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(stored(store.m)).toMatchObject({ portalUid: 'name:bob', record: { played: 1 } });
    expect(stored(store.m).coins).not.toBe(11_111);
  });

  it('an account\'s copy while a guest plays now: the guest store\'s copy wins outright, or a new save', () => {
    const local = club('A', 60, 'name:ana');
    const withCopy = fakeStore(JSON.stringify(club('guest', 2, '')));
    expect(adoptPortalStore(withCopy, local, saveBaseline(local), '')).toMatchObject({ clubIdx: 3, portalUid: '', record: { played: 2 } });
    portalSaveSwapped();
    const empty = fakeStore();
    const fresh = adoptPortalStore(empty, club('A', 60, 'name:ana'), undefined, '')!;
    expect(fresh).toMatchObject({ portalUid: '', record: { played: 0 } });
    expect(empty.m.size).toBe(0);
  });
});

describe('a guest who signs in', () => {
  it('the account already has a copy: it wins outright, however much the guest played, and is never written over', () => {
    const guest = club('guest', 30, '');
    const store = fakeStore(JSON.stringify(club('B', 4, 'name:bob')));
    const setItem = vi.spyOn(store, 'setItem');
    const got = adoptPortalStore(store, guest, saveBaseline(guest), 'name:bob')!;
    expect(got).toMatchObject({ clubIdx: 2, coins: 22_222, portalUid: 'name:bob', record: { played: 4 } });
    // Mid-match when he signed in: the guest save goes on being saved by the match, and none of it lands anywhere.
    playOnHeld(guest);
    expect(setItem).not.toHaveBeenCalled();
    expect(stored(store.m)).toMatchObject({ clubIdx: 2, record: { played: 4 } });
    expect(stored(browser)).toMatchObject({ clubIdx: 2, record: { played: 4 } });
    expect(JSON.parse(browser.get(ASIDE)!)).toMatchObject({ clubIdx: 3, record: { played: 30 } });
    portalSaveSwapped();
    playOn(got, 1);
    expect(stored(store.m)).toMatchObject({ clubIdx: 2, portalUid: 'name:bob', record: { played: 5 } });
  });

  function playOnHeld(d: SaveData): void {
    d.record.played += 1;
    expect(writeSave(d)).toBe(false);
  }

  it('the account has no copy: the guest\'s progress goes into it with him (CrazyGames\' own rule), tagged for the account', () => {
    const guest = club('guest', 30, '');
    const store = fakeStore();
    expect(adoptPortalStore(store, guest, saveBaseline(guest), 'name:bob')).toBeNull();
    expect(guest.portalUid).toBe('name:bob');
    expect(stored(store.m)).toMatchObject({ clubIdx: 3, portalUid: 'name:bob', record: { played: 30 } });
    expect(stored(browser).portalUid).toBe('name:bob');
    expect(browser.has(ASIDE)).toBe(false);
    // And it is his from then on: the next visit, signed in, is the same line of play.
    playOn(guest, 2);
    expect(visit(store, 'name:bob').record.played).toBe(32);
  });

  it('a copy still waiting to come in when he signs in: it can be held again until it is swapped in', () => {
    const waiting = club('guest', 30, '');
    const store = fakeStore();
    expect(adoptPortalStore(store, waiting, saveBaseline(waiting), 'name:bob')).toBeNull();
    holdPortalWrites();
    const outgoing = club('guest', 1, '');
    expect(writeSave(outgoing)).toBe(false);
    expect(stored(store.m).record.played).toBe(30);
    portalSaveSwapped();
    expect(writeSave(waiting)).toBe(true);
  });
});

describe('two accounts taking turns on one browser', () => {
  it('neither ever sees the other\'s club, and neither account\'s copy is ever written with the other\'s', () => {
    const storeA = fakeStore();
    const storeB = fakeStore();
    const writesA = vi.spyOn(storeA, 'setItem');
    const writesB = vi.spyOn(storeB, 'setItem');
    // A plays first on this browser and picks his club.
    let a = visit(storeA, 'name:ana');
    a.clubIdx = 1;
    a.coins = 11_111;
    playOn(a, 5);
    for (let round = 0; round < 3; round++) {
      // B signs in on the same browser.
      const b = visit(storeB, 'name:bob');
      expect(b.portalUid).toBe('name:bob');
      expect(b.coins).not.toBe(11_111);
      if (round === 0) {
        expect(hasProgress(b)).toBe(false);
        b.clubIdx = 2;
        b.coins = 22_222;
      } else {
        expect(b).toMatchObject({ clubIdx: 2, coins: 22_222, record: { played: 2 * round } });
      }
      playOn(b, 2);
      // A comes back.
      a = visit(storeA, 'name:ana');
      expect(a).toMatchObject({ clubIdx: 1, coins: 11_111, portalUid: 'name:ana', record: { played: 5 + 3 * round } });
      playOn(a, 3);
    }
    const tags = (spy: typeof writesA): string[] => [...new Set(spy.mock.calls.map((c) => (JSON.parse(c[1]) as SaveData).portalUid ?? 'untagged'))];
    const clubs = (spy: typeof writesA): number[] => [...new Set(spy.mock.calls.map((c) => (JSON.parse(c[1]) as SaveData).clubIdx))];
    expect(tags(writesA)).toEqual(['name:ana']);
    expect(tags(writesB)).toEqual(['name:bob']);
    expect(clubs(writesA).includes(2)).toBe(false);
    expect(clubs(writesB).includes(1)).toBe(false);
    expect(stored(storeA.m)).toMatchObject({ clubIdx: 1, coins: 11_111, record: { played: 14 } });
    expect(stored(storeB.m)).toMatchObject({ clubIdx: 2, coins: 22_222, record: { played: 6 } });
  });
});

describe('a copy tagged the old way (an account id, from a user token the game no longer asks for)', () => {
  /** What the build before this one wrote: the CrazyGames userId out of getUserToken's JWT. */
  const OLD = 'UOuZBKgjwpY9k4TSBB2NPugbsHD3';

  it('is in no form today\'s tags take; \'\' and name: tags are', () => {
    expect(portalTagCurrent(OLD)).toBe(false);
    expect(portalTagCurrent('4471')).toBe(false);
    expect(portalTagCurrent(undefined)).toBe(false);
    expect(portalTagCurrent('')).toBe(true);
    expect(portalTagCurrent('name:bob')).toBe(true);
  });

  it('it loads as it was, and is never taken for someone else\'s: the fuller copy wins, and it is tagged anew', () => {
    // His fuller copy here, his account's older one in the store: kept, re-tagged, pushed, nothing set aside.
    browser.set(KEY, JSON.stringify(club('B', 20, OLD)));
    expect(loadSave()).toMatchObject({ portalUid: OLD, clubIdx: 2, record: { played: 20 } });
    const behind = fakeStore(JSON.stringify(club('B', 15, OLD)));
    const run = visit(behind, 'name:bob');
    expect(run).toMatchObject({ portalUid: 'name:bob', clubIdx: 2, coins: 22_222, record: { played: 20 } });
    expect(stored(behind.m)).toMatchObject({ portalUid: 'name:bob', record: { played: 20 } });
    expect(stored(browser).portalUid).toBe('name:bob');
    expect(browser.has(ASIDE)).toBe(false);
    // The next visit is the same line of play: no "someone else's copy" on the way back.
    playOn(run, 1);
    expect(visit(behind, 'name:bob')).toMatchObject({ clubIdx: 2, record: { played: 21 } });
    expect(browser.has(ASIDE)).toBe(false);
  });

  it('the account\'s copy is the fuller one: it comes in, tagged; a guest now: the same rule, tagged as a guest\'s', () => {
    browser.set(KEY, JSON.stringify(club('B', 3, OLD)));
    const ahead = fakeStore(JSON.stringify(club('B', 40, OLD)));
    expect(visit(ahead, 'name:bob')).toMatchObject({ portalUid: 'name:bob', record: { played: 40 } });
    expect(browser.has(ASIDE)).toBe(false);
    browser.clear();
    const local = club('B', 12, OLD);
    const guestStore = fakeStore(JSON.stringify(club('guest', 2, '')));
    expect(adoptPortalStore(guestStore, local, saveBaseline(local), '')).toBeNull();
    expect(local.portalUid).toBe('');
    expect(stored(guestStore.m)).toMatchObject({ portalUid: '', record: { played: 12 } });
    expect(browser.has(ASIDE)).toBe(false);
  });

  it('the portal cannot say who is playing: measured the old way, and the old tag is left as it was', () => {
    const local = club('B', 12, OLD);
    const store = fakeStore(JSON.stringify(club('B', 9, OLD)));
    expect(adoptPortalStore(store, local, saveBaseline(local), null)).toBeNull();
    expect(stored(store.m).portalUid).toBe(OLD);
  });
});

describe('the tag in a stored save', () => {
  it('is kept when it is a string, dropped when it is anything else, and absent on a save that never had one', () => {
    browser.set(KEY, JSON.stringify({ ...club('A', 3), portalUid: 'name:ana' }));
    expect(loadSave().portalUid).toBe('name:ana');
    browser.set(KEY, JSON.stringify({ ...club('A', 3), portalUid: '' }));
    expect(loadSave().portalUid).toBe('');
    for (const bad of [5, null, { id: 'x' }, ['name:ana'], true]) {
      browser.set(KEY, JSON.stringify({ ...club('A', 3), portalUid: bad }));
      expect('portalUid' in loadSave()).toBe(false);
    }
    browser.set(KEY, JSON.stringify(club('A', 3)));
    const old = loadSave();
    expect('portalUid' in old).toBe(false);
    expect(old.record.played).toBe(3);
    expect('portalUid' in defaultSave()).toBe(false);
  });
});
