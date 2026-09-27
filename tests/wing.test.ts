import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { humanThroughTarget, pickReceiver } from '../src/sim/actions';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { HumanBot } from './humanBot';

/**
 * Passing to the wings (the owner: "when passing the ball down the wing from the centre, the winger like 70%
 * of the time struggles to or DOESNT at all receive the ball"). Scripted-human probes: the carrier in the
 * middle, the winger 18-28 m away on the touchline side with a marker behind him and a full-back ahead, the
 * stick roughly at him, PASS / THROUGH tapped; and whole matches with the scripted bot (tests/humanBot.ts),
 * counting the passes from the central lane out to a man near a touchline.
 */

/** Open play, human on side 0, everyone parked along the far (-z) touchline out of the way. */
function scenario(seed: number): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.drainEvents();
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
  return m;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

type WingState = 'standing' | 'jogging' | 'sprinting';
type Outcome = 'ok' | 'mate' | 'int' | 'out' | 'none';

interface ProbeResult {
  r: Outcome;
  /** The kick's kind, the man it was for, its launch speed, and the seconds from the strike to the outcome. */
  kind: string;
  target: number;
  v0: number;
  t: number;
  /** How far inside the touchline the ball got at most (negative: it crossed the line). */
  margin: number;
}

/**
 * The carrier at (cx, 0) in the middle of the pitch, the winger `d` m away towards the +z touchline (`zw` in
 * from the line), a marker 3-5 m behind him and a full-back 6-9 m ahead, the stick `off` rad off the winger.
 */
function probe(seed: number, state: WingState, btn: 'pass' | 'through', geom: { d: number; zw: number; cx: number; off: number }): ProbeResult {
  const m = scenario(seed);
  const ad = m.attackDir(0);
  const c = m.players[7];
  const w = m.players[8];
  const marker = m.players[17];
  const fb = m.players[15];
  const wz = HALF_W - geom.zw;
  // Along the pitch: the leg that makes the distance d with a lateral offset of wz.
  const dx = Math.sqrt(Math.max(0, geom.d * geom.d - wz * wz));
  place(c, geom.cx * ad, 0);
  c.facing = ad > 0 ? 0 : Math.PI;
  place(w, (geom.cx + dx) * ad, wz);
  place(marker, (geom.cx + dx - 3.5 - (seed % 3) * 0.7) * ad, wz - 1);
  place(fb, (geom.cx + dx + 6 + (seed % 4)) * ad, wz - 2);
  marker.facing = fb.facing = ad > 0 ? Math.PI : 0;
  if (state !== 'standing') {
    const sp = state === 'jogging' ? 5 : 8.5;
    w.vel.x = sp * ad;
    w.running = true;
    w.runT = 2.5;
    w.sprint = state === 'sprinting';
    w.facing = ad > 0 ? 0 : Math.PI;
  }
  giveBall(m, c);
  const a = Math.atan2(w.pos.z - c.pos.z, w.pos.x - c.pos.x) + geom.off;
  const sx = Math.cos(a);
  const sz = Math.sin(a);
  let kind = '';
  let v0 = 0;
  let kicked = -1;
  let margin = Infinity;
  const out: ProbeResult = { r: 'none', kind, target: -1, v0, t: 0, margin };
  for (let i = 0; i < 60 * 4; i++) {
    // A tap, then the stick left where it was (the casual player's thumb).
    m.step(DT, pad(sx, sz, { [btn]: i < 2 }));
    const evs = m.drainEvents();
    if (kicked < 0) {
      const k = evs.find((e) => e.type === 'kick');
      if (k && k.type === 'kick') {
        kicked = i;
        out.kind = k.kind;
        out.target = m.passTarget;
        out.v0 = Math.hypot(m.ball.vel.x, m.ball.vel.z);
      }
      continue;
    }
    margin = Math.min(margin, HALF_W - Math.abs(m.ball.pos.z));
    out.margin = margin;
    out.t = (i - kicked) * DT;
    if (m.phase !== 'play') {
      out.r = 'out';
      return out;
    }
    const ctl = evs.find((e) => e.type === 'control');
    const o = ctl && ctl.type === 'control' ? ctl.player : m.ball.owner;
    if (o >= 0 && o !== c.idx) {
      out.r = o === w.idx ? 'ok' : m.players[o].side === 0 ? 'mate' : 'int';
      return out;
    }
  }
  return out;
}

const GEOMS = [
  { d: 18, zw: 3, cx: 0 }, { d: 22, zw: 2.5, cx: -4 }, { d: 22, zw: 5, cx: 0 }, { d: 25, zw: 3, cx: 2 },
  { d: 28, zw: 2, cx: -6 }, { d: 28, zw: 6, cx: 0 }, { d: 20, zw: 1.5, cx: 4 }, { d: 26, zw: 4, cx: -2 },
];
const OFFS = [0, 15, -15].map((x) => (x * Math.PI) / 180);

function sweep(state: WingState, btn: 'pass' | 'through'): { n: number; ok: number; out: number; int: number; tally: Record<Outcome, number>; log: string[] } {
  const tally: Record<Outcome, number> = { ok: 0, mate: 0, int: 0, out: 0, none: 0 };
  const log: string[] = [];
  let n = 0;
  let seed = 1;
  for (const g of GEOMS) {
    for (const off of OFFS) {
      for (let k = 0; k < 2; k++) {
        const r = probe(seed * 31 + 7, state, btn, { ...g, off });
        seed++;
        n++;
        tally[r.r]++;
        if (r.r !== 'ok') log.push(`${state}/${btn} d${g.d} zw${g.zw} off${Math.round((off * 180) / Math.PI)}: ${r.r} kind=${r.kind} tgt=${r.target} v0=${r.v0.toFixed(1)} t=${r.t.toFixed(2)} margin=${r.margin.toFixed(1)}`);
      }
    }
  }
  return { n, ok: tally.ok, out: tally.out, int: tally.int, tally, log };
}

describe('passing to the wings (the human)', () => {
  for (const state of ['standing', 'jogging', 'sprinting'] as WingState[]) {
    for (const btn of ['pass', 'through'] as const) {
      it(`${btn} tap to a ${state} winger 18-28 m away on the touchline with a marker behind and a full-back ahead: he gets it`, () => {
        const s = sweep(state, btn);
        // eslint-disable-next-line no-console
        console.log(`wing ${btn} / ${state}: ${JSON.stringify(s.tally)} of ${s.n}\n  ${s.log.slice(0, 6).join('\n  ')}`);
        // (Round 10, before: standing 87.5% / 92%, jogging 94% / 58%, sprinting 2% / 0% for PASS / THROUGH: the
        // receiver ran head-on at the ball to the earliest point he could reach, and a runner was led 0.85 of
        // the way into the full-back.)
        expect(s.ok / s.n).toBeGreaterThanOrEqual(0.9);
      }, 60_000);
    }
  }
});

// ------------------------------------------------------------------ the diagonal ball (round 12)

/**
 * Round 12 (the critic, on the owner's complaint): the GEOMS above are near-square (dx 0-14 m), and the diagonal ball
 * was still going to the marker. The winger 28-38 m away at 45-65 degrees off the carrier's facing, a marker 2.5 m off
 * the lane (3 m short of him on the ball side, or 3 m beyond him on the goal side) and a full-back 7 m ahead, 2 m
 * inside; the stick roughly at him, held; PASS / THROUGH tapped for 80 ms.
 */
interface DiagGeom { deg: number; zw: number }
const DIAG_GEOMS: DiagGeom[] = [{ deg: 45, zw: 3 }, { deg: 45, zw: 4.5 }, { deg: 55, zw: 3 }, { deg: 55, zw: 4.5 }, { deg: 65, zw: 3 }, { deg: 65, zw: 4.5 }];
type MarkerSide = 'ball' | 'goal';

function probeDiag(seed: number, state: WingState, btn: 'pass' | 'through', g: DiagGeom, marker: MarkerSide, off: number, tapFrames = 5, holdStick = true): ProbeResult & { who: number } {
  const m = scenario(seed);
  const ad = m.attackDir(0);
  const c = m.players[7];
  const w = m.players[8];
  const mk = m.players[17];
  const fb = m.players[15];
  const th = (g.deg * Math.PI) / 180;
  const wz = HALF_W - g.zw;
  const dx = wz / Math.tan(th);
  const cx = -6;
  place(c, cx * ad, 0);
  c.facing = ad > 0 ? 0 : Math.PI;
  place(w, (cx + dx) * ad, wz);
  // The lane's unit line (in the carrier's frame) and its inside perpendicular (towards the middle of the pitch).
  const ux = Math.cos(th);
  const uz = Math.sin(th);
  const along = marker === 'ball' ? -3 : 3;
  place(mk, (cx + dx + ux * along + uz * 2.5) * ad, wz + uz * along - ux * 2.5);
  place(fb, (cx + dx + 7) * ad, wz - 2);
  mk.facing = fb.facing = ad > 0 ? Math.PI : 0;
  if (state !== 'standing') {
    const sp = state === 'jogging' ? 5 : 8.5;
    w.vel.x = sp * ad;
    w.running = true;
    w.runT = 2.5;
    w.sprint = state === 'sprinting';
    w.facing = ad > 0 ? 0 : Math.PI;
  }
  giveBall(m, c);
  const a = Math.atan2(w.pos.z - c.pos.z, w.pos.x - c.pos.x) + off;
  const sx = Math.cos(a);
  const sz = Math.sin(a);
  const out: ProbeResult & { who: number } = { r: 'none', kind: '', target: -1, v0: 0, t: 0, margin: Infinity, who: -1 };
  let kicked = -1;
  for (let i = 0; i < 60 * 4; i++) {
    const stick = holdStick || i < tapFrames + 20;
    m.step(DT, pad(stick ? sx : 0, stick ? sz : 0, { [btn]: i < tapFrames }));
    const evs = m.drainEvents();
    if (kicked < 0) {
      const k = evs.find((e) => e.type === 'kick');
      if (k && k.type === 'kick') {
        kicked = i;
        out.kind = k.kind;
        out.target = m.passTarget;
        out.v0 = Math.hypot(m.ball.vel.x, m.ball.vel.z);
      }
      continue;
    }
    out.margin = Math.min(out.margin, HALF_W - Math.abs(m.ball.pos.z));
    out.t = (i - kicked) * DT;
    if (m.phase !== 'play') {
      out.r = 'out';
      return out;
    }
    const ctl = evs.find((e) => e.type === 'control');
    const o = ctl && ctl.type === 'control' ? ctl.player : m.ball.owner;
    if (o >= 0 && o !== c.idx) {
      out.r = o === w.idx ? 'ok' : m.players[o].side === 0 ? 'mate' : 'int';
      out.who = o;
      return out;
    }
  }
  return out;
}

function sweepDiag(btn: 'pass' | 'through', marker: MarkerSide): { n: number; ok: number; tally: Record<Outcome, number>; log: string[]; byGeom: Record<string, [number, number]> } {
  const tally: Record<Outcome, number> = { ok: 0, mate: 0, int: 0, out: 0, none: 0 };
  const byGeom: Record<string, [number, number]> = {};
  const log: string[] = [];
  let n = 0;
  let seed = 1;
  for (const g of DIAG_GEOMS) {
    for (const state of ['standing', 'jogging', 'sprinting'] as WingState[]) {
      for (const off of OFFS) {
        for (let k = 0; k < 2; k++) {
          const r = probeDiag(seed * 53 + 11, state, btn, g, marker, off);
          seed++;
          n++;
          tally[r.r]++;
          const key = `${g.deg}deg/zw${g.zw}`;
          const bg = (byGeom[key] ??= [0, 0]);
          bg[1]++;
          if (r.r === 'ok') bg[0]++;
          else log.push(`${state}/${btn}/${marker} ${key} off${Math.round((off * 180) / Math.PI)}: ${r.r} by ${r.who} kind=${r.kind} tgt=${r.target} v0=${r.v0.toFixed(1)} t=${r.t.toFixed(2)}`);
        }
      }
    }
  }
  return { n, ok: tally.ok, tally, log, byGeom };
}

describe('the diagonal ball out to a marked winger (round 12)', () => {
  for (const btn of ['pass', 'through'] as const) {
    for (const marker of ['ball', 'goal'] as MarkerSide[]) {
      it(`${btn} tap to a winger 28-38 m away at 45-65 degrees with a marker 2.5 m off the lane on the ${marker} side: he gets it`, () => {
        const s = sweepDiag(btn, marker);
        const per = Object.entries(s.byGeom).map(([k, v]) => `${k} ${v[0]}/${v[1]}`).join(', ');
        // eslint-disable-next-line no-console
        console.log(`diagonal ${btn} / marker ${marker}-side: ${JSON.stringify(s.tally)} of ${s.n} [${per}]\n  ${s.log.slice(0, 8).join('\n  ')}`);
        // (Round 12, before: 39% completed, 56% intercepted over the critic's 54 real-key probes: the marker was
        // picked to press the man the ball was for and ran straight down the lane at it from a 0.12 s reaction, and
        // the ball was aimed at the man's feet, on the marker's side of him.)
        expect(s.ok / s.n).toBeGreaterThanOrEqual(0.8);
        for (const [k, v] of Object.entries(s.byGeom)) expect(v[0] / v[1], k).toBeGreaterThanOrEqual(0.65);
      }, 90_000);
    }
  }

  it('THROUGH tapped (80 ms) to a wide runner with the full-back 7 m ahead is a through ball, never led into the full-back', () => {
    // (Round 12, the critic: d36 / 48 degrees, 6 of 6 intercepted by the full-back; d30 / 60 degrees, 5 of 6 by
    // the marker; and every one of 27 L taps registered as a 'pass'.)
    const tally: Record<Outcome, number> = { ok: 0, mate: 0, int: 0, out: 0, none: 0 };
    let n = 0;
    let through = 0;
    let byFullBack = 0;
    let seed = 1;
    for (const g of [{ deg: 48, zw: 3 }, { deg: 60, zw: 4 }]) {
      for (const state of ['standing', 'jogging', 'sprinting'] as WingState[]) {
        for (const off of [0, -0.25]) {
          for (let k = 0; k < 3; k++) {
            const r = probeDiag(seed * 71 + 3, state, 'through', g, 'ball', off, 5, false);
            seed++;
            n++;
            tally[r.r]++;
            if (r.kind === 'through') through++;
            if (r.r === 'int' && r.who === 15) byFullBack++;
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`THROUGH with the full-back 7 m ahead: ${JSON.stringify(tally)} of ${n}, ${through} through balls, ${byFullBack} cut out by the full-back`);
    expect(through).toBe(n);
    expect(tally.ok / n).toBeGreaterThanOrEqual(0.8);
    expect(byFullBack / n).toBeLessThanOrEqual(0.1);
  }, 60_000);

  it('THROUGH held (0.4 s) is the lofted ball; a tap is the through ball', () => {
    const m0 = probeDiag(5, 'jogging', 'through', { deg: 55, zw: 3 }, 'ball', 0, 5, false);
    expect(m0.kind).toBe('through');
    const m1 = probeDiag(5, 'jogging', 'through', { deg: 55, zw: 3 }, 'ball', 0, 24, false);
    expect(m1.kind).toBe('lob');
  });

  it('the stick straight ahead with the winger 48 degrees off and marked: the ball goes to him, never to a man behind', () => {
    // (Round 12, the critic: 3 of 9 forward-stick probes played a defender at -119 degrees behind the carrier.)
    for (const seed of [1, 2, 3]) {
      for (const state of ['standing', 'jogging'] as WingState[]) {
        const m = scenario(seed * 17);
        const ad = m.attackDir(0);
        const c = m.players[7];
        const w = m.players[8];
        const mk = m.players[17];
        const behind = m.players[6];
        place(c, -6 * ad, 0);
        c.facing = ad > 0 ? 0 : Math.PI;
        place(w, 18 * ad, 27);
        place(mk, 14.5 * ad, 26);
        place(behind, -18 * ad, -28);
        if (state === 'jogging') {
          w.vel.x = 5 * ad;
          w.running = true;
          w.runT = 2.5;
        }
        giveBall(m, c);
        let kind = '';
        for (let i = 0; i < 40 && !kind; i++) {
          m.step(DT, pad(ad, 0, { pass: i < 5 }));
          const k = m.drainEvents().find((e) => e.type === 'kick');
          if (k && k.type === 'kick') kind = k.kind;
        }
        expect(kind).toBe('pass');
        expect(m.passTarget).toBe(w.idx);
      }
    }
  });
});

// ------------------------------------------------------------------ round 13 (the critic's leftovers)

/**
 * The diagonal ball the critic measured in round 12, as he measured it: the winger 24-36 m away at 48-65 degrees off the
 * carrier's facing, 3 m in from the touchline, a marker 2-3 m off the lane (short of him on the ball side, or beyond him
 * on the goal side), a full-back 7 m ahead; the stick at him, held; PASS / THROUGH tapped for 80 ms.
 */
function probeDiag2(seed: number, state: WingState, btn: 'pass' | 'through', d: number, deg: number, mOff: number, marker: MarkerSide): Outcome {
  const m = scenario(seed);
  const ad = m.attackDir(0);
  const c = m.players[7];
  const w = m.players[8];
  const mk = m.players[17];
  const fb = m.players[15];
  const th = (deg * Math.PI) / 180;
  const wz = HALF_W - 3;
  const cx = -6;
  place(c, cx * ad, wz - d * Math.sin(th));
  c.facing = ad > 0 ? 0 : Math.PI;
  const wx = cx + d * Math.cos(th);
  place(w, wx * ad, wz);
  const ux = Math.cos(th);
  const uz = Math.sin(th);
  const along = marker === 'ball' ? -3 : 3;
  place(mk, (wx + ux * along + uz * mOff) * ad, wz + uz * along - ux * mOff);
  place(fb, (wx + 7) * ad, wz - 2);
  mk.facing = fb.facing = ad > 0 ? Math.PI : 0;
  if (state !== 'standing') {
    w.vel.x = (state === 'jogging' ? 5 : 8.5) * ad;
    w.running = true;
    w.runT = 2.5;
    w.sprint = state === 'sprinting';
    w.facing = c.facing;
  }
  giveBall(m, c);
  const a = Math.atan2(w.pos.z - c.pos.z, w.pos.x - c.pos.x);
  let kicked = false;
  for (let i = 0; i < 60 * 4; i++) {
    m.step(DT, pad(Math.cos(a), Math.sin(a), { [btn]: i < 5 }));
    const evs = m.drainEvents();
    if (!kicked) {
      kicked = evs.some((e) => e.type === 'kick');
      continue;
    }
    if (m.phase !== 'play') return 'out';
    const ctl = evs.find((e) => e.type === 'control');
    const o = ctl && ctl.type === 'control' ? ctl.player : m.ball.owner;
    if (o >= 0 && o !== c.idx) return o === w.idx ? 'ok' : m.players[o].side === 0 ? 'mate' : 'int';
  }
  return 'none';
}

describe('round 13: the critic\'s leftovers', () => {
  it('the diagonal to a marked winger (24-36 m, 48-65 degrees, marker 2-3 m off the lane) is completed 80%+', () => {
    for (const btn of ['pass', 'through'] as const) {
      const tally: Record<Outcome, number> = { ok: 0, mate: 0, int: 0, out: 0, none: 0 };
      let n = 0;
      let seed = 3;
      for (const d of [24, 30, 36]) {
        for (const deg of [48, 56, 65]) {
          for (const mOff of [2, 2.5, 3]) {
            for (const marker of ['ball', 'goal'] as MarkerSide[]) {
              for (const state of ['standing', 'jogging', 'sprinting'] as WingState[]) {
                tally[probeDiag2((seed += 37), state, btn, d, deg, mOff, marker)]++;
                n++;
              }
            }
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`round-13 diagonal ${btn}: ${JSON.stringify(tally)} of ${n}`);
      expect(tally.ok / n).toBeGreaterThanOrEqual(0.8);
    }
  }, 120_000);

  it('an 80 ms THROUGH tap (4-6 frames) is always a through ball, never a pass, runner or not', () => {
    let n = 0;
    const kinds: Record<string, number> = {};
    for (const frames of [4, 5, 6]) {
      for (const state of ['standing', 'jogging', 'sprinting'] as WingState[]) {
        for (let k = 0; k < 4; k++) {
          const r = probeDiag(k * 19 + frames * 7, state, 'through', { deg: [48, 55, 60, 65][k], zw: 3 }, 'ball', 0, frames, k % 2 === 0);
          kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
          n++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`THROUGH taps of 67-100 ms: ${JSON.stringify(kinds)} of ${n}`);
    expect(kinds.through).toBe(n);
  }, 60_000);

  it('the pass assist never plays a man more than ~95 degrees off the stick (no ball behind him against a forward stick)', () => {
    let checked = 0;
    let worst = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const m = scenario(seed * 7);
      const c = m.players[6];
      place(c, ((seed % 9) - 4) * 5, ((seed % 7) - 3) * 4);
      c.facing = (seed % 12) * 0.52;
      // Teammates and opponents scattered round him, a few marked.
      let r = seed * 2654435761;
      const rnd = () => {
        r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
        return r / 4294967296;
      };
      for (const p of m.players) {
        if (p === c || p.isKeeper) continue;
        place(p, c.pos.x + (rnd() - 0.5) * 60, clamp((rnd() - 0.5) * 56, -HALF_W + 1, HALF_W - 1));
      }
      giveBall(m, c);
      for (let a = 0; a < 8; a++) {
        const sa = (a * Math.PI) / 4 + rnd() * 0.3;
        const dx = Math.cos(sa);
        const dz = Math.sin(sa);
        for (const t of [pickReceiver(m, c, dx, dz, 'pass'), pickReceiver(m, c, dx, dz, 'through'), humanThroughTarget(m, c, dx, dz).idx]) {
          if (t < 0) continue;
          const q = m.players[t];
          const off = Math.abs(Math.atan2(Math.sin(Math.atan2(q.pos.z - c.pos.z, q.pos.x - c.pos.x) - sa), Math.cos(Math.atan2(q.pos.z - c.pos.z, q.pos.x - c.pos.x) - sa)));
          worst = Math.max(worst, off);
          checked++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`pass assist: ${checked} picks, widest ${((worst * 180) / Math.PI).toFixed(1)} degrees off the stick`);
    expect(checked).toBeGreaterThan(500);
    expect(worst).toBeLessThanOrEqual((95.5 * Math.PI) / 180);
  });
});

// ------------------------------------------------------------------ whole matches

interface WingTally {
  n: number;
  ok: number;
  /** ... of which the man it was for took it himself. */
  toMan: number;
  int: number;
  throwIn: number;
  other: number;
  none: number;
}

/**
 * The scripted bot (playing it out to the wings the way the owner does: BotOptions.wing) plays `n` whole
 * matches; every open-play pass / through ball of his from the central lane (|z| under a third of the
 * half-width) to a man within 8 m of a touchline is followed to its outcome.
 */
function wingMatches(n: number, difficulty = 1.8): WingTally {
  const t: WingTally = { n: 0, ok: 0, toMan: 0, int: 0, throwIn: 0, other: 0, none: 0 };
  for (let i = 0; i < n; i++) {
    const k = 2 + (Math.floor(i / 2) % 8);
    const [home, away] = i % 2 === 0 ? [k, k + 1] : [k + 1, k];
    const seed = 5000 + i * 97;
    const m = new Match({ home: makeTeam(PRESET_CLUBS[home]), away: makeTeam(PRESET_CLUBS[away]), halfLength: 120, difficulty, humanSide: 0, seed });
    const bot = new HumanBot(seed, { wing: true });
    let pending: { target: number; f: number } | null = null;
    for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 60 * 16; steps++) {
      const pad = bot.pad(m);
      const before = m.ball.owner;
      m.step(DT, pad);
      const evs = m.drainEvents();
      bot.observe(m, evs, before);
      for (const e of evs) {
        if (pending) {
          if (e.type === 'control') {
            if (m.players[e.player].side === 0) {
              t.ok++;
              if (e.player === pending.target) t.toMan++;
            } else t.int++;
            pending = null;
          } else if (e.type === 'restart' || e.type === 'goal' || e.type === 'halftime' || e.type === 'fulltime') {
            // (The whistle mid-pass isn't the pass's fault.)
            if (e.type === 'restart' && e.kind === 'throwin') t.throwIn++;
            else t.other++;
            pending = null;
          }
        } else if (e.type === 'kick' && (e.kind === 'pass' || e.kind === 'through') && m.phase === 'play' && m.setPieceKick !== m.kickId &&
          m.passTarget >= 0 && m.ball.lastTouchSide === 0 && Math.abs(e.z) < HALF_W / 3 && Math.abs(e.x) < HALF_L) {
          const r = m.players[m.passTarget];
          if (Math.abs(r.pos.z) >= HALF_W - 8) {
            t.n++;
            pending = { target: r.idx, f: steps };
          }
        }
      }
      if (pending && steps - pending.f > 240) {
        t.none++;
        pending = null;
      }
      if (m.phase === 'halftime') {
        m.aiSubs(1, 2);
        m.continueSecondHalf();
      }
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
  }
  return t;
}

describe('passing to the wings over whole matches', () => {
  it('the bot\'s passes from the middle out to a man near the touchline are mostly completed, and rarely run out for a throw-in', () => {
    // (Round 13: the support triangle, a short option either side of the carrier and one ahead, gives the bot more
    // passes inside, so it finds a centre-to-wing ball ~3 a match rather than ~7: 20 matches for the same sample.)
    const t = wingMatches(20);
    const pct = (x: number) => ((100 * x) / Math.max(1, t.n)).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(`centre-to-wing passes: ${t.n}: completed ${pct(t.ok)}% (to the man ${pct(t.toMan)}%), intercepted ${pct(t.int)}%, throw-in ${pct(t.throwIn)}%, other ${pct(t.other)}%, none ${pct(t.none)}%`);
    // (Round 10, before: 40 such passes at 90% completed, 2.5% intercepted, 7.5% into touch; the plain bot only
    // played them when the man was well clear. With the wing-happy bot, before the receiver fix: 29 passes, 83%
    // completed, 17% into touch, and 12% of the rest taken by a teammate near the passer.)
    expect(t.n).toBeGreaterThan(40);
    expect(t.ok / t.n).toBeGreaterThanOrEqual(0.8);
    expect(t.toMan / t.n).toBeGreaterThanOrEqual(0.75);
    expect(t.int / t.n).toBeLessThanOrEqual(0.1);
    expect(t.throwIn / t.n).toBeLessThanOrEqual(0.05);
  }, 180_000);
});
