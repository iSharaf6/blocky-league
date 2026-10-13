import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { MEGGED_CODE, skillPose, startTell } from '../src/sim/skills';
import type { MatchEvent } from '../src/sim/types';

/**
 * 2026-10-14, the owner: "fix the nutmeg". Measured before the fix: a NUTMEG's ball was knocked along the dribbler's run,
 * not at the man, so it rolled 0.43 to 0.72 m beside him (24 of 24, a man's legs are about 0.3 m apart), and a nutmeg
 * that didn't fool him rolled straight to his feet (lost 12 of 12). Now it goes between his feet, he is caught legs
 * apart while it does, and with his legs shut the press is a STEPOVER that keeps the ball.
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

interface Trial { move: string | null; grade: string | null; lat: number; got: boolean; lost: boolean; megPose: boolean; ownAfter: boolean }

/** A man squared up 2.4 m ahead, `off` m off the run's line; SKILL with the stick along the run. */
function trial(seed: number, off: number, tell: boolean): Trial {
  const m = scenario(seed);
  const p = m.players[9];
  place(p, -20, 0);
  giveBall(m, p);
  for (let i = 0; i < 40; i++) m.step(DT, pad(1, 0));
  m.drainEvents();
  p.ballT = 2;
  const o = m.players[14];
  place(o, p.pos.x + 2.4, p.pos.z + off);
  o.facing = Math.PI;
  o.tackleCooldown = 0.2;
  if (tell) startTell(m, o, p, false, true);
  const evs: MatchEvent[] = [];
  for (let i = 0; i < 5; i++) { m.step(DT, pad(1, 0)); evs.push(...m.drainEvents()); }
  m.step(DT, pad(1, 0, { skill: true }));
  evs.push(...m.drainEvents());
  const mv = evs.find((e) => e.type === 'skillMove');
  const out: Trial = { move: mv && mv.type === 'skillMove' ? mv.move : null, grade: mv && mv.type === 'skillMove' ? mv.grade : null, lat: NaN, got: false, lost: false, megPose: false, ownAfter: false };
  let prev = m.ball.pos.x - o.pos.x;
  for (let i = 0; i < 150; i++) {
    m.step(DT, pad(1, 0));
    const ev = m.drainEvents();
    const along = m.ball.pos.x - o.pos.x;
    if (Number.isNaN(out.lat) && prev < 0 && along >= 0) {
      out.lat = Math.abs(m.ball.pos.z - o.pos.z);
      const pose = skillPose(m, o);
      out.megPose = !!pose && pose.kind === 'stumble' && pose.code === MEGGED_CODE;
    }
    prev = along;
    let done = false;
    for (const e of ev) {
      if (e.type === 'control' && e.player === p.idx) {
        out.got = p.pos.x > o.pos.x - 0.3;
        done = true;
      } else if ((e.type === 'control' && m.players[e.player].side !== p.side) || (e.type === 'tackle' && e.won && m.players[e.by].side !== p.side)) {
        out.lost = true;
        done = true;
      }
    }
    if (done) break;
    if (i === 20) out.ownAfter = m.ball.owner === p.idx;
  }
  return out;
}

describe('NUTMEG: through his legs', () => {
  it('a PERFECT nutmeg goes between the feet of the man it beat, wherever he stood in its lane, and comes back to the dribbler beyond him', () => {
    let n = 0;
    for (const off of [0, 0.3, -0.3, 0.6, -0.6]) {
      for (let s = 0; s < 8; s++) {
        const r = trial(900 + s * 7, off, true);
        expect(r.move, `off ${off} seed ${s}`).toBe('nutmeg');
        expect(r.grade).toBe('perfect');
        // (A voxel man's feet are about 0.3 m apart: within 0.12 m of his middle is through them.)
        expect(r.lat, `off ${off} seed ${s}`).toBeLessThan(0.12);
        expect(r.megPose, `off ${off} seed ${s}`).toBe(true);
        expect(r.lost).toBe(false);
        expect(r.got, `off ${off} seed ${s}`).toBe(true);
        n++;
      }
    }
    expect(n).toBe(40);
  }, 60_000);

  it('without a tell it is a nutmeg only when it fools him; with his legs shut it is a stepover that never rolls the ball to him', () => {
    let megs = 0;
    let steps = 0;
    for (const off of [0, 0.3, -0.6]) {
      for (let s = 0; s < 16; s++) {
        const r = trial(900 + s * 7, off, false);
        if (r.move === 'nutmeg') {
          megs++;
          expect(r.grade).toBe('good');
          expect(r.lat).toBeLessThan(0.12);
          expect(r.megPose).toBe(true);
          expect(r.lost).toBe(false);
          expect(r.got).toBe(true);
        } else {
          steps++;
          expect(r.move).toBe('stepover');
          // The ball never left his foot: nothing rolled to the man (he may still tackle him for it, as for any move).
          expect(Number.isNaN(r.lat) || r.ownAfter).toBe(true);
        }
      }
    }
    // Both happen: it is a roll (see gradeMove), not a certainty either way.
    expect(megs).toBeGreaterThan(8);
    expect(steps).toBeGreaterThan(8);
  }, 60_000);

  it('a man too far off the line is not nutmegged at all', () => {
    for (let s = 0; s < 6; s++) expect(trial(900 + s * 7, 1.2, true).move).not.toBe('nutmeg');
  });
});
