import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { PRESENTATION } from '../src/game/matchSession';
import { pickReceiver } from '../src/sim/actions';
import { DT, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { playtestSeries } from './playtest';

/**
 * 2026-10-04, the owner after playing on his iPhone: "boring, slow, and hard to control players too", "feels sloggy".
 * What the playtest harness (tests/playtest.ts: the casual phone bot with AUTO SPRINT over whole 2-minute-half matches)
 * found and what was fixed is pinned here: the man he is given on defence, where his pass goes, and the dead time.
 */

function scenario(seed: number): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.drainEvents();
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
  return m;
}

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

function giveBall(m: Match, p: Player): void {
  const b = m.ball;
  b.reset(p.footX(), p.footZ());
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  if (p.side === 0) m.active = p.idx;
  m.updateBallPath();
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

describe('control: the man he is given and where his pass goes', () => {
  it('the pass goes to the man the stick points at, not an open one far off it', () => {
    // Over whole matches a pass with the stick within 10 degrees of the man meant went elsewhere 36% of the time, mostly
    // to a man 45 to 80 degrees off the stick and less far forward (a defender 2 m from the target made him "risky").
    for (let seed = 1; seed <= 4; seed++) {
      const m = scenario(seed);
      const ad = m.attackDir(0);
      const c = m.players[6];
      place(c, 0, 0);
      c.facing = ad > 0 ? 0 : Math.PI;
      giveBall(m, c);
      const fwd = m.players[9];
      place(fwd, ad * 20, 1);
      // A defender alongside him, not in the lane.
      place(m.players[15], ad * 20.5, 3.2);
      // An open man 70 degrees off the stick, 9 m away.
      const side = m.players[7];
      place(side, Math.cos(1.22) * 9 * ad, Math.sin(1.22) * 9);
      expect(pickReceiver(m, c, ad, 0.05, 'pass')).toBe(fwd.idx);
      // A man truly cut off (a defender in the lane and one on his back) still gives way to an open one near the stick.
      place(m.players[14], ad * 10, 0.6);
      place(m.players[15], ad * 21, 1.3);
      const near = m.players[10];
      place(near, Math.cos(0.5) * 16 * ad, Math.sin(0.5) * 16);
      expect(pickReceiver(m, c, ad, 0.05, 'pass')).toBe(near.idx);
    }
  });

  it('auto switch: a chaser the stick steers after their carrier hands over to the team-mate far better placed', () => {
    // The stick-steering guard used to hold on to a chaser 2 to 4 s behind a team-mate the carrier ran at (a quarter
    // of his defending was done with the wrong man).
    let switched = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const m = scenario(seed);
      const ad = m.attackDir(0);
      const carrier = m.players[11 + 8];
      place(carrier, 0, 0);
      carrier.facing = ad > 0 ? Math.PI : 0;
      giveBall(m, carrier);
      const chaser = m.players[7];
      place(chaser, ad * 13, 0);
      const cover = m.players[4];
      place(cover, -ad * 5, 1.5);
      m.active = chaser.idx;
      let got = false;
      for (let i = 0; i < 60 && !got; i++) {
        // He steers the chaser at the ball.
        const b = m.ball.pos;
        const p = m.players[m.active];
        const l = Math.hypot(b.x - p.pos.x, b.z - p.pos.z) || 1;
        m.step(DT, pad((b.x - p.pos.x) / l, (b.z - p.pos.z) / l, { autoSprint: true }));
        m.drainEvents();
        if (m.active === cover.idx) got = true;
      }
      if (got) switched++;
    }
    expect(switched).toBe(4);
  });
});

describe('dead time', () => {
  it('a goal against him cuts to the kick-off sooner, and any goal can be tapped through after its wide shot', () => {
    const P = PRESENTATION;
    expect(P.theirGoalAtS).toBeLessThanOrEqual(2.5);
    expect(P.theirGoalAtS).toBeLessThan(P.noReplayAtS);
    expect(P.goalSkipGraceS).toBeGreaterThan(0);
    expect(P.goalSkipGraceS).toBeLessThan(0.5);
  });

  it('whole matches on the phone (casual bot, AUTO SPRINT, NORMAL): ball in play, short restarts, the right man on defence', () => {
    // Before (2026-10-04, 16 matches): in play 79.4%, the right man 76.2% of his defending, wrong switches 18.6%.
    const s = playtestSeries(3, { difficulty: 1.8, seed0: 5100, goalSkipS: 0.6 });
    // eslint-disable-next-line no-console
    console.log(`pace: in play ${s.inPlayPct.toFixed(1)}%, right man ${s.rightMan.toFixed(1)}%, wrong switches ${s.wrongSwitchPct.toFixed(1)}%, ` +
      `an action every ${s.actionGap.toFixed(1)} s, shots ${s.shotsFor.toFixed(1)}-${s.shotsAgainst.toFixed(1)}, stops ${JSON.stringify(s.stopMax)}`);
    expect(s.inPlayPct).toBeGreaterThanOrEqual(75);
    expect(s.rightMan).toBeGreaterThanOrEqual(85);
    expect(s.wrongSwitchPct).toBeLessThan(10);
    expect(s.actionGap).toBeLessThanOrEqual(8);
    // No restart holds the game up over 4 s (goals are tapped through after their wide shot, as he can).
    for (const [k, v] of Object.entries(s.stopMax)) expect(v, k).toBeLessThan(4);
  }, 600_000);
});
