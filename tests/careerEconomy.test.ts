import { describe, expect, it } from 'vitest';
import {
  BOTTOM_DIVISION, SQUAD_MIN, YOU, compTieReward, createClub, cupDue, groundBonus, leagueTable, matchCoins, migrateCareer,
  newSeason, resolveCompTie, resolveCupTie, resolveMatchday, startNextSeason, userFixture,
} from '../src/meta/career';
import { payBoard } from '../src/meta/board';
import { drawWorld } from '../src/meta/comps';
import { CUP_AFTER } from '../src/meta/cup';
import { KIT_COLORS } from '../src/meta/data';
import { pendingEvent, resolveEvent, type EventCard } from '../src/meta/events';
import type { GrowPlayer } from '../src/meta/growth';
import { legacyNeed } from '../src/meta/legacy';
import { matchCoinPayout } from '../src/meta/matchEconomy';
import { resaleCap } from '../src/meta/market';
import { commercialIncome, hireStaff, payStaff, sponsorMult, staffWages } from '../src/meta/staff';
import { openAll, simBlock, simMatch } from '../src/meta/week';
import type { Kit } from '../src/sim/types';

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };

function career(seed = 7) {
  const state = migrateCareer(null, seed);
  state.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
  newSeason(state, BOTTOM_DIVISION, 1);
  return state;
}

describe('career forfeits', () => {
  it('advances consequences without sponsor income, commercial sales, training, starts, scouting or participation unlocks', () => {
    let st = career();
    for (let seed = 1; userFixture(st.season!, 0)!.home !== YOU; seed++) st = career(seed);
    const club = st.club!;
    for (const p of club.squad as GrowPlayer[]) {
      p.age = 18;
      p.ceil = 90;
      p.xp = 0;
      p.boughtSeason = 1;
      p.paid = 100;
      p.starts = 0;
    }
    const injured = club.squad[15] as GrowPlayer;
    injured.inj = 2;
    const beforeStats = club.squad.map((p) => ({ ...p.stats }));
    st.staff.hired = {
      commercial: { level: 1, name: 'Commercial' },
      scout1: { level: 1, name: 'Scout', region: 'home', brief: 'youth' },
    };
    st.staff.due.scout1 = 1;
    st.ground.building = { id: 'main', level: 1, left: 1 };
    st.events.sponsor = { name: 'Test Sponsor', pay: 'match', amount: 100, left: 14, paid: 0 };
    st.events.queue = [];
    const wallet = { coins: 4000 };
    const wages = staffWages(st);
    // A walk-off must be a defeat even if a stale caller still holds the pre-quit winning score.
    expect(resolveMatchday(st, wallet, 0, 2, 0, true)).toBe(true);
    expect(leagueTable(st).find((r) => r.id === YOU)).toMatchObject({ W: 0, L: 1, GA: 3, GF: 0 });
    expect(wallet.coins).toBe(4000 - wages);
    expect(st.events.sponsor).toMatchObject({ left: 13, paid: 0 });
    expect(st.events.clock).toBe(1);
    expect(st.events.played).toBe(0);
    expect(st.events.open).toEqual([]);
    expect(st.events.queue.some((c) => c.kind === 'sponsor' || c.kind === 'training')).toBe(false);
    expect(st.staff.due.scout1).toBe(1);
    expect(st.staff.reports).toEqual([]);
    expect(club.squad.map((p) => p.stats)).toEqual(beforeStats);
    expect(club.squad.every((p) => (p as GrowPlayer).xp === 0 && (p as GrowPlayer).starts === 0)).toBe(true);
    expect(injured.inj).toBe(1);
    expect(st.ground.built.main).toBe(1);
    expect(st.season!.matchday).toBe(1);
  });

  it('still rewards a completed loss with sponsor income and training', () => {
    const st = career();
    const p = st.club!.squad[0] as GrowPlayer;
    p.age = 18;
    p.ceil = 90;
    p.xp = 0;
    st.events.sponsor = { name: 'Test Sponsor', pay: 'match', amount: 100, left: 14, paid: 0 };
    const wallet = { coins: 0 };
    const home = userFixture(st.season!, 0)!.home === YOU;
    expect(resolveMatchday(st, wallet, 0, home ? 0 : 3, home ? 3 : 0)).toBe(true);
    expect(wallet.coins).toBe(100);
    expect(p.xp).toBeGreaterThan(0);
    expect(st.events.played).toBe(1);
  });

  it('does not count cup or world cup walk-offs as played matches', () => {
    const st = career();
    const wallet = { coins: 0 };
    while (st.season!.matchday < CUP_AFTER[0]) {
      const md = st.season!.matchday;
      expect(resolveMatchday(st, wallet, md, 0, 0)).toBe(true);
    }
    expect(cupDue(st)).toBe(0);
    const played = st.events.played;
    expect(resolveCupTie(st, 5, 0, true, null, true)).toMatchObject({ won: false, coins: 0 });
    expect(st.events.played).toBe(played);

    const world = career();
    world.season!.world = drawWorld(world.season!.seed, world.club!);
    expect(resolveCompTie(world, 5, 0, true, null, true)).toMatchObject({ won: false, coins: 0 });
    expect(world.events.played).toBe(0);
  });

  it('cannot farm academy intakes or spare keepers by forfeiting whole seasons', () => {
    const st = career();
    // A playable minimum squad with one keeper: rollover must not mint a second keeper to sell each year.
    st.club!.squad = st.club!.squad.slice(0, SQUAD_MIN);
    const wallet = { coins: 0 };
    for (let year = 0; year < 3; year++) {
      while (!st.summary) {
        if (cupDue(st) >= 0) resolveCupTie(st, 0, 3, false, null, true);
        else resolveMatchday(st, wallet, st.season!.matchday, 0, 3, true);
      }
      expect(st.summary.prize).toBe(0);
      expect(payBoard(st, wallet)).toBe(0);
      expect(wallet.coins).toBe(0);
      expect(startNextSeason(st)).not.toBeNull();
      expect(st.academy.prospects).toHaveLength(0);
      expect(st.club!.squad).toHaveLength(SQUAD_MIN);
      expect(st.club!.squad.filter((p) => p.role === 'GK')).toHaveLength(1);
    }
    expect(st.events.played).toBe(0);
  });

  it('keeps the normal intake after one completed loss or intentional manager simulation', () => {
    for (const simulate of [false, true]) {
      const st = career();
      const wallet = { coins: 1000 };
      let completed = false;
      if (simulate) openAll(st);
      while (!st.summary) {
        if (cupDue(st) >= 0) resolveCupTie(st, 0, 3, false, null, true);
        else if (!completed && (!simulate || !simBlock(st))) {
          if (simulate) expect(simMatch(st, wallet)).not.toBeNull();
          else {
            const md = st.season!.matchday;
            const home = userFixture(st.season!, md)!.home === YOU;
            expect(resolveMatchday(st, wallet, md, home ? 0 : 3, home ? 3 : 0)).toBe(true);
          }
          completed = true;
        } else resolveMatchday(st, wallet, st.season!.matchday, 0, 3, true);
      }
      expect(completed).toBe(true);
      startNextSeason(st);
      expect(st.academy.prospects.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('career match income', () => {
  it('rewards the first three goals, keeping a runaway score from printing coins', () => {
    for (const division of [8, 4, 1]) for (const stadium of [0, 3, 5]) {
      expect(matchCoins(division, stadium, 10, 0)).toBe(matchCoins(division, stadium, 3, 0));
      expect(matchCoins(division, stadium, 3, 0)).toBeGreaterThan(matchCoins(division, stadium, 2, 0));
    }
  });

  it('preserves a world final prize and home shop income at face value through every multiplier and rewarded double', () => {
    const st = career();
    st.ground.built = { screen: 1, store: 1 };
    st.legacy.points = legacyNeed(3);
    const reward = groundBonus(st, compTieReward(1, 5, 2, 1, { kind: 'world', stage: 'final', won: true, trophy: true, coins: 4200 }), true, 1);
    expect(reward.fixedCoins).toBe(4360);
    expect(reward.coins - reward.fixedCoins!).toBe(Math.round(matchCoins(1, 5, 2, 1) * 1.1));
    const paid = matchCoinPayout(reward, { streak: 10, atmosphere: 12, gradeBonus: 0.1, doubler: true });
    expect(paid.fixedCoins).toBe(4360);
    expect(paid.coins).toBe(paid.matchCoins + 4360);
    expect(paid.adBonus).toBe(paid.matchCoins);
    expect(paid.coins + paid.adBonus).toBe(2 * paid.matchCoins + 4360);
  });

  it('never generates club sales from an already settled zero reward', () => {
    const st = career();
    st.ground.built = { screen: 1, store: 1 };
    expect(groundBonus(st, compTieReward(1, 5, 2, 1, null), true, 1)).toEqual({ coins: 0, label: 'CUP FIXTURE' });
  });
});

describe('narrative transfer bids', () => {
  it('revalidates an old saved bid against the same resale limit as a market offer', () => {
    const st = career();
    const p = st.club!.squad[12] as GrowPlayer;
    p.paid = 100;
    p.boughtSeason = st.season!.number;
    p.starts = 0;
    const card: EventCard = {
      id: 'e1', kind: 'bid', season: 1, md: 0, title: 'A BID FOR YOUR STAR', text: 'Old offer of 1000 coins', icon: 'swap', who: [p.id],
      choices: [
        { label: 'SELL FOR 1,000', hint: 'HE LEAVES NOW', say: 'Sold for 1000', tone: 'info', fx: [{ t: 'sell', who: p.id, coins: 1000, to: 'Other Town' }] },
        { label: 'KEEP', hint: 'HE STAYS', say: 'He stays', tone: 'info', fx: [] },
      ],
    };
    st.events.queue = [card];
    const cap = resaleCap(st, p)!;
    expect(pendingEvent(st)!.choices[0].label).toBe(`SELL FOR ${cap}`);
    const wallet = { coins: 0 };
    expect(resolveEvent(st, wallet, card.id, 0).ok).toBe(true);
    expect(wallet.coins).toBe(cap);
    expect(st.club!.squad.some((q) => q.id === p.id)).toBe(false);
    expect(resolveEvent(st, wallet, card.id, 0).ok).toBe(false);
    expect(wallet.coins).toBe(cap);
  });
});

describe('commercial manager investment', () => {
  it('every upgrade improves net home/away income even without a sponsor', () => {
    const st = career();
    openAll(st);
    st.ground.built = { screen: 1, store: 1 };
    const wallet = { coins: 10_000 };
    let previousNet = 0;
    for (const [index, fee] of [400, 1000, 2000].entries()) {
      const before = wallet.coins;
      expect(hireStaff(st, wallet, 'commercial')).toMatchObject({ ok: true, cost: fee, level: index + 1 });
      expect(wallet.coins).toBe(before - fee);
      // One home match followed by one away match: actual wages leave the wallet both times.
      const opening = wallet.coins;
      expect(payStaff(st, wallet)).toBeGreaterThan(0);
      wallet.coins += commercialIncome(st);
      expect(payStaff(st, wallet)).toBeGreaterThan(0);
      const netPerMatch = (wallet.coins - opening) / 2;
      expect(netPerMatch).toBe([10, 21, 45][index]);
      if (index) expect(netPerMatch - previousNet).toBeGreaterThan(10);
      previousNet = netPerMatch;
      expect(sponsorMult(st)).toBe([1.25, 1.5, 1.75][index]);
    }
  });

  it('an existing commercial manager costs the revised wage and earns nothing while unpaid', () => {
    const st = career();
    st.staff.hired.commercial = { level: 3, name: 'Existing Manager' };
    const wallet = { coins: 39 };
    expect(payStaff(st, wallet)).toBe(0);
    expect(wallet.coins).toBe(39);
    expect(commercialIncome(st)).toBe(0);
    expect(sponsorMult(st)).toBe(1);
    wallet.coins++;
    expect(payStaff(st, wallet)).toBe(40);
    expect(wallet.coins).toBe(0);
    expect(commercialIncome(st)).toBe(170);
    expect(sponsorMult(st)).toBe(1.75);
  });
});
