import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { humanGroundSpeed, pickReceiver, resolveKick } from '../src/sim/actions';
import { DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { KickOrder, Player } from '../src/sim/player';

/*
 * Attacking feel (round 9, the owner: "very hard to make a pass ... when i press pass ... ball is intercepted
 * ... very hard to cross and shoot"). The target is Mario Strikers / arcade FIFA: the press is answered at once,
 * the ball zips to feet, the man it'll go to is shown before the press and runs on the press, crosses find the
 * box runner, and a shot with the stick at goal goes for the corner the keeper leaves.
 */

/** Open play with the human on side 0 and everyone parked along the far touchline, out of the way. */
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

function giveBall(m: Match, p: Player): void {
  m.ball.reset(p.footX(), p.footZ());
  m.ball.owner = p.idx;
  m.ball.lastTouch = p.idx;
  m.ball.lastTouchSide = p.side;
  m.active = p.idx;
  m.updateBallPath();
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

/** Step until the first strike of the ball (or `max` frames): the frame it came on and the ball's launch speed. */
function untilKick(m: Match, input: (i: number) => Pad, max = 90): { i: number; speed: number; kind: string } | null {
  for (let i = 0; i < max; i++) {
    m.step(DT, input(i));
    const e = m.drainEvents().find((x) => x.type === 'kick');
    if (e && e.type === 'kick') return { i, speed: Math.hypot(m.ball.vel.x, m.ball.vel.z), kind: e.kind };
  }
  return null;
}

/** The passer in midfield facing their goal with the ball, a teammate 15 m away `deg` degrees off his facing. */
function passSetup(seed: number, deg: number): { m: Match; c: Player; mate: Player; a: number } {
  const m = scenario(seed);
  const c = m.players[6];
  const mate = m.players[8];
  place(c, 0, 0);
  c.facing = m.attackDir(0) > 0 ? 0 : Math.PI;
  const a = c.facing + (seed % 2 ? 1 : -1) * ((deg * Math.PI) / 180);
  place(mate, Math.cos(a) * 15, Math.sin(a) * 15);
  giveBall(m, c);
  return { m, c, mate, a };
}

describe('instant passing', () => {
  it('PASS is struck within 70 ms of the release for a man within 100 degrees of his facing (120 ms at 180), however long the tap', () => {
    const rows: string[] = [];
    for (const frames of [2, 6, 9, 12, 18]) {
      const cells: string[] = [];
      for (const deg of [0, 60, 100, 180]) {
        let worst = 0;
        let press = 0;
        for (let seed = 1; seed <= 4; seed++) {
          const { m, mate, a } = passSetup(seed * 31 + deg, deg);
          const k = untilKick(m, (i) => pad(Math.cos(a), Math.sin(a), { pass: i < frames }));
          expect(k).not.toBeNull();
          expect(k!.kind).toBe('pass');
          expect(m.passTarget).toBe(mate.idx);
          // (The press is registered on step 0, the release on step `frames`.)
          worst = Math.max(worst, (k!.i - frames) * DT);
          press = Math.max(press, k!.i * DT);
        }
        expect(worst).toBeLessThanOrEqual((deg <= 100 ? 0.07 : 0.12) + 1e-9);
        cells.push(`${deg}deg ${(press * 1000).toFixed(0)}/${(worst * 1000).toFixed(0)}`);
      }
      rows.push(`${frames}f (${(frames * DT * 1000).toFixed(0)} ms): ${cells.join('  ')}`);
    }
    // eslint-disable-next-line no-console
    console.log(`press -> strike / release -> strike (ms, worst of 4):\n${rows.join('\n')}`);
  });

  it('a 150 ms press is a full, ideal-weight pass (not a weak half-charged one); only a hold past 0.3 s adds pace', () => {
    const speeds: Record<number, number> = {};
    for (const frames of [2, 9, 18, 45]) {
      let sum = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const { m, a } = passSetup(seed * 7, 20);
        const k = untilKick(m, (i) => pad(Math.cos(a), Math.sin(a), { pass: i < frames }));
        sum += k!.speed / 6;
      }
      speeds[frames] = sum;
    }
    // eslint-disable-next-line no-console
    console.log(`15 m pass launch speed by press length: ${Object.entries(speeds).map(([f, v]) => `${f}f ${v.toFixed(1)} m/s`).join(', ')} (ideal at 15 m: ${humanGroundSpeed(15).toFixed(1)})`);
    // (The man it's for steps towards the ball on the press, so the pass is a little shorter the longer the tap.)
    expect(speeds[9]).toBeGreaterThan(speeds[2] * 0.9);
    expect(speeds[18]).toBeGreaterThan(speeds[2] * 0.85);
    expect(speeds[9]).toBeGreaterThan(19);
    // A real hold (0.75 s) is charged above the ideal.
    expect(speeds[45]).toBeGreaterThan(speeds[18] * 1.1);
  });

  it('a 15 m pass is at his feet in about half a second', () => {
    let t = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { m, mate, a } = passSetup(seed * 3, 0);
      let kicked = -1;
      for (let i = 0; i < 120; i++) {
        m.step(DT, pad(Math.cos(a), Math.sin(a), { pass: i < 6 }));
        const ev = m.drainEvents();
        if (kicked < 0 && ev.some((e) => e.type === 'kick')) kicked = i;
        if (kicked >= 0 && m.ball.owner === mate.idx) {
          t += ((i - kicked) * DT) / 6;
          break;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`15 m pass, strike -> at his feet: ${t.toFixed(2)} s`);
    expect(t).toBeLessThanOrEqual(0.56);
  });
});

describe('the pass preview', () => {
  it('shows the man a PASS would go to, holds him through a wobbling thumb (no flicker), and is who the press locks onto', () => {
    let changes = 0;
    let rawChanges = 0;
    let shown = 0;
    let frames = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const m = scenario(seed * 11);
      const ad = m.attackDir(0);
      const c = m.players[6];
      place(c, -ad * 5, 0);
      c.facing = ad > 0 ? 0 : Math.PI;
      // Two open men ahead, 12 degrees either side of the stick's line: all but equal options.
      const sp = 0.21 * (seed % 2 ? 1 : 0.8);
      place(m.players[9], -ad * 5 + ad * 15 * Math.cos(sp), 15 * Math.sin(sp));
      place(m.players[10], -ad * 5 + ad * 15 * Math.cos(sp), -15 * Math.sin(sp));
      giveBall(m, c);
      let last = -2;
      let lastRaw = -2;
      for (let i = 0; i < 90; i++) {
        // The thumb wobbles 3 degrees either way from frame to frame.
        const w = (i % 2 ? 1 : -1) * 0.05;
        const stick = pad(ad * Math.cos(w) * 0.8, Math.sin(w) * 0.8);
        const raw = pickReceiver(m, c, stick.mx, stick.mz, 'pass');
        m.step(DT, stick);
        m.drainEvents();
        if (m.ball.owner !== c.idx) break;
        if (i > 0 && m.passPreview !== last) changes++;
        if (i > 0 && raw !== lastRaw) rawChanges++;
        last = m.passPreview;
        lastRaw = raw;
        frames++;
        if (m.passPreview >= 0) shown++;
      }
      // Now PASS: the ball goes to the man shown.
      const want = m.passPreview;
      const k = untilKick(m, (i) => pad(ad * 0.8, 0, { pass: i < 6 }));
      expect(k).not.toBeNull();
      expect(m.passTarget).toBe(want);
    }
    // eslint-disable-next-line no-console
    console.log(`preview over ${frames} frames with a wobbling stick: shown ${shown}, changed ${changes} times (the pick without hysteresis changed ${rawChanges} times)`);
    expect(shown).toBeGreaterThan(frames * 0.95);
    expect(changes).toBeLessThanOrEqual(8);
    expect(rawChanges).toBeGreaterThan(changes * 4);
  });

  it('moves to the man the stick swings to', () => {
    const m = scenario(5);
    const ad = m.attackDir(0);
    const c = m.players[6];
    place(c, 0, 0);
    c.facing = ad > 0 ? 0 : Math.PI;
    const left = m.players[9];
    const right = m.players[10];
    place(left, ad * 12, 9);
    place(right, ad * 12, -9);
    giveBall(m, c);
    const aim = (z: number) => pad((ad * 12) / Math.hypot(12, z), z / Math.hypot(12, z));
    for (let i = 0; i < 20; i++) m.step(DT, aim(9));
    expect(m.passPreview).toBe(left.idx);
    for (let i = 0; i < 6; i++) m.step(DT, aim(-9));
    expect(m.passPreview).toBe(right.idx);
  });
});

describe('teammates move on the press', () => {
  it('THROUGH: the man it is for starts his sprint in behind on the press, before the ball is struck', () => {
    let fwd = 0;
    let fwdPass = 0;
    const n = 6;
    for (let seed = 1; seed <= n; seed++) {
      for (const btn of ['through', 'pass'] as const) {
        const m = scenario(seed * 13);
        m.offside = false;
        const ad = m.attackDir(0);
        const c = m.players[6];
        const fw = m.players[9];
        place(c, 0, 0);
        c.facing = ad > 0 ? 0 : Math.PI;
        place(fw, ad * 14, 3);
        giveBall(m, c);
        const k = untilKick(m, (i) => pad(ad * 14 / Math.hypot(14, 3), 3 / Math.hypot(14, 3), { [btn]: i < 6 }));
        expect(k).not.toBeNull();
        expect(m.passTarget).toBe(fw.idx);
        if (btn === 'through') fwd += (fw.vel.x * ad) / n;
        else fwdPass += (fw.vel.x * ad) / n;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`the man called, his speed towards goal at the strike: THROUGH ${fwd.toFixed(1)} m/s | PASS ${fwdPass.toFixed(1)} m/s (he checks towards the ball)`);
    expect(fwd).toBeGreaterThan(1.8);
    expect(fwdPass).toBeLessThan(0);
  });
});

describe('crosses', () => {
  it('THROUGH held from wide in the final third locks onto the box runner and drops onto him; control goes to him and he goes for goal', () => {
    let locked = 0;
    let met = 0;
    let shots = 0;
    const n = 10;
    for (let seed = 1; seed <= n; seed++) {
      const m = scenario(seed * 17);
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      const w = m.players[7];
      const fw = m.players[9];
      const short = m.players[8];
      const zs = seed % 2 ? 1 : -1;
      place(w, gx - ad * 14, zs * 19);
      w.facing = Math.atan2(-zs, ad * 0.3);
      // The striker in the box, a midfielder showing short for it, a centre-back on the striker's shoulder.
      place(fw, gx - ad * 11, -zs * 1);
      place(short, gx - ad * 22, zs * 14);
      place(m.players[14], gx - ad * 7, -zs * 2.5);
      place(m.keeperOf(1)!, gx - ad * 1, 0);
      giveBall(m, w);
      const stick = pad(ad * 0.25, -zs * 0.97);
      const k = untilKick(m, (i) => (i < 20 ? { ...stick, through: true } : EMPTY_PAD));
      expect(k).not.toBeNull();
      expect(k!.kind).toBe('lob');
      if (m.passTarget === fw.idx) locked++;
      expect(m.active).toBe(m.passTarget);
      const s0 = m.stats.shots[0];
      for (let i = 0; i < 150; i++) {
        m.step(DT, EMPTY_PAD);
        for (const e of m.drainEvents()) {
          if ((e.type === 'kick' && m.ball.lastTouch === fw.idx) || (e.type === 'control' && e.player === fw.idx)) met++;
        }
        if (m.stats.shots[0] > s0 || m.phase !== 'play') break;
      }
      if (m.stats.shots[0] > s0) shots++;
    }
    // eslint-disable-next-line no-console
    console.log(`crosses from wide: locked onto the box runner ${locked}/${n}, met by him ${met}, a shot (auto header / volley) ${shots}/${n}`);
    expect(locked).toBe(n);
    expect(shots).toBeGreaterThanOrEqual(n * 0.6);
  });
});

describe('shot assist', () => {
  /** The human striker `dist` m out at `z`, the keeper shaded to `kz`, the ball at his feet. */
  function shooter(seed: number, dist: number, z: number, kz: number): { m: Match; p: Player; ad: number } {
    const m = scenario(seed);
    const ad = m.attackDir(0);
    const p = m.players[9];
    place(p, ad * (HALF_L - dist), z);
    p.facing = Math.atan2(-z * 0.3, ad);
    place(m.keeperOf(1)!, ad * (HALF_L - 1.5), kz);
    giveBall(m, p);
    p.kickLeg = p.foot;
    return { m, p, ad };
  }
  const aimOf = (m: Match, p: Player, dirX: number, dirZ: number, power = 0.5) => {
    const o: KickOrder = { kind: 'shot', dirX, dirZ, power, target: -1, expires: 1, firstTime: false };
    return resolveKick(m, p, o);
  };

  it('with the stick left alone or at goal, the strike goes for the corner away from the keeper, inside the post', () => {
    const hw = GOAL_W / 2;
    let away = 0;
    let n = 0;
    for (let s = 0; s < 40; s++) {
      const kz = (s % 2 ? 1 : -1) * 1.1;
      const { m, p, ad } = shooter(100 + s, 14, (s % 5) - 2, kz);
      const sticks: [number, number][] = [[0, 0], [ad, 0], [ad, 0.15]];
      for (const [dx, dz] of sticks) {
        const L = aimOf(m, p, dx, dz);
        n++;
        if (Math.sign(L.aim!.z) === -Math.sign(kz)) away++;
        // Inside the post, and out towards it (never back at the keeper in the middle).
        expect(Math.abs(L.aim!.z)).toBeLessThanOrEqual(hw - 0.3);
        expect(Math.abs(L.aim!.z)).toBeGreaterThanOrEqual(hw - 1.9);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`shot assist, keeper shaded 1.1 m: aimed at the far side from him ${away}/${n}`);
    expect(away).toBe(n);
  });

  it('a stick pushed across the goal still picks its own corner, and a tap is a true, driven shot', () => {
    const { m, p } = shooter(7, 14, 0, 1.1);
    // Across, towards the keeper's side: that corner, as asked.
    expect(aimOf(m, p, 0, 1).aim!.z).toBeGreaterThan(0);
    // A tap (the bar's floor) is struck at a real pace, and no less accurately than a full one.
    const errs = (power: number) => {
      let e = 0;
      let v = 0;
      for (let i = 0; i < 300; i++) {
        const L = aimOf(m, p, 0, 0, power);
        e += Math.abs(L.aim!.errZ) / 300;
        v += Math.hypot(L.vx, L.vz) / 300;
      }
      return { e, v };
    };
    const tap = errs(0.15);
    const full = errs(1);
    // eslint-disable-next-line no-console
    console.log(`14 m: tap ${tap.v.toFixed(1)} m/s, mean |error| ${tap.e.toFixed(2)} m | full ${full.v.toFixed(1)} m/s, ${full.e.toFixed(2)} m`);
    expect(tap.v).toBeGreaterThan(23);
    expect(tap.e).toBeLessThan(full.e);
  });
});
