import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { interceptRisk } from '../src/sim/actions';
import { solveLob } from '../src/sim/ball';
import { BOX_DEPTH, BOX_W, DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';

/** Open-play scenario with the human on side 0 and everyone parked out of the way. */
function scenario(seed: number): Match {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[5]),
    away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 150,
    difficulty: 2,
    humanSide: 0,
    seed,
  });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.drainEvents();
  // Park everyone along the far touchline so the scenario players have the pitch to themselves.
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
  const b = m.ball;
  b.reset(p.footX(), p.footZ());
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  m.active = p.idx;
  m.updateBallPath();
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

describe('human control', () => {
  it('passes go to the teammate the stick points at, even with a rough aim', () => {
    let ok = 0;
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const ang of [0, 0.8, 1.6, 2.4, -0.8, -1.6]) {
        for (const d of [10, 18, 26]) {
          const m = scenario(seed * 31 + d);
          const ad = m.attackDir(0);
          const c = m.players[6];
          const mate = m.players[9];
          const decoy = m.players[10];
          place(c, 0, 0);
          c.facing = ad > 0 ? 0 : Math.PI;
          const a = (ad > 0 ? 0 : Math.PI) + ang;
          place(mate, Math.cos(a) * d, Math.sin(a) * d);
          place(decoy, Math.cos(a + 1.3) * 14, Math.sin(a + 1.3) * 14);
          giveBall(m, c);
          // Stick ~15 degrees off the true line: players never aim perfectly.
          const sa = a + 0.26 * (seed % 2 ? 1 : -1);
          let got = false;
          for (let i = 0; i < 60 * 3.5 && !got; i++) {
            // Aim and press, then let go of the stick (assisted receive brings the mate to it).
            m.step(DT, i < 2 ? pad(Math.cos(sa), Math.sin(sa), { pass: i === 0 }) : EMPTY_PAD);
            if (m.ball.owner === mate.idx) got = true;
          }
          n++;
          if (got) ok++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`human pass accuracy ${ok}/${n}`);
    expect(ok / n).toBeGreaterThan(0.9);
  }, 60_000);

  it('a first-time shot or header from a cross is possible', () => {
    let shots = 0;
    let goals = 0;
    const N = 12;
    for (let seed = 1; seed <= N; seed++) {
      const m = scenario(seed * 7);
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      const striker = m.players[9];
      const k = m.keeperOf(1)!;
      place(striker, gx - ad * 10.5, (seed % 3) - 1);
      place(k, gx - ad * 0.8, 0);
      m.active = striker.idx;
      // A cross whipped in from the right wing towards the striker's head.
      const cx = gx - ad * 6;
      const cz = HALF_W - 6;
      const b = m.ball;
      b.reset(cx, cz);
      const tx = striker.pos.x;
      const tz = striker.pos.z;
      const d = Math.hypot(tx - cx, tz - cz);
      const s = solveLob(d, 0.75 + d / 34, 1.4);
      b.vel.x = ((tx - cx) / d) * s.vh;
      b.vel.z = ((tz - cz) / d) * s.vh;
      b.vel.y = s.vy;
      b.pos.y = 0.25;
      b.lastTouch = m.players[8].idx;
      b.lastTouchSide = 0;
      m.passTarget = striker.idx;
      m.updateBallPath();
      const before = m.stats.shots[0];
      let pressed = false;
      for (let i = 0; i < 60 * 4 && m.phase === 'play'; i++) {
        const near = Math.hypot(b.pos.x - striker.pos.x, b.pos.z - striker.pos.z) < 3.5;
        const press = near && !pressed;
        if (press) pressed = true;
        m.step(DT, pad(0, 0, { shoot: press }));
      }
      if (m.stats.shots[0] > before) shots++;
      if (m.score[0] > 0) goals++;
    }
    // eslint-disable-next-line no-console
    console.log(`first-time finishes from crosses: ${shots}/${N} shots, ${goals} goals`);
    expect(shots).toBeGreaterThanOrEqual(N * 0.6);
  }, 60_000);

  it('AI teammates make themselves available to the human carrier', () => {
    let total = 0;
    let samples = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const m = new Match({
        home: makeTeam(PRESET_CLUBS[5]),
        away: makeTeam(PRESET_CLUBS[6]),
        halfLength: 150,
        difficulty: 2,
        humanSide: 0,
        seed: seed * 13,
      });
      // Let the match run (the human idles) until we have the ball in open play.
      let held = 0;
      for (let i = 0; i < 60 * 120 && samples < seed * 3; i++) {
        m.step(DT, EMPTY_PAD);
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
        if (m.phase === 'halftime') m.continueSecondHalf();
        const o = m.ball.owner;
        if (m.phase === 'play' && o >= 0 && o === m.active && !m.ball.held && !m.players[o].isKeeper) held += DT;
        else held = 0;
        if (held > 1.2) {
          const c = m.players[o];
          let open = 0;
          for (const t of m.teamPlayers(0)) {
            if (t === c || t.isKeeper) continue;
            const d = Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
            if (d < 6 || d > 32) continue;
            let near = Infinity;
            for (const q of m.teamPlayers(1)) near = Math.min(near, Math.hypot(q.pos.x - t.pos.x, q.pos.z - t.pos.z));
            if (near > 2.5 && interceptRisk(m, 0, c.pos.x, c.pos.z, t.pos.x, t.pos.z, 16) < 0.5) open++;
          }
          total += open;
          samples++;
          held = -3; // don't resample the same possession immediately
        }
      }
    }
    const avg = total / Math.max(1, samples);
    // eslint-disable-next-line no-console
    console.log(`open passing options for an idle human carrier: ${avg.toFixed(2)} (${samples} samples)`);
    expect(samples).toBeGreaterThan(5);
    expect(avg).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('corners load the box on both sides', () => {
    for (const seed of [3, 9, 27]) {
      const m = scenario(seed);
      // An attack in progress (side 0 camped in the final third), then it's knocked behind.
      m.players.forEach((p) => {
        const slot = m.slots[p.side][p.slot];
        const adp = m.attackDir(p.side);
        const x = p.side === 0 ? slot.x * 0.45 + 0.4 : slot.x * 0.3 - 0.62;
        place(p, x * HALF_L * adp, slot.z * HALF_W * 0.75 * adp);
      });
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      m.ball.reset(gx + ad * 1.2, 9);
      m.ball.lastTouchSide = 1;
      m.ball.lastTouch = m.players[13].idx;
      for (let i = 0; i < 60 * 1.2; i++) m.step(DT, EMPTY_PAD);
      expect(m.phase === 'restart' || m.phase === 'out').toBe(true);
      expect(m.restart?.kind).toBe('corner');
      // Give them the usual couple of seconds (the human taker hasn't pressed anything).
      for (let i = 0; i < 60 * 3; i++) m.step(DT, EMPTY_PAD);
      const inBox = (p: Player) => Math.abs(p.pos.x - gx) < BOX_DEPTH && Math.abs(p.pos.z) < BOX_W / 2;
      const atk = m.teamPlayers(0).filter((p) => !p.isKeeper && inBox(p)).length;
      const def = m.teamPlayers(1).filter((p) => !p.isKeeper && inBox(p)).length;
      expect(atk).toBeGreaterThanOrEqual(5);
      expect(def).toBeGreaterThanOrEqual(5);
    }
  }, 60_000);
});
