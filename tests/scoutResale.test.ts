import { describe, expect, it } from 'vitest';
import { defaultSave, importSave } from '../src/core/save';
import {
  BOTTOM_DIVISION, SQUAD_MIN, clonePlayer, createClub, cupDue, migrateCareer, newSeason, resolveCupTie,
  resolveMatchday, sellPlayer, sellValue, startNextSeason, swapPlayers, type CareerState,
} from '../src/meta/career';
import { KIT_COLORS } from '../src/meta/data';
import {
  QUICK_SALE, RESALE_STARTS, acceptOffer, listPlayer, placeBid, playerValue, quickSaleValue, resaleCap,
  resaleOfferAmount, saleFor, scoutResaleCap, type MetaPlayer,
} from '../src/meta/market';
import { RARITIES, SCOUT_RESALE, openPack, pendingCard, rollPack, sellCard, signCard, type PackCard, type Rarity } from '../src/meta/shop';
import type { Kit } from '../src/sim/types';

const KIT: Kit = { shirt: KIT_COLORS.red, shirt2: KIT_COLORS.white, pattern: 'hoops', shorts: KIT_COLORS.white, socks: KIT_COLORS.red, gk: 0 };
const DAY = '2026-10-06';

function career(seed = 7): CareerState {
  const state = migrateCareer(null, seed);
  state.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
  newSeason(state, BOTTOM_DIVISION, 1);
  return state;
}

function draw(rarity: Rarity, base = 90): PackCard {
  for (let seed = 0; seed < 1000; seed++) {
    const card = rollPack('scout', base, seed);
    if (card.rarity === rarity && card.player.role !== 'GK') return card;
  }
  throw new Error(`Missing test draw for ${rarity}`);
}

function sign(state: CareerState, card = draw('common')): MetaPlayer {
  const result = signCard(state.club!, card, 5000, state.season!.number);
  if (!result.ok) throw new Error('Test squad is full');
  return result.player;
}

function play(state: CareerState, forfeit = false): void {
  if (cupDue(state) >= 0) resolveCupTie(state, 0, 3, false, null, forfeit);
  expect(resolveMatchday(state, { coins: 1_000_000 }, state.season!.matchday, 0, 0, forfeit)).toBe(true);
}

function ordinaryValue(p: MetaPlayer): number {
  return Math.round(playerValue(p) * QUICK_SALE / 10) * 10;
}

describe('new scout resale credits', () => {
  it.each(RARITIES)('%s cards retain the same bounded quote through direct sale and sign-then-sale', (rarity) => {
    const card = draw(rarity);
    const credit = SCOUT_RESALE[rarity];
    expect(card.player.scoutResale).toBe(credit);
    expect(ordinaryValue(card.player)).toBeGreaterThan(credit);
    // This is also the reveal's quote; signing the card cannot change it into its rating-scaled market value.
    expect(quickSaleValue(card.player)).toBe(credit);
    const direct = { coins: 9000 };
    expect(sellCard(direct, card)).toBe(credit);
    expect(direct.coins).toBe(9000 + credit);
    const state = career();
    const p = sign(state, card);
    const signed = { coins: 9000 };
    expect(sellValue(p)).toBe(credit);
    expect(sellPlayer(state, signed, p.id)).toMatchObject({ ok: true, delta: credit });
    expect(signed.coins).toBe(direct.coins);
  });

  it('preserves both free and earned new pending credits through reload, without repricing legacy pending cards', () => {
    for (const free of [false, true]) {
      const save = defaultSave();
      const club = career().club!;
      const opened = openPack(save, club, 'scout', DAY, free);
      if (!opened.ok) throw new Error('Test pack did not open');
      const quote = quickSaleValue(opened.card.player);
      const loaded = importSave(JSON.parse(JSON.stringify(save)))!;
      const pending = pendingCard(loaded, club)!;
      expect(pending.card.player.scoutResale).toBe(opened.card.player.scoutResale);
      expect(quickSaleValue(pending.card.player)).toBe(quote);
    }
    const old = defaultSave();
    old.shop!.pending = { kind: 'scout', seed: 3, base: 90, price: 1050 };
    const pending = pendingCard(importSave(JSON.parse(JSON.stringify(old)))!, career().club!)!;
    expect(pending.card.player.scoutResale).toBeUndefined();
    expect(quickSaleValue(pending.card.player)).toBe(ordinaryValue(pending.card.player));
    expect(quickSaleValue(pending.card.player)).toBeGreaterThan(250);
  });

  it('never raises a naturally cheaper card to the rarity cap', () => {
    const card = draw('legend', 30);
    expect(ordinaryValue(card.player)).toBeLessThan(SCOUT_RESALE.legend);
    expect(quickSaleValue(card.player)).toBe(ordinaryValue(card.player));
  });

  it('carries the cap and starts through clone and career reload while preserving existing player values and wallet', () => {
    const save = defaultSave();
    const state = career();
    const p = sign(state);
    p.starts = 3;
    const old = state.club!.squad.find((q) => q.id !== p.id && q.role !== 'GK') as MetaPlayer;
    const oldQuote = quickSaleValue(old);
    expect(scoutResaleCap(old)).toBeNull();
    expect((clonePlayer(p) as MetaPlayer).scoutResale).toBe(75);
    save.career = state;
    save.coins = 12345;
    const loaded = importSave(JSON.parse(JSON.stringify(save)))!;
    const back = migrateCareer(loaded.career, state.seed);
    const returned = back.club!.squad.find((q) => q.id === p.id) as MetaPlayer;
    expect(returned).toMatchObject({ scoutResale: 75, starts: 3 });
    expect(quickSaleValue(returned)).toBe(75);
    const legacy = back.club!.squad.find((q) => q.id === old.id)!;
    expect(scoutResaleCap(legacy)).toBeNull();
    expect(resaleCap(back, legacy)).toBeNull();
    expect(quickSaleValue(legacy)).toBe(oldQuote);
    expect(loaded.coins).toBe(12345);
  });

  it('requires six completed league starts, surviving a forfeited season, bench matches, cup ties and reload', () => {
    let state = career();
    let p = sign(state);
    p.age = 24;
    p.contract = 4;
    const id = p.id;
    while (!state.summary) {
      play(state, true);
      expect(p.starts).toBe(0);
    }
    expect(startNextSeason(state)).not.toBeNull();
    expect(state.club!.squad.some((q) => q.id === id)).toBe(true);
    expect(p.starts).toBe(0);
    expect(resaleCap(state, p)).toBe(75);
    expect(quickSaleValue(p)).toBe(75);

    // A match on the bench does not count toward the restriction.
    swapPlayers(state.club!, state.club!.squad.indexOf(p), state.club!.squad.length - 1);
    play(state);
    expect(p.starts).toBe(0);
    swapPlayers(state.club!, state.club!.squad.indexOf(p), 5);
    for (let n = 1; n <= RESALE_STARTS; n++) {
      if (cupDue(state) >= 0) {
        resolveCupTie(state, 0, 3, false);
        expect(p.starts).toBe(n - 1);
      }
      play(state);
      expect(p.starts).toBe(n);
      if (n === 3) {
        state = migrateCareer(JSON.parse(JSON.stringify(state)), state.seed);
        p = state.club!.squad.find((q) => q.id === id) as MetaPlayer;
      }
      expect(scoutResaleCap(p)).toBe(n < RESALE_STARTS ? 75 : null);
    }
    expect(resaleCap(state, p)).toBeNull();
    expect(quickSaleValue(p)).toBe(ordinaryValue(p));
    expect(quickSaleValue(p)).toBeGreaterThan(75);
  });

  it('caps generated AI offers and rechecks stored offers at both quote and acceptance', () => {
    let offered = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const state = career(seed);
      const p = sign(state);
      swapPlayers(state.club!, state.club!.squad.indexOf(p), state.club!.squad.length - 1);
      expect(listPlayer(state, p.id).ok).toBe(true);
      for (let md = 0; md < 2; md++) {
        play(state);
        for (const offer of saleFor(state, p.id)!.offers) {
          offered++;
          expect(offer.amount).toBeLessThanOrEqual(75);
        }
      }
    }
    expect(offered).toBeGreaterThan(0);
    const state = career();
    const p = sign(state);
    listPlayer(state, p.id);
    const buyer = state.season!.rivals[0];
    saleFor(state, p.id)!.offers.push({ id: 'stored-offer', club: buyer.id, clubName: buyer.name, amount: 5000, week: 0, expires: 2 });
    const reloaded = migrateCareer(JSON.parse(JSON.stringify(state)), state.seed);
    const q = reloaded.club!.squad.find((x) => x.id === p.id)!;
    const quote = resaleOfferAmount(reloaded, q, 5000);
    expect(quote).toBe(75);
    const wallet = { coins: 1000 };
    expect(acceptOffer(reloaded, wallet, p.id, 'stored-offer')).toMatchObject({ ok: true, delta: quote });
    expect(wallet.coins).toBe(1075);
  });

  it('treats a genuine paid market acquisition as a market signing, without resurrecting an old scout restriction', () => {
    const state = career();
    const listing = state.tm.listings.find((l) => !l.club)!;
    listing.player.scoutResale = 75;
    listing.player.starts = RESALE_STARTS;
    // Leave enough wage budget for this real purchase and preserve the legal minimum squad.
    state.club!.squad = state.club!.squad.slice(0, SQUAD_MIN);
    state.stadium = 5;
    const result = placeBid(state, { coins: 100_000 }, listing.id, listing.asking);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.player) throw new Error('Test market signing failed');
    expect(result.player.scoutResale).toBeUndefined();
    expect(scoutResaleCap(result.player)).toBeNull();
    expect(resaleCap(state, result.player)).toBe(Math.round(listing.asking * 1.1 / 10) * 10);
  });
});
