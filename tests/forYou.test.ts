import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BOTTOM_DIVISION, SQUAD_MAX, createClub, migrateCareer, newSeason, tuneToOverall, type CareerState } from '../src/meta/career';
import { KIT_COLORS, makePlayer } from '../src/meta/data';
import { canAfford, forYouSort, positionGaps, replacedStarter, transferBudget, upgradeOf, type TransferBudget } from '../src/meta/forYou';
import { wageBudget, type Listing } from '../src/meta/market';
import { overall, type Kit, type Role } from '../src/sim/types';

const KIT: Kit = { shirt: KIT_COLORS.red, shirt2: KIT_COLORS.white, pattern: 'hoops', shorts: KIT_COLORS.white, socks: KIT_COLORS.red, gk: 0 };
const RICH: TransferBudget = { coins: 1e6, wageRoom: 1e6, squadRoom: true };

/** A 4-4-2 club whose whole XI is rated 50, except `weak` (squad index) at `weakOvr`. */
function career(weak = -1, weakOvr = 40): CareerState {
  const st = migrateCareer(null, 11);
  st.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, 11);
  newSeason(st, BOTTOM_DIVISION, 1);
  st.club.squad.forEach((p, i) => tuneToOverall(p, i < 11 ? 50 : 35));
  if (weak >= 0) tuneToOverall(st.club.squad[weak], weakOvr);
  return st;
}

let n = 0;
function listing(role: Role, ovr: number, asking = 500, wage = 10): Listing {
  const p = makePlayer(new Rng(++n), role, 50, 99, `t${n}`);
  tuneToOverall(p, ovr);
  return {
    id: `l${n}`, player: p, club: null, clubName: 'Free Agent', asking, wage, age: 24, contract: 2, form: 0,
    hot: false, youth: false, scouted: false, potential: 0, arrived: 0, leaves: 9,
  };
}

describe('the starter a signing would replace', () => {
  it('is the weakest XI player in his position, by formation slot', () => {
    const st = career(3, 42); // 4-4-2: slots 1..4 are the back four
    const club = st.club!;
    expect(club.squad[3].role).toBe('DF');
    expect(replacedStarter(club, 'DF')).toBe(club.squad[3]);
    const up = upgradeOf(club, listing('DF', 47).player);
    expect(up.starter).toBe(club.squad[3]);
    expect(up.gain).toBe(47 - overall(club.squad[3]));
    // Bench players never count as starters.
    expect(club.squad.slice(11).includes(replacedStarter(club, 'FW')!)).toBe(false);
  });

  it('the weakest position has the biggest gap below the XI average', () => {
    const gaps = positionGaps(career(9, 30).club!); // a forward at 30
    expect(gaps.FW).toBeGreaterThan(gaps.DF);
    expect(gaps.FW).toBeGreaterThan(gaps.MF);
    expect(gaps.GK).toBe(0);
  });
});

describe('FOR YOU', () => {
  it('puts an affordable upgrade before a bigger one you cannot pay for', () => {
    const club = career().club!;
    const big = listing('FW', 70, 5000);
    const fit = listing('FW', 55, 400);
    const order = forYouSort([big, fit], club, { coins: 1000, wageRoom: 1e6, squadRoom: true });
    expect(order.map((l) => l.id)).toEqual([fit.id, big.id]);
  });

  it('ranks real upgrades by OVR gained, then the cheaper of equals', () => {
    const club = career().club!;
    const small = listing('MF', 52, 300);
    const large = listing('MF', 58, 900);
    const sameCheap = listing('DF', 58, 600);
    const worse = listing('GK', 48, 100);
    const order = forYouSort([worse, small, large, sameCheap], club, RICH).map((l) => l.id);
    expect(order).toEqual([sameCheap.id, large.id, small.id, worse.id]);
  });

  it('a close call goes to the weakest position', () => {
    const club = career(1, 38).club!; // one centre back at 38: the XI averages under 50
    const df = listing('DF', 46); // +8 over the 38
    const fw = listing('FW', 59); // +9 over a 50
    expect(upgradeOf(club, fw.player).gain).toBeGreaterThan(upgradeOf(club, df.player).gain);
    expect(forYouSort([fw, df], club, RICH)[0].id).toBe(df.id);
  });

  it('counts wages and squad room, not just coins', () => {
    const l = listing('FW', 60, 100, 300);
    expect(canAfford(l, { coins: 1000, wageRoom: 299, squadRoom: true })).toBe(false);
    expect(canAfford(l, { coins: 1000, wageRoom: 300, squadRoom: true })).toBe(true);
    expect(canAfford(l, { coins: 1000, wageRoom: 300, squadRoom: false })).toBe(false);
  });

  it('reads the budget off the career: coins, wage room under the budget, squad places', () => {
    const st = career();
    const b = transferBudget(st, 750);
    expect(b.coins).toBe(750);
    expect(b.squadRoom).toBe(st.club!.squad.length < SQUAD_MAX);
    expect(b.wageRoom).toBeLessThan(wageBudget(BOTTOM_DIVISION, st.stadium));
    expect(transferBudget(st, -5).coins).toBe(0);
  });

  it('keeps every listing and is stable for the same input', () => {
    const club = career().club!;
    const list = [listing('GK', 50), listing('DF', 51), listing('MF', 49), listing('FW', 60, 50000)];
    const a = forYouSort(list, club, RICH);
    expect(a).toHaveLength(list.length);
    expect(new Set(a)).toEqual(new Set(list));
    expect(forYouSort([...list].reverse(), club, RICH).map((l) => l.id)).toEqual(a.map((l) => l.id));
  });
});
