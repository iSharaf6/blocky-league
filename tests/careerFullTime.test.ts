import { describe, expect, it, vi } from 'vitest';
import type { AppContext, MatchRequest } from '../src/app';
import { defaultSave } from '../src/core/save';
import type { MatchResult } from '../src/game/matchSession';
import { BOTTOM_DIVISION, createClub, cupDue, matchCoins, migrateCareer, newSeason, resolveMatchday, userFixture, YOU } from '../src/meta/career';
import { CUP_AFTER, cupPrize, userTie } from '../src/meta/cup';
import { drawWorld } from '../src/meta/comps';
import { KIT_COLORS } from '../src/meta/data';
import type { Match } from '../src/sim/match';
import type { Kit } from '../src/sim/types';
import { playMatchday } from '../src/ui/career';
import { careerState } from '../src/ui/club';

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };

/** A save with a founded club in its first season, and an app that records the match it is asked to start. */
function rig() {
  const save = defaultSave();
  const st0 = migrateCareer(null, 7);
  st0.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, 7);
  newSeason(st0, BOTTOM_DIVISION, 1);
  save.career = st0;
  let req: MatchRequest | null = null;
  const app = {
    save,
    menus: null as unknown as AppContext['menus'],
    persist: vi.fn(),
    startMatch: (r: MatchRequest) => {
      req = r;
    },
    mainMenu: vi.fn(),
  } satisfies AppContext;
  const st = careerState(app);
  return { app, st, started: () => req };
}

describe('career match at full time', () => {
  it('moves the league on when the full-time screen comes up, not when CONTINUE is pressed', () => {
    const { app, st, started } = rig();
    const md = st.season!.matchday;
    playMatchday(app, st);
    const req = started();
    expect(req).not.toBeNull();
    const f = userFixture(st.season!, md)!;
    const userHome = f.home === YOU;
    expect(f.hg).toBeNull();
    // A 2-0 win for the player, whichever end he is at.
    const score: [number, number] = userHome ? [2, 0] : [0, 2];
    const r = { score, humanSide: userHome ? 0 : 1, match: {} as Match } as MatchResult;
    const reward = req!.reward(r);
    // (main.ts banks these coins and saves at this moment: the result has to be in the save with them.)
    expect(reward.coins).toBeGreaterThan(0);
    expect(st.season!.matchday).toBe(md + 1);
    expect([f.hg, f.ag]).toEqual(score);
  });

  it('a BLOCKY CUP tie is a knockout: settled at full time (penalties count), paid with its prize, and only once', () => {
    const { app, st, started } = rig();
    // Two league matchdays, then the quarter-final is up next.
    for (let i = 0; i < CUP_AFTER[0]; i++) {
      const f = userFixture(st.season!, st.season!.matchday)!;
      expect(resolveMatchday(st, app.save, st.season!.matchday, f.home === YOU ? 1 : 0, f.home === YOU ? 0 : 1)).toBe(true);
    }
    expect(cupDue(st)).toBe(0);
    playMatchday(app, st);
    const req = started()!;
    expect(req.knockout).toBe(true);
    expect(req.kind).toBe('career');
    const cup = st.season!.cup!;
    const ut = userTie(cup)!;
    const hs = req.humanSide;
    expect(hs).toBe(ut.userHome ? 0 : 1);
    // 1-1 after 90, the player's side wins the shootout.
    const r = { score: [1, 1], humanSide: hs, match: {} as Match, winner: hs } as MatchResult;
    const reward = req.reward(r);
    expect(cup.ties[ut.idx].winner).toBe(cup.user);
    expect(cup.round).toBe(1);
    expect(reward).toEqual({ coins: matchCoins(st.season!.division, st.stadium, 1, 1) + cupPrize(0, true, st.season!.division), fixedCoins: cupPrize(0, true, st.season!.division), label: 'QF WIN BONUS' });
    // The league did not move; a second full time for the same request changes nothing and pays nothing.
    expect(st.season!.matchday).toBe(CUP_AFTER[0]);
    const again = req.reward({ ...r, score: [0, 3], winner: hs === 0 ? 1 : 0 } as MatchResult);
    expect(again.label).toBe('CUP TIE');
    expect(again.coins).toBe(0);
    expect(cup.status).toBe('active');
    expect(cup.round).toBe(1);
    // Next up is the league again.
    expect(cupDue(st)).toBe(-1);
  });

  it('a stale request cannot play the same fixture twice', () => {
    const { app, st, started } = rig();
    const md = st.season!.matchday;
    playMatchday(app, st);
    const req = started()!;
    const f = userFixture(st.season!, md)!;
    const score: [number, number] = f.home === YOU ? [1, 0] : [0, 1];
    req.reward({ score, humanSide: 0, match: {} as Match } as MatchResult);
    expect(req.reward({ score: [0, 5], humanSide: 0, match: {} as Match } as MatchResult).coins).toBe(0);
    expect(st.season!.matchday).toBe(md + 1);
    expect([f.hg, f.ag]).toEqual(score);
  });

  it('a repeated World Cup semi-final result cannot settle the final due on the same matchday', () => {
    const { app, st, started } = rig();
    st.season!.world = drawWorld(st.season!.seed, st.club!);
    playMatchday(app, st);
    const req = started()!;
    const score: [number, number] = req.humanSide === 0 ? [2, 0] : [0, 2];
    const r = { score, humanSide: req.humanSide, winner: req.humanSide, match: {} as Match } as MatchResult;
    const first = req.reward(r);
    expect(first.fixedCoins).toBe(600);
    const final = st.season!.world.fixtures.find((f) => f.stage === 'final')!;
    expect(final.hg).toBeNull();
    expect(req.reward(r).coins).toBe(0);
    expect(final.hg).toBeNull();
    expect(st.season!.world.status).toBe('active');
  });
});
