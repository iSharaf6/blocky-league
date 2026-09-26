import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
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
    const t = wingMatches(10);
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
