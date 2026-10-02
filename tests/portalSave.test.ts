import { describe, expect, it } from 'vitest';
import { adoptPortalStore, defaultSave, writeSave } from '../src/core/save';

/** CrazyGames' Data Module (platform/ads.ts portalStore): the save follows a signed-in player between devices. */
function fakeStore(seed?: string) {
  const m = new Map<string, string>();
  if (seed !== undefined) m.set('blocky-league-save-v1', seed);
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

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
