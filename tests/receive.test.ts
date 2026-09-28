import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { natural } from '../src/sim/actions';
import { DT, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, RECV_MAGNET_R, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';

/**
 * Round 13, the owner: "when i pass it down the line to player running and hes moving with wasd, sometimes it goes past
 * him and i find that very very very very annoying", and "most of the time the pass from a player to another are
 * exactly straight". Scripted-human probes: the carrier in midfield, a winger 4 m in from the touchline running on, a
 * PASS / THROUGH tap at him; control goes to him at the kick; the keys are let go for a moment (as a keyboard player
 * does after the tap) and then the stick is held along the line (or 25 degrees off it), sprint or not.
 */

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}
const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

function scenario(seed: number): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.drainEvents();
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
  return m;
}

function giveBall(m: Match, p: Player): void {
  m.ball.reset(p.footX(), p.footZ());
  m.ball.owner = p.idx;
  m.ball.lastTouch = p.idx;
  m.ball.lastTouchSide = p.side;
  m.active = p.idx;
  m.updateBallPath();
}

interface Steer {
  d: number;
  deg: number;
  speed: number;
  /** Stick off the line (rad, + towards the middle), after `gap` frames with it let go; `away`: clearly off the line. */
  off: number;
  gap: number;
  sprint: boolean;
  digital: boolean;
  btn: 'pass' | 'through';
}

/** The winger `d` m away at `deg` off the line (the carrier behind him, inside), running on at `speed`; a full-back 14 m ahead. */
function steerProbe(seed: number, g: Steer): 'ok' | 'int' | 'out' | 'none' {
  const m = scenario(seed);
  const ad = m.attackDir(0);
  const c = m.players[7];
  const w = m.players[8];
  const fb = m.players[15];
  const wz = HALF_W - 4;
  const th = (g.deg * Math.PI) / 180;
  place(c, -8 * ad, wz - g.d * Math.sin(th));
  c.facing = ad > 0 ? 0 : Math.PI;
  place(w, (-8 + g.d * Math.cos(th)) * ad, wz);
  w.vel.x = g.speed * ad;
  w.facing = c.facing;
  w.running = true;
  w.runT = 3;
  place(fb, (-8 + g.d * Math.cos(th) + 14) * ad, wz - 5);
  giveBall(m, c);
  const a0 = Math.atan2(w.pos.z - c.pos.z, w.pos.x - c.pos.x);
  let kicked = -1;
  for (let i = 0; i < 60 * 4; i++) {
    let sx = Math.cos(a0);
    let sz = Math.sin(a0);
    if (kicked >= 0) {
      if (i - kicked < g.gap) sx = sz = 0;
      else {
        const a = (ad > 0 ? 0 : Math.PI) - g.off * ad;
        sx = Math.cos(a);
        sz = Math.sin(a);
        if (g.digital) {
          sx = Math.round(sx * 1.2);
          sz = Math.round(sz * 1.2);
          const l = Math.hypot(sx, sz) || 1;
          sx /= l;
          sz /= l;
        }
      }
    }
    m.step(DT, pad(sx, sz, { [g.btn]: i < 5, sprint: kicked >= 0 && g.sprint, digital: g.digital }));
    const evs = m.drainEvents();
    if (kicked < 0) {
      if (evs.some((e) => e.type === 'kick')) kicked = i;
      continue;
    }
    if (m.phase !== 'play') return 'out';
    const ctl = evs.find((e) => e.type === 'control');
    const o = ctl && ctl.type === 'control' ? ctl.player : m.ball.owner;
    if (o >= 0 && o !== c.idx) return o === w.idx ? 'ok' : 'int';
  }
  return 'none';
}

function sweep(btn: 'pass' | 'through', digital: boolean): { n: number; ok: number; byOff: Record<string, [number, number]> } {
  const byOff: Record<string, [number, number]> = {};
  let n = 0;
  let ok = 0;
  let seed = 7;
  for (const offDeg of [0, 25, -25]) {
    for (const gap of [8, 20]) {
      for (const d of [18, 26, 34]) {
        for (const deg of [4, 10, 18]) {
          for (const speed of [6.5, 8.5]) {
            for (const sprint of [false, true]) {
              const r = steerProbe((seed += 31), { d, deg, speed, off: (offDeg * Math.PI) / 180, gap, sprint, digital, btn });
              n++;
              const b = (byOff[`off${offDeg}`] ??= [0, 0]);
              b[1]++;
              if (r === 'ok') {
                ok++;
                b[0]++;
              }
            }
          }
        }
      }
    }
  }
  return { n, ok, byOff };
}

describe('steering onto the pass (round 13)', () => {
  for (const btn of ['pass', 'through'] as const) {
    it(`${btn} down the line, keys let go then held along it (or 25 degrees off): he takes it`, () => {
      const ana = sweep(btn, false);
      const dig = sweep(btn, true);
      const f = (s: typeof ana) => `${s.ok}/${s.n} [${Object.entries(s.byOff).map(([k, v]) => `${k} ${v[0]}/${v[1]}`).join(', ')}]`;
      // eslint-disable-next-line no-console
      console.log(`steered ${btn}: analog ${f(ana)} | keys ${f(dig)}`);
      // (Before, with the keys let go for 8-20 frames after the tap and then held along the line: 13% / 21% of PASS and
      // 10% / 18% of THROUGH taken, 0-1% with the stick 25 degrees off either way. The assisted receive stopped the
      // moment the stick came back, a runner sprinting on outran a ball that was slowing down, and one that drifted a
      // stride inside watched it roll past on the outside.)
      // (On keys the stick is along the line or 45 degrees off it: along it the same; W+A / W+D at 45 degrees is a man
      // cutting away from the line as much as with it, and he still takes most.)
      expect(ana.ok / ana.n).toBeGreaterThanOrEqual(0.9);
      for (const k of ['off0', 'off25', 'off-25']) expect(ana.byOff[k][0] / ana.byOff[k][1], `analog ${k}`).toBeGreaterThanOrEqual(0.8);
      expect(ana.byOff.off0[0] / ana.byOff.off0[1]).toBeGreaterThanOrEqual(0.95);
      expect(dig.byOff.off0[0] / dig.byOff.off0[1]).toBeGreaterThanOrEqual(0.95);
      expect(dig.ok / dig.n).toBeGreaterThanOrEqual(0.7);
    }, 120_000);
  }

  it('a man steering clearly away from the ball is not magnetised onto it', () => {
    // The ball rolls past 1.1 m to the side of him (inside the magnet's RECV_MAGNET_R, outside his normal reach when
    // he's facing away from it): steering along its line he takes it; steering straight away from its line he doesn't.
    let along = 0;
    let away = 0;
    const n = 12;
    for (let k = 0; k < n; k++) {
      for (const mode of ['along', 'away'] as const) {
        const m = scenario(100 + k * 7);
        const ad = m.attackDir(0);
        const c = m.players[7];
        const w = m.players[8];
        place(c, -10 * ad, 0);
        c.facing = ad > 0 ? 0 : Math.PI;
        place(w, (8 + (k % 3)) * ad, 0);
        w.facing = c.facing;
        giveBall(m, c);
        let kicked = -1;
        let got = false;
        let sx = ad;
        let sz = 0;
        for (let i = 0; i < 60 * 3 && !got; i++) {
          if (kicked >= 0 && i - kicked === 2) {
            // Just after the strike: a stride off the ball's predicted line, 1.1 m across it at its nearest point, and
            // from then on the stick held one way: along the ball's run, or square away from its line.
            m.updateBallPath();
            let near = m.ballPath[0];
            for (const q of m.ballPath) {
              if (Math.hypot(q.x - w.pos.x, q.z - w.pos.z) < Math.hypot(near.x - w.pos.x, near.z - w.pos.z)) near = q;
            }
            const b = m.ball;
            const bs = Math.hypot(b.vel.x, b.vel.z) || 1;
            const nx = -b.vel.z / bs;
            const nz = b.vel.x / bs;
            w.pos.x = near.x + nx * 1.1;
            w.pos.z = near.z + nz * 1.1;
            w.vel.x = w.vel.z = 0;
            w.facing = Math.atan2(nz, nx);
            sx = mode === 'away' ? nx : b.vel.x / bs;
            sz = mode === 'away' ? nz : b.vel.z / bs;
          }
          m.step(DT, pad(kicked < 0 ? ad : sx, kicked < 0 ? 0 : sz, { pass: i < 3 }));
          const evs = m.drainEvents();
          if (kicked < 0 && evs.some((e) => e.type === 'kick')) kicked = i;
          got = kicked >= 0 && (m.ball.owner === w.idx || evs.some((e) => e.type === 'control' && e.player === w.idx));
        }
        if (got && mode === 'along') along++;
        if (got && mode === 'away') away++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`ball 1.1 m to his side (magnet ${RECV_MAGNET_R} m): steering along its line ${along}/${n} taken, steering away ${away}/${n}`);
    expect(along / n).toBeGreaterThanOrEqual(0.9);
    expect(away / n).toBeLessThanOrEqual(0.2);
  }, 60_000);
});

describe('passes that are not laser-straight (round 13)', () => {
  /** A human's assisted PASS to a free man `d` m away at angle `a` off the carrier's facing: the ball's path until he has it. */
  function passPath(seed: number, d: number, a: number): { bow: number; got: boolean; sign: number } {
    const m = scenario(seed);
    const c = m.players[6];
    const mate = m.players[9];
    const cx = -14 + (seed % 7) * 1.3;
    const cz = ((seed % 5) - 2) * 1.7;
    place(c, cx, cz);
    c.facing = 0;
    place(mate, cx + Math.cos(a) * d, cz + Math.sin(a) * d);
    mate.facing = Math.PI + a;
    giveBall(m, c);
    const pts: { x: number; z: number }[] = [];
    let kicked = false;
    let got = false;
    for (let i = 0; i < 60 * 4 && !got; i++) {
      m.step(DT, pad(Math.cos(a), Math.sin(a), { pass: i < 2 }));
      const evs = m.drainEvents();
      if (evs.some((e) => e.type === 'kick')) kicked = true;
      if (kicked && m.ball.owner < 0) pts.push({ x: m.ball.pos.x, z: m.ball.pos.z });
      got = m.ball.owner === mate.idx || evs.some((e) => e.type === 'control' && e.player === mate.idx);
    }
    if (pts.length < 3) return { bow: 0, got, sign: 0 };
    const s = pts[0];
    const e = pts[pts.length - 1];
    const l = Math.hypot(e.x - s.x, e.z - s.z) || 1;
    let bow = 0;
    let sign = 0;
    for (const p of pts) {
      const lat = (-(p.x - s.x) * (e.z - s.z) + (p.z - s.z) * (e.x - s.x)) / l;
      if (Math.abs(lat) > Math.abs(bow)) bow = lat;
      sign = Math.sign(bow);
    }
    return { bow: Math.abs(bow), got, sign };
  }

  it('a ground pass over 12 m bends a little (0.2-0.9 m over 18-24 m), both ways, and still finds its man; a short one is straight', () => {
    const long: number[] = [];
    const short: number[] = [];
    const signs = new Set<number>();
    let got = 0;
    let n = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const a = [0, 0.5, -0.5, 1.0, -1.0, 1.4][seed % 6];
      const r = passPath(seed * 13, 18 + (seed % 4) * 2, a);
      n++;
      if (r.got) {
        got++;
        long.push(r.bow);
        if (r.sign) signs.add(r.sign);
      }
      short.push(passPath(seed * 13 + 1, 8, a).bow);
    }
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    // eslint-disable-next-line no-console
    console.log(`natural passes: 18-24 m bow mean ${mean(long).toFixed(2)} m (${Math.min(...long).toFixed(2)}-${Math.max(...long).toFixed(2)}), 8 m ${mean(short).toFixed(2)} m, taken ${got}/${n}`);
    // (Before: every pass was dead straight, 0.00 m.)
    expect(mean(long)).toBeGreaterThan(0.25);
    expect(mean(long)).toBeLessThan(0.8);
    expect(Math.max(...long)).toBeLessThan(1.1);
    expect(mean(short)).toBeLessThan(0.1);
    expect(signs.size).toBe(2);
    expect(got / n).toBeGreaterThanOrEqual(0.95);
  }, 60_000);

  it('the variety comes from the kick number, not the match rng (the same on every machine)', () => {
    const xs = Array.from({ length: 2000 }, (_, k) => natural(k, 2));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.03);
    expect(natural(41, 2)).toBe(natural(41, 2));
    expect(natural(41, 2)).not.toBe(natural(41, 3));
  });
});
