import { describe, expect, it } from 'vitest';
import { defaultSave, importSave } from '../src/core/save';
import { Rng } from '../src/core/rng';
import {
  BOTTOM_DIVISION, PRICE_KNEE, SQUAD_MIN, TRAIN_KNEE, TRAIN_ROOM, TRAIN_STEP, basePrice, clubRating, createClub, divisionLevel, divisionPar, migrateCareer,
  newSeason, playerPrice, pricePremium, ratingPrice, sessionCost, trainPlayer, trainingCost, tuneToOverall, type CareerState,
} from '../src/meta/career';
import { KIT_COLORS, makePlayer } from '../src/meta/data';
import {
  QUICK_SALE, RESALE_STARTS, WAGE_DIV, askingPrice, baseValue, canBid, clubWageBudget, marketValue, placeBid, playerValue, quickSaleValue, squadWages, wageOf,
  type MetaPlayer,
} from '../src/meta/market';
import {
  PACK_LIFT, PACK_OVR_CAP, PACK_OWN_CAP, PACK_TOKENS, RARITIES, RARITY_OVR, SCOUT_RESALE, cardWageRoom, earnTokens, openPack, packLevel, pendingCard, rollPack, sellCard,
  signCard, type PackCard, type Rarity,
} from '../src/meta/shop';
import { bestStat } from '../src/meta/squad';
import { overall, type Kit, type PlayerDef, type Role } from '../src/sim/types';
import { arbitrageTable, bottomTwoMarket, cardTable, curveTable, relegatedSales } from '../scripts/economy-model';

// Economy v8 (16 October 2026): players cost coins. Scout cards are drawn at the division's level, a card obeys the
// wage budget, the market's prices and a session's price climb above the level the bottom divisions reach, and what a
// club is PAID for a player it never bought does not follow them. docs/ECONOMY.md, scripts/economy-model.ts.
const KIT: Kit = { shirt: KIT_COLORS.red, shirt2: KIT_COLORS.white, pattern: 'hoops', shorts: KIT_COLORS.white, socks: KIT_COLORS.red, gk: 0 };
const DAY = '2026-10-16';
const round10 = (v: number) => Math.round(v / 10) * 10;

function career(seed = 7, division = BOTTOM_DIVISION): CareerState {
  const state = migrateCareer(null, seed);
  state.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
  newSeason(state, division, 1);
  return state;
}
/** A player of this rating, role, age and contract with nothing else on him (no fee, no resale credit). */
function player(ovr: number, role: Role = 'MF', age = 26, contract = 2): MetaPlayer {
  const p = makePlayer(new Rng(ovr * 31 + age), role, ovr, 8, `t${ovr}-${role}-${age}`) as MetaPlayer;
  tuneToOverall(p, ovr);
  return Object.assign(p, { age, contract, potential: 0 });
}
/** The whole squad retuned so the eleven is rated about `ovr`. */
function rated(state: CareerState, ovr: number): void {
  for (const p of state.club!.squad) tuneToOverall(p, ovr);
}
function draw(rarity: Rarity, level: number, role?: Role): PackCard {
  for (let seed = 0; seed < 4000; seed++) {
    const card = rollPack('scout', level, seed);
    if (card.rarity === rarity && (!role || card.player.role === role)) return card;
  }
  throw new Error(`no ${rarity} card`);
}

describe('scout cards are drawn at the division\'s level, not the club\'s own eleven', () => {
  it('the level is the division\'s; a new club\'s own eleven still counts in the first three divisions, up to 52', () => {
    for (let d = 8; d >= 1; d--) expect(packLevel(d), `division ${d}`).toBe(divisionLevel(d) + PACK_LIFT);
    // A superclub's cards are its league's, whatever its own rating: the ratchet (a starter lifting the next card) is gone.
    expect(packLevel(1, 97)).toBe(divisionLevel(1) + PACK_LIFT);
    expect(packLevel(3, 95)).toBe(divisionLevel(3) + PACK_LIFT);
    expect(packLevel(4, 80)).toBe(packLevel(4, 40));
    // The Park, District and Sunday Leagues: the club's own eleven, as before, and never past PACK_OWN_CAP.
    expect(packLevel(8, 41)).toBe(41);
    expect(packLevel(7, 50)).toBe(50);
    expect(packLevel(6, 63)).toBe(PACK_OWN_CAP);
    expect(packLevel(8, 99)).toBe(PACK_OWN_CAP);
    // A club under its league's level is helped up to it.
    expect(packLevel(4, 30)).toBe(divisionLevel(4) + PACK_LIFT);
    for (let d = 4; d >= 1; d--) expect(divisionLevel(d) + PACK_LIFT, `division ${d}`).toBeGreaterThan(PACK_OWN_CAP);
  });

  it('the rarity ranges are what they were, so a pack waiting in an older save draws the same card', () => {
    expect(RARITY_OVR).toEqual({ common: [-3, 1], rare: [2, 5], epic: [6, 10], legend: [11, 16] });
    const club = career().club!;
    const old = defaultSave();
    old.shop!.pending = { kind: 'elite', seed: 4321, base: 90, price: 1200 };
    const back = pendingCard(importSave(JSON.parse(JSON.stringify(old)))!, club)!;
    const was = rollPack('elite', 90, 4321, club.squad.map((p) => p.name));
    expect(back.card.ovr).toBe(was.ovr);
    expect(JSON.stringify(back.card.player.stats)).toBe(JSON.stringify(was.player.stats));
    expect(back.price).toBe(1200);
  });

  it('by rarity against the division\'s par: depth, a starter, a little over, a star one division up and never two', () => {
    for (const d of [4, 3, 2]) {
      const level = packLevel(d), par = divisionPar(d);
      const seen: Record<Rarity, number[]> = { common: [], rare: [], epic: [], legend: [] };
      for (let seed = 0; seed < 3000; seed++) {
        const c = rollPack('scout', level, seed);
        const [lo, hi] = RARITY_OVR[c.rarity];
        // (tuneToOverall lands within a point or two of its target.)
        expect(c.ovr).toBeGreaterThanOrEqual(level + lo - 2);
        expect(c.ovr).toBeLessThanOrEqual(Math.min(PACK_OVR_CAP, level + hi) + 2);
        seen[c.rarity].push(c.ovr);
      }
      const mean = (r: Rarity) => seen[r].reduce((a, b) => a + b, 0) / seen[r].length;
      for (const r of RARITIES) expect(seen[r].length, `${r} in division ${d}`).toBeGreaterThan(10);
      // A common is squad depth, a rare is about par, an epic a little over, a legend clearly over.
      expect(mean('common')).toBeLessThan(par - 3);
      expect(mean('rare')).toBeGreaterThan(par - 4);
      expect(mean('rare')).toBeLessThanOrEqual(par + 1);
      expect(mean('epic')).toBeGreaterThan(par);
      expect(mean('epic')).toBeLessThan(par + 6);
      expect(mean('legend')).toBeGreaterThan(par + 4);
      // Never a free pass two divisions up (the top of the game has no two divisions up: the cap holds there).
      const twoUp = d - 2 >= 1 ? divisionPar(d - 2) : PACK_OVR_CAP + 3;
      expect(Math.max(...seen.legend), `division ${d}`).toBeLessThan(twoUp);
      expect(Math.max(...RARITIES.flatMap((r) => seen[r]))).toBeLessThanOrEqual(PACK_OVR_CAP + 1);
    }
    // The table the docs print is the rule itself.
    for (const row of cardTable()) {
      expect(row.common.from).toBe(Math.min(PACK_OVR_CAP, row.level + RARITY_OVR.common[0]));
      expect(row.legend.to).toBe(Math.min(PACK_OVR_CAP, row.level + RARITY_OVR.legend[1]));
      expect(row.ownEleven).toBe(row.division >= 5);
    }
  });

  it('opening a pack: the division decides, the same save draws the same card, and a strong eleven no longer lifts it', () => {
    const state = career(11, 4);
    rated(state, 90);
    expect(clubRating(state.club!)).toBeGreaterThan(85);
    const a = defaultSave(), b = defaultSave();
    earnTokens(a, 30);
    earnTokens(b, 30);
    const level = packLevel(4, clubRating(state.club!));
    expect(level).toBe(divisionLevel(4) + PACK_LIFT);
    for (let n = 0; n < 12; n++) {
      const kind = n % 3 === 0 ? 'elite' : 'scout';
      const x = openPack(a, state.club, kind, DAY, false, 4), y = openPack(b, state.club, kind, DAY, false, 4);
      if (!x.ok || !y.ok) throw new Error('pack did not open');
      // Deterministic by the save's own pack count: no rerolling.
      expect(JSON.stringify(x.card)).toBe(JSON.stringify(y.card));
      expect(a.shop!.pending).toMatchObject({ kind, base: level });
      // Before, this 90 rated eleven drew 87 to 95. Now it draws its league's players: 57 to 76.
      expect(x.card.ovr).toBeLessThanOrEqual(level + RARITY_OVR.legend[1] + 2);
      expect(x.card.ovr).toBeLessThan(clubRating(state.club!));
      // It comes back as the same card after a reload.
      expect(pendingCard(importSave(JSON.parse(JSON.stringify(a)))!, state.club)!.card.ovr).toBe(x.card.ovr);
    }
    // The same save in another league draws at that league's level.
    const c = defaultSave();
    earnTokens(c, 3);
    const top = openPack(c, state.club, 'scout', DAY, false, 1);
    expect(top.ok && c.shop!.pending!.base).toBe(divisionLevel(1) + PACK_LIFT);
    // No division given (an old caller): the bottom division's, so never more than the club's own eleven up to 52.
    const d = defaultSave();
    const low = openPack(d, state.club, 'scout', DAY, true);
    expect(low.ok && d.shop!.pending!.base).toBe(PACK_OWN_CAP);
    expect(PACK_TOKENS).toEqual({ scout: 1, elite: 3 });
  });
});

describe('a card obeys the wage budget, like any signing', () => {
  it('over the budget he is refused and nothing changes; at the budget he signs', () => {
    const state = career(5, 4);
    const club = state.club!;
    const card = draw('epic', packLevel(4), 'FW');
    const wage = wageOf(card.player), wages = squadWages(club);
    expect(cardWageRoom(club, card, wages + wage - 1)).toEqual({ wage, spare: wage - 1, fits: false });
    const before = JSON.stringify(club.squad);
    expect(signCard(club, card, 0, 1, wages + wage - 1)).toEqual({ ok: false, reason: 'wages' });
    expect(JSON.stringify(club.squad)).toBe(before);
    expect(cardWageRoom(club, card, wages + wage)).toEqual({ wage, spare: wage, fits: true });
    const r = signCard(club, card, 0, 1, wages + wage);
    expect(r.ok).toBe(true);
    expect(squadWages(club)).toBe(wages + wage);
    // The squad limit still comes first, and a caller with no budget (a trial on a copy of the squad) is not refused.
    expect(signCard(career(6).club!, draw('common', 40)).ok).toBe(true);
  });

  it('it is the market\'s own budget, and the card waits until room is made or he is sold', () => {
    const state = career(9, 4);
    const club = state.club!;
    // A squad at its division's par, full of wages: one more par player does not fit.
    rated(state, divisionPar(4));
    const save = defaultSave();
    earnTokens(save, 9);
    const budget = clubWageBudget(state);
    while (squadWages(club) + 40 <= budget && club.squad.length < 22) signCard(club, draw('rare', packLevel(4)), 0, 1);
    for (const p of club.squad) tuneToOverall(p, divisionPar(4) + 6);
    expect(squadWages(club)).toBeGreaterThan(budget - 160);
    const opened = openPack(save, club, 'elite', DAY, false, 4);
    if (!opened.ok) throw new Error('pack did not open');
    const room = cardWageRoom(club, opened.card, budget);
    expect(room.fits).toBe(false);
    expect(signCard(club, opened.card, 0, 1, budget)).toEqual({ ok: false, reason: 'wages' });
    // The market refuses a signing of the same wage for the same reason.
    const listing = state.tm.listings.find((l) => !l.club && !l.youth)!;
    listing.wage = room.wage;
    expect(canBid(state, 1e9, listing.id, listing.asking)).toEqual({ ok: false, reason: 'wages' });
    // He is still there (shop.pending), and sells for his resale credit if the manager prefers.
    const waiting = pendingCard(save, club)!;
    expect(waiting.card.ovr).toBe(opened.card.ovr);
    const coins = save.coins;
    expect(sellCard(save, waiting.card)).toBe(quickSaleValue(waiting.card.player));
    expect(save.coins).toBeGreaterThan(coins);
  });

  it('a relegated club can always sell its way back under the budget, and every sale pays', () => {
    for (let d = 2; d <= 8; d++) for (const stadium of [0, 5]) {
      const n = relegatedSales(d, stadium);
      expect(n, `division ${d}, ground ${stadium}`).toBeLessThanOrEqual(23 - SQUAD_MIN);
    }
    // A player of the division above always has a quick sale worth something.
    for (let d = 1; d <= 7; d++) expect(quickSaleValue(player(divisionPar(d)))).toBeGreaterThan(0);
  });
});

describe('the curves: flat where a new club lives, steep where the coins pile up', () => {
  it('the transfer price is OVR² x 0.25 up to 60, and climbs with the cube of the distance above it', () => {
    for (let o = 20; o <= PRICE_KNEE; o++) {
      expect(ratingPrice(o), `OVR ${o}`).toBe(round10(o ** 2 * 0.25));
      expect(pricePremium(o)).toBe(1);
    }
    expect(PRICE_KNEE).toBe(60);
    for (let o = PRICE_KNEE; o < 99; o++) expect(ratingPrice(o + 1), `OVR ${o + 1}`).toBeGreaterThan(ratingPrice(o));
    // Hardly anything through the County and National Leagues, a real price in the Championship, a season's work at the top.
    expect(pricePremium(65)).toBeLessThan(1.05);
    expect(pricePremium(70)).toBeLessThan(1.15);
    expect(pricePremium(75)).toBeGreaterThan(1.2);
    expect(pricePremium(85)).toBeGreaterThan(2.5);
    expect(pricePremium(95)).toBeGreaterThan(5);
    expect([65, 75, 85, 93, 95, 99].map(ratingPrice)).toEqual([1070, 1920, 4850, 10550, 12700, 18140]);
    expect([65, 75, 85, 93, 95, 99].map(basePrice)).toEqual([1060, 1410, 1810, 2160, 2260, 2450]);
    // Each step up costs more than the one before it, all the way.
    for (let o = PRICE_KNEE + 1; o < 98; o++) expect(ratingPrice(o + 2) - ratingPrice(o + 1), `OVR ${o}`).toBeGreaterThanOrEqual(ratingPrice(o + 1) - ratingPrice(o) - 10);
    // A free agent asks his rating's price; a club asks it by age, contract, form and need.
    const star = player(95);
    expect(playerPrice(star)).toBe(12700);
    expect(askingPrice(star, null, false, 0, false)).toBe(12700);
    expect(marketValue(star)).toBe(round10(12700 * 1.1 * 1.08));
  });

  it('a session is 40 + 3 x OVR up to 70, and from there costs more the closer he is to 100', () => {
    for (let o = 20; o <= TRAIN_KNEE; o++) expect(sessionCost(o), `OVR ${o}`).toBe(40 + 3 * o);
    expect(TRAIN_KNEE).toBe(100 - TRAIN_ROOM);
    for (let o = TRAIN_KNEE; o < 99; o++) expect(sessionCost(o + 1), `OVR ${o + 1}`).toBeGreaterThan(sessionCost(o));
    expect([71, 75, 85, 90, 93, 95, 97, 98, 99].map(sessionCost)).toEqual([260, 320, 590, 930, 1370, 1950, 3310, 5010, 10110]);
    // Gentle through the League One and the Championship, steep in the last five points.
    expect(sessionCost(80) / (40 + 3 * 80)).toBeLessThanOrEqual(1.5);
    expect(sessionCost(99) / sessionCost(95)).toBeGreaterThan(5);
    // The discounts apply as they did (the training ground, the coach perk), and the wallet pays exactly the price.
    const p = player(93, 'FW');
    expect(trainingCost(p)).toBe(1370);
    expect(trainingCost(p, 0.25)).toBe(round10(1370 * 0.75));
    expect(trainingCost(p, 0.9)).toBe(round10(1370 * 0.5));
    const state = career(3);
    state.club!.squad[9] = Object.assign(p, { id: state.club!.squad[9].id });
    const wallet = { coins: 2000 };
    expect(trainPlayer(state.club!, wallet, p.id, 'shooting')).toEqual({ ok: true, delta: -1370 });
    expect(wallet.coins).toBe(630);
  });

  it('wages are what they were at every rating: no squad anyone owns pays a coin more', () => {
    // (A stand-in lands within a point of the rating asked for: his own overall is what the rule reads.)
    for (let o = 30; o <= 99; o++) {
      const p = player(o);
      expect(wageOf(p), `OVR ${o}`).toBe(Math.round(overall(p) ** 2 / WAGE_DIV));
    }
    expect(wageOf(player(95))).toBe(226);
    expect(Math.round(99 ** 2 / WAGE_DIV)).toBe(245);
  });

  it('nothing the Park and District Leagues list or scout is over the knee, so nothing there costs more', () => {
    const m = bottomTwoMarket(12);
    expect(m.listed).toBeLessThanOrEqual(PRICE_KNEE);
    expect(m.found).toBeLessThanOrEqual(PRICE_KNEE);
    // What a new club is shown in its first season is priced as it always was.
    const state = career(21);
    for (const l of state.tm.listings.filter((x) => !x.club)) {
      const base = round10(overall(l.player) ** 2 * 0.25);
      expect(l.asking).toBe(l.youth ? round10(base * 0.5) : base);
    }
    for (const l of state.tm.listings) expect(marketValue(l.player)).toBe(baseValue(l.player));
    for (const p of state.club!.squad) expect(trainingCost(p)).toBe(40 + 3 * overall(p));
  });
});

describe('arbitrage stays closed: a free player never sells at the market\'s price', () => {
  it('a pack card, an academy player, the squad a club starts with: worth the base value at every rating', () => {
    for (let o = 30; o <= 99; o++) {
      const p = player(o);
      expect(playerValue(p), `OVR ${o}`).toBe(round10(basePrice(overall(p)) * 1.1 * 1.08));
      expect(playerValue(p)).toBe(baseValue(p));
      expect(quickSaleValue(p)).toBe(round10(baseValue(p) * QUICK_SALE));
    }
    // A 95 the market asks 12,700 for sells, as a free card, for what he did: 1,210 at once (26, two years), not 6,790.
    const card = Object.assign(player(95), { scoutResale: SCOUT_RESALE.legend, starts: RESALE_STARTS });
    expect(quickSaleValue(card)).toBe(1210);
    expect(round10(marketValue(card) * QUICK_SALE)).toBe(6790);
    // Until six league starts it is his resale credit, 75 to 250, as before.
    expect(Object.values(SCOUT_RESALE)).toEqual([75, 100, 150, 250]);
    for (const rarity of RARITIES) {
      const c = draw(rarity, packLevel(1));
      expect(c.player.fee).toBeUndefined();
      expect(quickSaleValue(c.player)).toBe(SCOUT_RESALE[rarity]);
    }
    // (Ten coins of slack: the value is rounded to ten before the quick sale's 45% is.)
    for (const t of curveTable(Array.from({ length: 50 }, (_, i) => 50 + i))) {
      expect(t.freeCardSale, `OVR ${t.ovr}`).toBeLessThanOrEqual(round10(basePrice(t.ovr) * 1.1 * QUICK_SALE) + 10);
      if (t.ovr >= 70) expect(t.freeCardSale).toBeLessThan(t.marketWouldPay);
    }
  });

  it('a signing holds his fee: he is worth what was paid at the most, so buying and selling never makes a coin above the knee', () => {
    for (let o = PRICE_KNEE + 1; o <= 99; o++) {
      for (const [age, contract] of [[26, 2], [24, 4], [31, 1], [19, 3]] as const) {
        const p = player(o, 'MF', age, contract);
        const fee = playerPrice(p);
        p.fee = fee;
        const value = playerValue(p);
        expect(value, `OVR ${o}, ${age}`).toBeLessThanOrEqual(Math.max(fee, baseValue(p)));
        expect(value).toBeGreaterThanOrEqual(baseValue(p));
        // The best offer a club makes is 95% of his value: under the fee wherever the fee is over his base value.
        if (fee > baseValue(p)) expect(round10(value * 0.95)).toBeLessThan(fee);
        expect(quickSaleValue(p)).toBeLessThan(fee);
      }
    }
    // Up to the knee nothing changed: a bargain is still a bargain (a youth find is worth more than his fee).
    for (let o = 30; o <= PRICE_KNEE; o++) {
      const kid = player(o, 'FW', 17, 3);
      kid.fee = round10(playerPrice(kid) * 0.48);
      expect(playerValue(kid)).toBe(baseValue(kid));
    }
    // A fee under his base value is no cap at all, and an old signing (paid, no fee) is valued as he was.
    const old = Object.assign(player(90), { paid: 2030, boughtSeason: 3, starts: 9 });
    expect(playerValue(old)).toBe(baseValue(old));
    const cheap = Object.assign(player(90), { fee: 500 });
    expect(playerValue(cheap)).toBe(baseValue(cheap));
  });

  it('training never makes a coin: a session costs more than the value it adds, at every rating and for every role', () => {
    for (const role of ['GK', 'DF', 'MF', 'FW'] as const) for (let o = 40; o <= 97; o++) {
      const p = player(o, role, 26, 4);
      const stat = bestStat(p)!;
      const trained: PlayerDef = { ...p, stats: { ...p.stats, [stat]: Math.min(99, p.stats[stat] + TRAIN_STEP) } };
      // A player with no fee: his base value moves by a fraction of the session, discounted or not.
      expect(playerValue(trained) - playerValue(p), `${role} ${o}`).toBeLessThan(trainingCost(p, 0.35));
      // A signing at the market's price, where that is over his base value, is already worth his fee: a session adds
      // nothing to what he sells for. (Where the base value is the higher of the two, the line above is the rule.)
      const bought = { ...p, fee: playerPrice(p) } as MetaPlayer;
      const boughtTrained = { ...trained, fee: bought.fee } as MetaPlayer;
      if (bought.fee! >= baseValue(trained)) expect(playerValue(boughtTrained) - playerValue(bought), `${role} ${o} bought`).toBeLessThanOrEqual(0);
      else expect(playerValue(boughtTrained) - playerValue(bought)).toBeLessThan(trainingCost(p, 0.35));
    }
  });

  it('the market signs him with his fee on record, and it survives a reload with the wallet and the old squad untouched', () => {
    const state = career(31, 1);
    const club = state.club!;
    // A squad from an older save: rated 90, bought before the fee existed.
    for (const p of club.squad) Object.assign(tuneToOverall(p, 90) ?? p, { paid: 2030, boughtSeason: 1, starts: 12 });
    const before = club.squad.map((p) => ({ id: p.id, value: playerValue(p), sale: quickSaleValue(p), wage: wageOf(p), ovr: overall(p) }));
    for (const b of before) expect(b.value).toBe(baseValue(club.squad.find((p) => p.id === b.id)!));
    club.squad = club.squad.slice(0, SQUAD_MIN);
    state.stadium = 5;
    const listing = state.tm.listings.filter((l) => !l.club && !l.youth).sort((a, b) => overall(b.player) - overall(a.player))[0];
    expect(overall(listing.player)).toBeGreaterThan(PRICE_KNEE + 20);
    expect(listing.asking).toBe(playerPrice(listing.player));
    expect(listing.asking).toBeGreaterThan(basePrice(overall(listing.player)) * 3);
    const wallet = { coins: 100_000 };
    const r = placeBid(state, wallet, listing.id, listing.asking);
    if (!r.ok || !r.player) throw new Error('signing failed');
    expect(r.player.fee).toBe(listing.asking);
    expect(wallet.coins).toBe(100_000 - listing.asking);
    expect(playerValue(r.player)).toBe(listing.asking);
    expect(quickSaleValue(r.player)).toBe(round10(listing.asking * QUICK_SALE));
    // Reload: the fee is there, every older player is worth, sells for and earns exactly what he did.
    const save = defaultSave();
    save.career = state;
    save.coins = 54321;
    const loaded = importSave(JSON.parse(JSON.stringify(save)))!;
    const back = migrateCareer(loaded.career, state.seed);
    expect(loaded.coins).toBe(54321);
    expect((back.club!.squad.find((p) => p.id === r.player!.id) as MetaPlayer).fee).toBe(listing.asking);
    for (const p of back.club!.squad) {
      const was = before.find((b) => b.id === p.id);
      if (!was) continue;
      expect((p as MetaPlayer).fee).toBeUndefined();
      expect(overall(p)).toBe(was.ovr);
      expect(playerValue(p)).toBe(was.value);
      expect(quickSaleValue(p)).toBe(was.sale);
      expect(wageOf(p)).toBe(was.wage);
    }
  });

  it('no trade in the model\'s table makes a coin at once, and a free card is worth its base value in every division', () => {
    const table = arbitrageTable();
    for (const t of table.filter((x) => x.instant)) expect(t.profit, `${t.trade}, division ${t.division}`).toBeLessThanOrEqual(0);
    for (const t of table.filter((x) => !x.instant && x.cost > 0)) expect(t.wins, `${t.trade}, division ${t.division}`).toBeLessThanOrEqual(2);
    // Buying at the top and selling after six starts loses money now (it broke even before): the fee is the ceiling.
    const top = table.filter((x) => x.division === 1);
    expect(top.find((x) => /after 6 league starts \(expected offer\)/.test(x.trade) && /Free agent/.test(x.trade))!.profit).toBeLessThan(0);
    const card = top.find((x) => /free pack card/i.test(x.trade))!;
    expect(card.back).toBeLessThan(1500);
    expect(card.cost).toBe(0);
  });
});
