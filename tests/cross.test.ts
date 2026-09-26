import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { solveLob } from '../src/sim/ball';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent } from '../src/sim/types';

/**
 * Cross control (src/sim/match.ts autoHeader / cushion): a cross or lofted ball dropping onto the human's man.
 * With the stick pushed he brings it down (a chest / thigh cushion into the stick, a first touch) and keeps it;
 * with the stick neutral and a sight of goal he heads at goal (what a casual player expects when he isn't
 * steering); SHOOT is a header / volley at goal; PASS a headed ball to the previewed mate; THROUGH a knock-down
 * into space. (Round 9: every cross that dropped on him used to be headed or volleyed automatically.)
 */

function scenario(seed: number): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: 0, seed });
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

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

/**
 * Our striker `dist` m out, unmarked, the keeper on his line; a cross of ours from the right wing dropping on
 * him to `land` m (head ~1.9, chest ~1.3, thigh ~0.8). Control is his (the cross switched to him).
 */
function cross(seed: number, dist: number, land: number, zOff = 0): { m: Match; p: Player; ad: number } {
  const m = scenario(seed);
  const ad = m.attackDir(0);
  const gx = ad * HALF_L;
  const p = m.players[9];
  place(p, gx - ad * dist, zOff);
  p.facing = ad > 0 ? 0 : Math.PI;
  place(m.keeperOf(1)!, gx - ad * 0.8, 0);
  m.active = p.idx;
  const cx = gx - ad * 6;
  const cz = HALF_W - 6;
  const b = m.ball;
  b.reset(cx, cz);
  const d = Math.hypot(p.pos.x - cx, p.pos.z - cz);
  const s = solveLob(d, 0.75 + d / 34, land);
  b.vel.x = ((p.pos.x - cx) / d) * s.vh;
  b.vel.z = ((p.pos.z - cz) / d) * s.vh;
  b.vel.y = s.vy;
  b.pos.y = 0.25;
  b.lastTouch = m.players[8].idx;
  b.lastTouchSide = 0;
  m.passTarget = p.idx;
  m.kickKind = 'lob';
  m.kickSide = 0;
  m.kickX = cx;
  m.kickZ = cz;
  m.sinceKick = 0;
  m.updateBallPath();
  return { m, p, ad };
}

interface Outcome {
  /** He had it at his feet within 1.2 s of the ball reaching him, and 0.7 s on still had it or had played it himself. */
  kept: boolean;
  /** A shot of his (a header or volley) within 1.5 s of the ball reaching him. */
  shot: boolean;
  /** Kinds of his kicks. */
  kicks: string[];
  evs: MatchEvent[];
}

/** Play the cross out with `input(frame)` on the pad. */
function play(m: Match, p: Player, input: (i: number, near: boolean) => Pad): Outcome {
  const b = m.ball;
  const evs: MatchEvent[] = [];
  const kicks: string[] = [];
  let arrive = -1;
  let owned = -1;
  let shot = false;
  let still = false;
  const shots0 = m.stats.shots[0];
  for (let i = 0; i < 60 * 4 && m.phase === 'play'; i++) {
    const near = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 3.5;
    if (near && arrive < 0) arrive = i;
    m.step(DT, input(i, near));
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && b.lastTouch === p.idx && !kicks.includes(e.kind)) kicks.push(e.kind);
      evs.push(e);
    }
    if (m.stats.shots[0] > shots0 && b.lastTouch === p.idx) shot = true;
    if (arrive >= 0 && owned < 0 && b.owner === p.idx && !b.held) owned = i;
    if (owned >= 0 && i - owned === 42) still = b.owner === p.idx || (b.lastTouch === p.idx && kicks.length > 0) || (b.owner >= 0 && m.players[b.owner].side === 0);
    if (owned >= 0 && i - owned > 42) break;
    if (arrive >= 0 && i - arrive > 90) break;
  }
  return { kept: owned >= 0 && owned - arrive <= 72 && still && !shot, shot, kicks, evs };
}

/** Where the ball will come down to ~1.2 m (its predicted path), for the stick to aim at. */
function landing(m: Match): { x: number; z: number } {
  const path = m.ballPath;
  let up = false;
  for (const s of path) {
    if (s.y > 1.4) up = true;
    if (up && s.y < 1.2) return s;
  }
  return path[path.length - 1] ?? m.ball.pos;
}

describe('cross control', () => {
  it('stick pushed: he brings the ball down and keeps it (chest, thigh and a bouncing ball alike)', () => {
    let kept = 0;
    let n = 0;
    const fails: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      for (const land of [1.35, 0.8, 1.9]) {
        const { m, p, ad } = cross(seed * 13 + land * 10, 11 + (seed % 3), land, (seed % 5) - 2);
        // Steering: the stick at where it will drop until he's there, then pushed on towards goal, a touch across.
        const b = m.ball;
        const r = play(m, p, () => {
          const L = landing(m);
          const lx = L.x - p.pos.x;
          const lz = L.z - p.pos.z;
          const ll = Math.hypot(lx, lz);
          if (ll > 0.8 && b.owner !== p.idx) return pad(lx / ll, lz / ll);
          return pad(ad * 0.7, seed % 2 ? 0.3 : -0.3);
        });
        n++;
        if (r.kept) kept++;
        else fails.push(`seed ${seed} land ${land}: kicks ${r.kicks.join('/')}${r.shot ? ' shot' : ''}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`cross control, stick pushed: kept ${kept}/${n}${fails.length ? `\n  ${fails.slice(0, 8).join('\n  ')}` : ''}`);
    expect(kept / n).toBeGreaterThanOrEqual(0.85);
  }, 60_000);

  it('stick neutral, in sight of goal: a header at goal, as before', () => {
    let headed = 0;
    let n = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { m, p } = cross(seed * 17, 10, 1.9, (seed % 3) - 1);
      const r = play(m, p, () => pad(0, 0));
      n++;
      if (r.shot) headed++;
    }
    // eslint-disable-next-line no-console
    console.log(`cross, stick neutral: headed at goal ${headed}/${n}`);
    expect(headed / n).toBeGreaterThanOrEqual(0.7);
  }, 60_000);

  it('SHOOT as it comes: a header / volley at goal, stick or no stick', () => {
    let shots = 0;
    let n = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const land = seed % 2 ? 1.9 : 1.2;
      const { m, p, ad } = cross(seed * 19, 10.5, land, (seed % 3) - 1);
      let pressed = false;
      const r = play(m, p, (_i, near) => {
        const press = near && !pressed;
        if (press) pressed = true;
        return pad(ad * 0.8, 0.2, { shoot: press });
      });
      n++;
      if (r.shot) shots++;
    }
    // eslint-disable-next-line no-console
    console.log(`cross, SHOOT: shots ${shots}/${n}`);
    expect(shots / n).toBeGreaterThanOrEqual(0.7);
  }, 60_000);
});
