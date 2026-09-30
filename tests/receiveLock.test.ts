import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';

/**
 * The receive lock (Match.receiveLocked). A playtester: "when you pass you have to wait for your player to receive the
 * ball before you run ykwim / theres no auto lock / like i tried changing direction as im receiving the ball / but it
 * doesnt work the guy just runs off without the ball". While the human's side's pass is on its way to the man he now
 * controls, the sim runs that man onto the ball whatever the stick says; the stick is the first touch's direction.
 *
 * Deterministic probes: a free carrier in his own half, a free mate 12-25 m away at a few angles, everyone else parked
 * far off the lane (re-parked every frame, so nobody wanders into it). A PASS tap at the mate; from the switch on the
 * stick is held in one of 8 directions around the ball's line (0 = back at the passer, 180 = straight away from it).
 */

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}
const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

interface Setup {
  m: Match;
  c: Player;
  mate: Player;
  ad: number;
  parked: { p: Player; x: number; z: number; face?: number }[];
}

/** Carrier 10 m inside his own half; the mate `d` m away at `deg` off straight up field; the rest parked well away. */
function setup(seed: number, d: number, deg: number): Setup {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.clock = 20;
  m.drainEvents();
  const ad = m.attackDir(0);
  const c = m.players[6];
  const mate = m.players[9];
  const cx = -10 * ad;
  const cz = 0;
  const th = (deg * Math.PI) / 180;
  place(c, cx, cz);
  const a0 = Math.atan2(Math.sin(th), Math.cos(th) * ad);
  c.facing = a0;
  place(mate, cx + Math.cos(th) * d * ad, cz + Math.sin(th) * d);
  mate.facing = a0 + Math.PI;
  const parked: Setup['parked'] = [];
  let k = 0;
  for (const p of m.players) {
    if (p === c || p === mate) continue;
    // Our men along the far end's left touchline, theirs along its right one: 30+ m from every lane.
    const x = (30 + (k % 6) * 3) * ad;
    const z = p.side === 0 ? -28 + Math.floor(k / 6) * 0.1 : 28 - Math.floor(k / 6) * 0.1;
    k++;
    place(p, x + (p.side === 0 ? 0 : 1.5 * ad), z);
    parked.push({ p, x: p.pos.x, z: p.pos.z });
  }
  m.ball.reset(c.footX(), c.footZ());
  m.ball.owner = c.idx;
  m.ball.lastTouch = c.idx;
  m.ball.lastTouchSide = 0;
  m.active = c.idx;
  m.updateBallPath();
  return { m, c, mate, ad, parked };
}

function repark(s: Setup): void {
  for (const q of s.parked) {
    q.p.pos.x = q.x;
    q.p.pos.z = q.z;
    q.p.vel.x = q.p.vel.z = 0;
    if (q.face !== undefined) q.p.facing = q.face;
  }
}

interface Result {
  got: 'ok' | 'int' | 'mate' | 'out' | 'none';
  /** The ball's run over the 0.4 s after he took it, off the stick (rad; NaN with no stick or no ball), and kept. */
  touchOff: number;
  kept: boolean;
}

/**
 * The human taps PASS (or THROUGH) at the mate; from the kick on the stick is held at `rel` rad round from the way back
 * to the passer (or let go: rel null), sprint held or not.
 */
/**
 * How the stick comes to be held: 'switch' from the switch on; 'gap' let go for GAP frames after the kick (a keyboard
 * player off the key after the tap) and then pressed; 'swing' still along the pass for SWING frames, then swung.
 */
type Mode = 'switch' | 'gap' | 'swing';
const GAP = 6;
const SWING = 14;

function probe(s: Setup, rel: number | null, sprint: boolean, btn: 'pass' | 'through' = 'pass', mode: Mode = 'switch'): Result {
  const { m, c, mate } = s;
  const a0 = Math.atan2(mate.pos.z - c.pos.z, mate.pos.x - c.pos.x);
  let kicked = -1;
  let sx = 0;
  let sz = 0;
  let owned = -1;
  let bx0 = 0;
  let bz0 = 0;
  let got: Result['got'] = 'none';
  for (let i = 0; i < 60 * 5; i++) {
    let mx = Math.cos(a0);
    let mz = Math.sin(a0);
    if (kicked >= 0) {
      const since = i - kicked;
      if (mode === 'gap' && since <= GAP) mx = mz = 0;
      else if (mode !== 'swing' || since > SWING) {
        mx = sx;
        mz = sz;
      }
    }
    m.step(DT, pad(mx, mz, { [btn]: i < 4, sprint: kicked >= 0 && sprint }));
    repark(s);
    const evs = m.drainEvents();
    if (kicked < 0) {
      if (evs.some((e) => e.type === 'kick')) {
        kicked = i;
        // The stick from the switch on: `rel` round from the way back to the passer (the ball's line).
        const back = Math.atan2(c.pos.z - mate.pos.z, c.pos.x - mate.pos.x);
        if (rel !== null) {
          sx = Math.cos(back + rel);
          sz = Math.sin(back + rel);
        }
      }
      if (i > 60) break;
      continue;
    }
    if (owned < 0) {
      if (m.phase !== 'play') {
        got = 'out';
        break;
      }
      const ctl = evs.find((e) => e.type === 'control');
      const o = ctl && ctl.type === 'control' ? ctl.player : m.ball.owner;
      const touchedByThem = m.ball.lastTouchSide === 1;
      if (o === mate.idx) {
        got = 'ok';
        owned = i;
        bx0 = m.ball.pos.x;
        bz0 = m.ball.pos.z;
      } else if ((o >= 0 && m.players[o].side === 1) || touchedByThem) {
        got = 'int';
        break;
      } else if (o >= 0 && o !== c.idx) {
        got = 'mate';
        break;
      }
    } else if (i - owned === 24) {
      const kept = m.ball.owner === mate.idx;
      const dx = m.ball.pos.x - bx0;
      const dz = m.ball.pos.z - bz0;
      let off = NaN;
      if (rel !== null && Math.hypot(dx, dz) > 0.2) {
        off = Math.abs(Math.atan2(dx * sz - dz * sx, dx * sx + dz * sz));
      }
      return { got, touchOff: off, kept };
    }
  }
  return { got, touchOff: NaN, kept: false };
}

const DIRS = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);

describe('receive lock: the stick is the first touch, not the run', () => {
  for (const mode of ['switch', 'gap', 'swing'] as const) it(`a ground pass 12-25 m is taken whichever way the stick is held (${mode}), 95%+, and the touch goes the stick's way`, () => {
    const byDir: [number, number][] = DIRS.map(() => [0, 0]);
    let n = 0;
    let ok = 0;
    let touchN = 0;
    let touchIn = 0;
    let keptN = 0;
    const fails: string[] = [];
    let seed = 11;
    for (const d of [12, 18, 25]) {
      for (const deg of [0, 55, -90, 140]) {
        for (const sprint of [false, true]) {
          for (let sd = 0; sd < 2; sd++) {
            seed += 17;
            DIRS.forEach((rel, k) => {
              const s = setup(seed, d, deg);
              const r = probe(s, rel, sprint, 'pass', mode);
              n++;
              byDir[k][1]++;
              if (r.got === 'ok') {
                ok++;
                byDir[k][0]++;
                if (!Number.isNaN(r.touchOff)) {
                  touchN++;
                  if (r.touchOff <= (35 * Math.PI) / 180) touchIn++;
                }
                if (r.kept) keptN++;
              } else if (fails.length < 10) fails.push(`d ${d} deg ${deg} dir ${k * 45} sprint ${sprint}: ${r.got}`);
            });
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`receive lock (${mode}): taken ${ok}/${n} [${byDir.map((b, k) => `${k * 45}: ${b[0]}/${b[1]}`).join(', ')}]; ` +
      `touch within 35 deg of the stick ${touchIn}/${touchN}, kept 0.4 s on ${keptN}/${ok}${fails.length ? `\n  ${fails.join('\n  ')}` : ''}`);
    expect(ok / n).toBeGreaterThanOrEqual(0.95);
    for (const b of byDir) expect(b[0] / b[1]).toBeGreaterThanOrEqual(0.85);
    expect(touchIn / touchN).toBeGreaterThanOrEqual(0.85);
    expect(keptN / ok).toBeGreaterThanOrEqual(0.9);
  }, 180_000);

  it('no stick: he takes it and settles it, facing up field', () => {
    let ok = 0;
    let up = 0;
    let n = 0;
    let seed = 5;
    for (const d of [12, 18, 25]) {
      for (const deg of [0, 55, -90, 140]) {
        const s = setup((seed += 23), d, deg);
        const r = probe(s, null, false);
        n++;
        if (r.got === 'ok') ok++;
        // 0.5 s after the switch settles, he's turned up field.
        if (r.got === 'ok' && r.kept && Math.cos(s.mate.facing) * s.ad > 0.3) up++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`receive lock, no stick: taken ${ok}/${n}, facing up field after the settle ${up}/${ok}`);
    expect(ok / n).toBeGreaterThanOrEqual(0.95);
    expect(up / Math.max(1, ok)).toBeGreaterThanOrEqual(0.8);
  }, 60_000);

  it('a through ball into space leads him onto it, the stick held any way', () => {
    let ok = 0;
    let n = 0;
    let seed = 3;
    for (const d of [14, 20]) {
      for (const deg of [10, 35, -35]) {
        for (const k of [0, 2, 4, 6]) {
          const s = setup((seed += 29), d, deg);
          // The mate already on his way up field: a ball into space ahead of him.
          s.mate.vel.x = 6 * s.ad;
          s.mate.facing = s.ad > 0 ? 0 : Math.PI;
          s.mate.running = true;
          s.mate.runT = 3;
          const r = probe(s, DIRS[k], k % 4 === 0, 'through', 'gap');
          n++;
          if (r.got === 'ok') ok++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`receive lock, through balls into space: taken ${ok}/${n}`);
    expect(ok / n).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it('an opponent standing in the lane still cuts it out: the lock does not ghost the ball through him', () => {
    let int = 0;
    let n = 0;
    let seed = 41;
    const fails: string[] = [];
    for (const d of [16, 22]) {
      for (const deg of [0, 50, -90]) {
        for (const f of [0.45, 0.7]) {
          for (const k of [0, 4]) {
            const s = setup((seed += 13), d, deg);
            // One of theirs standing still right on the line, f of the way to the mate, facing the passer.
            const mo = s.parked.find((q) => q.p.side === 1 && !q.p.isKeeper)!;
            mo.x = s.c.pos.x + (s.mate.pos.x - s.c.pos.x) * f;
            mo.z = s.c.pos.z + (s.mate.pos.z - s.c.pos.z) * f;
            place(mo.p, mo.x, mo.z);
            mo.face = Math.atan2(s.c.pos.z - mo.z, s.c.pos.x - mo.x);
            mo.p.facing = mo.face;
            const r = probe(s, DIRS[k], k === 4, 'pass', 'gap');
            n++;
            if (r.got === 'int') int++;
            else fails.push(`d ${d} deg ${deg} f ${f} dir ${k * 45}: ${r.got}`);
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`receive lock, a man standing in the lane: cut out ${int}/${n}${fails.length ? `\n  ${fails.join('\n  ')}` : ''}`);
    expect(int / n).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it('SHOOT or PASS pressed as it arrives still strikes it first time, whichever way the stick is held', () => {
    const tally = { shoot: [0, 0], pass: [0, 0] };
    let seed = 71;
    for (const btn of ['shoot', 'pass'] as const) {
      for (const d of [14, 20]) {
        for (const deg of [0, 40, -60]) {
          for (const k of [0, 2, 4, 6]) {
            const s = setup((seed += 11), d, deg);
            const { m, c, mate } = s;
            const a0 = Math.atan2(mate.pos.z - c.pos.z, mate.pos.x - c.pos.x);
            const back = a0 + Math.PI;
            let kicked = -1;
            let pressed = false;
            let first = false;
            let controlled = false;
            for (let i = 0; i < 60 * 4 && !first && !controlled; i++) {
              const near = kicked >= 0 && Math.hypot(m.ball.pos.x - mate.pos.x, m.ball.pos.z - mate.pos.z) < 3.5;
              const press = near && !pressed;
              if (press) pressed = true;
              const mx = kicked < 0 ? Math.cos(a0) : Math.cos(back + DIRS[k]);
              const mz = kicked < 0 ? Math.sin(a0) : Math.sin(back + DIRS[k]);
              m.step(DT, pad(mx, mz, { pass: i < 4 || (btn === 'pass' && press), shoot: btn === 'shoot' && press }));
              repark(s);
              for (const e of m.drainEvents()) {
                if (e.type === 'kick' && kicked < 0) kicked = i;
                else if (e.type === 'kick' && m.ball.lastTouch === mate.idx) first = true;
                if (e.type === 'control' && e.player === mate.idx) controlled = true;
              }
            }
            tally[btn][1]++;
            if (first) tally[btn][0]++;
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`receive lock, first time: SHOOT ${tally.shoot[0]}/${tally.shoot[1]}, PASS ${tally.pass[0]}/${tally.pass[1]}`);
    expect(tally.shoot[0] / tally.shoot[1]).toBeGreaterThanOrEqual(0.9);
    expect(tally.pass[0] / tally.pass[1]).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});
