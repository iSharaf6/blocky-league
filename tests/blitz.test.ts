import { describe, expect, it } from 'vitest';
import { hashString } from '../src/core/rng';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { Ball } from '../src/sim/ball';
import { CONTROL_R, DT, GOAL_H, GRAVITY, HALF_L, HALF_W } from '../src/sim/constants';
import * as B from '../src/sim/blitz';
import { EMPTY_PAD, Match, type MatchConfig, type Pad } from '../src/sim/match';
import { Player } from '../src/sim/player';
import type { MatchEvent, Side } from '../src/sim/types';

function mk(cfg: Partial<MatchConfig> = {}, seed = 7, homeIdx = 5, awayIdx = 6): Match {
  return new Match({
    home: makeTeam(PRESET_CLUBS[homeIdx]),
    away: makeTeam(PRESET_CLUBS[awayIdx]),
    halfLength: 150,
    difficulty: 2,
    humanSide: -1,
    seed,
    ...cfg,
  });
}

interface Spawn { id: number; kind: string; x: number; z: number; playT: number; half: number; ballD: number }

interface Run { m: Match; events: MatchEvent[]; at: number[]; kinds: Record<string, number>; spawns: Spawn[]; playT: number; maxOnPitch: number }

/** Plays `m` to the final whistle (AI vs AI, or with a constant pad), collecting every event. */
function play(m: Match, pad: Pad = EMPTY_PAD, onStep?: (m: Match) => void): Run {
  const events: MatchEvent[] = [];
  const at: number[] = [];
  const kinds: Record<string, number> = {};
  const spawns: Spawn[] = [];
  let playT = 0;
  let steps = 0;
  let maxOnPitch = 0;
  while (m.phase !== 'fulltime' && steps < 60 * 60 * 14) {
    const bx = m.ball.pos.x;
    const bz = m.ball.pos.z;
    m.step(DT, pad);
    steps++;
    if (m.phase === 'play') playT += DT;
    maxOnPitch = Math.max(maxOnPitch, m.powerups.length);
    for (const e of m.drainEvents()) {
      events.push(e);
      at.push(steps);
      kinds[e.type] = (kinds[e.type] ?? 0) + 1;
      if (e.type === 'powerupSpawn') spawns.push({ id: e.id, kind: e.kind, x: e.x, z: e.z, playT, half: m.half, ballD: Math.hypot(e.x - bx, e.z - bz) });
    }
    onStep?.(m);
    if (m.phase === 'halftime') m.continueSecondHalf();
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  return { m, events, at, kinds, spawns, playT, maxOnPitch };
}

/** A hash of the end state: score, clock, ball, every player, the stats. */
function endHash(m: Match): number {
  const v: number[] = [m.score[0], m.score[1], m.clock, m.half, m.kickId, m.ball.pos.x, m.ball.pos.y, m.ball.pos.z, m.ball.vel.x, m.ball.vel.z];
  for (const p of m.players) v.push(p.pos.x, p.pos.z, p.vel.x, p.vel.z, p.facing, p.stamina);
  for (const pair of Object.values(m.stats)) v.push(pair[0], pair[1]);
  return hashString(v.map((x) => x.toFixed(6)).join(','));
}

/** Steps `m` until the ball is live in open play. */
function toPlay(m: Match): void {
  for (let i = 0; i < 60 * 20 && m.phase !== 'play'; i++) m.step(DT, EMPTY_PAD);
  expect(m.phase).toBe('play');
}

/** Puts `c` on the ball at (x, z) with `p` a metre away facing him, ready to tackle. */
function faceOff(m: Match, c: Player, p: Player, x: number, z: number): void {
  c.pos.x = x;
  c.pos.z = z;
  c.vel.x = c.vel.z = 0;
  c.facing = 0;
  c.setState('move');
  p.pos.x = x + 1.0;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.facing = Math.PI;
  p.setState('move');
  p.tackleCooldown = 0;
  m.ball.owner = c.idx;
  m.ball.held = false;
  m.ball.pos.x = c.footX();
  m.ball.pos.z = c.footZ();
  m.ball.pos.y = 0.22;
}

const POWER_EVENTS = new Set(['powerupSpawn', 'powerupTaken', 'powerupUsed', 'powerupEnd']);

describe('blitz mode: classic untouched', () => {
  it('classic (mode unset or "classic") is bit-identical and never touches a power-up', () => {
    const a = play(mk({}, 31));
    const b = play(mk({ mode: 'classic' }, 31));
    expect(endHash(a.m)).toBe(endHash(b.m));
    expect(a.kinds).toEqual(b.kinds);
    for (const r of [a, b]) {
      expect(r.m.phase).toBe('fulltime');
      expect(r.events.some((e) => POWER_EVENTS.has(e.type))).toBe(false);
      expect(r.m.powerups).toEqual([]);
      expect(r.m.heldPower).toEqual([null, null]);
      for (const p of r.m.players) {
        expect(p.boost).toBeNull();
        expect(p.boostT).toBe(0);
      }
    }
  }, 30_000);
});

describe('blitz mode: pickups', () => {
  it('spawns in open play every 12-20 s, in the field of play, clear of both six-yard boxes and the ball', () => {
    const r = play(mk({ mode: 'blitz' }, 7));
    expect(r.m.phase).toBe('fulltime');
    expect(r.spawns.length).toBeGreaterThanOrEqual(8);
    expect(r.maxOnPitch).toBeLessThanOrEqual(B.MAX_PICKUPS);
    for (const s of r.spawns) {
      expect(B.inSixYardBox(s.x, s.z)).toBe(false);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(HALF_L - B.SPAWN_MARGIN + 1e-9);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(HALF_W - B.SPAWN_MARGIN + 1e-9);
      expect(s.ballD).toBeGreaterThanOrEqual(Math.min(B.SPAWN_AHEAD[0], B.SPAWN_LOOSE[0]) - 0.7);
    }
    for (let i = 1; i < r.spawns.length; i++) {
      const prev = r.spawns[i - 1];
      const cur = r.spawns[i];
      if (cur.half !== prev.half) continue; // the second half starts its own clock
      const gap = cur.playT - prev.playT;
      expect(gap).toBeGreaterThanOrEqual(B.SPAWN_MIN - 0.1);
      expect(gap).toBeLessThanOrEqual(B.SPAWN_MAX + 2);
    }
    // Every spawn is a distinct id and the render sees each one on the pitch at some point.
    expect(new Set(r.spawns.map((s) => s.id)).size).toBe(r.spawns.length);
  }, 30_000);

  it('goes to the side of the man who runs over it (a side already holding one uses it first)', () => {
    const m = mk({ mode: 'blitz' }, 3);
    toPlay(m);
    const k = m.keeperOf(0)!;
    m.heldPower[0] = 'turbo';
    m.powerups.push({ id: 999, kind: 'shield', x: k.pos.x + 0.3, z: k.pos.z, t: 0 });
    m.step(DT, EMPTY_PAD);
    // Holding turbo, his side leaves the cube where it is (an AI side uses what it has first).
    expect(m.drainEvents().some((e) => e.type === 'powerupTaken')).toBe(false);
    expect(m.heldPower[0]).toBe('turbo');
    expect(m.powerups.some((p) => p.id === 999)).toBe(true);
    m.heldPower[0] = null;
    m.step(DT, EMPTY_PAD);
    const taken = m.drainEvents().find((e) => e.type === 'powerupTaken');
    expect(taken).toEqual({ type: 'powerupTaken', id: 999, kind: 'shield', player: k.idx, side: 0 });
    expect(m.heldPower[0]).toBe('shield');
    expect(m.powerups.some((p) => p.id === 999)).toBe(false);
  });

  it('fades after PICKUP_LIFE seconds untouched', () => {
    const m = mk({ mode: 'blitz' }, 3);
    toPlay(m);
    m.powerups.push({ id: 998, kind: 'mega', x: 0, z: HALF_W - 4.5, t: 0 }); // (by the far touchline: nobody there)
    for (let i = 0; i < Math.round((B.PICKUP_LIFE - 0.5) / DT) && m.phase === 'play'; i++) B.blitzStep(m, DT, EMPTY_PAD);
    expect(m.powerups.some((p) => p.id === 998)).toBe(true);
    for (let i = 0; i < 60; i++) B.blitzStep(m, DT, EMPTY_PAD);
    expect(m.powerups.some((p) => p.id === 998)).toBe(false);
  });
});

describe('blitz mode: effects', () => {
  const def = makeTeam(PRESET_CLUBS[5]).players[3];

  function sprintFor(boost: Player['boost'], seconds = 1.5): number {
    const p = new Player(0, 0, 3, def);
    p.boost = boost;
    p.wantX = 1;
    p.sprint = true;
    for (let i = 0; i < Math.round(seconds / DT); i++) p.step(DT, false);
    return p.speed();
  }

  it('turbo: +30% top speed; freeze: 45% of it', () => {
    const base = sprintFor(null);
    expect(sprintFor('turbo') / base).toBeCloseTo(B.TURBO_PACE, 2);
    expect(sprintFor('freeze') / base).toBeCloseTo(B.FREEZE_PACE, 2);
    expect(sprintFor('shield')).toBeCloseTo(base, 6);
    // Turbo accelerates harder too: further along after the first few strides.
    const dist = (boost: Player['boost']) => {
      const p = new Player(0, 0, 3, def);
      p.boost = boost;
      p.wantX = 1;
      p.sprint = true;
      for (let i = 0; i < 15; i++) p.step(DT, false);
      return p.pos.x;
    };
    expect(dist('turbo')).toBeGreaterThan(dist(null) * 1.2);
    expect(dist('freeze')).toBeLessThan(dist(null) * 0.6);
  });

  it('magnet: a bigger control radius', () => {
    const p = new Player(0, 0, 3, def);
    const base = p.controlRadius();
    expect(base).toBeGreaterThanOrEqual(CONTROL_R);
    p.boost = 'magnet';
    expect(p.controlRadius()).toBe(B.MAGNET_CONTROL_R);
    expect(p.controlRadius()).toBeGreaterThan(base + 0.3);
  });

  it('using an item: a press in open play, once, and it shows on the side (the opponents for freeze)', () => {
    const m = mk({ mode: 'blitz', humanSide: 0 }, 5);
    toPlay(m);
    m.heldPower[0] = 'turbo';
    m.heldPower[1] = 'freeze';
    const pad: Pad = { ...EMPTY_PAD, power: true };
    m.step(DT, pad);
    m.step(DT, pad); // held down: no second use
    const used = m.drainEvents().filter((e) => e.type === 'powerupUsed');
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ type: 'powerupUsed', kind: 'turbo', side: 0 });
    expect(m.heldPower[0]).toBeNull();
    expect(B.effectLeft(m, 0, 'turbo')).toBeGreaterThan(B.DURATION.turbo - 0.1);
    for (const p of m.players) {
      if (p.side === 0) expect(p.boost).toBe('turbo');
    }
    // The AI's freeze (used by policy) shows on OUR men and outranks turbo.
    expect(B.usePower(m, 1, m.teamPlayers(1)[5].idx)).toBe(true);
    for (const p of m.players) expect(p.boost).toBe(p.side === 0 ? 'freeze' : null);
    // Nothing held, nothing happens.
    expect(B.usePower(m, 1, 0)).toBe(false);
  });

  it('turbo wears off after DURATION s with a powerupEnd', () => {
    const m = mk({ mode: 'blitz' }, 5);
    toPlay(m);
    m.heldPower[1] = 'turbo';
    B.usePower(m, 1, m.teamPlayers(1)[4].idx);
    let ended: MatchEvent | undefined;
    for (let i = 0; i < 60 * 6 && !ended; i++) {
      B.blitzStep(m, DT, EMPTY_PAD);
      ended = m.events.find((e) => e.type === 'powerupEnd' && e.kind === 'turbo');
      if (m.phase !== 'play') m.phase = 'play';
    }
    expect(ended).toMatchObject({ type: 'powerupEnd', kind: 'turbo', side: 1, player: m.teamPlayers(1)[4].idx });
    expect(B.effectLeft(m, 1, 'turbo')).toBe(0);
    for (const p of m.players) expect(p.boost).toBeNull();
  });

  it('shield: challenges bounce off the carrier, nobody slides in, no foul', () => {
    const m = mk({ mode: 'blitz' }, 9);
    toPlay(m);
    const c = m.teamPlayers(0)[5];
    const p = m.teamPlayers(1)[5];
    m.heldPower[0] = 'shield';
    expect(B.usePower(m, 0, c.idx)).toBe(true);
    m.drainEvents();
    for (let i = 0; i < 40; i++) {
      faceOff(m, c, p, 0, 5);
      m.tryTackle(p, c, 1);
      expect(m.ball.owner).toBe(c.idx);
      expect(p.stumbleT).toBeGreaterThan(0);
    }
    const ev = m.drainEvents();
    expect(ev.some((e) => e.type === 'tackle' && e.won)).toBe(false);
    expect(ev.some((e) => e.type === 'foul')).toBe(false);
    expect(ev.filter((e) => e.type === 'tackle' && !e.won).length).toBe(40);
    faceOff(m, c, p, 0, 5);
    m.startSlide(p);
    expect(p.state).toBe('move');
    // The same setup without the shield: the tackler does win some.
    const m2 = mk({ mode: 'blitz' }, 9);
    toPlay(m2);
    const c2 = m2.teamPlayers(0)[5];
    const p2 = m2.teamPlayers(1)[5];
    let won = 0;
    for (let i = 0; i < 40; i++) {
      faceOff(m2, c2, p2, 0, 5);
      m2.tryTackle(p2, c2, 1);
      if (m2.ball.owner !== c2.idx) won++;
    }
    expect(won).toBeGreaterThan(0);
    faceOff(m2, c2, p2, 0, 5); // (a won poke leaves him in the kick pose: back on his feet first)
    m2.startSlide(p2);
    expect(p2.state).toBe('slide');
  });

  it('freeze: the other side cannot tackle or slide while frozen', () => {
    const m = mk({ mode: 'blitz' }, 9);
    toPlay(m);
    const c = m.teamPlayers(1)[5]; // their carrier
    const p = m.teamPlayers(0)[5]; // our frozen man
    m.heldPower[1] = 'freeze';
    B.usePower(m, 1, c.idx);
    for (const q of m.players) expect(q.boost).toBe(q.side === 0 ? 'freeze' : null);
    m.drainEvents();
    for (let i = 0; i < 40; i++) {
      faceOff(m, c, p, 0, -5);
      m.tryTackle(p, c, 1);
      expect(m.ball.owner).toBe(c.idx);
    }
    expect(m.drainEvents().some((e) => e.type === 'tackle' && e.won)).toBe(false);
    faceOff(m, c, p, 0, -5);
    m.startSlide(p);
    expect(p.state).toBe('move');
    // The freezing side itself is free to tackle.
    expect(B.blitzNoSlide(m, c)).toBe(false);
  });

  it('mega: the next open-play shot is a rocket (x1.5, flat, half the curl), never a free kick or a pass', () => {
    const m = mk({ mode: 'blitz' }, 4);
    toPlay(m);
    const p = m.teamPlayers(0)[9];
    const ad = m.attackDir(0);
    const gx = ad * HALF_L;
    m.ball.pos.x = gx - ad * 14;
    m.ball.pos.z = 0;
    m.ball.pos.y = 0.22;
    const launch = () => ({
      vx: ad * 20, vy: 2.5, vz: 0.5, spinX: 0, spinY: 2, spinZ: 0, target: -1, kind: 'shot' as const, power: 0.8,
      aim: { gx, z: 2, errZ: 1, h: 1.0, errH: 0.6 },
    });
    // Not armed: untouched.
    const L0 = launch();
    B.megaLaunch(m, p, L0);
    expect(L0).toEqual(launch());
    m.heldPower[0] = 'mega';
    B.usePower(m, 0, p.idx);
    expect(p.boost).toBe('mega');
    // The telegraph: for MEGA_TELEGRAPH s after the press the ball is red-hot but a shot is still an ordinary one.
    const Lt = launch();
    B.megaLaunch(m, p, Lt);
    expect(Lt).toEqual(launch());
    for (let i = 0; i < Math.ceil(B.MEGA_TELEGRAPH / DT) + 1; i++) B.blitzStep(m, DT, EMPTY_PAD);
    expect(p.boost).toBe('mega');
    // A free kick (dead ball) is never a rocket.
    m.phase = 'restart';
    const L1 = launch();
    B.megaLaunch(m, p, L1);
    expect(L1).toEqual(launch());
    expect(B.effectLeft(m, 0, 'mega')).toBeGreaterThan(0);
    m.phase = 'play';
    // A pass isn't either.
    const L2 = { ...launch(), kind: 'pass' as const };
    B.megaLaunch(m, p, L2);
    expect(L2.vx).toBe(ad * 20);
    // The shot.
    const L = launch();
    m.drainEvents();
    B.megaLaunch(m, p, L);
    expect(Math.hypot(L.vx, L.vz)).toBeCloseTo(Math.hypot(20, 0.5) * B.MEGA_PACE, 5);
    // Aimed at the intended spot with half the error: z = 2 + 1 x 0.5.
    expect(Math.atan2(L.vz, L.vx)).toBeCloseTo(Math.atan2(2.5, gx - m.ball.pos.x), 5);
    expect(L.spinY).toBe(1);
    // Flat: less lift than the ordinary-pace solve for the same spot needs, and it crosses the line at the
    // intended height (the aim's 1.0 m plus half its 0.6 m error), under the bar, into the goal, on the real ball physics.
    const dl = Math.hypot(gx - m.ball.pos.x, 2.5);
    const plain = (sp: number) => {
      const t = dl / (sp * 0.9);
      return (1.3 - m.ball.pos.y + 0.5 * GRAVITY * t * t) / t;
    };
    expect(L.vy).toBeLessThan(plain(Math.hypot(20, 0.5)));
    expect(L.vy).toBeCloseTo(plain(Math.hypot(L.vx, L.vz)), 5);
    const fly = new Ball();
    fly.reset(m.ball.pos.x, m.ball.pos.z);
    fly.pos.y = m.ball.pos.y;
    fly.vel.x = L.vx;
    fly.vel.y = L.vy;
    fly.vel.z = L.vz;
    fly.spin.y = L.spinY;
    let crossY = -1;
    for (let i = 0; i < 240 && fly.inGoal === 0; i++) {
      fly.step(DT, []);
      if (crossY < 0 && Math.abs(fly.pos.x) >= HALF_L) crossY = fly.pos.y;
    }
    expect(fly.inGoal).toBe(ad);
    expect(crossY).toBeGreaterThan(0.5);
    expect(crossY).toBeLessThan(GOAL_H - 0.3);
    expect(B.effectLeft(m, 0, 'mega')).toBe(0);
    expect(m.drainEvents()).toContainEqual({ type: 'powerupEnd', kind: 'mega', player: p.idx, side: 0 });
    expect(p.boost).toBeNull();
    // It's the live shot for the keeper's hands once the match counts the kick.
    expect(B.blitzState(m).megaKick[0]).toBe(m.kickId + 1);
    // A whole-sim rocket: the ball leaves faster than any ordinary strike.
    const m2 = mk({ mode: 'blitz' }, 4);
    toPlay(m2);
    const s2 = m2.teamPlayers(0)[9];
    const ad2 = m2.attackDir(0);
    s2.pos.x = ad2 * (HALF_L - 15);
    s2.pos.z = 1;
    s2.vel.x = s2.vel.z = 0;
    s2.facing = ad2 > 0 ? 0 : Math.PI;
    s2.setState('move');
    m2.ball.owner = s2.idx;
    m2.ball.held = false;
    m2.ball.pos.x = s2.footX();
    m2.ball.pos.z = s2.footZ();
    m2.ball.pos.y = 0.22;
    m2.heldPower[0] = 'mega';
    B.usePower(m2, 0, s2.idx);
    // (Past the telegraph: the rocket is live.)
    for (let i = 0; i < Math.ceil(B.MEGA_TELEGRAPH / DT) + 1; i++) B.blitzStep(m2, DT, EMPTY_PAD);
    expect(m2.order(s2, 'shot', ad2, 0, 0.9, -1, false)).not.toBeNull();
    let speed = 0;
    for (let i = 0; i < 30 && speed === 0; i++) {
      m2.step(DT, EMPTY_PAD);
      if (m2.drainEvents().some((e) => e.type === 'kick' && e.kind === 'shot')) speed = m2.ball.speed();
    }
    expect(speed).toBeGreaterThan(36); // (an ordinary full-power strike tops out around 31-35 m/s)
    expect(m2.shotSide).toBe(0);
    expect(B.blitzState(m2).megaKick[0]).toBe(m2.shotKick);
  });

  it('mega: the keeper is knocked back ~2 m; on target inside 18 m it goes through him, from further out he can only parry', () => {
    const setup = (shotDist: number) => {
      const m = mk({ mode: 'blitz' }, 4);
      toPlay(m);
      // The keeper's side is the human's: he braces only while TACKLE is held (no AI brace roll).
      (m.cfg as { humanSide: Side | -1 }).humanSide = 1;
      const k = m.keeperOf(1)!;
      const ad = m.attackDir(0);
      const s = B.blitzState(m);
      m.shotKick = m.kickId;
      m.shotSide = 0;
      m.shotClock = 0.3;
      m.shotDist = shotDist;
      s.megaKick[0] = m.kickId;
      k.setState('move');
      m.ball.pos.x = k.pos.x - ad * 0.5;
      m.ball.pos.z = k.pos.z;
      m.ball.pos.y = 1.0;
      m.ball.vel.x = ad * 30;
      m.ball.vel.y = 0.5;
      m.ball.vel.z = 1;
      m.drainEvents();
      return { m, k, ad };
    };
    const a = setup(12);
    expect(B.megaHands(a.m, a.k, true)).toBe(true);
    expect(a.k.state).toBe('fallen');
    expect(Math.hypot(a.k.vel.x, a.k.vel.z)).toBeCloseTo(B.MEGA_KNOCK, 5);
    expect(Math.sign(a.k.vel.x)).toBe(a.ad);
    // Knocked back about two metres before he's still.
    const x0 = a.k.pos.x;
    for (let i = 0; i < 60; i++) a.k.step(DT, false);
    expect(Math.abs(a.k.pos.x - x0)).toBeGreaterThan(1.6);
    expect(Math.abs(a.k.pos.x - x0)).toBeLessThan(2.4);
    // The ball carries on the same way, a touch slower, still the shooter's.
    expect(Math.sign(a.m.ball.vel.x)).toBe(a.ad);
    expect(a.m.ball.vel.x).toBeCloseTo(a.ad * 30 * B.MEGA_THROUGH, 5);
    expect(a.m.ball.lastTouch).not.toBe(a.k.idx);
    expect(a.m.stats.saves[1]).toBe(0);
    expect(a.m.drainEvents().some((e) => e.type === 'save')).toBe(false);

    const b = setup(25);
    expect(B.megaHands(b.m, b.k, true)).toBe(true);
    expect(b.k.state).toBe('fallen');
    expect(Math.sign(b.m.ball.vel.x)).toBe(-b.ad); // parried back out
    expect(b.m.ball.lastTouch).toBe(b.k.idx);
    expect(b.m.stats.saves[1]).toBe(1);
    expect(b.m.drainEvents()).toContainEqual({ type: 'save', keeper: b.k.idx, caught: false });

    // Not a mega shot: the usual hands.
    const c = setup(12);
    B.blitzState(c.m).megaKick[0] = -1;
    expect(B.megaHands(c.m, c.k, true)).toBe(false);
    expect(c.k.state).toBe('move');
    expect(c.m.ball.vel.x).toBe(c.ad * 30);

    // Braced (the human holding TACKLE off the ball): half the knock-back, and a parry even from close in.
    const d = setup(12);
    B.blitzState(d.m).brace[1] = true;
    expect(B.megaHands(d.m, d.k, true)).toBe(true);
    expect(Math.hypot(d.k.vel.x, d.k.vel.z)).toBeCloseTo(B.MEGA_KNOCK * B.MEGA_BRACE_KNOCK, 5);
    expect(Math.sign(d.m.ball.vel.x)).toBe(-d.ad);
    expect(d.m.stats.saves[1]).toBe(1);
  });

  it('timers wait while the ball is dead, and nothing can be used then', () => {
    const m = mk({ mode: 'blitz' }, 6);
    toPlay(m);
    m.heldPower[0] = 'turbo';
    m.heldPower[1] = 'mega';
    B.usePower(m, 0, m.teamPlayers(0)[3].idx);
    const left = B.effectLeft(m, 0, 'turbo');
    m.powerups.push({ id: 997, kind: 'shield', x: 0, z: HALF_W - 4.5, t: 0 });
    m.phase = 'out';
    for (let i = 0; i < 120; i++) B.blitzStep(m, DT, { ...EMPTY_PAD, power: i % 2 === 0 });
    expect(B.effectLeft(m, 0, 'turbo')).toBe(left);
    expect(m.powerups.find((p) => p.id === 997)?.t).toBe(0);
    expect(B.usePower(m, 1, 0)).toBe(false);
    expect(m.heldPower[1]).toBe('mega');
    m.phase = 'play';
    for (let i = 0; i < 60; i++) B.blitzStep(m, DT, EMPTY_PAD);
    expect(B.effectLeft(m, 0, 'turbo')).toBeCloseTo(left - 1, 3);
    expect(m.powerups.find((p) => p.id === 997)?.t).toBeCloseTo(1, 3);
  });

  it('half-time clears pickups, held items and effects (with powerupEnd)', () => {
    const m = mk({ mode: 'blitz' }, 6);
    toPlay(m);
    m.heldPower[1] = 'magnet';
    m.heldPower[0] = 'shield';
    B.usePower(m, 0, m.teamPlayers(0)[3].idx);
    m.powerups.push({ id: 996, kind: 'turbo', x: 0, z: HALF_W - 4.5, t: 0 });
    m.clock = m.cfg.halfLength + 9; // the whistle is due whatever is happening
    let steps = 0;
    while (m.phase !== 'halftime' && steps++ < 600) m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('halftime');
    expect(m.powerups).toEqual([]);
    expect(m.heldPower).toEqual([null, null]);
    expect(B.effectLeft(m, 0, 'shield')).toBe(0);
    for (const p of m.players) expect(p.boost).toBeNull();
    expect(m.drainEvents()).toContainEqual({ type: 'powerupEnd', kind: 'shield', player: m.teamPlayers(0)[3].idx, side: 0 });
  });
});

describe('blitz mode: a whole match', () => {
  it('both AI sides collect and use items, every effect ends, and a seed replays exactly', () => {
    const a = play(mk({ mode: 'blitz' }, 11));
    const b = play(mk({ mode: 'blitz' }, 11));
    expect(a.m.phase).toBe('fulltime');
    expect(endHash(a.m)).toBe(endHash(b.m));
    expect(a.kinds).toEqual(b.kinds);
    const bySide = (type: MatchEvent['type']): [number, number] => {
      const n: [number, number] = [0, 0];
      for (const e of a.events) if (e.type === type && 'side' in e) n[e.side as Side]++;
      return n;
    };
    const taken = bySide('powerupTaken');
    const used = bySide('powerupUsed');
    expect(taken[0]).toBeGreaterThan(0);
    expect(taken[1]).toBeGreaterThan(0);
    expect(used[0]).toBeGreaterThan(0);
    expect(used[1]).toBeGreaterThan(0);
    expect(used[0] + used[1]).toBeLessThanOrEqual(taken[0] + taken[1]);
    const ends = a.kinds.powerupEnd ?? 0;
    expect(ends).toBeGreaterThan(0);
    expect(ends).toBeLessThanOrEqual(used[0] + used[1]);
    // Full time: nothing held, nothing lying about, nobody boosted.
    expect(a.m.powerups).toEqual([]);
    expect(a.m.heldPower).toEqual([null, null]);
    for (const p of a.m.players) expect(p.boost).toBeNull();
    // Most kinds turn up over a match (a weighted draw over ~12-15 spawns: one kind missing is ~10% seed luck,
    // so all five in one match isn't guaranteed; drawKind's weights are covered by the balance sweep).
    const kinds = new Set(a.events.filter((e) => e.type === 'powerupSpawn').map((e) => (e as { kind: string }).kind));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  }, 60_000);

  // Balance sweep (slow, ~30 s): BLITZ_BALANCE=1 npx vitest run tests/blitz.test.ts
  it.skipIf(!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BLITZ_BALANCE)('goals per match stay within 1.3x of classic and neither side gains an edge (N=32)', () => {
    const N = 32;
    const tally = (mode: MatchConfig['mode']) => {
      const t = { goals: 0, side: [0, 0] as [number, number], shots: 0, used: 0, saves: 0, byKind: {} as Record<string, number>, megaShots: 0, megaGoals: 0, taken: 0 };
      for (let i = 0; i < N; i++) {
        // (Alternate the home side so club strength doesn't read as a side edge.)
        const r = play(mk({ mode }, 1000 + i * 13, i % 2 ? 6 : 5, i % 2 ? 5 : 6));
        t.goals += r.m.score[0] + r.m.score[1];
        t.side[0] += r.m.score[0];
        t.side[1] += r.m.score[1];
        t.shots += r.m.stats.shots[0] + r.m.stats.shots[1];
        t.used += r.kinds.powerupUsed ?? 0;
        t.taken += r.kinds.powerupTaken ?? 0;
        t.saves += r.m.stats.saves[0] + r.m.stats.saves[1];
        r.events.forEach((e, j) => {
          if (e.type === 'powerupUsed') t.byKind[e.kind] = (t.byKind[e.kind] ?? 0) + 1;
          // (Mega ends at the strike: a goal inside the next 2 s came off the rocket.)
          if (e.type === 'powerupEnd' && e.kind === 'mega' && r.events[j + 1]?.type === 'kick') {
            t.megaShots++;
            if (r.events.some((g, q) => q > j && g.type === 'goal' && r.at[q] - r.at[j] < 120)) t.megaGoals++;
          }
        });
      }
      return t;
    };
    const classic = tally('classic');
    const blitz = tally('blitz');
    // eslint-disable-next-line no-console
    console.log('balance', JSON.stringify({ N, classic, blitz, goalsPerMatch: [classic.goals / N, blitz.goals / N] }));
    const ratio = blitz.goals / Math.max(1, classic.goals);
    expect(ratio).toBeLessThanOrEqual(1.3);
    expect(ratio).toBeGreaterThanOrEqual(1 / 1.3);
    const share = (t: { side: [number, number]; goals: number }) => t.side[0] / Math.max(1, t.goals);
    expect(Math.abs(share(blitz) - share(classic))).toBeLessThan(0.12);
  }, 300_000);
});
