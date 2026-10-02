import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BALL_SKIN_IDS, CELEBRATION_IDS, CELEBRATION_LEVEL, GOAL_FX_IDS, TRAIL_IDS, defaultSave, importSave, loadSave, nextUnlock, normalizeSettings,
  normalizeShop, skinUnlocked, xpAt, type SaveData,
} from '../src/core/save';
import { SQUAD_MAX, SQUAD_MIN, clubRating, createClub, migrateCareer, type ClubState } from '../src/meta/career';
import { KIT_COLORS } from '../src/meta/data';
import { quickSaleValue } from '../src/meta/market';
import {
  CAT_LABEL, DEFAULT_ID, PACKS, PACK_OVR_CAP, RARITIES, RARITY_OVR, SHOP_CATS, affordable, buyItem, equipItem, equippedId, freePackReady, inReach,
  itemKey, makeRoom, markSeen, newInShop, openPack, owns, packPrice, pendingCard, releaseCandidate, rollPack, sellCard, settlePack, shopItem, shopItems, shopOf,
  signCard,
  type PackCard,
} from '../src/meta/shop';
import { GOAL_FX_COLORS, TRAIL_COLORS, goalFxColors, trailColors } from '../src/render/cosmetics';
import { overall, type Kit } from '../src/sim/types';

const KEY = 'blocky-league-save-v1';
const KIT: Kit = { shirt: KIT_COLORS.red, shirt2: KIT_COLORS.white, pattern: 'hoops', shorts: KIT_COLORS.white, socks: KIT_COLORS.red, gk: 0 };
const DAY = '2026-10-02';

function stubStorage(stored: unknown): void {
  const data = new Map<string, string>([[KEY, JSON.stringify(stored)]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
}

afterEach(() => vi.unstubAllGlobals());

function fresh(coins = 500): SaveData {
  const s = defaultSave();
  s.coins = coins;
  return s;
}

const club = (seed = 7): ClubState => createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);

describe('catalogue', () => {
  it('lists every celebration, ball look, goal theme and trail, each with one free default', () => {
    expect(shopItems('celebration').map((i) => i.id)).toEqual([...CELEBRATION_IDS]);
    expect(shopItems('ball').map((i) => i.id)).toEqual([...BALL_SKIN_IDS]);
    expect(shopItems('goalfx').map((i) => i.id)).toEqual([...GOAL_FX_IDS]);
    expect(shopItems('trail').map((i) => i.id)).toEqual([...TRAIL_IDS]);
    for (const cat of SHOP_CATS) {
      const free = shopItems(cat).filter((i) => i.price === 0);
      expect(free.map((i) => i.id)).toEqual([DEFAULT_ID[cat]]);
      expect(CAT_LABEL[cat].length).toBeGreaterThan(0);
    }
  });

  it('prices: something new every few matches early on, and a few to aim at', () => {
    const paid = shopItems().filter((i) => i.price > 0).map((i) => i.price);
    // A match on Normal pays ~50-210: the cheapest few are two to four matches away.
    expect(Math.min(...paid)).toBeGreaterThanOrEqual(200);
    expect(paid.filter((p) => p <= 500).length).toBeGreaterThanOrEqual(8);
    expect(paid.filter((p) => p >= 1500).length).toBeGreaterThanOrEqual(3);
    // Dearer celebrations sit higher on the level ladder too.
    const celebs = shopItems('celebration').filter((i) => i.price > 0);
    for (let i = 1; i < celebs.length; i++) expect(celebs[i].price).toBeGreaterThan(celebs[i - 1].price);
  });

  it('names carry no hyphen (the pixel font draws it badly)', () => {
    for (const it of shopItems()) expect(it.name).not.toMatch(/[-–—·]/);
  });

  it('every theme and trail has its colours; an unknown id falls back to the defaults', () => {
    for (const id of GOAL_FX_IDS) if (id !== 'club') expect(GOAL_FX_COLORS[id].length).toBeGreaterThan(2);
    for (const id of TRAIL_IDS) expect(TRAIL_COLORS[id].length).toBeGreaterThan(0);
    const club = [1, 2, 3];
    expect(goalFxColors(undefined, club)).toBe(club);
    expect(goalFxColors('club', club)).toBe(club);
    expect(goalFxColors('nope', club)).toBe(club);
    expect(goalFxColors('gold', club)).toBe(GOAL_FX_COLORS.gold);
    expect(trailColors(undefined)).toBe(TRAIL_COLORS.white);
    expect(trailColors('fire')).toBe(TRAIL_COLORS.fire);
  });
});

describe('buying', () => {
  it('takes the price from the wallet and owns the item for good', () => {
    const s = fresh(500);
    expect(owns(s, 'celebration', 'knee')).toBe(false);
    const r = buyItem(s, 'celebration', 'knee');
    expect(r.ok).toBe(true);
    expect(s.coins).toBe(500 - shopItem('celebration', 'knee')!.price);
    expect(owns(s, 'celebration', 'knee')).toBe(true);
    expect(s.shop!.owned).toContain('celebration:knee');
    // Twice is refused and costs nothing.
    const again = buyItem(s, 'celebration', 'knee');
    expect(again).toMatchObject({ ok: false, reason: 'owned' });
    expect(s.coins).toBe(500 - shopItem('celebration', 'knee')!.price);
  });

  it('never takes the wallet below zero: short of the price nothing changes', () => {
    const s = fresh(100);
    const r = buyItem(s, 'ball', 'gold');
    expect(r).toEqual({ ok: false, reason: 'no-coins', short: shopItem('ball', 'gold')!.price - 100 });
    expect(s.coins).toBe(100);
    expect(owns(s, 'ball', 'gold')).toBe(false);
    // Exactly enough leaves exactly zero.
    const t = fresh(shopItem('trail', 'fire')!.price);
    expect(buyItem(t, 'trail', 'fire').ok).toBe(true);
    expect(t.coins).toBe(0);
    // A damaged wallet counts as empty.
    const u = fresh(0);
    u.coins = Number.NaN;
    expect(buyItem(u, 'trail', 'fire')).toMatchObject({ ok: false, reason: 'no-coins' });
    // Free and unknown items are not for sale.
    expect(buyItem(fresh(), 'ball', 'classic')).toMatchObject({ ok: false, reason: 'owned' });
    expect(buyItem(fresh(), 'ball', 'platinum')).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('level unlocks still work: an item earned by level is owned without buying, and costs nothing', () => {
    const s = fresh(5000);
    s.progress.xp = xpAt(CELEBRATION_LEVEL.plane);
    expect(owns(s, 'celebration', 'plane')).toBe(true);
    expect(owns(s, 'celebration', 'robot')).toBe(false);
    expect(buyItem(s, 'celebration', 'plane')).toMatchObject({ ok: false, reason: 'owned' });
    expect(s.coins).toBe(5000);
    // The old helpers are untouched.
    expect(skinUnlocked('retro', 1)).toBe(false);
    expect(skinUnlocked('retro', 2)).toBe(true);
    // Goal themes and trails have no ladder: coins only, whatever the level.
    s.progress.xp = xpAt(60);
    expect(owns(s, 'goalfx', 'galaxy')).toBe(false);
  });

  it('NEXT UNLOCK skips what was bought (a level that brings nothing new is not "next")', () => {
    const s = fresh(1000);
    expect(nextUnlock(0)?.id).toBe('retro');
    buyItem(s, 'ball', 'retro');
    expect(nextUnlock(0, s.shop!.owned)?.id).toBe('knee');
    buyItem(s, 'celebration', 'knee');
    expect(nextUnlock(0, s.shop!.owned)?.id).toBe('blaze');
    expect(nextUnlock(0, [])?.id).toBe('retro');
  });
});

describe('equipping', () => {
  it('puts an owned item into Settings, where the match reads it', () => {
    const s = fresh(5000);
    buyItem(s, 'ball', 'neon');
    buyItem(s, 'goalfx', 'fire');
    buyItem(s, 'trail', 'pink');
    buyItem(s, 'celebration', 'backflip');
    expect(equipItem(s, 'ball', 'neon')).toBe(true);
    expect(equipItem(s, 'goalfx', 'fire')).toBe(true);
    expect(equipItem(s, 'trail', 'pink')).toBe(true);
    expect(equipItem(s, 'celebration', 'backflip')).toBe(true);
    expect(s.settings).toMatchObject({ ballSkin: 'neon', goalFx: 'fire', trail: 'pink', celebration: 'backflip' });
    expect(equippedId(s, 'goalfx')).toBe('fire');
    // And survives the settings normaliser.
    expect(normalizeSettings(JSON.parse(JSON.stringify(s.settings)))).toMatchObject({ ballSkin: 'neon', goalFx: 'fire', trail: 'pink', celebration: 'backflip' });
  });

  it('refuses what you do not own, and an equipped choice you no longer own plays as the default', () => {
    const s = fresh(0);
    expect(equipItem(s, 'goalfx', 'galaxy')).toBe(false);
    expect(s.settings.goalFx).toBeUndefined();
    s.settings.celebration = 'pile';
    expect(equippedId(s, 'celebration')).toBe('classic');
    s.settings.trail = 'rainbow';
    expect(equippedId(s, 'trail')).toBe('white');
    expect(equipItem(s, 'trail', 'white')).toBe(true);
  });
});

describe('saves', () => {
  it('a brand-new save has a whole, empty shop', () => {
    expect(defaultSave().shop).toEqual({ owned: [], seen: [], freePack: '', packs: 0, pending: null });
  });

  it('old saves (no shop, no goal theme or trail) load and own nothing bought', () => {
    const old = defaultSave() as unknown as Record<string, unknown>;
    delete old.shop;
    const settings = old.settings as Record<string, unknown>;
    delete settings.goalFx;
    delete settings.trail;
    old.coins = 900;
    stubStorage(old);
    const s = loadSave();
    expect(s.shop).toEqual({ owned: [], seen: [], freePack: '', packs: 0, pending: null });
    expect(s.coins).toBe(900);
    expect(s.settings.goalFx).toBeUndefined();
    expect(equippedId(s, 'goalfx')).toBe('club');
    expect(owns(s, 'celebration', 'knee')).toBe(false);
  });

  it('purchases persist through storage, export and import', () => {
    const s = fresh(5000);
    buyItem(s, 'goalfx', 'gold');
    equipItem(s, 'goalfx', 'gold');
    s.shop!.freePack = DAY;
    s.shop!.packs = 4;
    stubStorage(s);
    const back = loadSave();
    expect(back.shop).toEqual({ owned: ['goalfx:gold'], seen: ['goalfx:gold'], freePack: DAY, packs: 4, pending: null });
    expect(back.settings.goalFx).toBe('gold');
    expect(owns(back, 'goalfx', 'gold')).toBe(true);
    const imported = importSave(JSON.stringify(back));
    expect(imported?.shop?.owned).toEqual(['goalfx:gold']);
  });

  it('a damaged shop blob is made whole: junk dropped, numbers sane, ids unknown to the settings cleared', () => {
    expect(normalizeShop({ owned: ['ball:gold', 'ball:gold', 7, '<b>', 'x'], seen: 'nope', freePack: 'yesterday', packs: -3 }))
      .toEqual({ owned: ['ball:gold'], seen: [], freePack: '', packs: 0, pending: null });
    expect(normalizeShop(null)).toEqual({ owned: [], seen: [], freePack: '', packs: 0, pending: null });
    expect(normalizeShop([1, 2])).toEqual({ owned: [], seen: [], freePack: '', packs: 0, pending: null });
    const st = normalizeSettings({ goalFx: 'lava', trail: 42 });
    expect(st.goalFx).toBeUndefined();
    expect(st.trail).toBeUndefined();
    // A save whose shop went missing at run time (an old cloud copy) is made whole on first use.
    const s = fresh();
    delete s.shop;
    expect(shopOf(s)).toEqual({ owned: [], seen: [], freePack: '', packs: 0, pending: null });
    expect(s.shop).toBeDefined();
  });
});

describe('nudges', () => {
  it('the SHOP badge counts affordable items not yet seen, plus the free pack; looking clears them', () => {
    const s = fresh(320);
    const cheap = affordable(s).map((i) => itemKey(i.cat, i.id));
    expect(cheap).toEqual(expect.arrayContaining(['ball:retro', 'celebration:knee', 'trail:fire', 'trail:ice']));
    expect(newInShop(s, DAY)).toBe(cheap.length + 1);
    markSeen(s, 'trail');
    expect(newInShop(s, DAY)).toBe(cheap.filter((k) => !k.startsWith('trail:')).length + 1);
    s.shop!.freePack = DAY;
    for (const c of SHOP_CATS) markSeen(s, c);
    expect(newInShop(s, DAY)).toBe(0);
    // More coins: the newly affordable ones are news again, once.
    s.coins = 700;
    expect(newInShop(s, DAY)).toBeGreaterThan(0);
  });

  it('full time names the dearest item a match brought into reach, and nothing when none crossed the line', () => {
    const s = fresh();
    expect(inReach(s, 280, 470)?.price).toBe(450);
    expect(inReach(s, 500, 520)).toBeNull();
    s.coins = 5000;
    buyItem(s, 'goalfx', 'fire');
    buyItem(s, 'goalfx', 'ice');
    buyItem(s, 'celebration', 'shush');
    // Owned items are never "in reach".
    expect(inReach(s, 420, 460)).toBeNull();
  });
});

describe('scout packs', () => {
  it('draws the same card from the same seed, and different ones across seeds', () => {
    const a = rollPack('scout', 52, 1234, ['A. Pebble']);
    const b = rollPack('scout', 52, 1234, ['A. Pebble']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const names = new Set(Array.from({ length: 30 }, (_, i) => rollPack('scout', 52, i).player.name));
    expect(names.size).toBeGreaterThan(15);
  });

  it('a card is rated against your XI by its rarity, and the odds hold', () => {
    const tally: Record<string, number> = { common: 0, rare: 0, epic: 0, legend: 0 };
    for (let seed = 0; seed < 2000; seed++) {
      const c = rollPack('scout', 55, seed);
      tally[c.rarity]++;
      const [lo, hi] = RARITY_OVR[c.rarity];
      expect(c.ovr).toBeGreaterThanOrEqual(55 + lo - 2);
      expect(c.ovr).toBeLessThanOrEqual(Math.min(PACK_OVR_CAP, 55 + hi) + 2);
      expect(c.ovr).toBe(overall(c.player));
    }
    PACKS.scout.odds.forEach((pct, i) => expect(Math.abs(tally[RARITIES[i]] / 20 - pct)).toBeLessThan(4));
    // The elite pack never draws a common.
    for (let seed = 0; seed < 300; seed++) expect(rollPack('elite', 55, seed).rarity).not.toBe('common');
    // The odds shown add up.
    for (const k of ['scout', 'elite'] as const) expect(PACKS[k].odds.reduce((a, b) => a + b, 0)).toBe(100);
    // Never past the cap, even for a superclub.
    for (let seed = 0; seed < 200; seed++) expect(rollPack('elite', 92, seed).ovr).toBeLessThanOrEqual(PACK_OVR_CAP + 1);
  });

  it('never draws a surname already in the squad', () => {
    const c = club();
    const taken = c.squad.map((p) => p.name.split(' ').pop());
    for (let seed = 0; seed < 100; seed++) {
      const card = rollPack('scout', 50, seed, c.squad.map((p) => p.name));
      expect(taken).not.toContain(card.player.name.split(' ').pop());
    }
  });

  it('opening one costs its price (scaled to the club), never below zero; the free one is once a day', () => {
    const c = club();
    const price = packPrice('scout', clubRating(c));
    expect(price).toBe(PACKS.scout.price);
    expect(packPrice('scout', 80)).toBeGreaterThan(PACKS.scout.price);
    expect(packPrice('elite', 200)).toBe(PACKS.elite.price * 4);
    const s = fresh(price + 10);
    const r = openPack(s, c, 'scout', DAY);
    expect(r.ok).toBe(true);
    expect(s.coins).toBe(10);
    expect(s.shop!.packs).toBe(1);
    expect(openPack(s, c, 'scout', DAY)).toEqual({ ok: false, reason: 'no-coins', short: price - 10 });
    expect(s.coins).toBe(10);
    // The free daily pack: costs nothing, once a day.
    expect(freePackReady(s, DAY)).toBe(true);
    const f = openPack(s, c, 'scout', DAY, true);
    expect(f).toMatchObject({ ok: true, price: 0, free: true });
    expect(s.coins).toBe(10);
    expect(freePackReady(s, DAY)).toBe(false);
    expect(openPack(s, c, 'scout', DAY, true)).toMatchObject({ ok: false, reason: 'free-used' });
    expect(openPack(s, c, 'elite', '2026-10-03', true)).toMatchObject({ ok: false, reason: 'free-used' });
    expect(freePackReady(s, '2026-10-03')).toBe(true);
    // No club, no pack (and no charge).
    const t = fresh(5000);
    expect(openPack(t, null, 'scout', DAY)).toMatchObject({ ok: false, reason: 'no-club' });
    expect(t.coins).toBe(5000);
  });

  it('a card opened but not signed or sold comes back (a closed tab never loses a paid pack)', () => {
    const s = fresh(5000);
    const c = club();
    const r = openPack(s, c, 'elite', DAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(s.shop!.pending).toEqual({ kind: 'elite', seed: expect.any(Number), base: clubRating(c), price: r.price });
    stubStorage(s);
    const back = loadSave();
    const again = pendingCard(back, club());
    expect(again?.price).toBe(r.price);
    expect(again?.card.ovr).toBe(r.card.ovr);
    expect(again?.card.rarity).toBe(r.card.rarity);
    expect(JSON.stringify(again?.card.player.stats)).toBe(JSON.stringify(r.card.player.stats));
    settlePack(back);
    expect(pendingCard(back, club())).toBeNull();
    // A damaged pending entry is dropped.
    expect(normalizeShop({ pending: { kind: 'gold', seed: 1, base: 50, price: 1 } }).pending).toBeNull();
    expect(normalizeShop({ pending: { kind: 'scout', seed: 'x', base: 50, price: 1 } }).pending).toBeNull();
  });

  it('the same save draws the same card again after a reload (no rerolling)', () => {
    const s = fresh(5000);
    const a = openPack(s, club(), 'scout', DAY);
    const t = fresh(5000);
    const b = openPack(t, club(), 'scout', DAY);
    expect(a.ok && b.ok && a.card.player.name === b.card.player.name && a.card.ovr === b.card.ovr).toBe(true);
    const c = openPack(s, club(), 'scout', DAY);
    expect(c.ok && a.ok && JSON.stringify(c.card) !== JSON.stringify(a.card)).toBe(true);
  });

  it('signing respects the squad limit, takes a fresh id and number, and starts a better player', () => {
    const c = club();
    const before = clubRating(c);
    const weakest = Math.min(...c.squad.slice(0, 11).filter((p) => p.role === 'FW').map(overall));
    const card: PackCard = (() => {
      for (let seed = 0; ; seed++) {
        const k = rollPack('elite', before, seed);
        if (k.player.role === 'FW' && k.ovr > weakest + 3) return k;
      }
    })();
    const r = signCard(c, card, 350, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.starter).toBe(true);
    expect(c.squad.slice(0, 11)).toContain(r.player);
    expect(r.ovrTo).toBeGreaterThanOrEqual(before);
    expect(new Set(c.squad.map((p) => p.id)).size).toBe(c.squad.length);
    expect(new Set(c.squad.map((p) => p.number)).size).toBe(c.squad.length);
    expect(r.player).toMatchObject({ paid: 350, boughtSeason: 1, starts: 0 });
    // Fill the squad to the limit: the next one is refused and nothing changes.
    for (let seed = 100; c.squad.length < SQUAD_MAX; seed++) expect(signCard(c, rollPack('scout', before, seed)).ok).toBe(true);
    const n = c.squad.length;
    expect(signCard(c, rollPack('scout', before, 999))).toEqual({ ok: false, reason: 'squad-full' });
    expect(c.squad.length).toBe(n);
    expect(n).toBe(SQUAD_MAX);
  });

  it('a weaker card goes to the bench and leaves the XI alone', () => {
    const c = club();
    const xi = c.squad.slice(0, 11).map((p) => p.id);
    let card: PackCard | null = null;
    for (let seed = 0; !card; seed++) {
      const k = rollPack('scout', 30, seed);
      if (k.rarity === 'common') card = k;
    }
    const r = signCard(c, card);
    expect(r.ok && !r.starter).toBe(true);
    expect(c.squad.slice(0, 11).map((p) => p.id)).toEqual(xi);
  });

  it('a full squad can make room (the weakest sub, never the last keeper) or sell the card on', () => {
    const st = migrateCareer(null, 7);
    st.club = club();
    const c = st.club;
    for (let seed = 0; c.squad.length < SQUAD_MAX; seed++) signCard(c, rollPack('scout', 40, seed));
    const i = releaseCandidate(c);
    expect(i).toBeGreaterThanOrEqual(11);
    const out = c.squad[i];
    const bench = c.squad.slice(11).filter((p) => p.role !== 'GK' || c.squad.filter((q) => q.role === 'GK').length > 1);
    expect(overall(out)).toBe(Math.min(...bench.map(overall)));
    const wallet = { coins: 0 };
    const r = makeRoom(st, wallet);
    expect(r.ok).toBe(true);
    expect(c.squad).not.toContain(out);
    expect(wallet.coins).toBeGreaterThan(0);
    expect(c.squad.length).toBe(SQUAD_MAX - 1);
    // Selling a card instead pays its quick-sale value.
    const s = fresh(0);
    const card = rollPack('scout', 50, 3);
    expect(sellCard(s, card)).toBe(quickSaleValue(card.player));
    expect(s.coins).toBe(quickSaleValue(card.player));
    // A squad at the minimum lets nobody go.
    const small = club();
    small.squad = small.squad.slice(0, SQUAD_MIN);
    expect(releaseCandidate(small)).toBe(-1);
  });

  it('a pack never pays back more than it costs on a quick sale, on average', () => {
    for (const base of [45, 60, 75, 90]) {
      let total = 0;
      for (let seed = 0; seed < 400; seed++) total += quickSaleValue(rollPack('scout', base, seed).player);
      expect(total / 400).toBeLessThan(packPrice('scout', base));
    }
  });
});
