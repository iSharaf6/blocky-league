import { describe, expect, it, vi } from 'vitest';
import type { AppContext, MatchRequest } from '../src/app';
import { defaultSave } from '../src/core/save';
import type { MatchResult } from '../src/game/matchSession';
import { BOTTOM_DIVISION, createClub, migrateCareer, newSeason, userFixture, YOU } from '../src/meta/career';
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

  it('a stale request cannot play the same fixture twice', () => {
    const { app, st, started } = rig();
    const md = st.season!.matchday;
    playMatchday(app, st);
    const req = started()!;
    const f = userFixture(st.season!, md)!;
    const score: [number, number] = f.home === YOU ? [1, 0] : [0, 1];
    req.reward({ score, humanSide: 0, match: {} as Match } as MatchResult);
    req.reward({ score: [0, 5], humanSide: 0, match: {} as Match } as MatchResult);
    expect(st.season!.matchday).toBe(md + 1);
    expect([f.hg, f.ag]).toEqual(score);
  });
});
