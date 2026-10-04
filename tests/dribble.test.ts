import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_W } from '../src/sim/constants';
import { carrierGuard, closeTouch, CUT_REACH, PROTECT_T, vsHuman, WRONG_FOOT_MAX, WRONG_FOOT_MIN } from '../src/sim/dribble';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent } from '../src/sim/types';

/**
 * Dribble assists for the human's man (src/sim/dribble.ts): close control, the skill cut and wrong-footing,
 * shielding, path assist, the double-tap SPRINT knock-on, and the AI going easier on the human's dribbler.
 */

/** Open play, the human on side 0, everyone parked along the far touchline. */
function scenario(seed: number, difficulty = 1.8): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty, humanSide: 0, seed });
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
  m.active = p.idx;
  m.updateBallPath();
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

/** Our dribbler running along +x at x0 (jogging), up to speed. */
function runUp(m: Match, x0 = -12, frames = 50, sprint = false): Player {
  const p = m.players[9];
  place(p, x0, 0);
  p.facing = 0;
  giveBall(m, p);
  for (let i = 0; i < frames; i++) m.step(DT, pad(1, 0, { sprint }));
  return p;
}

describe('dribble assist: close control', () => {
  it('allows a moving approach to an exposed ball past the carrier, while neutral input, retreat and recovery cannot bump-tackle', () => {
    const challenge = (mode: 'approach' | 'retreat' | 'neutral' | 'cooldown' | 'stumble' | 'press') => {
      const m = scenario(27);
      const p = m.players[9], c = m.players[20];
      place(p, 0, 0); p.facing = 0;
      // The opponent is already behind the runner's shoulder, but his exposed ball is still ahead of the runner.
      place(c, -0.3, 0.5); c.facing = 0;
      m.ball.reset(0.65, 0); m.ball.owner = c.idx; m.ball.lastTouch = c.idx; m.ball.lastTouchSide = c.side;
      m.active = p.idx;
      p.vel.x = mode === 'retreat' ? -2 : mode === 'press' ? 0 : 2;
      m.ctl[0].prev = mode === 'neutral' || mode === 'press' ? EMPTY_PAD : pad(mode === 'retreat' ? -1 : 1, 0);
      m.ctl[0].pressing = mode === 'press';
      if (mode === 'cooldown') p.kickCooldown = 0.2;
      if (mode === 'stumble') p.stumbleT = 0.2;
      (m as unknown as { autoTackle(): void }).autoTackle();
      return m.drainEvents().some((e) => e.type === 'tackle' && e.by === p.idx);
    };
    expect(challenge('approach')).toBe(true);
    expect(challenge('press')).toBe(true);
    for (const mode of ['retreat', 'neutral', 'cooldown', 'stumble'] as const) expect(challenge(mode), mode).toBe(false);
  });

  it('jogging with it, the ball sits tighter on his foot than at a sprint, and he turns 90 degrees quicker', () => {
    const gap = (sprint: boolean) => {
      const m = scenario(3);
      const p = runUp(m, -20, 40, sprint);
      let sum = 0;
      for (let i = 0; i < 60; i++) {
        m.step(DT, pad(1, 0, { sprint }));
        sum += Math.hypot(m.ball.pos.x - p.pos.x, m.ball.pos.z - p.pos.z);
      }
      // A 90-degree turn from there (how far round the run is after 3 frames, and when it's round).
      let t = -1;
      let turned = 0;
      for (let i = 0; i < 60 && t < 0; i++) {
        m.step(DT, pad(0, 1, { sprint }));
        if (i === 2) turned = Math.atan2(p.vel.z, p.vel.x);
        if (Math.atan2(p.vel.z, p.vel.x) > Math.PI / 2 - 0.17) t = (i + 1) * DT;
      }
      return { avg: sum / 60, t, turned, kept: m.ball.owner === p.idx };
    };
    const jog = gap(false);
    const run = gap(true);
    // eslint-disable-next-line no-console
    console.log(`ball off the body: jogging ${jog.avg.toFixed(2)} m, sprinting ${run.avg.toFixed(2)} m; 90-degree turn ${jog.t.toFixed(2)} s vs ${run.t.toFixed(2)} s (after 3 frames: ${((jog.turned * 180) / Math.PI).toFixed(0)} vs ${((run.turned * 180) / Math.PI).toFixed(0)} degrees)`);
    expect(jog.avg).toBeLessThan(0.75);
    expect(jog.avg).toBeLessThan(run.avg - 0.1);
    expect(jog.t).toBeGreaterThan(0);
    // (Round 9's tempo has both round inside ~5 frames; the jog is still further round at any moment.)
    expect(jog.t).toBeLessThanOrEqual(run.t);
    expect(jog.turned).toBeGreaterThan(run.turned + 0.05);
    expect(jog.kept && run.kept).toBe(true);
  });

  it('is the human dribbler only: an AI carrier keeps the old touch (tighter only with the human\'s man on him, by difficulty)', () => {
    const m = scenario(4);
    const p = m.players[20];
    place(p, 10, 0);
    giveBall(m, p);
    expect(closeTouch(m, p, 0.1)).toBe(0.1);
    const h = m.players[9];
    place(h, -10, 0);
    giveBall(m, h);
    expect(closeTouch(m, h, 0.1)).toBeLessThan(0.1);
    // The human's man closing on an AI carrier: the carrier keeps it tighter (vsHuman.tight, 0 on EASY).
    giveBall(m, p);
    m.active = h.idx;
    place(h, 12, 0.5);
    expect(closeTouch(m, p, 0.1)).toBeLessThan(0.1);
    expect(closeTouch(m, p, 0.1)).toBeCloseTo(0.1 * (1 - vsHuman(1.8).tight), 5);
    place(h, 20, 0);
    expect(closeTouch(m, p, 0.1)).toBe(0.1);
  });
});

describe("the human's man answers the stick quicker than the AI's", () => {
  it('with the ball: ~0.25 s to 90% of his sprint, ~0.12 s to turn a 3 m/s run round, and he stops dead', () => {
    const legs = (human: boolean) => {
      const m = scenario(20);
      if (!human) (m.cfg as { humanSide: number }).humanSide = -1;
      const p = m.players[9];
      place(p, -20, 0);
      p.facing = 0;
      giveBall(m, p);
      // (The AI would steer him itself: drive his controls directly for the comparison.)
      const drive = (x: number, sprint: boolean) => {
        if (human) m.step(DT, pad(x, 0, { sprint }));
        else {
          p.wantX = x;
          p.wantZ = 0;
          p.sprint = sprint;
          p.step(DT, true, false);
        }
      };
      const sps: number[] = [];
      for (let i = 0; i < 90; i++) {
        drive(1, true);
        sps.push(p.speed());
      }
      const top = Math.max(...sps);
      const t90 = (sps.findIndex((v) => v >= 0.9 * top) + 1) * DT;
      place(p, -20, 0);
      p.facing = 0;
      p.vel.x = 3;
      giveBall(m, p);
      let rev = -1;
      for (let i = 0; i < 60 && rev < 0; i++) {
        drive(-0.55, false);
        if (p.vel.x <= 0) rev = (i + 1) * DT;
      }
      place(p, -20, 0);
      p.facing = 0;
      p.vel.x = 5;
      giveBall(m, p);
      let stop = -1;
      for (let i = 0; i < 60 && stop < 0; i++) {
        drive(0, false);
        if (p.speed() < 0.3) stop = (i + 1) * DT;
      }
      return { t90, rev, stop };
    };
    const h = legs(true);
    const ai = legs(false);
    // eslint-disable-next-line no-console
    console.log(`with the ball: 90% sprint ${h.t90.toFixed(2)} s (AI ${ai.t90.toFixed(2)}), reverse at 3 m/s ${h.rev.toFixed(2)} s (AI ${ai.rev.toFixed(2)}), stop from 5 m/s ${h.stop.toFixed(2)} s (AI ${ai.stop.toFixed(2)})`);
    expect(h.t90).toBeLessThanOrEqual(0.3);
    expect(h.t90).toBeLessThan(ai.t90 * 0.8);
    expect(h.rev).toBeGreaterThan(0);
    expect(h.rev).toBeLessThanOrEqual(0.14);
    expect(h.rev).toBeLessThan(ai.rev);
    expect(h.stop).toBeGreaterThan(0);
    expect(h.stop).toBeLessThanOrEqual(0.12);
  });
});

describe('dribble assist: skill cut', () => {
  /** A defender 2.4 m in front closing at `closing` m/s, our man flicks the stick 90 degrees. */
  const cutAt = (seed: number, closing: number, flick = true) => {
    const m = scenario(seed);
    const p = runUp(m, -12, 50);
    const o = m.players[14];
    place(o, p.pos.x + 2.4, p.pos.z + 0.3);
    o.vel.x = -closing;
    o.facing = Math.PI;
    const evs: MatchEvent[] = [];
    let cutT = 0;
    for (let i = 0; i < 40; i++) {
      // The flick: straight across in one frame (or, not a flick, eased round over half a second).
      const a = flick ? Math.PI / 2 : Math.min(Math.PI / 2, (i / 30) * (Math.PI / 2));
      m.step(DT, pad(Math.cos(a), Math.sin(a)));
      cutT = Math.max(cutT, p.cutT);
      evs.push(...m.drainEvents());
    }
    return { m, p, o, evs, cutT };
  };

  it('a sharp flick is a quick cut; a committed defender closing within 3 m is wrong-footed (a beat) most of the time', () => {
    let beats = 0;
    let kept = 0;
    let skills = 0;
    const N = 12;
    for (let s = 0; s < N; s++) {
      const r = cutAt(100 + s, 3);
      expect(r.cutT).toBeGreaterThan(0.15);
      if (r.evs.some((e) => e.type === 'beat' && e.by === r.p.idx && e.on === r.o.idx)) beats++;
      if (r.evs.some((e) => e.type === 'skill' && e.player === r.p.idx)) skills++;
      if (r.m.ball.owner === r.p.idx) kept++;
    }
    // eslint-disable-next-line no-console
    console.log(`skill cut vs a committed defender: beat ${beats}/${N}, kept it ${kept}/${N}, 'skill' ${skills}/${N}`);
    expect(beats).toBeGreaterThanOrEqual(N * 0.5);
    expect(kept).toBeGreaterThanOrEqual(N * 0.75);
    expect(skills).toBe(N);
  });

  it('wrong-footed: planted for 0.35-0.5 s (nearly frozen), no tackle meanwhile, and the dribbler is protected', () => {
    for (let s = 0; s < 20; s++) {
      const m = scenario(200 + s);
      const p = runUp(m, -12, 50);
      const o = m.players[14];
      place(o, p.pos.x + 2.2, 0.4);
      o.vel.x = -3;
      m.step(DT, pad(0, 1));
      m.step(DT, pad(0, 1));
      const beat = m.drainEvents().find((e) => e.type === 'beat');
      if (!beat) continue;
      expect(o.wrongFootT).toBeGreaterThanOrEqual(WRONG_FOOT_MIN - 2 * DT);
      expect(o.wrongFootT).toBeLessThanOrEqual(WRONG_FOOT_MAX);
      expect(o.tackleCooldown).toBeGreaterThan(o.wrongFootT);
      expect(p.protectT).toBeGreaterThan(PROTECT_T - 3 * DT);
      // Nearly frozen: however hard the AI drives him, he barely moves for the next 0.3 s.
      const x0 = o.pos.x;
      const z0 = o.pos.z;
      for (let i = 0; i < 18; i++) m.step(DT, pad(0, 1));
      expect(Math.hypot(o.pos.x - x0, o.pos.z - z0)).toBeLessThan(1.2);
      return;
    }
    throw new Error('no beat in 20 tries');
  });

  it('an eased turn (no flick) is no skill move; nor is a flick with nobody near', () => {
    const r = cutAt(300, 3, false);
    expect(r.cutT).toBe(0);
    expect(r.evs.some((e) => e.type === 'beat' || e.type === 'skill')).toBe(false);
    const m = scenario(301);
    const p = runUp(m, -12, 50);
    const evs: MatchEvent[] = [];
    for (let i = 0; i < 20; i++) {
      m.step(DT, pad(0, 1));
      evs.push(...m.drainEvents());
    }
    expect(p.cutT + (evs.some((e) => e.type === 'skill') ? 1 : 0)).toBeLessThan(1); // (a cut, no 'skill')
    expect(evs.some((e) => e.type === 'beat')).toBe(false);
  });

  it('the cut beats nobody further than CUT_REACH', () => {
    const m = scenario(302);
    const p = runUp(m, -12, 50);
    const o = m.players[14];
    place(o, p.pos.x + CUT_REACH + 0.8, 0);
    o.vel.x = -4;
    m.step(DT, pad(0, 1));
    m.step(DT, pad(0, 1));
    expect(m.drainEvents().some((e) => e.type === 'beat')).toBe(false);
  });
});

describe('dribble assist: shielding and protection', () => {
  it('stick neutral with a defender close behind: he turns his back on him, and tackles through him mostly fail', () => {
    const m = scenario(400);
    const p = m.players[9];
    place(p, 0, 0);
    p.facing = Math.PI; // facing the defender
    giveBall(m, p);
    const o = m.players[14];
    place(o, 1.3, 0);
    o.setState('fallen'); // (held off for a moment so the AI doesn't go in while we look)
    for (let i = 0; i < 30; i++) m.step(DT, EMPTY_PAD);
    expect(p.shieldT).toBeGreaterThan(0);
    // His back to the defender (who is at +x): facing -x.
    expect(Math.cos(p.facing)).toBeLessThan(-0.7);
    o.setState('move');
    const guarded = carrierGuard(m, o, p);
    p.shieldT = 0;
    const open = carrierGuard(m, o, p);
    // eslint-disable-next-line no-console
    console.log(`tackle odds on the human's carrier: shielding x${guarded.toFixed(2)}, not x${open.toFixed(2)}`);
    expect(guarded).toBeLessThan(open * 0.6);
  });

  it('protection after a skill: an AI standing tackle on him almost never comes off', () => {
    let won = 0;
    let wonOpen = 0;
    const N = 60;
    for (let s = 0; s < N; s++) {
      for (const prot of [true, false]) {
        const m = scenario(500 + s);
        const p = m.players[9];
        place(p, 0, 0);
        p.facing = 0;
        giveBall(m, p);
        const o = m.players[14];
        place(o, 1.2, 0);
        o.facing = Math.PI;
        p.protectT = prot ? PROTECT_T : 0;
        p.ballT = 2; // (had it a while: not the first-touch guard)
        m.tryTackle(o, p, 1.2);
        const ok = m.drainEvents().some((e) => e.type === 'tackle' && e.won);
        if (ok && prot) won++;
        if (ok && !prot) wonOpen++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`AI tackle on the human's carrier from the front: ${wonOpen}/${N} normally, ${won}/${N} in the protection window`);
    expect(won).toBeLessThanOrEqual(Math.max(3, wonOpen * 0.3));
  });

  it('a fresh receiver has a half-second to turn or pass before full tackle pressure returns', () => {
    const m = scenario(610);
    const p = m.players[9];
    place(p, 0, 0);
    giveBall(m, p);
    const o = m.players[14];
    p.ballT = 0.1;
    const fresh = carrierGuard(m, o, p);
    p.ballT = 1;
    expect(fresh).toBeLessThan(carrierGuard(m, o, p) * 0.4);
    p.ballT = 0.45;
    expect(carrierGuard(m, o, p)).toBeCloseTo(fresh, 5);
  });

  it("AI carriers aren't guarded (AI-vs-AI tackles are unchanged)", () => {
    const m = scenario(600);
    const c = m.players[20];
    place(c, 0, 0);
    giveBall(m, c);
    m.active = m.players[9].idx;
    c.protectT = 1;
    c.shieldT = 1;
    expect(carrierGuard(m, m.players[9], c)).toBe(1);
  });
});

describe('dribble assist: path assist', () => {
  it('a defender square in the run within 2 m bends it round him (up to ~20 degrees), towards the free side', () => {
    const bendAt = (withDefender: boolean) => {
      const m = scenario(700);
      const p = runUp(m, -12, 40);
      const o = m.players[14];
      if (withDefender) {
        place(o, p.pos.x + 1.9, p.pos.z + 0.35);
        o.setState('fallen'); // standing still in the way (not tackling)
        o.stateT = -5;
      }
      let maxA = 0;
      for (let i = 0; i < 12; i++) {
        m.step(DT, pad(1, 0));
        maxA = Math.max(maxA, Math.abs(Math.atan2(p.vel.z, p.vel.x)));
      }
      return { maxA, z: p.pos.z, oz: o.pos.z };
    };
    const bent = bendAt(true);
    const straight = bendAt(false);
    // eslint-disable-next-line no-console
    console.log(`path assist: run bent ${(bent.maxA * 57.3).toFixed(1)} deg round a man in the way (${(straight.maxA * 57.3).toFixed(1)} with nobody)`);
    expect(bent.maxA).toBeGreaterThan(0.12);
    expect(bent.maxA).toBeLessThan(0.4);
    expect(straight.maxA).toBeLessThan(0.05);
    // Away from his side of the run (he stood a little to +z).
    expect(bent.z).toBeLessThan(0);
  });
});

describe('dribble assist: knock-on (double-tap SPRINT)', () => {
  it('in space it goes ~5-8 m ahead and he is back on it within ~1.2 s, every time', () => {
    let ok = 0;
    const N = 10;
    let far = 0;
    for (let s = 0; s < N; s++) {
      const m = scenario(800 + s);
      const p = runUp(m, -20, 40);
      const x0 = p.pos.x;
      // Double tap: down 3, up 4, down 3 frames.
      const seq = [1, 1, 1, 0, 0, 0, 0, 1, 1, 1];
      let knocked = false;
      for (const d of seq) {
        m.step(DT, pad(1, 0, { sprint: d === 1 }));
        if (m.drainEvents().some((e) => e.type === 'skill')) knocked = true;
      }
      expect(knocked).toBe(true);
      let back = -1;
      for (let i = 0; i < 90 && back < 0; i++) {
        m.step(DT, pad(1, 0, { sprint: true }));
        if (m.ball.owner === p.idx) back = (i + 1) * DT;
      }
      if (back > 0 && back < 1.2) ok++;
      far = Math.max(far, p.pos.x - x0);
    }
    // eslint-disable-next-line no-console
    console.log(`knock-on: back on it within 1.2 s ${ok}/${N}`);
    expect(ok).toBe(N);
    expect(far).toBeLessThan(14);
  });

  it('a double tap spread up to 0.35 s apart still counts', () => {
    const m = scenario(900);
    const p = runUp(m, -20, 40);
    const seq = [1, 1, 1, ...new Array(15).fill(0), 1, 1];
    let knocked = false;
    for (const d of seq) {
      m.step(DT, pad(1, 0, { sprint: d === 1 }));
      if (m.drainEvents().some((e) => e.type === 'skill' && e.player === p.idx)) knocked = true;
    }
    expect(knocked).toBe(true);
  });
});

describe('the AI against the human dribbler, by difficulty', () => {
  it('EASY presses and tackles the human least and LEGEND most; the human tackles EASY carriers most easily', () => {
    const lv = [0.6, 1.8, 3, 4].map(vsHuman);
    for (let i = 1; i < lv.length; i++) {
      expect(lv[i].press).toBeGreaterThan(lv[i - 1].press);
      expect(lv[i].tackle).toBeGreaterThan(lv[i - 1].tackle);
      expect(lv[i].resist).toBeLessThan(lv[i - 1].resist);
      expect(lv[i].cut).toBeLessThan(lv[i - 1].cut);
    }
    // EASY goes in less often than the AI does on an AI dribbler (and at every level it ramps up later against
    // the human, gives him more room and never goes in straight after a skill: ai.press). Round 9: NORMAL goes in
    // more than on an AI dribbler (the bot won 87% at NORMAL with it at 0.82: balance wants goals at both ends).
    expect(lv[0].press).toBeLessThan(1);
    expect(lv[1].press).toBeGreaterThan(1);
    expect(lv[1].press).toBeLessThanOrEqual(1.7);
  });
});
