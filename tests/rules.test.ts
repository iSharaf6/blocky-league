import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { crossingZ, stickCurl } from '../src/sim/actions';
import { Ball, type BallHit } from '../src/sim/ball';
import { BALL_R, BOX_DEPTH, BOX_W, DT, GOAL_W, HALF_L, HALF_W, PEN_SPOT, SEP_MATE, SEP_OPP, WALL_DIST } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
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
  return seen;
}

/** Step until the pending restart is live (the ball set on its spot). */
function toRestart(m: Match, pads: Pad = EMPTY_PAD): void {
  for (let i = 0; i < 60 * 3 && m.phase !== 'restart'; i++) {
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
    expect(m.onPitch(1).length).toBe(10);
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
        // Midfield foul: the fouler slides on through the spot while the kick is set up.
        slideFoul(m, m.players[9], m.players[11 + 6], 0, 6);
        toRestart(m);
        const r = m.restart!;
        const t = m.players[r.taker];
        while (m.phase === 'restart') {
          expect(Math.hypot(m.ball.pos.x - r.x, m.ball.pos.z - r.z)).toBeLessThan(1e-6);
          expect(Math.hypot(t.pos.x - r.x, t.pos.z - r.z)).toBeLessThan(0.7);
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
        // Human: no stick, hold and release shoot. AI: it takes it itself.
        let kicked = false;
        for (let i = 0; i < 60 * 8 && !kicked; i++) {
          const hold = human === 0 && m.phaseT > 0.4 && m.phaseT < 0.8;
          m.step(DT, hold ? pad(0, 0, { shoot: true }) : EMPTY_PAD);
          kicked = m.drainEvents().some((e) => e.type === 'kick');
        }
        expect(kicked).toBe(true);
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
