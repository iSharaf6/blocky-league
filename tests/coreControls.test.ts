import { describe, expect, it, vi } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BOX_DEPTH, BOX_W, DT, HALF_L, HALF_W } from '../src/sim/constants';
import { FOUL_BEHIND, MISS_COOLDOWN, standingFoulChance, standingTackleChance, TAP_CLOSE } from '../src/sim/dribble';
import { HUMAN_KEEPER_HOLD, RUSH_RANGE } from '../src/sim/keeper';
import { EMPTY_PAD, KO_GUARD_T, Match, type Pad } from '../src/sim/match';
import { HUMAN_PACE_FLOOR, type Player } from '../src/sim/player';
import type { MatchEvent } from '../src/sim/types';

/*
 * Core controls on touch (2026-10-04), the owner on his iPhone:
 * - "sprinting button shoudlnt exist as players should be sprinting automatcially";
 * - "make it so ur able to move with the keeper if he is holding the ball in his hands and if he has the ball" and "make
 *   it so ur able to control the keeper";
 * - "if the ball is up in the air and im trying to run to it it should kind of lock me to run towards it just like in DLS";
 * - "in kick off or half time the pass shouldnt be able to go to the opposition";
 * - "when i press the tackle button idt theyre tackling properlhy, like the button feels useless when its a standing
 *   tackle, same as the press button";
 * - "game feels heavy".
 * The human is side 0 throughout. (The touch buttons themselves: tests/inputLifecycle.test.ts.)
 */

// (Whole duels and kick-offs by the dozen: slow on a loaded machine.)
vi.setConfig({ testTimeout: 240_000 });

/** Open play with everyone parked along the far touchline, out of the way. */
function scenario(seed: number, difficulty = 1.8): Match {
  const away = makeTeam(PRESET_CLUBS[6]);
  away.style = 'balanced';
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away, halfLength: 150, difficulty, humanSide: 0, seed });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.clock = 20;
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

function giveBall(m: Match, p: Player, human = true): void {
  m.ball.reset(p.footX(), p.footZ());
  m.ball.owner = p.idx;
  m.ball.lastTouch = p.idx;
  m.ball.lastTouchSide = p.side;
  m.possessionSide = p.side;
  if (human) m.active = p.idx;
  m.updateBallPath();
}

/** The touch pad: the stick (world x, z) and AUTO SPRINT, as the session builds it with the thumbstick in hand. */
const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, autoSprint: true, ...extra });

function steps(m: Match, n: number, input: Pad | ((i: number) => Pad), each?: (i: number) => void): MatchEvent[] {
  const evs: MatchEvent[] = [];
  for (let i = 0; i < n; i++) {
    m.step(DT, typeof input === 'function' ? input(i) : input);
    evs.push(...m.drainEvents());
    each?.(i);
  }
  return evs;
}

// ------------------------------------------------------------------ sprint

describe('no SPRINT button: the stick sprints', () => {
  const pace = (stick: number, extra: Partial<Pad> = {}) => {
    const m = scenario(3);
    const p = m.players[7];
    place(p, -20, 0);
    p.facing = 0;
    giveBall(m, p);
    steps(m, 60, pad(stick, 0, extra));
    return { v: p.speed(), sprint: p.sprint };
  };

  it('a push half way out or more is his full pace; only a light push jogs, for close control', () => {
    const full = pace(1);
    const half = pace(0.55);
    const light = pace(0.3);
    // eslint-disable-next-line no-console
    console.log(`with the ball: stick 100% ${full.v.toFixed(2)} m/s, 55% ${half.v.toFixed(2)} m/s, 30% ${light.v.toFixed(2)} m/s`);
    expect(full.sprint).toBe(true);
    expect(half.sprint).toBe(true);
    expect(half.v).toBeGreaterThan(full.v * 0.98);
    expect(light.sprint).toBe(false);
    expect(light.v).toBeLessThan(full.v * 0.45);
  });

  it('keys and a gamepad with AUTO SPRINT turned off still sprint on the SPRINT key, and only on it', () => {
    expect(pace(1, { autoSprint: false }).sprint).toBe(false);
    expect(pace(1, { autoSprint: false, sprint: true }).sprint).toBe(true);
  });

  it('tired legs cost the man under the thumb little of his pace; the AI as much as ever', () => {
    const m = scenario(4);
    const p = m.players[7];
    const run = (stamina: number) => {
      place(p, -30, 0);
      p.facing = 0;
      giveBall(m, p);
      let top = 0;
      steps(m, 80, pad(1, 0), () => {
        p.stamina = stamina;
        top = Math.max(top, p.speed());
      });
      return top;
    };
    const fresh = run(1);
    const spent = run(0.2);
    expect(spent / fresh).toBeGreaterThan(0.88);
    expect(p.sprintPace(true) / p.top).toBeGreaterThanOrEqual(HUMAN_PACE_FLOOR);
    // (An AI player on the same legs: three quarters of his pace, as before.)
    p.stamina = 0.2;
    expect(p.sprintPace() / p.top).toBeLessThan(0.8);
  });
});

// ------------------------------------------------------------------ kick-off

describe('the protected kick-off', () => {
  /** A match about to kick off, the human's side taking it. */
  const kickoff = (seed: number): Match => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[2 + (seed % 6)]), away: makeTeam(PRESET_CLUBS[3 + (seed % 6)]), halfLength: 120, difficulty: 1.8, humanSide: 0, seed });
    if (m.restart?.side !== 0) m.setupKickoff(0);
    m.drainEvents();
    return m;
  };

  it('whatever the stick and whichever button, the first touch is a team-mate\'s', () => {
    let n = 0;
    let ours = 0;
    for (const btn of ['pass', 'through', 'shoot'] as const) {
      for (let d = -1; d < 8; d++) {
        for (const seed of [17, 34, 51, 68]) {
          const m = kickoff(seed);
          const ad = m.attackDir(0);
          // (0 degrees: the stick straight at their goal, the way a thumb is at the whistle.)
          const a = (d * Math.PI) / 4;
          const sx = d < 0 ? 0 : Math.cos(a) * ad;
          const sz = d < 0 ? 0 : Math.sin(a);
          let first = -1;
          for (let i = 0; i < 300 && first < 0; i++) {
            m.step(DT, pad(sx, sz, { [btn]: i >= 50 && i < 54 }));
            for (const e of m.drainEvents()) if (e.type === 'control' && first < 0) first = m.players[e.player].side;
          }
          n++;
          if (first === 0) ours++;
        }
      }
    }
    // (Before: 0 of 36 with the stick at their goal, 89% overall.)
    expect(ours).toBe(n);
  });

  it('it goes to a man level with the ball or behind it, and the other side stands off until he has it', () => {
    const m = kickoff(17);
    const ad = m.attackDir(0);
    const taker = m.players[m.restart!.taker];
    const theirs = m.teamPlayers(1).map((p) => ({ p, x: p.pos.x, z: p.pos.z }));
    let kicked = -1;
    let received = -1;
    let moved = 0;
    let target = -1;
    for (let i = 0; i < 300 && received < 0; i++) {
      m.step(DT, pad(ad, 0, { pass: i >= 30 && i < 34 }));
      for (const e of m.drainEvents()) {
        if (e.type === 'kick' && kicked < 0) {
          kicked = i;
          target = m.passTarget;
          expect(m.koGuard).not.toBeNull();
        }
        if (e.type === 'control' && kicked >= 0) received = i;
      }
      if (kicked >= 0 && received < 0) for (const t of theirs) moved = Math.max(moved, Math.hypot(t.p.pos.x - t.x, t.p.pos.z - t.z));
    }
    expect(kicked).toBeGreaterThanOrEqual(30);
    expect(target).toBeGreaterThanOrEqual(0);
    expect(m.players[target].side).toBe(0);
    expect((m.players[target].pos.x - taker.pos.x) * ad).toBeLessThan(1.5);
    expect(received).toBeGreaterThan(kicked);
    expect((received - kicked) * DT).toBeLessThan(KO_GUARD_T);
    // (They stood where they were while it travelled...)
    expect(moved).toBeLessThan(0.5);
    // ...and play on from his first touch.
    expect(m.koGuard).toBeNull();
    steps(m, 60, pad(0, 0));
    let after = 0;
    for (const t of theirs) after = Math.max(after, Math.hypot(t.p.pos.x - t.x, t.p.pos.z - t.z));
    expect(after).toBeGreaterThan(1.5);
  });

  it('an AI side\'s kick-off is as it was: no guard', () => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[4]), away: makeTeam(PRESET_CLUBS[5]), halfLength: 120, difficulty: 1.8, humanSide: 0, seed: 9 });
    if (m.restart?.side !== 1) m.setupKickoff(1);
    m.drainEvents();
    let kicked = false;
    for (let i = 0; i < 300 && !kicked; i++) {
      m.step(DT, pad(0, 0));
      kicked = m.drainEvents().some((e) => e.type === 'kick');
      expect(m.koGuard).toBeNull();
    }
    expect(kicked).toBe(true);
  });
});

// ------------------------------------------------------------------ the keeper

describe('the keeper is his with the ball', () => {
  /** His keeper holding the ball in his hands, `out` m off his line. */
  const inHands = (seed: number, out = 4): { m: Match; k: Player; gx: number; ad: number } => {
    const m = scenario(seed);
    const k = m.keeperOf(0)!;
    const ad = m.attackDir(0);
    const gx = -ad * HALF_L;
    place(k, gx + ad * out, 0);
    k.facing = ad > 0 ? 0 : Math.PI;
    k.setState('hold');
    const b = m.ball;
    b.reset(k.pos.x, k.pos.z);
    b.owner = k.idx;
    b.held = true;
    b.lastTouch = k.idx;
    b.lastTouchSide = 0;
    m.possessionSide = 0;
    m.keeperHeldT = 0;
    m.active = k.idx;
    m.updateBallPath();
    return { m, k, gx, ad };
  };

  it('in his hands he walks it about his box with the stick, and never out of it', () => {
    const { m, k, gx, ad } = inHands(5);
    steps(m, 60, pad(0, 1));
    expect(m.ball.held).toBe(true);
    expect(k.pos.z).toBeGreaterThan(2);
    expect(Math.hypot(m.ball.pos.x - k.pos.x, m.ball.pos.z - k.pos.z)).toBeLessThan(0.6);
    // Up the pitch, then out wide: he stops inside the lines of his own area.
    steps(m, 150, pad(ad, 0.4));
    expect(m.ball.held).toBe(true);
    expect(Math.abs(k.pos.x - gx)).toBeLessThan(BOX_DEPTH);
    expect(Math.abs(k.pos.x - gx)).toBeGreaterThan(BOX_DEPTH - 2.5);
    expect(Math.abs(k.pos.z)).toBeLessThan(BOX_W / 2);
  });

  it('PASS throws it to the man the stick points at (the preview), THROUGH lofts it to him, SHOOT punts it up the pitch', () => {
    const play = (btn: 'pass' | 'through' | 'shoot') => {
      const { m, k, ad } = inHands(7);
      const mate = m.players[4];
      place(mate, k.pos.x + ad * 16, 12);
      const fw = m.players[9];
      place(fw, k.pos.x + ad * 48, -6);
      const dx = mate.pos.x - k.pos.x;
      const dz = mate.pos.z - k.pos.z;
      const dl = Math.hypot(dx, dz);
      steps(m, 24, pad(0, 0));
      // (The preview, a step before the press.)
      m.step(DT, pad(dx / dl, dz / dl));
      const shown = m.passPreview;
      const evs = steps(m, 90, (i) => pad(dx / dl, dz / dl, { [btn]: i < 4 }));
      const kick = evs.find((e) => e.type === 'kick');
      return { m, k, mate, fw, shown, kick, target: m.passTarget, evs };
    };
    const thrown = play('pass');
    expect(thrown.shown).toBe(thrown.mate.idx);
    expect(thrown.kick && thrown.kick.type === 'kick' && thrown.kick.kind).toBe('keeper');
    expect(thrown.evs.some((e) => e.type === 'control' && e.player === thrown.mate.idx)).toBe(true);
    const lofted = play('through');
    expect(lofted.kick && lofted.kick.type === 'kick' && lofted.kick.kind).toBe('lob');
    const punted = play('shoot');
    expect(punted.kick && punted.kick.type === 'kick' && (punted.kick.kind === 'lob' || punted.kick.kind === 'clear')).toBe(true);
    // (The punt is for the man furthest up the pitch, not the full-back the stick is on.)
    expect(punted.evs.some((e) => e.type === 'kick') && punted.m.kickKind !== 'keeper').toBe(true);
    expect(Math.abs(punted.m.ball.pos.x - punted.k.pos.x)).toBeGreaterThan(20);
    // After any of them the human has an outfielder, and the keeper is the AI's again.
    for (const r of [thrown, lofted, punted]) expect(r.m.players[r.m.active].isKeeper).toBe(false);
  });

  it(`left alone he lets it go himself before the six seconds are up (${HUMAN_KEEPER_HOLD} s after the catch)`, () => {
    const { m } = inHands(9);
    let gone = -1;
    steps(m, 60 * 7, pad(0, 0), (i) => {
      if (gone < 0 && !m.ball.held) gone = (i + 1) * DT;
    });
    expect(gone).toBeGreaterThan(HUMAN_KEEPER_HOLD);
    expect(gone).toBeLessThan(6);
  });

  it('nobody takes it out of his hands', () => {
    const { m, k, ad } = inHands(11);
    const a = m.players[19];
    const b2 = m.players[20];
    for (let i = 0; i < 180; i++) {
      // Two of theirs standing on him, going in for it every step.
      a.pos.x = k.pos.x + ad * 0.8;
      a.pos.z = k.pos.z + 0.3;
      b2.pos.x = k.pos.x + ad * 0.6;
      b2.pos.z = k.pos.z - 0.5;
      a.tackleCooldown = b2.tackleCooldown = 0;
      m.tryTackle(a, k, 5);
      m.tryTackle(b2, k, 5, true);
      m.step(DT, pad(0, 0));
      m.drainEvents();
      expect(m.ball.held).toBe(true);
      expect(m.ball.owner).toBe(k.idx);
    }
  });

  it('at his feet he is the human\'s man: the stick moves him, PASS plays it out, and then he is the AI\'s again', () => {
    const m = scenario(13);
    const k = m.keeperOf(0)!;
    const ad = m.attackDir(0);
    const gx = -ad * HALF_L;
    place(k, gx + ad * 6, 0);
    k.facing = ad > 0 ? 0 : Math.PI;
    giveBall(m, k);
    const z0 = k.pos.z;
    steps(m, 40, pad(0, 1));
    expect(m.active).toBe(k.idx);
    expect(m.ball.owner).toBe(k.idx);
    expect(k.pos.z - z0).toBeGreaterThan(2);
    const mate = m.players[4];
    place(mate, k.pos.x + ad * 14, k.pos.z + 6);
    const dx = mate.pos.x - k.pos.x;
    const dz = mate.pos.z - k.pos.z;
    const dl = Math.hypot(dx, dz);
    const evs = steps(m, 20, (i) => pad(dx / dl, dz / dl, { pass: i < 4 }));
    expect(evs.some((e) => e.type === 'kick' && e.player === k.idx)).toBe(true);
    expect(m.players[m.active].isKeeper).toBe(false);
    // Back towards his line by himself.
    steps(m, 150, pad(0, 0));
    expect(Math.abs(k.pos.x - gx)).toBeLessThan(5);
  });

  it('at his feet with a man of theirs on him and nothing pressed, he moves it on himself', () => {
    const m = scenario(15);
    const k = m.keeperOf(0)!;
    const ad = m.attackDir(0);
    place(k, -ad * HALF_L + ad * 5, 0);
    k.facing = ad > 0 ? 0 : Math.PI;
    giveBall(m, k);
    const o = m.players[20];
    place(o, k.pos.x + ad * 2.2, 0.8);
    const evs = steps(m, 30, pad(0, 0), () => {
      o.pos.x = k.pos.x + ad * 2.2;
      o.pos.z = k.pos.z + 0.8;
      o.vel.x = o.vel.z = 0;
    });
    expect(evs.some((e) => e.type === 'kick' && e.player === k.idx)).toBe(true);
  });
});

describe('KEEPER held: the manual keeper', () => {
  /** Their carrier pinned `d` m out from our goal (he's put back there every step); returns the keeper's distance off his line. */
  const rush = (d: number, hold: (i: number) => boolean, frames = 150) => {
    const m = scenario(21);
    const k = m.keeperOf(0)!;
    const ad = m.attackDir(0);
    const gx = -ad * HALF_L;
    place(k, gx + ad * 1.5, 0);
    const c = m.players[19];
    const p = m.players[6];
    place(p, gx + ad * (d + 14), 12);
    m.active = p.idx;
    const off: number[] = [];
    let box = true;
    for (let i = 0; i < frames; i++) {
      place(c, gx + ad * d, 3);
      c.facing = ad > 0 ? Math.PI : 0;
      c.aiT = 1;
      giveBall(m, c, false);
      m.shotClock = 99;
      m.step(DT, pad(0, 0, { skill: hold(i) }));
      m.drainEvents();
      off.push(Math.abs(k.pos.x - gx));
      if (Math.abs(k.pos.x - gx) > BOX_DEPTH || Math.abs(k.pos.z) > BOX_W / 2) box = false;
    }
    return { off, box, m, k };
  };

  it('held, he comes off his line at the carrier and stays in his box; let go, the AI takes him back', () => {
    const stay = rush(22, () => false);
    const out = rush(22, (i) => i < 90, 300);
    // eslint-disable-next-line no-console
    console.log(`keeper off his line, carrier 22 m out: AI ${stay.off[89].toFixed(1)} m, KEEPER held 1.5 s ${out.off[89].toFixed(1)} m, 3.5 s after letting go ${out.off[299].toFixed(1)} m`);
    expect(stay.off[89]).toBeLessThan(4);
    expect(out.off[89]).toBeGreaterThan(stay.off[89] + 4);
    expect(out.box).toBe(true);
    expect(out.off[299]).toBeLessThan(4.5);
  });

  it(`with the ball further than ${RUSH_RANGE} m from his goal he stays at home`, () => {
    const far = rush(RUSH_RANGE + 8, () => true);
    expect(far.off[149]).toBeLessThan(4.5);
  });

  it('it never reaches the SKILL moves: held with the ball not ours, no move is tried', () => {
    const m = scenario(23);
    const c = m.players[19];
    place(c, 0, 0);
    giveBall(m, c, false);
    const p = m.players[6];
    place(p, -6, 0);
    m.active = p.idx;
    const wasted = m.ctl[0].skill.wasted;
    const evs = steps(m, 20, (i) => pad(0, 0, { skill: i > 2 && i < 12 }));
    expect(m.ctl[0].skill.wasted).toBe(wasted);
    expect(evs.some((e) => e.type === 'skillMove')).toBe(false);
  });
});

// ------------------------------------------------------------------ the aerial lock

describe('the aerial lock', () => {
  /** Their clearance hung up towards our half; our man `back` m from where it comes down. */
  const lofted = (seed: number, rival = false): { m: Match; p: Player; land: { x: number; z: number } } => {
    const m = scenario(seed);
    const ad = m.attackDir(0);
    const o = m.players[18];
    place(o, ad * 12, 0);
    // (He has just struck it: it isn't his to take again.)
    o.kickCooldown = 1;
    const b = m.ball;
    b.reset(o.pos.x, o.pos.z);
    b.pos.y = 0.4;
    b.vel.x = -ad * 13;
    b.vel.y = 11;
    b.vel.z = 4;
    b.owner = -1;
    b.lastTouch = o.idx;
    b.lastTouchSide = 1;
    m.kickId++;
    m.kickSide = 1;
    m.kickKind = 'clear';
    m.sinceKick = 0;
    m.passTarget = -1;
    m.shotClock = 99;
    m.possessionSide = 1;
    m.updateBallPath();
    const land = m.ballPath.find((s, i) => i > 4 && s.y < 0.35) ?? m.ballPath[m.ballPath.length - 1];
    const p = m.players[6];
    place(p, land.x - ad * 9, land.z - 7);
    m.active = p.idx;
    if (rival) {
      // One of theirs under it too: on the side it comes from (he'd meet it first), or beyond it, turn about.
      const r = m.players[19];
      if (seed % 2) place(r, land.x + ad * 2.5, land.z + 1);
      else place(r, land.x - ad * 1.2, land.z + 1.6);
    }
    return { m, p, land: { x: land.x, z: land.z } };
  };

  it('a stick roughly at a ball in the air locks his man onto where it comes down: he runs there, not where the thumb wobbles', () => {
    const { m, p } = lofted(31);
    let on = -1;
    let worst = 0;
    let got = false;
    for (let i = 0; i < 200 && !got; i++) {
      const a = m.ctl[0].air;
      const tx = (a?.x ?? m.ball.pos.x) - p.pos.x;
      const tz = (a?.z ?? m.ball.pos.z) - p.pos.z;
      const to = Math.atan2(tz, tx);
      // The thumb: 40 degrees off the way to it, one side then the other.
      const stick = to + (Math.floor(i / 12) % 2 ? 1 : -1) * 0.7;
      m.step(DT, pad(Math.cos(stick), Math.sin(stick)));
      const evs = m.drainEvents();
      const air = m.ctl[0].air;
      if (air?.on && on < 0) on = i;
      if (air?.on && p.speed() > 4 && Math.hypot(air.x - p.pos.x, air.z - p.pos.z) > 2) {
        const run = Math.atan2(p.vel.z, p.vel.x);
        const way = Math.atan2(air.z - p.pos.z, air.x - p.pos.x);
        worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(run - way), Math.cos(run - way))));
      }
      if (evs.some((e) => (e.type === 'control' && e.player === p.idx) || (e.type === 'kick' && e.player === p.idx))) got = true;
    }
    expect(on).toBeGreaterThanOrEqual(0);
    expect(on).toBeLessThan(6);
    // (His run is on the line to the spot, within a few degrees, with the thumb 40 off it.)
    expect(worst).toBeLessThan(0.2);
    expect(got).toBe(true);
  });

  it('a clear push elsewhere breaks it off, and his run is the stick\'s again', () => {
    const { m, p } = lofted(33);
    const to = () => Math.atan2((m.ctl[0].air?.z ?? 0) - p.pos.z, (m.ctl[0].air?.x ?? 0) - p.pos.x);
    steps(m, 20, () => pad(Math.cos(to()), Math.sin(to())));
    expect(m.ctl[0].air?.on).toBe(true);
    const away = to() + Math.PI;
    steps(m, 30, pad(Math.cos(away), Math.sin(away)));
    expect(m.ctl[0].air?.on ?? false).toBe(false);
    const run = Math.atan2(p.vel.z, p.vel.x);
    expect(Math.abs(Math.atan2(Math.sin(run - away), Math.cos(run - away)))).toBeLessThan(0.3);
  });

  it('with the stick left alone, or the ball on the ground, nothing is locked', () => {
    const { m } = lofted(35);
    steps(m, 20, pad(0, 0));
    expect(m.ctl[0].air?.on ?? false).toBe(false);
    const g = scenario(36);
    const p = g.players[6];
    place(p, -10, 0);
    g.active = p.idx;
    g.ball.reset(0, 0);
    g.ball.vel.x = -6;
    g.ball.lastTouchSide = 1;
    g.updateBallPath();
    steps(g, 10, pad(1, 0));
    expect(g.ctl[0].air).toBeNull();
  });

  it('locked on, with one of theirs under it too, he wins the first contact most of the time', () => {
    let ours = 0;
    let theirs = 0;
    const N = 24;
    for (let s = 0; s < N; s++) {
      const { m, p } = lofted(300 + s * 7, true);
      let first = -1;
      for (let i = 0; i < 240 && first < 0; i++) {
        const a = m.ctl[0].air;
        const tx = (a?.x ?? m.ball.pos.x) - p.pos.x;
        const tz = (a?.z ?? m.ball.pos.z) - p.pos.z;
        const tl = Math.hypot(tx, tz) || 1;
        m.step(DT, pad(tx / tl, tz / tl));
        for (const e of m.drainEvents()) {
          if (first >= 0) break;
          if (e.type === 'control') first = m.players[e.player].side;
          else if (e.type === 'kick' && (e.player ?? -1) >= 0) first = m.players[e.player!].side;
        }
      }
      if (first === 0) ours++;
      else if (first === 1) theirs++;
    }
    // eslint-disable-next-line no-console
    console.log(`aerial duel, locked on: first contact ours ${ours}, theirs ${theirs} of ${N}`);
    expect(ours).toBeGreaterThan(theirs);
    expect(ours / N).toBeGreaterThanOrEqual(0.55);
  });
});

// ------------------------------------------------------------------ TACKLE and PRESS

/** Their carrier at the centre spot running along `dir`, our man `gap` m away at `at` (-1: on his -x side). */
function duel(seed: number, gap: number, at: number, dir: number, speed = 3, difficulty = 1.8): { m: Match; p: Player; c: Player } {
  const m = scenario(seed, difficulty);
  const c = m.players[19];
  place(c, 0, 0);
  c.facing = dir > 0 ? 0 : Math.PI;
  c.vel.x = dir * speed;
  c.aiT = 0.6;
  c.ballT = 2;
  c.aiMode = 'dribble';
  c.aiDirX = dir;
  c.aiDirZ = 0;
  giveBall(m, c, false);
  m.possessionSide = 1;
  const p = m.players[6];
  place(p, at * gap, 0);
  p.facing = at > 0 ? Math.PI : 0;
  m.active = p.idx;
  return { m, p, c };
}

const tap = (i: number) => pad(0, 0, { shoot: i < 4 });

describe('the standing TACKLE works and reads', () => {
  it('in reach and in front of him it wins the ball, whatever the level', () => {
    const rate = (difficulty: number) => {
      let tried = 0;
      let won = 0;
      let fouls = 0;
      for (let s = 0; s < 40; s++) {
        const { m, p } = duel(1000 + s, 2, -1, -1, 3, difficulty);
        const evs = steps(m, 45, tap);
        if (evs.some((e) => e.type === 'tackle' && e.by === p.idx && !e.slide)) tried++;
        if (evs.some((e) => e.type === 'tackle' && e.by === p.idx && e.won)) won++;
        if (evs.some((e) => e.type === 'foul' && e.by === p.idx)) fouls++;
      }
      return { tried, won, fouls };
    };
    const normal = rate(1.8);
    const legend = rate(4);
    // eslint-disable-next-line no-console
    console.log(`TACKLE tap from the front at 2 m: NORMAL won ${normal.won}/${normal.tried}, LEGEND won ${legend.won}/${legend.tried}; fouls ${normal.fouls + legend.fouls}`);
    expect(normal.tried).toBeGreaterThanOrEqual(34);
    // (Before: 35% of taps in reach over whole matches.)
    expect(normal.won / normal.tried).toBeGreaterThanOrEqual(0.7);
    expect(legend.won / legend.tried).toBeGreaterThanOrEqual(0.6);
    // (A foul only when the carrier has turned his back by the time it goes in.)
    expect(normal.fouls + legend.fouls).toBeLessThanOrEqual(2);
  });

  it('the players\' stats move it only a little, and a foul is only ever through the back of the man', () => {
    const m = scenario(1);
    const p = m.players[6];
    const c = m.players[19];
    const stat = (def: number, drib: number) => {
      const pd = p.def.stats.defending;
      const cd = c.def.stats.dribbling;
      p.def.stats.defending = def;
      c.def.stats.dribbling = drib;
      const k = standingTackleChance(m, p, c, 0, 0, false);
      p.def.stats.defending = pd;
      c.def.stats.dribbling = cd;
      return k;
    };
    const worst = stat(30, 95);
    const best = stat(95, 30);
    expect(worst).toBeGreaterThanOrEqual(0.65);
    expect(best - worst).toBeLessThanOrEqual(0.25);
    // From behind it comes off far less often...
    expect(standingTackleChance(m, p, c, 1, 1, false)).toBeLessThan(standingTackleChance(m, p, c, 0, 0, false) * 0.6);
    // ...and only there can a miss be a foul.
    expect(standingFoulChance(0, 0)).toBe(0);
    expect(standingFoulChance(FOUL_BEHIND, 1)).toBe(0);
    expect(standingFoulChance(1, 0)).toBeGreaterThan(0.15);
  });

  it('every press is answered in a word: TACKLE!, MISTIMED, TOO FAR', () => {
    const seen = new Set<string>();
    let silent = 0;
    for (let s = 0; s < 30; s++) {
      for (const gap of [1.8, 2.4, TAP_CLOSE + 3, 14]) {
        const { m, p } = duel(4000 + s, gap, -1, gap > TAP_CLOSE ? 1 : -1, gap > TAP_CLOSE ? 6 : 3);
        const evs = steps(m, 75, tap);
        const cues = evs.filter((e) => e.type === 'tackleCue' && e.by === p.idx);
        for (const e of cues) if (e.type === 'tackleCue') seen.add(e.cue);
        // (A press that became a slide answers when the slide is over; a lost carrier, a pass away, ends the press.)
        const slid = evs.some((e) => e.type === 'tackleTry' && e.slide);
        const passed = evs.some((e) => e.type === 'kick' && m.players[e.player ?? 0].side === 1);
        if (!cues.length && !slid && !passed) silent++;
        if (gap > TAP_CLOSE) {
          expect(cues.some((e) => e.type === 'tackleCue' && e.cue === 'far')).toBe(true);
          expect(evs.some((e) => e.type === 'tackleTry')).toBe(false);
        }
      }
    }
    expect(seen.has('won')).toBe(true);
    expect(seen.has('mistimed')).toBe(true);
    expect(seen.has('far')).toBe(true);
    expect(silent).toBe(0);
  });

  it(`a miss costs him little: on his feet and able to go again ${MISS_COOLDOWN} s later`, () => {
    let missed = 0;
    for (let s = 0; s < 60 && missed < 6; s++) {
      const { m, p } = duel(5000 + s, 2, -1, -1, 3, 4);
      let at = -1;
      for (let i = 0; i < 60; i++) {
        m.step(DT, tap(i));
        for (const e of m.drainEvents()) if (e.type === 'tackleCue' && e.by === p.idx && e.cue === 'mistimed' && at < 0) at = i;
        if (at >= 0 && i === at) expect(p.tackleCooldown).toBeLessThanOrEqual(MISS_COOLDOWN);
        if (at >= 0 && i === at + 24) {
          // (0.4 s on: the jab is over, he is on the move and can go in again. It was 0.6 s, at 0.6 of his pace.)
          expect(p.state).toBe('move');
          expect(p.tackleCooldown).toBeLessThan(0.02);
          missed++;
        }
      }
    }
    expect(missed).toBeGreaterThan(0);
  });
});

describe('PRESS works with the thumb still on the stick', () => {
  it('held with the stick pushed at the carrier, he closes him down and jockeys goal-side; pulled away, he breaks off', () => {
    const run = (stick: 'at' | 'away') => {
      const { m, p, c } = duel(6000, 9, -1, -1, 3);
      const ad = m.attackDir(0);
      let pressed = 0;
      steps(m, 90, () => {
        const dx = m.ball.pos.x - p.pos.x;
        const dz = m.ball.pos.z - p.pos.z;
        const dl = Math.hypot(dx, dz) || 1;
        const k = stick === 'at' ? 1 : -1;
        return pad((dx / dl) * k, (dz / dl) * k, { through: true });
      }, () => {
        if (m.ctl[0].pressing) pressed++;
      });
      const owner = m.ball.owner >= 0 ? m.players[m.ball.owner] : c;
      return { pressed, d: Math.hypot(p.pos.x - owner.pos.x, p.pos.z - owner.pos.z), goalSide: (owner.pos.x - p.pos.x) * ad > -0.5, won: m.ball.owner === p.idx || m.possessionSide === 0 };
    };
    const at = run('at');
    const away = run('away');
    // (Before: PRESS did nothing unless the stick was let go.)
    expect(at.pressed).toBeGreaterThan(20);
    expect(at.won || (at.d < 3.2 && at.goalSide)).toBe(true);
    expect(away.pressed).toBe(0);
    expect(away.d).toBeGreaterThan(9);
  });

  it('a team-mate comes to press with him while it is held, and only then', () => {
    const helper = (press: boolean) => {
      const { m, p, c } = duel(6100, 2.5, -1, -1, 0);
      const mate = m.players[7];
      place(mate, c.pos.x - 7, 5);
      let helped = 0;
      steps(m, 40, () => {
        place(c, 0, 0);
        c.aiT = 1;
        giveBall(m, c, false);
        return pad(0, 0, { through: press });
      }, () => {
        const pr = m.brains[0].presser;
        if (pr >= 0 && pr !== p.idx) helped++;
      });
      return helped;
    };
    expect(helper(true)).toBeGreaterThan(20);
    expect(helper(false)).toBe(0);
  });
});

// ------------------------------------------------------------------ heavy

describe('less heavy', () => {
  it('a tap shot at a sprint leaves his foot within 0.2 s of the release', () => {
    const m = scenario(8);
    const p = m.players[9];
    place(p, 10, 0);
    p.facing = 0;
    giveBall(m, p);
    steps(m, 60, pad(1, 0));
    let at = -1;
    for (let i = 0; i < 60 && at < 0; i++) {
      m.step(DT, pad(1, 0, { shoot: i < 4 }));
      if (m.drainEvents().some((e) => e.type === 'kick')) at = i;
    }
    // (Released on step 4. Before: 0.23 s, the whole plant step on top of the wind-up.)
    expect(at).toBeGreaterThan(4);
    expect((at - 4) * DT).toBeLessThanOrEqual(0.2);
  });
});
