import { describe, expect, it } from 'vitest';
import { freeKickGhost, flyGhost, ghostBlocked, lobLaunch, type GhostLaunch } from '../src/game/ghostArc';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { tacticsCall } from '../src/ui/commentary';
import { restartCue } from '../src/ui/coach';
import { Ball, type BallHit } from '../src/sim/ball';
import { BALL_R, DT, GOAL_W, GRAVITY, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import {
  deliveryShape, FK_AUTO_POWER, fkSpeed, freeKickSolve, newFkAim, newZoneAim, steerFreeKick, steerZone, wallJump, wallRadius, wallTop, zoneBounds,
} from '../src/sim/setPiece';
import { PEN_AIM_H0, PEN_AIM_H_MAX, PEN_AIM_Z } from '../src/sim/shootout';
import type { MatchEvent, RestartKind } from '../src/sim/types';

/**
 * Free kicks and corners aimed the way penalties are (src/sim/setPiece.ts; the owner, 2026-10-04: "freekick and corner
 * lines feel kind of useless icl, im not happy with them, but i am rly rly happy with the pens yo"): a reticle on the
 * goal for a shooting free kick, a landing ring in the box for a corner or a wide free kick, and a preview that is the
 * kick's own solve.
 */

/** A match with the human on side 0 and a restart of `kind` given to `side` at (dist m from the goal it attacks, z). */
function setPiece(seed: number, kind: RestartKind, side: 0 | 1, dist: number, z: number, difficulty = 1.8): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty, humanSide: 0, seed });
  for (let i = 0; i < 120; i++) {
    m.step(DT, EMPTY_PAD);
    m.drainEvents();
  }
  const ad = m.attackDir(side);
  Object.assign(m, { phase: 'play', restart: null });
  (m as unknown as { goOut: (k: string, s: number, x: number, z: number) => void }).goOut(kind, side, ad * (HALF_L - dist), z);
  for (let i = 0; i < 600 && m.phase !== 'restart'; i++) {
    m.step(DT, EMPTY_PAD);
    m.drainEvents();
  }
  // (Past the lock on a new restart's buttons.)
  for (let i = 0; i < 16; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  return m;
}

function steps(m: Match, n: number, pad: Pad, evs: MatchEvent[] = []): MatchEvent[] {
  for (let i = 0; i < n; i++) {
    m.step(DT, pad);
    evs.push(...m.drainEvents());
  }
  return evs;
}

/** The analog stick that reads as (`across` the goal towards world +z, `up` it) from a ball at (bx, bz) attacking the goal at gx. */
function fkStick(bx: number, bz: number, gx: number, across: number, up: number): Pad {
  const dl = Math.hypot(gx - bx, bz) || 1;
  const ux = (gx - bx) / dl;
  const uz = -bz / dl;
  const a = across * (Math.sign(ux) || 1);
  return { ...EMPTY_PAD, digital: false, mx: up * ux + a * -uz, mz: up * uz + a * ux };
}

/** Fly a launch on the sim's ball to the goal line at gx: where it crosses (z, y). */
function crossing(L: GhostLaunch, gx: number): { z: number; y: number } {
  const b = new Ball();
  const hits: BallHit[] = [];
  b.reset(L.x, L.z);
  b.pos.y = L.y;
  b.vel.x = L.vx;
  b.vel.y = L.vy;
  b.vel.z = L.vz;
  b.spin.y = L.spinY ?? 0;
  const ad = Math.sign(gx - L.x);
  for (let i = 0; i < 400; i++) {
    const px = b.pos.x;
    const py = b.pos.y;
    const pz = b.pos.z;
    // (Stop a step short of the frame: a post would knock the probe about.)
    if ((b.pos.x + b.vel.x * DT - (gx - ad * 0.45)) * ad >= 0) {
      const u = (gx - px) / b.vel.x;
      return { z: pz + b.vel.z * u, y: py + b.vel.y * u - 0.5 * GRAVITY * u * u };
    }
    hits.length = 0;
    b.step(DT, hits);
  }
  return { z: NaN, y: NaN };
}

describe('the free kick reticle', () => {
  it('the stick across the lens slides it across the goal, along it up and down; let go, it stays', () => {
    for (const [bx, bz, gx] of [[HALF_L - 22, 0, HALF_L], [HALF_L - 20, 9, HALF_L], [-HALF_L + 22, -6, -HALF_L]] as [number, number, number][]) {
      const a = newFkAim();
      expect(a.pen.z).toBe(0);
      expect(a.pen.h).toBeCloseTo(PEN_AIM_H0, 6);
      const right = fkStick(bx, bz, gx, 0.9, 0);
      for (let i = 0; i < 60; i++) steerFreeKick(a, right.mx, right.mz, bx, bz, gx, false, false, DT);
      expect(a.pen.z).toBeGreaterThan(PEN_AIM_Z - 0.05);
      expect(a.pen.h).toBeCloseTo(PEN_AIM_H0, 1);
      const up = fkStick(bx, bz, gx, 0.9, 0.9);
      for (let i = 0; i < 60; i++) steerFreeKick(a, up.mx, up.mz, bx, bz, gx, false, false, DT);
      expect(a.pen.h).toBeGreaterThan(PEN_AIM_H_MAX - 0.05);
      // Let go: it stays where it was put.
      for (let i = 0; i < 30; i++) steerFreeKick(a, 0, 0, bx, bz, gx, false, false, DT);
      expect(a.pen.z).toBeGreaterThan(PEN_AIM_Z - 0.05);
      expect(a.pen.h).toBeGreaterThan(PEN_AIM_H_MAX - 0.05);
      expect(a.curl).toBe(0);
    }
  });

  it('while SHOOT is held the reticle is fixed and the stick bends the ball instead (keys slide the bend)', () => {
    const a = newFkAim();
    const G = HALF_L;
    const left = fkStick(G - 22, 4, G, -0.9, 0);
    for (let i = 0; i < 40; i++) steerFreeKick(a, left.mx, left.mz, G - 22, 4, G, false, true, DT);
    expect(a.pen.z).toBe(0);
    expect(a.curl).toBeLessThan(-0.9);
    const right = fkStick(G - 22, 4, G, 0.45, 0);
    for (let i = 0; i < 40; i++) steerFreeKick(a, right.mx, right.mz, G - 22, 4, G, false, true, DT);
    expect(a.curl).toBeGreaterThan(0.4);
    expect(a.curl).toBeLessThan(0.65);
    // Keys: a steady slide, not a jump.
    const k = newFkAim();
    steerFreeKick(k, 0, 1, G - 22, 0, G, true, true, DT);
    expect(k.curl).toBeGreaterThan(0);
    expect(k.curl).toBeLessThan(0.1);
    for (let i = 0; i < 90; i++) steerFreeKick(k, 0, 1, G - 22, 0, G, true, true, DT);
    expect(k.curl).toBe(1);
  });
});

describe('the free kick goes through the reticle, and the preview is the kick', () => {
  it('freeKickSolve: straight or bent, soft or hard, from the middle or from wide, the flight crosses the line at the point', () => {
    const L: GhostLaunch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    let worst = 0;
    for (const [dist, bz] of [[22, 0], [20, 9], [25, -11], [18, 3]] as [number, number][]) {
      const bx = HALF_L - dist;
      // (Not a low one from range: struck softly from 27 m at the foot of a post it has to bounce on the way.)
      for (const [z, h] of [[3.1, 1.95], [-3.1, 0.9], [0, 1.2], [2, 1.6]] as [number, number][]) {
        for (const power of [0.45, 0.62, 0.8, 1]) {
          for (const curl of [-1, -0.5, 0, 0.6, 1]) {
            freeKickGhost(bx, BALL_R, bz, HALF_L, z, h, power, 0.8, curl, L);
            const c = crossing(L, HALF_L);
            worst = Math.max(worst, Math.abs(c.z - z), Math.abs(c.y - h));
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`free kick solve: worst miss of the reticle over 320 kicks ${worst.toFixed(3)} m`);
    expect(worst).toBeLessThan(0.15);
  });

  it('a bent one starts outside its line and comes back to it; the power is the pace', () => {
    const L: GhostLaunch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    const bx = HALF_L - 22;
    freeKickGhost(bx, BALL_R, 0, HALF_L, 3, 1.9, 0.6, 0.8, 0, L);
    const straight = Math.atan2(L.vz, L.vx);
    freeKickGhost(bx, BALL_R, 0, HALF_L, 3, 1.9, 0.6, 0.8, 1, L);
    const bentRight = Math.atan2(L.vz, L.vx);
    freeKickGhost(bx, BALL_R, 0, HALF_L, 3, 1.9, 0.6, 0.8, -1, L);
    const bentLeft = Math.atan2(L.vz, L.vx);
    // Bent towards +z it starts to the -z side of the straight line, and the other way about.
    expect(bentRight).toBeLessThan(straight - 0.03);
    expect(bentLeft).toBeGreaterThan(straight + 0.03);
    expect(fkSpeed(1, 0.8)).toBeGreaterThan(fkSpeed(0.45, 0.8) + 5);
    const s = { vx: 0, vy: 0, vz: 0 };
    const soft = freeKickSolve(bx, BALL_R, 0, HALF_L, 3, 1.9, 0.45, 0.8, 0, s).vy;
    const hard = freeKickSolve(bx, BALL_R, 0, HALF_L, 3, 1.9, 1, 0.8, 0, s).vy;
    // A soft one has to go up to get there; a hard one is flat.
    expect(soft).toBeGreaterThan(hard + 0.5);
  });

  it('the preview ends at the wall when the kick would be blocked, and runs to the goal when it clears it', () => {
    const L: GhostLaunch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    const out = new Float32Array(64 * 3);
    // A wall 9.15 m on, on the line to the corner he is aiming at.
    const bx = HALF_L - 22;
    const wall = { spots: [{ x: bx + 9.1, z: 1.24 }, { x: bx + 9.1, z: 0.4 }], bend: 0 };
    freeKickGhost(bx, BALL_R, 0, HALF_L, 3, 1.2, 1, 0.8, 0, L);
    let n = flyGhost(L, out, wall);
    expect(ghostBlocked).toBe(true);
    expect(out[(n - 1) * 3]).toBeLessThan(bx + 9.8);
    // The same kick with no wall in the way goes all the way.
    n = flyGhost(L, out);
    expect(ghostBlocked).toBe(false);
    expect(out[(n - 1) * 3]).toBeGreaterThan(HALF_L - 0.5);
    // Fully bent, the wall has less of it (it is struck up and dips): the test the sim's own wall makes.
    expect(wallTop(1)).toBeLessThan(wallTop(0) - 0.5);
    expect(wallRadius(1)).toBeLessThan(wallRadius(0));
    expect(wallJump(0.03)).toBe(0);
    expect(wallJump(0.25)).toBeGreaterThan(0.25);
    expect(wallJump(0.6)).toBe(0);
  });
});

describe('the human takes a shooting free kick', () => {
  it('a reticle on the goal (the penalty reticle), no landing ring; the stick moves it; untouched it starts in the middle', () => {
    const m = setPiece(11, 'freekick', 0, 22, 0);
    const b = m.ball.pos;
    const gx = m.attackDir(0) * HALF_L;
    expect(m.penAim).not.toBeNull();
    expect(m.zoneAim).toBeNull();
    expect(m.penAim!.z).toBe(0);
    expect(m.penAim!.gx).toBe(gx);
    steps(m, 40, fkStick(b.x, b.z, gx, 0.9, 0.9));
    expect(m.penAim!.z).toBeGreaterThan(PEN_AIM_Z - 0.1);
    expect(m.penAim!.h).toBeGreaterThan(PEN_AIM_H_MAX - 0.1);
    expect(m.fkCurl).toBe(0);
    // SHOOT held: the reticle stays, the stick is the bend.
    steps(m, 12, { ...fkStick(b.x, b.z, gx, -0.9, 0), shoot: true });
    expect(m.penAim!.z).toBeGreaterThan(PEN_AIM_Z - 0.1);
    expect(m.fkCurl).toBeLessThan(-0.5);
    // The AI's free kick never has one.
    const ai = setPiece(12, 'freekick', 1, 22, 0);
    expect(ai.penAim).toBeNull();
    expect(ai.zoneAim).toBeNull();
  });

  it('struck, it goes at the reticle: bent round the wall into the top corner it scores; left in the middle it meets the wall', () => {
    const take = (seed: number, plan: { z: number; h: number; hold: number; curl: number } | null) => {
      const m = setPiece(seed, 'freekick', 0, 22, 0);
      const b = m.ball.pos;
      const gx = m.attackDir(0) * HALF_L;
      const bx = b.x;
      const bz = b.z;
      const evs: MatchEvent[] = [];
      if (plan) {
        const up = ((plan.h - PEN_AIM_H0) / (PEN_AIM_H_MAX - PEN_AIM_H0)) * 0.9;
        steps(m, 45, fkStick(bx, bz, gx, (plan.z / PEN_AIM_Z) * 0.9, up), evs);
        steps(m, plan.hold, { ...fkStick(bx, bz, gx, plan.curl * 0.85, 0), shoot: true }, evs);
      }
      const aim = m.penAim ? { z: m.penAim.z, h: m.penAim.h } : { z: 0, h: PEN_AIM_H0 };
      let how = '';
      for (let i = 0; i < 60 * 12 && !how; i++) {
        m.step(DT, EMPTY_PAD);
        for (const e of m.drainEvents()) {
          evs.push(e);
          if (e.type === 'goal') how = e.side === 0 ? 'goal' : 'own';
          else if (e.type === 'block') how = 'wall';
          else if (e.type === 'save') how = 'saved';
          else if (e.type === 'restart' && evs.some((x) => x.type === 'kick')) how = 'out';
        }
        if (!how && evs.some((x) => x.type === 'kick') && m.ball.owner >= 0) how = 'held';
      }
      return { how, aim, kicked: evs.some((e) => e.type === 'kick' && e.kind === 'shot') };
    };
    const N = 24;
    const top = GOAL_W / 2 - 0.6;
    let bent = 0;
    let idle = 0;
    let idleWall = 0;
    let keeperSide = 0;
    for (let s = 0; s < N; s++) {
      const a = take(900 + s * 7, { z: top, h: 2, hold: 18, curl: -1 });
      expect(a.kicked).toBe(true);
      expect(a.aim.z).toBeGreaterThan(top - 0.15);
      if (a.how === 'goal') bent++;
      // Nothing pressed: his time runs out and it goes at the reticle, in the middle, at a firm mid power.
      const i = take(900 + s * 7, null);
      expect(i.kicked).toBe(true);
      if (i.how === 'goal') idle++;
      if (i.how === 'wall') idleWall++;
      if (take(900 + s * 7, { z: -top, h: 2, hold: 18, curl: 1 }).how === 'goal') keeperSide++;
    }
    // eslint-disable-next-line no-console
    console.log(`free kick, 22 m, NORMAL, of ${N}: bent into the top corner past the wall ${bent}; the keeper's corner ${keeperSide}; untouched ${idle} (met the wall ${idleWall})`);
    expect(bent).toBeGreaterThanOrEqual(6);
    expect(bent).toBeLessThanOrEqual(18);
    expect(idle).toBeLessThanOrEqual(1);
    expect(idleWall).toBeGreaterThan(N * 0.7);
    expect(keeperSide).toBeLessThan(bent);
    expect(FK_AUTO_POWER).toBeGreaterThan(0.45);
  }, 240_000);
});

describe('the landing ring', () => {
  it('starts in the middle of the area it may sit in; the stick puts it there and it stays; never by the goal line or out of the box area', () => {
    const m = setPiece(21, 'corner', 0, 0.35, HALF_W - 0.35);
    const bnd = zoneBounds(m, 0);
    const a = newZoneAim(m, 0);
    expect(a.x).toBeCloseTo(bnd.cx, 6);
    expect(a.z).toBe(0);
    for (let i = 0; i < 60; i++) steerZone(a, 0.9, -0.9, false, DT, bnd);
    expect(a.x).toBeCloseTo(bnd.x1, 1);
    expect(a.z).toBeCloseTo(bnd.z0, 1);
    for (let i = 0; i < 30; i++) steerZone(a, 0, 0, false, DT, bnd);
    expect(a.x).toBeCloseTo(bnd.x1, 1);
    // Never nearer the goal line than 3.5 m (the keeper's), never beyond the area.
    const gx = m.attackDir(0) * HALF_L;
    expect(Math.abs(gx - bnd.x0)).toBeGreaterThanOrEqual(3.4);
    expect(Math.abs(gx - bnd.x1)).toBeGreaterThanOrEqual(3.4);
    expect(Math.max(Math.abs(gx - bnd.x0), Math.abs(gx - bnd.x1))).toBeLessThan(20);
    // Keys slide it.
    const k = newZoneAim(m, 0);
    steerZone(k, 0, 1, true, DT, bnd);
    expect(k.z).toBeGreaterThan(0);
    expect(k.z).toBeLessThan(0.3);
  });

  it("the human's corner: the ring is up (no reticle), the stick moves it, the runner nearest it is the man it is for", () => {
    const m = setPiece(22, 'corner', 0, 0.35, HALF_W - 0.35);
    expect(m.zoneAim).not.toBeNull();
    expect(m.penAim).toBeNull();
    const z0 = m.zoneAim!.z;
    const runners = m.brains[0].spRunners;
    expect(runners.length).toBe(5);
    expect(runners).toContain(m.zoneAim!.runner);
    steps(m, 30, { ...EMPTY_PAD, digital: false, mx: 0, mz: -0.9 });
    expect(m.zoneAim!.z).toBeLessThan(z0 - 5);
    // (Wherever the ring is, somebody attacks it: the runner nearest.)
    expect(runners).toContain(m.zoneAim!.runner);
    // The AI's corner has none.
    expect(setPiece(23, 'corner', 1, 0.35, HALF_W - 0.35).zoneAim).toBeNull();
  });

  it('CROSS floats it to the ring, SHOOT drives it there lower and quicker, PASS plays it short', () => {
    const deliver = (seed: number, btn: 'through' | 'shoot' | 'pass', mz: number) => {
      const m = setPiece(seed, 'corner', 0, 0.35, HALF_W - 0.35);
      steps(m, 30, { ...EMPTY_PAD, digital: false, mx: 0, mz });
      const ring = { x: m.zoneAim!.x, z: m.zoneAim!.z, runner: m.zoneAim!.runner };
      const evs = steps(m, 3, { ...EMPTY_PAD, [btn]: true });
      let top = 0;
      let land: { x: number; z: number } | null = null;
      let t = 0;
      let kickAt = -1;
      let target = -1;
      for (let i = 0; i < 60 * 5; i++) {
        m.step(DT, EMPTY_PAD);
        const es = m.drainEvents();
        evs.push(...es);
        if (kickAt < 0 && es.some((e) => e.type === 'kick')) {
          kickAt = i;
          target = m.passTarget;
        }
        if (kickAt >= 0 && !land) {
          top = Math.max(top, m.ball.pos.y);
          // (Down to head height on its way down, or met by somebody: where it came in.)
          if ((m.ball.vel.y < 0 && m.ball.pos.y < 1.5) || m.ball.owner >= 0 || es.some((e) => e.type === 'kick' && i > kickAt)) {
            land = { x: m.ball.pos.x, z: m.ball.pos.z };
            t = (i - kickAt) * DT;
          }
        }
      }
      const kick = evs.find((e) => e.type === 'kick');
      return { ring, land, top, t, target, kind: kick && kick.type === 'kick' ? kick.kind : '' };
    };
    let offFloat = 0;
    let offDriven = 0;
    const N = 8;
    for (let s = 0; s < N; s++) {
      const f = deliver(700 + s, 'through', s % 2 ? -0.5 : 0.3);
      const d = deliver(700 + s, 'shoot', s % 2 ? -0.5 : 0.3);
      expect(f.kind).toBe('lob');
      expect(d.kind).toBe('lob');
      expect(f.land).not.toBeNull();
      expect(d.land).not.toBeNull();
      offFloat += Math.hypot(f.land!.x - f.ring.x, f.land!.z - f.ring.z);
      offDriven += Math.hypot(d.land!.x - d.ring.x, d.land!.z - d.ring.z);
      // The man it is for is the runner the ring showed.
      expect(f.target).toBe(f.ring.runner);
      // Driven: flatter and sooner.
      expect(d.top).toBeLessThan(f.top - 0.8);
      expect(d.t).toBeLessThan(f.t);
    }
    // eslint-disable-next-line no-console
    console.log(`corners to the ring, of ${N}: came in ${(offFloat / N).toFixed(2)} m from it floated, ${(offDriven / N).toFixed(2)} m driven`);
    // (Where it is met, or down to head height: a runner takes it a stride or two before it would land.)
    expect(offFloat / N).toBeLessThan(3.5);
    expect(offDriven / N).toBeLessThan(3.8);
    // PASS: short, along the grass, to a man near the flag.
    const short = deliver(710, 'pass', 0);
    expect(short.kind).toBe('pass');
  }, 120_000);

  it('the preview is the delivery: it comes down on the ring, and a driven one is flatter', () => {
    const L: GhostLaunch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    const out = new Float32Array(64 * 3);
    const end = (driven: boolean) => {
      const sh = deliveryShape(true, HALF_W - 0.35, 2, driven);
      lobLaunch(HALF_L - 0.35, BALL_R, HALF_W - 0.35, HALF_L - 8, 2, sh.power, driven, L, sh.land, sh.hang);
      const n = flyGhost(L, out);
      let top = 0;
      let at = -1;
      for (let i = 0; i < n; i++) {
        top = Math.max(top, out[i * 3 + 1]);
        // (Where it is down to head height again.)
        if (at < 0 && i > 3 && out[i * 3 + 1] < 1.6 && out[i * 3 + 1] < out[(i - 1) * 3 + 1]) at = i;
      }
      const k = at < 0 ? n - 1 : at;
      return { off: Math.hypot(out[k * 3] - (HALF_L - 8), out[k * 3 + 2] - 2), top };
    };
    const f = end(false);
    const d = end(true);
    expect(f.off).toBeLessThan(3.2);
    expect(d.off).toBeLessThan(3.2);
    expect(d.top).toBeLessThan(f.top - 1);
    // A corner floated beyond the near post hangs a little longer than one to the near post.
    expect(deliveryShape(true, HALF_W - 0.35, -3, false).hang).toBeGreaterThan(0);
    expect(deliveryShape(true, HALF_W - 0.35, 4, false).hang).toBe(0);
    expect(deliveryShape(false, 20, -3, false).hang).toBe(0);
  });

  it('a wide free kick has the ring too; nothing pressed, the corner is floated to the ring when his time is up', () => {
    const wide = setPiece(31, 'freekick', 0, 20, 26);
    expect(wide.zoneAim).not.toBeNull();
    expect(wide.penAim).toBeNull();
    const m = setPiece(32, 'corner', 0, 0.35, -(HALF_W - 0.35));
    const ring = { x: m.zoneAim!.x, z: m.zoneAim!.z };
    const evs = steps(m, 60 * 8, EMPTY_PAD);
    const kick = evs.find((e) => e.type === 'kick');
    expect(kick && kick.type === 'kick' ? kick.kind : '').toBe('lob');
    expect(Math.abs(ring.z)).toBeLessThan(1);
  });
});

describe('set-piece words', () => {
  it('the hint cards name the new ways of taking them (no separator glyphs)', () => {
    const corner = restartCue('corner', 'touch', 'zone');
    expect(corner.title).toBe('CORNER');
    expect(corner.actions.map((a) => a[0])).toEqual(['', 'CROSS', 'DRIVEN', 'SHORT']);
    const fk = restartCue('freekick', 'keyboard', 'goal');
    expect(fk.title).toBe('FREE KICK');
    expect(fk.actions.length).toBe(3);
    const all = [...corner.actions, ...fk.actions, ...restartCue('freekick', 'touch', 'goal').actions, ...restartCue('freekick', 'gamepad', 'zone').actions].flat().join(' ');
    expect(all).not.toMatch(/[·●—–]/);
    // A plain free kick (not in range, not wide in the final third) keeps its old card.
    expect(restartCue('freekick', 'keyboard').actions.length).toBe(3);
  });

  it("the coach's ticker line is the owner's: LAKEMOOR GO 4-3-3, PRESSING HIGH", () => {
    expect(tacticsCall('Lakemoor', { type: 'tactics', side: 1, plan: 'chase', formation: '4-3-3', shape: true, cover: null })).toBe('LAKEMOOR GO 4-3-3, PRESSING HIGH');
  });
});
