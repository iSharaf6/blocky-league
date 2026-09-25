import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { crossingZ, stickCurl, THROW_RANGE } from '../src/sim/actions';
import { Ball, type BallHit } from '../src/sim/ball';
import { BALL_R, BOX_DEPTH, BOX_W, DT, GOAL_W, HALF_L, HALF_W, PEN_SPOT, SEP_MATE, SEP_OPP, WALL_DIST } from '../src/sim/constants';
import { EMPTY_PAD, Match, OFFSIDE_TOL, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent, Side } from '../src/sim/types';

function newMatch(seed: number, humanSide: Side | -1 = -1, halfLength = 150): Match {
  return new Match({
    home: makeTeam(PRESET_CLUBS[5]),
    away: makeTeam(PRESET_CLUBS[6]),
    halfLength,
    difficulty: 2,
    humanSide,
    seed,
  });
}

/** Open play with everyone parked along the far touchline, out of the way. */
function scenario(seed: number, humanSide: Side | -1 = -1): Match {
  const m = newMatch(seed, humanSide);
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
  const b = m.ball;
  b.reset(p.footX(), p.footZ());
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  m.updateBallPath();
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

/**
 * The real foul path: `att` carries the ball towards goal at (x, z) and `def` slides in from
 * behind, mistimed. Steps until the foul is given; returns every event seen on the way.
 */
function slideFoul(m: Match, att: Player, def: Player, x: number, z: number): MatchEvent[] {
  const ad = m.attackDir(att.side);
  place(att, x, z);
  att.facing = ad > 0 ? 0 : Math.PI;
  att.vel.x = ad * 4;
  giveBall(m, att);
  place(def, x - ad * 1.3, z);
  def.facing = att.facing;
  def.vel.x = ad * 6;
  m.startSlide(def);
  def.slideFoul = true;
  const seen: MatchEvent[] = [];
  for (let i = 0; i < 60 && !seen.some((e) => e.type === 'foul'); i++) {
    m.step(DT, EMPTY_PAD);
    seen.push(...m.drainEvents());
  }
  // In the attacking half the referee may wait on an advantage before the free kick (or play on);
  // either way any card comes when he's decided.
  for (let i = 0; i < 60 * 2 && seen.some((e) => e.type === 'foul') && !seen.some((e) => e.type === 'restart' || e.type === 'advantage'); i++) {
    m.step(DT, EMPTY_PAD);
    seen.push(...m.drainEvents());
  }
  return seen;
}

/** Step until the pending restart is live (the ball set on its spot; a foul in the attacking half waits on the advantage first). */
function toRestart(m: Match, pads: Pad = EMPTY_PAD): void {
  for (let i = 0; i < 60 * 6 && m.phase !== 'restart'; i++) {
    m.step(DT, pads);
    m.drainEvents();
  }
  expect(m.phase).toBe('restart');
}

describe('discipline', () => {
  it('a second yellow is a red: sent off for good, the team plays on with ten', () => {
    let m: Match | null = null;
    let def: Player | null = null;
    let events: MatchEvent[] = [];
    for (let seed = 1; seed <= 30 && !m; seed++) {
      const t = scenario(seed);
      const d = t.players[11 + 6]; // away midfielder, already booked
      t.booked.add(d.idx);
      const ev = slideFoul(t, t.players[9], d, 0, 4);
      if (ev.some((e) => e.type === 'card' && e.color === 'red')) {
        m = t;
        def = d;
        events = ev;
      }
    }
    expect(m).not.toBeNull();
    if (!m || !def) return;
    const red = events.find((e) => e.type === 'card');
    expect(red).toEqual({ type: 'card', player: def.idx, color: 'red', second: true });
    expect(def.sentOff).toBe(true);
    expect(m.onPitch(1).length).toBe(10);
    expect(m.onPitch(0).length).toBe(11);
    // He walks off (no teleport: the referee's close-up still has him), head down, to the dugout.
    const start = { x: def.pos.x, z: def.pos.z };
    expect(def.pos.z).toBeLessThan(HALF_W);
    let walked = 0;
    let lastX = def.pos.x;
    let lastZ = def.pos.z;
    for (let i = 0; i < 60 * 10 && def.pos.z < HALF_W + 1.9; i++) {
      m.step(DT, EMPTY_PAD);
      m.drainEvents();
      const stepD = Math.hypot(def.pos.x - lastX, def.pos.z - lastZ);
      if (i < 60 * 8) expect(stepD).toBeLessThan(0.2); // walking, not jumping
      walked += stepD;
      lastX = def.pos.x;
      lastZ = def.pos.z;
      expect(def.state).toBe('dejected');
      expect(m.ball.owner).not.toBe(def.idx);
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
    expect(walked).toBeGreaterThan(Math.min(8, Math.hypot(start.x, start.z - HALF_W) * 0.5));
    // Off by the dugout, and he can't be replaced.
    expect(def.pos.z).toBeGreaterThan(HALF_W + 1);
    expect(m.substitute(1, def.slot, m.bench[1].findIndex((d) => d.role !== 'GK'))).toBe(false);

    // Play the rest of the match out: he never touches the ball or takes part again.
    let touched = 0;
    let involved = 0;
    for (let i = 0; i < 60 * 400 && m.phase !== 'fulltime'; i++) {
      m.step(DT, EMPTY_PAD);
      for (const e of m.drainEvents()) {
        if ((e.type === 'kick' || e.type === 'control') && m.ball.lastTouch === def.idx) touched++;
        if (e.type === 'tackle' && e.by === def.idx) involved++;
      }
      if (m.ball.owner === def.idx || m.ball.lastTouch === def.idx || m.restart?.taker === def.idx) touched++;
      const br = m.brains[1];
      if (br.presser === def.idx || br.cover === def.idx || br.chaser === def.idx || br.marks.has(def.idx) || br.spTargets.has(def.idx)) involved++;
      if (def.pos.z < HALF_W + 1 || def.state !== 'dejected') involved++;
      if (m.phase === 'halftime') m.continueSecondHalf();
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
    expect(m.phase).toBe('fulltime');
    expect(touched).toBe(0);
    expect(involved).toBe(0);
    // (Another red later in the game is possible; he never comes back either way.)
    expect(m.onPitch(1).length).toBeLessThanOrEqual(10);
    expect(def.sentOff).toBe(true);
  }, 60_000);

  it('a first yellow is only a booking', () => {
    let yellows = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const m = scenario(seed);
      const d = m.players[11 + 6];
      const ev = slideFoul(m, m.players[9], d, 0, 4);
      if (ev.some((e) => e.type === 'card' && e.color === 'yellow' && e.player === d.idx)) {
        yellows++;
        expect(m.booked.has(d.idx)).toBe(true);
        expect(d.sentOff).toBe(false);
      }
      expect(ev.some((e) => e.type === 'card' && e.color === 'red')).toBe(false);
    }
    expect(yellows).toBeGreaterThan(0);
  });

  it('logs a goal in the first minute as 1\', not 0\' (and stoppage time as 45\')', () => {
    const score = (m: Match): number => {
      const ad = m.attackDir(0);
      const b = m.ball;
      b.reset(ad * (HALF_L + 0.6), 0.5);
      b.pos.y = 0.6;
      b.vel.x = ad * 8;
      b.lastTouch = m.players[9].idx;
      b.lastTouchSide = 0;
      m.step(DT, EMPTY_PAD);
      return m.goals[m.goals.length - 1].minute;
    };
    const a = scenario(3);
    a.clock = 0.4;
    expect(score(a)).toBe(1);
    const b = scenario(3);
    b.half = 2;
    b.clock = 0.4;
    expect(score(b)).toBe(46);
    const c = scenario(3);
    c.clock = 150 + 4;
    expect(score(c)).toBe(45);
    const d = scenario(3);
    d.clock = 150 * (29.5 / 45);
    expect(score(d)).toBe(30);
  });
});

describe('set pieces', () => {
  it('a free kick in range gets a proper wall 9.15 m out, square to the ball-goal line', () => {
    for (const [seed, dist, z] of [[4, 21, 3], [8, 26, -5], [15, 19, 0.5]] as const) {
      const m = scenario(seed);
      const att = m.players[9];
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      slideFoul(m, att, m.players[11 + 6], gx - ad * dist, z);
      toRestart(m);
      const r = m.restart!;
      expect(r.kind).toBe('freekick');
      for (let i = 0; i < 20; i++) m.step(DT, EMPTY_PAD);
      m.drainEvents();
      expect(m.phase).toBe('restart');
      const dg = Math.hypot(gx - r.x, -r.z);
      const ux = (gx - r.x) / dg;
      const uz = -r.z / dg;
      const wall = m.teamPlayers(1).filter((p) => {
        if (p.isKeeper) return false;
        const along = (p.pos.x - r.x) * ux + (p.pos.z - r.z) * uz;
        return Math.abs(along - WALL_DIST) < 0.35 && Math.abs((p.pos.x - r.x) * -uz + (p.pos.z - r.z) * ux) < 4;
      });
      expect(wall.length).toBeGreaterThanOrEqual(3);
      expect(wall.length).toBeLessThanOrEqual(4);
      // Shoulder to shoulder along the perpendicular.
      const lat = wall.map((p) => (p.pos.x - r.x) * -uz + (p.pos.z - r.z) * ux).sort((a, b) => a - b);
      for (let i = 1; i < lat.length; i++) {
        expect(lat[i] - lat[i - 1]).toBeGreaterThan(0.8);
        expect(lat[i] - lat[i - 1]).toBeLessThan(1.05);
      }
      // Nobody else from the defending side within ten yards.
      for (const p of m.teamPlayers(1)) {
        if (wall.includes(p) || p.isKeeper) continue;
        expect(Math.hypot(p.pos.x - r.x, p.pos.z - r.z)).toBeGreaterThan(WALL_DIST - 0.2);
      }
      // Keeper on his line, on the side of the goal the wall doesn't hide.
      const k = m.keeperOf(1)!;
      expect(Math.abs(k.pos.x - gx)).toBeLessThan(1.6);
      const near = Math.sign(r.z) || 1;
      expect(k.pos.z * near).toBeLessThan(0.6);
      // The ball sits dead still on its spot.
      expect(m.ball.pos.x).toBeCloseTo(r.x, 6);
      expect(m.ball.pos.z).toBeCloseTo(r.z, 6);
    }
  });

  it('the ball and taker stay put on a free kick until it is struck', () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const human of [-1, 0] as const) {
        const m = scenario(seed, human);
        // Foul in the fouled side's own half (no advantage there): the fouler slides on through the
        // spot while the kick is set up.
        slideFoul(m, m.players[9], m.players[11 + 6], -m.attackDir(0) * 8, 6);
        toRestart(m);
        const r = m.restart!;
        const t = m.players[r.taker];
        while (m.phase === 'restart') {
          expect(Math.hypot(m.ball.pos.x - r.x, m.ball.pos.z - r.z)).toBeLessThan(1e-6);
          // At his run-up spot (or stepping in from it), never on top of the ball.
          const td = Math.hypot(t.pos.x - r.x, t.pos.z - r.z);
          expect(td).toBeLessThan(1.9);
          expect(td).toBeGreaterThan(0.5);
          m.step(DT, human === 0 && m.phaseT > 0.5 && m.phaseT < 0.6 ? pad(0.3, 0.9) : EMPTY_PAD);
          m.drainEvents();
        }
        expect(m.phase).toBe('play');
      }
    }
  });

  it('a foul in the box: everyone else outside the area and arc, keeper on his line', () => {
    let pens = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const human of [-1, 1] as const) {
        const m = scenario(seed, human);
        const ad = m.attackDir(0);
        const gx = ad * HALF_L;
        // Bring both teams up to the box, as in a real attack.
        m.players.forEach((p, i) => {
          if (!p.isKeeper) place(p, gx - ad * (6 + (i % 5) * 3), -12 + (i % 7) * 4);
        });
        place(m.keeperOf(1)!, gx - ad * 1, 0);
        slideFoul(m, m.players[9], m.players[11 + 3], gx - ad * 9, 2);
        toRestart(m);
        const r = m.restart!;
        expect(r.kind).toBe('penalty');
        expect(r.x).toBeCloseTo(ad * (HALF_L - PEN_SPOT), 6);
        pens++;
        const k = m.keeperOf(1)!;
        const taker = m.players[r.taker];
        // A human defender tries to walk into the box towards the spot.
        const sneak = human === 1 ? pad(ad, 0) : EMPTY_PAD;
        while (m.phase === 'restart') {
          for (const p of m.players) {
            if (p === taker || p.isKeeper || p.sentOff) continue;
            const inBox = Math.abs(p.pos.x - gx) < BOX_DEPTH && Math.abs(p.pos.z) < BOX_W / 2;
            expect(inBox).toBe(false);
            expect(Math.hypot(p.pos.x - r.x, p.pos.z - r.z)).toBeGreaterThanOrEqual(WALL_DIST);
          }
          if (m.phaseT > 0.3) expect(Math.abs(k.pos.x - gx)).toBeLessThan(0.6);
          expect(Math.hypot(m.ball.pos.x - r.x, m.ball.pos.z - r.z)).toBeLessThan(1e-6);
          m.step(DT, sneak);
          m.drainEvents();
        }
      }
    }
    expect(pens).toBe(12);
  });

  it('corners are whipped into the near- or far-post zone the runners attack', () => {
    const sides = new Set<number>();
    let inZone = 0;
    let n = 0;
    for (let seed = 1; seed <= 8; seed++) {
      for (const human of [-1, 0] as const) {
        const m = scenario(seed, human);
        const ad = m.attackDir(0);
        const gx = ad * HALF_L;
        m.players.forEach((p) => {
          const slot = m.slots[p.side][p.slot];
          const adp = m.attackDir(p.side);
          const x = p.side === 0 ? slot.x * 0.45 + 0.4 : slot.x * 0.3 - 0.62;
          place(p, x * HALF_L * adp, slot.z * HALF_W * 0.75 * adp);
        });
        const cz = seed % 2 ? 9 : -9;
        m.ball.reset(gx + ad * 1.2, cz);
        m.ball.lastTouchSide = 1;
        m.ball.lastTouch = m.players[13].idx;
        toRestart(m);
        const r = m.restart!;
        expect(r.kind).toBe('corner');
        // The taker faces the area between the spot and the six-yard box.
        const t = m.players[r.taker];
        const want = Math.atan2(-r.z, ad * (HALF_L - 7) - r.x);
        expect(Math.abs(Math.atan2(Math.sin(t.facing - want), Math.cos(t.facing - want)))).toBeLessThan(0.05);
        // Human: no stick, hold and release THROUGH (the cross). AI: it takes it itself (now and
        // then short, which isn't a delivery into the box).
        let kicked = false;
        let short = false;
        for (let i = 0; i < 60 * 8 && !kicked; i++) {
          const hold = human === 0 && m.phaseT > 0.4 && m.phaseT < 0.8;
          m.step(DT, hold ? pad(0, 0, { through: true }) : EMPTY_PAD);
          const ks = m.drainEvents().filter((e) => e.type === 'kick');
          kicked = ks.length > 0;
          short = ks.some((e) => e.type === 'kick' && e.kind === 'pass');
        }
        expect(kicked).toBe(true);
        if (short) continue;
        const kid = m.kickId;
        let land: { d: number; z: number } | null = null;
        for (let i = 0; i < 60 * 3 && !land; i++) {
          const b = m.ball;
          if (m.kickId !== kid || b.owner >= 0 || b.held || (b.vel.y < 0 && b.pos.y < 1.5)) {
            land = { d: HALF_L - b.pos.x * ad, z: b.pos.z };
            break;
          }
          m.step(DT, EMPTY_PAD);
          m.drainEvents();
        }
        n++;
        if (land && land.d > 2.5 && land.d < 9 && Math.abs(land.z) < 6) {
          inZone++;
          sides.add(Math.sign(land.z) === Math.sign(cz) ? 1 : -1);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`corner deliveries into the post zones: ${inZone}/${n}`);
    expect(inZone / n).toBeGreaterThanOrEqual(0.8);
    expect(sides.size).toBe(2); // both the near post and the far post get used
  }, 60_000);
});

describe('curl', () => {
  it('sidespin bends a ball measurably', () => {
    const fly = (spinY: number) => {
      const b = new Ball();
      const hits: BallHit[] = [];
      b.reset(0, 0);
      b.pos.y = BALL_R + 0.05;
      b.vel.x = 26;
      b.vel.y = 4;
      b.spin.y = spinY;
      for (let i = 0; i < 60; i++) b.step(DT, hits);
      return b.pos.z;
    };
    expect(fly(0)).toBeCloseTo(0, 6);
    // Negative sidespin with the ball travelling +x swings it towards +z (and vice versa).
    expect(fly(-10)).toBeGreaterThan(1);
    expect(fly(10)).toBeLessThan(-1);
  });

  it('the stick curls a human strike, and bends it back onto the target', () => {
    expect(stickCurl(0.2)).toBe(0);
    expect(stickCurl(1)).toBe(1);
    expect(stickCurl(-0.6)).toBeLessThan(0);
    expect(stickCurl(0.5)).toBeLessThan(stickCurl(0.7));
    let bent = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = scenario(seed, 0);
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      const c = m.players[9];
      place(c, gx - ad * 24, 0);
      c.facing = ad > 0 ? 0 : Math.PI;
      giveBall(m, c);
      m.active = c.idx;
      // Nobody in the way, and the keeper out of it so the whole flight can be measured.
      place(m.keeperOf(1)!, gx + ad * 3, 20);
      const lat = 0.9;
      for (let i = 0; i < 30; i++) m.step(DT, pad(ad * 0.4, lat, { shoot: true }));
      m.step(DT, pad(ad * 0.4, lat));
      for (let i = 0; i < 20 && m.ball.owner >= 0; i++) m.step(DT, pad(ad * 0.4, lat));
      expect(m.ball.owner).toBe(-1);
      const b = m.ball;
      // Bends towards +z, the way the stick pushed...
      expect(-b.spin.y * Math.sign(b.vel.x)).toBeGreaterThan(3);
      // ...and the launch is solved so the bend brings it back to around the +z corner.
      const cross = crossingZ(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.spin.y, gx);
      expect(cross).not.toBeNull();
      expect(cross!).toBeGreaterThan(0.5);
      expect(cross!).toBeLessThan(GOAL_W / 2 + 2);
      // The flight up to the line (or the first thing it hits) is visibly curved.
      const path: { x: number; z: number }[] = [];
      const kid = m.kickId;
      let hit = false;
      for (let i = 0; i < 90 && (b.pos.x - gx) * ad < 0 && m.phase === 'play' && m.kickId === kid && !hit; i++) {
        path.push({ x: b.pos.x, z: b.pos.z });
        m.step(DT, EMPTY_PAD);
        hit = m.drainEvents().some((e) => e.type === 'post' || e.type === 'save' || e.type === 'block');
      }
      const a = path[0];
      const e = path[path.length - 1];
      const L = Math.hypot(e.x - a.x, e.z - a.z);
      let sag = 0;
      for (const q of path) sag = Math.max(sag, Math.abs(((q.x - a.x) * (e.z - a.z) - (q.z - a.z) * (e.x - a.x)) / L));
      if (sag > 0.35) bent++;
    }
    expect(bent).toBeGreaterThanOrEqual(5);
  });
});

describe('fitness', () => {
  it('stamina drains over a half and costs sprint pace', () => {
    let sum = 0;
    let m = newMatch(11, -1, 120);
    for (const seed of [11, 23, 41]) {
      m = newMatch(seed, -1, 120);
      for (let i = 0; i < 60 * 200 && m.phase !== 'halftime'; i++) {
        m.step(DT, EMPTY_PAD);
        m.drainEvents();
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
      }
      expect(m.phase).toBe('halftime');
      const out = m.players.filter((p) => !p.isKeeper);
      const avg = out.reduce((a, p) => a + p.stamina, 0) / out.length;
      const mfs = m.players.filter((p) => p.role === 'MF');
      const busiest = Math.min(...mfs.map((p) => p.stamina));
      // eslint-disable-next-line no-console
      console.log(`stamina after a 2-min half (seed ${seed}): outfield avg ${avg.toFixed(2)}, busiest MF ${busiest.toFixed(2)}`);
      expect(avg).toBeLessThan(0.92);
      expect(busiest).toBeLessThan(0.85);
      // Keepers barely tire.
      expect(m.keeperOf(0)!.stamina).toBeGreaterThan(0.85);
      sum += avg;
    }
    // A sprint-heavy 2-minute half used to leave everyone at 0.95-1.0.
    expect(sum / 3).toBeLessThan(0.87);
    // Tired legs lose a lot of their top speed.
    const p = m.players[6];
    p.stamina = 1;
    const fresh = p.sprintPace();
    p.stamina = 0.3;
    expect(p.sprintPace() / fresh).toBeLessThan(0.82);
    expect(p.sprintPace()).toBeGreaterThan(p.jogPace());
  });

  it('a busy midfielder ends a 2x2-min match around half fit, whatever the half length', () => {
    const endMf = (halfLength: number) => {
      const m = newMatch(23, -1, halfLength);
      for (let i = 0; i < 60 * halfLength * 3 && m.phase !== 'fulltime'; i++) {
        m.step(DT, EMPTY_PAD);
        m.drainEvents();
        if (m.phase === 'halftime') m.continueSecondHalf();
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
      }
      const mfs = m.players.filter((p) => p.role === 'MF').map((p) => p.stamina);
      return { busiest: Math.min(...mfs), avg: mfs.reduce((a, s) => a + s, 0) / mfs.length };
    };
    const short = endMf(120);
    const long = endMf(300);
    // eslint-disable-next-line no-console
    console.log(`MF stamina at full time: 2-min halves ${short.avg.toFixed(2)} (busiest ${short.busiest.toFixed(2)}), 5-min halves ${long.avg.toFixed(2)}`);
    expect(short.busiest).toBeGreaterThan(0.2);
    expect(short.busiest).toBeLessThan(0.65);
    expect(short.avg).toBeLessThan(0.8);
    expect(Math.abs(short.avg - long.avg)).toBeLessThan(0.2);
  }, 60_000);
});

describe('contact', () => {
  it('opponents keep ~1 m apart, teammates a little closer', () => {
    const m = scenario(2);
    const a = m.players[9];
    const b = m.players[11 + 3];
    const c = m.players[10];
    place(a, 0, 0);
    place(b, 0.3, 0.1);
    place(c, -0.2, -0.3);
    for (let i = 0; i < 3; i++) m.step(DT, EMPTY_PAD);
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(SEP_OPP - 0.08);
    expect(Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z)).toBeGreaterThan(SEP_MATE - 0.08);
  });

  it('a won standing tackle shows a quick poke of the boot, without a kick', () => {
    const m = scenario(5);
    const ad = m.attackDir(0);
    const c = m.players[9];
    const p = m.players[11 + 3];
    place(c, 0, 0);
    c.facing = ad > 0 ? 0 : Math.PI;
    giveBall(m, c);
    place(p, c.footX() + ad * 0.95, 0);
    p.facing = c.facing + Math.PI;
    m.tryTackle(p, c, 10);
    const ev = m.drainEvents();
    expect(ev.some((e) => e.type === 'tackle' && e.won && e.by === p.idx)).toBe(true);
    expect(ev.some((e) => e.type === 'kick')).toBe(false);
    expect(p.state).toBe('kick');
    expect(p.poke).toBe(true);
    expect(p.order).toBeNull();
    let t = 0;
    while (p.state === 'kick' && t < 1) {
      m.step(DT, EMPTY_PAD);
      expect(m.drainEvents().some((e) => e.type === 'kick' && m.ball.lastTouch === p.idx)).toBe(false);
      t += DT;
    }
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThan(0.3);
  });
});

describe('offside', () => {
  /**
   * A pass from 30 m out to a striker; the two nearest defenders hold a line 16 m out (well wide of
   * the lane), the keeper on his line. `beyond` > 0 puts the striker that far past the line.
   */
  function passTo(seed: number, beyond: number, offside = true) {
    const m = scenario(seed);
    m.offside = offside;
    const ad = m.attackDir(0);
    const gx = ad * HALF_L;
    const passer = m.players[6];
    const fw = m.players[9];
    place(passer, gx - ad * 30, 0);
    passer.facing = ad > 0 ? 0 : Math.PI;
    // The rest of their outfield well behind the ball, so these two are the line.
    m.teamPlayers(1).forEach((p, i) => {
      if (!p.isKeeper) place(p, -ad * 10, -HALF_W + 2 + i * 1.5);
    });
    place(m.players[11 + 2], gx - ad * 16, -14);
    place(m.players[11 + 3], gx - ad * 16, 14);
    place(m.keeperOf(1)!, gx - ad * 0.8, 0);
    place(fw, gx - ad * (16 - beyond), 0.5);
    giveBall(m, passer);
    m.order(passer, 'pass', fw.pos.x - passer.pos.x, fw.pos.z - passer.pos.z, 0.6, fw.idx, false);
    const seen: MatchEvent[] = [];
    let got = false;
    for (let i = 0; i < 60 * 4 && m.phase === 'play' && !got; i++) {
      m.step(DT, EMPTY_PAD);
      seen.push(...m.drainEvents());
      got = m.ball.owner === fw.idx;
    }
    return { m, fw, seen, got };
  }

  it('first to a pass he was offside for: flag, indirect free kick to the defence where he was', () => {
    let flagged = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const { m, fw, seen, got } = passTo(seed, 4);
      const off = seen.find((e) => e.type === 'offside');
      if (!off) continue;
      flagged++;
      expect(got).toBe(false);
      expect(off).toEqual({ type: 'offside', side: 0, player: fw.idx });
      expect(m.stats.offsides).toEqual([1, 0]);
      expect(m.phase).toBe('out');
      const r = m.restart!;
      expect(r.kind).toBe('freekick');
      expect(r.side).toBe(1);
      expect(r.indirect).toBe(true);
      expect(Math.hypot(r.x - fw.pos.x, r.z - fw.pos.z)).toBeLessThan(2);
      expect(seen.some((e) => e.type === 'restart' && e.kind === 'freekick' && e.side === 1)).toBe(true);
    }
    expect(flagged).toBeGreaterThanOrEqual(3);
  });

  it('onside (behind the line, or level within the benefit of the doubt) plays on; so does everything with the law off', () => {
    let played = 0;
    for (let seed = 1; seed <= 4; seed++) {
      for (const [beyond, law] of [[-2.5, true], [OFFSIDE_TOL - 0.4, true], [4, false]] as const) {
        const { seen, got } = passTo(seed, beyond, law);
        expect(seen.some((e) => e.type === 'offside')).toBe(false);
        if (got) played++;
      }
    }
    expect(played).toBeGreaterThanOrEqual(9);
  });

  it('never from a throw-in, and the AI holds its runs on the line (rare flags over a match)', () => {
    const m = scenario(6);
    const ad = m.attackDir(0);
    const fw = m.players[9];
    // Striker miles offside, ball out for a throw-in to his side right next to him.
    place(fw, ad * (HALF_L - 8), HALF_W - 5);
    place(m.keeperOf(1)!, ad * (HALF_L - 1), 0);
    m.players.forEach((p) => {
      if (p.side === 0 && p !== fw) place(p, -ad * 30, -20 + p.slot * 2);
    });
    m.ball.reset(ad * (HALF_L - 10), HALF_W + 0.4);
    m.ball.lastTouch = m.players[14].idx;
    m.ball.lastTouchSide = 1;
    let off = 0;
    let thrown = false;
    for (let i = 0; i < 60 * 8; i++) {
      m.step(DT, EMPTY_PAD);
      for (const e of m.drainEvents()) {
        if (e.type === 'offside') off++;
        if (e.type === 'kick' && e.kind === 'throw') thrown = true;
      }
      if (thrown && m.ball.owner >= 0) break;
    }
    expect(thrown).toBe(true);
    expect(off).toBe(0);
  });
});

describe('advantage', () => {
  it('fouled in their half with a teammate there to carry on: play on, and no free kick', () => {
    let played = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const m = scenario(seed);
      const ad = m.attackDir(0);
      const x = ad * (HALF_L - 28);
      place(m.players[10], x + ad * 2.6, 0.6);
      const ev = slideFoul(m, m.players[9], m.players[11 + 6], x, 0);
      if (!ev.some((e) => e.type === 'foul')) continue;
      const adv = ev.find((e) => e.type === 'advantage');
      if (!adv) continue;
      played++;
      expect(adv).toEqual({ type: 'advantage', side: 0 });
      expect(ev.some((e) => e.type === 'restart')).toBe(false);
      expect(m.phase).toBe('play');
      expect(m.stats.fouls[1]).toBe(1);
      // Any booking is shown at once (after the foul and the advantage), not saved up.
      const card = ev.findIndex((e) => e.type === 'card');
      if (card >= 0) expect(card).toBeGreaterThan(ev.findIndex((e) => e.type === 'advantage'));
      expect(m.ball.owner === m.players[10].idx || m.ball.lastTouchSide === 0).toBe(true);
    }
    expect(played).toBeGreaterThanOrEqual(5);
  });

  it('in their own half, or when the other side comes away with it, the free kick is given where the foul was', () => {
    let own = 0;
    let back = 0;
    for (let seed = 1; seed <= 8; seed++) {
      // Own half: straight away.
      const a = scenario(seed);
      const adA = a.attackDir(0);
      const evA = slideFoul(a, a.players[9], a.players[11 + 6], -adA * 12, 3);
      if (evA.some((e) => e.type === 'foul')) {
        expect(evA.some((e) => e.type === 'advantage')).toBe(false);
        const r = evA.find((e) => e.type === 'restart');
        expect(r).toEqual({ type: 'restart', kind: 'freekick', side: 0 });
        own++;
      }
      // Their half, but it runs to a defender: brought back.
      const b = scenario(seed);
      const adB = b.attackDir(0);
      const x = adB * (HALF_L - 28);
      place(b.players[11 + 5], x + adB * 2.4, 0.5);
      const evB = slideFoul(b, b.players[9], b.players[11 + 6], x, 0);
      if (evB.some((e) => e.type === 'foul') && !evB.some((e) => e.type === 'advantage')) {
        expect(evB.some((e) => e.type === 'restart' && e.kind === 'freekick' && e.side === 0)).toBe(true);
        const r = b.restart!;
        expect(Math.abs(r.x - x)).toBeLessThan(3);
        back++;
      }
    }
    expect(own).toBeGreaterThanOrEqual(6);
    expect(back).toBeGreaterThanOrEqual(5);
  });
});

describe('goal credit', () => {
  /** A shot from 12 m with the keeper out of it; returns once it's struck. */
  function strike(seed: number) {
    const m = scenario(seed);
    const ad = m.attackDir(0);
    const gx = ad * HALF_L;
    const s = m.players[9];
    place(s, gx - ad * 12, 1);
    s.facing = ad > 0 ? 0 : Math.PI;
    giveBall(m, s);
    place(m.keeperOf(1)!, gx + ad * 3, 20);
    m.order(s, 'shot', 0, 0, 0.55, -1, false);
    for (let i = 0; i < 30 && m.shotClock > 0.3; i++) {
      m.step(DT, EMPTY_PAD);
      m.drainEvents();
    }
    return { m, s };
  }
  const toGoal = (m: Match) => {
    for (let i = 0; i < 120; i++) {
      m.step(DT, EMPTY_PAD);
      const g = m.drainEvents().find((e) => e.type === 'goal');
      if (g) return g;
    }
    return undefined;
  };

  it("an on-target shot that goes in off a defender's (or keeper's) touch is the shooter's goal", () => {
    let n = 0;
    for (const seed of [2, 5, 9, 14, 21, 33]) {
      const { m, s } = strike(seed);
      if (!m.shotWasOnTarget) continue;
      expect(m.shooter).toBe(s.idx);
      // The faintest of touches on the way in, as a block or a parry leaves it.
      m.ball.lastTouch = m.players[11 + 3].idx;
      m.ball.lastTouchSide = 1;
      const g = toGoal(m);
      if (!g) continue;
      n++;
      expect(g).toEqual({ type: 'goal', side: 0, scorer: s.idx, own: false });
      expect(m.goals[0]).toMatchObject({ side: 0, scorer: s.idx, own: false });
    }
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('a shot going wide that is turned in, or a ball the defence strikes into its own net, is an own goal', () => {
    let n = 0;
    for (const seed of [2, 5, 9, 14, 21, 33]) {
      const { m } = strike(seed);
      if (!m.shotWasOnTarget) continue;
      const d = m.players[11 + 3];
      // Treat it as if it was going wide when struck.
      m.shotWasOnTarget = false;
      m.ball.lastTouch = d.idx;
      m.ball.lastTouchSide = 1;
      const g = toGoal(m);
      if (!g) continue;
      n++;
      expect(g).toEqual({ type: 'goal', side: 0, scorer: d.idx, own: true });
    }
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

describe('set-piece run-up and throw range', () => {
  it('the free-kick taker waits off the ball (1.5 m back, 0.9 m aside) and steps in to strike it', () => {
    for (const [seed, dist, z] of [[4, 21, 3], [8, 26, -5], [15, 19, 0.5]] as const) {
      const m = scenario(seed);
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      slideFoul(m, m.players[9], m.players[11 + 6], gx - ad * dist, z);
      toRestart(m);
      const r = m.restart!;
      expect(r.kind).toBe('freekick');
      m.step(DT, EMPTY_PAD);
      m.drainEvents();
      const t = m.players[r.taker];
      const fx = Math.cos(t.facing);
      const fz = Math.sin(t.facing);
      const bx = r.x - t.pos.x;
      const bz = r.z - t.pos.z;
      expect(bx * fx + bz * fz).toBeCloseTo(1.5, 1);
      expect(Math.abs(-fz * bx + fx * bz)).toBeCloseTo(0.9, 1);
      // The ball is on his kicking-foot side.
      expect(Math.sign(-fz * bx + fx * bz)).toBe(m.runUpFoot);
      let struck = false;
      for (let i = 0; i < 60 * 8 && !struck; i++) {
        m.step(DT, EMPTY_PAD);
        struck = m.drainEvents().some((e) => e.type === 'kick');
      }
      expect(struck).toBe(true);
      expect(Math.hypot(t.pos.x - r.x, t.pos.z - r.z)).toBeLessThan(0.9);
    }
  });

  it('a throw-in never goes further than a throw can (it used to go to the keeper at 120 m/s)', () => {
    for (const seed of [1, 4, 9]) {
      const m = scenario(seed);
      // Everyone is parked along the far touchline: nobody in range of a throw on this side.
      m.ball.reset(6, HALF_W + 0.4);
      m.ball.lastTouch = m.players[14].idx;
      m.ball.lastTouchSide = 1;
      let from: { x: number; z: number } | null = null;
      let speed = 0;
      let target = -1;
      for (let i = 0; i < 60 * 12 && !from; i++) {
        m.step(DT, EMPTY_PAD);
        for (const e of m.drainEvents()) {
          if (e.type === 'kick' && e.kind === 'throw') {
            from = { x: e.x, z: e.z };
            speed = m.ball.speed();
            target = m.passTarget;
          }
        }
      }
      expect(from).not.toBeNull();
      expect(speed).toBeLessThan(22);
      if (target >= 0) expect(m.players[target].isKeeper).toBe(false);
      let land: { x: number; z: number } | null = null;
      for (let i = 0; i < 60 * 3 && !land; i++) {
        m.step(DT, EMPTY_PAD);
        m.drainEvents();
        if (m.ball.owner >= 0 || (m.ball.pos.y < 0.4 && m.ball.vel.y <= 0)) land = { x: m.ball.pos.x, z: m.ball.pos.z };
      }
      expect(land).not.toBeNull();
      expect(Math.hypot(land!.x - from!.x, land!.z - from!.z)).toBeLessThan(THROW_RANGE + 3);
    }
  });
});

describe('goal celebration', () => {
  it('the mob reaches the scorer within ~2.5 s on his way to the corner flag; the conceding side walks off; only resumeAfterGoal ends it', () => {
    for (const seed of [3, 7, 12]) {
      const m = scenario(seed);
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      const scorer = m.players[9];
      place(scorer, gx - ad * 9, -2);
      [10, 8, 7, 6].forEach((i, k) => place(m.players[i], gx - ad * (12 + k * 3), -8 + k * 5));
      for (let i = 12; i < 22; i++) place(m.players[i], gx - ad * (6 + (i % 4) * 3), -9 + (i % 5) * 4);
      const b = m.ball;
      b.reset(gx + ad * 0.6, 0);
      b.pos.y = 0.8;
      b.vel.x = ad * 8;
      b.lastTouch = scorer.idx;
      b.lastTouchSide = 0;
      m.step(DT, EMPTY_PAD);
      expect(m.phase).toBe('goal');
      expect(m.drainEvents().find((e) => e.type === 'goal')).toEqual({ type: 'goal', side: 0, scorer: scorer.idx, own: false });
      expect(m.celebHero).toBe(scorer.idx);
      const spot = m.celebSpot;
      expect(spot.z).toBeGreaterThan(HALF_W - 6);
      expect(Math.sign(spot.x)).toBe(Math.sign(gx));
      const d0 = Math.hypot(scorer.pos.x - spot.x, scorer.pos.z - spot.z);
      const conceding = m.teamPlayers(1).filter((p) => !p.isKeeper).map((p) => ({ p, x: p.pos.x, z: p.pos.z }));
      let reached = -1;
      let top = 0;
      for (let i = 0; i < 60 * 4; i++) {
        m.step(DT, EMPTY_PAD);
        m.drainEvents();
        top = Math.max(top, scorer.speed());
        const mob = m.teamPlayers(0).filter((p) => p !== scorer && !p.isKeeper && Math.hypot(p.pos.x - scorer.pos.x, p.pos.z - scorer.pos.z) < 2.5);
        if (reached < 0 && mob.length >= 3) reached = m.phaseT;
      }
      expect(reached).toBeGreaterThan(0);
      expect(reached).toBeLessThan(2.6);
      expect(top).toBeGreaterThan(8.3); // the celebration sprint (up to 9 m/s)
      expect(Math.hypot(scorer.pos.x - spot.x, scorer.pos.z - spot.z)).toBeLessThan(d0 - 6);
      // The conceding side has walked off (~12 m towards its kick-off spots), away from the party.
      const moved = conceding.map(({ p, x, z }) => Math.hypot(p.pos.x - x, p.pos.z - z));
      expect(moved.reduce((a, v) => a + v, 0) / moved.length).toBeGreaterThan(6);
      for (const { p } of conceding) expect(Math.hypot(p.pos.x - scorer.pos.x, p.pos.z - scorer.pos.z)).toBeGreaterThan(2.5);
      // Nothing in the sim ends the goal phase on its own.
      for (let i = 0; i < 60 * 8; i++) m.step(DT, EMPTY_PAD);
      expect(m.phase).toBe('goal');
      m.resumeAfterGoal();
      expect(m.phase).toBe('kickoff');
    }
  });
});
