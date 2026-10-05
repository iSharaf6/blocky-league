import { describe, expect, it } from 'vitest';
import { decodeInput, encodeInput, quantizePad } from '../src/net/lockstep';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { GAP_MS, HAPTIC_FEEL, HapticGate, HEAVY_GAP_MS, hapticForEvent, MAX_PER_S } from '../src/platform/haptics';
import { DT, HALF_W } from '../src/sim/constants';
import { AUTO_SPRINT_OFF, AUTO_SPRINT_ON, KNOCK_TAP } from '../src/sim/dribble';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { PERFECT_SHIELD, SKILL_NAMES, SKILL_T, skillKind, startTell } from '../src/sim/skills';
import type { MatchEvent, SkillMoveKind } from '../src/sim/types';
import { HumanBot } from './humanBot';

/**
 * The owner on his iPhone (2026-10-03): "the players should be sprinting automatically on phone, the switch and press
 * button should be switched when not with the ball, skill when done perfectly always gets intercepted ... add more
 * skills too ... the dribbling is slow ... no haptic feedback". AUTO SPRINT, a PERFECT that keeps the ball, the new
 * moves, the quicker dribble, the haptics' choice and throttle, the pad on the wire.
 */

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
  m.ball.reset(p.footX(), p.footZ());
  m.ball.owner = p.idx;
  m.ball.lastTouch = p.idx;
  m.ball.lastTouchSide = p.side;
  m.active = p.idx;
  m.updateBallPath();
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

function steps(m: Match, n: number, pd: Pad | ((i: number) => Pad), evs: MatchEvent[] = []): MatchEvent[] {
  for (let i = 0; i < n; i++) {
    m.step(DT, typeof pd === 'function' ? pd(i) : pd);
    evs.push(...m.drainEvents());
  }
  return evs;
}

/** His man with the ball at x0, running along +x for `frames` with this pad. */
function carrier(m: Match, x0 = -20): Player {
  const p = m.players[9];
  place(p, x0, 0);
  p.facing = 0;
  giveBall(m, p);
  return p;
}

describe('AUTO SPRINT (touch)', () => {
  it('the stick pushed sprints, flat out from half way; a light push jogs; without it the stick never sprints', () => {
    const speed = (k: number, auto: boolean) => {
      const m = scenario(3);
      const p = carrier(m);
      steps(m, 90, pad(k, 0, { autoSprint: auto }));
      return { v: p.speed(), sprint: p.sprint, own: m.ball.owner === p.idx };
    };
    const full = speed(1, true);
    const half = speed(0.6, true);
    const light = speed(0.3, true);
    const off = speed(1, false);
    expect(full.sprint).toBe(true);
    expect(full.own).toBe(true);
    // (2026-10-04: there is no SPRINT button on touch. A thumb resting past half way is his full pace, not 60% of it.)
    expect(half.sprint).toBe(true);
    expect(half.v).toBeGreaterThan(full.v * 0.98);
    expect(light.sprint).toBe(false);
    expect(off.sprint).toBe(false);
    expect(full.v).toBeGreaterThan(off.v * 1.25);
    expect(light.v).toBeLessThan(off.v * 0.8);
  });

  it('has give at the edge: on past AUTO_SPRINT_ON, off only under AUTO_SPRINT_OFF', () => {
    const m = scenario(4);
    const p = carrier(m);
    const mid = (AUTO_SPRINT_ON + AUTO_SPRINT_OFF) / 2;
    steps(m, 2, pad(mid, 0, { autoSprint: true }));
    expect(p.sprint).toBe(false);
    steps(m, 2, pad(1, 0, { autoSprint: true }));
    expect(p.sprint).toBe(true);
    steps(m, 2, pad(mid, 0, { autoSprint: true }));
    expect(p.sprint).toBe(true);
    steps(m, 2, pad(AUTO_SPRINT_OFF - 0.05, 0, { autoSprint: true }));
    expect(p.sprint).toBe(false);
  });

  it("a thumb wobbling over the edge never knocks the ball on (that stays SPRINT's double tap)", () => {
    const m = scenario(5);
    const p = carrier(m);
    steps(m, 20, pad(1, 0, { autoSprint: true }));
    // In and out of a sprint every few frames, faster than KNOCK_TAP.
    const evs = steps(m, 60, (i) => pad(i % 6 < 3 ? 1 : 0.4, 0, { autoSprint: true }));
    expect(KNOCK_TAP).toBeGreaterThan(5 * DT);
    expect(m.ball.owner).toBe(p.idx);
    expect(evs.some((e) => e.type === 'kick')).toBe(false);
  });

  it('the human sprinting all half keeps his legs; the AI is unchanged', () => {
    const m = scenario(6);
    const p = carrier(m, -40);
    // Up and down the pitch at a sprint for a minute (two-minute halves: Player.fatigue 1.25).
    for (let i = 0; i < 60 * 60; i++) {
      const dir = Math.floor(i / 600) % 2 === 0 ? 1 : -1;
      m.step(DT, pad(dir, 0, { autoSprint: true }));
      m.drainEvents();
      if (m.ball.owner !== p.idx) giveBall(m, p);
    }
    expect(p.stamina).toBeGreaterThan(0.35);
  }, 60_000);
});

describe('SKILL: a PERFECT keeps the ball', () => {
  /** A defender squared up in front winds up a challenge; SKILL with this stick inside the window. */
  const perfect = (seed: number, stick: [number, number]) => {
    const m = scenario(seed);
    const p = carrier(m, -14);
    steps(m, 40, pad(1, 0));
    p.ballT = 2;
    m.drainEvents();
    const o = m.players[14];
    place(o, p.pos.x + 2.6, p.pos.z + 0.2);
    o.facing = Math.PI;
    startTell(m, o, p, false, true);
    const evs = steps(m, 6, pad(1, 0));
    steps(m, 1, pad(stick[0], stick[1], { skill: true }), evs);
    steps(m, Math.round(1.6 / DT), pad(1, 0), evs);
    const lost = evs.some((e) => (e.type === 'tackle' && e.won && e.by === o.idx) || (e.type === 'control' && e.player === o.idx));
    const mv = evs.find((e) => e.type === 'skillMove');
    return { lost, grade: mv && mv.type === 'skillMove' ? mv.grade : null, move: mv && mv.type === 'skillMove' ? mv.move : null, m, p };
  };

  it('the man who bit never wins it back off the move, whatever the stick picked (rainbow and nutmeg included)', () => {
    const sticks: [number, number][] = [[0, 1], [1, 0], [0, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7]];
    let n = 0;
    let lost = 0;
    const moves = new Set<string>();
    for (const st of sticks) {
      for (let s = 0; s < 6; s++) {
        const r = perfect(700 + s * 11, st);
        expect(r.grade).toBe('perfect');
        moves.add(r.move!);
        n++;
        if (r.lost) lost++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`PERFECT: lost to the man who bit ${lost}/${n} (${[...moves].join(', ')})`);
    expect(lost).toBe(0);
    expect(moves.has('nutmeg')).toBe(true);
    expect(moves.has('elastico')).toBe(true);
    expect(moves.has('heelchop')).toBe(true);
    expect(PERFECT_SHIELD).toBeGreaterThan(0.5);
  }, 120_000);

  it('the burst: out of a PERFECT he is away at a sprint', () => {
    const m = scenario(731);
    const p = carrier(m, -14);
    steps(m, 40, pad(1, 0));
    p.ballT = 2;
    const o = m.players[14];
    place(o, p.pos.x + 2.6, p.pos.z + 0.2);
    o.facing = Math.PI;
    startTell(m, o, p, false, true);
    steps(m, 6, pad(1, 0));
    steps(m, 1, pad(0, 1, { skill: true }));
    steps(m, Math.round(SKILL_T.roulette / DT) + 3, pad(1, 0));
    // (No SPRINT, no AUTO SPRINT: the PERFECT carries him on faster than his jog.)
    expect(p.burstT).toBeGreaterThan(0.5);
    expect(p.speed()).toBeGreaterThan(p.jogPace());
    expect(m.ball.owner).toBe(p.idx);
  });
});

describe('SKILL: the new moves', () => {
  it('the stick (and the moment) picks each one', () => {
    const k = (mx: number, mz: number, pace = 7, sq = false) => skillKind(1, 0, mx, mz, pace, sq).kind;
    expect(k(1, 0.2)).toBe('rainbow');
    expect(k(1, 0.2, 7, true)).toBe('nutmeg');
    expect(k(0.7, 0.7)).toBe('elastico');
    expect(k(0, 1)).toBe('roulette');
    expect(k(0, 1, 2)).toBe('croqueta');
    expect(k(-0.7, 0.7)).toBe('heelchop');
    expect(k(-1, 0.1)).toBe('dragback');
    expect(k(0, 0)).toBe('stepover');
    expect(k(0, 0, 0.5)).toBe('ballroll');
    // Each has a name for the pop (no hyphens: Silkscreen) and a length.
    for (const kind of ['elastico', 'croqueta', 'nutmeg', 'heelchop', 'ballroll'] as SkillMoveKind[]) {
      expect(SKILL_NAMES[kind]).toMatch(/^[A-Z ]+$/);
      expect(SKILL_T[kind]).toBeGreaterThan(0.2);
    }
  });

  it('ELASTICO slips him a metre and more to the side at pace; LA CROQUETA a metre from a jog; BALL ROLL standing', () => {
    const lateral = (stick: [number, number], frames: number, entry: number) => {
      const m = scenario(21);
      const p = carrier(m);
      steps(m, entry, pad(1, 0));
      const z0 = p.pos.z;
      const x0 = p.pos.x;
      steps(m, 1, pad(stick[0], stick[1], { skill: true }));
      steps(m, frames, EMPTY_PAD);
      return { dz: p.pos.z - z0, dx: p.pos.x - x0, own: m.ball.owner === p.idx, m, p };
    };
    const el = lateral([0.7, 0.7], Math.round(SKILL_T.elastico / DT), 40);
    expect(el.dz).toBeGreaterThan(1);
    expect(el.dx).toBeGreaterThan(1);
    expect(el.own).toBe(true);
    // From a slow jog (3 frames in), across: la croqueta.
    const cq = lateral([0, -1], Math.round(SKILL_T.croqueta / DT), 3);
    expect(cq.dz).toBeLessThan(-0.8);
    expect(cq.own).toBe(true);
  });

  it('HEEL CHOP turns him away at an angle at speed; NUTMEG puts it through a squared-up man and he comes round to it', () => {
    const m = scenario(31);
    const p = carrier(m);
    steps(m, 40, pad(1, 0));
    steps(m, 1, pad(-0.7, 0.7, { skill: true }));
    steps(m, Math.round(SKILL_T.heelchop / DT) + 4, pad(-0.7, 0.7));
    expect(p.vel.x).toBeLessThan(-1.5);
    expect(p.vel.z).toBeGreaterThan(1.5);
    expect(m.ball.owner).toBe(p.idx);

    let got = 0;
    for (let s = 0; s < 10; s++) {
      const n = scenario(40 + s);
      const q = carrier(n);
      steps(n, 40, pad(1, 0));
      q.ballT = 2;
      const o = n.players[14];
      place(o, q.pos.x + 2.4, q.pos.z + 0.15);
      o.facing = Math.PI;
      o.tackleCooldown = 0.2;
      startTell(n, o, q, false, true);
      const evs = steps(n, 5, pad(1, 0));
      steps(n, 1, pad(1, 0, { skill: true }), evs);
      expect(evs.find((e) => e.type === 'skillMove')).toMatchObject({ move: 'nutmeg', grade: 'perfect' });
      // Through him (it's past him and loose), then his again, beyond the man, within a second and a half.
      let through = false;
      for (let i = 0; i < 90; i++) {
        n.step(DT, EMPTY_PAD);
        const ev = n.drainEvents();
        if (n.ball.owner < 0 && n.ball.pos.x > o.pos.x) through = true;
        if (ev.some((e) => e.type === 'control' && e.player === q.idx)) {
          if (through && q.pos.x > o.pos.x) got++;
          break;
        }
      }
    }
    expect(got).toBeGreaterThanOrEqual(9);
  });
});

describe('SKILL: the RAINBOW FLICK does what a rainbow flick does', () => {
  /**
   * The owner (2026-10-03): "rainbow flick is basically failing dosnt go over the player goes back". A man in its lane (side
   * on, or off the line: not squared up, which would be a nutmeg), the dribbler jogging or sprinting with the stick ahead,
   * timed (PERFECT) or not: up over the man, down a few metres beyond him along the run, never back, and his again before
   * anyone of theirs touches it.
   */
  const flickOver = (seed: number, perfect: boolean, sprint: boolean, lat: number, dist: number) => {
    const m = scenario(seed);
    const p = carrier(m, -20);
    const run = pad(1, 0, { autoSprint: sprint });
    steps(m, 40, run);
    p.ballT = 2;
    m.drainEvents();
    const o = m.players[14];
    place(o, p.pos.x + dist, p.pos.z + lat);
    o.facing = Math.abs(lat) > 1 ? Math.PI : Math.PI / 2;
    if (perfect) {
      startTell(m, o, p, false, true);
      steps(m, 4, run);
      // (Winding up a real challenge he turns to face the ball, and a man squared up in front is a NUTMEG: kept
      // side-on here, as he was placed, because this is the flick's test.)
      o.facing = Math.abs(lat) > 1 ? Math.PI : Math.PI / 2;
    }
    const evs = steps(m, 1, pad(1, 0, { skill: true, autoSprint: sprint }));
    const x0 = m.ball.pos.x;
    let overY = -1;
    let backwards = false;
    let land = NaN;
    let got = false;
    let theirs = false;
    for (let i = 0; i < 150 && !got && !theirs; i++) {
      m.step(DT, run);
      for (const e of m.drainEvents()) {
        if (e.type === 'control' && e.player === p.idx) got = true;
        else if ((e.type === 'control' && m.players[e.player].side === 1) || (e.type === 'tackle' && e.won && m.players[e.by].side === 1)) theirs = true;
      }
      const b = m.ball;
      if (b.owner < 0 && b.vel.x < -0.2) backwards = true;
      if (overY < 0 && b.owner < 0 && b.pos.x >= o.pos.x) overY = b.pos.y;
      if (Number.isNaN(land) && b.owner < 0 && b.pos.y < 0.35 && b.vel.y < 0 && b.pos.x - x0 > 1) land = b.pos.x - o.pos.x;
    }
    const mv = evs.find((e) => e.type === 'skillMove');
    return { move: mv && mv.type === 'skillMove' ? mv.move : '', overY, backwards, land, got, theirs };
  };

  it('goes up over the man, comes down beyond him, and is his again: always when timed, and with no tell too', () => {
    const rows: string[] = [];
    for (const perfect of [true, false]) {
      for (const sprint of [false, true]) {
        for (const [lat, dist] of [[1.15, 2.6], [-1.15, 2.6], [0.3, 2.4], [0.3, 3.6]] as [number, number][]) {
          const r = flickOver(600 + Math.round(lat * 10) + dist * 7 + (sprint ? 3 : 0), perfect, sprint, lat, dist);
          rows.push(`${perfect ? 'PERFECT' : 'untimed'} ${sprint ? 'sprint' : 'jog'} man ${dist} m (${lat}): ${r.move} over ${r.overY.toFixed(2)} m, down ${r.land.toFixed(1)} m beyond him, his again ${r.got}`);
          expect(r.move).toBe('rainbow');
          expect(r.backwards).toBe(false);
          expect(r.got).toBe(true);
          expect(r.theirs).toBe(false);
          // (Over his head where it crosses his line, unless he stood to the side of it.)
          if (Math.abs(lat) < 1) expect(r.overY).toBeGreaterThan(2.3);
          if (!Number.isNaN(r.land)) {
            expect(r.land).toBeGreaterThan(1.5);
            expect(r.land).toBeLessThan(6);
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(rows.join('\n'));
  }, 120_000);

  it('with nobody in front the stick along his run is a BURST, the ball kept; a flick near a touchline stays in play', () => {
    // (It was a rainbow flick over nobody: the casual thumb, still pushing the way he ran, got that every time.)
    const m = scenario(77);
    const p = carrier(m, -20);
    steps(m, 40, pad(1, 0));
    const jog = p.speed();
    const evs = steps(m, 1, pad(1, 0, { skill: true }));
    let top = 0;
    for (let i = 0; i < 40; i++) {
      m.step(DT, pad(1, 0));
      evs.push(...m.drainEvents());
      top = Math.max(top, m.ball.pos.y);
    }
    const mv = evs.find((e) => e.type === 'skillMove');
    expect(mv && mv.type === 'skillMove' ? mv.move : '').toBe('boost');
    expect(top).toBeLessThan(0.6);
    expect(m.ball.owner).toBe(p.idx);
    expect(p.speed()).toBeGreaterThan(jog + 1.5);
    // Running at the touchline with a man in the way: the flick over him is shortened to land inside it.
    const n = scenario(78);
    const q = n.players[9];
    place(q, -20, HALF_W - 8);
    q.facing = Math.PI / 2;
    giveBall(n, q);
    const o = n.players[14];
    // Across the rainbow's lane, outside the narrower squared-up nutmeg lane.
    place(o, -18.8, HALF_W - 3.2);
    o.facing = -Math.PI / 2;
    o.tackleCooldown = 9;
    steps(n, 20, pad(0, 1));
    const flicked = steps(n, 1, pad(0, 1, { skill: true })).find((e) => e.type === 'skillMove');
    expect(flicked && flicked.type === 'skillMove' ? flicked.move : '').toBe('rainbow');
    // (Until it's his again: after that he's the one running it out.)
    let maxZ = 0;
    let his = false;
    for (let i = 0; i < 120 && !his; i++) {
      n.step(DT, pad(0, 1));
      his = n.drainEvents().some((e) => e.type === 'control' && e.player === q.idx);
      maxZ = Math.max(maxZ, n.ball.pos.z);
    }
    expect(his).toBe(true);
    expect(maxZ).toBeLessThan(HALF_W - 2);
    expect(n.phase).toBe('play');
  }, 60_000);
});

describe('the pad on the wire', () => {
  it('AUTO SPRINT survives quantising and the packet', () => {
    const p: Pad = { ...EMPTY_PAD, mx: 0.9, mz: 0.1, autoSprint: true, skill: true };
    expect(quantizePad(p).autoSprint).toBe(true);
    expect(quantizePad({ ...p, autoSprint: false }).autoSprint).toBe(false);
    const back = decodeInput(encodeInput({ epoch: 1, first: 10, ack: 5, tick: 11, pads: [p, { ...p, autoSprint: false }] }))!;
    expect(back.pads.map((x) => x.autoSprint)).toEqual([true, false]);
    expect(back.pads[0].skill).toBe(true);
  });
});

describe('haptics', () => {
  it('buzzes for his own pass and shot, a timed finish, his tackles and skills, goals both ways, the woodwork, his keeper, the whistles; not for the AI', () => {
    const m = scenario(51);
    const p = carrier(m);
    const them = m.players[14];
    const kick = (kind: 'pass' | 'shot', player: number) => ({ type: 'kick' as const, power: 0.5, x: 0, y: 0, z: 0, kind, player });
    expect(hapticForEvent(kick('pass', p.idx), m, 0, -1)).toBe('pass');
    expect(hapticForEvent(kick('shot', p.idx), m, 0, -1)).toBe('shot');
    expect(hapticForEvent(kick('shot', them.idx), m, 0, -1)).toBe(null);
    expect(hapticForEvent(kick('pass', 8), m, 0, -1)).toBe(null);
    expect(hapticForEvent({ type: 'timing', player: p.idx, grade: 'perfect' }, m, 0, -1)).toBe('finish');
    expect(hapticForEvent({ type: 'timing', player: p.idx, grade: 'late' }, m, 0, -1)).toBe(null);
    expect(hapticForEvent({ type: 'tackle', by: p.idx, won: true, slide: false }, m, 0, -1)).toBe('tackle');
    expect(hapticForEvent({ type: 'tackle', by: them.idx, won: true, slide: false }, m, 0, p.idx)).toBe('tackle');
    expect(hapticForEvent({ type: 'tackle', by: them.idx, won: true, slide: false }, m, 0, 8)).toBe(null);
    expect(hapticForEvent({ type: 'skillMove', player: p.idx, move: 'nutmeg', grade: 'perfect', combo: 1, on: them.idx }, m, 0, -1)).toBe('perfect');
    expect(hapticForEvent({ type: 'skillMove', player: p.idx, move: 'roulette', grade: 'show', combo: 1, on: -1 }, m, 0, -1)).toBe(null);
    expect(hapticForEvent({ type: 'goal', side: 0, scorer: p.idx, own: false }, m, 0, -1)).toBe('goal');
    expect(hapticForEvent({ type: 'goal', side: 1, scorer: them.idx, own: false }, m, 0, -1)).toBe('concede');
    expect(hapticForEvent({ type: 'post', x: 0, y: 1, z: 0, speed: 20 }, m, 0, -1)).toBe('post');
    expect(hapticForEvent({ type: 'save', keeper: 0, caught: true }, m, 0, -1)).toBe('save');
    expect(hapticForEvent({ type: 'save', keeper: 11, caught: true }, m, 0, -1)).toBe(null);
    // Only the half-time and full-time whistles; full time won is a win.
    expect(hapticForEvent({ type: 'whistle', kind: 'short' }, m, 0, -1)).toBe(null);
    expect(hapticForEvent({ type: 'halftime' }, m, 0, -1)).toBe('whistle');
    expect(hapticForEvent({ type: 'fulltime' }, m, 0, -1)).toBe('whistle');
    m.score = [2, 1];
    expect(hapticForEvent({ type: 'fulltime' }, m, 0, -1)).toBe('win');
    expect(hapticForEvent({ type: 'shootoutEnd', winner: 0 }, m, 0, -1)).toBe('win');
    expect(hapticForEvent({ type: 'shootoutEnd', winner: 1 }, m, 0, -1)).toBe(null);
  });

  it('never annoying: a gap after each tap, one heavy per HEAVY_GAP_MS, a cap a second; LIGHT keeps only the big moments', () => {
    const g = new HapticGate();
    expect(g.allow('pass', 0)).toBe(true);
    expect(g.allow('pass', 50)).toBe(false);
    expect(g.allow('whistle', GAP_MS - 10)).toBe(false);
    // A stronger one cuts in.
    expect(g.allow('tackle', GAP_MS - 10)).toBe(true);
    let n = 0;
    for (let t = 1000; t < 2000; t += 10) if (g.allow((['pass', 'shot', 'skill', 'camera'] as const)[(t / 10) % 4], t)) n++;
    expect(n).toBeLessThanOrEqual(MAX_PER_S);
    // The big ones always get through the per-second cap, but never two heavies within HEAVY_GAP_MS.
    expect(g.allow('goal', 1995)).toBe(true);
    expect(g.allow('success', 1995 + HEAVY_GAP_MS - 50)).toBe(false);
    expect(g.allow('success', 1995 + HEAVY_GAP_MS + 10)).toBe(true);
    // LIGHT: goals, wins and rewards only; OFF: nothing.
    const l = new HapticGate();
    expect(l.allow('pass', 0, 'light')).toBe(false);
    expect(l.allow('tackle', 200, 'light')).toBe(false);
    expect(l.allow('goal', 400, 'light')).toBe(true);
    expect(new HapticGate().allow('goal', 0, 'off')).toBe(false);
    for (const k of ['goal', 'win', 'success', 'concede'] as const) expect(HAPTIC_FEEL[k].big).toBe(true);
    for (const k of ['tap', 'pass', 'shot', 'tackle', 'skill', 'camera', 'whistle'] as const) expect(HAPTIC_FEEL[k].big).toBe(false);
  });

  it('button acknowledgements and action contacts never throttle each other', () => {
    const g = new HapticGate();
    expect(g.allow('button', 0)).toBe(true);
    expect(g.allow('pass', 1)).toBe(true);
    expect(g.allow('button', 20)).toBe(false);
    expect(g.allow('button', 41)).toBe(true);
    expect(g.allow('tackle', 42)).toBe(true);
    expect(g.allow('button', 81)).toBe(true);
    expect(g.allow('button', 121)).toBe(true);
    expect(g.allow('pass', 142)).toBe(true);
    expect(new HapticGate().allow('button', 0, 'light')).toBe(false);
    expect(new HapticGate().allow('button', 0, 'off')).toBe(false);
  });
});

describe('whole matches, played like a person on a phone', () => {
  /**
   * The casual touch player (tests/humanBot.ts `casual`: slower decisions, rougher passes, shots from anywhere near the
   * box, AUTO SPRINT, answering three tells in five and later, the thumb still pushing ahead half the time) over whole
   * matches on NORMAL. (The full measurement, N=24 a level, is in the round's report: before this work he scored 0.88 a
   * match and a PERFECT was lost to the man who bit one time in ten.)
   */
  it('he scores, wins more than he loses, and a PERFECT is never lost to the man who bit', () => {
    let gf = 0;
    let ga = 0;
    let perfect = 0;
    let lostToHim = 0;
    const N = 4;
    for (let i = 0; i < N; i++) {
      const m = new Match({
        home: makeTeam(PRESET_CLUBS[3 + i]), away: makeTeam(PRESET_CLUBS[4 + i]), halfLength: 90, difficulty: 1.8, humanSide: 0, seed: 900 + i * 31,
      });
      const bot = new HumanBot(900 + i * 31, { casual: true, sprint: 'auto', skills: 'react' });
      const open: { f: number; on: number }[] = [];
      for (let f = 0; m.phase !== 'fulltime' && f < 60 * 60 * 10; f++) {
        const before = m.ball.owner;
        m.step(DT, bot.pad(m));
        const evs = m.drainEvents();
        bot.observe(m, evs, before);
        for (const e of evs) {
          if (e.type === 'skillMove' && e.grade === 'perfect' && e.on >= 0) {
            perfect++;
            open.push({ f, on: e.on });
          }
          const by = e.type === 'tackle' && e.won ? e.by : e.type === 'control' ? e.player : -1;
          if (by >= 0) for (const o of open) if (o.on === by && f - o.f <= 90) lostToHim++;
        }
        while (open.length && f - open[0].f > 90) open.shift();
        if (m.phase === 'halftime') m.continueSecondHalf();
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
      }
      gf += m.score[0];
      ga += m.score[1];
    }
    // eslint-disable-next-line no-console
    console.log(`casual touch player, NORMAL, ${N} matches: ${gf}-${ga}, PERFECTs ${perfect}, lost to the man who bit ${lostToHim}`);
    expect(gf).toBeGreaterThan(ga);
    expect(gf / N).toBeGreaterThanOrEqual(1);
    expect(perfect).toBeGreaterThan(5);
    expect(lostToHim).toBe(0);
  }, 600_000);
});
